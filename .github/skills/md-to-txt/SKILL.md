---
name: "md-to-txt"
description: "Strip Markdown formatting and produce clean plain text via pandoc"
lastReviewed: 2026-05-26
---

# Md To Txt

Strip all Markdown formatting and produce clean plain text. Useful for clipboard export, email body fallback, accessibility, and as input to text analysis tools.

## Quick Start

```bash
node .github/skills/md-to-txt/scripts/md-to-txt.cjs source.md output.txt
```

## Options

| Flag | Default | Effect |
|---|---|---|
| `--wrap N` | 80 | Line wrap width (0 = no wrap) |
| `--strip-frontmatter` | off | Remove YAML frontmatter |
| `--strip-mermaid` | off | Replace Mermaid blocks with `[diagram]` |
| `--strip-images` | off | Replace image refs with alt text |
| `--no-replace-em-dashes` | em-dashes ARE replaced for txt | Keep `—` literal |
| `--strip-decorative-rules` | HRs preserved for txt | Strip decorative `---` lines |

## Format-Aware Defaults

Plain text gets:

- **Em-dash → `, ` ON.** AI-tell em-dashes look bad in monospace fonts.
- **Decorative HR strip OFF.** Pandoc renders `---` as visible plain-text dividers, which are usually intentional in txt output.

Override via flags above.

## What gets stripped

- Bold, italic, strikethrough markers
- Inline code backticks
- Link URLs (alt text preserved)
- Heading `#` markers
- Bullet/list markers (indentation preserved)

## Related

- [lint-clean-markdown](../lint-clean-markdown/SKILL.md) — pre-flight the source
- [md-to-word](../md-to-word/SKILL.md) — for formatted output

## Would Revise If

Revisit this skill by **2026-08-26** (90 days) or sooner if any of the following fires: pandoc upstream changes plain-text output in a way that breaks the documented "stripped" list; the heuristic for indentation preservation produces wrong output on a real source the user converts; or a heir needs a stripped-but-not-plain output (e.g., RTF, SRT) that this skill doesn't cover — split into a sibling skill instead.
