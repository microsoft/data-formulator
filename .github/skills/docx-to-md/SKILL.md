---
name: "docx-to-md"
description: "Convert Word documents (.docx) to clean Markdown with image extraction and pandoc cleanup"
lastReviewed: 2026-04-30
---

# Docx To Md

> Ingest Word documents into your Markdown workflow — clean, linted, version-control ready

Convert .docx files into clean, linted Markdown with extracted images, normalized headings, and cleaned table formatting. The reverse converter for ingesting external documents into a Markdown-based workflow.

---

## When to Use

- Importing Word documents from stakeholders into a Markdown-based workflow
- Converting legacy documentation to Markdown for version control
- Extracting content from .docx for further processing (presentations, email, web)
- Onboarding external resources (SOWs, RFPs, specs) into project repositories
- Migrating from Word-based documentation to docs-as-code
- Preparing content for static site generators (VitePress, Docusaurus, etc.)

---

## Supported Content

| Content Type | Status | Notes |
|--------------|--------|-------|
| **Headings** | ✅ | Hierarchy normalized to start at H1 |
| **Bold/Italic** | ✅ | Converted to Markdown syntax |
| **Links** | ✅ | Preserved as Markdown links |
| **Images** | ✅ | Extracted to images/ folder |
| **Tables** | ✅ | Cleaned and aligned |
| **Lists** | ✅ | Ordered, unordered, nested |
| **Code blocks** | ⚠️ | Detected if styled as code |
| **Footnotes** | ✅ | Converted to Markdown footnotes |
| **Comments** | ⚠️ | Stripped with `--strip-comments` |
| **Track changes** | ❌ | Accept/reject before converting |
| **Embedded objects** | ❌ | Extract manually |

---

## Key Features

| Feature | Details |
|---------|---------|
| Image extraction | Embedded images saved to `images/` folder with sequential naming |
| Pandoc cleanup | Removes escaped brackets, span classes, trailing backslashes |
| Table normalization | Aligns columns, adds proper separators |
| Heading fix | Normalizes hierarchy to start at H1 |
| Frontmatter | Optional YAML frontmatter with title and date |
| Comment stripping | Removes Word review comments |

---

## Usage

```bash
# Basic conversion
node .github/skills/docx-to-md/scripts/docx-to-md.cjs report.docx

# With frontmatter and heading normalization
node .github/skills/docx-to-md/scripts/docx-to-md.cjs spec.docx --add-frontmatter --fix-headings

# Strip review comments
node .github/skills/docx-to-md/scripts/docx-to-md.cjs reviewed.docx --strip-comments

# Custom output path
node .github/skills/docx-to-md/scripts/docx-to-md.cjs input.docx output/document.md

# Debug mode (keeps raw pandoc output)
node .github/skills/docx-to-md/scripts/docx-to-md.cjs input.docx --debug

# Full cleanup pipeline
node .github/skills/docx-to-md/scripts/docx-to-md.cjs spec.docx --add-frontmatter --fix-headings --strip-comments --clean-tables
```

---

## Options Reference

| Option | Default | Description |
|--------|---------|-------------|
| `--extract-images` | true | Extract images to images/ folder |
| `--no-extract-images` | - | Keep images as raw base64 in markdown |
| `--add-frontmatter` | off | Generate YAML frontmatter with title/date |
| `--clean-tables` | true | Normalize table column widths |
| `--no-clean-tables` | - | Keep pandoc raw table output |
| `--fix-headings` | off | Normalize heading hierarchy to start at H1 |
| `--wrap N` | 0 | Wrap lines at N characters (0 = no wrap) |
| `--strip-comments` | off | Remove Word comment annotations |
| `--debug` | off | Keep intermediate pandoc output |

---

## Post-Processing Pipeline

The conversion follows a multi-stage cleanup:

```
.docx → pandoc → raw MD → cleanup → clean MD
                            ↓
                    1. Escaped brackets removed
                    2. Trailing backslashes removed
                    3. Span classes stripped
                    4. Image attributes cleaned
                    5. Comments stripped (optional)
                    6. Headings normalized (optional)
                    7. Tables reformatted
                    8. Images extracted
                    9. Frontmatter added (optional)
```

---

## Pandoc Cleanup Details

