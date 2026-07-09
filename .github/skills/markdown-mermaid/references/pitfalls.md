# Mermaid Parser Pitfalls and Common Solutions

> Reference: companion to [SKILL.md](../SKILL.md). Real parser failures (P1-P9), unicode/emoji issues, layout problems, classDiagram/architecture-beta gotchas, reserved-word handling, and cross-diagram compatibility.

## ⚠️ Parser Pitfalls (Real Failures)

These are parse-level failures that prevent rendering entirely. Captured from real production diagrams that broke. Read this section before writing any non-trivial Mermaid block.

### P1. Quote labels containing reserved characters

The Mermaid parser treats `@`, `:`, `(`, `)`, `,`, `#`, `&` as tokens inside unquoted node labels. Wrap the label in double quotes whenever it contains any of those, or you will get errors like `Parse error on line N: Expecting 'AMP', 'COLON', ... got 'LINK_ID'`.

```text
%% BAD — parser error
M1[fabric-capacity.bicep<br/>Microsoft.Fabric/capacities@2023-11-01]

%% GOOD
M1["fabric-capacity.bicep<br/>Microsoft.Fabric/capacities@2023-11-01"]
```

Trigger characters that require quoting:

| Character | Where it appears |
| --- | --- |
| `@` | ARM API versions, npm scopes, email addresses |
| `:` | Outside of subgraph titles — namespaces, time stamps |
| `()` | Method signatures, URL parts, `(optional)` annotations |
| `,` | Multi-clause labels |
| `#` | Hash, anchor, hex codes |
| `&` literal | Standalone — see P3 for the operator |

When in doubt, quote. Costs nothing, immunizes against parser updates.

### P2. No HTML entities inside shape brackets

`&lt;`, `&gt;`, `&amp;` inside stadium `([...])`, cylinder `[(...)]`, or hex `{{...}}` shapes break the parser. Drop the entity or quote the label.

```text
%% BAD
Start([./deploy.ps1 -SubscriptionId &lt;sub&gt;])

%% GOOD
Start(["./deploy.ps1 -SubscriptionId <sub>"])
```

### P3. Don't use the `&` edge-list operator

Mermaid's spec allows `A & B & C --> D`, but it renders inconsistently across versions (works in mermaid.live, fails in some VS Code preview builds). Always expand to individual edges.

```text
%% BAD — flaky across renderers
M1 & M2 & M3 & M4 --> Outputs

%% GOOD — explicit
M1 --> Outputs
M2 --> Outputs
M3 --> Outputs
M4 --> Outputs
```

### P4. Avoid cylinder shape with multi-line content

Cylinder `[(...)]` combined with `<br/>` line breaks has caused parse flakes. Use a regular rectangle and put the data-shape semantics in the label itself.

```text
%% BAD
Outputs[(Bicep outputs:<br/>fabricCapacityId<br/>fabricCapacityName)]

%% GOOD
Outputs[Bicep outputs<br/>fabricCapacityId<br/>fabricCapacityName]
```

### P5. `stateDiagram-v2` ignores `classDef`

State diagrams do not accept `classDef`. Style states by overriding the init directive's `primaryColor` for the whole diagram, or accept theme defaults. **Without `theme: 'base'`, unstyled states render solid black** in many renderers — always include the init directive.

```text
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#fef3c7', 'primaryBorderColor': '#fcd34d', 'primaryTextColor': '#1f2937', 'edgeLabelBackground': '#ffffff'}}}%%
stateDiagram-v2
    [*] --> Healthy
    Healthy --> Overage : load spike
```

### P6. Markdownlint table-pipe spacing (`MD060`)

Tables in markdownlint-strict repos require **a space on either side of every pipe**. Use `| --- |` not `|---|`. The compact form passes some renderers but fails strict lint.

```markdown
| Resource | API version |
| --- | --- |
| Microsoft.Fabric/capacities | 2023-11-01 |
```

### P7. Pipe inside inline code triggers `MD056`

Markdownlint's column-count check (`MD056`) counts a literal `|` inside an inline code span as a column separator and reports a column-count mismatch. Either drop the `|` from the example, escape it as `\|`, or move the example out of the table.

