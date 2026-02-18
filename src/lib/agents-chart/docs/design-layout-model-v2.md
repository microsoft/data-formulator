# Design: Chart Assembly Pipeline v2

> Refactored architecture for the agents-chart assembler. Separates
> **semantic resolution**, **layout computation**, and **spec instantiation**
> into three clean phases with no circular dependencies. The layout engine
> becomes fully library-agnostic — it reasons about data density and visual
> space, not about Vega-Lite.

---

## Motivation

The current `assembleChart()` in [assemble.ts](../assemble.ts) interleaves
three concerns in a single 1400-line function:

1. **Semantic resolution** — Resolving encoding types (Q/N/O/T) from
   semantic types, computing zero-baseline decisions, choosing color
   schemes, formatting temporal axes.
2. **Layout computation** — Computing axis sizes, step sizes, subplot
   dimensions, label sizing, and overflow truncation from data density.
3. **Spec instantiation** — Building the final Vega-Lite spec: writing
   `config.view`, `width: {step: N}`, `scale.domain`, mark properties.

The core layout math (in [decisions.ts](../decisions.ts)) is already
VL-agnostic — pure geometry and arithmetic. But the orchestration code
reads VL encoding objects to extract inputs and writes VL spec properties
to apply outputs, creating unnecessary coupling.

**Goal:** Factor the pipeline into three phases with explicit, typed
interfaces between them. Any phase can be replaced independently —
e.g., swap the VL instantiation for an Observable Plot backend without
touching layout or semantics.

---

## Pipeline Overview

```
Inputs (all VL-agnostic):
  - chartTemplate: ChartTemplateDef
  - encodings: Record<string, ChartEncoding>
  - table: any[]
  - semanticTypes: Record<string, string>
  - chartProperties: Record<string, any>
  - canvasSize: { width: number; height: number }


  Phase 0                    Phase 1                    Phase 2
  ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
  │ resolveSemantics │──────▶│  computeLayout   │──────▶│   instantiate    │
  │                  │       │                  │       │                  │
  │ Semantic types + │       │ Data density +   │       │ Semantic info +  │
  │ data + channels  │       │ axis flags +     │       │ layout result +  │
  │                  │       │ template params  │       │ chart properties │
  │ → channelSemantics │       │ → LayoutResult   │       │ → VL spec (or    │
  │   (types, zero,  │       │   (steps, dims,  │       │   any other      │
  │    color, format) │       │    labels, trunc)│       │   output format) │
  └──────────────────┘       └──────────────────┘       └──────────────────┘
       VL-agnostic                VL-agnostic              VL-specific
```

Each phase has a single responsibility, typed input/output interfaces,
and zero knowledge of the phases it doesn't touch. The template
participates in all three phases through dedicated hooks.

---

## Phase 0: Resolve Semantics

### Responsibility

Derive all **data-meaning-dependent decisions** from semantic types,
data values, channel assignments, and mark type. These decisions are
abstract — they describe *what* should happen, not *how* to express it
in any particular charting library.

### Inputs

| Input | Type | Source |
|-------|------|--------|
| `encodings` | `Record<string, ChartEncoding>` | User / AI agent |
| `semanticTypes` | `Record<string, string>` | User / AI agent (e.g., `{ "GDP": "Revenue", "Country": "Country" }`) |
| `table` | `any[]` | Data rows |
| `markCognitiveChannel` | `MarkCognitiveChannel` | From `chartTemplate.markCognitiveChannel` — how the primary mark encodes its quantitative value |
| `channel` | per-encoding | Which visual channel (x, y, color, size, ...) |

### Output: `ChannelSemantics`

Phase 0 produces a single map keyed by **channel name** (`x`, `y`,
`color`, `size`, `row`, `column`, etc.). Each entry carries everything
downstream phases need about that channel — the bound field, its
resolved type, and all semantic decisions made in that channel context.

