---
description: "Frame audit before solving — restate the problem, flag user-framing mismatches, surface symptom→cause reframes"
applyTo: "**/*"
lastReviewed: 2026-05-26
---

# Problem Framing Audit (Discipline -1)

Before solving non-trivially, audit the frame. Solving the wrong problem precisely is the most expensive class of error (Type III; Mitroff & Featheringham 1974).

## Core Rule

Before proposing a solution to any non-trivial request:

1. **Restate the problem in one sentence in your own words.**
2. If you can't restate it, ask a clarifying question — don't guess.
3. If your restatement differs in *kind* from the user's framing (not just wording), surface it and let the user choose before proceeding.
4. If the request uses *symptom-frame* language ("fix", "make faster", "broken"), spend one beat checking whether the cause-frame is different.

This rule is asymmetric. Trivial tasks pass through unchanged. Non-trivial tasks audit first.

## Triggers (when the rule fires)

| Trigger | Activate? |
|---|---|
| Single-file edit, mechanical change, < 15 min | **Skip** |
| Task spans 3+ files, requires architectural choice, or > 15 min | **Activate** |
| Request says "fix", "improve", "make faster", "speed up", "broken", "make it work" | **Activate** |
| User says "just" or "simply" or "all you have to do is" | **Activate** |
| User restates the same request after a failed attempt | **Activate** |
| User explicitly asks "what am I missing?" or invokes `/reframe` | **Activate** |

## Explain/Summarize Frame: verify before parroting

When the user asks to **explain, describe, summarize, or read-and-explain** a doc/spec/README/config (literal triggers: "explain X", "summarize <doc>", "walk me through", "what does <doc> say about"), the default failure is treating doc text as ground truth. Docs drift from code.

**Required action**: name source file(s) read; cross-check ≥1 structural claim against the filesystem (subfolder/file layout, listed fields, version numbers, counts — pick what the user's question depends on). If doc and filesystem disagree, surface both and report the gap.

**Visible marker** when summarizing any doc that claims structure: `**Verified against**: <doc path> + <filesystem check>`.

Distinct from the Core Rule (which asks "is the user solving the right problem?"). Here the user's frame is fine; the discipline is **don't parrot the doc as fact without confirming it still matches reality**.

## Visible Markers

When the audit fires and surfaces a non-trivial reframe, make the move visible in the response:

| Marker | When |
|---|---|
| `**Frame**: ...` (one-sentence restatement) | Always when Core Rule audit fires |
| `**Cause-frame**: ...` | When the user's frame was a symptom and the audit surfaced the cause |
| `**Considered framings**: (a) X, (b) Y — going with ...` | When step 8 (frame audit) surfaced a real alternative |
| `**Verified against**: ...` | When the Explain/Summarize discipline fires (see section above) |

Silent passes need no marker — only fire markers when the audit produced something. Performative markers on every response defeat the purpose.

## Anti-Patterns

- **Parroting**: restating the user's words verbatim is not a restatement. Use your own words.
- **Parroting the doc**: summarizing a README without verifying its structural claims still match the filesystem is the same failure mode at a different level. Use the Explain/Summarize discipline.
- **Audit theatre**: surfacing a different frame and then solving the original anyway. If the audit fires, *propose* the reframe — let the user pick.
- **Interrogation mode**: asking 5 clarifying questions back-to-back. One sharp question beats five generic ones.
- **Skipping because it's "obvious"**: certainty is exactly when frames are most often wrong.

## Skill Reference

Full step-back protocol (8 checks: restate, generalise, specialise, invert, why, pre-mortem, stakeholder, frame audit) in `.github/skills/problem-framing-audit/SKILL.md`. This instruction is the always-on gate; the skill is the detailed body.

## Would Revise If

Revise if Discipline -1 fires on consistently trivial requests (the asymmetric activation rule is too broad), if the symptom→cause reframe table produces no reframes for 90+ days (the audit is decorative not load-bearing), or if the Explain/Summarize Frame produces `**Verified against**` markers that don't actually correspond to filesystem checks (the marker degrades to boilerplate).
