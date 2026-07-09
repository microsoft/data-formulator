---
description: "Run the greeting check-in on demand — Edition version + shared memory announcements"
lastReviewed: 2026-05-29
---

# Check-in

Run the full check protocol from [greeting-checkin/SKILL.md](../skills/greeting-checkin/SKILL.md), regardless of whether a greeting fired today.

## Steps

1. **Confirm heir** — read `.github/.act-heir.json`. If absent, refuse and suggest `/initialize`.
2. **Check Edition version** — `node .github/scripts/upgrade-self.cjs` (dry-run); compare to current `edition_version`.
3. **Scan the shared memory bus** — check the announcements folder (resolution order in the skill); list anything newer than `last_sync_at`.
4. **Report** — one short paragraph or a tight bullet list. Don't lecture.
5. **Rewrite the marker** — overwrite `/memories/session/greeting-checkin.md` with today's findings so the greeting trigger stays quiet for the rest of the session.

If the user wants to act on findings, point them at `/upgrade` for version bumps and at the shared memory bus for announcements.

**Would revise if**: the [greeting-checkin](../skills/greeting-checkin/SKILL.md) skill changes its check protocol, or `upgrade-self.cjs` changes its dry-run output shape. Re-evaluate 2026-08-26.