```typescript
/**
 * Phase 0 output: one entry per channel.
 * E.g., { x: { field: 'Year', ... }, y: { field: 'Revenue', ... }, color: { field: 'Category', ... } }
 */
type SemanticResult = Record<string, ChannelSemantics>;

/**
 * Everything Phase 0 decides for a single channel.
 *
 * Combines the original ChartEncoding (user intent) with resolved
 * decisions (type, zero-baseline, color scheme, temporal format).
 * All downstream phases read this — no separate maps needed.
 */
interface ChannelSemantics {
    // --- From ChartEncoding (user / AI input) ---
    /** Field name bound to this channel */
    field: string;
    /** User-specified aggregate (e.g., 'sum', 'mean', 'count') */
    aggregate?: string;
    /** Sort order for discrete axes ('ascending', 'descending') */
    sortOrder?: string;
    /** Field to sort by (if different from the encoded field) */
    sortBy?: string;

    // --- Resolved by Phase 0 ---
    /**
     * Final encoding type for this channel.
     * Resolved from semantic type + data characteristics + channel rules.
     * E.g., "Year" on x → 'temporal'; "Revenue" on y → 'quantitative'.
     */
    type: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
    /** Human-readable reason for the type decision (for debugging) */
    typeReason?: string;

    // --- Channel-specific semantic decisions ---
    /**
     * Zero-baseline decision (positional quantitative channels only).
     * Determines whether the axis should include zero and how much
     * domain padding to apply when zero is excluded.
     * Present only on 'x' and 'y' channels with type 'quantitative'.
     */
    zero?: ZeroDecision;

    /**
     * Color scheme recommendation (color channel only).
     * Includes scheme name, diverging/sequential/categorical classification,
     * and optional domainMid for diverging schemes.
     */
    colorScheme?: ColorSchemeDecision;

    /**
     * Temporal format string (temporal fields on any channel).
     * E.g., "%Y", "%b %d", "%H:%M".
     * Present only when type is 'temporal' or field is ordinal-temporal.
     */
    temporalFormat?: string;
}
```

**Why per-channel, not per-field?** The same field can appear on
multiple channels (e.g., "Year" on both x and color), and the semantic
decisions may differ by channel context. Zero-baseline is inherently
channel-specific (same field on x vs y can differ). Type resolution
also depends on channel (column/row forces nominal). Keying by channel
makes each entry self-contained — one lookup gives you everything.

### What drives each decision

```
semanticTypes[field]
    │
    ├── resolveEncodingTypeFull(semType, fieldValues, channel, data, field)
    │     → EncodingTypeDecision { vlType, reason }
    │     E.g., "Year" → temporal; "CategoryCode" → nominal;
    │           "Revenue" → quantitative
    │
    ├── computeZeroDecision(semType, channel, markCognitiveChannel, numericValues)
    │     → ZeroDecision { zero: boolean, domainPadFraction: number }
    │     E.g., "Revenue" → zero:true; "Temperature" → zero:false, pad:0.05
    │
    ├── getRecommendedColorScheme(semType, vlType, fieldValues, fieldName)
    │     → ColorSchemeDecision { scheme, type, domainMid? }
    │     E.g., "Temperature Anomaly" → diverging, domainMid:0
    │
    └── analyzeTemporalField(fieldValues) + pickBestLevel(votes)
          → format string
          E.g., hourly data → "%m/%d %H:%M"; yearly → "%Y"
```

### VL dependency: **None**

All decision functions read `ChartEncoding` fields (`.field`, `.type`,
`.aggregate`, `.sortOrder`, `.sortBy`) and raw `semanticTypes` strings.
The resolved encoding type (`vlType`) uses the same four-value enum
(`"quantitative" | "nominal" | "ordinal" | "temporal"`) but this is a
semantic classification concept, not a VL-specific one — any charting
library needs to distinguish these four data roles.

---

## Phase 1: Compute Layout

### Responsibility

Determine **how big things should be** — axis lengths, step sizes,
subplot dimensions, label sizing, and overflow truncation — from data
density, axis classification, and template-provided tuning knobs.

### Sub-step 1a: Declare Layout Mode (template hook)

Before running the layout math, each template declares its **layout
intent** — which axes are banded, what cross-sections to use, how stiff
the springs are. This is the template's only pre-layout participation.

```typescript
interface LayoutDeclaration {
    /**
     * Which axes allocate fixed bands per data position.
     * Banded axes use the spring model (§1); non-banded use gas pressure (§2).
     */
    axisFlags?: {
        x?: { banded: boolean };
        y?: { banded: boolean };
    };

    /**
     * Resolved encoding types after any template-driven type conversion.
     * E.g., detectBandedAxis may convert Q→O for a bar chart axis.
     * These override the Phase 0 decisions for layout purposes.
     */
    resolvedTypes?: Record<string, 'nominal' | 'ordinal' | 'quantitative' | 'temporal'>;

    /**
     * Template-specific overrides to layout parameters.
     * E.g., line chart sets continuousMarkCrossSection: { x:100, y:20, seriesCountAxis:'auto' }
     */
    paramOverrides?: Partial<AssembleOptions>;
}
```

