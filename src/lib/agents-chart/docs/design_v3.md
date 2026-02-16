# Agents-Chart v3: System Architecture

> Technical architecture of the `agents-chart` library — a deterministic
> compiler that transforms high-level chart specifications into Vega-Lite.
>
> For motivation, examples, and the Q&A rationale, see [story.md](story.md).
> For sizing model details, see [design-stretch-model.md](design-stretch-model.md).
> For semantic type system details, see [design-semantic-types.md](design-semantic-types.md).

---

## Design Principles

1. **VL-free analysis.** Layout computation, overflow filtering, and
   semantic resolution operate on abstract channel names (`x`, `y`,
   `color`, `group`, `size`) — never on Vega-Lite encoding objects.
   This keeps the core logic backend-agnostic.

2. **Minimal spec surface.** The input is: chart type + field assignments +
   semantic types (~7–12 lines). The compiler derives all low-level
   parameters deterministically.

3. **Templates absorb VL complexity.** Bespoke charts (lollipop, bump,
   candlestick, waterfall, etc.) are defined as template skeletons with
   an `instantiate()` hook. The user/LLM never touches layered marks,
   custom transforms, or scale configurations.

4. **No UI dependencies.** Zero React, Redux, or framework imports.
   Pure TypeScript library usable from any context.

---

## Two-Stage Pipeline

```
assembleChart(chartType, encodings, data, semanticTypes, canvasSize, options)
       │
       ▼
 ══ ANALYSIS (VL-free) ═══════════════════════════════════════
       │
       ├── Phase 0:  resolveSemantics()     → ChannelSemantics
       │     Infers encoding type, zero-baseline, color scheme,
       │     temporal format for each channel from semantic types
       │     + data characteristics.
       │
       ├── Step 0a:  template.declareLayoutMode()  → LayoutDeclaration
       │     Template hook: declares axis flags (banded?),
       │     type overrides, param overrides, overflow strategy.
       │
       ├── Step 0b:  convertTemporalData()  → converted data
       │     Parses temporal string values into Date objects.
       │
       ├── Step 0c:  filterOverflow()       → OverflowResult
       │     Truncates discrete channels that exceed the canvas
       │     budget. Produces filtered data, nominal counts,
       │     truncation warnings.
       │
       └── Phase 1:  computeLayout()        → LayoutResult
             Computes subplot width/height, step sizes, label
             sizing, facet columns/rows. Uses spring model for
             banded axes, gas-pressure model for continuous axes.
       │
       ▼
 ══ INSTANTIATE (VL-specific) ════════════════════════════════
       │
       ├── buildVLEncodings()
       │     Translates abstract channel semantics into VL
       │     encoding objects. Handles group→color+offset,
       │     size scaling, sort, color schemes.
       │
       ├── template.instantiate()
       │     Template-specific VL spec construction.
       │     (e.g., pie remaps size→theta, bar adjusts marks)
       │
       ├── restructureFacets()
       │     Restructures column/row into VL facet spec for
       │     layered charts. Computes facet columns.
       │
       ├── applyLayoutToSpec()
       │     Applies width/height/step/config/formatting from
       │     LayoutResult to the VL spec.
       │
       └── Post-layout adjustments
             Facet binning, independent y-scales, tooltips.
       │
       ▼
   Return: complete Vega-Lite spec + warnings
```

---

## Abstract Channels

The library defines its own channel vocabulary, distinct from VL encoding
channels. This decouples user/AI intent from rendering specifics.

| Channel | Purpose | VL translation |
|---------|---------|----------------|
| `x`, `y` | Positional axes | Direct mapping |
| `x2`, `y2` | Range endpoints (ranged dot, waterfall) | Direct mapping |
| `color` | Color encoding | Direct mapping |
| `group` | Grouped subdivision (e.g., grouped bar) | VL `color` + `xOffset`/`yOffset` |
| `size` | Mark size (scatter) or slice weight (pie) | Scatter: VL `size` with sqrt scale; Pie: VL `theta` |
| `shape` | Mark shape | Direct mapping |
| `opacity` | Opacity | Direct mapping |
| `column`, `row` | Faceting | VL `facet`/`column`/`row` |
| `detail` | Detail level without visual change | Direct mapping |
| `latitude`, `longitude` | Geo coordinates | Direct mapping |
| `open`, `high`, `low`, `close` | Candlestick price channels | Layered rule + rect encoding |
| `radius` | Radar chart radius | VL `radius` with sqrt scale |

