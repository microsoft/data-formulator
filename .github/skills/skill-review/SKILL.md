---
name: skill-review
description: "Audits a candidate skill (.github/skills/<name>/SKILL.md) against five gates (spec compliance, content quality, scope fit, safety, currency & coherence). Use when reviewing a new skill draft before commit, evaluating a Mall unit or store skill for adoption, or re-auditing existing skills on a periodic cadence. For instructions, prompts, agents — use the matching per-type review skill."
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition strips Supervisor-only refs (ADR-007, `scripts/brain-qa.cjs` per-script citations, instruction-specific Gate 1 rows since heirs review skills only, and retired-entity examples Supervisor uses in Gate 5 illustrations). Same five gates, same criteria. Audited 2026-05-31. -->

# Skill Review

Audit a candidate skill against five gates. This brain accepts only what passes all five.

For other artifact types: [instruction-review](../instruction-review/SKILL.md), [prompt-review](../prompt-review/SKILL.md), [agent-review](../agent-review/SKILL.md). All four pairs share the same five-gate contract; per-type criteria differ.

## When to Use

Three fire contexts:

1. **Author self-audit** — dogfood your own draft before committing. Invoked from [skill-creator](../skill-creator/SKILL.md) Phase 7.
2. **External candidate adoption** — gate before pulling a Mall unit, store skill, or any external artifact into this brain. Decide *whether the artifact is fit* before adopting.
3. **Periodic re-audit** — re-check existing skills during currency-audit or quarterly retraining. Skills that no longer pass the gates revise or retire.

This skill carries the judgment checks a brain-qa validator cannot do (mechanical regex/date validation vs. content-quality judgment). Gate 1 partially overlaps with brain-qa where present; Gates 2–4 are judgment-only.

## The Five Gates

A candidate must pass **all five** to ship. Failure on any gate = decline or revise.

These gates are the canonical source of truth. [skill-creator](../skill-creator/SKILL.md) inverts them into authoring phases — if the two ever disagree, this file wins and skill-creator must follow.

### Gate 1 — Spec Compliance

| Check | Pass criterion |
|---|---|
| Frontmatter present AND minimal | YAML block carries exactly the canonical fields. Skills: `name` + `description` + `lastReviewed`. Reject any legacy extras (`type`, `application`, `applyTo`, `inheritance`, `tier`, `currency`, `lifecycle`, `user-invokable`, `evidence`). |
| `name` valid | kebab-case, ≤64 chars, matches folder name |
| `description` valid | Third-person, ≤1024 chars, names what the skill does AND when to use it (avoid slogans like "Clear documentation through visual excellence") |
| File location matches type | `SKILL.md` in `skills/<name>/` |
| Markdown lints clean | No broken links, no missing code-fence languages |

This gate overlaps with a brain-qa validator where present. If brain-qa passes, Gate 1 is presumptively met; spot-check the judgment items (description third-person/trigger phrases).

### Gate 2 — Content Quality

| Check | Pass criterion |
|---|---|
| Single responsibility | The artifact does one thing; if title contains "and" or "+", split it |
| Behavioral, not encyclopedic | Tells the agent what to *do*, not what a topic *is* |
| Has falsifiability or visible markers | The reader can tell whether the artifact fired correctly |
| ≤ 500 lines | Anthropic skill-spec ceiling; longer = signal of overload, split or trim |
| No duplicated content from existing artifacts | Grep for overlapping descriptions across `.github/instructions/` and `.github/skills/` |
| No graveyard prose | No "removed/dropped/used-to-have" sections; the file describes the live shape only |

### Gate 3 — Scope Fit

| Check | Pass criterion |
|---|---|
| Target brain matches scope | Generic across ≥2 projects → this brain. Project-specific → that project's local skills, not here. External-surface delivery → Plugin Mall, not here. |
| Not framework-level | Does not modify ACT manifesto, tenets, or claims registry — framework changes go through an ADR, not a skill |
| Doesn't duplicate Plugin Mall content | If the value is a marketplace listing, it goes in the Mall, not the brain baseline |

### Gate 4 — Safety

