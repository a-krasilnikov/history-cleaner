// options.js

const input = document.getElementById("site-input");
const addBtn = document.getElementById("add-btn");
const keepHomepageInput = document.getElementById("keep-homepage-input");
const hint = document.getElementById("input-hint");
const list = document.getElementById("site-list");
const filterInput = document.getElementById("filter-input");
const emptyState = document.getElementById("empty-state");
const noMatches = document.getElementById("no-matches");
const countBadge = document.getElementById("count-badge");
const cleanNowBtn = document.getElementById("clean-now-btn");
const status = document.getElementById("status");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file-input");
const autoSweepInfo = document.getElementById("auto-sweep-info");

// --- i18n -------------------------------------------------------------
// Every user-visible string lives in _locales/<lang>/messages.json; this
// section is the only place that reads it. To add a language, drop in a
// _locales/<code>/messages.json — no code change needed.

// chrome.i18n is missing when options.html is opened as a plain file (handy
// for checking layout) — then nothing is swapped in and the English fallback
// markup stands.
const i18n = globalThis.chrome && chrome.i18n;
const UI_LANG = i18n ? i18n.getUILanguage() : "en";
const pluralRules = new Intl.PluralRules(UI_LANG);
const relativeTime = new Intl.RelativeTimeFormat(UI_LANG, { numeric: "auto" });

/** chrome.i18n.getMessage with positional substitutions ($1, $2, …). */
function t(key, ...subs) {
  if (!i18n) return "";
  return i18n.getMessage(key, subs.length ? subs.map(String) : undefined);
}

/**
 * Plural-aware lookup: picks `<key>_one` / `_few` / `_many` / `_other` by the
 * UI language's rules — English needs two forms, Russian three. `count` is
 * always $1 and is formatted for the locale. Falls back to `_other` for any
 * category a locale doesn't define (getMessage returns "" for a missing key).
 */
function tn(key, count, ...subs) {
  const all = [count.toLocaleString(UI_LANG), ...subs.map(String)];
  return (
    t(`${key}_${pluralRules.select(count)}`, ...all) || t(`${key}_other`, ...all)
  );
}

/**
 * Swaps the message catalogue into the static markup. A key with no message
 * leaves the element's fallback text alone rather than blanking the UI.
 */
function localizeDocument() {
  if (!i18n) return;
  document.documentElement.lang = UI_LANG;
  // Chrome resolves @@bidi_dir to "ltr"/"rtl" for the active locale.
  document.documentElement.dir = t("@@bidi_dir");

  const apply = (attr, set) => {
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const message = t(el.getAttribute(attr));
      if (message) set(el, message);
    });
  };

  apply("data-i18n", (el, message) => (el.textContent = message));
  apply("data-i18n-placeholder", (el, message) => (el.placeholder = message));
  apply("data-i18n-title", (el, message) => (el.title = message));
}

localizeDocument();

// sites: [{ domain: "example.com", path: "/", keepHomepage: false }, ...]
let sites = [];
let statusTimer = null;

