# CLAUDE.md

Guidance for working in this repo. Read before editing.

## What this is

**History Auto-Cleaner** — a Manifest V3 Chrome extension that auto-deletes
browser-history entries for user-configured sites. No build step, no
dependencies, no network access. Load unpacked to run (see below).

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest. Permissions: `history`, `storage`, `alarms`, `contextMenus`, `activeTab`. No host permissions — keep it that way (`activeTab` is the deliberate alternative: access to one tab, granted only by the user's context-menu click). `minimum_chrome_version: 111` (Mar 2023) — at 111+ every chrome.* API used here supports promises (`chrome.alarms` was the last, at 111), so promise-form/`await` calls are safe throughout; no per-API version checks needed. |
| `background.js` | Service worker. The cleaning engine: live listener + sweeps + matching logic. |
| `options.html/.css/.js` | The only UI. Opens on toolbar-icon click. Vanilla JS, no framework. |
| `_locales/<lang>/messages.json` | All UI copy, Chrome i18n format. `en` is the `default_locale`; `ru`, `pt_BR` and `es` ship too. |
| `icons/` | 16/48/128 px action + extension icons. |
| `docs/PRD.md` | Product spec — source of truth for intended behavior, matching examples, edge cases. |
| `store/` | Web Store listing description, one file per language. Dashboard-only copy; never packaged. |
| `test/` | Unit tests for the matching core and the locale catalogues. Node built-in runner, no deps. |
| `package.json` | Metadata + `npm test` / `npm run pack` scripts. No dependencies. |
| `.github/workflows/test.yml` | CI: `node --test` on Node 22/24, every push to master + PRs. |
| `PRIVACY.md` | Privacy policy (Web Store requires a public URL for the `history` permission — the repo file is the source; it's published separately). |

## Critical invariant: duplicated normalization

`normalizeDomain`, `normalizePath`, `parseSiteInput`, `toSiteConfigs` are
**copy-pasted in both `background.js` and `options.js`** and must stay
byte-identical. MV3 classic service workers can't easily import a shared
module, hence the duplication. **If you change one copy, change the other.**

## Matching logic (background.js) — do not regress

Rule shape: `{ domain, path, keepHomepage }`. `path` always starts and ends
with `/`; a bare domain has path `"/"`.

- `hostMatches`: host equals `domain` OR ends with `"." + domain` → covers all
  subdomains. `mysite.com` must NOT match rule `site.com`.
- `pathMatches`: `"/"` matches everything; otherwise pathname equals the path,
  equals it minus the trailing slash, or `startsWith` it. `/forums` must NOT
  match rule `/forum/`.
- Matching is case-insensitive end to end (deliberate product decision, even
  though URL paths are case-sensitive by spec): rules are stored lowercase
  (`normalizePath` lowercases) and `shouldRemove` lowercases the URL pathname
  before comparing.
- `findMatch`: when multiple rules match, the one with the **longest path**
  wins (specificity). Note: domain specificity is NOT a tiebreaker — only path
  length is.
- `keepHomepage`: when true, the section root (`path`, with or without trailing
  slash) is kept; everything deeper is still deleted. See `isSectionRoot`.

Any change here must still satisfy every example in `docs/PRD.md`
("Matching rules — the exact logic"). Trace them by hand.

## Known quirks (documented, not yet decided)

- **Tiebreak:** when two matching rules have equal path length (e.g. rules for
  `site.com` and `sub.site.com`, both path `/`), the winner is storage order,
  not domain specificity. The PRD only defines path-length specificity.

## Magic numbers

- Sweep reads up to `maxResults: 100000` history items per pass.
- Status toast auto-clears after 3200 ms (`options.js`).
- Row-remove animation: 180 ms JS delay paired with a 0.2 s CSS transition.

## Four deletion paths (background.js)

1. Live — `history.onVisited` deletes matches immediately (primary path).
   The handler `await`s the initial rules load (`ready` in background.js):
   a cold-started worker would otherwise check the waking visit against a
   still-empty list and miss it. Keep that gate on any new wake-time consumer
   of `blockedSites` (sweeps are immune — they re-read storage themselves).
2. Periodic — `alarms` every `SWEEP_INTERVAL_MINUTES` (30).
3. Startup — `runtime.onStartup`.
4. Manual — options page sends `CLEAN_NOW`; worker replies with count removed.

All four paths delete via `removeFromHistory(url, source)`, which logs every
removal to the worker console (`[History Auto-Cleaner] removed (<source>): …`)
— inspect it at chrome://extensions → service worker.

Sweeps exist to catch history that arrives via Chrome sync (doesn't fire the
live listener locally). `ensureAlarm` checks `alarms.get` before creating to
avoid duplicates. Every sweep writes `{ time, trigger, removed }` to
`storage.local.lastSweep`.

## Context menu → prefilled settings

Right-click on any http(s) page offers `contextMenuAddSite`. The click handler
in `background.js` turns `info.pageUrl` into a bare domain, writes it to
`storage.local.pendingSite`, and calls `openOptionsPage()`.

Three constraints shaped this and are easy to break by "improving" it:

- **The title can't name the site.** Rendering "…for reddit.com" means reading
  the active tab's URL before the click, i.e. the `tabs` permission — standing
  access to every tab's URL. Rejected deliberately; the domain goes into the
  input instead.
- **The hand-off goes through storage, not a URL parameter.**
  `openOptionsPage()` takes no arguments and reuses an already-open settings
  tab. `options.js` reads `pendingSite` two ways: on load (inside the
  `sites` read, so the duplicate check sees the real list) and via
  `storage.onChanged` (for a tab that was already open). Whoever reads it
  calls `storage.local.remove` — otherwise a later visit to settings arrives
  mysteriously prefilled.
- **The menu item is created in `onInstalled` only.** Menu items outlive the
  service worker; creating one on every wake throws a duplicate-id error.
  `ensureContextMenu` clears first so an updated title or UI language lands.

The item is scoped with `documentUrlPatterns: ["http://*/*", "https://*/*"]`,
and `domainFromUrl` re-checks the protocol — pages that can't produce a rule
never reach the settings page.

## Storage

- `chrome.storage.sync` → `sites` (the rule list). Synced across devices.
  **Quota:** one sync item is capped at 8 KB ≈ ~100–140 rules, and writes are
  rate-limited. All writes in `options.js` must go through `saveSites()` —
  persist-then-commit: the in-memory list only updates after the write lands,
  and failures are shown to the user. Never call `storage.sync.set` directly.
- `chrome.storage.local` → `lastSweep`, and `pendingSite` (the context-menu
  hand-off, written by the worker and cleared by the settings page). Device-
  local, 10 MB quota — not a concern.
- `toSiteConfigs` accepts the legacy `string[]` shape and the current
  `object[]` shape. Keep this back-compat when touching storage.

## Localization

UI copy belongs in `_locales/<lang>/messages.json` — never inline a
user-visible string in `options.js`. `en` is the `default_locale`, and Chrome
falls back to it per-message, so a partial translation is safe.

- **manifest**: `name`, `description` and `action.default_title` are
  `__MSG_key__` references.
- **options.html**: elements carry `data-i18n` (textContent),
  `data-i18n-placeholder` or `data-i18n-title`; `localizeDocument()` swaps
  them in at load. It skips missing keys rather than blanking the element,
  and no-ops entirely when `chrome.i18n` is absent (page opened as a file).
- **options.js**: `t(key, ...subs)` for a string, `tn(key, count)` for
  anything counted. `tn` resolves `<key>_one` / `_few` / `_many` / `_other`
  through `Intl.PluralRules`, so every locale needs each category its
  language actually has — English two, Spanish and Brazilian Portuguese
  three, Russian four. Ask `Intl`, don't guess: the count includes categories
  a human wouldn't think of (`other` for fractions, `many` for millions).
  `many` is not a spare copy of `other`: in both Spanish and Portuguese it is
  the millions form, where the counted noun takes "de" — "1.000.000 **de**
  elementos".
- Relative times come from `Intl.RelativeTimeFormat`, not from messages; only
  "just now" (`justNow`) is a string.
- `localizeDocument` also sets `<html dir>` from Chrome's predefined
  `@@bidi_dir` message. That covers text direction only — shipping an RTL
  language would also mean auditing the physical CSS (`margin-left`,
  `translateX`, `text-align: right`) in `options.css`.
- `background.js` is unlocalized apart from one string: the context-menu title,
  which it reads with `chrome.i18n.getMessage("contextMenuAddSite")`. Its other
  strings are console logs for whoever inspects the worker. `test/i18n.test.js`
  counts `background.js` as a reference site when looking for dead messages.

**Second duplication invariant:** the English text still in `options.html` is
a *fallback* for when the page runs outside the extension. It must stay
byte-identical to `_locales/en/messages.json`; `test/i18n.test.js` fails if
the two drift, so edit both together.

To add a language, copy `_locales/en/messages.json` into `_locales/<code>/`,
translate the `message` values (leave the keys, the `$PLACEHOLDERS$` and the
`description` fields alone), and cover the plural categories that language
needs. No code change.

Region-qualified folders use Chrome's underscore form (`pt_BR`, never
`pt-BR`). That string is *not* a valid BCP-47 tag: `new Intl.PluralRules("pt_BR")`
throws a `RangeError`, so anything constructing an `Intl` object from a folder
name has to convert it first (`bcp47()` in `test/i18n.test.js`). At runtime the
problem doesn't arise — `chrome.i18n.getUILanguage()` already returns the
hyphenated tag.

`<code>` has to be a row of Chrome's own locale table (chrome.i18n reference →
"Locales"); a folder Chrome doesn't recognize is skipped without an error,
leaving the UI in English. That table is why the two languages here are coded
the way they are. Portuguese has **no plain `pt`** — only `pt_BR` and
`pt_PT`, and neither falls back to the other, so `pt_PT` users read English
until someone adds that folder. (A bare `pt` folder does reach them, through
the region-stripping step of the lookup, but the Web Store ignores it: the
listing then can't be translated and doesn't show up as Portuguese.) Spanish
is the opposite — `es` is a real row and `es_419` falls back into it, so the
single folder covers every Spanish-speaking user, which is why it is written
in neutral Spanish rather than peninsular.

