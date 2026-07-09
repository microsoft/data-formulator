---
description: "Greeting-triggered check-in — when the user opens the session with a greeting, run the Edition + shared memory bus check before responding"
applyTo: "**/*checkin*,**/*greeting*,**/*welcome*,**/*hello*,**/*hey*"
lastReviewed: 2026-05-29
---

# Greeting Check-in

When the **first user message** of a session reads as a greeting, treat it as a cue to do a quick health check before replying. This is the heir's pull-based replacement for the deleted auto-update GitHub Action.

## Trigger

Fire when **all** of these hold:

1. This is the first non-trivial user message in the current session
2. The message reads as a greeting — see [greeting-checkin/SKILL.md](../skills/greeting-checkin/SKILL.md) for the recogniser
3. No `/memories/session/greeting-checkin.md` marker exists from the current session

If any of those fails, suppress — don't run the check, just respond conversationally. A second "hi" mid-session is small talk, not a trigger.

## What to do when it fires

Run the check protocol in [greeting-checkin/SKILL.md](../skills/greeting-checkin/SKILL.md). Surface the findings inside the greeting reply — one short paragraph or a tight bullet list. Don't lecture. After running, write the session marker so the rest of the session is unaffected.

If the user explicitly invokes `/checkin`, run the same protocol regardless of trigger state and rewrite the marker.

## Why this exists

The Edition used to ship a GitHub Action that opened weekly PRs against heirs. That was push-based, opt-in only, and silently broke when PATs expired. The greeting check-in is pull-based: the heir checks itself when there's already a natural break in the conversation, and only when the user is paying attention.

## Anti-patterns

| Anti-pattern | Correction |
|---|---|
| Running on every "hi" within a session | Marker file gates to once per session |
| Long preamble in the greeting reply | One paragraph, max — link to `/checkin` for detail |
| Running silently with no user-visible findings | If you ran the check, say what you found, even if it's "nothing new" |
| Treating "thanks" or "ok" as a greeting | Greeting recogniser is conservative; if in doubt, don't fire |

## Would Revise If

Revisit this instruction by **2026-08-26** (90 days) or sooner if any of the following fires: the greeting-checkin skill's check protocol substantively changes; the marker-file gate fails to suppress repeated firing within a session; or user feedback indicates the once-per-session cadence is wrong (too noisy or too silent).
