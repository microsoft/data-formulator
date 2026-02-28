# Agents-Chart v3: System Architecture

> Technical architecture of the `agents-chart` library — a deterministic
> compiler that transforms high-level chart specifications into backend-
> specific rendering specs (Vega-Lite, ECharts, Chart.js, GoFish).
>
> For motivation, examples, and the Q&A rationale, see [story-v2.md](story-v2.md).
> For sizing model details, see [design-stretch-model.md](design-stretch-model.md).
> For semantic type system details, see [design-semantics-new.md](design-semantics-new.md).

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

Each backend has its own `assemble*()` entry point (`assembleVegaLite`,
`assembleECharts`, `assembleChartjs`, `assembleGoFish`), but they all
follow the same two-stage structure. The analysis stage is shared;
only the instantiation stage is backend-specific.

```
assembleVegaLite(input: ChartAssemblyInput)   // or assembleECharts, assembleChartjs, assembleGoFish
       │
       ▼
 ══ ANALYSIS (backend-free, shared core) ═════════════════════
       │
       ├── Phase 0:  resolveSemantics()     → ChannelSemantics
       │     Infers encoding type, zero-baseline, color scheme,
       │     format, aggregation default, scale type, domain,
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
 ══ INSTANTIATE (backend-specific) ═══════════════════════════
       │
       ├── build*Encodings()                        (per backend)
       │     Translates abstract channel semantics into
       │     backend encoding objects.
       │
       ├── template.instantiate()
       │     Template-specific spec construction.
       │     (e.g., pie remaps size→theta, bar adjusts marks)
       │
       ├── restructureFacets()                      (VL/ECharts)
       │     Restructures column/row into facet spec for
       │     layered charts. Computes facet columns.
       │
       ├── applyLayoutToSpec()
       │     Applies width/height/step/config/formatting from
       │     LayoutResult to the backend spec.
       │
       └── Post-layout adjustments
             Facet binning, independent y-scales, tooltips.
       │
       ▼
   Return: complete backend spec + warnings
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
decisions. This is the central IR — all four backends read the same
`ChannelSemantics` record.

```typescript
interface ChannelSemantics {
    // --- Identity ---
    field: string;
    semanticAnnotation: SemanticAnnotation;

    // --- Encoding type ---
    type: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';

    // --- Formatting ---
    format?: FormatSpec;
    tooltipFormat?: FormatSpec;
    temporalFormat?: string;

    // --- Aggregation ---
    aggregationDefault?: 'sum' | 'average';

    // --- Scale ---
    zero?: ZeroDecision;
    scaleType?: 'linear' | 'log' | 'sqrt' | 'symlog';
    nice?: boolean;
    domainConstraint?: DomainConstraint;
    tickConstraint?: TickConstraint;

    // --- Ordering ---
    ordinalSortOrder?: string[];
    cyclic?: boolean;
    reversed?: boolean;
    sortDirection?: 'ascending' | 'descending';

    // --- Color ---
    colorScheme?: ColorSchemeRecommendation;

    // --- Histogram ---
    binningSuggested?: boolean;

