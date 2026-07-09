---
name: "markdown-mermaid"
description: "Author markdown and Mermaid diagrams that render correctly in VS Code, GitHub, and other Mermaid 10+ consumers — covers diagram-tool selection, mandatory init template, parser pitfalls, and visual design rules. Use when writing technical docs with embedded diagrams, debugging Mermaid render failures, or choosing between Mermaid, Excalidraw, and other diagramming tools."
lastReviewed: 2026-05-26
---

# Markdown & Mermaid

A skill for markdown authoring, Mermaid diagramming, multi-tool visualization, VS Code integration, and cross-platform rendering consistency.

## When to Use

- Creating technical documentation with diagrams
- Choosing the right diagramming tool for your audience
- Troubleshooting Mermaid rendering issues
- Styling markdown previews in VS Code
- Converting unicode escapes to proper emojis
- Enterprise documentation with visual standards
- **Interactive diagrams in VS Code chat** (1.109+)

---

## ⚠️ MANDATORY: Start Every Diagram With This Template

**Do NOT write Mermaid code without this template.** Copy-paste first, then customize:

```text
%%{init: {'theme': 'base', 'themeVariables': {'lineColor': '#57606a', 'primaryColor': '#ddf4ff', 'primaryBorderColor': '#0969da', 'primaryTextColor': '#1f2328', 'edgeLabelBackground': '#ffffff'}}}%%
flowchart LR
    A[Input]:::blue --> B[Process]:::purple --> C[Output]:::green

    classDef blue fill:#ddf4ff,color:#0550ae,stroke:#80ccff
    classDef green fill:#d3f5db,color:#1a7f37,stroke:#6fdd8b
    classDef purple fill:#d8b9ff,color:#6639ba,stroke:#bf8aff
    classDef gold fill:#fff8c5,color:#9a6700,stroke:#d4a72c
    classDef red fill:#ffebe9,color:#cf222e,stroke:#f5a3a3
    classDef neutral fill:#eaeef2,color:#24292f,stroke:#d0d7de

    linkStyle default stroke:#57606a,stroke-width:1.5px
```

**Three required components:**

1. **Init directive** (line 1) — Sets theme, colors, white edge label background
2. **classDef** — Semantic colors for all node types
3. **linkStyle default** — Gray arrows at 1.5px width

| Color Class | Use For | Example |
| ----------- | ------- | ------- |
| `:::blue` | Input, source, start | `A[Audio]:::blue` |
| `:::green` | Output, result, data | `C[Transcript]:::green` |
| `:::purple` | Processing, model | `B[WhisperX]:::purple` |
| `:::gold` | Decision, condition | `D{Valid?}:::gold` |
| `:::red` | Error, warning | `E[Failed]:::red` |
| `:::neutral` | Context, optional | `F[Cache]:::neutral` |

---

## Mandatory Workflow: ATACCU

**Every Mermaid diagram MUST follow this 6-step protocol.** No exceptions — this prevents forgotten palettes, broken layouts, and inconsistent styling.