function normalizeDomain(raw) {
  let d = String(raw || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  return d;
}

/** Lowercases and ensures a path starts and ends with "/". Empty/missing path becomes "/". */
function normalizePath(raw) {
  let p = String(raw || "").trim().toLowerCase();
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

function isValidDomain(domain) {
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain);
}

/** Combined "domain/path" string for display and dedupe checks. */
function displayKey(site) {
  return site.path === "/" ? site.domain : `${site.domain}${site.path}`;
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

function setStatus(text, persist) {
  status.textContent = text;
  if (statusTimer) clearTimeout(statusTimer);
  if (!persist) {
    statusTimer = setTimeout(() => {
      status.textContent = "";
    }, 3200);
  }
}

function setHint(text) {
  hint.textContent = text;
}

/**
 * The filter box is matched against the same "domain/path" text the rows show,
 * so what the user reads is what they can search. Pasting a full URL works too:
 * the query goes through the same protocol/www stripping as a rule.
 */
function filterQuery() {
  const raw = String(filterInput.value || "").trim();
  return raw ? normalizeDomain(raw) : "";
}

function matchesFilter(site, query) {
  return !query || displayKey(site).includes(query);
}

function render() {
  list.innerHTML = "";

  const query = filterQuery();
  const visible = sites.filter((site) => matchesFilter(site, query));

  countBadge.textContent = query
    ? `${visible.length} / ${sites.length}`
    : String(sites.length);
  filterInput.hidden = sites.length === 0;
  emptyState.style.display = sites.length === 0 ? "block" : "none";
  noMatches.textContent = query ? t("noMatches", query) : "";
  noMatches.style.display = sites.length > 0 && visible.length === 0 ? "block" : "none";

  visible
    .slice()
    .sort((a, b) => displayKey(a).localeCompare(displayKey(b)))
    .forEach((site) => {
      const key = displayKey(site);
      const li = document.createElement("li");
      li.className = "site-row";
      li.dataset.key = key;

      // One line: domain (grows) + keep-root switch + remove button.
      const label = document.createElement("span");
      label.className = "site-domain";
      label.textContent = key;

      const sub = document.createElement("span");
      sub.className = "sub-note";
      sub.textContent =
        site.path === "/"
          ? t("rowAllSubdomains")
          : t("rowAllSubdomainsScoped", site.path);
      label.appendChild(sub);

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-icon";
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", t("rowRemoveLabel", key));
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => removeSite(site, li));

      const switchLabel = document.createElement("label");
      switchLabel.className = "switch row-switch";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = site.keepHomepage;
      checkbox.addEventListener("change", async () => {
        const next = sites.map((s) =>
          s.domain === site.domain && s.path === site.path
            ? { ...s, keepHomepage: checkbox.checked }
            : s
        );
        const saved = await saveSites(next, (text) => setStatus(text, true));
        if (!saved) {
          checkbox.checked = !checkbox.checked; // put the switch back
          return;
        }
        setStatus(t(checkbox.checked ? "statusKeepOn" : "statusKeepOff", key));
      });

      const track = document.createElement("span");
      track.className = "track";
      track.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "switch-text";
      text.textContent = t(site.path === "/" ? "rowKeepHomepage" : "rowKeepThisPage");

      switchLabel.appendChild(checkbox);
      switchLabel.appendChild(track);
      switchLabel.appendChild(text);

      li.appendChild(label);
      li.appendChild(switchLabel);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
}

/** Friendly text for a failed storage.sync write. */
function saveErrorText(message) {
  const msg = String(message || "");
  if (/quota/i.test(msg)) return t("saveErrorQuota");
  if (/MAX_WRITE_OPERATIONS/i.test(msg)) return t("saveErrorTooManyWrites");
  return t("saveErrorGeneric", msg || t("saveErrorUnknown"));
}

/**
 * Tries to persist `next` as the rule list. Only on success does it become the
 * in-memory `sites` — so on failure the UI still reflects what's actually
 * stored. Returns true if saved; on failure reports the reason via `report`.
 */
async function saveSites(next, report) {
  try {
    await chrome.storage.sync.set({ sites: next });
  } catch (e) {
    report(saveErrorText(e && e.message));
    return false;
  }
  sites = next;
  return true;
}

async function addSite() {
  const { domain, path } = parseSiteInput(input.value);

  if (!domain) {
    setHint(t("hintNeedDomain"));
    return;
  }
  if (!isValidDomain(domain)) {
    setHint(t("hintInvalidDomain", input.value.trim()));
    return;
  }
  const key = path === "/" ? domain : `${domain}${path}`;
  if (sites.some((s) => s.domain === domain && s.path === path)) {
    setHint(t("hintDuplicate", key));
    return;
  }

  setHint("");
  const keepHomepage = keepHomepageInput.checked;
  const saved = await saveSites(sites.concat([{ domain, path, keepHomepage }]), setHint);
  if (!saved) return; // input is preserved so the user can retry
  filterInput.value = ""; // otherwise the row just added could be filtered out of view
  render();
  input.value = "";
  input.focus();
  setStatus(t(keepHomepage ? "statusAddedKeep" : "statusAdded", key));
}

function removeSite(site, rowEl) {
  rowEl.classList.add("removing");
  const key = displayKey(site);
  window.setTimeout(async () => {
    const next = sites.filter((s) => !(s.domain === site.domain && s.path === site.path));
    const saved = await saveSites(next, (text) => setStatus(text, true));
    render(); // on failure this re-renders the kept list, restoring the row
    if (saved) setStatus(t("statusRemoved", key));
  }, 180);
}

addBtn.addEventListener("click", addSite);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addSite();
  }
});
input.addEventListener("input", () => setHint(""));

