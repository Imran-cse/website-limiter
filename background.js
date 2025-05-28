// Website Time Limiter - Background Script

// Store time data for multiple websites
let websiteData = {}; // Format: { domain: { timeSpent: seconds, timeLimit: seconds } }
let lastResetDate = new Date().toDateString();
let activeTabsMap = new Map(); // Track active tabs and their status: Map<tabId, {domain, isActive}>
let timerInterval = null;

// Legacy variables for backward compatibility
let timeSpent = 0;
let timeLimit = 30 * 60; // 30 minutes in seconds

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
  console.log("Initializing Website Time Limiter extension");

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

    // Check if we need to reset daily counts
    resetDailyData();

    console.log("Loaded storage data:", data);

    if (data.timeSpent !== undefined) {
      timeSpent = parseInt(data.timeSpent);
      console.log("Loaded time spent:", timeSpent, "seconds");
    } else {
      console.log("No saved time spent, using default:", timeSpent);
    }

    if (data.timeLimit !== undefined && data.timeLimit) {
      timeLimit = parseInt(data.timeLimit);
      console.log("Loaded time limit:", timeLimit, "seconds");
    } else {
      console.log("No saved time limit, using default:", timeLimit);
      // Explicitly save the default time limit if none was found
      await chrome.storage.local.set({ timeLimit });
    }

    // Verify the timeLimit is a valid number
    if (isNaN(timeLimit) || timeLimit <= 0) {
      timeLimit = 30 * 60; // Reset to default if invalid
      console.log("Invalid time limit detected, reset to default:", timeLimit);
      await chrome.storage.local.set({ timeLimit });
    }

    if (data.lastResetDate) {
      lastResetDate = data.lastResetDate;
      console.log("Last reset date:", lastResetDate);
    } else {
      console.log("No reset date found, using today:", lastResetDate);
    }

    // Reset time if it's a new day
    const today = new Date().toDateString();
    if (lastResetDate !== today) {
      console.log("New day detected, resetting time");
      timeSpent = 0;
      lastResetDate = today;
      await chrome.storage.local.set({ timeSpent, lastResetDate });
    }
  } catch (error) {
    console.error("Error in initialization:", error);
  }

  // Start the timer if it's not already running
  startTimer();
};