| Step | Action | What to Do |
| ---- | ------ | ---------- |
| **A** | **Analyze** | What data/process am I visualizing? Who is the audience? What diagram type fits? |
| **T** | **Think** | Which layout pattern? (Medallion/Lineage/Pipeline) How many nodes? Will it be too wide/tall? |
| **A** | **Apply** | **COPY THE TEMPLATE ABOVE** — init directive + classDef + linkStyle. No exceptions. |
| **C** | **Create** | Write the Mermaid code. Every node gets `:::className`. Every flowchart gets `linkStyle default`. |
| **C** | **Check** | Render the diagram. Verify: pastels (not saturated), layout (not lopsided), labels (readable), arrows (gray #57606a). |
| **U** | **Update** | Write the final diagram into the target `.md` file. Add `**Figure N:** *description*` label. |

### Pre-Flight Checklist (Steps A-T-A)

Before writing any Mermaid code, answer these:

```text
□ Diagram type selected (flowchart/sequence/gantt/quadrant/etc.)
□ Layout direction chosen (LR preferred for flow, TD for hierarchy)
□ Subgraph strategy decided (Medallion vs Lineage vs Pipeline)
□ Color assignments mapped (what color = what meaning)
□ Multi-line node labels use <br/> NOT \n
```

### Quality Gate (Steps C-C-U)

After creating the diagram, verify ALL of these:

```text
□ Init directive is FIRST line inside mermaid block
□ edgeLabelBackground is '#ffffff' (white background for edge labels)
□ ALL nodes have style/classDef (no unstyled nodes)
□ Colors are GitHub Pastel v2 (NOT saturated: no #51cf66, #339af0, #fab005)
□ linkStyle default stroke:#57606a,stroke-width:1.5px (flowcharts)
□ Node labels use <br/> for line breaks, NOT \n
□ Diagram rendered and visually inspected
□ No dimension > 3x the other (use subgroups to balance)
□ Figure label added below diagram block
□ Written to target file (not just shown in chat)
```

### Common Violations This Prevents

| Violation | ATACCU Step That Catches It |
| --------- | -------------------------- |
| Saturated colors instead of pastels | **Apply Skills** — load palette first |
| Missing init directive | **Apply Skills** — it's step 3 |
| `edgeLabelBackground: 'transparent'` used | **Apply Skills** — use `'#ffffff'` (white background) |
| `\n` in node labels (renders as literal text) | **Create** — use `<br/>` for line breaks |
| Missing linkStyle | **Create** — every flowchart needs it |
| Lopsided layout (7-way fan-out) | **Think** — choose layout pattern |
| Diagram only in chat, not in file | **Update** — write to `.md` file |
| No figure label | **Update** — add label |

---

## VS Code 1.109+ Native Chat Rendering

VS Code 1.109 introduces **native Mermaid rendering in chat** via the `renderMermaidDiagram` tool. This is a **deferred tool**: call `tool_search` for "mermaid" to load it before invocation.

### When to Use Native Rendering

When creating diagrams **in Copilot Chat** (not markdown files), use the native tool for:

- **Interactive exploration**: Pan, zoom, and full-screen viewing
- **Immediate feedback**: See diagrams without switching to markdown preview
- **Iterative refinement**: Quick edits with instant re-render
- **Copy source**: Extract the Mermaid code for documentation

### Usage Pattern

```text
User: Create a sequence diagram showing OAuth flow

Alex: [uses renderMermaidDiagram tool]
       → Interactive diagram appears in chat
       → User can pan/zoom/fullscreen
       → "Copy source" extracts code for docs
```

### When NOT to Use

- **Documentation authoring**: Use markdown code blocks for `.md` files
- **GitHub rendering**: Embed Mermaid in markdown for native GitHub support
- **Presentations**: Export to image formats or use D2

### Combined Workflow

1. **Design in chat**: Use `renderMermaidDiagram` for rapid iteration
2. **Finalize**: Copy the Mermaid source code
3. **Document**: Paste into markdown file with ` ```mermaid ` code fence

---

## Assets

| File | Purpose |
| ---- | ------- |
| `markdown-light.css` | VS Code preview styling |
| `polish-mermaid-setup.prompt.md` | Interactive Mermaid configuration helper |

**Setup:** Copy CSS to `.vscode/`, add `"markdown.styles": [".vscode/markdown-light.css"]` to settings.

**Mermaid Config:** Run the "Polish Mermaid Setup" prompt to configure Mermaid rendering for your VS Code environment.

---

## 🎯 Diagram Tool Selection Framework

### Step 1: Identify Your Communication Goal

| What You're Showing | Best Tools | Example Use Cases |
| ------------------- | ---------- | ----------------- |
| **Process/Workflow** | Mermaid Flowcharts, User Journey | Onboarding, approvals, troubleshooting |
| **System Architecture** | Mermaid Flowcharts with subgraphs, D2 | Microservices, API design |
| **Relationships** | Mermaid ER, Mindmaps, Graphviz | Database schemas, org charts |
| **Time/Sequence** | Mermaid Sequence, Gantt | API interactions, timelines |
| **Data/Metrics** | Mermaid XY Charts, Sankey, Quadrant | Performance, resource allocation |

### Step 2: Consider Your Audience

| Audience | Primary Goal | Recommended Tools | Style |
| -------- | ------------ | ----------------- | ----- |
| **Executives** | Strategic overview | D2, simple flowcharts | Clean, minimal |
| **Architects** | Technical accuracy | PlantUML, Mermaid C4 | Detailed, precise |
| **Developers** | Implementation | Mermaid Sequence, Class | Code-focused |
| **Product Managers** | User flows | User Journey, Flowcharts | Business-outcome |
| **Documentation** | Learning | All Mermaid types | Progressive disclosure |

### Step 3: Consider Platform

| Platform | Best Tools | Why |
| -------- | ---------- | --- |
| **GitHub/GitLab** | Mermaid | Native rendering, no setup |
| **Confluence/Wiki** | Mermaid, PlantUML | Plugin support |
| **VS Code** | All tools (extensions) | Live preview |
| **Presentations** | D2, simple Mermaid | Executive-friendly |

### Quick Decision Tree

```text
Need diagram? → What are you showing?
├── Process/Workflow → Mermaid Flowchart
├── System Architecture → Mermaid with subgraphs (or D2 for exec)
├── Relationships → Mermaid ER/Mindmap (or Graphviz for complex)
├── Time/Sequence → Mermaid Sequence/Gantt
└── Data/Metrics → Mermaid XY/Sankey/Quadrant
```

---

## Companion References

> Bulk content moved out of SKILL.md to stay under the 500-line skill-spec ceiling. Load these on demand when the section header below indicates relevance:

> - **[markdown-best-practices.md](references/markdown-best-practices.md)** — document structure template, figure/table conventions, Shields.io badges, emoji usage
> - **[tool-ecosystem.md](references/tool-ecosystem.md)** — Mermaid / D2 / PlantUML / Excalidraw comparison, VS Code extension setup, syntax examples
> - **[diagram-reference.md](references/diagram-reference.md)** — diagram types, node shapes, edge styles, color palettes (legacy + GitHub Pastel v2 + Fishbowl), per-diagram theming, classDef, subgraph styling, Gantt + sequence theming, visual design principles
> - **[pitfalls.md](references/pitfalls.md)** — parser pitfalls P1–P9, unicode/emoji failures, layout patterns, classDiagram + architecture-beta gotchas, reserved-word handling, cross-diagram compatibility matrix

## 🔍 Diagram Audit Methodology

When performing comprehensive diagram audits across a project or documentation set, follow this 4-step process:

### Step 1: Enumerate

Identify all Mermaid diagrams in the target scope:

```bash
# bash/zsh
grep -rl '```mermaid' --include='*.md' | while read f; do echo "$f: $(grep -c '```mermaid' "$f")"; done
```

```powershell
# PowerShell
Get-ChildItem -Recurse -Filter "*.md" |
  Select-String -Pattern '```mermaid' |
  Group-Object Path |
  Select-Object Name, Count
```

### Step 2: Categorize

Create an inventory table to track diagram state:

| # | File | Diagram Type | Status | Issues |
|---|------|-------------|--------|--------|
| 1 | README.md | flowchart | ⚠️ | Missing init |
| 2 | arch.md | sequence | ✅ | None |
| 3 | flow.md | flowchart | ❌ | Parse error |

**Status codes**: ✅ OK, ⚠️ Needs fix, ❌ Broken

### Step 3: Batch Fix

Apply fixes in batches by issue type:

1. **Reserved word errors** — Rephrase or quote labels
2. **Parse errors** — Apply 4 safety rules
3. **Style inconsistencies** — Apply GitHub Pastel v2 palette

### Step 4: Validate

Re-render all diagrams and confirm fixes:

- [ ] All diagrams render in VS Code preview
- [ ] All diagrams render on GitHub
- [ ] Color palette is consistent
- [ ] No parse errors in console

**Typical results**: A 30-40 diagram audit catches 10-15 issues in the first pass.

---

## ✅ Quality Checklist

### Before Committing

- [ ] All diagrams have figure labels
- [ ] All tables have table labels
- [ ] No unicode escape sequences
- [ ] Diagrams render correctly in preview AND GitHub
- [ ] Consistent heading hierarchy
- [ ] Links are valid

### Diagram Review

- [ ] Node labels are clear and concise (but not over-simplified)
- [ ] Colors follow consistent palette
- [ ] Subgraphs logically group related items
- [ ] Subgraph content is wide enough for title (VS Code)

### Don't Over-Simplify

**KISS ≠ Remove all detail**

KISS means removing **unnecessary** complexity while preserving **meaningful** information. If removing detail reduces understanding, keep it.

---

## 📚 External References

### Official Documentation

- [Mermaid Documentation](https://mermaid.js.org/intro/)
- [Mermaid Live Editor](https://mermaid.live/)
- [PlantUML Documentation](https://plantuml.com/)
- [Graphviz Documentation](https://graphviz.org/documentation/)
- [D2 Documentation](https://d2lang.com/)
- [Shields.io](https://shields.io/)

### VS Code Resources

- [VS Code Markdown Guide](https://code.visualstudio.com/docs/languages/markdown)
- [GitHub Flavored Markdown](https://github.github.com/gfm/)

### Visual Design Theory

- Tufte, E.R. - *The Visual Display of Quantitative Information*
- Cairo, A. - *The Functional Art*
- Knaflic, C.N. - *Storytelling with Data*

## Mode Fragility Reference

Several Mermaid modes fail silently on colons and special characters. Default to `flowchart` for arbitrary text content.

| Mode | Status | Constraint |
|------|--------|------------|
| `flowchart` | Safe | None — handles any content |
| `sequenceDiagram` | Safe | Standard message format |
| `classDiagram` | Safe | Standard notation |
| `erDiagram` | Safe | Standard notation |
| `stateDiagram` | Caution | Colons in state names |
| `journey` | Caution | Score format sensitive |
| `timeline` | Fragile | No colons in events; `:` is separator |
| `gitGraph` | Fragile | Long chains with quoted colon-tags break |
| `gantt` | Fragile | `dateFormat HH:mm` mis-parses task lines |

**Rule**: If your labels contain colons, times (`HH:MM`), or complex text, use `flowchart` and structure with subgraphs instead.

**Debug silent failures**: Check browser console, simplify content, test incrementally, try flowchart — if it works in flowchart, the mode is the problem.

## Falsifiability

- This skill is wrong if diagrams authored per these patterns fail to render in GitHub or VS Code preview
- The syntax guidance is stale if it conflicts with the current Mermaid.js spec (check mermaid.js.org/changelog)
- The mode-fragility warnings are not earning tokens if Mermaid resolves the documented rendering bugs in a future release