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

**Export / Import:** back up or move your rule list as JSON. Import *merges* —
it never wipes existing rules.

## How cleaning happens

- **Live** — pages are deleted the moment you visit them.
- **Every 30 minutes** and **on Chrome startup** — a full sweep catches history
  synced from other devices.
- **Sweep now** — trigger an immediate sweep from the settings page.

## Permissions

`history`, `storage`, `alarms` — nothing more. No network access.

## Development

See [CLAUDE.md](CLAUDE.md) for architecture and the matching-logic rules, and
[docs/PRD.md](docs/PRD.md) for the full product spec.

## Packaging for the Chrome Web Store

    npm run pack

Creates `history-auto-cleaner.zip` (gitignored) containing only the runtime
files — manifest, scripts, options page, icons. No tests, docs, or repo
config. Upload the zip as-is in the developer dashboard.

Note: it packages the last **commit** (`git archive HEAD`), not the working
tree — commit your changes first. Without Node/npm, the underlying command
works in any terminal:

    git archive --format=zip -o history-auto-cleaner.zip HEAD -- manifest.json background.js options.html options.css options.js icons