**Per-template declarations** (current behavior, moved to a dedicated hook):

| Template | axisFlags | paramOverrides |
|----------|-----------|----------------|
| Bar | `{ [bandedAxis]: { banded: true } }` | — |
| Grouped Bar | `{ [bandedAxis]: { banded: true } }` | — |
| Stacked Bar | `{ [bandedAxis]: { banded: true } }` | `{ continuousMarkCrossSection: { x:20, y:20, seriesCountAxis:'auto' } }` |
| Histogram | — (bins are detected automatically) | — |
| Heatmap | `{ x: { banded: true }, y: { banded: true } }` | — |
| Boxplot | `{ [bandedAxis]: { banded: true } }` | — |
| Lollipop | — | — |
| Candlestick | `{ x: { banded: true } }` | — |
| Waterfall | `{ x: { banded: true } }` | — |
| Line | — | `{ continuousMarkCrossSection: { x:100, y:20, seriesCountAxis:'auto' } }` |
| Dotted Line | — | `{ continuousMarkCrossSection: { x:100, y:20, seriesCountAxis:'auto' } }` |
| Area | — | `{ continuousMarkCrossSection: { x:100, y:20, seriesCountAxis:'auto' } }` |
| Streamgraph | — | `{ continuousMarkCrossSection: { x:100, y:20, seriesCountAxis:'auto' } }` |
| Bump | — | `{ continuousMarkCrossSection: { x:80, y:20, seriesCountAxis:'auto' } }` |
| Strip / Jitter | — | `{ defaultStepMultiplier: 2, minStep: 16 }` |
| Scatter | — | — |

Note: templates that call `detectBandedAxis()` need access to the
resolved encodings and data table to decide which axis is banded.
This semantic decision (which axis has categorical data?) runs inside
`declareLayoutMode()` using the `channelSemantics` from Phase 0.

### Sub-step 1b: Classify Axes

Using the resolved encoding types (from Phase 0, possibly overridden by
the template in 1a) and the axis flags, classify each positional axis:

```
For each positional axis (x, y):

1. Is the resolved type nominal or ordinal?
   → Banded (discrete). Spring model.

2. Is the axis binned (chartProperties.binCount or enc bin flag)?
   → Banded (continuous). Spring model with bin count as N.

3. Does the template declare this axis as banded (axisFlags.banded)?
   → Banded (continuous). Spring model with field cardinality as N.

4. Otherwise:
   → Non-banded (continuous). Gas pressure model.
```

### Sub-step 1c: Extract Layout Inputs

Gather the abstract data properties needed by the layout math.
All inputs come from `ChannelSemantics` + `table` — no VL objects.

```typescript
interface AxisLayoutInput {
    /** Spring model (banded) or gas pressure (non-banded) */
    mode: 'banded' | 'non-banded';

    /**
     * For banded axes: number of discrete positions.
     * Source: |unique(table[field])| for nominal/ordinal,
     *         binCount for binned, cardinality for continuous-as-banded.
     */
    itemCount: number;

    /**
     * For grouped marks: number of sub-items per group.
     * E.g., a grouped bar with 3 colored sub-bars has subItemsPerGroup = 3.
     * The group is the unit of compression, not the sub-item.
     */
    subItemsPerGroup?: number;

    /**
     * For gas pressure: raw numeric values along this axis.
     * Temporal values are converted to epoch ms.
     */
    values?: number[];

    /** Data extent [min, max] for gas pressure domain. */
    domain?: [number, number];

    /**
     * For series-count-based pressure: number of distinct series.
     * Source: |unique(table[colorField]) ∪ unique(table[detailField])|
     */
    seriesCount?: number;
}

interface LayoutRequest {
    x: AxisLayoutInput;
    y: AxisLayoutInput;
    facet?: {
        columns: number;
        rows: number;
    };
    canvas: { width: number; height: number };

    /** Merged layout parameters (defaults + template overrides) */
    params: LayoutParams;
}
```

### Sub-step 1d: Run Layout Math

The core computation. All functions already live in
[decisions.ts](../decisions.ts) and are VL-agnostic:

| Function | Model | Input | Output |
|----------|-------|-------|--------|
| `computeElasticBudget()` | Spring (§1) | itemCount, baseDim, params | budget, stretchFactor |
| `computeAxisStep()` | Spring (§1) | nominalCount, continuousCount, baseDim, params | step, budget |
| `computeGasPressure()` | Gas (§2) | xValues, yValues, domains, dims, params | stretchX, stretchY |
| `computeCircumferencePressure()` | Circumference (§3) | effectiveCount, canvas, params | radius, canvasW, canvasH |
| `computeEffectiveBarCount()` | Shared (§3/§4) | values[] | effectiveCount (variable-width → uniform equiv) |
| `computeFacetLayout()` | Facet | facetCols, facetRows, dims, params | subplotWidth, subplotHeight |
| `computeLabelSizing()` | Labels | effectiveStep, hasDiscreteItems | fontSize, labelAngle, labelLimit |
| `computeOverflow()` | Truncation | itemCount, maxItems | kept, truncated, warnings |

### Output: `LayoutResult`

```typescript
interface LayoutResult {
    /** Final subplot width in px (after stretch) */
    subplotWidth: number;
    /** Final subplot height in px (after stretch) */
    subplotHeight: number;

    /** Computed step size for X axis (px per discrete position) */
    xStep: number;
    /** Computed step size for Y axis (px per discrete position) */
    yStep: number;

    /** Whether the step size is per-item or per-group.
     *  'item' (default): step = width of one discrete position.
     *  'group': step = width of the entire group (for grouped bars, etc.).
     */
    xStepUnit?: 'item' | 'group';
    yStepUnit?: 'item' | 'group';

    /** Number of banded continuous items on each axis (0 if not banded-continuous) */
    xContinuousAsDiscrete: number;
    yContinuousAsDiscrete: number;

    /** Number of nominal/ordinal items on each axis */
    xNominalCount: number;
    yNominalCount: number;

    /** Label sizing decisions per axis.
     *  Adapts text rendering to the available step size so labels
     *  remain legible under compression. */
    xLabel: LabelSizingDecision;
    yLabel: LabelSizingDecision;

    /** Facet layout (if applicable) */
    facet?: {
        columns: number;
        rows: number;
        subplotWidth: number;
        subplotHeight: number;
    };

    /** Items truncated due to overflow.
     *  When an axis overflows, the domain is capped to the top-N values
     *  and a placeholder entry (e.g., "...38 items omitted") is appended.
     *  Phase 2 must:
     *    1. Filter the data table to keep only the retained values.
     *    2. Append the placeholder string to the scale domain so the
     *       axis shows a visible "..." indicator at the end.
     *    3. Style the placeholder tick label (e.g., gray color) to
     *       distinguish it from real data labels.
     */
    truncations: TruncationWarning[];
}

/**
 * Describes one axis that was truncated due to overflow.
 *
 * When more discrete items exist than can fit at the minimum step size,
 * the layout engine caps the visible set and records what was dropped.
 */
interface TruncationWarning {
    /** Severity level for UI display */
    severity: 'warning';
    /** Machine-readable code */
    code: 'overflow';
    /** Human-readable message, e.g., "38 of 120 values in 'Country' were omitted (showing top 82)." */
    message: string;
    /** Which channel overflowed ('x', 'y', 'color', etc.) */
    channel: string;
    /** Field name on the overflowing axis */
    field: string;
    /** Values retained (in display order) */
    keptValues: any[];
    /** Number of items omitted */
    omittedCount: number;
    /** Placeholder string to append to the axis domain (e.g., "...38 items omitted") */
    placeholder: string;
}

/**
 * How to render axis tick labels given the available space.
 *
 * Derived purely from effectiveStep (px per discrete item):
 *   - step ≥ 16px: upright labels, normal font (10px), generous limit.
 *   - 10–15px:     -45° rotation, slightly smaller font (7–9px), limit 60px.
 *   - < 10px:      -90° rotation, small font (6–8px), limit 40px.
 *   - non-discrete: defaults (10px, 100px limit, no rotation).
 */
interface LabelSizingDecision {
    /** Font size in px (6–10, scales with step) */
    fontSize: number;
    /** Max label width in px before truncation (30–100) */
    labelLimit: number;
    /** Rotation angle in degrees (undefined = upright, -45, or -90) */
    labelAngle?: number;
    /** Text alignment for rotated labels ('right' when angled) */
    labelAlign?: string;
    /** Text baseline for rotated labels ('middle' at -90°, 'top' at -45°) */
    labelBaseline?: string;
}
```

### VL dependency: **None**

The layout engine reads `AxisLayoutInput` (item counts, numeric values,
series counts) and `LayoutParams` (step sizes, elasticity, cross-sections).
All are abstract — they describe data density and visual space, not any
charting library's API.

---

## Phase 2: Instantiate Spec

### Responsibility