// Start the timer that increments time spent when tracked websites are active
const startTimer = () => {
  if (timerInterval !== null) {
    // Clear any existing interval just to be safe
    if (websiteData["facebook.com"]) {
      timeSpent = websiteData["facebook.com"].timeSpent;
      timeLimit = websiteData["facebook.com"].timeLimit;
    }
    try {
      clearInterval(timerInterval);
      timerInterval = null;
      console.log("Previous timer cleared");
    } catch (error) {
      console.error("Error clearing interval:", error);
    }
  }

  console.log("Starting new timer interval");

  // Create new interval for tracking time
  timerInterval = setInterval(async () => {
    try {
      // Log timer tick for debugging
      console.log("Timer tick: checking for active tracked websites...");

      // Track active domains
      const activeDomains = new Map(); // Map of domain -> tab count
      const activeTabIds = [];

      // Check if we have any active tabs to track
      const tabMapSize = activeTabsMap.size;
      console.log(`Active tabs map contains ${tabMapSize} tabs`);

      if (tabMapSize > 0) {
        // Verify tabs actually exist (they might have been closed without proper events)
        const tabs = await chrome.tabs.query({});
        const existingTabIds = tabs.map((tab) => tab.id);

        // Clean up our map by removing non-existent tabs
        for (const tabId of activeTabsMap.keys()) {
          if (!existingTabIds.includes(tabId)) {
            activeTabsMap.delete(tabId);
            continue;
          }

          // Get tab data
          const tabData = activeTabsMap.get(tabId);

          // Skip inactive tabs or tabs without valid domains
          if (!tabData?.isActive || !tabData?.domain) {
            continue;
          }

          // Only count domains we're tracking
          if (shouldTrackDomain(tabData.domain)) {
            activeDomains.set(
              tabData.domain,
              (activeDomains.get(tabData.domain) || 0) + 1
            );
            activeTabIds.push(tabId);
          }
        }
      }

      // Process each active domain
      if (activeDomains.size > 0) {
        console.log(
          `Incrementing time for ${activeDomains.size} active domains across ${activeTabIds.length} tab(s)`
        );

        // Load current website data
        const data = await chrome.storage.local.get(["websiteData"]);
        let websiteData = data.websiteData || {};

        // Increment time for each active domain
        for (const [domain, count] of activeDomains.entries()) {
          if (!websiteData[domain]) {
            // Initialize if not exists
            websiteData[domain] = {
              timeSpent: 0,
              timeLimit: 1800, // 30 minutes default
            };
          }

          // Increment by 1 second
          websiteData[domain].timeSpent += 1;

          // Log every minute for debugging
          if (websiteData[domain].timeSpent % 60 === 0) {
            console.log(
              `Time spent on ${domain} updated: ${Math.floor(
                websiteData[domain].timeSpent / 60
              )} minutes`
            );
          }
        }

        // Save the updated website data
        await chrome.storage.local.set({ websiteData });

        // Handle limit warnings and blocking
        await checkTimeLimits(Array.from(activeDomains.keys()));
      }
    } catch (error) {
      console.error("Error in timer:", error);
    }
  }, 1000);
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

      // Warn when approaching time limit (90%)
      if (timeSpent === Math.floor(timeLimit * 0.9)) {
        await chrome.notifications.create({
          type: "basic",
          iconUrl: "icon48.png",
          title: "Website Time Limiter",
          message: `Approaching time limit for ${domain}! ${Math.floor(
            (timeLimit - timeSpent) / 60
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
            `Time limit reached for ${domain}. Blocking ${domainTabs.length} tabs.`
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
                tabError
              );

              // Fallback method: redirect if messaging fails
              try {
                const blockedUrl = new URL(
                  chrome.runtime.getURL("blocked.html")
                );
                blockedUrl.searchParams.set("domain", domain);

                await chrome.tabs.update(tab.id, {
                  url: blockedUrl.toString(),
                });
              } catch (redirectError) {
                console.error(
                  `Error redirecting tab ${tab.id}:`,
                  redirectError
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
      message.timestamp ? new Date(message.timestamp).toISOString() : ""
    );

    // Update the active tabs map with domain information
    activeTabsMap.set(tabId, {
      domain,
      isActive,
      lastUpdateTime: Date.now(),
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
      `Active tracked domains: ${Array.from(activeDomains).join(", ")}`
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
        message.reconnectAttempt ? `Attempt: ${message.reconnectAttempt}` : ""
      );

      // If this is from a facebook tab, make sure it's in our tracking map
      if (
        sender.tab &&
        sender.tab.url &&
        sender.tab.url.includes("facebook.com")
      ) {
        // Record it in our active tabs map if not already there
        if (!activeTabsMap.has(sender.tab.id)) {
          console.log(
            `Adding previously unknown tab ${sender.tab.id} to tracking`
          );
          activeTabsMap.set(sender.tab.id, false); // Default to inactive until we get a status
        }
      }

      // Update the ping response to get actual values from websiteData if possible
      let currentTimeSpent = timeSpent;
      let currentTimeLimit = timeLimit;

      if (sender.tab && sender.tab.url) {
        const domain = extractDomain(sender.tab.url);
        if (websiteData[domain]) {
          currentTimeSpent = websiteData[domain].timeSpent;
          currentTimeLimit = websiteData[domain].timeLimit;
        }
      }

      // Respond with detailed info to confirm connection is working
      sendResponse({
        status: "ok",
        timestamp: Date.now(),
        tabsTracked: activeTabsMap.size,
        timeSpent: timeSpent,
        timeLimit: timeLimit,
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
        .filter(([_, active]) => active)
        .map(([id, _]) => id);

      console.log("Providing active tabs info:", activeTabs);
      sendResponse({
        activeTabs: activeTabs,
        totalTabs: activeTabsMap.size,
        timeSpent: timeSpent,
      });
    } catch (error) {
      console.error("Error providing active tabs info:", error);
      sendResponse({ error: error.message });
    }
    return true;
  }

  // Handle force time update request
  if (message.action === "forceTimeUpdate") {
    try {
      console.log("Force time update requested. Current timeSpent:", timeSpent);

      // Save current time spent to storage
      chrome.storage.local
        .set({ timeSpent })
        .then(() => {
          console.log("Time counter manually updated to:", timeSpent);
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error("Error updating time:", error);
          sendResponse({ success: false, error: error.message });
        });

      return true; // Required for async response
    } catch (error) {
      console.error("Error in forceTimeUpdate handler:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
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
      `Setting new default time limit: ${newLimitMinutes} minutes (${timeLimitSecs} seconds)`
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
function resetDailyData() {
  const today = new Date().toDateString();

  if (lastResetDate !== today) {
    console.log("New day detected, resetting time counters");
    lastResetDate = today;

    // Reset time for all websites
    Object.keys(websiteData).forEach((domain) => {
      websiteData[domain].timeSpent = 0;
    });

    // Save updated data
    chrome.storage.local.set({
      websiteData,
      lastResetDate,
    });
  }
}

// Add a new website to track
async function addWebsite(domain, timeLimit = 30) {
  if (!domain) return false;

  // Normalize domain
  domain = domain.toLowerCase();
  if (domain.startsWith("www.")) {
    domain = domain.substring(4);
  }

  // Add to websiteData if not exists
  if (!websiteData[domain]) {
    websiteData[domain] = {
      timeSpent: 0, // Time in seconds
      timeLimit: timeLimit * 60, // Convert minutes to seconds
    };

    // Save to storage
    await chrome.storage.local.set({ websiteData });
    console.log(
      `Added new website: ${domain} with limit: ${timeLimit} minutes`
    );
    return true;
  }
  return false;
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

// Update time spent for active tabs
function updateTime() {
  // Get the current time
  const now = Date.now();
  let anyActive = false;

  // Process each active tab
  activeTabsMap.forEach((tabData, tabId) => {
    const { domain, isActive, lastUpdateTime } = tabData;

    // Skip inactive tabs or tabs without valid domains
    if (!isActive || !domain || !shouldTrackDomain(domain)) return;

    // Calculate time difference since last update
    const timeDiff = (now - lastUpdateTime) / 1000; // in seconds

    // Update time spent for this domain
    if (websiteData[domain]) {
      websiteData[domain].timeSpent += timeDiff;
      anyActive = true;
    }

    // Update last update time
    tabData.lastUpdateTime = now;
  });

  // Save updated data if any tab was active
  if (anyActive) {
    chrome.storage.local.set({ websiteData });
  }

  // Check time limits for all websites
  checkTimeLimitsAndBlock();
}

// Change the second instance of checkTimeLimits to a different name
// Check if any website has reached its time limit
async function checkTimeLimitsAndBlock() {
  for (const [domain, data] of Object.entries(websiteData)) {
    if (data.timeSpent >= data.timeLimit) {
      // Find all tabs with this domain
      const tabs = await chrome.tabs.query({});

      for (const tab of tabs) {
        const tabDomain = extractDomain(tab.url);

        // If this tab matches the domain that reached limit
        if (tabDomain === domain) {
          // Send time limit reached message to content script
          try {
            await chrome.tabs.sendMessage(tab.id, {
              action: "timeLimitReached",
              domain: domain,
              timeSpent: data.timeSpent,
              timeLimit: data.timeLimit,
            });
          } catch (e) {
            console.error(`Error sending limit message to tab ${tab.id}:`, e);
          }
        }
      }
    }
  }
}

// Handle errors safely
const handleError = (error) => {
  console.error("Facebook Limiter error:", error.message);
};

// Initialize when extension loads - wrapped in try/catch to handle errors
try {
  initialize();
} catch (error) {
  handleError(error);
}