filterInput.addEventListener("input", render);
filterInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && filterInput.value) {
    e.preventDefault(); // don't let Esc close the popup while there's a filter to clear
    filterInput.value = "";
    render();
  }
});

cleanNowBtn.addEventListener("click", () => {
  if (sites.length === 0) {
    setStatus(t("statusNothingToClean"));
    return;
  }
  cleanNowBtn.disabled = true;
  cleanNowBtn.textContent = t("cleanNowBusy");
  chrome.runtime.sendMessage({ type: "CLEAN_NOW" }, (response) => {
    cleanNowBtn.disabled = false;
    cleanNowBtn.textContent = t("cleanNowButton");
    const removed = response && typeof response.removed === "number" ? response.removed : 0;
    setStatus(
      removed === 0 ? t("statusNothingFound") : tn("statusCleanedUp", removed),
      true
    );
  });
});

// --- Export / Import -------------------------------------------------

function exportSites() {
  if (sites.length === 0) {
    setStatus(t("exportEmpty"));
    return;
  }
  const payload = { version: 1, exportedAt: new Date().toISOString(), sites };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "history-auto-cleaner-sites.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setStatus(tn("exportDone", sites.length));
}

function importSites(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      setStatus(t("importInvalidJson"), true);
      return;
    }

    // Accept either { sites: [...] } or a bare array.
    const rawList = Array.isArray(parsed) ? parsed : parsed && parsed.sites;
    const incoming = toSiteConfigs(rawList).filter((s) => isValidDomain(s.domain));

    if (incoming.length === 0) {
      setStatus(t("importNoSites"), true);
      return;
    }

    // Merge into a copy; the current list stays untouched unless the save lands.
    const next = sites.map((s) => ({ ...s }));
    let added = 0;
    let updated = 0;
    incoming.forEach((incomingSite) => {
      const existing = next.find(
        (s) => s.domain === incomingSite.domain && s.path === incomingSite.path
      );
      if (existing) {
        if (existing.keepHomepage !== incomingSite.keepHomepage) updated++;
        existing.keepHomepage = incomingSite.keepHomepage;
      } else {
        next.push(incomingSite);
        added++;
      }
    });

    const saved = await saveSites(next, (text) => setStatus(text, true));
    if (!saved) return;
    render();
    setStatus(t("importDone", added, updated), true);
  };
  reader.onerror = () => setStatus(t("importReadError"), true);
  reader.readAsText(file);
}

exportBtn.addEventListener("click", exportSites);
importBtn.addEventListener("click", () => importFileInput.click());
importFileInput.addEventListener("change", () => {
  const file = importFileInput.files && importFileInput.files[0];
  if (file) importSites(file);
  importFileInput.value = "";
});

// --- Automatic sweep status ------------------------------------------

// Intl handles the wording and the plural forms of "5 minutes ago" per
// language, so only "just now" needs a message of its own.
function formatRelativeTime(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return relativeTime.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relativeTime.format(-hours, "hour");
  return relativeTime.format(-Math.round(hours / 24), "day");
}

const TRIGGER_LABEL_KEY = {
  manual: "sweepLabelManual",
  periodic: "sweepLabelPeriodic",
  startup: "sweepLabelStartup",
  install: "sweepLabelInstall"
};

function renderAutoSweepInfo(lastSweep) {
  if (!lastSweep) {
    autoSweepInfo.textContent = t("autoSweepNever");
    return;
  }
  const label = t(TRIGGER_LABEL_KEY[lastSweep.trigger] || "sweepLabelUnknown");
  const removedText =
    lastSweep.removed === 0
      ? t("sweepRemovedNothing")
      : tn("sweepRemoved", lastSweep.removed);
  autoSweepInfo.textContent = t(
    "lastSweepLine",
    label,
    formatRelativeTime(lastSweep.time),
    removedText
  );
}

chrome.storage.local.get({ lastSweep: null }, (data) => {
  renderAutoSweepInfo(data.lastSweep);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastSweep) {
    renderAutoSweepInfo(changes.lastSweep.newValue);
  }
});

chrome.storage.sync.get({ sites: [] }, (data) => {
  sites = toSiteConfigs(data.sites);
  render();
});
