document.addEventListener("DOMContentLoaded", () => {
  // Update display with current stats
  updateDisplay();

  // Refresh stats every second
  setInterval(updateDisplay, 1000);

  // Add debug info when popup opens
  if (typeof updateDebugInfo === "function") {
    updateDebugInfo();
  }

  // Add refresh button functionality
  document.getElementById("refreshButton").addEventListener("click", () => {
    if (typeof updateDebugInfo === "function") {
      updateDebugInfo();
    }
    updateDisplay();

    const refreshMsg = document.createElement("span");
    refreshMsg.textContent = " Stats refreshed!";
    refreshMsg.style.color = "green";
    document.getElementById("refreshButton").appendChild(refreshMsg);

    setTimeout(() => {
      if (refreshMsg.parentNode) {
        refreshMsg.parentNode.removeChild(refreshMsg);
      }
    }, 1500);
  });

  // Add reset settings button functionality
  document
    .getElementById("resetSettingsButton")
    .addEventListener("click", () => {
      if (
        confirm("WARNING: This will reset ALL settings to defaults. Continue?")
      ) {
        sendMessageWithRetry({ action: "resetAllSettings" }, (response) => {
          if (response && response.success) {
            document.getElementById("timeLimit").value = 30;
            updateDisplay();

            const status = document.createElement("div");
            status.textContent = "All settings have been reset to defaults";
            status.style.color = "green";
            status.style.textAlign = "center";
            status.style.marginTop = "10px";
            document.body.appendChild(status);

            setTimeout(() => {
              if (status.parentNode) {
                status.parentNode.removeChild(status);
              }
            }, 3000);
          } else if (response && response.error) {
            alert("Error resetting settings: " + response.error);
          }
        });
      }
    });

  // Add reset time button functionality
  document.getElementById("resetTimeButton").addEventListener("click", () => {
    if (
      confirm("Are you sure you want to reset your Facebook time for today?")
    ) {
      sendMessageWithRetry({ action: "resetTime" }, (response) => {
        if (response && response.success) {
          updateDisplay();
          if (typeof updateDebugInfo === "function") {
            updateDebugInfo();
          }

          const status = document.createElement("div");
          status.textContent = "Time counter has been reset!";
          status.style.color = "green";
          status.style.textAlign = "center";
          status.style.marginTop = "10px";
          document.body.appendChild(status);

          setTimeout(() => {
            if (status.parentNode) {
              status.parentNode.removeChild(status);
            }
          }, 3000);
        } else if (response && response.error) {
          alert("Error resetting time: " + response.error);
        }
      });
    }
  });

  // Save new time limit
  document.getElementById("saveButton").addEventListener("click", () => {
    const timeLimitInput = document.getElementById("timeLimit");
    let timeLimit = parseInt(timeLimitInput.value, 10);

    if (timeLimit >= 1 && timeLimit <= 240) {
      console.log(
        `Saving new time limit: ${timeLimit} minutes (${
          timeLimit * 60
        } seconds)`
      );

      // Prevent rapid clicking
      const saveButton = document.getElementById("saveButton");
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";

      // Force update the input value to ensure it shows the correct value
      timeLimitInput.value = timeLimit;

      sendMessageWithRetry(
        { action: "setTimeLimit", timeLimit },
        (response) => {
          // Re-enable button
          saveButton.disabled = false;
          saveButton.textContent = "Save Limit";

          if (response && !response.error) {
            console.log("Save response:", response);

            // Add a saved feedback directly in the popup
            const status = document.createElement("div");
            status.textContent = `Time limit set to ${timeLimit} minutes`;
            status.style.color = "green";
            status.style.textAlign = "center";
            status.style.marginTop = "10px";
            document.body.appendChild(status);

            // Remove the message after 3 seconds
            setTimeout(() => {
              if (status.parentNode) {
                status.parentNode.removeChild(status);
              }
            }, 3000);
          } else if (response && response.error) {
            alert("Error saving time limit: " + response.error);
          }
        }
      );
    } else {
      alert("Please enter a time limit between 1 and 240 minutes.");
    }
  });
});

// Helper function to check if extension context is valid
function isExtensionContextValid() {
  return chrome.runtime && chrome.runtime.id;
}

