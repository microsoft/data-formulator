---
name: "md-to-html"
description: "Convert Markdown to standalone HTML pages with embedded CSS, images, and Mermaid diagrams"
lastReviewed: 2026-04-30
---

# Md To Html

> Write in Markdown, share as a polished web page — zero dependencies for viewers

Convert Markdown documents into self-contained HTML files with embedded CSS, base64 images, and Mermaid diagram rendering. Ready for quick-share distribution, offline viewing, print, or email attachment.

---

## When to Use

- Sharing formatted documents without requiring Word or PDF viewers
- Creating self-contained HTML pages for offline distribution
- Generating printable web pages from Markdown sources
- Quick previews of documentation with professional styling
- Email attachments that open in any browser
- Static site generation from Markdown sources

---

## Supported Formatting

| Format | Status | Notes |
|--------|--------|-------|
| **Headings** | ✅ | H1-H6 with styled colors |
| **Bold/Italic** | ✅ | Standard emphasis |
| **Links** | ✅ | Styled with underline on hover |
| **Images** | ✅ | Base64 embedded or linked |
| **Code blocks** | ✅ | Syntax highlighting, monospace font |
| **Inline code** | ✅ | Background highlight |
| **Tables** | ✅ | Striped rows, header styling |
| **Blockquotes** | ✅ | Left border, italic style |
| **Lists** | ✅ | Ordered, unordered, nested |
| **Task lists** | ✅ | Checkbox rendering |
| **Mermaid diagrams** | ✅ | PNG or table fallback |
| **SVG** | ✅ | Inline or base64 embedded |
| **Horizontal rules** | ✅ | Styled dividers |
| **Footnotes** | ✅ | Via pandoc |
| **Math (KaTeX)** | ⚠️ | Requires --katex flag |

---

## Key Features

| Feature | Details |
|---------|---------|
| Style presets | professional, academic, minimal, dark |
| Self-contained | All CSS embedded in `<style>` block, no external deps |
| Image embedding | Local images converted to base64 data URIs |
| Mermaid support | PNG rendering or table fallback for diagrams |
| Print-ready | CSS `@media print` rules included |
| TOC generation | Optional table of contents via `--toc` |
| Frontmatter | Extracted for title, stripped from output |

## Usage

```bash
# Basic conversion (professional style)
node .github/skills/md-to-html/scripts/md-to-html.cjs report.md

# Academic style with TOC
node .github/skills/md-to-html/scripts/md-to-html.cjs thesis.md --style academic --toc

# Dark mode output
node .github/skills/md-to-html/scripts/md-to-html.cjs docs.md --style dark

# Mermaid diagrams rendered as PNG (high quality)
node .github/skills/md-to-html/scripts/md-to-html.cjs architecture.md --mermaid-png

# Custom output path
node .github/skills/md-to-html/scripts/md-to-html.cjs README.md output/readme.html

# Dry run (validate without generating)
node .github/skills/md-to-html/scripts/md-to-html.cjs report.md --dry-run

# Debug mode (save preprocessed markdown)
node .github/skills/md-to-html/scripts/md-to-html.cjs report.md --debug
```

---

## Options Reference

| Option | Default | Description |
|--------|---------|-------------|
| `--style PRESET` | professional | Style preset: professional, academic, minimal, dark |
| `--toc` | off | Generate table of contents from headings |
| `--embed-images` | true | Convert local images to base64 data URIs |
| `--no-embed-images` | - | Keep image paths as-is (external references) |
| `--strip-frontmatter` | true | Remove YAML frontmatter from output |
| `--mermaid-png` | off | Render Mermaid as PNG (requires mmdc) |
| `--mermaid-fallback` | default | Convert Mermaid to table representation |
| `--debug` | off | Save preprocessed markdown as _debug_combined.md |
| `--dry-run` | off | Validate only, no HTML output |

---

## Style Presets

| Preset | Font | Max Width | Colors | Best For |
|--------|------|-----------|--------|----------|
| **professional** | Segoe UI | 900px | Blue headings, white bg | Business docs, reports |
| **academic** | Palatino Linotype | 750px | Dark headings, cream bg | Papers, theses |
| **minimal** | Inter | 800px | Black/gray, white bg | Clean, modern pages |
| **dark** | Segoe UI | 900px | Light text, dark bg | Dark mode preference |

