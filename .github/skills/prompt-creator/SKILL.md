---
name: prompt-creator
description: "Create prompts that pass prompt-review's five gates by construction — intent capture, slash-command naming, single-workflow scope, draft as numbered steps, dogfood self-review. Use when authoring a new prompt, refactoring an existing one, or promoting a Mall prompt into the heir's brain."
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition strips Supervisor-only routing tables (curation-only vs. mirror split) and uses heir-portable phrasing ("into the heir's brain"). Same five gates. Audited 2026-05-31. -->

# Prompt Creator

Author prompts that pass [`prompt-review`](../prompt-review/SKILL.md)'s five gates by construction. The gates are the quality bar; invert them, and you build to standard the first time.

Mirrors [`skill-creator`](../skill-creator/SKILL.md)'s seven-phase structure with prompt-specific guidance. If a phase here disagrees with skill-creator on the shared scaffold, skill-creator wins; this file owns only the per-type guidance.

## When to Use

- Authoring a new prompt in `.github/prompts/`
- Refactoring an existing prompt (rename, scope tighten, step revision)
- Promoting a Mall prompt into your heir's brain

## When **not** to use

- Authoring a skill (the procedure body) → use [skill-creator](../skill-creator/SKILL.md). Prompts are entry-points; skills are bodies.
- Authoring an instruction (always-on or pattern-applied rule) → use [instruction-creator](../instruction-creator/SKILL.md)
- Authoring an agent (delegated sub-process role) → use [agent-creator](../agent-creator/SKILL.md)

## The Seven Phases

Each phase inverts one of the five gates. Author against the phase, pass the gate.

### Phase 1 — Intent capture

Answer in writing before any drafting:

1. **What workflow does this kick off?** One sentence. If it contains "and" / "+", you have two prompts — split.
2. **What slash-command does the user type?** The filename (minus `.prompt.md`) becomes `/<name>`. Pick something a user would intuitively type. `/review-instruction` good; `/v2-thing-do` bad.
3. **What skill does this prompt invoke?** Most prompts are thin wrappers that call a skill. If the answer is "no skill, the prompt carries the workflow", **stop** — author the skill first, then the prompt.

### Phase 2 — Prior-art scan

```pwsh
Get-ChildItem .github/prompts/*.prompt.md
Select-String -Path .github/prompts/*.prompt.md -Pattern "<keyword>"
```

If another prompt covers the same workflow, extend it. If a Mall prompt covers it, adopt.

### Phase 3 — Draft against Gate 1 (Spec)

Frontmatter template:

```yaml
---
description: "<third-person, what + when to invoke, ≤1024 chars>"
lastReviewed: YYYY-MM-DD
---
```

**Do NOT add `mode: agent`** — per current Microsoft Learn prompt-files spec, this field is deprecated. Existing prompts may carry it during sweep transition; new prompts should not.

**File location**: `.github/prompts/<kebab-name>.prompt.md` (flat — no subfolders).

**Slash-picker discoverability**: the filename IS the user's typing surface. After you pick a name, mentally type `/<name>` and ask: would a user trying to find this workflow guess that string? If not, rename.

### Phase 4 — Draft against Gate 2 (Quality)

| Criterion | How you author for it |
|---|---|
| Imperative voice | Verbs in the imperative ("Run", "Read", "Apply", "Save"). |
| Numbered steps | The prompt's body is a numbered step list. Brief context paragraph allowed before the steps; nothing else. |
| Single workflow scope | One goal. No "menus" of unrelated commands. |
| ≤100 lines | If you need more, the workflow belongs in a skill the prompt invokes. |
| Falsifier | Prompts <30 lines may inline a one-line falsifier; longer prompts need an explicit `## Would Revise If` section. |

**Template structure**:

```markdown
---
description: "..."
lastReviewed: YYYY-MM-DD
---

# /<prompt-name>

<one-paragraph context: what skill this invokes, what the user gets>

Steps:

1. <imperative action>
2. <imperative action>
3. <imperative action>

<optional: conditions / branches / output format>
```

### Phase 5 — Draft against Gate 3 (Scope)

| Target | Route |
|---|---|
| Generic developer workflow (status, save-note, banner) | Heir baseline |
| Project-specific workflow | That project's local-only repo |
| External-surface command | Not an ACT prompt — author a Mall unit |

Workflow vs body distinction: the prompt invokes the skill; the skill carries the procedure. If your prompt body has more than ~10 numbered steps, it's drifting into skill territory.

### Phase 6 — Draft against Gate 4 (Safety)

Same checks as [skill-creator Phase 6](../skill-creator/SKILL.md). Prompt-specific: if the workflow invokes destructive operations (force-push, drop, delete), the step list must include an explicit user-confirmation step before the destructive call.

### Phase 7 — Dogfood self-audit

Before committing, run [`prompt-review`](../prompt-review/SKILL.md)'s five gates. Verdict lives in the commit message.

**Slash-picker test**: imagine the prompt appears in a picker alongside your existing prompts. Is it discoverable by name? Does the description make its purpose obvious?

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| Authoring a prompt before its underlying skill exists | Author the skill first; the prompt is the entry-point |
| Adding `mode: agent` to a new prompt | Deprecated per Microsoft Learn spec. Drop it. |
| Bundling unrelated commands into a "menu" prompt | One workflow per prompt |
| Cryptic prompt name | Filename = typing surface. If a user can't guess `/<name>`, rename. |
| Letting the prompt body grow into a procedure | If you need more than ~10 steps, the workflow belongs in a skill |
| Referencing a retired skill in `Steps:` | Gate 5 semantic failure. Check that step references resolve. |

## Falsifiability

This skill's design has failed if any of the following occur within 90 days:

- ≥2 prompts authored using this guide fail `prompt-review` on first self-audit
- No new prompts authored via this guide in 90 days (decorative — sunset)
- Slash-picker discoverability check produces consistent miscalibration (cryptic names accepted, or obvious names rejected) ≥3 times in a quarter

Track as you would any falsified discipline (commit log, retraining notes, or curation ledger if your repo ships one) tagged `[PROMPT-CREATOR-MISS]`.

## Related

- [prompt-review](../prompt-review/SKILL.md) — the five gates this skill inverts
- [skill-creator](../skill-creator/SKILL.md) — sibling for skills; canonical seven-phase scaffold
- [instruction-creator](../instruction-creator/SKILL.md) — sibling for instructions
- [agent-creator](../agent-creator/SKILL.md) — sibling for agents
- [act-pass](../../instructions/act-pass.instructions.md) — required for medium-stakes prompt authoring
