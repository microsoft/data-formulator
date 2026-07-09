---
description: "Format Markdown files for professional appearance — whitespace cleanup, blockquote continuity, ATX heading spacing — no semantic changes"
lastReviewed: 2026-05-26
---

# Format Markdown

Run the markdown whitespace formatter on a file or directory. Cleans presentation without altering meaning. Wraps the `md-format.cjs` muscle.

Muscle: `.github/skills/markdown-mermaid/scripts/md-format.cjs`. Companion: `lint-discipline.instructions.md` (the always-on rule that says "fix lint always — even if not yours") and `lint-clean-markdown` skill (the validator).

## When to Use

- After authoring or editing any markdown file
- Before committing markdown changes (CI gate alternative)
- When migrating markdown from another source (mixed line endings, trailing whitespace)
- When you notice 3+ blank lines, missing heading spacing, or inconsistent blockquotes

## What it does

- Strips UTF-8 BOM, normalizes line endings to LF
- Trims trailing whitespace (preserves ` \` and two-space hard breaks)
- Adds ` \` continuity to consecutive blockquote lines (forces visible line breaks)
- Collapses 3+ blank lines to 2
- Ensures blank line before and after ATX headings
- Ensures single trailing newline
- Code fences pass through untouched

**No semantic changes.** Headings, lists, links, code, and tables are not modified — only whitespace and structural spacing.

## Steps

1. **Confirm scope** — single file or directory? If directory, recursive over `*.md`.
2. **Choose mode**:
   - `--check` — exit 1 if any file would change (CI gate; no writes)
   - `--diff` — show changes (no writes)
   - `--in-place` — overwrite files
   - default (no flag) — print formatted output to stdout
3. **Run**. Examples:

   ```sh
   node .github/skills/markdown-mermaid/scripts/md-format.cjs README.md --check
   node .github/skills/markdown-mermaid/scripts/md-format.cjs docs/ --in-place
   node .github/skills/markdown-mermaid/scripts/md-format.cjs CHANGELOG.md --diff
   ```

4. **Verify**. If `--in-place`, `git diff` to see what changed. Should be only whitespace.

## Boundaries

- **Not a linter.** This is presentation cleanup, not validation. For lint rules (heading levels, link integrity, MD060), use `/lint-markdown` instead.
- **Not for code files.** Only `*.md`. Don't run on `.cjs`, `.json`, `.yml`.
- **Two-space hard breaks preserved.** Trailing-whitespace trimming explicitly skips lines ending in `  ` or ` \`.
- **Code fences are safe.** Content inside ` ``` ` blocks is never modified.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
