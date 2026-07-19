// FocusGuard - Background Script

// Debug flag — gate noisy per-second logs
const DEBUG = false;
const dlog = (...args) => {
  if (DEBUG) console.log(...args);
};

// Store time data for multiple websites
let websiteData = {}; // Format: { domain: { timeSpent: seconds, timeLimit: seconds } }
let lastResetDate = new Date().toDateString();
let activeTabsMap = new Map(); // Track active tabs and their status: Map<tabId, {domain, isActive}>
let timerInterval = null;

// Alarm names
const TICK_ALARM = "focusTick";
const DAILY_RESET_ALARM = "dailyReset";

// Never credit more than this many seconds in a single flush — guards against
// a long service-worker sleep over-crediting time to tabs we cannot confirm
// stayed active the whole time.
const MAX_FLUSH_CREDIT = 90;

// Prevent overlapping flushes
let flushInProgress = false;

// Keep track of last initialization time
let lastInitializeTime = 0;

// Initialize: Load saved data and reset if needed
const initialize = async () => {
  // Prevent multiple initializations in a short period
  const now = Date.now();
  if (now - lastInitializeTime < 5000) {
    console.log("Initialize called too soon after previous init, skipping");
    return;
  }

  lastInitializeTime = now;
  console.log("Initializing FocusGuard extension");

  try {
    const data = await chrome.storage.local.get([
      "websiteData",
      "lastResetDate",
    ]);

    // Initialize website data structure if it doesn't exist
    websiteData = data.websiteData || {};

    // Attempt to migrate old data format if needed
    if (
      !data.websiteData &&
      data.timeSpent !== undefined &&
      data.timeLimit !== undefined
    ) {
      console.log("Migrating from old data format");
      // Add Facebook as the initial website with the old time data
      websiteData["facebook.com"] = {
        timeSpent: data.timeSpent || 0,
        timeLimit: data.timeLimit || 1800, // 30 minutes in seconds
      };

      // Save the migrated data
      await chrome.storage.local.set({ websiteData });
    }

    // Initialize lastResetDate
    if (data.lastResetDate) {
      lastResetDate = data.lastResetDate;
    }

    // Set up midnight reset alarm
    setupMidnightReset();

    // Check if we need to reset daily counts
    await resetDailyData();

    console.log("Loaded storage data:", data);
  } catch (error) {
    console.error("Error in initialization:", error);
  }

  // Start the timer if it's not already running
  startTimer();
};

// Remove closed tabs from the tracking map
const pruneClosedTabs = async () => {
  if (activeTabsMap.size === 0) return;
  const tabs = await chrome.tabs.query({});
  const existing = new Set(tabs.map((tab) => tab.id));
  for (const tabId of activeTabsMap.keys()) {
    if (!existing.has(tabId)) activeTabsMap.delete(tabId);
  }
};

// Accumulate active time using wall-clock diffs rather than counting timer
// ticks. This stays accurate even when the MV3 service worker is killed and
// later revived by an event or alarm, because elapsed time is derived from
// `lastFlushTime` in storage — not from how many intervals actually fired.
const flushActiveTime = async () => {
  if (flushInProgress) return;
  flushInProgress = true;
  try {
    const now = Date.now();

    // Determine currently active tracked domains
    await pruneClosedTabs();
    const activeDomains = new Set();
    for (const tabData of activeTabsMap.values()) {
      if (
        tabData?.isActive &&
        tabData.domain &&
        shouldTrackDomain(tabData.domain)
      ) {
        activeDomains.add(tabData.domain);
      }
    }

    // Single source of truth: always read-modify-write storage
    const stored = await chrome.storage.local.get([
      "websiteData",
      "lastFlushTime",
    ]);
    websiteData = stored.websiteData || {};
    const lastFlush = stored.lastFlushTime || now;

    // Seconds since last flush, clamped so a long worker-death gap can't
    // over-credit time to tabs we cannot confirm stayed active.
    const elapsed = Math.min(
      Math.max((now - lastFlush) / 1000, 0),
      MAX_FLUSH_CREDIT,
    );

    if (activeDomains.size > 0 && elapsed > 0) {
      dlog(
        `Crediting ${elapsed.toFixed(1)}s to ${activeDomains.size} domain(s)`,
      );
      for (const domain of activeDomains) {
        if (!websiteData[domain]) {
          websiteData[domain] = {
            timeSpent: 0,
            timeLimit: 1800, // 30 minutes default
            warned: false,
          };
        }
        websiteData[domain].timeSpent += elapsed;
      }
    }

    await chrome.storage.local.set({ websiteData, lastFlushTime: now });

    if (activeDomains.size > 0) {
      await checkTimeLimits(Array.from(activeDomains));
    }
  } catch (error) {
    console.error("Error in flushActiveTime:", error);
  } finally {
    flushInProgress = false;
  }
};

