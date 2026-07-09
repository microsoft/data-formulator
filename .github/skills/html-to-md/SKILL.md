---
name: "html-to-md"
description: "Convert HTML documents to clean Markdown via pandoc"
lastReviewed: 2026-05-26
---

# Html To Md

Convert HTML documents to clean Markdown. Strips inline styles, scripts, and tracking pixels while preserving semantic structure.

## Quick Start

```bash
node .github/skills/html-to-md/scripts/html-to-md.cjs page.html page.md
```

## What's preserved

- Headings, paragraphs, lists, blockquotes
- Tables (when structure is regular)
- Links and inline code
- Image references (URLs kept as-is)
- Emphasis (bold, italic, strikethrough)

## What's dropped

- Inline `style` attributes
- `<script>` and `<style>` blocks
- Tracking pixels and analytics tags
- Most `<div>`/`<span>` wrappers (semantic content preserved)

## Optional flags

| Flag | Effect |
|---|---|
| `--download-images` | Fetch referenced images to a local `images/` folder |
| `--wrap N` | Line wrap width (default: 80) |

## Post-conversion

- Run [lint-clean-markdown](../lint-clean-markdown/SKILL.md) over the output to fix heading hierarchy and list spacing.
- HTML often has multiple `<h1>` tags; Markdown wants exactly one.

## Related

- [docx-to-md](../docx-to-md/SKILL.md) — Word source
- [lint-clean-markdown](../lint-clean-markdown/SKILL.md) — clean up the result

## Would Revise If

Revisit this skill by **2026-08-26** (90 days) or sooner if any of the following fires: pandoc upstream changes html-to-md behavior in a way that breaks the documented flag semantics; the `--download-images` flow fails on a real source the user runs through it; or `lint-clean-markdown` post-processing stops being the right finishing step (e.g., a stricter linter ships and the pipeline needs to chain to it instead).
