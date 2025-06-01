// Set up visibility detection as early as possible
let isPageActive = true; // Default to active until we can determine otherwise
let lastPingTime = Date.now();
let pingInterval;
const PING_FREQUENCY = 5000; // Check active status every 5 seconds

// Function to determine if window is actually visible/focused
function checkWindowActive() {
  return !document.hidden;
}

// Initial setup - determine the actual state right away
isPageActive = checkWindowActive();

// Send initial visibility status immediately
try {
  chrome.runtime.sendMessage({
    action: "visibilityChange",
    isActive: isPageActive,
    source: "initial",
    focused: document.hasFocus(),
    hidden: document.hidden,
    url: window.location.href,
  });

  console.log("Initial visibility state:", isPageActive);
  lastPingTime = Date.now();
} catch (e) {
  console.error("Initial visibility update failed:", e);
}

// Variables for reconnection handling
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 2000;
let reconnectionTimer = null;

// Function to attempt reconnection with background script
function attemptReconnection() {
  // Clear any existing timer to avoid multiple reconnection attempts
  if (reconnectionTimer) {
    clearTimeout(reconnectionTimer);
    reconnectionTimer = null;
  }

  reconnectAttempts++;
  console.log(
    `Attempting reconnection (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
  );

  // Store reconnection start time in sessionStorage to track across page refreshes
  try {
    sessionStorage.setItem(
      "wtl_reconnect_attempts",
      reconnectAttempts.toString()
    );
    sessionStorage.setItem("wtl_last_reconnect_time", Date.now().toString());
  } catch (e) {
    // Ignore storage errors
  }

  if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
    // Use exponential backoff for retry timing
    const delay = Math.min(
      RECONNECT_DELAY_MS *
        Math.pow(1.5, reconnectAttempts - 1) *
        (0.9 + Math.random() * 0.2),
      30000
    );

    try {
      // Check if chrome runtime exists and has an ID (extension context is valid)
      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.id
      ) {
        console.log(
          "Chrome runtime exists, attempting to ping background script..."
        );

        // Send a ping message to check connection
        try {
          chrome.runtime.sendMessage(
            {
              action: "ping",
              timestamp: Date.now(),
              reconnectAttempt: reconnectAttempts,
            },
            (response) => {
              // Immediately check for lastError to avoid uncaught errors
              const lastError = chrome.runtime.lastError;

              if (lastError) {
                console.warn("Reconnection ping failed:", lastError.message);
                // Schedule another attempt with increasing delay
                reconnectionTimer = setTimeout(attemptReconnection, delay);
              } else {
                console.log("Reconnection successful!", response);
                reconnectAttempts = 0;

                // Cleanup any existing intervals
                if (pingInterval) {
                  clearInterval(pingInterval);
                  pingInterval = null;
                }

                // Re-initialize everything
                setupVisibilityTracking();
                setupMessageListener();

                // Send current status
                isPageActive = checkWindowActive();
                updateBackgroundScript(isPageActive);
              }
            }
          );
        } catch (error) {
          console.error("Error during reconnection ping:", error);
          // Schedule another attempt
          reconnectionTimer = setTimeout(attemptReconnection, delay);
        }
      } else {
        console.warn(
          "Chrome runtime not available during reconnection attempt"
        );
        // Schedule another attempt
        reconnectionTimer = setTimeout(attemptReconnection, delay);
      }
    } catch (error) {
      console.error("Unexpected error during reconnection:", error);
      // Schedule another attempt
      reconnectionTimer = setTimeout(attemptReconnection, delay);
    }
  } else {
    console.error(
      "Max reconnection attempts reached. Will try again in 60 seconds."
    );
    // Reset counter and try again after a longer delay
    reconnectAttempts = 0;
    reconnectionTimer = setTimeout(attemptReconnection, 60000);
  }
}

// Function to safely send visibility updates to background script
const updateBackgroundScript = (isActive) => {
  try {
    // Check if runtime is available before sending message
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(
        {
          action: "visibilityChange",
          isActive: isActive,
          tabUrl: window.location.href,
          timestamp: Date.now(),
          focused: document.hasFocus(),
          hidden: document.hidden,
        },
        // Add response callback to catch errors
        (response) => {
          // Check for chrome.runtime.lastError immediately to avoid uncaught error
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            console.warn("Communication error:", lastError.message);

            // Check if it's an invalidated context error
            if (
              lastError.message &&
              lastError.message.includes("Extension context invalidated")
            ) {
              console.log(
                "Extension context invalidated in callback, attempting reconnection..."
              );
              window.setTimeout(attemptReconnection, 100); // Slight delay for stability
            }
          } else {
            // Reset reconnect attempts on successful communication
            reconnectAttempts = 0;
            console.log("Visibility status sent:", isActive);
            lastPingTime = Date.now();
          }
        }
      );
    } else {
      console.warn(
        "Chrome runtime not available, extension might have been reloaded"
      );
      // Try to reconnect
      attemptReconnection();
    }
  } catch (error) {
    console.error("Error sending visibility update:", error);

    // If this is an "Extension context invalidated" error,
    // we can try to reconnect
    if (
      error.message &&
      error.message.includes("Extension context invalidated")
    ) {
      console.log(
        "Extension context invalidated in try-catch, attempting reconnection..."
      );
      // Use setTimeout to avoid call stack issues
      window.setTimeout(attemptReconnection, 100);
    }
  }
};

// Set up all the visibility events we need to track
function setupVisibilityTracking() {
  // Track document visibility changes
  document.addEventListener(
    "visibilitychange",
    () => {
      const newActiveState = checkWindowActive();
      if (isPageActive !== newActiveState) {
        isPageActive = newActiveState;
        console.log("Visibility changed:", isPageActive);
        updateBackgroundScript(isPageActive);
      }
    },
    { passive: true }
  );

  // Track window focus/blur
  window.addEventListener(
    "focus",
    () => {
      const newActiveState = checkWindowActive();
      if (isPageActive !== newActiveState) {
        isPageActive = newActiveState;
        console.log("Window focused:", isPageActive);
        updateBackgroundScript(isPageActive);
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "blur",
    () => {
      const newActiveState = checkWindowActive();
      if (isPageActive !== newActiveState) {
        isPageActive = newActiveState;
        console.log("Window blurred:", isPageActive);
        updateBackgroundScript(isPageActive);
      }
    },
    { passive: true }
  );

  // Set up heartbeat to ensure the background script knows we're active
  pingInterval = setInterval(() => {
    // Check if extension context is still valid
    if (!chrome.runtime || !chrome.runtime.id) {
      console.warn("Extension context invalidated detected in heartbeat");
      // We'll let the reconnection system handle this
      return;
    }

    // Get current state
    const currentState = checkWindowActive();

    // Always send a status update every PING_FREQUENCY milliseconds
    // This ensures the background script always knows if we're active
    console.log(
      `Heartbeat: Tab is ${currentState ? "active" : "inactive"}, last ping ${
        (Date.now() - lastPingTime) / 1000
      }s ago`
    );

    // Update state if changed
    if (currentState !== isPageActive) {
      console.log(`State changed from ${isPageActive} to ${currentState}`);
      isPageActive = currentState;
    }

    // Send update regardless of state change (regular heartbeat)
    updateBackgroundScript(isPageActive);
  }, PING_FREQUENCY);
}

// Set up tracking immediately
setupVisibilityTracking();

// Set up message listener immediately
setupMessageListener();

// When DOM is fully loaded, send another update to confirm status
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, rechecking status");

  // Recheck status now that the DOM is fully loaded
  isPageActive = checkWindowActive();
  updateBackgroundScript(isPageActive);
});

// Add a global error handler to catch extension context invalidation errors
window.addEventListener("error", (event) => {
  if (
    event &&
    event.error &&
    event.error.message &&
    event.error.message.includes("Extension context invalidated")
  ) {
    console.log(
      "Caught extension context invalidation in global error handler"
    );
    window.setTimeout(attemptReconnection, 500);

    // Prevent the error from showing in the console
    event.preventDefault();
  }
});

// Setup message listener function
function setupMessageListener() {
  try {
    if (chrome.runtime && chrome.runtime.id) {
      // Remove any existing listeners first to avoid duplicates
      try {
        if (chrome.runtime.onMessage.hasListeners()) {
          chrome.runtime.onMessage.removeListener(handleBackgroundMessage);
        }
      } catch (listenerError) {
        console.warn("Error removing existing listeners:", listenerError);
        // Continue anyway, as we want to add our listener
      }

      // Add the listener
      chrome.runtime.onMessage.addListener(handleBackgroundMessage);
      console.log("Message listener set up successfully");
      return true;
    } else {
      console.warn("Chrome runtime not available, cannot set up listener");
      return false;
    }
  } catch (error) {
    console.error("Error setting up message listener:", error);

    // Try again after a delay if the extension context was invalidated
    if (
      error.message &&
      error.message.includes("Extension context invalidated")
    ) {
      console.log(
        "Will try to reconnect message listener when reconnection happens"
      );
    }
    return false;
  }
}

// Handle messages from background script
function handleBackgroundMessage(message, sender, sendResponse) {
  try {
    if (message.action === "timeLimitReached") {
      const domain = message.domain || new URL(window.location.href).hostname;

      // Create URL to the blocked.html page with the domain as a parameter
      const blockedUrl =
        chrome.runtime.getURL("blocked.html") +
        `?domain=${encodeURIComponent(domain)}`;

      // Redirect to the blocked page instead of injecting HTML
      console.log(
        `Time limit reached for ${domain}, redirecting to blocked page`
      );
      window.location.href = blockedUrl;

      // Acknowledge receipt of message
      if (sendResponse) {
        sendResponse({ status: "blocked", domain: domain });
      }
    } else if (message.action === "domainNowTracked") {
      console.log(`This domain (${message.domain}) is now being tracked`);

      // Immediately send current visibility state to start tracking
      isPageActive = checkWindowActive();
      updateBackgroundScript(isPageActive);

      // Acknowledge receipt
      if (sendResponse) {
        sendResponse({ status: "acknowledged", domain: message.domain });
      }
    } else if (message.action === "startTracking") {
      console.log(`Starting active tracking for ${message.domain}`);

      // Force a status update to background script
      isPageActive = checkWindowActive();

      // Send update with additional flag to ensure immediate tracking
      chrome.runtime.sendMessage(
        {
          action: "visibilityChange",
          isActive: isPageActive,
          tabUrl: window.location.href,
          timestamp: Date.now(),
          focused: document.hasFocus(),
          hidden: document.hidden,
          forceTrack: true, // Special flag to force tracking
        },
        (response) => {
          console.log("Force tracking response:", response);
        }
      );

      // Acknowledge receipt
      if (sendResponse) {
        sendResponse({
          status: "tracking_started",
          domain: message.domain,
          isActive: isPageActive,
        });
      }
    }
  } catch (error) {
    console.error("Error handling background message:", error);
    if (sendResponse) {
      sendResponse({ error: error.message });
    }
  }

  // Return true to indicate we'll send a response asynchronously
  return true;
}