### P8. No blank lines inside blockquotes (`MD028`)

Blank lines inside a blockquote break it into separate quotes for the linter. Either continue the quote with `>` on every line (including empty lines as `>`), or break out of the quote completely between paragraphs.

```markdown
%% BAD — MD028
> First paragraph.
>
> Second paragraph.   ← (this works visually but `>` empty line is required)

%% GOOD
> First paragraph.
>
> Second paragraph.
```

(The empty `>` line above is required — a fully blank line ends the quote.)

### P9. Always specify language on fenced code blocks (`MD040`)

```` ```bicep ```` not ```` ``` ````. Renderers and lints both depend on it. Use `text` for plain output if no language fits.

### Quick reference card

| Pitfall | Symptom | Fix |
| --- | --- | --- |
| P1 reserved chars unquoted | `Parse error: Expecting AMP, COLON…` | Quote the label |
| P2 HTML entities in shapes | Parser fails on `&lt;` | Drop the entity, quote |
| P3 `&` edge operator | Diagram renders in one viewer, not another | Expand to N edges |
| P4 cylinder + `<br/>` | Intermittent parser flake | Use rectangle |
| P5 `classDef` in state diagram | Styles ignored, black nodes | Init directive only |
| P6 `MD060` | Lint error on tables | Space around every pipe |
| P7 `MD056` | Column-count mismatch | Remove `\|` from inline code |
| P8 `MD028` | Blockquote breaks | Use `>` on empty lines |
| P9 `MD040` | Lint error on fences | Always specify language |

---

## ⚠️ Common Pitfalls & Solutions

### Unicode Escape Sequences (Broken Emojis)

**Problem**: Emojis stored as `\ud83d\udcbb` display as raw codes instead of 💻

**Detection:**

```bash
# bash/zsh
grep -rn '\\u[0-9a-fA-F]\{4\}' --include='*.md'
```

```powershell
# PowerShell
Get-ChildItem -Recurse -Filter "*.md" | Select-String -Pattern '\\u[0-9a-fA-F]{4}' | Group-Object Path
```

**Prevention (VS Code settings):**

```json
{
    "files.encoding": "utf8",
    "files.autoGuessEncoding": false
}
```

### Emoji Mapping Table

| Escape | Emoji | Name |
| ------ | ----- | ---- |
| `\ud83e\udde0` | 🧠 | Brain |
| `\ud83d\udcbb` | 💻 | Laptop |
| `\ud83d\ude80` | 🚀 | Rocket |
| `\ud83c\udfaf` | 🎯 | Target |
| `\ud83d\udca1` | 💡 | Lightbulb |
| `\ud83d\udd0d` | 🔍 | Search |
| `\ud83d\udd04` | 🔄 | Cycle |
| `\u2699\ufe0f` | ⚙️ | Gear |
| `\ud83d\udd27` | 🔧 | Wrench |
| `\u26a1` | ⚡ | Lightning |
| `\ud83c\udf1f` | 🌟 | Star |
| `\ud83c\udf19` | 🌙 | Moon |
| `\u2601\ufe0f` | ☁️ | Cloud |
| `\ud83c\udf10` | 🌐 | Globe |
| `\ud83d\udcac` | 💬 | Speech |
| `\ud83d\udcdd` | 📝 | Memo |
| `\ud83d\udccb` | 📋 | Clipboard |
| `\ud83d\udcc8` | 📈 | Chart Up |
| `\ud83d\udcbe` | 💾 | Floppy |
| `\ud83d\udce6` | 📦 | Package |
| `\u2705` | ✅ | Check |
| `\u274c` | ❌ | Cross |
| `\u26a0\ufe0f` | ⚠️ | Warning |
| `\ud83d\udea8` | 🚨 | Siren |
| `\ud83d\udd12` | 🔒 | Lock |
| `\ud83d\udd11` | 🔑 | Key |
| `\ud83d\udcca` | 📊 | Bar Chart |
| `\ud83d\udcc1` | 📁 | Folder |
| `\ud83d\udc1b` | 🐛 | Bug |
| `\u2728` | ✨ | Sparkles |
| `\ud83c\udfc6` | 🏆 | Trophy |
| `\ud83e\udd16` | 🤖 | Robot |
| `\ud83d\udcda` | 📚 | Books |