// Start tracking. Two complementary drivers:
//  - setInterval: fast, sub-second flushes while the worker is alive.
//  - alarm heartbeat: survives worker sleep so limits still get enforced.
const startTimer = () => {
  if (timerInterval !== null) {
    try {
      clearInterval(timerInterval);
      timerInterval = null;
      console.log("Previous timer cleared");
    } catch (error) {
      console.error("Error clearing interval:", error);
    }
  }

  console.log("Starting time tracking");

  // Reset the flush baseline so the first interval doesn't credit a stale gap
  chrome.storage.local.set({ lastFlushTime: Date.now() });

  timerInterval = setInterval(() => {
    flushActiveTime();
  }, 1000);

  // Heartbeat alarm (min period 1 min in production) catches up after sleep
  chrome.alarms?.create(TICK_ALARM, { periodInMinutes: 1 });
};

// Check if time limits are reached or approaching for specified domains
const checkTimeLimits = async (domains = []) => {
  try {
    // Get all website data
    const data = await chrome.storage.local.get(["websiteData"]);
    const websiteData = data.websiteData || {};

    // If no domains provided, check all domains in websiteData
    if (!domains || domains.length === 0) {
      domains = Object.keys(websiteData);
    }

    // Process each domain
    for (const domain of domains) {
      const siteData = websiteData[domain];
      if (!siteData) continue;

      const timeSpent = siteData.timeSpent;
      const timeLimit = siteData.timeLimit;

      // Skip if no time limit set
      if (!timeLimit) continue;

      // Warn once when approaching time limit (90%)
      if (timeSpent >= Math.floor(timeLimit * 0.9) && !siteData.warned) {
        siteData.warned = true;
        await chrome.storage.local.set({ websiteData });
        await chrome.notifications.create({
          type: "basic",
          iconUrl: "icon48.png",
          title: "FocusGuard",
          message: `Approaching time limit for ${domain}! ${Math.floor(
            (timeLimit - timeSpent) / 60,
          )} minutes left.`,
        });
      }

      // Block when time limit is reached
      if (timeSpent >= timeLimit) {
        try {
          // Find all tabs for this domain
          const tabs = await chrome.tabs.query({});
          const domainTabs = tabs.filter((tab) => {
            const tabDomain = extractDomain(tab.url);
            return tabDomain === domain;
          });

          console.log(
            `Time limit reached for ${domain}. Blocking ${domainTabs.length} tabs.`,
          );

          // Notify all domain tabs that limit is reached
          for (const tab of domainTabs) {
            try {
              await chrome.tabs.sendMessage(tab.id, {
                action: "timeLimitReached",
                domain: domain,
              });
            } catch (tabError) {
              console.error(
                `Error sending message to tab ${tab.id}:`,
                tabError,
              );

              // Fallback method: redirect if messaging fails
              try {
                const blockedUrl = new URL(
                  chrome.runtime.getURL("ui/blocked/blocked.html"),
                );
                blockedUrl.searchParams.set("domain", domain);

                await chrome.tabs.update(tab.id, {
                  url: blockedUrl.toString(),
                });
              } catch (redirectError) {
                console.error(
                  `Error redirecting tab ${tab.id}:`,
                  redirectError,
                );
              }
            }
          }
        } catch (queryError) {
          console.error(`Error processing tabs for ${domain}:`, queryError);
        }
      }
    }
  } catch (error) {
    console.error("Error in checkTimeLimits:", error);
  }
};

