---
name: instruction-review
description: "Audits a candidate instruction (.instructions.md) against five gates (spec compliance, content quality, scope fit, safety, currency & coherence) plus optional Gate 6 (token budget for always-on instructions). Use when reviewing a new instruction draft before commit, evaluating a Mall instruction or store instruction for adoption, or re-auditing existing instructions on a periodic cadence."
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition expands gate names inline, replaces Supervisor-specific paths (`scripts/brain-qa.cjs`, ADR-006/007, `docs/adrs/`, `docs/ledgers/audits/`) with heir-portable language ("a brain-qa validator", "where your heir tracks framework-level decisions"). Same six gates, same criteria. Audited 2026-05-31. -->

# Instruction Review

Audit a candidate instruction against the five-gate contract plus optional Gate 6 (Token Budget). Instructions are always-on or pattern-applied rules — every match loads tokens, so the budget gate matters more than for any other artifact type.

## When to Use

Three fire contexts:

1. **Author self-audit** — dogfood your own draft before committing. Invoked from [instruction-creator](../instruction-creator/SKILL.md) Phase 7.
2. **External candidate adoption** — gate before pulling a Mall instruction or store instruction into this brain.
3. **Periodic re-audit** — re-check existing instructions on a cadence (e.g., quarterly retraining).

The shared gate model lives in [skill-review/SKILL.md § The Five Gates](../skill-review/SKILL.md) as the canonical contract. This file documents the **instruction-specific criteria** for each gate. If a gate definition here disagrees with skill-review, the gate *concept* in skill-review wins; this file owns only the per-type criteria.

A mechanical validator (e.g., a brain-qa script that ships with the heir) typically checks Gate 1 frontmatter compliance and the mechanical subset of Gate 5 (banned-entity, dead-xref, stale-date, H1/name divergence). Gates 2–6 are judgment-only.

## The Five Gates + Gate 6 (Token Budget)

A candidate must pass **all five** to ship. Always-on instructions (`applyTo: "**"`) must also pass Gate 6. Failure on any gate = decline or revise.

### Gate 1 — Spec Compliance

| Check | Pass criterion |
|---|---|
| Frontmatter present AND minimal | `description` + `applyTo` + `lastReviewed`. Reject any of: `name`, `type`, `application`, `tier`, `currency`, `inheritance`, `lifecycle`, `mode`, `user-invokable`. |
| `description` valid | Third-person, ≤1024 chars, names what the instruction enforces AND when/where it fires (the trigger condition or scope) |
| `applyTo` valid glob | Non-empty, syntactically valid glob (e.g., `**`, `**/*.ts`, `**/AI-Memory/**`). Comma-separated globs allowed. |
| Filename pattern | `<kebab-name>.instructions.md` in `.github/instructions/` (flat — no subfolders) |
| Markdown lints clean | No broken links, no missing code-fence languages, no MD060 spacing issues |

### Gate 2 — Content Quality

| Check | Pass criterion |
|---|---|
| Directive voice | Tells the agent what to *do* under what condition. Not encyclopedic ("instructions are..."), not narrative ("when we introduced this..."). |
| Single rule scope | One topic per file. If the title contains "and" or "+", split. |
| Rule tables over prose | Where possible, express rules as `Condition → Action` tables. Prose is fine for rationale and anti-patterns; not for the rule itself. |
| Has `## Would Revise If` | At least one falsifier per the heir's falsifiability-deadlines discipline: literal date OR observable event OR count+time bound. Not "after sufficient passes" or "when conditions warrant". |
| At least one anti-pattern table or comparison | Surfaces what the instruction is *not* asking for. |
| ≤200 lines | Soft target. Pattern-applied instructions may go higher; always-on instructions should not. See Gate 6. |

### Gate 3 — Scope Fit

| Check | Pass criterion |
|---|---|
| `applyTo` calibrated | Glob matches the intended fire scope — neither so broad it fires on irrelevant work, nor so narrow it misses obvious cases. Test against 3 sample paths mentally. |
| Not framework-level | Does not modify the heir's framework foundations (manifesto, tenets, claims) — framework changes go through your decision-record protocol, not an instruction |
| Not redundant with existing instruction | Grep `description:` and `applyTo:` across `.github/instructions/` — if another instruction covers ≥70% of this rule, extend that one instead |
| Lives in the right brain | Is this for every project (Edition baseline / heir-mirrored) or just this one project? File accordingly. |
| Not a skill in disguise | If it's a procedure with steps (not a rule), it's a skill, not an instruction. Instructions encode *rules that fire on context match*; skills encode *operations the agent invokes* |

