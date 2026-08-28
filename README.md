# History Auto-Cleaner

[![test](https://github.com/a-krasilnikov/history-cleaner/actions/workflows/test.yml/badge.svg)](https://github.com/a-krasilnikov/history-cleaner/actions/workflows/test.yml)

A Chrome (Manifest V3) extension that quietly removes chosen sites from your
browsing history — automatically, in the background. Add a site once and forget
it; matching pages never stick around. Nothing leaves your machine.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the toolbar icon to open settings.

## Usage

Add a rule by typing a domain or a path-scoped URL:

- `example.com` — removes every page on the site (and all subdomains).
- `site.com/forum/` — removes only the `/forum/` section, leaving the rest.

Input is forgiving: `https://`, `www.`, query strings, and trailing slashes are
all normalized away.

**Keep the root page:** the per-rule toggle keeps the exact page itself (e.g.
`example.com/` or `site.com/forum/`) while still deleting everything nested
under it.

**From the page itself:** right-click anywhere on a site and pick
*"Auto-clean history for this site…"* — settings open with that domain already
in the input. You still press **Add site**, so the keep-root toggle stays
available and nothing is added by accident.

**Filter:** the box next to the "Blocked sites" heading narrows the list to
rules containing what you type — handy for checking whether a site is already
on it. Escape clears it.

**Export / Import:** back up or move your rule list as JSON. Import *merges* —
it never wipes existing rules.

## How cleaning happens

- **Live** — pages are deleted the moment you visit them.
- **Every 30 minutes** and **on Chrome startup** — a full clean-up catches
  history synced from other devices.
- **Clean up now** — trigger an immediate clean-up from the settings page.

## Languages

The settings page follows your browser's language. English, Russian, Brazilian
Portuguese and Spanish ship today; any other language falls back to English.
Translations live in `_locales/<lang>/messages.json` — adding one is a folder,
not a code change.

## Permissions

`history`, `storage`, `alarms`, plus `contextMenus` and `activeTab` for the
right-click shortcut — `activeTab` reads only the page you right-clicked, only
at that moment. No host permissions, no network access.

## Development

See [CLAUDE.md](CLAUDE.md) for architecture and the matching-logic rules, and
[docs/PRD.md](docs/PRD.md) for the full product spec.

## Packaging for the Chrome Web Store

    npm run pack

Creates `history-auto-cleaner.zip` (gitignored) containing only the runtime
files — manifest, scripts, options page, icons, translations. No tests, docs,
or repo config. Upload the zip as-is in the developer dashboard.

Note: it packages the last **commit** (`git archive HEAD`), not the working
tree — commit your changes first. Without Node/npm, run the `pack` script's
`git archive` command (see `package.json`) directly in any terminal.
