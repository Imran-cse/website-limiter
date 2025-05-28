// Constants for reconnection system
const RECONNECT_CHECK_INTERVAL = 5000; // Increased from 3000 to 5000
const RECOVERY_CHECK_INTERVAL = 2000; // Increased from 1000 to 2000
const MAX_RECOVERY_ATTEMPTS = 10;
let mainCheckInterval = null;
let recoveryCheckInterval = null;
let recoveryAttempts = 0;
let lastRecoveryTime = 0;

// Add autoReload function to handle extension context invalidation
function setupAutoReload() {
  // Clear any existing intervals to avoid duplicates
  if (mainCheckInterval) clearInterval(mainCheckInterval);
  if (recoveryCheckInterval) clearInterval(recoveryCheckInterval);

  // Reset recovery attempts
  recoveryAttempts = 0;

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
          // Use a timeout to prevent hanging if message port is stuck
          const timeoutId = setTimeout(() => {
            console.warn("Context validation ping timed out");
            if (!recoveryCheckInterval) {
              startRecoveryMode();
            }
          }, 3000);

          chrome.runtime.sendMessage(
            {
              action: "ping",
              source: "reconnect.js",
              timestamp: Date.now(),
              url: window.location.href,
            },
            (response) => {
              // Clear the timeout as we got a response
              clearTimeout(timeoutId);

              if (chrome.runtime.lastError) {
                console.warn(
                  "Context check failed:",
                  chrome.runtime.lastError.message
                );
                // Start recovery if not already running
                if (!recoveryCheckInterval) {
                  startRecoveryMode();
                }
              } else {
                // Successfully got a response
                console.log("Extension context validated successfully");

                // If we just recovered from a failure, reset the system
                if (recoveryAttempts > 0) {
                  console.log("Fully recovered from invalid context state");
                  recoveryAttempts = 0;
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
  recoveryAttempts++;
  lastRecoveryTime = Date.now();

  // Try to detect when extension becomes valid again
  recoveryCheckInterval = setInterval(() => {
    try {
      // Check if we've been trying to recover for too long
      const timeInRecovery = (Date.now() - lastRecoveryTime) / 1000;

      // If we've exceeded the maximum number of recovery attempts, try a different approach
      if (recoveryAttempts > MAX_RECOVERY_ATTEMPTS) {
        console.log(
          `Exceeded ${MAX_RECOVERY_ATTEMPTS} recovery attempts. Time in recovery: ${timeInRecovery}s`
        );

        // Clear the recovery interval
        clearInterval(recoveryCheckInterval);
        recoveryCheckInterval = null;

        // Try to restart the main check
        console.log("Restarting main check interval");
        setupAutoReload();

        return;
      }

      // Check if chrome runtime is valid
      if (chrome && chrome.runtime && chrome.runtime.id) {
        console.log("Extension context recovered in reconnect.js!");

        // Stop recovery mode
        clearInterval(recoveryCheckInterval);
        recoveryCheckInterval = null;

        // Try to send a test message to verify recovery
        try {
          chrome.runtime.sendMessage(
            {
              action: "recoveryTest",
              timestamp: Date.now(),
              recoveryAttempts: recoveryAttempts,
              recoveryTime: timeInRecovery,
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn("Recovery test failed:", chrome.runtime.lastError);
                // Restart recovery if the test failed
                startRecoveryMode();
              } else {
                console.log("Recovery test successful:", response);

                // Notify content script of recovery
                if (
                  window.attemptReconnection &&
                  typeof window.attemptReconnection === "function"
                ) {
                  console.log("Calling attemptReconnection from reconnect.js");
                  window.attemptReconnection();
                } else if (
                  window.setupVisibilityTracking &&
                  typeof window.setupVisibilityTracking === "function"
                ) {
                  // Re-initialize everything
                  window.setupVisibilityTracking();

                  if (
                    window.setupMessageListener &&
                    typeof window.setupMessageListener === "function"
                  ) {
                    window.setupMessageListener();
                  }

                  // Send current status if we can
                  if (
                    window.checkWindowActive &&
                    typeof window.checkWindowActive === "function" &&
                    window.updateBackgroundScript &&
                    typeof window.updateBackgroundScript === "function"
                  ) {
                    const isPageActive = window.checkWindowActive();
                    window.updateBackgroundScript(isPageActive);
                  }
                }

                // Reset recovery attempts
                recoveryAttempts = 0;

                // Restart the main check interval
                setupAutoReload();
              }
            }
          );
        } catch (err) {
          console.warn("Error during recovery test:", err);
          startRecoveryMode();
        }
      }
    } catch (err) {
      console.warn("Still waiting for extension context recovery...", err);
      recoveryAttempts++;
    }
  }, RECOVERY_CHECK_INTERVAL);
}

// Function to force reload the page as a last resort
function forceReloadPage() {
  console.warn("Force reloading page to recover extension context");

  try {
    // Try to store a timestamp to prevent excessive reloads
    const lastReloadKey = "wb_last_extension_reload";
    const currentTime = Date.now();
    const lastReload = parseInt(sessionStorage.getItem(lastReloadKey) || "0");

    // Don't reload if we've reloaded in the last 5 minutes
    if (currentTime - lastReload < 5 * 60 * 1000) {
      console.log("Page was reloaded too recently, waiting longer");
      return;
    }

    // Store the current time
    sessionStorage.setItem(lastReloadKey, currentTime.toString());

    // Reload without cache
    window.location.reload(true);
  } catch (err) {
    console.error("Error during forced reload:", err);
    // Try a simple reload as fallback
    window.location.reload();
  }
}

// Listen for window unload to clean up
window.addEventListener("beforeunload", () => {
  if (mainCheckInterval) clearInterval(mainCheckInterval);
  if (recoveryCheckInterval) clearInterval(recoveryCheckInterval);
});

// Initialize auto-reload system
setupAutoReload();