    // --- Stacking ---
    stackable?: 'sum' | 'normalize' | false;
}
```

21 fields total (2 required: `field`, `type`; plus `semanticAnnotation`).

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

### Core (shared across all backends)

| File | Lines | Role |
|------|-------|------|
| `core/types.ts` | 686 | All type definitions (ChannelSemantics, ChartAssemblyInput, etc.) |
| `core/field-semantics.ts` | 978 | Field semantic resolution (T0/T1/T2 tiered logic) |
| `core/semantic-types.ts` | 921 | Semantic type system (hierarchy, zero decisions, color schemes) |
| `core/type-registry.ts` | 197 | Type registry (46 types, 6 T0 families) |
| `core/resolve-semantics.ts` | 476 | Phase 0: channel semantic resolution + temporal conversion |
| `core/compute-layout.ts` | 907 | Phase 1: backend-free layout computation |
| `core/decisions.ts` | 724 | Reusable decision functions (elastic budget, step, facet, label, gas pressure) |
| `core/filter-overflow.ts` | 296 | Phase 0c: backend-free overflow filtering |
| `core/recommendation.ts` | 1178 | Chart recommendation engine |
| `core/index.ts` | 120 | Core re-exports |

### Vega-Lite backend

| File | Lines | Role |
|------|-------|------|
| `vegalite/assemble.ts` | 751 | VL two-stage pipeline coordinator |
| `vegalite/instantiate-spec.ts` | 614 | `applyLayoutToSpec`, `applyTooltips` |
| `vegalite/recommendation.ts` | 201 | VL-specific recommendation |
| `vegalite/templates/*.ts` | ~2,300 | 17 template files (28 chart types) |

### ECharts backend

| File | Lines | Role |
|------|-------|------|
| `echarts/assemble.ts` | 710 | ECharts two-stage pipeline coordinator |
| `echarts/instantiate-spec.ts` | 660 | ECharts spec instantiation |
| `echarts/facet.ts` | 251 | ECharts facet support |
| `echarts/recommendation.ts` | 101 | ECharts-specific recommendation |
| `echarts/templates/*.ts` | ~3,900 | 24 template files (26 chart types) |

### Chart.js backend

| File | Lines | Role |
|------|-------|------|
| `chartjs/assemble.ts` | 213 | Chart.js two-stage pipeline coordinator |
| `chartjs/instantiate-spec.ts` | 158 | Chart.js spec instantiation |
| `chartjs/recommendation.ts` | 34 | Chart.js recommendation |
| `chartjs/templates/*.ts` | ~1,400 | 10 template files (10 chart types) |

### GoFish backend

| File | Lines | Role |
|------|-------|------|
| `gofish/assemble.ts` | 521 | GoFish imperative rendering pipeline |
| `gofish/recommendation.ts` | 34 | GoFish recommendation |
| `gofish/templates/*.ts` | ~850 | 8 template files (8 chart types) |

### Top-level

| File | Lines | Role |
|------|-------|------|
| `index.ts` | 60 | Public API re-exports (all 4 backends) |

**Total: ~20,358 lines** across 87 `.ts` files (excluding test-data).

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
type), organized in a three-tier hierarchy (T0 → T1 → T2):

```
T0 Family        T1 Category           T2 Types (examples)
─────────        ───────────           ──────────────────
Temporal ────┬── DateTime ──────────── DateTime, Date, Time, Timestamp
             ├── DateGranule ────────── Year, Quarter, Month, Week, Day, Hour, ...
             └── Duration ──────────── Duration

Measure ─────┬── Amount ────────────── Amount, Price, Revenue, Cost
             ├── Physical ──────────── Quantity, Temperature
             ├── Proportion ────────── Percentage
             ├── SignedMeasure ──────── Profit, PercentageChange, Sentiment, Correlation
             └── GenericMeasure ────── Count, Number

Discrete ────┬── Rank ──────────────── Rank
             ├── Score ─────────────── Score, Rating
             └── Index ─────────────── Index

Geographic ──┬── GeoCoordinate ─────── Latitude, Longitude
             └── GeoPlace ──────────── Country, State, City, Region, ZipCode, Address

Categorical ─┬── Entity ────────────── PersonName, Company, Product, Category, Name, ...
             ├── Coded ─────────────── Status, Type, Boolean, Direction
             └── Binned ────────────── Range, AgeGroup

Identifier ──┴── ID ────────────────── ID
```

**46 registered types** across 6 T0 families and 17 T1 categories.

Each type entry in the registry carries orthogonal dimensions that drive
visualization decisions:
- **visEncodings** — encoding type candidates (quantitative, ordinal, nominal, temporal)
- **aggRole** — aggregation role (`additive`, `intensive`, `signed-additive`, `dimension`, `identifier`)
- **domainShape** — domain shape (`open`, `bounded`, `fixed`, `cyclic`)
- **diverging** — diverging nature (`none`, `conditional`, `inherent`)
- **formatClass** — format class (`currency`, `percent`, `unit-suffix`, `date`, `integer`, `plain`, ...)
- **zeroBaseline** — zero baseline policy (`meaningful`, `arbitrary`, `contextual`, `none`)
- **zeroPad** — domain padding fraction

→ Full details: [design-semantics-new.md](design-semantics-new.md)

---

## Template Catalog

### Vega-Lite (28 chart types)

| Category | Charts |
|----------|--------|
| **Scatter & Point** | Scatter Plot, Linear Regression, Boxplot, Strip Plot |
| **Bar** | Bar Chart, Grouped Bar Chart, Stacked Bar Chart, Histogram, Lollipop Chart, Pyramid Chart |
| **Line & Area** | Line Chart, Dotted Line Chart, Bump Chart, Area Chart, Streamgraph |
| **Part-to-Whole** | Pie Chart, Rose Chart, Heatmap, Waterfall Chart |
| **Statistical** | Density Plot, Ranged Dot Plot, Radar Chart, Candlestick Chart |
| **Map** | US Map, World Map |
| **Custom** | Custom Point, Custom Line, Custom Bar, Custom Rect, Custom Area |

### ECharts (26 chart types)

| Category | Charts |
|----------|--------|
| **Scatter & Point** | Scatter Plot, Linear Regression, Ranged Dot Plot, Boxplot, Strip Plot |
| **Bar** | Bar Chart, Grouped Bar Chart, Stacked Bar Chart, Histogram, Lollipop Chart, Pyramid Chart, Heatmap |
| **Line & Area** | Line Chart, Dotted Line Chart, Bump Chart, Area Chart, Streamgraph |
| **Part-to-Whole** | Pie Chart, Funnel Chart, Treemap, Sunburst |
| **Polar** | Radar Chart, Rose Chart |
| **Financial** | Candlestick Chart |
| **Indicator** | Gauge Chart |
| **Flow** | Sankey |
| **Other** | Waterfall Chart, Density Plot |

### Chart.js (10 chart types)

| Category | Charts |
|----------|--------|
| **Scatter & Point** | Scatter Plot |
| **Bar** | Bar Chart, Grouped Bar Chart, Stacked Bar Chart, Histogram |
| **Line & Area** | Line Chart, Area Chart |
| **Part-to-Whole** | Pie Chart |
| **Polar** | Radar Chart, Rose Chart |

### GoFish (8 chart types)

| Category | Charts |
|----------|--------|
| **Scatter & Point** | Scatter Plot |
| **Bar** | Bar Chart, Grouped Bar Chart, Stacked Bar Chart |
| **Line & Area** | Line Chart, Area Chart |
| **Part-to-Whole** | Pie Chart, Scatter Pie Chart |

**72 template definitions** across 4 backends.

Each template defines:
1. **`template`** — spec skeleton (mark + encoding structure)
2. **`channels`** — available encoding channels
3. **`markCognitiveChannel`** — how the mark encodes value (`position`, `length`, `area`, `color`)
4. **`declareLayoutMode()`** — optional hook for layout intent
5. **`instantiate()`** — build final backend spec from resolved context

---

## Public API

All four backends share the same input type (`ChartAssemblyInput`)
and follow the same calling convention:

```typescript
import { assembleVegaLite, assembleECharts, assembleChartjs, assembleGoFish } from './lib/agents-chart';

const input: ChartAssemblyInput = {
    chartType: 'Scatter Plot',
    encodings: { x: { field: 'weight' }, y: { field: 'mpg' }, color: { field: 'origin' } },
    table: myData,
    semanticTypes: { weight: 'Quantity', mpg: 'Quantity', origin: 'Country' },
    canvasSize: { width: 400, height: 300 },
};

const vlSpec   = assembleVegaLite(input);  // → Vega-Lite JSON spec
const ecSpec   = assembleECharts(input);   // → ECharts option object
const cjsSpec  = assembleChartjs(input);   // → Chart.js config object
const gfSpec   = assembleGoFish(input);    // → GoFish imperative spec
```

**`ChartAssemblyInput` fields:**
- `chartType` — template name (e.g., `"Grouped Bar Chart"`)
- `encodings` — channel → `ChartEncoding` (field, aggregate, sort, scheme)
- `table` — array of row objects
- `semanticTypes` — field name → semantic type string (e.g., `"Revenue"`, `"Year"`)
- `canvasSize` — `{ width, height }` in pixels
- `options` — `AssembleOptions` (layout tuning, all have defaults)

**Output:** Complete backend-specific spec, ready to render.
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
│              ANALYSIS (core/ — backend-free)     │
│                                                  │
│  resolveSemantics  →  ChannelSemantics           │
│  declareLayoutMode →  LayoutDeclaration          │
│  convertTemporalData                             │
│  filterOverflow    →  OverflowResult             │
│  computeLayout     →  LayoutResult               │
│                                                  │
│  Inputs:  abstract channels, data, semantic types│
│  Outputs: types, decisions, layout numbers       │
│  Imports: NO backend-specific syntax             │
├─────────────────────────────────────────────────┤
│   INSTANTIATE (vegalite/ | echarts/ | chartjs/ | gofish/)  │
│                                                  │
│  Each backend has its own:                       │
│    build*Encodings  →  backend encoding objects   │
│    template.instantiate → backend spec            │
│    restructureFacets → backend facet structure    │
│    applyLayoutToSpec → backend config/sizing      │
│                                                  │
│  Inputs:  ChannelSemantics + LayoutResult + data │
│  Outputs: complete backend-specific spec         │
│  Backend code ONLY constructs its own syntax     │
└─────────────────────────────────────────────────┘
```

The boundary is enforced by function signatures: analysis-stage functions
accept `ChannelSemantics` and `LayoutDeclaration` — never backend encoding
objects or spec structures. All four backends (Vega-Lite, ECharts,
Chart.js, GoFish) share the same analysis stage and read the same
`ChannelSemantics` IR. Adding a new backend only requires implementing
the instantiation layer — no analysis code changes.
