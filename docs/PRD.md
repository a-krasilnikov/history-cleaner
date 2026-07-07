# History Auto-Cleaner — Chrome Extension: Product Requirements

## What is this?

A Chrome extension that quietly removes specific websites from the user's
browsing history — automatically, in the background. The user configures a list
of domains (or sub-sections of a domain) they don't want to appear in their
history. The extension then makes sure those pages never stick around.

## How it should feel

The user adds a site once and forgets about it. There's nothing to run
manually, no schedule to think about. Pages just disappear from history as
they're visited, and any old ones get cleaned up in the background every
30 minutes.

The settings page should be simple enough that a non-technical user can figure
it out in under a minute.

## The settings page

This is the only UI in the extension. It opens when the user clicks the
extension's toolbar icon.

### Adding a rule

There's a text input and an "Add site" button. The user types a domain or a
path-scoped URL:

- `instagram.com` — removes all pages on Instagram
- `site.com/forum/` — removes only the forum section, leaving the rest of the
  site alone

The input should be forgiving. It doesn't matter if the user types `https://`,
`www.`, includes a trailing slash or not — it all gets normalized to the same
thing internally. Validation should only reject things that genuinely aren't
domains (e.g. random words with no dot).

Below the input is a toggle: "Keep the exact page above, only delete deeper
ones". When turned on:

- Adding `instagram.com` → `instagram.com/` stays in history, but
  `instagram.com/p/abc123` gets deleted
- Adding `site.com/forum/` → `site.com/forum/` stays, but
  `site.com/forum/some-post` gets deleted

This lets the user keep a homepage or section index visible in history while
hiding all the actual content they browsed.

### The rule list

Added rules appear below the input. Each row shows:

- The domain or path (e.g. `site.com/forum/`) in bold
- A note saying subdomains are also covered
- A remove button (✕) to delete the rule
- A per-rule toggle for the "keep root page" behaviour described above — this
  can be changed at any time, not just when adding

The toggle label adapts to context: for a bare domain it says "Keep homepage",
for a path-scoped rule it says "Keep this page itself".

Rows animate out when removed (fade + slight slide). The heading shows a live
count of active rules.

### Export and Import

Two small buttons sit next to the "Blocked sites" heading.

**Export** downloads the current rule list as a JSON file. Useful for backup or
moving settings to another machine.

**Import** lets the user load a JSON file back in. It merges — it doesn't wipe
and replace. Rules that already exist get their settings updated; new ones are
added. Nothing is deleted during an import.

### Sweep status

At the bottom of the page, below a "Sweep now" button (more on that below),
there's a one-liner showing when history was last cleaned and what happened:

> Last automatic sweep: 12 minutes ago — removed 4 entries.

This updates live whenever a sweep finishes.

## How deletion actually works

There are four ways pages get removed from history:

1. **In real time.** Whenever the user visits any page, the extension checks it
   against the rule list. If it matches, it's deleted from history immediately.
   This is the primary mechanism and handles the vast majority of cases.
2. **Every 30 minutes.** A background alarm runs a full sweep of the user's
   entire history. This is a safety net — it catches pages that might have
   arrived via Chrome's sync from another device (those don't always fire the
   live listener locally).
3. **On Chrome startup.** A sweep runs automatically when Chrome launches. Same
   idea — cleans up anything that synced in while Chrome was closed.
4. **On demand.** The "Sweep now" button in the settings page triggers an
   immediate sweep. The button shows feedback while it runs and reports how
   many entries were removed.

After each sweep (of any kind), the extension saves a record of when it ran,
what triggered it, and how many entries were removed. The settings page shows
this to the user.

## Matching rules — the exact logic

This is the most important part to get right.

### Domain matching

A rule for `site.com` matches:

- `site.com` itself
- `www.site.com`
- `sub.site.com`
- Any other subdomain

It does **not** match `othersite.com` or `mysite.com`.

### Path scoping

A rule without a path (just a bare domain) covers the entire domain — every
page on it.

A rule with a path, like `site.com/forum/`, only covers URLs whose path starts
with `/forum/`. So:

- `site.com/forum/` → matched (deleted)
- `site.com/forum/some-post` → matched (deleted)
- `site.com/` → not matched (kept)
- `site.com/about` → not matched (kept)
- `site.com/forums` → not matched (the path must start with `/forum/`, not
  just `forum`)

This scoping also applies to subdomains. A rule for `site.com/forum/` will also
match `sub.site.com/forum/some-post`.

Matching is case-insensitive throughout: `site.com/Forum/post` is treated the
same as `site.com/forum/post`. Rules are stored lowercase.

### When two rules could apply, the more specific one wins

If the user has both `site.com` (whole domain) and `site.com/forum/` (just the
forum), a URL like `site.com/forum/post` matches both. The more specific rule —
the one with the longer path — takes effect. This lets the user configure
exceptions and overrides cleanly.

### The "keep root" toggle in detail

When the "keep this page itself" toggle is on for a rule, the page at exactly
that path is kept, but everything nested under it is still deleted.

For `site.com/forum/` with the toggle on:

- `site.com/forum/` → kept ✓
- `site.com/forum` → kept ✓ (same page, just without trailing slash)
- `site.com/forum/some-post` → deleted ✗
- `site.com/forum/subforum/thread` → deleted ✗

## Data storage

Rules are stored in `chrome.storage.sync`. This means they automatically sync
across all Chrome instances where the user is signed in — add a rule on one
computer and it appears on another.

Each rule is stored as:

```json
{
  "domain": "instagram.com",
  "path": "/",
  "keepHomepage": false
}
```

`path` is always normalized: it starts with `/` and ends with `/`. A bare
domain gets path `"/"`.

Sweep history (last run time, trigger, count removed) is stored in
`chrome.storage.local` — local to the device, not synced.

## Permissions

The extension requests exactly three permissions:

- `history` — to read and delete history entries
- `storage` — to save the user's rule list
- `alarms` — to schedule the 30-minute background sweep

No network access. No data ever leaves the user's machine.

## Edge cases to handle

- User pastes a full URL like `https://www.instagram.com/p/abc?utm_source=x`
  into the input — should be normalized cleanly to `instagram.com` with path
  `/p/abc/`.
- Duplicate rules — if the user tries to add a rule that already exists (same
  domain + same path), show an inline message rather than silently ignoring or
  adding a duplicate.
- Empty export — if the user clicks Export with no rules, show a message rather
  than downloading an empty file.
- Import with bad data — if the file isn't valid JSON or has no recognizable
  rules, show an error message. Don't crash.
- Alarm persistence — the 30-minute alarm should be set up on install and on
  startup. Before creating it, check whether it already exists to avoid
  duplicates.