| Pandoc Quirk | Before | After |
|--------------|--------|-------|
| Escaped brackets | `\[text\]` | `[text]` |
| Trailing backslashes | `line\` | `line` |
| Span classes | `{.underline}` | (removed) |
| Image attributes | `{width="5in"}` | (removed) |
| Heading anchors | `{#section-1}` | (removed) |
| Excessive blank lines | `\n\n\n\n` | `\n\n` |

---

## Image Extraction

Embedded images are extracted to a sibling `images/` folder:

```
input/
├── document.docx
└── document.md (output)
    └── images/
        ├── image1.png
        ├── image2.png
        └── image3.jpg
```

Image references in markdown are updated automatically:

```markdown
![](images/image1.png)
```

---

## Common Workflows

### Stakeholder Document Ingestion

```bash
# Convert with full cleanup
node .github/skills/docx-to-md/scripts/docx-to-md.cjs stakeholder-spec.docx \
  --add-frontmatter --fix-headings --strip-comments

# Validate formatting (exits 1 if file would be reformatted)
node .github/skills/markdown-mermaid/scripts/md-format.cjs stakeholder-spec.md --check

# Review and commit
git add stakeholder-spec.md images/
git commit -m "docs: ingest stakeholder specification"
```

### Legacy Documentation Migration

```bash
# Batch convert all Word docs
Get-ChildItem *.docx | ForEach-Object {
  node .github/skills/docx-to-md/scripts/docx-to-md.cjs $_.FullName --add-frontmatter --fix-headings
}
```

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| "pandoc not found" | pandoc not installed | `winget install pandoc` |
| Images missing | Extraction failed | Check images/ folder, re-run |
| Tables misaligned | Complex table structure | Manual cleanup may be needed |
| Headings start at H3 | Original doc structure | Use `--fix-headings` |
| Comments in output | Track changes not stripped | Use `--strip-comments` |
| Encoding issues | Non-UTF8 content | Re-save .docx as UTF-8 |

---

## Limitations

- **Track changes**: Accept or reject all changes in Word before converting
- **Embedded objects**: Charts, SmartArt, etc. must be extracted manually
- **Complex tables**: Merged cells may not convert cleanly
- **Styles**: Word styles are lost (only structural elements preserved)
- **Headers/footers**: Not extracted (document body only)

---

## Requirements

- Node.js 24+
- pandoc (`winget install pandoc`)

---

## Muscle Script

`.github/skills/docx-to-md/scripts/docx-to-md.cjs` (v1.0.0)

---

## Conversion Acceptance Decision Table

| Condition | Verdict | Action |
|-----------|---------|--------|
| All headings mapped to correct `#` levels | Accept | Verify no skipped heading levels |
| Headings rendered as bold paragraphs instead of `#` | Reject | Check pandoc `--shift-heading-level` and source styles |
| Tables converted to valid Markdown pipe tables | Accept | Spot-check alignment |
| Complex tables (merged cells) lose structure | Warning | Manual restructure or use HTML table fallback |
| Images extracted and linked with relative paths | Accept | Verify image files exist in output dir |
| Images lost or referenced with absolute Windows paths | Reject | Use `--extract-media` with correct output dir |
| Footnotes converted to Markdown footnote syntax | Accept | Verify numbering is sequential |
| Footnotes lost or inlined as parenthetical text | Warning | Check pandoc footnote handling |
| Code blocks preserve monospace and indentation | Accept | Verify language fence tags present |
| Track changes / comments stripped from output | Accept | Expected — Markdown has no change tracking |
| Track changes rendered as visible markup | Reject | Accept or reject all changes before conversion |
| Bullet and numbered lists preserve nesting | Accept | Verify indent levels match source |
| Output passes markdownlint with zero errors | Accept | Run `lint-clean-markdown` post-conversion |
| Round-trip (docx→md→docx) preserves semantic content | Accept | Formatting differences OK; content loss is not |

---

## Related Skills

- **md-to-word** — Reverse direction (Markdown to Word)
- **lint-clean-markdown** — Post-validate converted Markdown
- **md-to-html** — Convert result to HTML for web

---

*Skill version: 2.0.0 | Last updated: 2026-04-14 | Category: document-conversion*

## Falsifiability

- This skill is wrong if converted documents lose semantic structure (headings, lists, tables) that Pandoc preserves by default without the documented flags
- The flag recommendations are stale if a Pandoc major version changes default behaviors for the documented options
- The workflow is not earning its tokens if the user must manually fix the same structural issues on every conversion
