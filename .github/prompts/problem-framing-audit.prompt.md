---
description: "Audit the framing of a problem before solving — restate, generalise, specialise, invert, ask why, pre-mortem, check stakeholders, surface alternative framings"
lastReviewed: 2026-05-26
---

# Problem Framing Audit

Run the step-back protocol on a non-trivial problem before committing to a solution. The most expensive class of error is solving the wrong problem precisely (Type III error). The always-on `problem-framing-audit.instructions.md` keeps a passive frame check active; this prompt forces a deliberate audit when the work earns it.

Skill: [problem-framing-audit](../skills/problem-framing-audit/SKILL.md). Always-on rule: [problem-framing-audit.instructions.md](../instructions/problem-framing-audit.instructions.md).

## When to Use

- Before solving any non-trivial problem (3+ files, architectural choice, > 15 minutes of work)
- When the request uses symptom-frame language ("fix", "make faster", "broken", "just do X")
- When a previous attempt at the same problem failed
- When the user invokes "what am I missing?" or asks for a sanity check
- When you (the AI) feel certain — that's exactly when frames are most often wrong

## Steps

1. **Restate** the problem in one sentence in your own words. If you can't, ask one sharp clarifying question.
2. **Run at least one** of the eight step-back checks (don't run all eight — pick the highest-leverage for this problem):
   - **Generalise** — what is this a special case of?
   - **Specialise** — what's the simplest concrete instance?
   - **Invert** — what would make this worse? what's the failure mode?
   - **Five Whys** — surface the cause-frame underneath the symptom-frame
   - **Pre-mortem** — imagine it's done and didn't work; what went wrong?
   - **Stakeholder check** — whose problem is this? What outcome would tell *them* it's solved?
   - **Frame audit** — what other framings exist? At least two.
3. **Surface symptom→cause moves**. The most common reframe: the user named a symptom and the audit reveals the cause is different. Examples:
   - "Make this function faster" → function is fine; called 1000× when it should be called 1×
   - "Fix this flaky test" → test is correct; system has a real race condition
   - "Add a workaround for this API quirk" → quirk is the API enforcing a real constraint
4. **Output visible markers** when the audit produces something:
   - `**Frame**: <one-sentence restatement>` — always when audit fires
   - `**Cause-frame**: <reframe>` — when symptom→cause is real
   - `**Considered framings**: (a) X, (b) Y — going with X because ...` — when frame audit surfaced a real alternative
5. **Propose, don't silently solve.** If the audit surfaces a different framing, *propose it before solving*. Let the user choose between symptom and cause.

## Output Format

```text
**Frame**: <restated problem in one sentence>
**Steps run**: <which 1-3 of the 8 checks>
**Cause-frame**: <if symptom→cause move was made, the reframe; else "kept symptom-frame">
**Considered framings**: (a) ..., (b) ... — going with ... because ...

**Recommendation**: <solve as framed | propose reframe before solving>
```

## Boundaries

- **Don't run on trivial work.** Single-file edits, mechanical tasks, < 15-min jobs skip this prompt.
- **One sharp question beats five generic ones.** If you need to clarify, ask once and stop.
- **Don't run all eight checks.** Pick the one or two most likely to surface a different framing.
- **Frame audits that find nothing are still successful.** Say "frame holds" and proceed — silent passes need no markers.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
