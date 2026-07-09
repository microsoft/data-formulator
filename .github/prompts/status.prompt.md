---
description: "Session-start orientation — heir identity, git state, uncommitted age, unread announcements"
lastReviewed: 2026-05-26
---

# Status

Run at session start (or anytime) to surface where things stand. Read-only — never modifies anything.

## Steps

1. **Identity** — read `.github/.act-heir.json`. Report:
   - `heir_id`, `edition_version`, `last_sync_at`
   - If `last_sync_at` is older than 30 days, flag: "Edition may be stale — try `/upgrade`"

2. **Git state** — run `git status --porcelain` and `git log -1 --format="%h %s (%cr)"`:
   - Uncommitted file count
   - Oldest uncommitted file age (use `git status` + `git diff --name-only` + check mtimes)
   - Last commit hash, subject, relative time
   - If uncommitted >24h old, surface as a soft nudge (not a demand)

3. **Announcements** -- resolve shared memory bus via `resolveMemoryBus()` (sibling `../Alex_ACT_Memory`; CLI: `node .github/scripts/_registry.cjs --resolve .`). Read `<root>/announcements/*.md` if it exists.
   - Read `<root>/announcements/.acks.json` (if missing, treat as empty `{}`)
   - List unacknowledged announcements (filename not in `.acks.json[heir_id]`)
   - Show their titles + dates. Don't mark them read — the user does that with `/news`

4. **Output format** — terse table:

   ```
   Heir:        <heir_id> (Edition v<x.y.z>, synced <relative time>)
   Last commit: <hash> <subject> (<when>)
   Uncommitted: N files (oldest <age>)
   Unread news: N announcements
   ```

5. **Suggestions** (only if applicable):
   - Stale Edition → `/upgrade`
   - Old uncommitted work → "want to review with `git diff`?"
   - Unread announcements → `/news`
   - Nothing pending → "All clear."

## Refuse if

- Not in a git repo (suggest the user `cd` into a heir first)
- `.act-heir.json` missing (suggest bootstrap)

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