// Track any website tabs being opened (we'll filter by tracked domains later)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && details.url) {
    try {
      const domain = extractDomain(details.url);

      // Track this tab (initially assume not active until content script reports)
      activeTabsMap.set(details.tabId, {
        domain,
        isActive: false,
        lastUpdateTime: Date.now(),
      });

      // Log that we're tracking this tab
      console.log(`Now tracking tab ${details.tabId} (${domain})`);
    } catch (e) {
      console.error("Error processing navigation event:", e);
    }
  }
});

// Remove tabs from tracking when closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabsMap.has(tabId)) {
    // Credit time accrued so far before dropping the tab
    flushActiveTime();
    activeTabsMap.delete(tabId);
  }
});

// Function to handle extension context changes
chrome.runtime.onSuspend.addListener(() => {
  console.log("Extension is being suspended");

  // Clean up resources
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
});

// Listen for possible extension context invalidation
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed or updated");

  // Initialize extension as context is valid
  initialize();
});

// Re-initialize on browser startup (onInstalled does not fire then)
chrome.runtime.onStartup.addListener(() => {
  console.log("Browser started, initializing");
  initialize();
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle visibility change messages from content scripts
  if (message.action === "visibilityChange" && sender.tab) {
    const tabId = sender.tab.id;
    const isActive = message.isActive;
    const tabUrl = sender.tab.url || message.tabUrl;
    const domain = extractDomain(tabUrl);

    // Log the visibility change for debugging
    console.log(
      `Tab ${tabId} (${domain}) visibility changed to ${isActive}`,
      message.source || "unknown source",
      message.timestamp ? new Date(message.timestamp).toISOString() : "",
    );

    // Credit time accrued under the previous state, then update and re-check.
    flushActiveTime().then(() => {
      activeTabsMap.set(tabId, {
        domain,
        isActive,
        lastUpdateTime: Date.now(),
      });
      flushActiveTime();
    });

    // Get current active domains for debugging
    const activeDomains = new Set();
    Array.from(activeTabsMap.entries())
      .filter(([_, data]) => data.isActive)
      .forEach(([_, data]) => {
        if (data.domain && shouldTrackDomain(data.domain)) {
          activeDomains.add(data.domain);
        }
      });

    console.log(
      `Active tracked domains: ${Array.from(activeDomains).join(", ")}`,
    );

    // Send a response to acknowledge receipt of the visibility change
    sendResponse({
      received: true,
      tabActive: isActive,
      domain: domain,
      tracked: shouldTrackDomain(domain),
      activeTabs: activeDomains.size,
    });

    return true; // Required for async response
  }

  // Handle ping messages (used for reconnection)
  if (message.action === "ping") {
    try {
      const tabInfo = sender.tab
        ? `tab ${sender.tab.id} (${sender.tab.url?.substring(0, 50)}...)`
        : "unknown source";

      console.log(
        `Received ping from ${tabInfo}`,
        message.source ? `Source: ${message.source}` : "",
        message.reconnectAttempt ? `Attempt: ${message.reconnectAttempt}` : "",
      );

      // If this is from a facebook tab, make sure it's in our tracking map
      if (sender.tab && sender.tab.url) {
        const domain = extractDomain(sender.tab.url);
        // Record it in our active tabs map if not already there
        if (!activeTabsMap.has(sender.tab.id)) {
          console.log(
            `Adding previously unknown tab ${sender.tab.id} to tracking`,
          );
          activeTabsMap.set(sender.tab.id, {
            domain: domain,
            isActive: false, // Default to inactive until we get a visibility change
            lastUpdateTime: Date.now(),
          });
        }
      }

      // Update the ping response to get actual values from websiteData if possible
      let currentTimeSpent = 0;
      let currentTimeLimit = 1800; // 30 minutes default
      let isTracked = false;

      if (sender.tab && sender.tab.url) {
        const domain = extractDomain(sender.tab.url);
        if (websiteData[domain]) {
          currentTimeSpent = websiteData[domain].timeSpent;
          currentTimeLimit = websiteData[domain].timeLimit;
          isTracked = true;
        }
      }

      // Respond with detailed info to confirm connection is working
      sendResponse({
        status: "ok",
        timestamp: Date.now(),
        tabsTracked: activeTabsMap.size,
        timeSpent: currentTimeSpent,
        timeLimit: currentTimeLimit,
        isTracked: isTracked,
        websiteData: websiteData,
      });
    } catch (error) {
      console.error("Error handling ping:", error);
      sendResponse({ status: "error", error: error.message });
    }
    return true;
  }

  // Handle active tabs info request
  if (message.action === "getActiveTabsInfo") {
    try {
      const activeTabs = Array.from(activeTabsMap.entries())
        .filter(([, data]) => data?.isActive)
        .map(([id]) => id);

      console.log("Providing active tabs info:", activeTabs);
      sendResponse({
        activeTabs: activeTabs,
        totalTabs: activeTabsMap.size,
      });
    } catch (error) {
      console.error("Error providing active tabs info:", error);
      sendResponse({ error: error.message });
    }
    return true;
  }

  // Handle force time update request — flush accumulated active time now
  if (message.action === "forceTimeUpdate") {
    flushActiveTime()
      .then(() => sendResponse({ success: true }))
      .catch((error) =>
        sendResponse({ success: false, error: error.message }),
      );
    return true; // Required for async response
  }

  // Handle website specific actions
  // Add website
  if (message.action === "addWebsite") {
    try {
      const domain = message.domain;
      const timeLimit = parseInt(message.timeLimit, 10) || 30;

      addWebsite(domain, timeLimit)
        .then((result) => {
          sendResponse({ success: result });
        })
        .catch((error) => {
          console.error("Error adding website:", error);
          sendResponse({ success: false, error: error.message });
        });

      return true;
    } catch (error) {
      console.error("Error in addWebsite handler:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // Remove website
  if (message.action === "removeWebsite") {
    try {
      const domain = message.domain;

      removeWebsite(domain)
        .then((result) => {
          sendResponse({ success: result });
        })
        .catch((error) => {
          console.error("Error removing website:", error);
          sendResponse({ success: false, error: error.message });
        });

      return true;
    } catch (error) {
      console.error("Error in removeWebsite handler:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // Update website time limit
  if (message.action === "updateWebsiteLimit") {
    try {
      const domain = message.domain;
      const newLimitMinutes = parseInt(message.timeLimit, 10) || 30;

      updateWebsiteLimit(domain, newLimitMinutes)
        .then((result) => {
          sendResponse({ success: result });
        })
        .catch((error) => {
          console.error("Error updating website limit:", error);
          sendResponse({ success: false, error: error.message });
        });

      return true;
    } catch (error) {
      console.error("Error in updateWebsiteLimit handler:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // Reset time for specific website
  if (message.action === "resetWebsiteTime") {
    try {
      const domain = message.domain;

      resetWebsiteTime(domain)
        .then((result) => {
          sendResponse({ success: result });
        })
        .catch((error) => {
          console.error("Error resetting website time:", error);
          sendResponse({ success: false, error: error.message });
        });

      return true;
    } catch (error) {
      console.error("Error in resetWebsiteTime handler:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // Legacy handler for time limit update from popup (for backwards compatibility)
  if (message.action === "setTimeLimit") {
    // Make sure we have a valid number
    const newLimitMinutes = parseInt(message.timeLimit, 10) || 30;
    const timeLimitSecs = newLimitMinutes * 60; // Convert minutes to seconds

    console.log(
      `Setting new default time limit: ${newLimitMinutes} minutes (${timeLimitSecs} seconds)`,
    );

    // Add or update facebook.com if it exists in websiteData
    chrome.storage.local.get(["websiteData"], (data) => {
      let websiteData = data.websiteData || {};

      // Update facebook.com if it exists
      if (websiteData["facebook.com"]) {
        websiteData["facebook.com"].timeLimit = timeLimitSecs;
      }

      chrome.storage.local
        .set({ websiteData })
        .then(() => {
          console.log("Time limit updated successfully:", timeLimitSecs);
          sendResponse({
            status: "Time limit updated",
            timeLimit: timeLimitSecs,
          });
        })
        .catch((error) => {
          console.error("Error saving time limit:", error);
          sendResponse({ status: "Error: " + error.message });
        });
    });

    return true; // Required for async response
  }

  // Legacy handler for manual time reset from popup (for backwards compatibility)
  if (message.action === "resetTime") {
    try {
      // Reset facebook.com if it exists
      chrome.storage.local.get(["websiteData"], (data) => {
        let websiteData = data.websiteData || {};

        // Reset facebook.com if it exists
        if (websiteData["facebook.com"]) {
          websiteData["facebook.com"].timeSpent = 0;
        }

        const lastResetDate = new Date().toDateString();

        chrome.storage.local
          .set({ websiteData, lastResetDate })
          .then(() => {
            console.log("Time counter manually reset");
            sendResponse({ success: true });
          })
          .catch((error) => {
            console.error("Error resetting time:", error);
            sendResponse({ success: false, error: error.message });
          });
      });

      return true; // Required for async response
    } catch (error) {
      console.error("Error in resetTime handler:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // Handle complete settings reset
  if (message.action === "resetAllSettings") {
    try {
      // Initialize a clean websiteData object with Facebook as default
      const websiteData = {
        "facebook.com": {
          timeSpent: 0,
          timeLimit: 30 * 60, // 30 minutes in seconds
        },
      };

      lastResetDate = new Date().toDateString();

      // Clear and reset storage
      chrome.storage.local
        .clear()
        .then(() => {
          return chrome.storage.local.set({
            websiteData,
            lastResetDate,
          });
        })
        .then(() => {
          console.log("All settings reset to defaults");
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error("Error resetting settings:", error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Required for async response
    } catch (error) {
      console.error("Error in resetAllSettings handler:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // Important: Return true if we want to send a response asynchronously
  return true;
});

// Helper function to extract domain from URL
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    // Get hostname (e.g., www.facebook.com) and extract main domain
    let domain = urlObj.hostname;

    // Remove www. prefix if present
    if (domain.startsWith("www.")) {
      domain = domain.substring(4);
    }

    return domain;
  } catch (e) {
    console.error("Error extracting domain:", e);
    return null;
  }
}

// New function to check if a domain should be tracked
function shouldTrackDomain(domain) {
  // Don't track chrome:// or chrome-extension:// URLs
  if (
    !domain ||
    domain.includes("chrome.") ||
    domain.includes("chrome-extension") ||
    domain.includes("localhost") ||
    domain.includes("127.0.0.1")
  ) {
    return false;
  }

  // Check if the domain exists in our websiteData
  return websiteData.hasOwnProperty(domain);
}

// Function to get tab domain
async function getTabDomain(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      return extractDomain(tab.url);
    }
  } catch (e) {
    console.error(`Error getting tab ${tabId} info:`, e);
  }
  return null;
}

// Reset data for a new day
async function resetDailyData() {
  const today = new Date().toDateString();

  // Load latest data from storage. The in-memory copy may be empty on a cold
  // service-worker wake (e.g. triggered by the daily alarm), so we must not
  // reset from it — that would clear nothing yet advance lastResetDate.
  const data = await chrome.storage.local.get(["websiteData", "lastResetDate"]);
  const storedResetDate = data.lastResetDate || lastResetDate;

  if (storedResetDate === today) {
    lastResetDate = today;
    return;
  }

  console.log("New day detected, resetting time counters");
  websiteData = data.websiteData || websiteData;
  lastResetDate = today;

  // Reset time and warning flags for all websites
  Object.keys(websiteData).forEach((domain) => {
    websiteData[domain].timeSpent = 0;
    websiteData[domain].warned = false;
  });

  await chrome.storage.local.set({ websiteData, lastResetDate });
}

// Add a new website to track
async function addWebsite(domain, timeLimit = 30) {
  if (!domain) return false;

  // Normalize domain
  domain = domain.toLowerCase();
  if (domain.startsWith("www.")) {
    domain = domain.substring(4);
  }

  try {
    // Get the most recent website data from storage
    const data = await chrome.storage.local.get(["websiteData"]);
    const currentWebsiteData = data.websiteData || {};

    // Add to websiteData if not exists
    if (!currentWebsiteData[domain]) {
      currentWebsiteData[domain] = {
        timeSpent: 0, // Time in seconds
        timeLimit: timeLimit * 60, // Convert minutes to seconds
      };

      // Update our in-memory copy
      websiteData = currentWebsiteData;

      // Save to storage
      await chrome.storage.local.set({ websiteData: currentWebsiteData });
      console.log(
        `Added new website: ${domain} with limit: ${timeLimit} minutes`,
      );

      // Notify any existing tabs with this domain that they are now being tracked
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (!tab.url) continue;

          const tabDomain = extractDomain(tab.url);
          if (tabDomain === domain) {
            console.log(
              `Notifying tab ${tab.id} that ${domain} is now tracked`,
            );
            chrome.tabs
              .sendMessage(tab.id, {
                action: "domainNowTracked",
                domain: domain,
              })
              .catch((err) =>
                console.log(`Could not notify tab ${tab.id}: ${err.message}`),
              );
          }
        }
      } catch (err) {
        console.error("Error notifying tabs about new tracked domain:", err);
      }
      return true;
    }
    await notifyWebsiteTracking(domain);
    return false;
  } catch (error) {
    console.error("Error adding website:", error);
    return false;
  }
}

// Add this to your background.js after the addWebsite function
async function notifyWebsiteTracking(domain) {
  try {
    // Query all tabs that match this domain
    const tabs = await chrome.tabs.query({});
    let matchedTabs = 0;

    for (const tab of tabs) {
      if (!tab.url) continue;

      const tabDomain = extractDomain(tab.url);
      if (tabDomain === domain) {
        matchedTabs++;
        console.log(`Notifying tab ${tab.id} that ${domain} is now tracked`);

        try {
          // First check if the tab is already in our tracking map
          if (!activeTabsMap.has(tab.id)) {
            // Add it to tracking with default inactive state
            activeTabsMap.set(tab.id, {
              domain: domain,
              isActive: false, // Will be updated when tab responds
              lastUpdateTime: Date.now(),
            });
          }

          // Send a message to start tracking immediately
          await chrome.tabs.sendMessage(tab.id, {
            action: "startTracking",
            domain: domain,
            timeSpent: websiteData[domain].timeSpent,
            timeLimit: websiteData[domain].timeLimit,
          });
        } catch (sendError) {
          console.warn(`Could not notify tab ${tab.id}:`, sendError.message);
        }
      }
    }

    console.log(`Notified ${matchedTabs} tabs about tracking for ${domain}`);
  } catch (err) {
    console.error("Error notifying tabs about tracked domain:", err);
  }
}

// Remove a website from tracking
async function removeWebsite(domain) {
  if (!domain || !websiteData[domain]) return false;

  // Remove from websiteData
  delete websiteData[domain];

  // Save updated data
  await chrome.storage.local.set({ websiteData });
  console.log(`Removed website: ${domain} from tracking`);
  return true;
}

// Update website time limit
async function updateWebsiteLimit(domain, timeLimit) {
  if (!domain || !websiteData[domain]) return false;

  // Update time limit (convert minutes to seconds)
  websiteData[domain].timeLimit = timeLimit * 60;

  // Save updated data
  await chrome.storage.local.set({ websiteData });
  console.log(`Updated time limit for ${domain} to ${timeLimit} minutes`);
  return true;
}

// Reset time spent for a specific website
async function resetWebsiteTime(domain) {
  if (!domain || !websiteData[domain]) return false;

  // Reset time spent
  websiteData[domain].timeSpent = 0;

  // Save updated data
  await chrome.storage.local.set({ websiteData });
  console.log(`Reset time for website: ${domain}`);
  return true;
}

// Handle errors safely
const handleError = (error) => {
  console.error("FocusGuard error:", error.message);
};

// Initialize when extension loads - wrapped in try/catch to handle errors
try {
  initialize();
} catch (error) {
  handleError(error);
}

// Register the alarm listener at top level (synchronously) so the service
// worker re-attaches it on wake-up before the alarm event is dispatched.
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === DAILY_RESET_ALARM) {
    console.log("Daily reset triggered by alarm at:", new Date().toString());
    resetDailyData();
  } else if (alarm.name === TICK_ALARM) {
    // Heartbeat: catch up on active time and enforce limits after a sleep
    flushActiveTime();
  }
});

function setupMidnightReset() {
  // Create or update the midnight reset alarm
  chrome.alarms?.create(DAILY_RESET_ALARM, {
    // Set first alarm for the next midnight (00:05 AM)
    when: getNextMidnight(),
    // Then repeat daily
    periodInMinutes: 24 * 60,
  });
}

// Helper function to calculate the next midnight (plus 5 minutes)
function getNextMidnight() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 5, 0, 0); // 00:05:00 AM

  return tomorrow.getTime();
}