// Function to safely send messages with error handling
function sendMessageWithRetry(message, callback, retryCount = 0) {
  if (!isExtensionContextValid()) {
    console.error("Extension context invalid, cannot send message");
    if (retryCount < 3) {
      console.log(`Will retry in ${(retryCount + 1) * 500}ms...`);
      setTimeout(
        () => sendMessageWithRetry(message, callback, retryCount + 1),
        (retryCount + 1) * 500
      );
    } else {
      if (typeof callback === "function") {
        callback({ error: "Extension context invalid after retries" });
      }
    }
    return;
  }

  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Communication error:", chrome.runtime.lastError.message);
        if (retryCount < 3) {
          console.log(`Will retry in ${(retryCount + 1) * 500}ms...`);
          setTimeout(
            () => sendMessageWithRetry(message, callback, retryCount + 1),
            (retryCount + 1) * 500
          );
        } else {
          if (typeof callback === "function") {
            callback({ error: chrome.runtime.lastError.message });
          }
        }
      } else {
        if (typeof callback === "function") {
          callback(response);
        }
      }
    });
  } catch (error) {
    console.error("Error sending message:", error);
    if (typeof callback === "function") {
      callback({ error: error.message });
    }
  }
}

// Function to update the display with latest data
function updateDisplay() {
  if (!isExtensionContextValid()) {
    console.error("Extension context invalid during updateDisplay");
    document.getElementById("timeSpent").textContent = "--:--";
    document.getElementById("timeLimit").value = "30";

    // Show error message
    const errorMsg =
      document.getElementById("errorMessage") || document.createElement("div");
    errorMsg.id = "errorMessage";
    errorMsg.textContent =
      "Extension context invalidated. Please refresh the popup.";
    errorMsg.style.color = "red";
    errorMsg.style.marginTop = "10px";
    errorMsg.style.textAlign = "center";

    if (!document.getElementById("errorMessage")) {
      document.body.appendChild(errorMsg);
    }

    return;
  }

  // Clear any error message if context is valid
  const errorMsg = document.getElementById("errorMessage");
  if (errorMsg && errorMsg.parentNode) {
    errorMsg.parentNode.removeChild(errorMsg);
  }

  chrome.storage.local.get(
    ["timeSpent", "timeLimit", "lastResetDate"],
    (data) => {
      // Make sure we have numeric values
      const timeSpentSecs =
        typeof data.timeSpent === "number" ? data.timeSpent : 0;

      // Display time spent in mm:ss format
      const timeSpentMinutes = Math.floor(timeSpentSecs / 60);
      const timeSpentSeconds = timeSpentSecs % 60;
      document.getElementById("timeSpent").textContent = `${timeSpentMinutes}:${
        timeSpentSeconds < 10 ? "0" : ""
      }${timeSpentSeconds}`;

      // Log current time values for debugging
      console.log(
        `Time spent: ${timeSpentSecs}s (${timeSpentMinutes}m ${timeSpentSeconds}s)`
      );

      // Display time limit (in minutes) - make sure we always have a valid number
      const timeLimitSecs = data.timeLimit;
      let timeLimitMins = 30; // Default value if not set

      if (typeof timeLimitSecs === "number" && timeLimitSecs > 0) {
        timeLimitMins = Math.floor(timeLimitSecs / 60);
      }

      console.log(
        `Time limit from storage: ${timeLimitSecs}s (${timeLimitMins}m)`
      );

      // Only update the input value if it's not currently focused (to prevent overriding user input)
      const timeLimitInput = document.getElementById("timeLimit");
      if (timeLimitInput && document.activeElement !== timeLimitInput) {
        timeLimitInput.value = timeLimitMins;
      }

      // Update progress bar if it exists
      const progressBar = document.getElementById("timeProgress");
      if (progressBar) {
        const progressPercent = Math.min(
          100,
          (timeSpentSecs / timeLimitSecs) * 100
        );
        progressBar.style.width = `${progressPercent}%`;

        // Update progress bar color based on usage
        if (progressPercent >= 90) {
          progressBar.className = "progress-bar danger";
        } else if (progressPercent >= 75) {
          progressBar.className = "progress-bar warning";
        } else {
          progressBar.className = "progress-bar";
        }
      }

      // Show time remaining if element exists
      const timeRemaining = document.getElementById("timeRemaining");
      if (timeRemaining) {
        const secondsRemaining = Math.max(0, timeLimitSecs - timeSpentSecs);
        const minutesRemaining = Math.floor(secondsRemaining / 60);
        const secondsRemainingDisplay = secondsRemaining % 60;

        timeRemaining.textContent = `${minutesRemaining}:${
          secondsRemainingDisplay < 10 ? "0" : ""
        }${secondsRemainingDisplay} remaining today`;
      }

      // Show last reset date if available
      if (data.lastResetDate) {
        const lastReset = new Date(data.lastResetDate).toLocaleDateString();

        // Create or update the reset date element
        let resetElem = document.getElementById("resetDate");
        if (!resetElem) {
          resetElem = document.createElement("p");
          resetElem.id = "resetDate";
          document
            .querySelector("h1")
            .insertAdjacentElement("afterend", resetElem);
        }
        resetElem.textContent = `Stats last reset: ${lastReset}`;
      }
    }
  );
}