### Edge Label Dark Background

**Problem**: Arrow labels (`|text|`) appear with dark boxes in VS Code dark mode or break rendering

**Root cause**: Missing or incorrect `edgeLabelBackground` settings.

**Fix**: Always include `edgeLabelBackground: '#ffffff'` in your init directive:

```text
%%{init: {'theme': 'base', 'themeVariables': {
  'primaryColor': '#ddf4ff',
  'lineColor': '#57606a',
  'edgeLabelBackground': '#ffffff'
}}}%%

flowchart LR
    A -->|label text| B
```

This provides a clean white background for edge labels, ensuring readability on any rendering surface.

> ⚠️ Never use `theme: 'dark'` — use `theme: 'base'` with the pastel palette instead.

### Multi-Line Node Labels (`\n` vs `<br/>`)

**Problem**: `\n` in node labels renders as a literal backslash-n in VS Code and some Mermaid versions:

```text
❌ A["First line\nSecond line"]   ← may render as "First line\nSecond line"
✅ A["First line<br/>Second line"] ← always works
```

**Rule**: Always use `<br/>` for multi-line node labels in flowcharts.

### Dark Mermaid Backgrounds

**Problem**: Diagrams have dark backgrounds in VS Code preview

**Solution 2**: Apply included `markdown-light.css` via settings

### Disproportionate Diagram Layouts (Too Wide/Too Tall)

**Problem**: Diagrams become too wide (horizontal) or too tall (vertical), causing poor readability

**Detection**: Look for diagrams where one dimension is 3x+ the other

**Pattern**: Use opposing directions for outer flowchart vs. inner subgraphs:

```text
%% Pattern 1: TD outer with LR inner (vertical stack of horizontal lanes)
flowchart TD
    subgraph Phase1["Phase 1"]
        direction LR
        A --> B --> C
    end
    subgraph Phase2["Phase 2"]
        direction LR
        D --> E --> F
    end

%% Pattern 2: LR outer with TB inner (horizontal flow of vertical stacks)
flowchart LR
    subgraph Group1["Group 1"]
        direction TB
        A --> B --> C
    end
    subgraph Group2["Group 2"]
        direction TB
        D --> E --> F
    end
```

**Key Rules**:

| Outer Direction | Inner Direction | Result |
| --------------- | --------------- | ------ |
| TD/TB | LR | Subgraphs stack vertically, content flows horizontally |
| LR | TB | Subgraphs flow horizontally, content stacks vertically |

**Anti-Pattern 1**: Single subgraph with opposing direction has no effect (nothing to stack)

```text
%% WRONG - single subgraph, direction LR does nothing useful
flowchart TD
    subgraph Only["Only Subgraph"]
        direction LR
        A --> B --> C --> D --> E  %% Still very wide!
    end

%% RIGHT - break into multiple subgraphs
flowchart TD
    subgraph Phase1["Setup"]
        direction LR
        A --> B
    end
    subgraph Phase2["Execute"]
        direction LR
        C --> D
    end
```

**Anti-Pattern 2**: Cross-subgraph edges defined inside subgraphs (causes layout confusion)

```text
%% WRONG - edge to next subgraph defined inside source subgraph
flowchart TD
    subgraph Phase1["Setup"]
        direction LR
        A --> B
        B --> C  %% C is in Phase2!
    end
    subgraph Phase2["Execute"]
        direction LR
        C --> D
    end

%% RIGHT - cross-subgraph edges defined outside all subgraphs
flowchart TD
    subgraph Phase1["Setup"]
        direction LR
        A --> B
    end
    subgraph Phase2["Execute"]
        direction LR
        C --> D
    end
    B --> C  %% Cross-subgraph edge outside
    subgraph Phase3["Complete"]
        direction LR
        E
    end
```

**Anti-Pattern 3**: Independent subgraphs without connections default to vertical stacking