| Check | Pass criterion |
|---|---|
| No destructive defaults | Anything that deletes, force-pushes, or overwrites must require explicit user approval |
| No hardcoded credentials or PII | Run `pii-memory-filter` mentally over the diff |
| No prompt-injection vectors | If the artifact reads external content (URLs, files), it sanitizes or quotes it |
| Reversible | A user can disable or remove the artifact without breaking the brain |

### Gate 5 — Currency & Coherence

The semantic layer of currency-and-coherence judgment. A mechanical validator (brain-qa script) typically catches the obvious cases (broken links, missing allow markers, stale dates, H1/name divergence); this gate covers the subtler ones that require deep reading.

| Check | Pass criterion |
|---|---|
| Frontmatter matches body | Description's "what + when" claims survive a deep read of the body. No drift between advertised scope and actual content. |
| No stale entity references (semantic) | References to retired entities carry a per-file `<!-- brain-qa: allow <Entity> -->` marker AND the marker is justified — the reference adds historical or operational value, isn't fossil. |
| Cross-references resolve and add value | Every markdown link (the `\[label\]\(target\)` form) points to a live artifact AND the target adds something the reader needs. Dead links and decorative xrefs both fail. |
| `lastReviewed` is honest | The date reflects when the file was actually re-verified, not a rubber-stamp. Body content must be consistent with what was true at that date. |
| H1 matches advertised scope | The H1 reflects the skill's actual scope per `name` + `description`. "MCP Server Development Guide" vs name "mcp-builder" fails this gate. |
| Description has "what" AND "when" | Third-person; names the operation AND the trigger phrases. No slogans, no missing trigger clauses. |
| Body free of slogans / marketing prose | Plain operational language. No "powerful", "comprehensive", "seamless", "unleash". No graveyard prose ("removed/dropped/used-to-have" sections). |
| `Related` section is live | Linked-to artifacts exist AND each adds material value beyond cross-linking for the sake of it. |

## Decision Matrix

| Gates passed | Action |
|---|---|
| All 5 | **Accept** — land the change |
| 4 of 5 | **Revise** — name the failing gate and patch the candidate |
| 3 of 5 or fewer | **Decline** — name the rationale; if the decline sets precedent, record it where your heir tracks framework-level decisions |

## Recording the Verdict

For self-audits and routine re-audits: the verdict lives in the commit message or the conversation. No separate file.

For external adoption (Mall unit, store skill) or any decline that sets precedent: write a verdict capturing gate results, rationale, required changes (if Revise), and the act-pass trail. This is the audit trail for adoption decisions, not a ceremonial form for every audit.

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| Accepting because the author is confident | Confidence ≠ quality. Run all five gates regardless of authorship |
| Declining without naming the gate | Always cite the specific gate; vague declines waste cycles |
| Accepting "trivial" candidates without audit | Trivial-looking changes are where regressions hide |
| Skipping the act-pass trail on non-trivial audits | Medium-stakes audits (new artifact, external adoption) require the trimmed pass; routine re-audits of unchanged artifacts do not |
| Gates drifting from skill-creator | If a gate here disagrees with a skill-creator phase, update skill-creator — this file is the source of truth |

## Falsifiability

This skill's five-gate model has failed if any of the following occur within 90 days:

- An accepted candidate (all 5 gates passed) is reported broken by 2+ heirs
- Declines cluster on one gate and are later reversed during re-audit (gate too strict or unclear)
- Repeated audits of equivalent candidates produce contradictory gate outcomes
- Gate 5 produces a false-positive rate >20% over a quarter (the semantic layer is too aggressive)
- A defect that Gate 5 was supposed to catch ships through an accepted review

Track these as you would any falsified discipline (commit log, retraining notes, or curation ledger if your repo ships one) tagged `[GATE-FAILURE]`.

## Related

- [skill-creator](../skill-creator/SKILL.md) — inverts these gates to author candidates that pass by construction
- [instruction-review](../instruction-review/SKILL.md) — sibling for instructions
- [prompt-review](../prompt-review/SKILL.md) — sibling for prompts
- [agent-review](../agent-review/SKILL.md) — sibling for agents
- [act-pass](../../instructions/act-pass.instructions.md) — required for medium-stakes audits
- `/review-skill` prompt — slash-command entry point
