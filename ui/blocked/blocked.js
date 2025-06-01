// Get domain from URL parameters
function getDomainFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("domain") || "this website";
}

// Display the website name
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("websiteName").textContent = getDomainFromUrl();

  // Set up button event listener
  document
    .getElementById("openSettings")
    .addEventListener("click", function () {
      if (chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        // Fallback - open extension popup
        chrome.runtime.sendMessage({ action: "openPopup" });
      }
    });

  // Start countdown
  updateCountdown();
  setInterval(updateCountdown, 1000);
});

// Calculate and display time until midnight
function updateCountdown() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const timeRemaining = tomorrow - now;

  const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

  document.getElementById(
    "countdown"
  ).textContent = `${hours}h ${minutes}m ${seconds}s`;
}
