---
name: "md-to-word"
description: "Convert Markdown with Mermaid diagrams and SVG illustrations to professional Word documents"
lastReviewed: 2026-05-18
---

# Md To Word

> One command to professional Word documents — diagrams, tables, and formatting done right on first attempt.

Convert any Markdown document into polished Word (.docx) files ready for stakeholders, executives, and external audiences. Supports all standard Markdown formatting, Mermaid diagrams (auto-converted to PNG), and SVG illustrations (auto-embedded).

## Why Use This?

| Without This Skill | With This Skill |
|-------------------|-----------------|
| Mermaid diagrams missing or broken | Auto-rendered to high-res PNG, optimally sized |
| SVG images not displaying | Auto-converted to PNG with proper dimensions |
| Tables plain and unprofessional | Microsoft-branded headers, borders, zebra striping |
| Tables split mid-row across pages | Smart pagination keeps rows intact |
| Images overflow page boundaries | 90% page coverage constraint ensures fit |
| Bullet lists merge into paragraphs | Preprocessor fixes spacing automatically |
| Code blocks lose formatting | Consolas font, gray background, proper borders |
| Links plain text | Blue underlined hyperlinks |
| Headings inconsistent | Branded colors, proper hierarchy |

## Document Publishing Workflow

```
Markdown (.md)  →  md-to-word.cjs  →  Word (.docx)  →  Final PDF
     ↓                   ↓                ↓               ↓
  Source            Automation      Manual polish     Distribution
  (your docs)      (this skill)    (page breaks,     (File > Save As)
                                    headers/footers)
```

1. **Convert to Word**: Run `md-to-word.cjs` — produces a complete, styled document
2. **Optional polish**: Add page breaks, headers/footers, custom branding
3. **Export PDF**: Word's File > Save As > PDF gives best fidelity

## Supported Markdown Formatting

| Feature | Support | Notes |
|---------|---------|-------|
| **Headings** (H1-H6) | ✅ Full | Branded colors, proper spacing |
| **Bold/Italic/Strikethrough** | ✅ Full | `**bold**`, `*italic*`, `~~strike~~` |
| **Bullet lists** | ✅ Full | Nested supported |
| **Numbered lists** | ✅ Full | Auto-numbered |
| **Task lists** | ✅ Full | `- [ ]` / `- [x]` converted |
| **Tables** | ✅ Full | Professional styling |
| **Code blocks** | ✅ Full | Syntax highlighting preserved |
| **Inline code** | ✅ Full | Monospace with background |
| **Links** | ✅ Full | Blue underlined |
| **Images** (PNG/JPG) | ✅ Full | Centered, auto-sized |
| **SVG images** | ✅ Auto-convert | Rendered to PNG |
| **Mermaid diagrams** | ✅ Auto-convert | Rendered to PNG |
| **Blockquotes** | ✅ Full | Gray left border |
| **Horizontal rules** | ✅ Full | Light gray line |
| **Footnotes** | ✅ Pandoc | Via pandoc extension |
| **YAML frontmatter** | ✅ Strip | `--strip-frontmatter` option |

## Mermaid Diagram Support

All Mermaid diagram types are supported:

| Diagram Type | Detection | Sizing Strategy |
|--------------|-----------|-----------------|
| **Flowchart LR** | `flowchart lr` | Width priority (6.5") |
| **Flowchart TB** | `flowchart tb` | Height priority (3.6") |
| **Sequence** | `sequenceDiagram` | Width priority |
| **Gantt** | `gantt` | Width priority (wide) |
| **Class** | `classDiagram` | Auto |
| **ER** | `erDiagram` | Auto |
| **State** | `stateDiagram` | Auto |
| **Pie** | `pie` | Smaller width |
| **Mindmap** | `mindmap` | Width priority |
| **Timeline** | `timeline` | Width priority |

Diagrams are rendered at 4x scale (4800px width) for crisp printing, then sized to fit within page bounds.

---

## Quick Start

### One-Command Conversion

```bash
# From your project root
node .github/skills/md-to-word/scripts/md-to-word.cjs docs/spec.md

# With custom output name
node .github/skills/md-to-word/scripts/md-to-word.cjs README.md output.docx

# Keep intermediate files for debugging
node .github/skills/md-to-word/scripts/md-to-word.cjs docs/plan.md --keep-temp
```

### What It Does

1. **Preprocesses Markdown** — fixes bullet lists, checkbox syntax, spacing
2. **Converts Mermaid to PNG** — renders diagrams with white backgrounds
3. **Calculates optimal sizing** — reads actual PNG dimensions, fits 90% of page
4. **Converts SVG to PNG** — handles banner images
5. **Generates Word via pandoc** — clean markdown-to-docx conversion
6. **Formats tables** — Microsoft blue headers, borders, alternating rows
7. **Centers images** — all diagrams centered on page
8. **Styles headings** — consistent colors and spacing

---

## Installation

### Prerequisites

| Tool | Install (macOS) | Install (Windows) | Purpose |
|------|-----------------|-------------------|---------|
| **Node.js 24+** | `brew install node` | `winget install OpenJS.NodeJS.LTS` | Script runtime |
| **pandoc** | `brew install pandoc` | `winget install JohnMacFarlane.Pandoc` | Markdown to Word |
| **mermaid-cli** | `npm install -g @mermaid-js/mermaid-cli` | same | Mermaid to PNG |
| **jszip** | (bundled with extension) | same | OOXML post-processing |
| **svgexport** | `npm install -g svgexport` | same | SVG to PNG (optional) |

### Quick Install (All Dependencies)

**macOS**

```bash
brew install pandoc
npm install -g @mermaid-js/mermaid-cli svgexport
```

**Windows**

```powershell
winget install JohnMacFarlane.Pandoc
npm install -g @mermaid-js/mermaid-cli svgexport
```

---

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--toc` | off | Generate Table of Contents. A `[toc]` marker in the source is **stripped but does not auto-enable TOC** (since v5.5.0). When the marker is found without `--toc`, a warning is logged so the heir can either pass `--toc` explicitly or remove the marker. |
| `--cover` | off | Generate cover page from H1 + date |
| `--style PRESET` | professional | Style preset (see below) |
| `--page-size SIZE` | letter | Page size: letter, a4, 6x9 |
| `--reference-doc PATH` | — | Custom Word template (.dotx) |
| `--images-dir DIR` | images | Directory for generated PNG files |
| `--embed-images` | off | Embed local images as base64 |
| `--strip-frontmatter` | off | Remove YAML frontmatter |
| `--no-format-tables` | off | Skip table styling (faster) |
| `--keep-temp` | off | Keep temporary files for debugging |
| `--watch` | off | Auto-rebuild on source change |
| `--recursive` | off | Process all .md files in directory |
| `--dry-run` | off | Validate only, no output |
| `--debug` | off | Save preprocessed markdown |

## Style Presets

| Preset | Body Font | Heading Style | Use Case |
|--------|-----------|---------------|----------|
| **professional** | Segoe UI 10.5pt | Microsoft blue (#0078D4) | Business documents, specs, reports |
| **academic** | Times New Roman 12pt | Black, double-spaced | Dissertations, papers, theses |
| **course** | Calibri 11pt | Virginia Tech burgundy | Course materials, syllabi |
| **creative** | Georgia 11pt | Slate blue | Blog posts, narratives |

```bash
# Academic paper with TOC
node md-to-word.cjs thesis.md --style academic --toc

# Professional report with cover
node md-to-word.cjs quarterly-report.md --style professional --cover --toc
```

## SVG Image Handling

SVG files are automatically detected and converted to PNG for Word compatibility:

```markdown
<!-- This SVG reference in your Markdown... -->
![Architecture](<your-diagram>.svg)

<!-- ...becomes this embedded PNG in Word -->
![Architecture](<your-diagram>.png){width=5.8in}
```

**Requirements**: `svgexport` (`npm install -g svgexport`)

**Best practices for SVG sources**:

- Use viewBox for scalable graphics
- Embed fonts or use web-safe font stack
- Keep file size under 500KB for fast conversion
- Avoid external references (they won't resolve)

---

## Image Sizing Algorithm

The script automatically fits images to page bounds. The constraints are codified
in `md-to-word.cjs`:

```
Page: 8.5" × 11" (Letter)
Margins: 1" each side
Usable area: 6.5" × 9.0"
MAX_IMAGE_WIDTH_RATIO  = 0.90   →  max width  ≈ 5.85"
MAX_IMAGE_HEIGHT_RATIO = 0.60   →  max height ≈ 5.40"
```

These ratios apply width-priority for landscape/wide diagrams (LR flowcharts,
gantts, sequence diagrams) and height-priority for portrait/tall diagrams (TB/TD
flowcharts with multiple subgraphs). The algorithm picks the more restrictive
constraint so the image fits in both dimensions.

### Algorithm Steps

1. **Read PNG dimensions** from file header (pure Node.js, no dependencies)
2. **Calculate scale factors** for width and height constraints
3. **Apply most restrictive** — ensures fit in both dimensions
4. **Specify constraining dimension** — pandoc preserves aspect ratio

---

## Mermaid Palette and Fidelity

When a Mermaid block has no `classDef`, no `%%{init}%%` directive, and no
explicit theme variables, the converter injects a **default pastel palette**
(GitHub-style soft colors with dark text) before rendering. This gives WYSIWYG
fidelity to authors who don't styled-by-design every diagram.

### Why per-diagram-type injection matters

| Diagram type | Honors `classDef`? | Color path |
|---|---|---|
| `flowchart` / `graph` | Yes | `classDef` (preferred) or injected init |
| `classDiagram` | Partial | `classDef` or injected init |
| `sequenceDiagram` | **No** | `themeVariables` only (e.g. `actorBkg`, `noteBkgColor`) |
| `stateDiagram-v2` | **No** | `themeVariables` only (`primaryColor`, `mainBkg`, `labelBoxBkgColor`) |
| `erDiagram` | No | `themeVariables` only |

Without diagram-type-aware injection, sequence and state diagrams would render
as flat neutral nodes regardless of any `classDef` the author wrote.

### Behavior

- `flowchart` / `graph` / `classDiagram` with `classDef` → **respected, no
  injection** (author wins)
- `flowchart` / `graph` without `classDef` → **palette injected** + lint nudge
- `sequenceDiagram` / `stateDiagram-v2` without `%%{init}%%` or explicit
  `actorBkg` / `primaryColor` → **palette injected** (only path to colors)
- Any block with `%%{init}%%` already present → **respected, no injection**

### Opting out

Pass `--no-default-palette` to disable injection. Diagrams without `classDef` or
explicit theme will then render with mermaid's default neutral theme, and a
warning is emitted per affected diagram.

### Lint warnings

During preprocessing the converter emits `💡` nudges for unstyled flowcharts
("inject default pastel palette") and `⚠️` warnings when `--no-default-palette`
is set on diagrams that would have rendered flat.

---

## Table Formatting

All tables receive professional OOXML styling (tightened in v5.5.0 for denser, more reference-document-style tables):

| Element | Style |
|---------|-------|
| **Header row** | Microsoft blue (#0078D4), white text, bold **9pt** |
| **Even data rows** | Light gray (#F0F0F0) |
| **Odd data rows** | White (#FFFFFF) |
| **Data cell font** | **8.5pt** black |
| **Borders** | Gray outer (#666666), light inner (#AAAAAA) |
| **Cell padding** | **1pt top/bottom, 3pt left/right** |
| **Pagination** | cantSplit + keepWithNext (no orphan headers) |
| **Repeat headers** | Header row repeats on each page for long tables |

---

## Professional Features

### Page Numbers

Centered page numbers in the footer, gray text (9pt).

### Heading Hierarchy

- H1: Brand color, underline, 360/120 twip spacing
- H2: Secondary color, 280/80 twip spacing
- H3: Tertiary color, 240/80 twip spacing
- All headings: keepNext + keepLines (no orphans)

### Code Blocks

- Font: Consolas 9pt
- Background: Light gray (#F5F5F5)
- Border: Left accent bar (#CCCCCC)
- Keep together: Won't split across pages

### Hyperlinks

- Color: Microsoft blue (#0563C1)
- Style: Single underline
- Applied to both inline links and reference links

### Captions

Paragraphs starting with "Table N" or "Figure N":

- Centered, italic, 9pt gray
- keepNext binding to following content

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "mmdc not found" | mermaid-cli not installed | `npm install -g @mermaid-js/mermaid-cli` |
| "pandoc not found" | pandoc not in PATH | `winget install JohnMacFarlane.Pandoc` (restart terminal) |
| "svgexport not found" | svgexport not installed | `npm install -g svgexport` |
| Tables not styled | jszip not available | Set `NODE_PATH` to extension node_modules |
| Diagrams too small | Outdated script | Update to v5.3.0+ |
| Images overflow | Complex diagram | Use `--debug` and check PNG dimensions |
| SVG not converting | Missing svgexport | Install or use PNG source |
| Document corrupt | Incomplete write | Check disk space, re-run |

### Debug Mode

```bash
node md-to-word.cjs doc.md --debug --keep-temp
# Check _debug_combined.md for preprocessed content
# Check images/ folder for generated PNGs
```

---

## macOS Fallback (No Pandoc)

macOS ships `textutil` which can convert HTML to DOCX natively:

```bash
# Convert markdown to HTML first, then HTML to DOCX
npx marked document.md -o document.html
textutil -convert docx document.html -output document.docx
```

| Feature | Pandoc (primary) | textutil (fallback) |
|---------|-----------------|-------------------|
| Table styling | Full (via jszip post-processing) | Basic |
| Mermaid diagrams | Supported (pre-rendered PNG) | Must be pre-rendered |
| Heading styles | Mapped to Word styles | Basic HTML mapping |
| Cross-references | Supported | Not supported |
| Install | `brew install pandoc` | Built-in (macOS only) |

**Limitations**: `textutil` needs HTML input (not raw Markdown), produces simpler formatting, and doesn't support the table styling or image sizing that `md-to-word.cjs` provides. Use only when Pandoc is unavailable and a quick conversion is needed.

---

## Batch Processing

### Convert a Folder

```powershell
# Windows PowerShell
Get-ChildItem docs/*.md | ForEach-Object {
    node .github/skills/md-to-word/scripts/md-to-word.cjs $_.FullName --style professional
}
```

```bash
# macOS/Linux
for f in docs/*.md; do
    node .github/skills/md-to-word/scripts/md-to-word.cjs "$f" --style professional
done
```

### Recursive Directory

```bash
# All .md files in docs/ and subdirectories
node .github/skills/md-to-word/scripts/md-to-word.cjs docs --recursive --style professional
```

### Watch Mode

```bash
# Auto-rebuild when source changes
node .github/skills/md-to-word/scripts/md-to-word.cjs spec.md --watch
```

---

## Integration Examples

### GitHub Actions CI/CD

```yaml
# Generate Word docs as build artifacts
- name: Generate Word Documents
  run: |
    npm install -g @mermaid-js/mermaid-cli svgexport
    node .github/skills/md-to-word/scripts/md-to-word.cjs docs/spec.md --toc --cover

- name: Upload artifacts
  uses: actions/upload-artifact@v4
  with:
    name: word-documents
    path: docs/*.docx
```

### npm Script

```json
{
  "scripts": {
    "docs:word": "node .github/skills/md-to-word/scripts/md-to-word.cjs docs/README.md --style professional --toc"
  }
}
```

---

## For Heir Projects

1. Copy `.github/skills/md-to-word/scripts/md-to-word.cjs` to your project
2. Copy shared modules from `.github/scripts/shared/` (markdown-preprocessor, mermaid-pipeline)
3. Install prerequisites: `npm install -g @mermaid-js/mermaid-cli svgexport`
4. Run: `node .github/skills/md-to-word/scripts/md-to-word.cjs your-doc.md`

---

## Version History

| Version | Changes |
|---------|---------|
| **5.5.0** | Tighter table styling (header 10pt→9pt, data 9pt→8.5pt, cell margins 2pt/4pt → 1pt/3pt). `[toc]` marker in source now strips the line but does **not** auto-enable TOC — warning logged instead, requires explicit `--toc` to generate. Coverage smoke test corpus added at `docs/testing/md-to-word-coverage.md`. |
| **5.4.0** | Diagram-type-aware Mermaid palette injection (sequence/state get themeVariables, flowcharts respect classDef), `--no-default-palette` opt-out, lint warnings for unstyled diagrams, sizing constants documented |
| **5.3.0** | Style presets (professional, academic, course, creative), --cover, --toc |
| **5.0.0** | SVG auto-conversion via svgexport, watch mode, recursive processing |
| **4.0.0** | OOXML post-processing: page numbers, hyperlinks, code block styling |
| **3.0.0** | Markdown preprocessing, heading colors, caption formatting |
| **2.1.0** | Table pagination (cantSplit, keepWithNext) prevents orphan headers |
| **2.0.0** | 90% H+V coverage, actual PNG dimension reading |
| **1.0.0** | Initial: pandoc + mermaid + table formatting |

---

## Conversion Acceptance Decision Table

| Condition | Verdict | Action |
|-----------|---------|--------|
| All headings use correct Word styles (Heading 1-6) | Accept | Verify TOC generates from styles |
| Headings are bold plain text instead of styled | Reject | Check pandoc heading-style mapping |
| Tables render with borders and header row formatting | Accept | Spot-check alignment |
| Tables overflow page width or lose column alignment | Reject | Adjust column widths or split wide tables |
| Images embedded at correct resolution | Accept | Verify no placeholder boxes |
| Images missing or show `[image]` placeholder | Reject | Check image paths resolve; pandoc `--resource-path` |
| Mermaid diagrams converted to PNG and embedded | Accept | Verify labels readable at print size |
| Mermaid diagrams missing entirely | Reject | Pre-render with mermaid-cli before pandoc |
| Code blocks use monospace font with syntax coloring | Accept | Verify long lines don't overflow |
| Code blocks use body font or lose indentation | Warning | Check pandoc `--highlight-style` setting |
| Page breaks at expected section boundaries | Accept | Required for multi-section documents |
| Headers/footers match brand template | Accept | Verify reference.docx applied correctly |
| File opens without macro warnings | Accept | Required — no macros in output |
| File size >10MB for text-only document | Warning | Check for uncompressed embedded images |

---

## Related Skills

| Skill | Relationship |
|-------|--------------|
| **markdown-mermaid** | Mermaid syntax and ATACCU compliance |
| **lint-clean-markdown** | Pre-flight the source — pass clean Markdown in |
| **markdown-sanitization-chain** | Sanitize user-supplied Markdown before conversion |
| **markdown-mermaid § Mode Fragility** | Why we default to flowchart mode |
| **md-to-html** | HTML output with same preprocessing |

## Falsifiability

- This skill is wrong if .docx files produced per its guidance fail to open or lose formatting on round-trip (Word → save → reopen)
- The reference-doc approach is stale if Pandoc changes how --reference-doc applies styles in a major version
- Not earning tokens if the user must manually fix the same structural or styling issues on every conversion
