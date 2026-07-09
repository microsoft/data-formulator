---
name: log-curation-change
description: "Append a one-line entry to docs/ledgers/curation-log.md whenever a brain artifact is added, modified, or removed. Use when committing changes to .github/skills, .github/instructions, .github/prompts, or .github/agents."
lastReviewed: 2026-05-26
---

# Log Curation Change (Example)

> **This is a worked example demonstrating a skill that passes all five gates.** See `../../SKILL.md` for the authoring guide.

Every brain edit produces a one-line entry in `docs/ledgers/curation-log.md`. The log is the audit trail for curation decisions.

## When to Use

- Adding a new skill, instruction, prompt, agent, or muscle
- Modifying an existing one (scope change, content rewrite >20 lines)
- Removing one (archival, sink, or full delete)

## When **not** to use

- Typo fixes, link repairs, formatting-only edits — too small to log.
- Generated files (inventories, dashboards) — those have their own regen audit trail.

## How to Apply

### Step 1 — Classify

Pick one: `[add]`, `[modify]`, `[archive]`, `[delete]`.

### Step 2 — Compose the entry

```
YYYY-MM-DD [classification] <artifact-path> — <one-line reason>
```

### Step 3 — Append

Append to `docs/ledgers/curation-log.md` in the same commit as the artifact change.

## Anti-Patterns

| Anti-pattern | Correction |
| --- | --- |
| Logging in a separate commit from the change | Same commit — atomic audit |
| Multi-line reasons | One line. Full reasoning goes in the commit message. |

## Falsifiability — Would Revise If

- **Event-based**: ≥3 brain edits land without log entries in a single quarter — the rule is decorative, not enforced. Switch to a pre-commit hook.
- **Date-based**: 2026-08-26 — re-evaluate whether a script (`scripts/append-curation-log.cjs`) should automate this.

## Related

- [severity-tagged-commits](../../../../instructions/severity-tagged-commits.instructions.md) — the tagging discipline this skill's outcomes record
