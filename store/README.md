# Web Store listing copy

The **detailed description** of the Chrome Web Store listing, one file per
language. These are dashboard-only fields — nothing here ships in the
extension, and `npm run pack` deliberately leaves this folder out of the zip.
They live in git so the listing has a history and a diff like everything else.

| File | Dashboard field |
|------|-----------------|
| `description.en.txt` | Store listing → English → Description |
| `description.ru.txt` | Store listing → Русский → Description |
| `description.pt_BR.txt` | Store listing → Português (Brasil) → Description |

## What is localized where

- **Detailed description**, screenshots and the promotional video are per-locale
  in the dashboard: pick the language in the listing editor, then paste.
- **Name and short description** are *not* edited there — they come from the
  packaged extension, i.e. `_locales/<lang>/messages.json` (`appName`,
  `appDescription`, max 132 characters). Don't retype them here; changing them
  means shipping a new version.
- The small tile and the Marquee promo tile cannot be localized at all.

## Editing

Plain text — the store renders no Markdown, but it does keep line breaks, so
the blank lines and the `•` bullets survive a copy-paste. Keep the two
languages structurally in step: same sections, same bullet order. A locale
with no listing of its own falls back to the default language, so a partial
translation is safe.