### Gate 4 — Safety

Same criteria as [skill-review § Gate 4](../skill-review/SKILL.md) — no destructive defaults, no hardcoded credentials/PII, no prompt-injection vectors, reversible.

### Gate 5 — Currency & Coherence

Same criteria as [skill-review § Gate 5](../skill-review/SKILL.md). Instruction-specific note: the H1-vs-filename alignment check applies — H1 should reflect the instruction's actual scope per `description`, not a slogan.

### Gate 6 — Token Budget (always-on instructions only)

Applies when `applyTo: "**"` or any pattern that fires on a meaningful fraction of typical work.

| Check | Pass criterion |
|---|---|
| Body ≤150 lines for `applyTo: "**"` | Always-on instructions load on every match; the budget is shared with all other always-on instructions and every conversation turn. Over-budget = degrades every session. |
| Body ≤200 lines for pattern-applied (`applyTo: "**/*.ts"` and similar) | Pattern-applied is bounded by the pattern's actual fire frequency — looser ceiling. |
| Always-on rationale named | If `applyTo: "**"`, the instruction body explicitly names *why* it's always-on (load-bearing for every turn, or framework-level discipline). |
| No copy-paste from a skill | If the instruction's content duplicates a skill body, the skill is the source of truth — instruction should cross-link, not restate. |

## Decision Matrix

| Gates passed | Action |
|---|---|
| All 5 (or all 6 for always-on) | **Accept** — land the change |
| 4 of 5 (or 5 of 6) | **Revise** — name the failing gate and patch the candidate |
| ≤3 of 5 (or ≤4 of 6) | **Decline** — name the rationale; if the decline sets precedent, record it where your heir tracks framework-level decisions |

## Recording the Verdict

For self-audits and routine re-audits: the verdict lives in the commit message or the conversation. No separate file.

For external adoption (Mall instruction, store instruction) or any decline that sets precedent: write a verdict capturing gate results, rationale, required changes (if Revise), and the act-pass trail. Store wherever your heir keeps audit decisions (commit log, dedicated ledger, decision records).

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| Accepting an always-on instruction without checking Gate 6 | The token cost is invisible at commit time but compounds across every session. Always check. |
| Letting `applyTo: "**"` ship without explicit "always-on rationale" prose | If you can't articulate why this fires every turn, narrow the glob. |
| Treating instructions as mini-skills with procedural steps | If it has steps, it's a skill. Move it. |
| Skipping Gate 3 dedup check because "there's no obvious overlap" | The instructions/ folder grows; grep `description:` first. |
| Gates drifting from skill-review's shared model | Gate *names and meanings* come from skill-review. Only the *criteria* are type-specific. |

## Falsifiability

This skill's instruction-specific criteria have failed if any of the following occur within 90 days:

- An accepted instruction is reported broken by 2+ heirs (criteria miscalibrated)
- Gate 6 declines cluster on a single bound (150 / 200 line ceiling) and are reversed during re-audit (ceiling too tight)
- An instruction passes Gate 3 dedup check but later gets identified as overlapping an existing instruction ≥2 times in a quarter (dedup criterion too lax)

Track as you would any falsified discipline (commit log, retraining notes, or curation ledger if your repo ships one) tagged `[INSTRUCTION-REVIEW-MISS]`.

## Related

- [skill-review](../skill-review/SKILL.md) — sibling for skills; canonical source of the shared five-gate contract
- [instruction-creator](../instruction-creator/SKILL.md) — inverts these gates into authoring phases
- [prompt-review](../prompt-review/SKILL.md) — sibling for prompts
- [agent-review](../agent-review/SKILL.md) — sibling for agents
- [act-pass](../../instructions/act-pass.instructions.md) — required for medium-stakes audits
- `/review-instruction` prompt — slash-command entry point
