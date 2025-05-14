// Constants for reconnection system
const RECONNECT_CHECK_INTERVAL = 3000; // Check every 3 seconds
const RECOVERY_CHECK_INTERVAL = 1000; // Check every 1 second during recovery
let mainCheckInterval = null;
let recoveryCheckInterval = null;

// Add autoReload function to handle extension context invalidation
function setupAutoReload() {
  // Clear any existing intervals to avoid duplicates
  if (mainCheckInterval) clearInterval(mainCheckInterval);
  if (recoveryCheckInterval) clearInterval(recoveryCheckInterval);

  // Check extension context validity periodically
  mainCheckInterval = setInterval(() => {
    try {
      // First check if chrome exists (in case of complete extension failure)
      if (typeof chrome === "undefined") {
        console.warn(
          "Chrome API not available, cannot check extension context"
        );
        return;
      }

      // Then check if runtime exists and has valid ID
      if (!chrome.runtime || !chrome.runtime.id) {
        console.warn(
          "Extension context appears to be invalid, waiting for recovery"
        );

        // Start recovery mode if not already running
        if (!recoveryCheckInterval) {
          startRecoveryMode();
        }
      } else {
        // Chrome runtime exists and seems valid
        // Test it with a ping to make sure it's really working
        try {
          chrome.runtime.sendMessage(
            { action: "ping", source: "reconnect.js" },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn(
                  "Context check failed:",
                  chrome.runtime.lastError.message
                );
                // Start recovery if not already running
                if (!recoveryCheckInterval) {
                  startRecoveryMode();
                }
              }
            }
          );
        } catch (err) {
          console.warn("Error during context validation ping:", err);
          // Start recovery if not already running
          if (!recoveryCheckInterval) {
            startRecoveryMode();
          }
        }
      }
    } catch (err) {
      console.warn("Error during context validation:", err);
    }
  }, RECONNECT_CHECK_INTERVAL);
}

// Start recovery mode to detect when extension becomes valid again
function startRecoveryMode() {
  // Stop the main check as we're in recovery mode
  if (mainCheckInterval) {
    clearInterval(mainCheckInterval);
    mainCheckInterval = null;
  }

  // Clear any existing recovery interval
  if (recoveryCheckInterval) {
    clearInterval(recoveryCheckInterval);
  }

  console.log("Entering extension recovery mode...");

  // Try to detect when extension becomes valid again
  recoveryCheckInterval = setInterval(() => {
    try {
      if (chrome && chrome.runtime && chrome.runtime.id) {
        console.log("Extension context recovered in reconnect.js!");

        // Stop recovery mode
        clearInterval(recoveryCheckInterval);
        recoveryCheckInterval = null;

        // Notify content script of recovery
        if (typeof attemptReconnection === "function") {
          console.log("Calling attemptReconnection from reconnect.js");
          attemptReconnection();
        } else if (typeof setupVisibilityTracking === "function") {
          // Re-initialize everything
          setupVisibilityTracking();
          setupMessageListener();

          // Send current status if we can
          if (
            typeof checkWindowActive === "function" &&
            typeof updateBackgroundScript === "function"
          ) {
            const isPageActive = checkWindowActive();
            updateBackgroundScript(isPageActive);
          }
        }

        // Restart the main check interval
        setupAutoReload();
      }
    } catch (err) {
      console.warn("Still waiting for extension context recovery...", err);
    }
  }, RECOVERY_CHECK_INTERVAL);
}

// Initialize auto-reload system
setupAutoReload();
