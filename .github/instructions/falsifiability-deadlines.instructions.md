---
description: "Every new or edited brain artefact (instruction / skill / prompt / agent) must declare a specific falsification deadline — a literal date, an observable event, or count+time bound — not 'after N passes' or 'when conditions warrant'."
applyTo: "**/.github/instructions/**,**/.github/skills/**,**/.github/prompts/**,**/.github/agents/**"
lastReviewed: 2026-05-26
---

# Falsifiability deadlines

Every brain artefact must commit to a **specific falsification deadline** at creation time, not "after N passes" or "when conditions warrant." Vague kill-criteria let an artefact's falsification be indefinitely deferred while the artefact accumulates token cost and authority in the brain.

Lifted from Karpathy_Loop's Phase 2b meditation diagnosis (2026-05-23) and adopted as Supervisor always-on per the brain-qa-2026-05-24-02 proposal (Supervisor-only artefact).

## The rule

Every artefact's `## Falsifiability` or `## Would Revise If` section must include at least one of:

1. **Date-based deadline**: "If <condition> not met by <YYYY-MM-DD>, sunset this artefact."
2. **Event-based trigger**: "If <observable event> occurs without the artefact firing as designed, sunset this artefact."
3. **Count-based with time bound**: "If after N <units> AND by <YYYY-MM-DD>, <condition> hasn't held, sunset this artefact." (N-only is **not** sufficient.)

The deadline must be specific enough that "did it happen?" is answerable by a third party reading the brain six months later.

## What this prevents

| Failure mode | Without deadline | With deadline |
|---|---|---|
| Skill never invoked, no one notices | Accumulates in brain indefinitely | At deadline, gets evaluated; if unused, sunsets |
| Skill invoked but never produces signal | No clock running | Deadline forces explicit "did it produce signal?" check |
| Author hopes future evidence will materialise | Hope continues indefinitely | Hope expires on date D |
| Reader can't tell if artefact is alive or stalled | No sunset clock | Sunset triggers on a known schedule |

## What this doesn't require

- Aggressive deadlines. "60 days from creation" is fine if that's a realistic test window. The point is *commitment*, not haste.
- Single-point falsification. An artefact can have multiple falsification paths (date + event, or multiple events).
- Retroactive application to *all* existing artefacts. Files created before 2026-05-24 are unaffected until separately swept. The bulk sweep is a follow-up to this proposal.

## Template

Add to the artefact's `## Falsifiability` (skills) or `## Would Revise If` (instructions) section:

```markdown
**Falsification deadline**: <date-based, event-based, or count+time bound>
- If <condition> by <date>, sunset this rule (delete the file or strip it to a stub).
```

A "sunset" is a single decisive action at the deadline: either the rule has earned its keep (revise and reset the deadline) or it hasn't (remove it). There is no intermediate marker. The next quarterly retraining pass picks up un-acted-on deadlines.

Long-lived artefacts that have already survived one full quarterly retraining pass with ≥ 6 months of evidence may drop the deadline. New or recently-edited artefacts always carry one.

## Diversity audit (gate)

Per Supervisor's four-repos comparison tracker (§0.1 row 2), after this instruction is active the first 5 new-or-edited artefacts that adopt a deadline are audited for diversity. If all 5 pick the same boilerplate date or all 5 use the same event template, the rule has degraded to ritual and we sharpen the requirement.

## Anti-patterns

| Anti-pattern | Correction |
|---|---|
| "Falsification deadline: when we have evidence" | Vague. Specify a date or an observable event. |
| "After 5 passes" with no time bound | Insufficient. Add a date ("by YYYY-MM-DD") so passes can't be indefinitely deferred. |
| Setting unrealistic deadlines to look rigorous | Defeats the purpose. Pick a date that actually tests the artefact's value. |
| Skipping deadline because "this artefact is obviously load-bearing" | Especially load-bearing artefacts need deadlines. The whole point is preventing self-justification. |
| Copy-pasting the same deadline across artefacts | Diversity audit will catch this. Each artefact has its own test window. |

## Self-application

This instruction is itself provisional and so this rule applies to it.

**Falsification deadline (this instruction)**:

- **Event**: 5 new or materially edited brain artefacts created with this instruction active. If the deadline declaration is consistently absent, ignored, or treated as boilerplate, sunset this instruction.
- **Date**: 2026-08-23 (90 days from adoption). If by then this instruction hasn't fired on at least 2 new artefacts AND those deadlines haven't influenced any concrete sunset decision, sunset this instruction.

## Would Revise If

Revise this instruction if:

- The deadline declaration becomes boilerplate (every artefact picks the same date or template) — sharpen the requirement
- Multiple artefacts hit their deadline simultaneously and produce a cascading sunset that destabilises the brain — revisit pacing
- Setting deadlines becomes the bottleneck for creating new artefacts (paralysis-by-deadline) — relax the rule for low-stakes artefacts

**Falsification deadline**: 2026-08-23 (date-based), 5 new artefacts adopting deadlines (event-based). Whichever fires first.
