// Blocked page — dark "limit reached" screen (redesign).
// Runs as a chrome-extension:// page, so it has full chrome API access:
// reads the site's spent/limit from storage and can grant a short snooze.

// Daily reset alarm fires at 00:05 (see getNextMidnight in background.js).
const RESET_HOUR = 0;
const RESET_MINUTE = 5;
const SNOOZE_MINUTES = 5;

let countdownTimer = null;

function getDomainFromUrl() {
  return new URLSearchParams(window.location.search).get("domain");
}

document.addEventListener("DOMContentLoaded", () => {
  const domain = getDomainFromUrl();
  document.getElementById("websiteName").textContent = domain || "this website";

  loadStats(domain);

  document.getElementById("closeTab").addEventListener("click", closeThisTab);
  document.getElementById("snooze").addEventListener("click", () => snooze(domain));

  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
});

// Pull spent + limit for this domain from storage and render.
function loadStats(domain) {
  if (!domain || !chrome?.storage?.local) return;
  chrome.storage.local.get(["websiteData"], (data) => {
    const site = (data.websiteData || {})[domain];
    if (!site) return;
    document.getElementById("spentVal").textContent = fmt(site.timeSpent);
    document.getElementById("limitText").textContent = fmt(site.timeLimit);
  });
}

// "42m", "1h", "1h 5m"
function fmt(secs) {
  const mins = Math.floor((typeof secs === "number" ? secs : 0) / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function getNextResetTime() {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(RESET_HOUR, RESET_MINUTE, 0, 0);
  if (reset <= now) reset.setDate(reset.getDate() + 1);
  return reset;
}

function updateCountdown() {
  const remaining = getNextResetTime() - new Date();
  if (remaining <= 0) return onReset();

  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const el = document.getElementById("countdown");
  el.textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Close the current tab (extension page has the tabs permission).
function closeThisTab() {
  try {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id != null) chrome.tabs.remove(tab.id);
      else window.close();
    });
  } catch {
    window.close();
  }
}

// Grant 5 extra minutes by bumping the daily limit, then return to the site.
function snooze(domain) {
  const btn = document.getElementById("snooze");
  if (!domain) return;
  btn.disabled = true;
  btn.textContent = "Unlocking…";

  chrome.storage.local.get(["websiteData"], (data) => {
    const websiteData = data.websiteData || {};
    const site = websiteData[domain];
    if (!site) {
      if (domain) window.location.href = `https://${domain}/`;
      return;
    }
    const newLimitMin = Math.round(site.timeLimit / 60) + SNOOZE_MINUTES;
    chrome.runtime.sendMessage(
      { action: "updateWebsiteLimit", domain, timeLimit: newLimitMin },
      () => {
        // Clear the warned flag isn't exposed; just navigate back — the added
        // headroom keeps the site open for another few minutes.
        window.location.href = `https://${domain}/`;
      }
    );
  });
}

function onReset() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  document.getElementById("countdown").textContent = "now";
  const domain = getDomainFromUrl();
  if (domain) setTimeout(() => (window.location.href = `https://${domain}/`), 1200);
}
