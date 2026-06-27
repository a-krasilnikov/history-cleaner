// options.js

const input = document.getElementById("site-input");
const addBtn = document.getElementById("add-btn");
const keepHomepageInput = document.getElementById("keep-homepage-input");
const hint = document.getElementById("input-hint");
const list = document.getElementById("site-list");
const emptyState = document.getElementById("empty-state");
const countBadge = document.getElementById("count-badge");
const cleanNowBtn = document.getElementById("clean-now-btn");
const status = document.getElementById("status");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file-input");
const autoSweepInfo = document.getElementById("auto-sweep-info");

// sites: [{ domain: "instagram.com", path: "/", keepHomepage: false }, ...]
let sites = [];
let statusTimer = null;

function normalizeDomain(raw) {
  let d = String(raw || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  return d;
}

/** Ensures a path starts and ends with "/". Empty/missing path becomes "/". */
function normalizePath(raw) {
  let p = String(raw || "").trim();
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

function render() {
  list.innerHTML = "";
  countBadge.textContent = String(sites.length);
  emptyState.style.display = sites.length === 0 ? "block" : "none";

  sites
    .slice()
    .sort((a, b) => displayKey(a).localeCompare(displayKey(b)))
    .forEach((site) => {
      const key = displayKey(site);
      const li = document.createElement("li");
      li.className = "site-row";
      li.dataset.key = key;

      // --- top line: domain/path + remove button ---
      const top = document.createElement("div");
      top.className = "site-row-top";

      const label = document.createElement("span");
      label.className = "site-domain";
      label.textContent = key;

      const sub = document.createElement("span");
      sub.className = "sub-note";
      sub.textContent =
        site.path === "/" ? "+ all subdomains" : `+ all subdomains, scoped to ${site.path}`;
      label.appendChild(sub);

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-icon";
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `Remove ${key} from the list`);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => removeSite(site, li));

      top.appendChild(label);
      top.appendChild(removeBtn);

      // --- bottom line: per-site "keep root page" switch ---
      const bottom = document.createElement("div");
      bottom.className = "site-row-bottom";

      const switchLabel = document.createElement("label");
      switchLabel.className = "switch row-switch";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = site.keepHomepage;
      checkbox.addEventListener("change", () => {
        site.keepHomepage = checkbox.checked;
        save();
        setStatus(
          checkbox.checked
            ? `${key} will stay — only deeper pages are removed.`
            : `Every page under ${key} will be removed.`
        );
      });

      const track = document.createElement("span");
      track.className = "track";
      track.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "switch-text";
      text.textContent = site.path === "/" ? "Keep homepage" : "Keep this page itself";

      switchLabel.appendChild(checkbox);
      switchLabel.appendChild(track);
      switchLabel.appendChild(text);

      bottom.appendChild(switchLabel);

      li.appendChild(top);
      li.appendChild(bottom);
      list.appendChild(li);
    });
}

function save() {
  chrome.storage.sync.set({ sites });
}

function addSite() {
  const { domain, path } = parseSiteInput(input.value);

  if (!domain) {
    setHint("Type a domain first, e.g. instagram.com");
    return;
  }
  if (!isValidDomain(domain)) {
    setHint(`"${input.value.trim()}" doesn't look like a valid domain.`);
    return;
  }
  const key = path === "/" ? domain : `${domain}${path}`;
  if (sites.some((s) => s.domain === domain && s.path === path)) {
    setHint(`${key} is already on the list.`);
    return;
  }

  setHint("");
  const keepHomepage = keepHomepageInput.checked;
  sites.push({ domain, path, keepHomepage });
  save();
  render();
  input.value = "";
  input.focus();
  setStatus(
    keepHomepage
      ? `Added ${key} — that page stays, deeper pages are removed.`
      : `Added ${key}.`
  );
}

function removeSite(site, rowEl) {
  rowEl.classList.add("removing");
  const key = displayKey(site);
  window.setTimeout(() => {
    sites = sites.filter((s) => !(s.domain === site.domain && s.path === site.path));
    save();
    render();
    setStatus(`Removed ${key}.`);
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

cleanNowBtn.addEventListener("click", () => {
  if (sites.length === 0) {
    setStatus("Add a site first — nothing to sweep yet.");
    return;
  }
  cleanNowBtn.disabled = true;
  cleanNowBtn.textContent = "Sweeping…";
  chrome.runtime.sendMessage({ type: "CLEAN_NOW" }, (response) => {
    cleanNowBtn.disabled = false;
    cleanNowBtn.textContent = "Sweep now";
    const removed = response && typeof response.removed === "number" ? response.removed : 0;
    setStatus(
      removed === 0
        ? "Nothing matching found in your existing history."
        : `Swept ${removed} matching ${removed === 1 ? "entry" : "entries"} from history.`,
      true
    );
  });
});

// --- Export / Import -------------------------------------------------

function exportSites() {
  if (sites.length === 0) {
    setStatus("Add a site before exporting — the list is empty.");
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

  setStatus(`Exported ${sites.length} ${sites.length === 1 ? "site" : "sites"}.`);
}

function importSites(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      setStatus("That file isn't valid JSON.", true);
      return;
    }

    // Accept either { sites: [...] } or a bare array.
    const rawList = Array.isArray(parsed) ? parsed : parsed && parsed.sites;
    const incoming = toSiteConfigs(rawList).filter((s) => isValidDomain(s.domain));

    if (incoming.length === 0) {
      setStatus("No valid sites found in that file.", true);
      return;
    }

    let added = 0;
    let updated = 0;
    incoming.forEach((incomingSite) => {
      const existing = sites.find(
        (s) => s.domain === incomingSite.domain && s.path === incomingSite.path
      );
      if (existing) {
        if (existing.keepHomepage !== incomingSite.keepHomepage) updated++;
        existing.keepHomepage = incomingSite.keepHomepage;
      } else {
        sites.push(incomingSite);
        added++;
      }
    });

    save();
    render();
    setStatus(`Imported: ${added} added, ${updated} updated.`, true);
  };
  reader.onerror = () => setStatus("Couldn't read that file.", true);
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

function formatRelativeTime(ms) {
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const TRIGGER_LABEL = {
  manual: "manual sweep",
  periodic: "automatic sweep",
  startup: "startup sweep",
  install: "first run"
};

function renderAutoSweepInfo(lastSweep) {
  if (!lastSweep) {
    autoSweepInfo.textContent =
      "Runs automatically every 30 minutes and on Chrome startup. No sweep has run yet.";
    return;
  }
  const label = TRIGGER_LABEL[lastSweep.trigger] || "sweep";
  const removedText =
    lastSweep.removed === 0
      ? "nothing to remove"
      : `removed ${lastSweep.removed} ${lastSweep.removed === 1 ? "entry" : "entries"}`;
  autoSweepInfo.textContent = `Last ${label}: ${formatRelativeTime(lastSweep.time)} — ${removedText}.`;
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
