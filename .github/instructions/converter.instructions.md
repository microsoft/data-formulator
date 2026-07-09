---
description: "Document conversion routing -- detect format, delegate to the converter SA or run the appropriate muscle directly"
applyTo: "**/*convert*,**/*docx*,**/*word*,**/*eml*,**/*html-to-md*,**/*md-to-*"
lastReviewed: 2026-05-26
---

# Document Conversion

Route conversion requests to the right format skill and muscle. Each format has its own skill (domain logic) and muscle (executable).

## Format Routing

| Request pattern | Skill | Muscle | Command prefix |
| --- | --- | --- | --- |
| Markdown to HTML | `md-to-html` | `md-to-html.cjs` | `node .github/skills/md-to-html/scripts/md-to-html.cjs` |
| Markdown to Word | `md-to-word` | `md-to-word.cjs` | `node .github/skills/md-to-word/scripts/md-to-word.cjs` |
| Markdown to email | `md-to-eml` | `md-to-eml.cjs` | `node .github/skills/md-to-eml/scripts/md-to-eml.cjs` |
| Markdown to plain text | `md-to-txt` | `md-to-txt.cjs` | `node .github/skills/md-to-txt/scripts/md-to-txt.cjs` |
| Word to Markdown | `docx-to-md` | `docx-to-md.cjs` | `node .github/skills/docx-to-md/scripts/docx-to-md.cjs` |
| HTML to Markdown | `html-to-md` | `html-to-md.cjs` | `node .github/skills/html-to-md/scripts/html-to-md.cjs` |

## Workflow

1. Detect the source and target format from the user's request
2. Load the matching format skill for domain-specific options and rules
3. Run the muscle with appropriate flags
4. Run `converter-qa.cjs` on the output to validate quality
5. Report results with any QA findings

## Common Options (all formats)

| Flag | Effect |
| --- | --- |
| `--style <preset>` | Apply a style preset (professional, academic, minimal, dark) |
| `--toc` | Add table of contents |
| `--debug` | Keep intermediate files for troubleshooting |

Format-specific options are documented in each format's skill file.

## Would Revise If

Revisit this instruction by **2026-08-26** (90 days) or sooner if any of the following fires: pandoc upstream changes a flag this routing table promises (`--style`, `--toc`); a converter skill moves out of `.github/skills/<format>/scripts/`; or a new conversion format ships (e.g., md-to-pdf) and the routing table doesn't reflect it.
