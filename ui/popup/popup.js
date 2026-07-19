document.addEventListener("DOMContentLoaded", () => {
  // Initialize website selector and current website
  let currentWebsite = "";

  // Populate website selector dropdown from storage
  populateWebsiteSelector();

  // Update display with current stats
  updateDisplay();

  // Refresh stats every second
  setInterval(updateDisplay, 1000);

  // Add debug info when popup opens
  if (typeof updateDebugInfo === "function") {
    updateDebugInfo();
  }

  // Handle website selection change
  document
    .getElementById("websiteSelect")
    .addEventListener("change", function () {
      currentWebsite = this.value;
      updateDisplay();
    });

  // Handle adding the current website
  document.getElementById("addCurrentButton").addEventListener("click", () => {
    getCurrentTab().then((tab) => {
      if (tab && tab.url) {
        const domain = extractDomain(tab.url);
        if (domain) {
          // Default time limit is 30 minutes
          addWebsite(domain, 30);
        } else {
          showNotification("Could not determine website domain", "error");
        }
      } else {
        showNotification("Could not access current tab", "error");
      }
    });
  });

  // Handle adding a new website
  document.getElementById("addWebsiteButton").addEventListener("click", (e) => {
    e.preventDefault();
    const websiteInput = document.getElementById("newWebsiteDomain");
    const timeLimitInput = document.getElementById("newWebsiteLimit");

    let website = websiteInput.value.trim();
    const timeLimit = parseInt(timeLimitInput.value, 10);

    // Simple validation
    if (!website) {
      showNotification("Please enter a website domain", "error");
      return;
    }

    // Add protocol if not present for URL parsing
    if (!website.includes("://")) {
      website = "http://" + website;
    }

    try {
      const domain = extractDomain(website);
      if (domain && timeLimit >= 1 && timeLimit <= 480) {
        addWebsite(domain, timeLimit);
        websiteInput.value = "";
        timeLimitInput.value = "30";
      } else {
        showNotification(
          "Please enter a valid domain and time limit (1-480 minutes)",
          "error"
        );
      }
    } catch (e) {
      console.error("Error parsing website:", e);
      showNotification("Please enter a valid website domain", "error");
    }
  });

  // Handle removing selected website
  document
    .getElementById("removeWebsiteButton")
    .addEventListener("click", () => {
      const selectedWebsite = document.getElementById("websiteSelect").value;

      if (selectedWebsite) {
        if (
          confirm(
            `Are you sure you want to remove "${selectedWebsite}" from tracking?`
          )
        ) {
          sendMessageWithRetry(
            { action: "removeWebsite", domain: selectedWebsite },
            (response) => {
              if (response && response.success) {
                populateWebsiteSelector();
                showNotification(
                  `Removed "${selectedWebsite}" from tracking`,
                  "success"
                );
              } else if (response && response.error) {
                showNotification(`Error: ${response.error}`, "error");
              }
            }
          );
        }
      } else {
        showNotification("Please select a website to remove", "error");
      }
    });

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
            populateWebsiteSelector();
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
    const selectedWebsite = document.getElementById("websiteSelect").value;

    if (!selectedWebsite) {
      showNotification("Please select a website first", "error");
      return;
    }

    if (
      confirm(
        `Are you sure you want to reset your time for ${selectedWebsite} today?`
      )
    ) {
      sendMessageWithRetry(
        { action: "resetWebsiteTime", domain: selectedWebsite },
        (response) => {
          if (response && response.success) {
            updateDisplay();
            if (typeof updateDebugInfo === "function") {
              updateDebugInfo();
            }

            showNotification(
              `Time counter for ${selectedWebsite} has been reset!`,
              "success"
            );
          } else if (response && response.error) {
            showNotification(
              `Error resetting time: ${response.error}`,
              "error"
            );
          }
        }
      );
    }
  });

  // Save new time limit
  document.getElementById("saveButton").addEventListener("click", () => {
    const selectedWebsite = document.getElementById("websiteSelect").value;
    if (!selectedWebsite) {
      showNotification("Please select a website first", "error");
      return;
    }

    const timeLimitInput = document.getElementById("timeLimit");
    let timeLimit = parseInt(timeLimitInput.value, 10);

    if (timeLimit >= 1 && timeLimit <= 480) {
      console.log(
        `Saving new time limit for ${selectedWebsite}: ${timeLimit} minutes (${
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
        { action: "updateWebsiteLimit", domain: selectedWebsite, timeLimit },
        (response) => {
          // Re-enable button
          saveButton.disabled = false;
          saveButton.textContent = "Save Limit";

          if (response && response.success) {
            console.log("Save response:", response);
            showNotification(
              `Time limit for ${selectedWebsite} set to ${timeLimit} minutes`,
              "success"
            );
          } else if (response && response.error) {
            showNotification(
              `Error saving time limit: ${response.error}`,
              "error"
            );
          }
        }
      );
    } else {
      alert("Please enter a time limit between 1 and 480 minutes.");
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

// Helper function to populate the website selector dropdown
function populateWebsiteSelector() {
  const selector = document.getElementById("websiteSelect");

  // Clear existing options except the default one
  while (selector.options.length > 1) {
    selector.remove(1);
  }

  chrome.storage.local.get(["websiteData"], (data) => {
    const websiteData = data.websiteData || {};

    // Add each website to the dropdown
    Object.keys(websiteData)
      .sort()
      .forEach((domain) => {
        const option = document.createElement("option");
        option.value = domain;
        option.textContent = domain;
        selector.appendChild(option);
      });

    // If we have websites but none selected, select the first one
    if (selector.options.length > 1 && !selector.value) {
      selector.selectedIndex = 1;
      // Trigger a change event to update the display
      const event = new Event("change");
      selector.dispatchEvent(event);
    }
  });
}

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

// Get the current active tab
async function getCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  } catch (e) {
    console.error("Error getting current tab:", e);
    return null;
  }
}

// Helper function to add a new website
function addWebsite(domain, timeLimit) {
  sendMessageWithRetry(
    {
      action: "addWebsite",
      domain: domain,
      timeLimit: timeLimit,
    },
    (response) => {
      if (response && response.success) {
        showNotification(
          `Added "${domain}" with ${timeLimit} minute limit`,
          "success"
        );
        populateWebsiteSelector();

        // Select the newly added website
        setTimeout(() => {
          const selector = document.getElementById("websiteSelect");
          for (let i = 0; i < selector.options.length; i++) {
            if (selector.options[i].value === domain) {
              selector.selectedIndex = i;
              // Trigger change event
              const event = new Event("change");
              selector.dispatchEvent(event);
              break;
            }
          }
        }, 100);
      } else if (response && response.error) {
        showNotification(`Error: ${response.error}`, "error");
      }
    }
  );
}

// Helper function to show notifications in the popup
function showNotification(message, type = "info") {
  const status = document.createElement("div");
  status.textContent = message;
  status.style.textAlign = "center";
  status.style.marginTop = "10px";
  status.style.padding = "5px";

  // Set color based on notification type
  switch (type) {
    case "success":
      status.style.color = "white";
      status.style.backgroundColor = "green";
      break;
    case "error":
      status.style.color = "white";
      status.style.backgroundColor = "red";
      break;
    case "warning":
      status.style.color = "black";
      status.style.backgroundColor = "yellow";
      break;
    default:
      status.style.color = "white";
      status.style.backgroundColor = "blue";
  }

  document.body.appendChild(status);

  // Remove the message after 3 seconds
  setTimeout(() => {
    if (status.parentNode) {
      status.parentNode.removeChild(status);
    }
  }, 3000);
}

// Function to update the display with latest data for the selected website
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

  // Get the selected website
  const selectedWebsite = document.getElementById("websiteSelect").value;

  // Enable or disable controls based on website selection
  const controls = document.querySelectorAll(
    ".website-controls button, .website-controls input"
  );
  controls.forEach((control) => {
    control.disabled = !selectedWebsite;
  });

  // Update site name display if available
  const siteNameDisplay = document.getElementById("currentWebsite");
  if (siteNameDisplay) {
    siteNameDisplay.textContent = selectedWebsite || "No website selected";
  }

  // If no website is selected, clear stats display
  if (!selectedWebsite) {
    document.getElementById("timeSpent").textContent = "--:--";
    document.getElementById("timeLimit").value = "30";

    const progressBar = document.getElementById("timeProgress");
    if (progressBar) {
      progressBar.style.width = "0%";
      progressBar.className = "progress-bar";
    }

    const timeRemaining = document.getElementById("timeRemaining");
    if (timeRemaining) {
      timeRemaining.textContent = "No data";
    }

    return;
  }

  chrome.storage.local.get(["websiteData", "lastResetDate"], (data) => {
    const websiteData = data.websiteData || {};
    const siteData = websiteData[selectedWebsite] || {
      timeSpent: 0,
      timeLimit: 1800,
    };

    // Make sure we have numeric values
    const timeSpentSecs =
      typeof siteData.timeSpent === "number" ? siteData.timeSpent : 0;
    const timeLimitSecs =
      typeof siteData.timeLimit === "number" ? siteData.timeLimit : 1800;

    // Display time spent in mm:ss format (timeSpent is fractional seconds)
    const timeSpentMinutes = Math.floor(timeSpentSecs / 60);
    const timeSpentSeconds = Math.floor(timeSpentSecs % 60);
    document.getElementById("timeSpent").textContent = `${timeSpentMinutes}:${
      timeSpentSeconds < 10 ? "0" : ""
    }${timeSpentSeconds}`;

    // Log current time values for debugging
    console.log(
      `Time spent on ${selectedWebsite}: ${timeSpentSecs}s (${timeSpentMinutes}m ${timeSpentSeconds}s)`
    );

    // Calculate time limit in minutes
    let timeLimitMins = Math.floor(timeLimitSecs / 60);

    console.log(
      `Time limit for ${selectedWebsite}: ${timeLimitSecs}s (${timeLimitMins}m)`
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
      const secondsRemainingDisplay = Math.floor(secondsRemaining % 60);

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
  });
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

// Format seconds as "Xm Ys"
function formatDuration(totalSecs) {
  const secs = Math.floor(totalSecs || 0);
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// Wire the "Force Time Update" button (re-attached whenever the panel re-renders)
function wireForceUpdateButton() {
  const btn = document.getElementById("refreshTimeButton");
  if (!btn) return;
  btn.addEventListener("click", () => {
    sendMessageWithRetry({ action: "forceTimeUpdate" }, (response) => {
      if (response?.success) {
        updateDisplay();
        updateDebugInfo();
        showNotification("Time counter updated!", "success");
      }
    });
  });
}

// Update debug information — shows per-domain storage + live active-tab count
function updateDebugInfo() {
  const debugElement = document.getElementById("debugInfo");
  if (!debugElement) return;

  chrome.storage.local.get(["websiteData", "lastResetDate"], (data) => {
    const websiteData = data.websiteData || {};
    const domains = Object.keys(websiteData).sort();

    const rows = domains.length
      ? domains
          .map((domain) => {
            const site = websiteData[domain];
            return `${domain}: ${formatDuration(site.timeSpent)} / ${Math.floor(
              (site.timeLimit || 0) / 60
            )}m limit`;
          })
          .join("<br>")
      : "No websites tracked yet";

    const render = (activeCount) => {
      debugElement.innerHTML = `
        <div>
          <strong>Tracked Sites:</strong><br>
          ${rows}<br>
          <strong>Last Reset:</strong> ${data.lastResetDate || "None"}<br>
          <strong>Active Tabs:</strong> ${activeCount}<br>
          <button id="refreshTimeButton" style="margin-top:5px;font-size:12px;">Force Time Update</button>
        </div>
      `;
      wireForceUpdateButton();
    };

    // Render immediately, then refine with live active-tab count from background
    render("…");
    try {
      chrome.runtime.sendMessage({ action: "getActiveTabsInfo" }, (info) => {
        if (info && !chrome.runtime.lastError) {
          render(info.activeTabs?.length || 0);
        }
      });
    } catch (error) {
      console.error("Error getting active tabs info:", error);
    }
  });
}