```text
%% WRONG - no connections between subgraphs, ignores LR direction
flowchart LR
    subgraph A["Group A"]
        direction TB
        A1 --> A2
    end
    subgraph B["Group B"]
        direction TB
        B1 --> B2
    end
    %% Result: Groups stack vertically despite LR!

%% RIGHT - invisible links force horizontal layout
flowchart LR
    subgraph A["Group A"]
        direction TB
        A1 --> A2
    end
    subgraph B["Group B"]
        direction TB
        B1 --> B2
    end
    A ~~~ B  %% Invisible link forces LR arrangement
```

### Named Layout Patterns

Use these named patterns for consistent, well-proportioned diagrams. Each combines an outer flowchart direction with inner subgraph directions.

#### Medallion Pattern (TD + LR)

**Use when**: Phases/layers stack vertically, each containing a horizontal flow.

```text
flowchart TD
    subgraph Phase1["Phase 1: Ingestion"]
        direction LR
        A[Source] --> B[Validate] --> C[Store]
    end
    subgraph Phase2["Phase 2: Processing"]
        direction LR
        D[Load] --> E[Transform] --> F[Enrich]
    end
    Phase1 --> Phase2
```

**Result**: Compact rectangle. Good for pipelines, ETL stages, layered architectures.

#### Lineage Pattern (LR + TB)

**Use when**: Groups flow left-to-right, each containing a vertical stack.

```text
flowchart LR
    subgraph Cluster1["Input"]
        direction TB
        A1[Raw] --> A2[Clean]
    end
    subgraph Cluster2["Process"]
        direction TB
        B1[Compute] --> B2[Validate]
    end
    subgraph Cluster3["Output"]
        direction TB
        C1[Format] --> C2[Deliver]
    end
    Cluster1 --> Cluster2 --> Cluster3
```

**Result**: Wide timeline-like layout. Good for data lineage, system boundaries, progression.

#### Pipeline Pattern (LR + LR)

**Use when**: Everything flows left-to-right (flat pipeline, no vertical stacking needed).

```text
flowchart LR
    A[Input] --> B[Stage 1] --> C[Stage 2] --> D[Output]
```

**Result**: Simple horizontal chain. Good for CI/CD, request flows, simple sequences.

#### Pattern Decision Matrix

| Your Content | Pattern | Outer | Inner | Typical Shape |
| ------------ | ------- | ----- | ----- | ------------- |
| Phases with steps inside | **Medallion** | TD | LR | Tall rectangle |
| Groups flowing in sequence | **Lineage** | LR | TB | Wide rectangle |
| Simple linear flow | **Pipeline** | LR | — | Narrow strip |
| Hierarchy, org chart | **Tree** | TD | — | Triangle |
| Complex interconnected | **Medallion** | TD | LR | Structured layers |

#### Independent Subgraphs (Invisible Links)

When subgraphs have no logical connections between them, Mermaid ignores the outer direction and stacks them vertically by default. Fix with invisible links (`~~~`):

```text
flowchart LR
    subgraph A["Group A"]
        direction TB
        A1 --> A2
    end
    subgraph B["Group B"]
        direction TB
        B1 --> B2
    end
    A ~~~ B  %% Forces horizontal arrangement per outer LR
```

**Rule**: Always add `~~~` between independent subgraphs to enforce the outer direction.

**Multiple independent groups**: Chain invisible links: `A ~~~ B ~~~ C ~~~ D`

### Subgraph Title Truncation (VS Code Only)

**Problem**: Subgraph titles get truncated in VS Code preview

**Note**: This is a **VS Code Mermaid renderer bug**. GitHub renders correctly.

**Root Cause**: VS Code calculates subgraph width from content nodes, NOT title text.

**Workaround**: Make content nodes wider so the subgraph expands:

```text
%% BAD in VS Code - narrow nodes clip title
subgraph CONSCIOUS["🌟 Conscious Mind"]
    A["Chat"]
    B["Commands"]
end

%% GOOD - descriptive labels force wider box
subgraph CONSCIOUS["🌟 Conscious Mind"]
    A["💬 Chat Participant"]
    B["⚡ VS Code Commands"]
end
```

### Mermaid Parse Errors

**Problem**: Nested quotes, parentheses, or reserved words cause cryptic parse errors