---

## Mermaid Diagram Support

| Diagram Type | PNG Mode | Fallback Mode |
|--------------|----------|---------------|
| Flowchart | ✅ Full render | ✅ Table |
| Sequence | ✅ Full render | ✅ Table |
| Class | ✅ Full render | ✅ Table |
| State | ✅ Full render | ✅ Table |
| ER | ✅ Full render | ✅ Table |
| Gantt | ✅ Full render | ⚠️ Limited |
| Pie | ✅ Full render | ✅ Table |
| Journey | ✅ Full render | ⚠️ Limited |

**PNG Mode** (`--mermaid-png`): Requires mermaid-cli (mmdc). Renders at scale 8, 2400px width for crisp output. Diagrams are embedded as base64 PNGs.

**Fallback Mode** (default): No external dependencies. Converts diagram syntax to an ASCII table representation suitable for text-only viewing.

---

## Print Styling

HTML output includes `@media print` CSS rules:

- Page breaks before H1 headings
- No background colors (ink-friendly)
- Link URLs shown after text
- Code blocks with borders instead of background
- Proper margins for binding

---

## Batch Processing

```bash
# Convert all markdown files in a directory
for file in docs/*.md; do
  node .github/skills/md-to-html/scripts/md-to-html.cjs "$file" --style professional
done

# PowerShell equivalent
Get-ChildItem docs/*.md | ForEach-Object {
  node .github/skills/md-to-html/scripts/md-to-html.cjs $_.FullName --style professional
}
```

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| "pandoc not found" | pandoc not installed | `winget install pandoc` |
| Mermaid not rendering | mmdc not installed | `npm install -g @mermaid-js/mermaid-cli` or use fallback |
| Images missing | Relative paths broken | Use `--embed-images` (default) |
| Output too wide on print | Style preset issue | Use academic style for print |
| Special characters garbled | Encoding issue | Ensure source is UTF-8 |

---

## Requirements

- Node.js 24+
- pandoc (`winget install pandoc`)
- mermaid-cli (optional, only for `--mermaid-png`)

---

## Muscle Script

`.github/skills/md-to-html/scripts/md-to-html.cjs` (v1.0.0)

---

## Conversion Acceptance Decision Table

| Condition | Verdict | Action |
|-----------|---------|--------|
| All headings, lists, tables, code blocks render correctly | Accept | Ship as-is |
| Mermaid diagrams rendered as PNG/SVG with correct layout | Accept | Verify diagram labels readable |
| Mermaid diagrams missing or show raw syntax | Reject | Check mermaid-cli installed; re-run with `--mermaid-png` |
| Math equations (KaTeX/MathJax) render correctly | Accept | Spot-check complex equations |
| Math equations show raw LaTeX source | Reject | Verify KaTeX CSS/JS included in template |
| Embedded images display at correct size | Accept | Confirm no broken `<img>` tags |
| Images missing or show broken placeholders | Reject | Check paths are relative and files exist |
| CSS custom properties resolve (colors, fonts) | Accept | Visual spot-check against brand |
| Inline styles lost or overridden by browser defaults | Warning | Add `!important` or inline fallbacks |
| Output file size >5MB for a simple document | Warning | Check for unoptimized base64 images |
| HTML validates (no unclosed tags, no script injection) | Accept | Required for security |
| HTML contains `<script>` from untrusted source | Reject | Sanitize; only allow known libraries |

---

## Related Skills

- **md-to-word** — Sister converter for Word document output
- **md-scaffold** — Generate converter-ready Markdown templates
- **markdown-mermaid** — Diagram authoring for embedded Mermaid
- **lint-clean-markdown** — Pre-validate markdown before conversion
- **nav-inject** — Add navigation tables for multi-file suites

---

*Skill version: 2.0.0 | Last updated: 2026-04-14 | Category: document-conversion*

## Falsifiability

- This skill is wrong if generated HTML fails W3C validation on structural elements the skill explicitly handles
- The conversion flags are stale if Pandoc changes default HTML5 output behavior in a major version
- Not earning tokens if the output loses semantic structure (headings, lists, code blocks) that raw Pandoc preserves without the documented options