Combine semantic decisions (Phase 0) and layout dimensions (Phase 1) to
produce the final visual specification. This is the **only phase that
knows about Vega-Lite** (or whichever output format is targeted).

### Inputs

```typescript
interface InstantiateContext {
    // --- From Phase 0 (semantic) ---
    /** Per-channel semantic decisions (type, zero, color, format) */
    channelSemantics: Record<string, ChannelSemantics>;

    // --- From Phase 1 (layout) ---
    layout: LayoutResult;

    // --- Original inputs ---
    table: any[];
    chartProperties?: Record<string, any>;
    canvasSize: { width: number; height: number };
}
```

### What instantiation does

Phase 2 is split into a **shared assembler** (generic VL plumbing) and
a **per-template hook** (chart-specific construction):

#### Shared assembler responsibilities

These are mechanical translations from abstract decisions to VL syntax:

| Task | Input (abstract) | Output (VL-specific) |
|------|------------------|----------------------|
| Set canvas dimensions | `layout.subplotWidth/Height` | `config.view.continuousWidth/Height` |
| Set discrete step sizing | `layout.xStep`, `xNominalCount > 0` | `width: { step: N }` |
| Set grouped step sizing | `layout.xStep`, `xStepUnit = 'group'` | `width: { step: N, for: "position" }` |
| Apply banded-continuous canvas | `layout.xContinuousAsDiscrete`, `layout.xStep` | `config.view.continuousWidth = step × (count+1)` |
| Set banded-continuous domain padding | data extent, item count | `enc.scale.domain = [min - halfStep, max + halfStep]`, `enc.scale.nice = false` |
| Apply zero-baseline | `channelSemantics[ch].zero` | `enc.scale.zero`, `enc.scale.domain` (padded) |
| Apply color scheme | `channelSemantics.color.colorScheme` | `enc.scale.scheme`, `enc.scale.domainMid` |
| Apply temporal format | `channelSemantics[ch].temporalFormat` | `enc.axis.format` or `enc.legend.format` |
| Apply label sizing | `layout.xLabel` | `config.axisX.labelFontSize/Angle/Limit` |
| Apply overflow warnings | `layout.truncations` | Filter data to `keptValues`, append `placeholder` to `scale.domain`, style placeholder label gray, attach `result._warnings` |

#### Per-template hook: `instantiate()`

Each template builds its chart-specific encoding and mark configuration.
What currently happens in `buildEncodings()` + `postProcessing()` is
unified into a single `instantiate()` call that has access to both
semantic info and layout results.

**Categories of template work:**

| Category | Examples | Inputs used |
|----------|----------|-------------|
| **Encoding routing** | Map channels to `spec.encoding`, multi-layer routing | `channelSemantics` |
| **Mark construction** | Set mark type, interpolate, opacity, cornerRadius | `chartProperties` |
| **Layer composition** | Build multi-layer specs (lollipop: rule + circle) | `channelSemantics`, `chartProperties` |
| **Transform wiring** | Set density transform field, regression on/field | `channelSemantics` |
| **Mark sizing** | Set `mark.size` from step (bars, boxplot), `mark.width/height` (heatmap) | `layout.xStep/yStep`, `layout.subplotWidth/Height` |
| **Data-driven sizing** | Scatter point size from coverage, lollipop strokeWidth from overlap | `table`, `layout` |
| **Stack configuration** | Set `encoding.y.stack` from chart properties | `chartProperties` |

**Template interface (revised):**

