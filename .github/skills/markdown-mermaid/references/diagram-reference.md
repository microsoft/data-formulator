# Mermaid Diagram Reference

> Reference: companion to [SKILL.md](../SKILL.md). Diagram types, node shapes, edge styles, color palettes (legacy + GitHub Pastel v2 + Fishbowl), per-diagram theming, classDef styles, subgraph styling, Gantt and sequence diagram theming, and visual design principles.

## 🎨 Diagram Types and Theming

### ⚡ Quick Start — Pastel v2 Template

**Use the MANDATORY template at the top of this skill.** Copy-paste from there — it is the single source of truth.

**Four things every diagram needs:**

1. `%%{init}%%` directive with `edgeLabelBackground: '#ffffff'`
2. `classDef` or `style` for node colors
3. `linkStyle default stroke:#57606a` for arrow color
4. Edge labels `|text|` with white background (from init)

> 💡 For color theory and design principles, see the **graphic-design** skill. The palette values here come from that skill's color system, optimized for GitHub rendering.

### Diagram Types

| Type | Syntax | Best Use Case |
| ---- | ------ | ------------- |
| Flowchart | `flowchart TB/LR/BT/RL` | Process flows, decision trees |
| Sequence | `sequenceDiagram` | API calls, interactions |
| State | `stateDiagram-v2` | State machines, lifecycles |
| Class | `classDiagram` | OOP design, relationships |
| ER | `erDiagram` | Database schema |
| Gantt | `gantt` | Project timelines |
| Pie | `pie` | Simple proportions |
| Mindmap | `mindmap` | Concept hierarchies |
| Quadrant | `quadrantChart` | 2D positioning analysis |
| Git Graph | `gitGraph` | Branch workflows |
| XY Chart | `xychart-beta` | Data plotting |
| Sankey | `sankey-beta` | Flow analysis |
| Block | `block-beta` | Block diagrams |

### Node Shapes (Flowchart)

```text
A[Rectangle]      B(Rounded)        C([Stadium])
D[[Subroutine]]   E[(Database)]     F((Circle))
G>Asymmetric]     H{Diamond}        I{{Hexagon}}
J[/Parallelogram/]
```

### Edge Styles

```text
A --> B           Standard arrow
A --- B           Line without arrow
A -.-> B          Dotted arrow
A ==> B           Thick arrow
A --"label"--> B  Labeled edge
A -->|"label"| B  Alternative label syntax
```

### Color Palette (Legacy — GitHub-Compatible)

> **Note:** Superseded by GitHub Pastel Palette v2 below. Kept for reference only.

| Purpose | Background | Border/Stroke |
| ------- | ---------- | ------------- |
| **GitHub Light** | `#f6f8fa` | `#d1d9e0` |
| **Text** | - | `#1f2328` |
| **Lines** | - | `#656d76` |
| **Success** | `#e8f5e9` | `#2e7d32` |
| **Info** | `#e3f2fd` | `#1565c0` |
| **Warning** | `#fff3e0` | `#ef6c00` |
| **Special** | `#f3e5f5` | `#7b1fa2` |
| **Danger** | `#ffebee` | `#c62828` |
| **Neutral** | `#f5f5f5` | `#424242` |

### GitHub Pastel Palette v2 (Default)

*Higher contrast, better accessibility. Always use this palette for new diagrams.*

**Node Style Pattern**: `style NODE fill:#FILL,color:#TEXT,stroke:#STROKE`

