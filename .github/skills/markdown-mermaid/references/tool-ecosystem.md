# Diagram Tool Ecosystem

> Reference: companion to [SKILL.md](../SKILL.md). Tool comparison matrix, VS Code extension setup, syntax examples for Mermaid / D2 / PlantUML / Excalidraw.

## 🛠️ Multi-Tool Ecosystem

### Tool Comparison Matrix

| Tool | Native GitHub | Complexity | Best For |
| ---- | ------------- | ---------- | -------- |
| **Mermaid** | ✅ Yes | Low-Medium | General purpose, quick diagrams |
| **PlantUML** | ❌ No | Medium-High | Enterprise UML, AWS/Azure |
| **Graphviz** | ❌ No | High | Complex networks, dependencies |
| **D2** | ❌ No | Low | Clean architecture overviews |
| **WaveDrom** | ❌ No | Medium | Digital timing diagrams |

### VS Code Extension Setup

VS Code 1.121+ renders Mermaid natively in Markdown previews (no extension required). The list below covers non-Mermaid tools (PlantUML, Graphviz, D2) and Mermaid-adjacent features still worth installing: chart authoring (`mermaidchart.vscode-mermaid-chart`) and the standalone live-preview tab (`vstirbu.vscode-mermaid-preview`). `bierner.markdown-mermaid` is omitted — 1.121's built-in renderer covers its use case.

```json
{
  "recommendations": [
    "vstirbu.vscode-mermaid-preview",
    "mermaidchart.vscode-mermaid-chart",
    "jebbs.plantuml",
    "joaompinto.vscode-graphviz",
    "terrastruct.d2",
    "shd101wyy.markdown-preview-enhanced",
    "yzane.markdown-pdf",
    "bierner.markdown-preview-github-styles"
  ]
}
```

### Syntax Examples

**PlantUML** (Enterprise UML):

```text
@startuml
!theme aws-orange
participant User
participant System
participant Database

User -> System: Request
System -> Database: Query
Database --> System: Response
System --> User: Result
@enduml
```

**Graphviz DOT** (Complex Networks):

```text
digraph G {
    rankdir=TB;
    node [shape=box, style=filled, fillcolor=lightblue];
    A -> B;
    A -> C;
    B -> D;
    C -> D;
}
```

**D2** (Modern Architecture):

```text
users -> web_server: HTTPS requests
web_server -> database: SQL queries

users.style.fill: "#e1f5fe"
web_server.style.fill: "#f3e5f5"
```

---

