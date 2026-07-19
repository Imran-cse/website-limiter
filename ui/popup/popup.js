// FocusGuard — popup logic (redesigned UI).
// Talks to background via the existing message API:
//   addWebsite, removeWebsite, updateWebsiteLimit, resetWebsiteTime,
//   resetAllSettings, forceTimeUpdate, getActiveTabsInfo.

const DEFAULT_LIMIT_MIN = 30;

// Deterministic avatar tint per domain (indigo / red / blue / pink / neutral).
const AVATAR_PALETTE = [
  { bg: "oklch(0.95 0.03 25)", fg: "oklch(0.55 0.19 25)" },
  { bg: "oklch(0.94 0.03 250)", fg: "oklch(0.5 0.14 250)" },
  { bg: "oklch(0.95 0.04 340)", fg: "oklch(0.55 0.2 350)" },
  { bg: "oklch(0.95 0.03 278)", fg: "oklch(0.5 0.16 278)" },
  { bg: "oklch(0.95 0.03 155)", fg: "oklch(0.45 0.13 155)" },
  { bg: "oklch(0.95 0.02 265)", fg: "oklch(0.4 0.02 265)" },
];

let expandedDomain = null; // which site row is expanded

document.addEventListener("DOMContentLoaded", () => {
  render();
  setInterval(render, 1000);

  // --- screen navigation ---
  const show = (id) => {
    document.getElementById("todayScreen").hidden = id !== "todayScreen";
    document.getElementById("addScreen").hidden = id !== "addScreen";
    if (id === "addScreen") prepAddScreen();
  };
  document.getElementById("gotoSettings").addEventListener("click", () => show("addScreen"));
  document.getElementById("addAnother").addEventListener("click", () => show("addScreen"));
  document.getElementById("footerSettings").addEventListener("click", () => {
    show("addScreen");
    openAdvanced();
  });
  document.getElementById("backToday").addEventListener("click", () => show("todayScreen"));

  // --- track current site (today screen CTA) ---
  document.getElementById("addCurrentButton").addEventListener("click", trackCurrentTab);
  document.getElementById("quickTrack").addEventListener("click", trackCurrentTab);

  // --- manual add ---
  document.getElementById("addWebsiteButton").addEventListener("click", () => {
    const input = document.getElementById("newWebsiteDomain");
    const limitInput = document.getElementById("newWebsiteLimit");
    let website = input.value.trim();
    const limit = parseInt(limitInput.value, 10);

    if (!website) return toast("Please enter a website domain", "error");
    if (!website.includes("://")) website = "http://" + website;

    const domain = extractDomain(website);
    if (!domain || !(limit >= 1 && limit <= 480)) {
      return toast("Enter a valid domain and limit (1–480 min)", "error");
    }
    addWebsite(domain, limit, () => {
      input.value = "";
      limitInput.value = String(DEFAULT_LIMIT_MIN);
      setActiveChip(DEFAULT_LIMIT_MIN);
      document.getElementById("todayScreen").hidden = false;
      document.getElementById("addScreen").hidden = true;
    });
  });

  // --- limit preset chips ---
  document.getElementById("limitChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const min = parseInt(chip.dataset.min, 10);
    document.getElementById("newWebsiteLimit").value = String(min);
    setActiveChip(min);
  });
  document.getElementById("newWebsiteLimit").addEventListener("input", (e) => {
    setActiveChip(parseInt(e.target.value, 10));
  });

  // --- advanced ---
  document.getElementById("advToggle").addEventListener("click", () => {
    const body = document.getElementById("advBody");
    const head = document.getElementById("advToggle");
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute("aria-expanded", String(open));
    if (open) refreshAdvanced();
  });

  document.getElementById("resetSettingsButton").addEventListener("click", () => {
    if (!confirm("This will reset ALL settings to defaults. Continue?")) return;
    sendMessageWithRetry({ action: "resetAllSettings" }, (res) => {
      if (res && res.success) {
        toast("All settings reset to defaults", "success");
        expandedDomain = null;
        render();
        refreshAdvanced();
      } else if (res && res.error) {
        toast(`Error: ${res.error}`, "error");
      }
    });
  });
});

// ---------- current-tab helpers ----------
function trackCurrentTab() {
  getCurrentTab().then((tab) => {
    if (!tab || !tab.url) return toast("Could not access current tab", "error");
    const domain = extractDomain(tab.url);
    if (!domain) return toast("Could not determine site domain", "error");
    addWebsite(domain, DEFAULT_LIMIT_MIN);
  });
}

