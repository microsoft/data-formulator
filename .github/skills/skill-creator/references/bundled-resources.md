# Bundled Resources Pattern

Most skills should not be a single `SKILL.md`. The bundled-resources pattern splits a skill into a thin behavioral file (always-loaded by the agent) and on-demand resources (read only when the skill fires). This keeps the agent's startup context lean while letting domain knowledge expand freely.

## Why it matters

The agent loads every `SKILL.md` description on every session. Long SKILL.md files inflate context cost for every conversation, whether the skill fires or not. Bundled resources are read only when the skill is invoked — they cost nothing at idle.

Most ACT brain skills ship as SKILL.md-only — no `references/`, no `scripts/`, no `assets/`. This is under-utilization, not a design rule. The pattern below is the corrective.

## Layout

```
.github/skills/<skill-name>/
├── SKILL.md                    # always-loaded, behavioral, ≤500 lines (Anthropic spec)
├── references/                 # consulted on-demand
│   ├── <topic-1>.md
│   └── <topic-2>.md
├── scripts/                    # executable helpers
│   └── <helper>.cjs
├── assets/                     # output templates
│   └── <template>.md
└── examples/                   # worked examples
    └── <example>/
```

## What goes where

### `SKILL.md` (always-loaded)

- The behavioral guide: phases, steps, decisions, routing
- Anti-patterns table
- `Would Revise If` falsifier
- Links to `references/`, `scripts/`, `assets/` rather than inlining their content

If your SKILL.md exceeds 500 lines (Anthropic's spec cap), you almost certainly have content that should be bundled.

### `references/` (consulted on-demand)

Domain knowledge the skill *consults*. Read when the skill fires, not before. Examples:

- Checklists (Gate 1-4 checklists, ADR templates, release-preflight checklists)
- Specs and contracts (frontmatter schema, JSON schema docs, API surfaces)
- Frameworks and taxonomies (STRIDE, OWASP, severity matrices)
- Decision matrices that span more than a small table

**Anti-pattern**: behavioral rules in `references/`. Behavior belongs in SKILL.md prose so the agent absorbs it via auto-loading.

**One level deep**: keep references flat under SKILL.md. `SKILL.md → references/foo.md → details/bar.md` causes partial reads. If a reference file passes 100 lines, add a table-of-contents block at the top rather than splitting deeper.

### `scripts/` (executable helpers)

Code the skill invokes. Examples:

- Verification scripts (`verify-frontmatter.cjs`)
- Generators (`generate-changelog.cjs`)
- Validators (`lint-applyTo.cjs`)

**Anti-pattern**: one-off project scripts unrelated to the skill — those belong in `scripts/` at repo root, not bundled.

### `assets/` (output templates)

Files the skill *produces* or files it copies into the workspace. Examples:

- Skeleton SKILL.md for new skills
- ADR template
- Release announcement template

**Anti-pattern**: generated outputs (those belong in `docs/` or `.github/episodic/`).

### `examples/` (worked examples)

Concrete cases of the skill applied. Examples:

- A minimal-but-complete output (e.g. a 30-line skill that passes all five gates)
- A before/after refactor demonstrating the skill's transformation

**Anti-pattern**: test fixtures (those belong with the script that tests them).

## When NOT to bundle

- The skill is genuinely small (≤150 lines, no recurring reference material). Don't add empty subfolders.
- The "reference" content is actually behavioral. Behavior in SKILL.md.
- The "asset" is a single 5-line snippet. Inline it.

Empty bundling is decoration and signals over-engineering on review.

## Promotion path

If a SKILL.md grows past 500 lines:

1. Identify the section types: behavioral vs reference vs template vs example.
2. Move reference content to `references/<topic>.md`. Replace with a link.
3. Move templates to `assets/`. Replace with a link.
4. Move worked examples to `examples/`. Replace with a link.
5. Re-run skill-review Gate 2 (length check).

This is reversible — if a `references/` file is never consulted in real use, inline it back and delete the file.

## Example: this skill

The `skill-creator` skill itself uses the pattern:

- `SKILL.md` (~180 lines): the seven phases, anti-patterns, falsifier
- `references/five-gates.md`: pre-commit self-audit checklist (consulted in Phase 7)
- `references/frontmatter-spec.md`: field-by-field reference (consulted in Phase 3)
- `references/bundled-resources.md`: this file (consulted in Phase 6)
- `assets/skill-skeleton/SKILL.md`: starter template (consulted in Phase 3)
- `examples/minimal-skill/SKILL.md`: a worked example that passes all gates (consulted in Phase 7 dogfood)

The agent loads ~180 lines on every session, not ~800. The other 600+ lines exist for the 1% of sessions where someone is actually authoring a skill.
