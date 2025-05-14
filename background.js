let timeSpent = 0; // Time spent on Facebook today (seconds)
let timeLimit = 30 * 60; // Default 30 minutes (in seconds)
let lastResetDate = new Date().toDateString();
let activeTabsMap = new Map(); // Track active Facebook tabs and their status
let timerInterval = null;

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
  console.log("Initializing Facebook Limiter extension");

  try {
    const data = await chrome.storage.local.get([
      "timeSpent",
      "timeLimit",
      "lastResetDate",
    ]);

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

// Start the timer that increments time spent when Facebook tabs are active
const startTimer = () => {
  if (timerInterval !== null) {
    // Clear any existing interval just to be safe
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
      console.log("Timer tick: checking for active Facebook tabs...");

      // Only increment time if at least one Facebook tab is active
      let activeFacebookTabs = false;
      let activeTabIds = [];

      // Check if we have any active Facebook tabs
      const tabMapSize = activeTabsMap.size;
      console.log(`Active tabs map contains ${tabMapSize} tabs`);

      if (tabMapSize > 0) {
        for (const [tabId, isActive] of activeTabsMap.entries()) {
          if (isActive) {
            activeFacebookTabs = true;
            activeTabIds.push(tabId);
          }
        }

        console.log(
          `Found ${activeTabIds.length} active tabs out of ${tabMapSize}`
        );
      }

      // Verify tabs actually exist (they might have been closed without proper events)
      if (activeFacebookTabs && activeTabIds.length > 0) {
        try {
          const tabs = await chrome.tabs.query({});
          const existingTabIds = tabs.map((tab) => tab.id);

          // Filter only tabs that still exist
          const validActiveTabIds = activeTabIds.filter((id) =>
            existingTabIds.includes(id)
          );

          // Clean up our map by removing non-existent tabs
          for (const tabId of activeTabsMap.keys()) {
            if (!existingTabIds.includes(tabId)) {
              activeTabsMap.delete(tabId);
            }
          }

          // Update active status based on cleaned map
          activeFacebookTabs = validActiveTabIds.length > 0;

          if (activeFacebookTabs) {
            console.log(
              `Incrementing time for ${validActiveTabIds.length} active Facebook tab(s)`
            );
          }
        } catch (error) {
          console.error("Error verifying tabs:", error);
        }
      }

      if (activeFacebookTabs) {
        // Increment and save time immediately
        timeSpent += 1;

        // Log every minute for debugging
        if (timeSpent % 60 === 0) {
          console.log(
            `Time spent updated: ${Math.floor(timeSpent / 60)} minutes`
          );
        }

        // Save the time spent
        await chrome.storage.local.set({ timeSpent });

        // Handle limit warnings and blocking
        await checkTimeLimit();
      }
    } catch (error) {
      console.error("Error in timer:", error);
    }
  }, 1000);
};

// Check if time limit is reached or approaching
const checkTimeLimit = async () => {
  try {
    // Warn when approaching time limit (90%)
    if (timeSpent === Math.floor(timeLimit * 0.9)) {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icon48.png",
        title: "Facebook Limiter",
        message: `Approaching time limit! ${Math.floor(
          (timeLimit - timeSpent) / 60
        )} minutes left.`,
      });
    }

    // Block when time limit is reached
    if (timeSpent >= timeLimit) {
      try {
        // Notify all Facebook tabs that limit is reached
        const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });

        for (const tab of tabs) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              action: "timeLimitReached",
            });
          } catch (tabError) {
            console.error(`Error sending message to tab ${tab.id}:`, tabError);

            // Fallback method: redirect if messaging fails
            try {
              await chrome.tabs.update(tab.id, {
                url:
                  chrome.runtime.getURL("blocked.html") ||
                  "data:text/html,<h1>Time Limit Reached</h1><p>You've reached your daily Facebook limit.</p>",
              });
            } catch (redirectError) {
              console.error(`Error redirecting tab ${tab.id}:`, redirectError);
            }
          }
        }
      } catch (queryError) {
        console.error("Error querying Facebook tabs:", queryError);
      }
    }
  } catch (error) {
    console.error("Error in checkTimeLimit:", error);
  }
};

// Track Facebook tabs being opened
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.url.includes("facebook.com") && details.frameId === 0) {
    // Track this tab (initially assume not active until content script reports)
    activeTabsMap.set(details.tabId, false);
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

    // Log the visibility change for debugging
    console.log(
      `Tab ${tabId} visibility changed to ${isActive}`,
      message.source || "unknown source",
      message.timestamp ? new Date(message.timestamp).toISOString() : ""
    );

    // Update the active tabs map
    activeTabsMap.set(tabId, isActive);

    // Check current timeSpent for debugging
    console.log(`Current timeSpent before update: ${timeSpent} seconds`);

    // Log active tabs for debugging
    const activeTabs = Array.from(activeTabsMap.entries())
      .filter(([_, active]) => active)
      .map(([id, _]) => id);

    console.log(`Active Facebook tabs: ${activeTabs.length}`, activeTabs);

    // Send a response to acknowledge receipt of the visibility change
    sendResponse({
      received: true,
      tabActive: isActive,
      timeSpent: timeSpent,
      activeTabs: activeTabs.length,
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

  // Handle time limit update from popup
  if (message.action === "setTimeLimit") {
    // Make sure we have a valid number
    const newLimitMinutes = parseInt(message.timeLimit, 10) || 30;
    timeLimit = newLimitMinutes * 60; // Convert minutes to seconds

    console.log(
      `Setting new time limit: ${newLimitMinutes} minutes (${timeLimit} seconds)`
    );

    chrome.storage.local
      .set({ timeLimit })
      .then(() => {
        console.log("Time limit updated successfully:", timeLimit);
        sendResponse({ status: "Time limit updated", timeLimit: timeLimit });
      })
      .catch((error) => {
        console.error("Error saving time limit:", error);
        sendResponse({ status: "Error: " + error.message });
      });
    return true; // Required for async response
  }

  // Handle manual time reset from popup
  if (message.action === "resetTime") {
    try {
      timeSpent = 0;
      lastResetDate = new Date().toDateString();

      chrome.storage.local
        .set({ timeSpent, lastResetDate })
        .then(() => {
          console.log("Time counter manually reset");
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error("Error resetting time:", error);
          sendResponse({ success: false, error: error.message });
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
      // Reset all values to defaults
      timeSpent = 0;
      timeLimit = 30 * 60; // 30 minutes in seconds
      lastResetDate = new Date().toDateString();

      // Clear and reset storage
      chrome.storage.local
        .clear()
        .then(() => {
          return chrome.storage.local.set({
            timeSpent,
            timeLimit,
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