function prepAddScreen() {
  const card = document.getElementById("currentTabCard");
  getCurrentTab().then((tab) => {
    const domain = tab && tab.url ? extractDomain(tab.url) : null;
    if (!domain) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    document.getElementById("currentDomain").textContent = domain;
    document.getElementById("currentAvatar").textContent = domain[0].toUpperCase();
  });
  refreshAdvanced();
}

function openAdvanced() {
  document.getElementById("advBody").hidden = false;
  document.getElementById("advToggle").setAttribute("aria-expanded", "true");
  refreshAdvanced();
}

function setActiveChip(min) {
  document.querySelectorAll("#limitChips .chip").forEach((c) => {
    c.classList.toggle("active", parseInt(c.dataset.min, 10) === min);
  });
}

// ---------- render today screen ----------
function render() {
  if (!isExtensionContextValid()) return;
  chrome.storage.local.get(["websiteData", "lastResetDate"], (data) => {
    const websiteData = data.websiteData || {};
    const domains = Object.keys(websiteData).sort();

    const list = document.getElementById("siteList");
    const empty = document.getElementById("emptyState");

    // summary
    let totalSpent = 0;
    let totalLimit = 0;
    domains.forEach((d) => {
      const s = websiteData[d];
      totalSpent += num(s.timeSpent);
      totalLimit += num(s.timeLimit, 1800);
    });
    const pct = totalLimit > 0 ? Math.min(100, (totalSpent / totalLimit) * 100) : 0;
    document.getElementById("summaryTotal").textContent = fmtDur(totalSpent) || "0m";
    document.getElementById("summaryPct").textContent = `${Math.round(pct)}%`;
    document.getElementById("summaryCount").textContent =
      `${domains.length} site${domains.length === 1 ? "" : "s"}`;
    const ring = document.getElementById("summaryRing");
    ring.style.strokeDashoffset = String(207 - (207 * pct) / 100);
    ring.classList.toggle("danger", pct >= 100);
    ring.classList.toggle("warn", pct >= 75 && pct < 100);

    // list vs empty
    if (domains.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    renderRows(list, domains, websiteData);
  });
}

function renderRows(list, domains, websiteData) {
  // Preserve focus in an open edit input across the 1s re-render.
  const active = document.activeElement;
  const keepId = active && active.classList.contains("edit-limit") ? active.id : null;

  list.innerHTML = "";
  domains.forEach((domain, i) => {
    const s = websiteData[domain];
    const spent = num(s.timeSpent);
    const limit = num(s.timeLimit, 1800);
    const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
    const over = spent >= limit;
    const warn = !over && pct >= 75;
    const state = over ? "danger" : warn ? "warn" : "";
    const pal = AVATAR_PALETTE[i % AVATAR_PALETTE.length];

    const badge = over
      ? `<span class="site-badge danger">BLOCKED</span>`
      : `<span class="site-badge ${warn ? "warn" : ""}">${fmtMin(
          Math.max(0, limit - spent)
        )} left</span>`;

    const limitMin = Math.round(limit / 60);

    const row = document.createElement("div");
    row.className = `site-row ${state}${domain === expandedDomain ? " open" : ""}`.trim();
    row.dataset.domain = domain;
    row.innerHTML = `
      <div class="site-head">
        <div class="site-avatar" style="background:${pal.bg};color:${pal.fg};">${domain[0].toUpperCase()}</div>
        <div class="site-info">
          <div class="site-domain">${escapeHtml(domain)}</div>
          <div class="site-times">${fmtMin(spent)}<span class="limit"> / ${fmtMin(limit)}</span></div>
        </div>
        ${badge}
      </div>
      <div class="site-track"><div class="site-fill ${state}" style="width:${pct}%;"></div></div>
      <div class="site-actions">
        <div class="edit-row">
          <div class="edit-input-wrap">
            <input class="edit-limit mono" id="edit-${cssId(domain)}" type="number" min="1" max="480" value="${limitMin}" />
            <span class="input-suffix">min</span>
          </div>
          <button class="btn-mini accent" data-act="save">Save</button>
        </div>
        <div class="action-pair">
          <button class="btn-mini" data-act="reset">Reset time</button>
          <button class="btn-mini danger" data-act="remove">Remove</button>
        </div>
      </div>`;

    row.querySelector(".site-head").addEventListener("click", () => {
      expandedDomain = expandedDomain === domain ? null : domain;
      render();
    });
    row.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onRowAction(btn.dataset.act, domain, row);
      });
    });
    list.appendChild(row);
  });

  if (keepId) {
    const el = document.getElementById(keepId);
    if (el) {
      el.focus();
      const v = el.value;
      el.value = "";
      el.value = v; // caret to end
    }
  }
}