**Rule 1**: Don't nest quotes inside quoted node labels

```text
%% ❌ FAILS - nested quotes
["Return with<br/>"🌐 Results<br/>(Info)"]

%% ✅ WORKS - no nested quotes
["🌐 Return Results<br/>Info"]
```

**Rule 2**: Avoid HTML tags inside node labels (some renderers choke on them)

```text
%% ❌ RISKY - <i> tag may break parsing
CFG["config.json<br/><i>inert — rarely traversed</i>"]

%% ✅ SAFE - plain text with em dash
CFG["config.json — inert, rarely traversed"]
```

**Rule 3**: Avoid em dashes (—) in subgraph titles (some parsers treat them as operators)

```text
%% ❌ RISKY - em dash in subgraph title
subgraph P1["Phase 1 — Compiled Graph"]

%% ✅ SAFE - colon or hyphen instead
subgraph P1["Phase 1: Compiled Graph"]
subgraph P1["Phase 1 - Compiled Graph"]
```

**Rule 4**: Place `style` directives for subgraphs **outside** the subgraph block

```text
%% ❌ FAILS in some renderers - style inside subgraph
subgraph SG["My Group"]
    style SG fill:#ddf4ff,stroke:#80ccff
    direction TB
    A --> B
end

%% ✅ WORKS everywhere - style after all subgraphs
subgraph SG["My Group"]
    direction TB
    A --> B
end
style SG fill:#ddf4ff,stroke:#80ccff
```

### classDiagram-Specific Pitfalls

**Critical**: `classDiagram` has a **different parser** than `flowchart`. Syntax that works in flowcharts often breaks in class diagrams. Never assume cross-compatibility.

#### Reserved Keyword Collisions

`classDiagram` reserves more keywords than flowcharts. Using them as `classDef` names or class annotations collides with the parser.

| Reserved Word | Why It Breaks | Safe Alternative |
| ------------- | ------------- | ---------------- |
| `abstract` | Parsed as `<<abstract>>` annotation | `abstractStyle`, `base`, `iface` |
| `interface` | Parsed as `<<interface>>` annotation | `ifaceStyle`, `contract` |
| `enumeration` | Parsed as `<<enumeration>>` annotation | `enumStyle`, `enumDef` |
| `service` | Parsed as `<<service>>` annotation | `svcStyle`, `serviceType` |

```text
%% ❌ FAILS - "abstract" is a classDiagram keyword
classDef abstract fill:#ddf4ff,stroke:#80ccff

%% ❌ ALSO FAILS - "abstract" parsed as <<abstract>> annotation
class MemorySystem abstract

%% ✅ WORKS - renamed classDef avoids collision
classDef base fill:#ddf4ff,stroke:#80ccff
class MemorySystem base
```

#### Comma-Separated Class Lists

`class A,B,C styleName` syntax works in **flowchart** but **NOT in classDiagram**. Each class needs its own `class X styleName` line.

```text
%% ❌ FAILS in classDiagram - comma syntax not supported
class UserStore,SessionStore,CacheStore storage

%% ✅ WORKS - one line per class
class UserStore storage
class SessionStore storage
class CacheStore storage
```

**Note**: In `flowchart`, `class A,B,C styleName` **is** valid (skillCatalog.ts uses this correctly).

#### classDef Property Limitations

`classDef` in classDiagram only supports **SVG presentation attributes**. CSS text properties are silently ignored.

| Works | Silently Ignored |
| ----- | ---------------- |
| `fill`, `stroke`, `stroke-width`, `color` | `font-weight`, `font-style`, `font-size` |
| `rx` (border radius) | `text-decoration`, `letter-spacing` |
| `opacity` | `padding`, `margin` |

```text
%% ❌ SILENTLY IGNORED - font-weight does nothing
classDef important fill:#fff3e0,stroke:#ef6c00,font-weight:bold

%% ✅ WORKS - use only SVG attributes
classDef important fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
```

#### stroke-dasharray Space Parsing

The space in `stroke-dasharray:6 3` breaks Mermaid's comma-delimited property parser in `classDiagram`. In `flowchart` it may work.

