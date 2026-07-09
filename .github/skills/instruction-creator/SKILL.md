---
name: instruction-creator
description: "Create instructions that pass instruction-review's five gates (plus Gate 6 for always-on) by construction — intent capture, prior-art scan, applyTo calibration, draft against gates, dogfood self-review. Use when authoring a new instruction, refactoring an existing one, or promoting a Mall instruction into the heir's brain."
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition replaces Supervisor-specific routing ("Forking a Supervisor instruction for Edition", "into Supervisor or Edition") with heir-portable phrasing ("into the heir's brain"). Same workflow. Audited 2026-05-31. -->

# Instruction Creator

Author instructions that pass [`instruction-review`](../instruction-review/SKILL.md)'s five gates by construction (plus Gate 6 for always-on instructions). The gates are the quality bar; invert them, and you build to standard the first time.

Mirrors [`skill-creator`](../skill-creator/SKILL.md)'s seven-phase structure with instruction-specific guidance. If a phase here disagrees with skill-creator on the shared scaffold, skill-creator wins; this file owns only the per-type guidance.

## When to Use

- Authoring a new instruction in `.github/instructions/`
- Refactoring an existing instruction (scope shift, applyTo recalibration, split, merge)
- Promoting a Mall instruction into your heir's brain

## When **not** to use

- Authoring a skill (a procedure with steps) → use [skill-creator](../skill-creator/SKILL.md)
- Authoring a prompt (a slash-command workflow) → use [prompt-creator](../prompt-creator/SKILL.md)
- Authoring an agent (a delegated sub-process role) → use [agent-creator](../agent-creator/SKILL.md)
- A one-off rule for a single file with no recurring trigger → not a brain artifact

## The Seven Phases

Each phase inverts one of the five (or six) gates. Author against the phase, pass the gate.

### Phase 1 — Intent capture

Answer in writing before any drafting:

1. **What rule does this enforce?** One sentence. If it contains "and" / "+", you have two instructions — split.
2. **What is the trigger condition?** Concrete — drives the `applyTo` glob in Phase 3. "When working on Azure code", "On every turn", "On files in `AI-Memory/`".
3. **What does the agent do differently when this fires?** Be specific. If the answer is "be more careful", the rule is too vague.

If the rule is a *procedure* (multi-step operation) rather than a condition-action pair, **stop** — author a skill, not an instruction.

### Phase 2 — Prior-art scan

```pwsh
Select-String -Path .github/instructions/*.instructions.md -Pattern "<keyword>"
```

| Finding | Action |
|---|---|
| Existing instruction covers ≥70% | **Extend the existing one**, don't create a new file |
| Adjacent instruction with different `applyTo` | Check if scopes can merge under a wider `applyTo` |
| Mall instruction covers it | **Adopt the Mall unit**, retarget frontmatter |
| Nothing exists | Author from scratch — legitimate gap |

### Phase 3 — Draft against Gate 1 (Spec) and calibrate `applyTo`

Frontmatter template:

```yaml
---
description: "<third-person, what + when, ≤1024 chars>"
applyTo: "<glob pattern>"
lastReviewed: YYYY-MM-DD
---
```

**`applyTo` calibration is the load-bearing decision for instructions.** Too broad = token waste on every turn; too narrow = misses the cases it should catch.

| Trigger condition | `applyTo` shape | Example |
|---|---|---|
| Every turn (always-on framework discipline) | `**` | act-pass, epistemic-calibration |
| Files matching a path pattern | `**/path/**`, `**/*.ext` | markdown-mermaid (`**/*.md`), git-workflow (`**/.*git*,**/.github/**`) |
| Domain keyword in conversation | `**/*keyword*` | mcp-development (`**/*mcp*`) |
| Specific subdirectory | `**/AI-Memory/**` | cross-project-isolation, pii-memory-filter |

If `applyTo: "**"`, the body must include an explicit *always-on rationale* section (Gate 6 requirement).

**File location**: `.github/instructions/<kebab-name>.instructions.md` (flat — no subfolders).

### Phase 4 — Draft against Gate 2 (Quality)

| Criterion | How you author for it |
|---|---|
| Directive voice | Rules as `Condition → Action` tables. Imperative verbs. No narrative ("when we introduced this..."). |
| Single responsibility | One rule per file. If the title contains "and", split. |
| Rule tables over prose | Tables for the rules; prose only for rationale and anti-patterns. |
| Has `## Would Revise If` | Date / count+time / observable event. Per your heir's falsifiability-deadlines discipline. |
| At least one anti-pattern table | Surfaces what the rule is *not* asking for. |
| ≤200 lines (pattern-applied) or ≤150 lines (always-on) | See Gate 6 for always-on. |

### Phase 5 — Draft against Gate 3 (Scope)

| Target | Route |
|---|---|
| Framework-level (manifesto, tenets, claims) | **Stop.** Decision record, not instruction. |
| Generic across many projects | Keep in your heir baseline (Edition mirror) |
| Single project or narrow domain | That project's local-only repo |
| External-surface rule | Not an ACT instruction — author a Mall unit |

### Phase 6 — Draft against Gate 4 (Safety)

Same checks as [skill-creator Phase 6](../skill-creator/SKILL.md). Instructions rarely bundle scripts, but if they reference scripts, the script-discipline rules from skill-creator apply.

### Phase 7 — Dogfood self-audit (with Gate 6 if always-on)

Before committing, run [`instruction-review`](../instruction-review/SKILL.md)'s five gates (plus Gate 6 for always-on). Verdict lives in the commit message.

**Gate 6 check** — only for `applyTo: "**"`:

- [ ] Body ≤150 lines
- [ ] Explicit "always-on rationale" prose names *why* this fires every turn
- [ ] No duplication of content owned by a skill

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| Setting `applyTo: "**"` because you're unsure of the trigger | Phase 1 forces you to name the trigger. If you can't, you don't have an instruction yet. |
| Authoring a procedure as an instruction | Procedures with steps are skills. Move it. |
| Skipping the prior-art grep | Grep is cheap; duplicate authoring is expensive. |
| Hiding the falsifier in prose | Use a `## Would Revise If` heading; per your falsifiability discipline the section must be explicit. |
| Letting an always-on instruction creep past 150 lines | Always-on cost is per-turn × every-session. Cut, or narrow the `applyTo`. |
| Copy-pasting from a skill body into an instruction | The skill is source of truth. Cross-link. |

## Falsifiability

This skill's design has failed if any of the following occur within 90 days:

- ≥2 instructions authored using this guide fail `instruction-review` Gate 1 or Gate 6 on first self-audit (phases didn't internalize the gates)
- No new instructions authored via this guide in 90 days (decorative, not load-bearing — sunset)
- `applyTo` calibration table produces consistent miscalibration (always-on chosen where pattern would do, or vice versa) ≥3 times in a quarter

Track as you would any falsified discipline (commit log, retraining notes, or curation ledger if your repo ships one) tagged `[INSTRUCTION-CREATOR-MISS]`.

## Related

- [instruction-review](../instruction-review/SKILL.md) — the five gates (+ Gate 6) this skill inverts
- [skill-creator](../skill-creator/SKILL.md) — sibling for skills; canonical seven-phase scaffold
- [prompt-creator](../prompt-creator/SKILL.md) — sibling for prompts
- [agent-creator](../agent-creator/SKILL.md) — sibling for agents
- [act-pass](../../instructions/act-pass.instructions.md) — required for medium-stakes instruction authoring
