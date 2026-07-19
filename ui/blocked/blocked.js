// Blocked page — shows which site is blocked and counts down to the daily reset.

// Daily reset alarm fires at 00:05 (see getNextMidnight in background.js).
// Count down to the same moment so we never claim "reset" before it happens.
const RESET_HOUR = 0;
const RESET_MINUTE = 5;

let countdownTimer = null;

// Get domain from URL parameters
function getDomainFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("domain");
}

document.addEventListener("DOMContentLoaded", function () {
  const domain = getDomainFromUrl();
  document.getElementById("websiteName").textContent = domain || "this website";

  // "Open Extension Settings" — there is no options page, so open the toolbar
  // popup where limits are managed (Chrome 127+). Fall back to a hint.
  document
    .getElementById("openSettings")
    .addEventListener("click", async function () {
      try {
        if (chrome.action && chrome.action.openPopup) {
          await chrome.action.openPopup();
          return;
        }
        throw new Error("openPopup unavailable");
      } catch (e) {
        showHint("Click the FocusGuard icon in your browser toolbar to adjust limits.");
      }
    });

  // Start countdown
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
});

// Show a small hint under the button
function showHint(text) {
  let hint = document.getElementById("settingsHint");
  if (!hint) {
    hint = document.createElement("p");
    hint.id = "settingsHint";
    hint.style.fontSize = "0.95rem";
    hint.style.marginTop = "0.75rem";
    hint.style.color = "#555";
    document.getElementById("openSettings").insertAdjacentElement("afterend", hint);
  }
  hint.textContent = text;
}

// Next occurrence of the reset time (today if still ahead, else tomorrow)
function getNextResetTime() {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(RESET_HOUR, RESET_MINUTE, 0, 0);
  if (reset <= now) {
    reset.setDate(reset.getDate() + 1);
  }
  return reset;
}

// Calculate and display time until the daily reset
function updateCountdown() {
  const timeRemaining = getNextResetTime() - new Date();

  if (timeRemaining <= 0) {
    onReset();
    return;
  }

  const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

  document.getElementById(
    "countdown"
  ).textContent = `${hours}h ${minutes}m ${seconds}s`;
}

// Reset reached — stop counting and return to the site (it should now be unblocked)
function onReset() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  document.getElementById("countdown").textContent = "now";

  const domain = getDomainFromUrl();
  if (domain) {
    document.getElementById("timeRemaining").textContent =
      "Limit reset — reloading…";
    setTimeout(() => {
      window.location.href = `https://${domain}/`;
    }, 1500);
  }
}
