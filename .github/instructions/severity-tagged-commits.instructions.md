---
description: "Every commit touching brain artefacts (instructions / skills / prompts / agents / scripts / config / docs/ledgers / HANDOFF) must carry a severity tag in the commit subject: [typo | clarification | behaviour | constitutional]. [behaviour] and [constitutional] require an ACT pass before commit."
applyTo: "**/.github/**,**/docs/**,**/HANDOFF.md,**/CHANGELOG.md,**/VERSION,**/README.md"
lastReviewed: 2026-05-27
---

<!-- intentional divergence from Supervisor: Edition `applyTo` omits `ACT/**` (heirs don't ship the framework folder); Brain-qa-changelog integration is generalized (no Supervisor-only `brain-curation-rules` cross-ref); Edition's trigger list includes `.github/scripts/**` (Supervisor keeps scripts at root). Audited 2026-05-26, retained 2026-05-27. -->

# Severity-tagged brain edits

Every commit that touches a brain artefact must carry a severity tag. The tag determines the level of pre-commit scrutiny required and restores credit-assignment fidelity that flat commit lists destroy — without tags, a typo fix and a constitutional rule change have identical weight in `git log`.

Lifted from Karpathy_Loop's heir-side discipline (Phase 3 deliverable, 2026-05-23) and adopted as Supervisor always-on per the brain-qa-2026-05-24-02 proposal (Supervisor-only artefact).

## The four tiers

| Tier | When to use | ACT-pass required? | Examples |
|---|---|---|---|
| `[typo]` | Pure typo, formatting, spelling, link fix. No content semantics change. | No | "fix typo in skill description", "wrap long line", "repair broken markdown link" |
| `[clarification]` | Wording change that sharpens an existing rule without changing what it does. | No | "rephrase ambiguous instruction", "add example to clarify existing rule", "expand acronym on first use" |
| `[behaviour]` | Changes what the AI does — adds a new rule, modifies an existing trigger, introduces a new skill / prompt / muscle / instruction. | **Yes** (trimmed pass minimum, per [act-pass.instructions.md](act-pass.instructions.md)) | "add brain-review trigger condition", "new meditation skill", "lower default temperature" |
| `[constitutional]` | Changes a rule that other rules depend on — governance, hard floors, the ACT framework itself, Cardinal Rules, severity-tag rules. | **Yes** (full pass; visible markers in commit message body) | "broaden whole-plan kill criterion", "rebrand identity", "promote Mall plugin to bundled tier", "fleet-wide policy change" |

## Where the tag goes

In the commit subject line, **first thing after any conventional-commits prefix**:

```text
[typo] fix broken link in append-and-review/SKILL.md
[clarification] sharpen Phase 1 deliverables checklist in PLAN.md
[behaviour] add severity-tagged-commits always-on instruction
[constitutional] broaden whole-plan kill criterion to permit any premise-undermining finding
```

Conventional-commits style (`feat:`, `fix:`, `docs:`) is optional — the severity tag is the load-bearing element. If using both:

```text
feat(skills) [behaviour]: add meditation-reflection skill
docs [clarification]: update HANDOFF.md for next-session state
```

## Mixed-commit rule

A commit that touches multiple artefacts at different tiers gets the **highest tier present**. A commit that fixes a typo and adds a new skill is `[behaviour]`, not `[typo]`. A commit that adds a new skill and changes a Cardinal Rule is `[constitutional]`, not `[behaviour]`.

## ACT-pass requirement

| Tier | Pre-commit ACT pass |
|---|---|
| `[typo]` | Skip — materiality gate exits at "low" |
| `[clarification]` | Skip — wording sharpening is low-stakes by definition |
| `[behaviour]` | **Trimmed pass** — Materiality, Alternatives, Audit-priors, Severity check (per [act-pass.instructions.md](act-pass.instructions.md)) |
| `[constitutional]` | **Full pass** — all 7 steps; visible markers in commit message body |

## What counts as a "brain edit"

Files that trigger this rule when touched:

- `.github/instructions/**`
- `.github/skills/**`
- `.github/prompts/**`
- `.github/agents/**`
- `.github/scripts/**` (when changes affect brain semantics, not pure refactor)
- `.github/config/**`
- `.github/copilot-instructions.md`
- `ACT/**` (Supervisor only — framework authorship territory)
- `docs/adrs/**`, `docs/ledgers/**`, `docs/proposals/**`, `docs/plans/**`, `docs/templates/**`
- `HANDOFF.md`, `CHANGELOG.md`, `VERSION`, `README.md`
- Root-level identity / governance docs

Files exempt:

- Pure description-style README edits with no directives
- License files, attribution
- Pure code refactor in `scripts/**` that doesn't change brain semantics (still gets a conventional-commits tag, but no severity tag required)
- `fleet/` snapshots and dashboards (regenerated artefacts)

## Anti-patterns

| Anti-pattern | Correction |
|---|---|
| Tagging `[clarification]` to skip ACT pass on a real `[behaviour]` change | Self-deception. The ACT pass overhead exists precisely because the change deserves scrutiny. |
| Tagging `[constitutional]` on every commit to look rigorous | Inflation defeats the signal. Reserve `[constitutional]` for true rule-changes-other-rules-depend-on. |
| Tagging by intent rather than effect | If a "small clarification" actually changes what the AI does, it's `[behaviour]`, not `[clarification]`. The tag describes the change, not the author's mood. |
| Omitting the tag because "this commit is obvious" | Especially load-bearing changes need tags. The convention's value is in systematic application. |
| Hiding the tag in commit body instead of subject line | Subject line is what `git log --oneline` shows. Tags must be visible at log-scan speed. |
| Skipping the tag on a `gh release create` body or `git tag -a` annotation | Release tags carry the highest-tier severity of any commit they collect. |

## Brain-qa-changelog integration

Where the repo maintains a brain-qa-changelog (some projects keep one at `docs/ledgers/brain-qa-changelog.md`), every row must include the severity tag of the shipping commit (in the Notes column or as a dedicated column). The tag carries through whether the changelog is maintained or not.

## Falsification

- **Event-based**: at 30 brain-touching Supervisor commits since adoption (2026-05-24), audit the tag distribution and consistency with an independent reader's classification. If correctness < 80% OR the `[typo]` tier still has 0 uses, downgrade `lifecycle: provisional → sinking`.
- **Date-based**: 2026-08-23 (90 days from adoption). If by then fewer than 30 tagged commits exist OR routine drift to untagged commits is observed, downgrade `lifecycle: provisional → sinking`.
- **Sink to archived**: at next deadline check (2026-09-22), if still failing, transition `lifecycle: sinking → archived`. The convention sunsets unless the discipline holds.

The `[typo]` tier may be dropped at the 30-commit re-evaluation if it remains unused — 3-tier (`[clarification | behaviour | constitutional]`) is a valid simplification.

## Would Revise If

Revise if:

- The 4-tier scheme blurs in practice — `[clarification]` and `[behaviour]` become indistinguishable when applied to real commits
- The ACT-pass overhead for `[behaviour]` slows brain edits to the point that edits get bundled to skip the pass
- The `[constitutional]` tier never fires when it should — e.g. a rebrand or schema change ships as `[behaviour]` and only retrospectively gets reclassified
- Independent-reader correctness check is impossible to run because no second reader sees the brain commits often enough to score them

**Falsification deadline**: 2026-08-23 (date-based), 30 brain-touching commits (event-based). Whichever fires first. See § Falsification above for two-step sink rule.
