---
description: "Save session state for handoff in repo-root HANDOFF.md (and mirror to the shared memory bus)"
lastReviewed: 2026-05-29
---

# Save Session Note

Capture a short observation, reminder, or open thread in repo-root `HANDOFF.md` so pending actions stay visible to the user across sessions.

## Steps

1. **Get the note from the user** — one or two sentences. If they didn't include one in the request, ask: "What should I capture?"
2. **Resolve repo root**:
   - If in a git repo, use the top-level root.
   - If not in a git repo, use the current workspace root.
3. **Upsert `HANDOFF.md`** at repo root. If missing, create this structure:

   ```markdown
   # Session Handoff

   Last updated: YYYY-MM-DD HH:MM

   ## Pending Actions
   - [ ] <user note>

   ## Resume Hint
   - Open this file first in the next session.
   ```

   If it exists, update `Last updated` and append the new item under `## Pending Actions` as `- [ ] <user note>`.
4. **Mirror to shared memory (optional but recommended)**: resolve memory bus via `resolveMemoryBus()` (sibling `../Alex_ACT_Memory`). Append to `notes.md` at that root, creating the file if needed. Format:

   ```markdown
   ## YYYY-MM-DD HH:MM (heir: <heir_id>)
   <user's note>
   ```

   Use today's local date and time. Read `heir_id` from `.github/.act-heir.json` if available; otherwise omit the parenthetical.

5. **Strip per `cross-project-isolation.instructions.md` for the shared-memory mirror only** — no file paths, client names, PII. If the mirrored note contains those, ask the user to rephrase before writing to the shared bus. (Project-local `HANDOFF.md` can include project context.)
6. **Confirm** by quoting the line added to `HANDOFF.md` and its file path.

## Notes

- Canonical handoff artifact is repo-root `HANDOFF.md` (renamed from `SESSION-HANDOFF.md` in Edition v1.3.1, 2026-05-18, to unify with `memory-triggers.instructions.md` and the user-named cross-session-continuity convention).
- Shared-memory mirror is for cross-project continuity and searchability.
- Keep notes terse and action-oriented.

## Legacy migration

If the heir repo still has a `SESSION-HANDOFF.md` at root from before the rename, mention it in the confirm step (do not auto-merge): suggest the user manually review and either merge content into `HANDOFF.md` or delete the legacy file. Never silently discard content the heir may still need.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