// Debug storage directly - for troubleshooting
function debugStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => {
      console.log("STORAGE DEBUG:", data);
      resolve(data);
    });
  });
}

// Update debug information
function updateDebugInfo() {
  const debugElement = document.getElementById("debugInfo");

  // Call our debug function
  debugStorage().then(() => {});

  chrome.storage.local.get(null, (allData) => {
    console.log("All storage data:", allData);

    // Format time data for display
    const timeSpentSecs = allData.timeSpent || 0;
    const timeSpentMins = Math.floor(timeSpentSecs / 60);
    const timeSpentSecs_remainder = timeSpentSecs % 60;

    const timeLimitSecs = allData.timeLimit || 30 * 60;
    const timeLimitMins = Math.floor(timeLimitSecs / 60);

    chrome.tabs.query({ url: "*://*.facebook.com/*" }, (tabs) => {
      console.log("Current Facebook tabs:", tabs);

      // Initialize debug HTML with basic info (will be updated with active tab info)
      let debugHTML = `
        <div>
          <strong>Storage Info:</strong><br>
          Time Spent: ${timeSpentMins}m ${timeSpentSecs_remainder}s (${timeSpentSecs} seconds)<br>
          Time Limit: ${timeLimitMins}m (${timeLimitSecs} seconds)<br>
          Last Reset: ${allData.lastResetDate || "None"}<br>
          <strong>Facebook Tabs:</strong> ${
            tabs.length
          } (loading active count...)<br>
          <button id="refreshTimeButton" style="margin-top:5px;font-size:12px;">Force Time Update</button>
        </div>
      `;

      // Set initial content
      debugElement.innerHTML = debugHTML;

      // Add click handler for the force update button
      const refreshButton = document.getElementById("refreshTimeButton");
      if (refreshButton) {
        refreshButton.addEventListener("click", () => {
          sendMessageWithRetry({ action: "forceTimeUpdate" }, (response) => {
            if (response?.success) {
              updateDisplay();
              updateDebugInfo();
              alert("Time counter updated!");
            }
          });
        });
      }

      // Try to get active tabs information from background script
      try {
        chrome.runtime.sendMessage(
          { action: "getActiveTabsInfo" },
          (activeTabsInfo) => {
            // Only update if we got a valid response
            if (activeTabsInfo && !chrome.runtime.lastError) {
              const activeTabsCount = activeTabsInfo.activeTabs?.length || 0;

              // Update the debug HTML with active tab count
              const updatedDebugHTML = `
              <div>
                <strong>Storage Info:</strong><br>
                Time Spent: ${timeSpentMins}m ${timeSpentSecs_remainder}s (${timeSpentSecs} seconds)<br>
                Time Limit: ${timeLimitMins}m (${timeLimitSecs} seconds)<br>
                Last Reset: ${allData.lastResetDate || "None"}<br>
                <strong>Facebook Tabs:</strong> ${
                  tabs.length
                } (${activeTabsCount} active)<br>
                <button id="refreshTimeButton" style="margin-top:5px;font-size:12px;">Force Time Update</button>
              </div>
            `;

              // Update the content
              debugElement.innerHTML = updatedDebugHTML;

              // Re-add click handler since we replaced the HTML
              const refreshButton =
                document.getElementById("refreshTimeButton");
              if (refreshButton) {
                refreshButton.addEventListener("click", () => {
                  sendMessageWithRetry(
                    { action: "forceTimeUpdate" },
                    (response) => {
                      if (response?.success) {
                        updateDisplay();
                        updateDebugInfo();
                        alert("Time counter updated!");
                      }
                    }
                  );
                });
              }
            }
          }
        );
      } catch (error) {
        console.error("Error getting active tabs info:", error);
      }
    });
  });
}