| Purpose | Fill | Text | Stroke | Usage |
| ------- | ---- | ---- | ------ | ----- |
| Bronze/Peach | `#fff1e5` | `#953800` | `#ffb77c` | Data ingestion, raw layer |
| Silver/Gray | `#eaeef2` | `#24292f` | `#afb8c1` | Processing, transformation |
| Gold/Yellow | `#fff8c5` | `#9a6700` | `#d4a72c` | Business logic, highlights |
| Blue/Sky | `#ddf4ff` | `#0550ae` | `#80ccff` | Actions, primary operations |
| Purple | `#d8b9ff` | `#6639ba` | `#bf8aff` | DevOps, tracking, special |
| Green/Mint | `#d3f5db` | `#1a7f37` | `#6fdd8b` | Success, validation, output |
| Red/Coral | `#ffebe9` | `#cf222e` | `#f5a3a3` | Errors, critical, warning |
| Neutral | `#eaeef2` | `#24292f` | `#d0d7de` | Background, containers |

**Arrow/Link Styling** (CRITICAL for readability):

```text
linkStyle default stroke:#57606a,stroke-width:1.5px
```

**Complete Example**: Use the MANDATORY template at the top, with only the classDefs you need.

**Key Principles**:

1. **Light fills** (#fff1e5, #ddf4ff) — Easy on the eyes
2. **Medium text** (#953800, #0550ae) — Readable but not harsh
3. **Soft strokes** matching fill family
4. **Gray arrows** (#57606a) — Neutral, doesn't compete with nodes
5. **1.5-2px stroke-width** — Visible but not heavy
6. **edgeLabelBackground: '#ffffff'** — White background for readable edge labels

### Fishbowl Pastel Palette (Alternative)

*Softer palette with uniform dark text. Good for governance, compliance, and presentation diagrams.*

| Purpose | Fill | Stroke | Text |
| ------- | ---- | ------ | ---- |
| Primary | `#cce5ff` | `#4a90d9` | `#333` |
| Light Blue | `#b3d9ff` | `#4a90d9` | `#333` |
| Lavender | `#e6d5f2` | `#8b6eb3` | `#333` |
| Mint | `#c2f0d8` | `#4db37d` | `#333` |
| Cream | `#fff3b3` | `#d4a849` | `#333` |
| Soft Pink | `#ffcccc` | `#cc6666` | `#333` |

**Init directive (Fishbowl):**

```text
%%{init: {'theme': 'base', 'themeVariables': {
  'primaryColor': '#cce5ff',
  'primaryBorderColor': '#4a90d9',
  'primaryTextColor': '#333',
  'secondaryColor': '#e6d5f2',
  'tertiaryColor': '#c2f0d8',
  'lineColor': '#666',
  'edgeLabelBackground': '#ffffff'
}}}%%
```

**When to choose Fishbowl over GitHub Pastel v2**: Use Fishbowl when all nodes need equal visual weight (e.g., governance structures, compliance flows). Use GitHub Pastel v2 when nodes carry semantic meaning that should be color-coded by category.

### Per-Diagram Theming (MANDATORY for consistency)

Add as FIRST line inside mermaid block:

**Default init directive (GitHub Pastel v2):**

```text
%%{init: {'theme': 'base', 'themeVariables': {
  'primaryColor': '#ddf4ff',
  'primaryBorderColor': '#0969da',
  'primaryTextColor': '#1f2328',
  'lineColor': '#57606a',
  'edgeLabelBackground': '#ffffff'
}}}%%
```

**Standard GitHub-compatible theme (legacy):**

```text
%%{init: {'theme': 'base', 'themeVariables': {
  'primaryColor': '#f6f8fa',
  'primaryBorderColor': '#d1d9e0',
  'primaryTextColor': '#1f2328',
  'lineColor': '#656d76',
  'edgeLabelBackground': '#ffffff'
}}}%%
```

**Quadrant chart theme:**

```text
%%{init: {'theme': 'base', 'themeVariables': {
  'quadrant1Fill': '#d3f5db',
  'quadrant2Fill': '#fff8c5',
  'quadrant3Fill': '#ffebe9',
  'quadrant4Fill': '#ddf4ff',
  'quadrantPointFill': '#1f2328',
  'quadrantTitleFill': '#1f2328'
}}}%%
```

### classDef Reusable Styles

Define style classes once and apply to multiple nodes. Cleaner than per-node `style` directives.

**Pastel v2 classDef Quick Reference** (copy-paste ready):

```text
classDef blue fill:#ddf4ff,color:#0550ae,stroke:#80ccff
classDef green fill:#d3f5db,color:#1a7f37,stroke:#6fdd8b
classDef purple fill:#d8b9ff,color:#6639ba,stroke:#bf8aff
classDef gold fill:#fff8c5,color:#9a6700,stroke:#d4a72c
classDef red fill:#ffebe9,color:#cf222e,stroke:#f5a3a3
classDef bronze fill:#fff1e5,color:#953800,stroke:#ffb77c
classDef neutral fill:#eaeef2,color:#24292f,stroke:#d0d7de
```

**Apply to multiple nodes**: `class A,B,C blue`

**Apply inline**: `A[Label]:::blue`

### Subgraph Styling

Style subgraph backgrounds with the `style` directive using the subgraph ID:

```text
flowchart LR
    subgraph SG1["Phase 1"]
        direction TB
        A --> B
    end
    subgraph SG2["Phase 2"]
        direction TB
        C --> D
    end

    style SG1 fill:#ddf4ff,stroke:#80ccff,color:#0550ae
    style SG2 fill:#d3f5db,stroke:#6fdd8b,color:#1a7f37
```

**Key**: Use `fill` for background, keep it light. The `color` property sets the title text color.

### Gantt Chart Theming

Gantt charts use different theme variables than flowcharts:

```text
  'taskBkgColor': '#ddf4ff',
  'activeTaskBkgColor': '#d3f5db',
  'activeTaskBorderColor': '#6fdd8b',
  'doneTaskBkgColor': '#eaeef2',
  'doneTaskBorderColor': '#d0d7de',
  'critBkgColor': '#ffebe9',
  'critBorderColor': '#f5a3a3',
  'todayLineColor': '#cf222e',
  'gridColor': '#d0d7de',
  'sectionBkgColor': '#f6f8fa',
  'altSectionBkgColor': '#ffffff',
  'taskTextColor': '#24292f',
  'sectionBkgColor2': '#f6f8fa'
}}}%%
```

**Section formatting**: Gantt sections inherit alternating background colors. Use `section` keyword to group related tasks:

```text
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Task A :done, a1, 2026-01-01, 14d
    Task B :active, a2, after a1, 7d
    section Phase 2
    Task C :crit, a3, after a2, 10d
```

### Sequence Diagram Theming

```text
  'actorBkg': '#ddf4ff',
  'actorBorder': '#80ccff',
  'actorTextColor': '#0550ae',
  'activationBkgColor': '#d3f5db',
  'activationBorderColor': '#6fdd8b',
  'signalColor': '#57606a',
  'labelBoxBkgColor': '#fff8c5',
  'labelTextColor': '#9a6700',
  'noteBkgColor': '#fff8c5',
  'noteTextColor': '#9a6700',
  'noteBorderColor': '#d4a72c'
}}}%%
```

---

## 🎨 Visual Design Principles

### Color Psychology in Diagrams

| Color | Association | Use For |
| ----- | ----------- | ------- |
| 💙 **Blue** | Trust, reliability | Human partnership, collaboration |
| 💜 **Purple** | Consciousness, awareness | Identity, higher concepts |
| 💚 **Green** | Growth, learning | Cognitive processing, success |
| 🧡 **Orange** | Connection, energy | Memory networks, neural links |
| ❤️ **Red** | Power, achievement | Advanced capabilities, warnings |

### Diagram Effectiveness Criteria

- **Clarity**: Audience understands in 30 seconds
- **Accuracy**: Correctly represents the system/process
- **Completeness**: All essential elements, no clutter
- **Consistency**: Follows visual conventions
- **Maintainability**: Easy to update

### Accessibility Standards

- Provide alternative text descriptions
- Use color-blind friendly palettes
- Ensure sufficient contrast
- Don't rely on color alone for meaning

---

