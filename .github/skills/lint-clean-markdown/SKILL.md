---
name: "lint-clean-markdown"
description: "Write markdown that passes markdownlint on first attempt — encode the most common rules as muscle memory"
lastReviewed: 2026-05-01
---

# Lint-Clean Markdown

> Eliminate the edit-lint-fix cycle by writing markdown correctly the first time.

## When to Use

- Authoring any markdown file in this brain or in heir documentation
- Reviewing a PR that touches `.md` files
- The file just hit MD031, MD032, MD022, or MD060 errors

## The Golden Rule

**When in doubt: add a blank line.**

Roughly 90% of markdown lint errors are missing blank lines. Lists, code blocks, and headings all need breathing room.

## Core Rules Quick Reference

| Rule | Code | Pattern | Mnemonic |
|------|------|---------|----------|
| Blank lines around lists | MD032 | `\n- item\n- item\n` | "Lists breathe" |
| Blank lines around fences | MD031 | `\n\`\`\`code\`\`\`\n` | "Code breathes" |
| Blank line before headings | MD022 | `text\n\n## Head` | "Headers breathe" |
| Use dash for lists | MD004 | `-` not `*` or `+` | "Dash dash dash" |
| No trailing whitespace | MD009 | No spaces at line end | "Clean endings" |
| Hard line break in prose | (no MD code) | End line with `\` then newline | "Backslash breaks" |
| Single final newline | MD047 | One `\n` at EOF | "One newline" |
| Language on fences | MD040 | ` ```js ` not ` ``` ` | "Name your code" |
| Consistent fence style | MD046 | Use ` ``` ` not indent | "Fences only" |
| No bold as heading | MD036 | Use `##` not `**text**` | "Headers are headers" |
| Table separator spacing | MD060 | Space around pipes | "Tables breathe too" |

## Rule Details

### MD032: Blank Lines Around Lists

❌ Wrong: text immediately before/after list

✅ Correct: blank line before first `-` AND after last `-`

```markdown
**Why**:

- Reason one
- Reason two

**Result**: Something
```

### MD031: Blank Lines Around Code Blocks

❌ Wrong: text touching the fence markers

✅ Correct: blank line before opening ` ``` ` AND after closing ` ``` `

### MD022: Blank Lines Before Headings

❌ Wrong: `Some text.\n## Heading`

✅ Correct: `Some text.\n\n## Heading`

### Hard Line Breaks in Prose (the metadata-block trap)

**The problem**: Markdown collapses consecutive lines into one wrapped paragraph. A block of metadata like `**Date**:`, `**Author**:`, `**Status**:` on consecutive lines renders as one run-on sentence unless you force breaks.

**The wrong fixes**:

- **Two trailing spaces** (`text  `) — works in most renderers, but lints as MD009 (no trailing whitespace) and is invisible in source review.
- **Empty lines between every item** — turns the metadata block into a wall of paragraphs with massive vertical spacing.
- **`<br/>` tag** — works but mixes HTML into prose markdown; flagged as MD033 in many configs.

**The right fix**: end each line with a backslash (`\`) followed by a newline. This is the CommonMark hard-line-break form. Renders identically to two spaces, but is visible in source review and lints clean.

❌ Wrong (renders as one wrapped paragraph):

```markdown
**Date**: 2026-05-01
**Author**: Supervisor
**Status**: Analysis
```

✅ Correct (renders as three lines):

```markdown
**Date**: 2026-05-01 \
**Author**: Supervisor \
**Status**: Analysis
```

**Note the spacing**: one space before the backslash, then the newline. The last line in the block does not need the backslash (no break needed after the final line).

**When this rule fires**:

- Document metadata blocks (Date / Author / Status / Audience / Trigger) at the top of decision docs, ADRs, READMEs
- Address blocks, contact-info blocks
- Any list of consecutive `**Label**: value` lines that should *visually* be separate but should *not* have full paragraph spacing between them
- Poetry, lyrics, or any prose where line breaks are semantic

**Not applicable in these cases**:

- Inside a real Markdown list (use `-` or `1.` instead)
- Inside a table (use `<br/>` for in-cell line breaks)
- Inside a code fence (literal newlines work; no special handling needed)

### MD004: Use Dash for Unordered Lists

❌ Wrong: `* item` or `+ item`

✅ Correct: `- item`

### MD040: Specify Language on Fenced Code

❌ Wrong: ` ``` ` (no language)

✅ Correct: ` ```javascript ` or ` ```text ` or ` ```markdown `

## Mermaid-Specific Rules

### Template Blocks Use `text`

When showing a template/pattern (not a renderable diagram), use ` ```text ` instead of ` ```mermaid `. The Mermaid parser will fail on placeholder text like `[DIAGRAM_TYPE]`.

### Diagram Type Required

Every ` ```mermaid ` block must declare its diagram type on the first line (`flowchart TB`, `sequenceDiagram`, etc.) — otherwise it renders blank.

## Nested Code Block Problem

You cannot nest fenced code blocks in markdown. When documenting code-block rules:

1. Use **inline code** for short examples: `` `js` ``
2. Use **descriptions** instead of showing wrong examples literally
3. Use **single examples** showing only the correct form

This skill itself demonstrates the solution.

## Pre-Write Mental Checklist

Before writing markdown, plan for:

1. ☐ Will I have lists? → blank lines around them
2. ☐ Will I have code blocks? → blank lines around them
3. ☐ Will I show "wrong" examples? → can't nest fences, describe instead
4. ☐ Will I have tables? → need `| ---- |` separator row
5. ☐ Will I have mermaid? → diagram type after init

## Related

- [markdown-mermaid](../markdown-mermaid/SKILL.md) — full markdown + Mermaid style guide
- [markdown-mermaid § Mode Fragility](../markdown-mermaid/SKILL.md) — silent render failures

## Falsifiability

- This skill has failed if markdown produced after activation still fails markdownlint with the same violation classes the skill explicitly addresses
- The rule set is stale if markdownlint releases new defaults this skill contradicts
- Wrong if the formatting constraints reduce readability rather than improve it (user consistently overrides the prescribed style)