### The `group` channel

First-class channel for grouped bar charts. The analysis stage resolves
its semantics (type, color scheme) without any VL knowledge. The grouping
axis is auto-detected: whichever of `x`/`y` is discrete gets subdivided.

During instantiation, `buildVLEncodings()` translates:
- `group` → VL `color` encoding (for coloring)
- `group` → VL `xOffset` or `yOffset` encoding (for position subdivision)

This avoids the old `additionalEncodings` hack and keeps the analysis
stage completely VL-free.

### The `size` channel

Abstract channel for two distinct visual mappings:
- **Scatter plot**: maps to VL `size` with adaptive `sqrt` scale range
  based on canvas area and point count.
- **Pie chart**: `pie.ts` instantiate remaps `size` → VL `theta`,
  stripping the sqrt scale (theta is linear area).

---

## Core Types

### `ChannelSemantics`

Phase 0 output for a single channel. Combines user input with resolved
decisions:

```typescript
interface ChannelSemantics {
    // From user / AI input
    field: string;
    aggregate?: string;
    sortOrder?: string;
    sortBy?: string;

    // Resolved by Phase 0
    type: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
    typeReason?: string;

    // Channel-specific decisions
    zero?: ZeroDecision;               // positional quantitative only
    colorScheme?: ColorSchemeRecommendation;  // color/group channels
    temporalFormat?: string;           // temporal fields
}
```

### `LayoutDeclaration`

Template's layout intent, returned by `declareLayoutMode()`:

```typescript
interface LayoutDeclaration {
    axisFlags?: {
        x?: { banded: boolean };
        y?: { banded: boolean };
    };
    resolvedTypes?: Record<string, 'nominal' | 'ordinal' | 'quantitative' | 'temporal'>;
    paramOverrides?: Partial<AssembleOptions>;
    binnedAxes?: Record<string, boolean | { maxbins?: number }>;
    overflowStrategy?: OverflowStrategy;
}
```

No `grouping` field — grouping is auto-detected from `channelSemantics.group`
+ which axis is discrete.

No `additionalEncodings` — the `group` channel + auto-detection replaces
the old approach entirely.

### `LayoutResult`

Phase 1 output — all layout decisions:

```typescript
interface LayoutResult {
    subplotWidth: number;
    subplotHeight: number;
    xStep: number;
    yStep: number;
    xStepUnit?: 'item' | 'group';
    yStepUnit?: 'item' | 'group';
    xContinuousAsDiscrete: number;
    yContinuousAsDiscrete: number;
    xNominalCount: number;
    yNominalCount: number;
    xLabel: LabelSizingDecision;
    yLabel: LabelSizingDecision;
    facet?: { columns: number; rows: number; subplotWidth: number; subplotHeight: number };
    truncations: TruncationWarning[];
}
```

### `InstantiateContext`

Everything a template's `instantiate()` receives:

```typescript
interface InstantiateContext {
    channelSemantics: Record<string, ChannelSemantics>;
    layout: LayoutResult;
    table: any[];
    resolvedEncodings: Record<string, any>;  // VL encoding objects
    encodings: Record<string, ChartEncoding>;
    chartProperties?: Record<string, any>;
    canvasSize: { width: number; height: number };
    semanticTypes: Record<string, string>;
    chartType: string;
}
```

### `ChartTemplateDef`

Template definition — pure data, no UI dependencies:

```typescript
interface ChartTemplateDef {
    chart: string;                           // display name
    template: any;                           // VL spec skeleton
    channels: string[];                      // available encoding channels
    markCognitiveChannel: MarkCognitiveChannel;  // 'position' | 'length' | 'area' | 'color'

    declareLayoutMode?: (cs, data, props) => LayoutDeclaration;
    instantiate: (spec, context: InstantiateContext) => void;
    properties?: ChartPropertyDef[];
}
```

### `OverflowStrategy`

Customizable per-template. The default strategy in `filter-overflow.ts` handles:
connected marks (keep all for continuity), user sorts, auto-sorts,
bar sum-aggregate, numeric sort, first-N.