## Run / test

**Unit tests** cover the matching core (`test/matching.test.js`) and the
locale catalogues (`test/i18n.test.js`). The first loads `background.js` into
a `vm` sandbox with a mocked `chrome` global and asserts against the PRD's
matching examples; the second reads `_locales/`, `options.html` and
`manifest.json` as text and checks for untranslated keys, missing plural
forms, dropped placeholders and stale HTML fallbacks. Requires Node 18+, no
dependencies:

    npm test        # or: node --test

Add a case here for any change to the matching logic, and trace the PRD
examples by hand.

**Checking the options page without Chrome:** open `options.html` directly in
a browser. `chrome.*` is missing there, so the list and storage stay dead, but
the English fallback markup renders and the layout is real.

**Packaging:** `npm run pack` → `history-auto-cleaner.zip` via `git archive
HEAD` (runtime files only, zip root = extension root). If you add a runtime
file, add it to the pack script's pathspec list in `package.json`; it packages
the last commit, so commit before packing.

**Manual / end-to-end:**
1. `chrome://extensions` → enable Developer mode → Load unpacked → this folder.
2. Click the toolbar icon to open settings; add a rule.
3. Visit a matching page, then check `chrome://history` — it should be gone.
4. Use "Clean up now" to test existing-history cleanup; watch the status line.
Reload the extension from `chrome://extensions` after editing `background.js`.

## Conventions

- Keep it dependency-free and MV3-compliant.
- Don't add permissions or any network calls — privacy is the product.
- Match the existing plain-JS, comment-the-why style.
- Naming split, on purpose: UI copy says "clean up", but internal identifiers
  keep "sweep" (`sweepHistory`, `lastSweep` storage key, `periodicHistorySweep`
  alarm). Do NOT "fix" this — renaming the storage key or alarm needs a
  migration.
