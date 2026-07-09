---
name: prompt-review
description: "Audits a candidate prompt (.prompt.md) against five gates (spec compliance, content quality, scope fit, safety, currency & coherence). Use when reviewing a new prompt draft before commit, evaluating a Mall prompt or store prompt for adoption, or re-auditing existing prompts on a periodic cadence."
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition expands gate names inline and strips Supervisor-only ADR-007 ref. Same five gates. Audited 2026-05-31. -->

# Prompt Review

Audit a candidate prompt against the five-gate contract. Prompts are workflow entry points — short, imperative, single-goal. No optional Gate 6 (prompts are short by nature; no scaling concern Gates 1–5 miss).

## When to Use

Three fire contexts:

1. **Author self-audit** — dogfood your own draft before committing. Invoked from [prompt-creator](../prompt-creator/SKILL.md) Phase 7.
2. **External candidate adoption** — gate before pulling a Mall prompt or store prompt into this brain.
3. **Periodic re-audit** — re-check existing prompts on a cadence (e.g., quarterly retraining).

The shared gate model lives in [skill-review/SKILL.md § The Five Gates](../skill-review/SKILL.md). This file documents the **prompt-specific criteria** for each gate.

A mechanical validator (e.g., a brain-qa script that ships with the heir) typically checks Gate 1 frontmatter compliance and the mechanical subset of Gate 5. Gates 2–5 are judgment-only.

## The Five Gates

A candidate must pass **all five** to ship. Failure on any gate = decline or revise.

### Gate 1 — Spec Compliance

| Check | Pass criterion |
|---|---|
| Frontmatter present AND minimal | `description` + `lastReviewed`. Reject any of: `name`, `type`, `application`, `tier`, `currency`, `inheritance`, `lifecycle`, `user-invokable`, `evidence`. |
| `mode:` field handling | Per current Microsoft Learn prompt-files spec, `mode: agent` is deprecated. Existing prompts may carry it during sweep transition; new prompts should not introduce it. Flag as Gate 1 fail if a new prompt adds `mode:`. |
| `description` valid | Third-person, ≤1024 chars, names what the prompt does AND when to invoke it (slash-command UX). |
| Filename pattern | `<kebab-name>.prompt.md` in `.github/prompts/` (flat — no subfolders) |
| Markdown lints clean | No broken links, no missing code-fence languages |

### Gate 2 — Content Quality

| Check | Pass criterion |
|---|---|
| Imperative voice | Verbs in the imperative ("Run X", "Read Y", "Apply Z"). Prompts are commands to the agent, not explanations. |
| Single workflow scope | One goal per prompt. If the title contains "and" or "+", split. Prompts that are menus of unrelated commands fail this gate. |
| Numbered steps | The prompt's body is a numbered step list. Brief context paragraph allowed before the steps; nothing else. |
| Has `## Would Revise If` OR justification for omission | Prompts under 30 lines may inline the falsifier; longer prompts must have an explicit section per your heir's falsifiability-deadlines discipline. |
| ≤100 lines | Soft target. Long prompts signal that the workflow belongs in a skill; the prompt should just invoke the skill. |

### Gate 3 — Scope Fit

| Check | Pass criterion |
|---|---|
| Workflow entry-point, not workflow body | The prompt invokes a skill (or runs a short coordinated sequence). The skill carries the procedure; the prompt is the front door. |
| Not redundant with existing prompt | Grep `description:` across `.github/prompts/` — if another prompt covers the same workflow, extend that one. |
| Discoverable as slash-command | The prompt's name (filename without `.prompt.md`) is something a user would intuitively type after `/`. `/review-instruction` good; `/v2-thing-do` bad. |
| Lives in the right brain | Generic developer workflows → heir baseline. Project-specific workflows → that project's local repo. |

### Gate 4 — Safety

Same criteria as [skill-review § Gate 4](../skill-review/SKILL.md). Prompt-specific note: prompts that invoke destructive operations (force-push, drop, delete) must include an explicit user-confirmation step before the destructive call.

### Gate 5 — Currency & Coherence

Same criteria as [skill-review § Gate 5](../skill-review/SKILL.md). Prompt-specific note: the prompt must reference *live* skills/instructions in its steps. A prompt that calls a retired skill is a Gate 5 failure even if the prompt itself is well-written.

## Decision Matrix

| Gates passed | Action |
|---|---|
| All 5 | **Accept** — land the change |
| 4 of 5 | **Revise** — name the failing gate and patch the candidate |
| ≤3 of 5 | **Decline** — name the rationale; if the decline sets precedent, record it where your heir tracks framework-level decisions |

## Recording the Verdict

For self-audits and routine re-audits: the verdict lives in the commit message or the conversation. No separate file.

For external adoption (Mall prompt, store prompt) or any decline that sets precedent: write a verdict capturing gate results, rationale, required changes (if Revise), and the act-pass trail. Store wherever your heir keeps audit decisions.

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| Accepting a prompt that carries the workflow inline instead of invoking a skill | If the prompt has more than the step list, the workflow belongs in a skill |
| Letting `mode: agent` ship on a new prompt | Per Microsoft Learn current spec, deprecated. Flag at Gate 1. |
| Accepting "menu" prompts that bundle unrelated commands | One workflow per prompt. Multi-purpose prompts confuse the slash-picker. |
| Skipping the slash-picker discoverability check | Filename = user typing. If the name is cryptic, the prompt won't get found. |
| Prompt references a retired skill | Gate 5 semantic failure. Check the `Steps:` block resolves to live artifacts. |

## Falsifiability

This skill's prompt-specific criteria have failed if any of the following occur within 90 days:

- An accepted prompt is reported broken (workflow doesn't fire, or fires wrong) by 2+ heirs
- Gate 2 ≤100 lines threshold is reversed ≥3 times for legitimate complex workflows (ceiling too tight)
- Prompts accepted via this skill are typed via slash-picker <50% of the time when applicable (discoverability criterion miscalibrated)

Track as you would any falsified discipline (commit log, retraining notes, or curation ledger if your repo ships one) tagged `[PROMPT-REVIEW-MISS]`.

## Related

- [skill-review](../skill-review/SKILL.md) — sibling for skills; canonical source of the shared five-gate contract
- [prompt-creator](../prompt-creator/SKILL.md) — inverts these gates into authoring phases
- [instruction-review](../instruction-review/SKILL.md) — sibling for instructions
- [agent-review](../agent-review/SKILL.md) — sibling for agents
- [act-pass](../../instructions/act-pass.instructions.md) — required for medium-stakes audits
- `/review-prompt` prompt — slash-command entry point