```typescript
/**
 * How the template's primary mark encodes its quantitative value
 * on the positional (value) axis.
 *
 * Grounded in the Cleveland & McGill (1984) perceptual accuracy ranking:
 *   1. Position along a common scale — most accurate
 *   2. Length from a shared baseline
 *   3. Area
 *   4. Angle
 *   5. Color saturation / luminance
 *
 * This classification drives:
 *   - Zero-baseline: 'length' and 'area' require zero (truncating
 *     distorts perceived proportions); 'position' allows data-fit.
 *   - Scale tightness: 'position' marks benefit from nice:false
 *     (tight domain, no wasteful padding); 'length'/'area' keep
 *     nice ticks since the baseline is the visual anchor.
 *   - Compression tolerance: 'position' survives axis compression
 *     better than 'length' (already used in the stretch model).
 *
 * For compositional templates (e.g., lollipop = rule + circle),
 * report the channel of the value-encoding mark (the rule → 'length'),
 * not the decorative one (the circle).
 */
type MarkCognitiveChannel = 'position' | 'length' | 'area' | 'color';

interface ChartTemplateDef {
    chart: string;
    template: any;            // VL spec skeleton
    channels: string[];

    /**
     * How the primary mark encodes its quantitative value.
     * Determines zero-baseline, scale tightness, and compression behavior.
     *
     * Examples:
     *   - Bar, Histogram, Lollipop, Waterfall, Pyramid: 'length'
     *   - Area, Streamgraph, Density: 'area'
     *   - Line, Scatter, Boxplot, Candlestick, Strip: 'position'
     *   - Heatmap: 'color'
     */
    markCognitiveChannel: MarkCognitiveChannel;

    /**
     * Phase 1a: Declare layout intent.
     * Runs BEFORE layout computation.
     *
     * Inspects resolved encoding types and data to decide:
     * - Which axes are banded (need spring model)
     * - Any type conversions (Q→O for banded axis)
     * - Layout parameter overrides (σ, step multiplier, etc.)
     *
     * Most templates are trivial here (just set axisFlags).
     * Complex templates (bar, grouped bar, boxplot) call
     * detectBandedAxis() to choose the banded axis.
     */
    declareLayoutMode?: (
        channelSemantics: Record<string, ChannelSemantics>,
        table: any[],
    ) => LayoutDeclaration;

    /**
     * Phase 2: Build the final spec.
     * Runs AFTER layout computation.
     *
     * Receives the spec skeleton (deep clone of template),
     * resolved encodings, semantic decisions, and layout result.
     * Combines what was previously split across buildEncodings()
     * and postProcessing() into a single pass.
     */
    instantiate: (
        spec: any,
        context: InstantiateContext,
    ) => void;

    /** Optional configurable properties */
    properties?: ChartPropertyDef[];
}
```

### VL dependency: **Yes — this is where VL lives**

Phase 2 is the only place that knows about Vega-Lite syntax. Everything
it writes (`spec.encoding`, `spec.mark`, `config.view`, `scale.domain`,
`width: { step: N }`) is VL-specific. To target a different library,
replace Phase 2 — Phases 0 and 1 remain unchanged.

---

## Phase Dependency Summary

```
                    ┌─────────────────────────────────────────────┐
                    │              Inputs                         │
                    │  encodings, semanticTypes, table,           │
                    │  chartTemplate, chartProperties, canvasSize │
                    └────────┬───────────────┬────────────────────┘
                             │               │
                    ┌────────▼────────┐      │
                    │  Phase 0        │      │
                    │  resolveSemantics│      │
                    │                 │      │
                    │  reads:         │      │
                    │   - encodings   │      │
                    │   - semanticTypes│     │
                    │   - table       │      │
                    │   - markCognitiveChannel│
                    │                 │      │
                    │  produces:      │      │
                    │   - channelSemantics   │
                    │     (type, zero,  │    │
                    │      color, format)│   │
                    └────────┬────────┘     │
                             │              │
               ┌─────────────┤              │
               │             │              │
    ┌──────────▼──────────┐  │              │
    │  Phase 1a           │  │              │
    │  declareLayoutMode  │  │              │
    │  (template hook)    │  │              │
    │                     │  │              │
    │  reads:             │  │              │
    │   - channelSemantics │ │              │
    │   - table           │  │              │
    │                     │  │              │
    │  produces:          │  │              │
    │   - axisFlags       │  │              │
    │   - resolvedTypes   │  │              │
    │   - paramOverrides  │  │              │
    └──────────┬──────────┘  │              │
               │             │              │
    ┌──────────▼──────────┐  │              │
    │  Phase 1b-d         │  │              │
    │  computeLayout      │  │              │
    │                     │  │              │
    │  reads:             │  │              │
    │   - channelSemantics │ │              │
    │   - resolvedTypes   │  │              │
    │   - axisFlags       │  │              │
    │   - paramOverrides  │  │              │
    │   - table           │  │              │
    │   - canvasSize      │  │              │
    │                     │  │              │
    │  produces:          │  │              │
    │   - LayoutResult    │  │              │
    └──────────┬──────────┘  │              │
               │             │              │
               └──────┬──────┘              │
                      │                     │
              ┌───────▼───────────┐         │
              │  Phase 2          │         │
              │  instantiate      │◀────────┘
              │                   │
              │  reads:           │
              │   - channelSemantics (Phase 0)
              │   - LayoutResult  │  (from Phase 1)
              │   - table         │
              │   - chartProperties
              │   - canvasSize    │
              │                   │
              │  produces:        │
              │   - VL spec       │  (or any output format)
              └───────────────────┘
```

