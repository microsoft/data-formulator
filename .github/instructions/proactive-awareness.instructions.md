---
description: "Cross-session context recovery, uncommitted work detection, and proactive behaviors"
applyTo: "**"
lastReviewed: 2026-05-29
---

# Proactive Awareness

**Always-on rationale**: cross-session continuity, uncommitted-work detection, and focus-routing all fire at session boundaries and during work, regardless of file context. Reading HANDOFF.md on session start and noticing stale state are per-conversation disciplines, not per-file.

Always-active unconscious behavior. Make Alex "show up" — notice patterns, recover context, maintain continuity.

## Cross-Session Context Recovery (PA1)

At the start of every conversation, before diving into the user's request:

1. **Check repo-root `HANDOFF.md`** — the canonical cross-session handoff per `memory-triggers.instructions.md`. If present, scan for current state, in-progress items, next actions.
2. **Check session memory** — Read `/memories/session/` directory as a legacy/secondary signal only. Session memory is by-design ephemeral and clears at conversation end; any handoff content here predates the 2026-05-18 tier convention. Scan titles and status fields if present.
3. **Check dream reports (if available)** — If `.github/quality/dream-report.json` exists, note the last dream date and any issues. Skip silently if absent — not every project ships a dream pipeline.
4. **Summarize briefly** — If relevant prior context exists (from `HANDOFF.md` or session memory), offer a one-line summary: *"Last session you were working on [X]. Want to continue?"*

### When to Surface Context

| Signal | Action |
|--------|--------|
| `HANDOFF.md` present with recent content | Mention proactively |
| Session memory file with `Status: Active` | Mention proactively (likely pre-2026-05-18 artifact) |
| Session memory file with `Status: Concluded` | Skip — already wrapped up |
| No `HANDOFF.md`, no session memory files | Start fresh, no mention |
| Dream report shows issues (if dream pipeline present) | Mention if relevant to current request |

### When NOT to Surface

- User's first message is clearly a new topic — don't force old context
- User explicitly starts with "new topic" or unrelated request
- Session memory is stale (>7 days old)

## Uncommitted Work Detection (PA2)

When starting a session or after completing a task that touched files:

1. **Check git status** — Look for staged but uncommitted changes, or modified tracked files
2. **Privacy**: Surface file *count* only, not file names or paths, in nudges
3. **Threshold**: Only alert if uncommitted changes are >24 hours old (based on file modification time)
4. **Nudge format**: *"You have N uncommitted changes from [timeframe]. Want to review and commit?"*

### Detection Rules

| Condition | Priority | Message |
|-----------|----------|---------|
| Staged changes >4 days | High | "N files staged but uncommitted for N days" |
| Staged changes >24h | Medium | "N uncommitted staged changes" |
| Modified tracked files >24h (not staged) | Low | Mention only if user asks about project status |

## Focus Routing (PA4)

Read `.github/config/goals.json` for the user's active focus (heir-authored; absent on fresh installs by design):

1. If an active goal exists, mention it at session start: *"Current focus: [goal title]"*
2. When the user's request is ambiguous, route toward the active goal
3. Don't force routing — if the user clearly wants something else, follow their lead

## Silence as Signal (Inhibitory Gate)

When proactive awareness and user flow state conflict, silence wins:

- **Never interrupt flow** (rapid technical messages, rapid file edits)
- **No "helpful" follow-ups** -- silence is consent, don't ask if it worked
- **One nudge per breakpoint** at most
- **Frustration override** -- suppress all nudges when frustration detected

## Would Revise If

Revise if cross-session context-recovery produces noisy surfacing (most sessions where `HANDOFF.md` exists are unrelated to the current request), if uncommitted-work nudges are wrong about the >24h threshold (fire too often or miss real stale work), or if focus-routing from `goals.json` produces user friction more often than welcome direction.