```text
%% ❌ FAILS in classDiagram - space in value breaks parser
classDef dashed stroke-dasharray:6 3

%% ⚠️ MAY WORK - single value, no space
classDef dashed stroke-dasharray:5

%% ✅ SAFE in flowchart - space tolerated
classDef dashed stroke-dasharray:5 5
```

**Rule**: In `classDiagram`, avoid `stroke-dasharray` entirely or use a single integer value. In `flowchart`, `stroke-dasharray:5 5` works.

#### Decimal stroke-width

Decimal values like `stroke-width:2.5px` can cause inconsistent rendering across Mermaid renderers.

```text
%% ⚠️ INCONSISTENT - decimal may not render
classDef thick stroke-width:2.5px

%% ✅ SAFE - integer values
classDef thick stroke-width:2px
classDef thicker stroke-width:3px
```

---

### architecture-beta Pitfalls

**Critical**: `architecture-beta` is an **experimental** diagram type with a much stricter tokenizer than mature types. Assume nothing works unless proven.

#### Spaces in Bracket Labels

Labels in `[...]` do **not** support spaces. Multi-word labels cause the parser to treat each word as a separate token.

```text
%% ❌ FAILS - space in bracket label
service api(server)[API Gateway]

%% ✅ WORKS - no spaces (use underscores or camelCase)
service api(server)[APIGateway]
service api(server)[Api_Gateway]
```

#### Hyphens in Labels

Hyphens like `4-3-3` are parsed as **edge connectors** (`--` or `-`), not literal characters. There is no escape mechanism.

```text
%% ❌ FAILS - hyphens parsed as edge syntax
service formation(server)[4-3-3]

%% ✅ WORKS - no hyphens
service formation(server)[Formation433]
```

#### Reserved IDs

Common programming keywords may conflict with the parser:

| Avoid | Safe Alternative |
| ----- | ---------------- |
| `var` | `varStore`, `envVar` |
| `in` | `input`, `inbound` |
| `out` | `output`, `outbound` |

#### Comments May Not Work

`%%` comments that work in all other diagram types **may cause parse errors** in `architecture-beta`.

```text
%% ❌ MAY FAIL - standard comments
%% This is my architecture
architecture-beta

%% ✅ SAFE - no comments at all
architecture-beta
```

#### Icons Only on service, Not group

`(icon)` syntax only works on `service` declarations. Using it on `group` causes a parse error.

```text
%% ❌ FAILS - group does not accept (icon)
group cloud(cloud)[Infrastructure]

%% ✅ WORKS - group has only id and [label]
group cloud[Infrastructure]

%% ✅ WORKS - service accepts (icon)
service api(server)[API]
```

**Rule**: `service id(icon)[Label]` — icon required. `group id[Label]` — no icon, no parentheses.

---

### Cross-Diagram Syntax Compatibility Matrix

This table summarizes which syntax features work in which diagram types:

| Feature | flowchart | classDiagram | architecture-beta |
| ------- | --------- | ------------ | ----------------- |
| `class A,B,C style` | ✅ | ❌ | N/A |
| `classDef` with font-weight | ❌ (ignored) | ❌ (ignored) | N/A |
| `stroke-dasharray:5 5` | ✅ | ❌ | N/A |
| Spaces in `[labels]` | ✅ | N/A | ❌ |
| Hyphens in labels | ✅ (quoted) | ✅ (quoted) | ❌ |
| `%%` comments | ✅ | ✅ | ⚠️ |
| `(icon)` on groups | N/A | N/A | ❌ |

---

### Reserved Words in Labels and Titles

**Problem**: Certain words are reserved syntax in specific diagram types. Using them as the **first word** in a task description or node label causes parse errors like `got 'callbackname'`, `got 'keyword'`, etc.

**Gantt Chart Reserved Words** (cause `callbackname` or `keyword` errors):

| Reserved | Why | Safe Alternative |
| -------- | --- | ---------------- |
| `call` | Click callback syntax | `Invoke`, `Execute`, `Generate`, `Run` |
| `click` | Click handler syntax | `Select`, `Choose`, `Trigger` |
| `after` | Dependency keyword (only at start) | Rephrase to not start with `after` |
| `done` | Task state modifier | Use as tag `:done,` not in description |
| `active` | Task state modifier | Use as tag `:active,` not in description |
| `crit` | Task state modifier | Use as tag `:crit,` not in description |

