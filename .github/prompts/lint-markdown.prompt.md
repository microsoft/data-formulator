---
description: "Validate Markdown files against converter requirements — frontmatter, mermaid syntax, SVG presence, structural rules — before running converters"
lastReviewed: 2026-05-26
---

# Lint Markdown

Run the markdown validator on a file before converting it to Word, HTML, EML, or TXT. Catches issues that cause conversion failures or degraded output.

Skill: [lint-clean-markdown](../skills/lint-clean-markdown/SKILL.md). Muscle: `.github/skills/markdown-mermaid/scripts/markdown-lint.cjs`. Always-on rule: [lint-discipline.instructions.md](../instructions/lint-discipline.instructions.md) ("fix lint always — even if not yours").

## When to Use

- Before running any converter (`/md-to-word`, `/md-to-html`, `/md-to-eml`, `/md-to-txt`)
- After editing a markdown file with diagrams, tables, or frontmatter
- As part of CI/precommit gating
- When troubleshooting a converter failure ("output looks broken")

## What it validates

- **Frontmatter**: present, well-formed YAML, required fields per file type
- **Mermaid blocks**: parsable syntax, supported diagram types, no `\n` literals in node labels
- **SVG inclusion**: referenced SVGs exist; no broken `![alt](path.svg)` references
- **Structural rules**: heading hierarchy (no skipped levels), table integrity, link validity
- **Common pitfalls**: emoji that won't render, unescaped HTML in body, trailing whitespace inside code blocks

## Steps

1. **Confirm scope** — single file or directory? If directory, recursive over `*.md`.
2. **Run**:

   ```sh
   node .github/skills/markdown-mermaid/scripts/markdown-lint.cjs FILE.md
   node .github/skills/markdown-mermaid/scripts/markdown-lint.cjs docs/ --recursive
   ```

3. **Read the report**:
   - Exit 0 = clean (proceed to conversion)
   - Exit 1 = warnings (cosmetic; converter will work but output may degrade)
   - Exit 2 = errors (converter will fail or produce broken output — fix before converting)
4. **For each error**, the report names the file, line, rule, and suggested fix.
5. **Fix and re-run** until exit 0. Then run the conversion.

## Boundaries

- **Not a formatter.** This validates; it doesn't modify files. For whitespace cleanup, use `/format-markdown` first.
- **Converter-specific rules.** What's valid here is what the converters in `.github/skills/md-to-*/scripts/md-to-*.cjs` expect. Markdown that lints clean here may still fail other markdown processors that have stricter rules.
- **Mermaid validation is best-effort.** The linter parses syntax but doesn't render diagrams. Genuine render failures only show up in `/md-to-word` or `/md-to-html` output.
- **Frontmatter rules vary by file type.** A SKILL.md needs different fields than an instructions.md needs different fields than a prompt.md. The linter applies the right rule by filename pattern.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