```typescript
type OverflowStrategy = (
    channel: string,
    fieldName: string,
    uniqueValues: any[],
    maxToKeep: number,
    context: OverflowStrategyContext,
) => any[];
```

---

## File Map

| File | Lines | Role |
|------|-------|------|
| `assemble.ts` | 625 | Two-stage pipeline coordinator |
| `types.ts` | 460 | All type definitions |
| `resolve-semantics.ts` | 406 | Phase 0: semantic resolution + temporal conversion |
| `filter-overflow.ts` | 300 | Phase 0c: VL-free overflow filtering |
| `compute-layout.ts` | 484 | Phase 1: VL-free layout computation |
| `instantiate-spec.ts` | 353 | Phase 2: `applyLayoutToSpec`, `applyTooltips` |
| `decisions.ts` | 542 | Reusable decision functions (elastic budget, step, facet, label, gas pressure) |
| `semantic-types.ts` | 1052 | Semantic type system (hierarchy, zero decisions, color schemes) |
| `index.ts` | 104 | Public API exports |
| `templates/index.ts` | 61 | Template registry |
| `templates/bar.ts` | 309 | Bar, grouped bar, stacked bar, histogram, heatmap, pyramid |
| `templates/scatter.ts` | 123 | Scatter, linear regression, ranged dot, boxplot |
| `templates/line.ts` | 54 | Line, dotted line |
| `templates/area.ts` | 86 | Area, streamgraph |
| `templates/pie.ts` | 41 | Pie (size→theta remap) |
| `templates/bump.ts` | 66 | Bump chart |
| `templates/lollipop.ts` | 75 | Lollipop chart |
| `templates/candlestick.ts` | 82 | Candlestick |
| `templates/waterfall.ts` | 126 | Waterfall |
| `templates/radar.ts` | 377 | Radar chart |
| `templates/density.ts` | 39 | Density plot |
| `templates/jitter.ts` | 121 | Strip / jitter plot |
| `templates/map.ts` | 146 | US map, world map |
| `templates/custom.ts` | 45 | Custom point/line/bar/rect/area |
| `templates/utils.ts` | 348 | Shared template utilities |

**Total: ~6,425 lines** across 25 files.

---

## Sizing Models

### Spring Model (Discrete Axes)

Applies to banded marks (bar, histogram, heatmap, boxplot, grouped bar).
Models the axis as $N$ springs in a box:

$$\ell = \frac{\kappa \cdot \ell_0 + L_0 / N}{1 + \kappa}$$

Three regimes: **Fits** (items at natural size), **Elastic** (items
compress + axis stretches), **Overflow** (items at minimum, excess
truncated).

→ Full details: [design-stretch-model.md §1](design-stretch-model.md)

### Gas-Pressure Model (Continuous Axes)

Applies to positional marks (scatter, line, area, bump). Each axis
stretches based on 1D crowding pressure:

$$s = \min\!\big(1 + \beta_c,\; p^{\,\alpha_c}\big)$$

Two pressure modes: **positional** (unique pixel positions × √σ / dim)
and **series-count** (nSeries × σ / dim for line/area Y axes).

→ Full details: [design-stretch-model.md §2](design-stretch-model.md)

### Facet Model

Second-level stretch for faceted charts. Each subplot runs its own sizing
model internally; the facet layer determines subplot count, columns, and
overall canvas growth.

→ Full details: [design-stretch-model.md §3](design-stretch-model.md)

---

## Semantic Type System

Semantic types classify fields by what they *mean* (not just their data
type), organized in a hierarchy:

```
             AnyType
          ┌────┼────────┐
       Temporal  Numeric  Categorical
       ┌──┴──┐  ┌──┴──┐  ┌──┴──┐
     Point Granule Measure Discrete Entity Coded
```