```text
%% ❌ FAILS - "Call" is reserved
Call Azure OpenAI embeddings API    :p1c, after p1b, 2d

%% ✅ WORKS - rephrase to avoid reserved word
Generate Azure OpenAI embeddings    :p1c, after p1b, 2d
```

**Flowchart Reserved Words** (cause unexpected parse behavior):

| Reserved | Why | Safe Alternative |
| -------- | --- | ---------------- |
| `end` | Subgraph terminator | Wrap in quotes: `["End"]` |
| `subgraph` | Block keyword | Wrap in quotes: `["Subgraph"]` |
| `class` | classDef application | Wrap in quotes: `["Class"]` |
| `style` | Style directive | Wrap in quotes: `["Style"]` |
| `click` | Click handler | Wrap in quotes: `["Click"]` |
| `default` | Default linkStyle target | Wrap in quotes: `["Default"]` |

```text
%% ❌ FAILS - "end" is reserved
A --> end

%% ✅ WORKS - quoted label
A --> E["End"]
```

**classDiagram Reserved Words** (cause parse errors when used as `classDef` names or class annotations):

| Reserved | Why | Safe Alternative |
| -------- | --- | ---------------- |
| `abstract` | Parsed as `<<abstract>>` stereotype | `base`, `abstractStyle`, `iface` |
| `interface` | Parsed as `<<interface>>` stereotype | `ifaceStyle`, `contract` |
| `enumeration` | Parsed as `<<enumeration>>` stereotype | `enumStyle`, `enumDef` |
| `service` | Parsed as `<<service>>` stereotype | `svcStyle`, `serviceType` |

```text
%% ❌ FAILS - "abstract" treated as keyword
classDef abstract fill:#ddf4ff,stroke:#80ccff
class MemorySystem abstract

%% ✅ WORKS - safe name
classDef base fill:#ddf4ff,stroke:#80ccff
class MemorySystem base
```

**General Safety Rule**: If a parse error occurs on a label or title, wrap it in double quotes (`"text"`) or rephrase to avoid the reserved word. When in doubt, quote it.

### XY Chart Bar Coloring (xychart-beta)

**Problem**: Individual bars all render the same color despite `plotColorPalette`

**Root Cause**: `xychart-beta` only applies different colors to **different data series** (multiple `bar` or `line` commands), not individual bars in a single series.

```text
%% ❌ FAILS - single series, all bars same color
xychart-beta
    x-axis [A, B, C]
    bar [1, 2, 3]  %% All same color!

%% ✅ WORKS - multiple series, each gets color from palette
xychart-beta
    x-axis [A, B, C]
    bar [1, 2, 3]    %% Color 1
    bar [4, 5, 6]    %% Color 2
```

**Alternative Solutions:**

1. **Pie chart** — Use `pie` with theming when showing proportions:

   ```text
   pie showData
       title "Task Distribution"
       "Task A" : 8
       "Task B" : 4
   ```

2. **Visual ASCII table** — Use markdown table with visual bars:

   ```markdown
   | Task | Value | Visual |
   | ---- | ----- | ------ |
   | A | **8** | ████████░░░░ |
   | B | **4** | ████░░░░░░░░ |
   ```

3. **Stacked bar (grouped)** — Split data into multiple series

---

### C4 Diagram Limitations

**Problem**: C4Component syntax not fully supported in standard Mermaid

**Solution**: Use flowcharts with subgraphs instead:

```text
flowchart TB
    subgraph SYSTEM["🏦 System Name"]
        A["📝 Component A"]
        B["📊 Component B"]
    end
    USER(("👤 User"))
    USER --> A
    USER --> B
```

### Blockquote Tall Boxes

**Problem**: Blockquotes render with excessive vertical padding

**Solution**: Included in `markdown-light.css`:

```css
blockquote p {
    margin: 0 !important;
    line-height: 1.5 !important;
}
```

---

