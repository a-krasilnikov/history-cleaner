# CLAUDE.md

Guidance for working in this repo. Read before editing.

## What this is

**History Auto-Cleaner** — a Manifest V3 Chrome extension that auto-deletes
browser-history entries for user-configured sites. No build step, no
dependencies, no network access. Load unpacked to run (see below).

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest. Permissions: `history`, `storage`, `alarms`. No host permissions — keep it that way. |
| `background.js` | Service worker. The cleaning engine: live listener + sweeps + matching logic. |
| `options.html/.css/.js` | The only UI. Opens on toolbar-icon click. Vanilla JS, no framework. |
| `icons/` | 16/48/128 px action + extension icons. |
| `docs/PRD.md` | Product spec — source of truth for intended behavior, matching examples, edge cases. |

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
- `findMatch`: when multiple rules match, the one with the **longest path**
  wins (specificity). Note: domain specificity is NOT a tiebreaker — only path
  length is.
- `keepHomepage`: when true, the section root (`path`, with or without trailing
  slash) is kept; everything deeper is still deleted. See `isSectionRoot`.

Any change here must still satisfy every example in `docs/PRD.md`
("Matching rules — the exact logic"). Trace them by hand.

## Known quirks (documented, not yet decided)

- **Path case:** rules are lowercased on input, but matching compares against
  the raw `url.pathname` (case-sensitive). A rule typed `site.com/Forum/` is
  stored as `/forum/` and will NOT match `/Forum/post`. Likely a latent bug;
  the fix is to lowercase the pathname before matching — in BOTH files. Awaits
  a product decision; the PRD is silent on path case.
- **Tiebreak:** when two matching rules have equal path length (e.g. rules for
  `site.com` and `sub.site.com`, both path `/`), the winner is storage order,
  not domain specificity. The PRD only defines path-length specificity.

## Magic numbers

- Sweep reads up to `maxResults: 100000` history items per pass.
- Status toast auto-clears after 3200 ms (`options.js`).
- Row-remove animation: 180 ms JS delay paired with a 0.2 s CSS transition.

## Four deletion paths (background.js)

1. Live — `history.onVisited` deletes matches immediately (primary path).
2. Periodic — `alarms` every `SWEEP_INTERVAL_MINUTES` (30).
3. Startup — `runtime.onStartup`.
4. Manual — options page sends `CLEAN_NOW`; worker replies with count removed.

Sweeps exist to catch history that arrives via Chrome sync (doesn't fire the
live listener locally). `ensureAlarm` checks `alarms.get` before creating to
avoid duplicates. Every sweep writes `{ time, trigger, removed }` to
`storage.local.lastSweep`.

## Storage

- `chrome.storage.sync` → `sites` (the rule list). Synced across devices.
- `chrome.storage.local` → `lastSweep`. Device-local.
- `toSiteConfigs` accepts the legacy `string[]` shape and the current
  `object[]` shape. Keep this back-compat when touching storage.

## Run / test

No test suite. To test manually:
1. `chrome://extensions` → enable Developer mode → Load unpacked → this folder.
2. Click the toolbar icon to open settings; add a rule.
3. Visit a matching page, then check `chrome://history` — it should be gone.
4. Use "Sweep now" to test existing-history cleanup; watch the sweep status line.
Reload the extension from `chrome://extensions` after editing `background.js`.

## Conventions

- Keep it dependency-free and MV3-compliant.
- Don't add permissions or any network calls — privacy is the product.
- Match the existing plain-JS, comment-the-why style.