Each type drives:
- **Encoding type** (Revenue → quantitative, Rank → ordinal, Month → ordinal)
- **Zero baseline** (Revenue → include zero, Temperature → don't)
- **Domain padding** (Rank → 8%, Temperature → 5%)
- **Color scheme** (categorical, sequential, or diverging)
- **Axis formatting** (Revenue → `$,.0f`, Percentage → `.0%`)

→ Full details: [design-semantic-types.md](design-semantic-types.md)

---

## Template Catalog

| Category | Charts |
|----------|--------|
| **Scatter & Point** | Scatter Plot, Linear Regression, Boxplot, Strip Plot |
| **Bar** | Bar Chart, Grouped Bar, Stacked Bar, Histogram, Lollipop, Pyramid |
| **Line & Area** | Line Chart, Dotted Line, Bump Chart, Area Chart, Streamgraph |
| **Part-to-Whole** | Pie Chart, Heatmap, Waterfall |
| **Statistical** | Density Plot, Ranged Dot Plot, Radar Chart, Candlestick |
| **Map** | US Map, World Map |
| **Custom** | Custom Point, Custom Line, Custom Bar, Custom Rect, Custom Area |

**30 chart types** across 7 categories.

Each template defines:
1. **`template`** — VL spec skeleton (mark + encoding structure)
2. **`channels`** — available encoding channels
3. **`markCognitiveChannel`** — how the mark encodes value (`position`, `length`, `area`, `color`)
4. **`declareLayoutMode()`** — optional hook for layout intent
5. **`instantiate()`** — build final VL spec from resolved context

---

## Public API

```typescript
import { assembleChart } from './lib/agents-chart';

const spec = assembleChart(
    'Scatter Plot',
    { x: { field: 'weight' }, y: { field: 'mpg' }, color: { field: 'origin' } },
    myData,
    { weight: 'Quantity', mpg: 'Quantity', origin: 'Country' },
    { width: 400, height: 300 },
);
```

**Input:**
- `chartType` — template name (e.g., `"Grouped Bar Chart"`)
- `encodings` — channel → `ChartEncoding` (field, aggregate, sort, scheme)
- `data` — array of row objects
- `semanticTypes` — field name → semantic type string (e.g., `"Revenue"`, `"Year"`)
- `canvasSize` — `{ width, height }` in pixels
- `options` — `AssembleOptions` (layout tuning, all have defaults)

**Output:** Complete Vega-Lite spec with `data.values`, ready to render.
May include `_warnings: ChartWarning[]` for overflow/truncation diagnostics.

---

## Overflow & Warning System

When discrete channels overflow the canvas budget, the library:

1. Computes the max items that fit (from spring model equilibrium)
2. Applies the overflow strategy (default or template-custom) to choose
   which values to keep
3. Filters the data to only kept values
4. Emits `TruncationWarning` with: channel, field, kept values, omitted
   count, placeholder string
5. Emits `ChartWarning` for the UI

The default overflow strategy priority:
1. Connected marks (line, area) → keep all (truncation breaks continuity)
2. User-specified sort → keep top/bottom N by sort order
3. Quantitative opposite axis → sort by opposite, keep top N
4. Bar with count aggregate → sum-aggregate and keep top N
5. Numeric field → numeric sort, keep first N
6. Fallback → keep first N in data order

---

## Architectural Boundaries

```
┌─────────────────────────────────────────────────┐
│              ANALYSIS (VL-free)                  │
│                                                  │
│  resolveSemantics  →  ChannelSemantics           │
│  declareLayoutMode →  LayoutDeclaration          │
│  convertTemporalData                             │
│  filterOverflow    →  OverflowResult             │
│  computeLayout     →  LayoutResult               │
│                                                  │
│  Inputs:  abstract channels, data, semantic types│
│  Outputs: types, decisions, layout numbers       │
│  Imports: NO vega-lite, NO VL encoding syntax    │
├─────────────────────────────────────────────────┤
│              INSTANTIATE (VL-specific)           │
│                                                  │
│  buildVLEncodings  →  VL encoding objects        │
│  template.instantiate → VL spec                  │
│  restructureFacets → VL facet structure          │
│  applyLayoutToSpec → VL config/sizing            │
│                                                  │
│  Inputs:  ChannelSemantics + LayoutResult + data │
│  Outputs: complete Vega-Lite spec                │
│  This is the ONLY code that constructs VL syntax │
└─────────────────────────────────────────────────┘
```

The boundary is enforced by function signatures: analysis-stage functions
accept `ChannelSemantics` and `LayoutDeclaration` — never VL encoding
objects or spec structures. This makes it possible to retarget the
analysis stage to non-VL backends (ECharts, Plotly, etc.) without
changing any analysis code.