### Data flow matrix

| Data | Phase 0 | Phase 1a | Phase 1b-d | Phase 2 |
|------|---------|----------|------------|---------|
| `encodings` (ChartEncoding) | reads | — | — | — |
| `semanticTypes` | reads | — | — | — |
| `table` | reads | reads | reads | reads |
| `markCognitiveChannel` | reads | — | — | reads |
| `canvasSize` | — | — | reads | reads |
| `chartProperties` | — | — | reads (binCount) | reads |
| `channelSemantics` | **produces** | reads | reads | reads |
| `axisFlags` | — | **produces** | reads | — |
| `paramOverrides` | — | **produces** | reads | — |
| `LayoutResult` | — | — | **produces** | reads |
| VL spec | — | — | — | **produces** |

### Key invariants

1. **Phase 0 never reads VL objects.** It reads `ChartEncoding` (library
   type) and `semanticTypes` (plain strings). Its output uses the same
   type vocabulary (`"quantitative"` etc.) but as abstract semantic
   classifications, not VL-specific constants.

2. **Phase 1 never reads or writes VL objects.** It reads abstract axis
   descriptors (`AxisLayoutInput`) and produces abstract layout numbers
   (`LayoutResult`). The same layout engine works regardless of output
   format.

3. **Phase 2 never modifies inputs from Phase 0 or 1.** It consumes
   `channelSemantics` and `LayoutResult` as read-only and produces a
   complete VL spec (or other output format).

4. **Templates participate through narrow hooks.** `declareLayoutMode()`
   returns a small struct (axis flags + param overrides).
   `instantiate()` receives everything it needs via `InstantiateContext` —
   no need to reach back into earlier phases.

---

## Template Migration Guide

### Current → v2 mapping

| Current hook | v2 equivalent | What moves |
|---|---|---|
| `overrideDefaultSettings(options)` | `declareLayoutMode().paramOverrides` | Layout parameter overrides (σ, step multiplier, etc.) |
| Semantic decisions in `buildEncodings()` | `declareLayoutMode()` | `detectBandedAxis()`, `resolveAsDiscrete()`, setting `axisFlags` |
| VL encoding construction in `buildEncodings()` | `instantiate()` | `defaultBuildEncodings()`, layer routing, transform wiring, chart property application |
| `postProcessing()` | `instantiate()` (end of same function) | `adjustBarMarks()`, `adjustRectTiling()`, boxplot sizing |

### Example: Bar Chart template

**Current (interleaved):**
```typescript
{
    buildEncodings: (spec, encodings, context) => {
        // A: Semantic decision (before layout)
        const result = detectBandedAxis(spec, encodings, context.table);
        // B: Layout declaration (before layout)
        context.axisFlags = { [result?.axis || 'x']: { banded: true } };
        // C: VL spec construction (after layout)
        defaultBuildEncodings(spec, encodings, context);
        // C: Chart property application (after layout)
        if (config?.cornerRadius) { spec.mark.cornerRadiusEnd = cr; }
    },
    postProcessing: adjustBarMarks,  // D: Mark sizing (after layout)
}
```

**v2 (separated):**
```typescript
{
    declareLayoutMode: (channelSemantics, table) => {
        // A: Semantic decision
        const result = detectBandedAxis(channelSemantics, table);
        // B: Layout declaration
        return {
            axisFlags: { [result?.axis || 'x']: { banded: true } },
            resolvedTypes: result?.converted ? { [field]: newType } : undefined,
        };
    },

    instantiate: (spec, context) => {
        // C: VL spec construction
        defaultBuildEncodings(spec, context.channelSemantics);
        // C: Chart property application
        const cr = context.chartProperties?.cornerRadius;
        if (cr > 0) { spec.mark.cornerRadiusEnd = cr; }
        // D: Mark sizing (previously postProcessing)
        adjustBarMarks(spec, context.layout);
    },
}
```

### Example: Line Chart template

**Current:**
```typescript
{
    overrideDefaultSettings: (options) => ({
        ...options,
        continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' },
    }),
    buildEncodings: (spec, encodings, context) => {
        defaultBuildEncodings(spec, encodings, context);
        applyInterpolate(spec, context.chartProperties);
    },
    // no postProcessing
}
```

**v2:**
```typescript
{
    declareLayoutMode: (_channelSemantics, _table) => ({
        paramOverrides: {
            continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' },
        },
    }),

    instantiate: (spec, context) => {
        defaultBuildEncodings(spec, context.channelSemantics);
        applyInterpolate(spec, context.chartProperties);
    },
}
```