function onRowAction(act, domain, row) {
  if (act === "save") {
    const input = row.querySelector(".edit-limit");
    const limit = parseInt(input.value, 10);
    if (!(limit >= 1 && limit <= 480)) return toast("Limit must be 1–480 min", "error");
    sendMessageWithRetry(
      { action: "updateWebsiteLimit", domain, timeLimit: limit },
      (res) => {
        if (res && res.success) toast(`Limit for ${domain} set to ${limit}m`, "success");
        else if (res && res.error) toast(`Error: ${res.error}`, "error");
        render();
      }
    );
  } else if (act === "reset") {
    if (!confirm(`Reset today's time for ${domain}?`)) return;
    sendMessageWithRetry({ action: "resetWebsiteTime", domain }, (res) => {
      if (res && res.success) toast(`Time for ${domain} reset`, "success");
      else if (res && res.error) toast(`Error: ${res.error}`, "error");
      render();
    });
  } else if (act === "remove") {
    if (!confirm(`Remove "${domain}" from tracking?`)) return;
    sendMessageWithRetry({ action: "removeWebsite", domain }, (res) => {
      if (res && res.success) {
        toast(`Removed "${domain}"`, "success");
        if (expandedDomain === domain) expandedDomain = null;
      } else if (res && res.error) toast(`Error: ${res.error}`, "error");
      render();
    });
  }
}

// ---------- advanced panel ----------
function refreshAdvanced() {
  if (!isExtensionContextValid()) return;
  chrome.storage.local.get(["websiteData", "lastResetDate"], (data) => {
    const websiteData = data.websiteData || {};
    const count = Object.keys(websiteData).length;
    document.getElementById("advSiteCount").textContent = String(count);
    document.getElementById("advLastReset").textContent = data.lastResetDate
      ? new Date(data.lastResetDate).toLocaleDateString()
      : "—";
    const activeEl = document.getElementById("advActiveTabs");
    activeEl.textContent = "…";
    try {
      chrome.runtime.sendMessage({ action: "getActiveTabsInfo" }, (info) => {
        if (info && !chrome.runtime.lastError) {
          activeEl.textContent = String(info.activeTabs?.length || 0);
        } else {
          activeEl.textContent = "0";
        }
      });
    } catch {
      activeEl.textContent = "0";
    }
  });
}

// ---------- background messaging ----------
function addWebsite(domain, timeLimit, onDone) {
  sendMessageWithRetry({ action: "addWebsite", domain, timeLimit }, (res) => {
    if (res && res.success) {
      toast(`Added "${domain}" · ${timeLimit}m limit`, "success");
      expandedDomain = domain;
      render();
      if (typeof onDone === "function") onDone();
    } else if (res && res.error) {
      toast(`Error: ${res.error}`, "error");
    } else {
      toast(`"${domain}" is already tracked`, "warning");
    }
  });
}

function isExtensionContextValid() {
  return chrome.runtime && chrome.runtime.id;
}

function sendMessageWithRetry(message, callback, retryCount = 0) {
  if (!isExtensionContextValid()) {
    if (retryCount < 3) {
      setTimeout(() => sendMessageWithRetry(message, callback, retryCount + 1), (retryCount + 1) * 500);
    } else if (typeof callback === "function") {
      callback({ error: "Extension context invalid after retries" });
    }
    return;
  }
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        if (retryCount < 3) {
          setTimeout(() => sendMessageWithRetry(message, callback, retryCount + 1), (retryCount + 1) * 500);
        } else if (typeof callback === "function") {
          callback({ error: chrome.runtime.lastError.message });
        }
      } else if (typeof callback === "function") {
        callback(response);
      }
    });
  } catch (error) {
    if (typeof callback === "function") callback({ error: error.message });
  }
}

// ---------- utilities ----------
function extractDomain(url) {
  try {
    let domain = new URL(url).hostname;
    if (domain.startsWith("www.")) domain = domain.substring(4);
    return domain;
  } catch {
    return null;
  }
}

async function getCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  } catch {
    return null;
  }
}

function num(v, fallback = 0) {
  return typeof v === "number" && !isNaN(v) ? v : fallback;
}

// Whole-minute label used in list rows/badges: "42m", "1h", "1h 5m".
function fmtMin(secs) {
  const mins = Math.floor(num(secs) / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Summary total: same shape but never blank for sub-minute totals handled by caller.
function fmtDur(secs) {
  const mins = Math.floor(num(secs) / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function cssId(domain) {
  return domain.replace(/[^a-z0-9]/gi, "-");
}

function toast(message, type = "info") {
  const host = document.getElementById("toastHost");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
