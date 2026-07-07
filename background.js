// background.js
// Watches new history entries and deletes any that match a blocked site.
// Also sweeps existing history: on demand, every 30 minutes, and whenever
// Chrome starts up — so visits that slip past the live listener (e.g. items
// that arrive via history sync from another device) still get cleaned up.

// Each entry: { domain: "instagram.com", path: "/", keepHomepage: false }
// path is always normalized to start and end with "/". "/" means "the whole
// domain". A deeper path like "/forum/" scopes the rule to that section only.
// keepHomepage = true  -> keep the exact page at `path` itself (the section's
//                          "root"), but delete every page nested deeper than it.
// keepHomepage = false -> delete every page under `path`, no exceptions.
let blockedSites = [];

const ALARM_NAME = "periodicHistorySweep";
const SWEEP_INTERVAL_MINUTES = 30;

/** Lowercases + strips protocol/www down to a bare hostname. */
function normalizeDomain(input) {
  let d = String(input || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  return d;
}

/** Lowercases and ensures a path starts and ends with "/". Empty/missing path becomes "/". */
function normalizePath(input) {
  let p = String(input || "").trim().toLowerCase();
  if (!p || p === "/") return "/";
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.endsWith("/")) p += "/";
  return p;
}

/** Splits "site.com/forum/" style raw input into { domain, path }. */
function parseSiteInput(raw) {
  let s = String(raw || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("?")[0].split("#")[0];

  const slashIdx = s.indexOf("/");
  if (slashIdx === -1) {
    return { domain: s, path: "/" };
  }
  return { domain: s.slice(0, slashIdx), path: normalizePath(s.slice(slashIdx)) };
}

/** Accepts old (string[]) or new (object[]) storage shape and normalizes it. */
function toSiteConfigs(rawSites) {
  return (rawSites || [])
    .map((entry) => {
      if (typeof entry === "string") {
        const parsed = parseSiteInput(entry);
        return { domain: parsed.domain, path: parsed.path, keepHomepage: false };
      }
      if (entry && typeof entry === "object" && entry.domain) {
        return {
          domain: normalizeDomain(entry.domain),
          path: normalizePath(entry.path),
          keepHomepage: !!entry.keepHomepage
        };
      }
      return null;
    })
    .filter((entry) => entry && entry.domain);
}

/** (Re)reads the rule list from storage into blockedSites. */
async function loadSites() {
  const data = await chrome.storage.sync.get({ sites: [] });
  blockedSites = toSiteConfigs(data.sites);
}

// A fresh worker wakes with blockedSites = [] and fills it asynchronously,
// but Chrome delivers the event that caused the wake as soon as the top-level
// script finishes — possibly before the storage read lands. Anything that
// consults blockedSites on wake must `await ready` first, or the waking visit
// slips through and sits in history until the next sweep.
const ready = loadSites();
ensureAlarm();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.sites) {
    blockedSites = toSiteConfigs(changes.sites.newValue);
  }
});

/** True if hostname is the site itself or any subdomain of it. */
function hostMatches(hostname, domain) {
  hostname = hostname.toLowerCase();
  return hostname === domain || hostname.endsWith("." + domain);
}

/** True if pathname falls under basePath (basePath itself, or anything deeper). */
function pathMatches(pathname, basePath) {
  if (basePath === "/") return true;
  return pathname === basePath || pathname === basePath.slice(0, -1) || pathname.startsWith(basePath);
}

/** True if pathname IS the section's root (basePath itself), not something deeper. */
function isSectionRoot(pathname, basePath) {
  return pathname === basePath || pathname === basePath.slice(0, -1);
}

/** Picks the most specific (longest path) matching rule, if any. */
function findMatch(hostname, pathname) {
  const candidates = blockedSites.filter(
    (site) => hostMatches(hostname, site.domain) && pathMatches(pathname, site.path)
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => (cur.path.length > best.path.length ? cur : best));
}

function shouldRemove(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch (e) {
    return false;
  }

  // URL paths are case-sensitive by spec, but rules are stored lowercase and
  // users mean the same place by /Forum/ and /forum/. Lowercase the pathname
  // so matching is case-insensitive end to end.
  const pathname = url.pathname.toLowerCase();

  const match = findMatch(url.hostname, pathname);
  if (!match) return false;

  return !(match.keepHomepage && isSectionRoot(pathname, match.path));
}

// Fires shortly after any page finishes loading and lands in history.
// Async on purpose: on a cold start this very event races the storage read.
chrome.history.onVisited.addListener(async (historyItem) => {
  await ready;
  if (historyItem.url && shouldRemove(historyItem.url)) {
    chrome.history.deleteUrl({ url: historyItem.url });
  }
});

// Clicking the toolbar icon jumps straight to settings.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// --- Periodic + startup sweeps -------------------------------------------

function ensureAlarm() {
  chrome.alarms.get(ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: SWEEP_INTERVAL_MINUTES });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  sweepHistory("install");
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  sweepHistory("startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    sweepHistory("periodic");
  }
});

// Let the options page trigger a one-off sweep of existing history.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "CLEAN_NOW") {
    sweepHistory("manual").then((removed) => sendResponse({ removed }));
    return true; // keep the message channel open for the async response
  }
});

/** Searches all of history and deletes anything matching the blocked list. */
async function sweepHistory(trigger) {
  // Re-read storage in case this runs immediately after a save.
  await loadSites();

  let removed = 0;

  if (blockedSites.length > 0) {
    const items = await chrome.history.search({
      text: "",
      startTime: 0,
      maxResults: 100000
    });

    for (const item of items) {
      if (item.url && shouldRemove(item.url)) {
        await chrome.history.deleteUrl({ url: item.url });
        removed++;
      }
    }
  }

  chrome.storage.local.set({
    lastSweep: { time: Date.now(), removed, trigger }
  });

  return removed;
}
