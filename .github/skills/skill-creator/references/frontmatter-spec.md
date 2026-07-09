# Frontmatter Spec — ACT Skills

Every `.github/skills/<name>/SKILL.md` opens with this frontmatter block. Aligned with the agentskills.io / Anthropic / Microsoft industry baseline plus ACT discipline fields.

```yaml
---
name: <kebab-name>
description: "..."
lastReviewed: 2026-05-26
---
```

Two fields are required by the industry spec (`name`, `description`). One more is conventional and used to drive the review queue (`lastReviewed`).

## Industry-spec fields

### `name` (required)

Kebab-case identifier. Matches the folder name. Constraints from agentskills.io:

- ≤64 chars
- Lowercase letters, numbers, hyphens only
- No XML tags
- Reserved: `anthropic`, `claude`

Anthropic recommends **gerund form** (`processing-pdfs`, `analyzing-spreadsheets`) for new skills. Existing noun-form skills stay as-is — no forced rename.

### `description` (required)

Drives both the slash picker tooltip AND the agent's L1 discovery (loaded into every system prompt at ~100 tokens/skill). Constraints:

- Non-empty
- ≤1024 chars (spec) — convention is ≤300 chars for readability
- No XML tags
- **Third person**: "Processes Excel files", not "I help with Excel"
- **Both halves**: what the skill does + when to use it (trigger phrases)

| Good | Bad |
|---|---|
| `"Author skills that pass skill-review's five gates by construction. Use when authoring or refactoring a skill, or promoting a Mall unit."` | `"This skill is about creating new skills."` |
| `"Detect stale Mall stores via deterministic freshness checks. Use during /audit-mall or when triaging upstream drift."` | `"Helper for skill authors."` |

## ACT discipline fields

### `lastReviewed`

`YYYY-MM-DD` of last review. Update on every meaningful pass. Drives the oldest-first review queue. If your repo ships a brain-qa validator, this field is typically hard-enforced.

## Validation

A brain-qa validator (where present) should hard-fail on a skill if any of these are true:

- `description` missing or empty (after trimming, after YAML block-scalar expansion)
- `lastReviewed` missing
- `lastReviewed` not a valid ISO `YYYY-MM-DD` date (rejects `2026-13-45`, `2026-02-30`, etc.)

`name` is conventional — typically not enforced.
