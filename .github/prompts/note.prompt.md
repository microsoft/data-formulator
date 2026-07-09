---
description: "Short alias for /save-session-note — write a quick pending-action note to repo-root HANDOFF.md"
lastReviewed: 2026-05-29
---

# Note

Alias for `/save-session-note`. Follow the same protocol — capture a short note to repo-root `HANDOFF.md` so pending actions remain visible on the project root.

See `.github/prompts/save-session-note.prompt.md` for the full steps.

## Quick Form

If the user's request already includes the note text, skip the "what should I capture?" question and write it directly. Resolve repo root, append checkbox item to `HANDOFF.md`, optionally mirror to the shared memory bus with stripping, confirm.

**Would revise if**: the [save-session-note](save-session-note.prompt.md) prompt changes its capture protocol, or `HANDOFF.md` is no longer the canonical pending-action surface. Re-evaluate 2026-08-26.