### Example: Scatter Plot template

**Current:**
```typescript
{
    buildEncodings: (spec, encodings, context) => {
        defaultBuildEncodings(spec, encodings, context);
        applyPointSizeScaling(spec, context.table, context.canvasSize.width, context.canvasSize.height);
        if (config?.opacity < 1) { spec.mark.opacity = config.opacity; }
    },
    // no overrideDefaultSettings, no postProcessing
}
```

**v2:**
```typescript
{
    // No declareLayoutMode needed — no banded axes, no param overrides.

    instantiate: (spec, context) => {
        defaultBuildEncodings(spec, context.channelSemantics);
        applyPointSizeScaling(spec, context.table,
            context.layout.subplotWidth, context.layout.subplotHeight);
        if (context.chartProperties?.opacity < 1) {
            spec.mark.opacity = context.chartProperties.opacity;
        }
    },
}
```

---

## Special Cases

### Axis-Less Charts (Radial & Area-Filling)

Pie, rose, sunburst, gauge, treemap, sankey, and funnel have **no
Cartesian axes**. They bypass the standard axis-based layout pipeline
and use their own pressure model instead (see stretch model doc §3–§4):

- `declareLayoutMode()` returns empty (no axis flags, no overrides).
- The template's `instantiate()` computes sizing directly:
  - **Radial charts** (pie, rose, sunburst, gauge) call
    `computeCircumferencePressure()` to derive canvas dimensions from
    item count and arc pressure.
  - **Area charts** (treemap) call `computeEffectiveBarCount()` and
    apply area-stretch with biased X/Y split.
  - **Gauge** uses facet-style grid layout with continuous
    radius-proportional element sizing.
- `LayoutResult` axis fields (`xStep`, `yStep`, etc.) are unused.

### Radar Chart

The radar template bypasses the layout system entirely — it computes its
own polar layout, normalizes data, and constructs a full multi-layer spec
from scratch. In v2:

- `declareLayoutMode()` returns empty (no axis flags, no overrides).
- `computeLayout()` runs but its output is mostly ignored.
- `instantiate()` does everything: data normalization, polar coordinate
  math, layer construction, and sizing. It may read `canvasSize` from
  context but ignores `LayoutResult`.

This is acceptable — radar is inherently non-Cartesian and doesn't
benefit from the spring/pressure models.

### Pyramid Chart

The pyramid template does inline sizing (panel widths based on data
domains) and builds a complex `hconcat` spec. In v2:

- `declareLayoutMode()` returns `{ axisFlags: { y: { banded: true } } }`.
- `instantiate()` handles the data splitting, domain computation, panel
  sizing, and hconcat construction. It uses `layout.yStep` for the Y axis
  but computes X panel widths internally.

### Templates with data transforms

Some templates insert VL transforms (density, regression, running sum).
These transforms reference field names from `channelSemantics` but are
purely VL-specific — they belong in `instantiate()`:

| Template | Transform | Field source |
|----------|-----------|--------------|
| Density | `transform[0].density = x.field` | `channelSemantics.x.field` |
| Linear Regression | `transform[0].regression = y.field`, `on = x.field` | `channelSemantics.x/y.field` |
| Waterfall | Running sum compute + positive/negative split | `channelSemantics` + `table` |

---

## Benefits

1. **Testability.** Each phase can be unit-tested independently:
   - Phase 0: "Given semantic type 'Revenue' on a bar chart, assert
     zero=true."
   - Phase 1: "Given 80 banded items on a 400px canvas, assert step=10,
     subplotWidth=800."
   - Phase 2: "Given this LayoutResult, assert VL spec has
     `config.view.continuousWidth = 800`."

2. **Backend portability.** To add an Observable Plot backend:
   - Reuse Phase 0 (semantic decisions are universal).
   - Reuse Phase 1 (layout math is universal).
   - Write a new Phase 2 that produces Plot spec objects instead of VL.

3. **Debuggability.** When a chart looks wrong, inspect the phase outputs:
   - Bad encoding type? → Phase 0 (semantic resolution).
   - Wrong chart size? → Phase 1 (layout computation).
   - Missing mark property? → Phase 2 (instantiation).

4. **Template simplicity.** Templates become cleaner — they declare intent
   (`declareLayoutMode`) and construct output (`instantiate`) without
   managing the interleaving of semantic decisions, layout computation,
   and VL construction that currently requires careful ordering in
   `assembleChart()`.
