---
description: "Convert a document between formats (md/html/word/eml/txt). Detects source and target format, runs the appropriate per-skill script, validates with converter-qa."
lastReviewed: 2026-05-26
---

# /convert

Convert a document to another format.

## Steps

1. **Detect formats**: Identify the source file and target format from the user's request. If ambiguous, ask.
2. **Load format skill**: Read the matching skill from `.github/skills/<format>/SKILL.md` for format-specific rules and options.
3. **Run script**: Execute the conversion script with the user's options:
   ```
   node .github/skills/<format>/scripts/<format>.cjs <source> [output] [options]
   ```
4. **Validate**: Run converter-qa on the output:
   ```
   node .github/scripts/converter-qa.cjs <output>
   ```
5. **Report**: Show the output path, file size, and any QA findings.

## Format Detection

| User says | Source | Target | Script |
| --- | --- | --- | --- |
| "convert to word" / "make a docx" | .md | .docx | skills/md-to-word/scripts/md-to-word.cjs |
| "convert to html" / "make a webpage" | .md | .html | skills/md-to-html/scripts/md-to-html.cjs |
| "convert to email" / "make an eml" | .md | .eml | skills/md-to-eml/scripts/md-to-eml.cjs |
| "convert to plain text" | .md | .txt | skills/md-to-txt/scripts/md-to-txt.cjs |
| "convert this word doc" / "docx to md" | .docx | .md | skills/docx-to-md/scripts/docx-to-md.cjs |
| "convert this html" / "html to md" | .html | .md | skills/html-to-md/scripts/html-to-md.cjs |

## If the user provides no file

Ask which file to convert. Do not guess.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
