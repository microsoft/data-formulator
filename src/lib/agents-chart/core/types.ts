// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ZeroDecision, ColorSchemeRecommendation } from './semantic-types';
import type { LabelSizingDecision } from './decisions';
import type { SemanticAnnotation, FormatSpec, DomainConstraint, TickConstraint } from './field-semantics';
import type { ColorDecisionResult } from './color-decisions';

/**
 * Core types for the chart engine library.
 * No React or UI framework dependencies — pure TypeScript.
 */

// ---------------------------------------------------------------------------
// Data Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Channel & Encoding
// ---------------------------------------------------------------------------

export const channels = [
    "x", "y", "x2", "y2", "id", "color", "opacity", "size", "shape", "strokeDash", "column",
    "row", "latitude", "longitude", "radius", "detail", "group",
    "open", "high", "low", "close", "angle",
] as const;

export const channelGroups: Record<string, string[]> = {
    "": ["x", "x2", "y", "y2", "latitude", "longitude", "id", "radius", "detail"],
    "legends": ["color", "group", "size", "shape", "text", "opacity", "strokeDash"],
    "price": ["open", "high", "low", "close"],
    "facets": ["column", "row"],
};

/**
 * Encoding definition for a single channel, using field names directly.
 * This is the library-level encoding — no fieldID indirection.
 */
export interface ChartEncoding {
    field?: string;
    type?: "quantitative" | "nominal" | "ordinal" | "temporal";
    aggregate?: 'count' | 'sum' | 'average';
    sortOrder?: "ascending" | "descending";
    sortBy?: string;
    scheme?: string;
}

// ============================================================================
// Phase 0: Semantic Resolution Types
// ============================================================================

/**
 * Everything Phase 0 decides for a single channel.
 *
 * Combines the original ChartEncoding (user intent) with resolved
 * decisions derived from semantic type, data values, and channel context.
 * All downstream phases (layout, assembly, instantiation) read this —
 * no nested FieldSemantics reference needed.
 */
export interface ChannelSemantics {
    // --- Identity ---
    /** Field name bound to this channel */
    field: string;
    /** The semantic annotation for this field */
    semanticAnnotation: SemanticAnnotation;

    // --- Encoding type ---
    /**
     * Final encoding type for this channel.
     * Resolved from semantic type + data characteristics + channel rules.
     */
    type: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';

    // --- Formatting ---
    /** Axis/legend number format */
    format?: FormatSpec;
    /** Tooltip format (typically higher precision) */
    tooltipFormat?: FormatSpec;
    /**
     * Temporal format string (temporal fields on any channel).
     * E.g., "%Y", "%b %d", "%H:%M".
     */
    temporalFormat?: string;

    // --- Aggregation ---
    /** Default aggregate function when used as a measure */
    aggregationDefault?: 'sum' | 'average';

    // --- Scale ---
    /**
     * Zero-baseline decision (positional quantitative channels only).
     * Present only on 'x' and 'y' channels with type 'quantitative'.
     */
    zero?: ZeroDecision;
    /** Recommended scale type */
    scaleType?: 'linear' | 'log' | 'sqrt' | 'symlog';
    /** Whether to apply "nice" rounding to domain endpoints */
    nice?: boolean;
    /** Domain bounds constraint */
    domainConstraint?: DomainConstraint;
    /** Tick mark constraints */
    tickConstraint?: TickConstraint;

    // --- Ordering ---
    /**
     * Canonical ordinal sort order for this field's values.
     * E.g., month names, day-of-week, quarters.
     */
    ordinalSortOrder?: string[];
    /** Whether the canonical order is cyclic (wraps around) */
    cyclic?: boolean;
    /** Whether the axis should be reversed (e.g., Rank: 1 at top) */
    reversed?: boolean;
    /** Default sort direction */
    sortDirection?: 'ascending' | 'descending';

    // --- Color ---
    /** Color scheme recommendation (color channel only) */
    colorScheme?: ColorSchemeRecommendation;

    // --- Histogram ---
    /** Whether this field benefits from binning */
    binningSuggested?: boolean;

    // --- Stacking ---
    /** Whether values can be stacked, and how */
    stackable?: 'sum' | 'normalize' | false;
}

/** Phase 0 output: one entry per channel. */
export type SemanticResult = Record<string, ChannelSemantics>;

// ============================================================================
// Phase 1: Layout Types
// ============================================================================

/**
 * How the template's primary mark encodes its quantitative value
 * on the positional (value) axis.
 *
 * Grounded in perceptual accuracy ranking:
 *   1. Position along a common scale — most accurate
 *   2. Length from a shared baseline
 *   3. Area
 *   4. Color saturation / luminance
 *
 * Drives zero-baseline, scale tightness, and compression behavior.
 */
export type MarkCognitiveChannel = 'position' | 'length' | 'area' | 'color';

/**
 * Template's layout intent — returned by declareLayoutMode().
 */
export interface LayoutDeclaration {
    /**
     * Which axes allocate fixed bands per data position.
     * Banded axes use the spring model; non-banded use gas pressure.
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
     */
    paramOverrides?: Partial<AssembleOptions>;

    /**
     * Which axes use binned encoding (e.g. histogram).
     * The assembler auto-detects this from template.encoding if not set.
     */
    binnedAxes?: Record<string, boolean | { maxbins?: number }>;

    /**
     * Custom overflow strategy for deciding which discrete values to keep
     * when a channel overflows. If not provided, the default strategy is used.
     *
     * @param channel       The overflowing channel ('x', 'y', 'color', etc.)
     * @param fieldName     The field on that channel
     * @param uniqueValues  All unique values in the data for that field
     * @param maxToKeep     Maximum number of values that fit
     * @param context       Abstract context with data and channel info
     * @returns             The values to keep (in display order)
     */
    overflowStrategy?: OverflowStrategy;
}

/**
 * Custom overflow strategy function type.
 * Returns the values to keep when a channel has too many discrete values.
 */
export type OverflowStrategy = (
    channel: string,
    fieldName: string,
    uniqueValues: any[],
    maxToKeep: number,
    context: OverflowStrategyContext,
) => any[];

/** Context passed to overflow strategy functions. */
export interface OverflowStrategyContext {
    /** Full data table */
    data: any[];
    /** Per-channel semantic info */
    channelSemantics: Record<string, ChannelSemantics>;
    /** Original user encodings (for sort info) */
    encodings: Record<string, ChartEncoding>;
    /** Mark types present in the template */
    allMarkTypes: Set<string>;
}

/**
 * Per-channel maximum values that can fit on the canvas.
 *
 * Computed once by `computeChannelBudgets` using the most conservative
 * assumptions (minStep, minSubplotSize, maxStretch).  Passed to
 * `filterOverflow` so it only needs to decide *which* values to keep
 * and filter rows — no layout math.
 *
 * Pipeline:  computeChannelBudgets → filterOverflow → computeLayout
 */
export interface ChannelBudgets {
    /** Maximum discrete values to keep per channel.
     *  Channels not present here are uncapped (`Infinity`). */
    maxValues: Record<string, number>;
    /** Facet grid decision (if facet channels exist) */
    facetGrid?: FacetGridResult;
}

/** Result of overflow filtering. */
export interface OverflowResult {
    /** Data after removing overflow rows */
    filteredData: any[];
    /** Nominal value counts per channel (post-overflow) */
    nominalCounts: Record<string, number>;
    /** Detailed truncation info for overflow styling */
    truncations: TruncationWarning[];
    /** Warning messages for the UI */
    warnings: ChartWarning[];
}

/**
 * Result of facet grid computation (from computeFacetGrid).
 *
 * Decides the visual grid layout (including column-only wrapping)
 * and the maximum number of unique values to keep per facet channel.
 *
 * Pipeline:  computeFacetGrid → filterOverflow (uses caps) → computeLayout (uses grid)
 */
export interface FacetGridResult {
    /** Visual columns per row (after wrapping for column-only) */
    columns: number;
    /** Visual rows (after wrapping for column-only) */
    rows: number;
    /** Max unique values to keep for the column channel */
    maxColumnValues: number;
    /** Max unique values to keep for the row channel */
    maxRowValues: number;
}

/**
 * Describes one axis that was truncated due to overflow.
 */
export interface TruncationWarning {
    /** Severity level for UI display */
    severity: 'warning';
    /** Machine-readable code */
    code: 'overflow';
    /** Human-readable message */
    message: string;
    /** Which channel overflowed ('x', 'y', 'color', etc.) */
    channel: string;
    /** Field name on the overflowing axis */
    field: string;
    /** Values retained (in display order) */
    keptValues: any[];
    /** Number of items omitted */
    omittedCount: number;
    /** Placeholder string to append to the axis domain */
    placeholder: string;
}

/**
 * Phase 1 output: all layout decisions.
 *
 * LayoutResult is **target-agnostic** — it describes abstract dimensions
 * and step sizes that any rendering backend can consume.  It is the
 * backend's responsibility to translate these values into its own
 * coordinate system:
 *
 *   subplotWidth / subplotHeight
 *     The intended data-area (plot area) size in pixels.  This does NOT
 *     include axis labels, titles, legends, or margins.  Each backend
 *     must add its own margins/padding around this area.
 *
 *   xStep / yStep
 *     Pixel distance per discrete position on each axis.  A backend
 *     rendering bars should derive bar width from step and stepPadding.
 *     VL uses `width: {step: N}` natively; ECharts must compute
 *     explicit barWidth / barCategoryGap.
 *
 *   stepPadding
 *     Fraction of each step reserved for inter-category spacing (0–1).
 *     Usable bar width = step × (1 − stepPadding).
 *
 *   facet (columns / rows / subplot sizes)
 *     When faceting is active, the subplot dimensions are already
 *     divided for the facet grid.  Each backend is responsible for
 *     facet wrapping (e.g. column-only → wrapped rows), panel
 *     positioning, header labels, and shared/per-panel axis titles.
 *
 * Backends should NOT modify LayoutResult.  They read it and translate
 * to their native format (VL encoding props, ECharts grid/axis config, etc.).
 */
export interface LayoutResult {
    /** Final subplot width in px (after stretch) */
    subplotWidth: number;
    /** Final subplot height in px (after stretch) */
    subplotHeight: number;

    /** Computed step size for X axis (px per discrete position) */
    xStep: number;
    /** Computed step size for Y axis (px per discrete position) */
    yStep: number;

    /** Whether the step size is per-item or per-group. */
    xStepUnit?: 'item' | 'group';
    yStepUnit?: 'item' | 'group';

    /** Number of banded continuous items on each axis (0 if not banded-continuous) */
    xContinuousAsDiscrete: number;
    yContinuousAsDiscrete: number;

    /** Number of nominal/ordinal items on each axis */
    xNominalCount: number;
    yNominalCount: number;

    /** Label sizing decisions per axis */
    xLabel: LabelSizingDecision;
    yLabel: LabelSizingDecision;

    /** Facet layout (if applicable) */
    facet?: {
        columns: number;
        rows: number;
        subplotWidth: number;
        subplotHeight: number;
    };

    /**
     * Gap between facet panels in px, as set by the backend.
     * Backends use this to configure their own spacing
     * (VL config.facet.spacing, ECharts GAP, etc.).
     */
    effectiveFacetGap: number;

    /**
     * Inter-category padding fraction (0–1) used by the layout engine.
     * Renderers (especially ECharts) should use this to size bars:
     *   barWidth = step × (1 − stepPadding)
     */
    stepPadding: number;

    /** Items truncated due to overflow */
    truncations: TruncationWarning[];
}

// ============================================================================
// Phase 2: Instantiation Types
// ============================================================================

/**
 * Context passed to template instantiate() and to the shared assembler's
 * Phase 2 logic. Combines semantic decisions, layout results, and original
 * inputs.
 */
export interface InstantiateContext {
    /** Per-channel semantic decisions (Phase 0) */
    channelSemantics: Record<string, ChannelSemantics>;

    /** Layout decisions (Phase 1) */
    layout: LayoutResult;

    /** The data table (array of row objects, post-overflow filtering) */
    table: any[];

    /** Resolved VL encoding objects (built by assembler from Phase 0 decisions) */
    resolvedEncodings: Record<string, any>;

    /** Original user-level encodings */
    encodings: Record<string, ChartEncoding>;

    /** User-configured chart properties */
    chartProperties?: Record<string, any>;

    /** Target canvas dimensions */
    canvasSize: { width: number; height: number };

    /** Field name → semantic type (string or enriched annotation) */
    semanticTypes: Record<string, string | SemanticAnnotation>;

    /** Chart type name */
    chartType: string;

    /** Assembly options (layout tuning parameters from the caller) */
    assembleOptions?: AssembleOptions;

    /**
     * Backend-agnostic color decisions.
     * Computed once per chart from semantic + layout context and reused
     * by all backends to map into their native color configuration.
     */
    colorDecisions?: ColorDecisionResult;
}



// ---------------------------------------------------------------------------
// Chart Template
// ---------------------------------------------------------------------------

/**
 * Defines a configurable property for a chart template.
 * Describes the value domain; the app decides how to render it.
 */
export type ChartPropertyDef = {
    key: string;
    label: string;
} & (
    | { type: 'continuous'; min: number; max: number; step?: number; defaultValue?: number }
    | { type: 'discrete';  options: { value: any; label: string }[]; defaultValue?: any }
    | { type: 'binary';    defaultValue?: boolean }
);

/**
 * Chart template definition — pure data, no UI/icon dependencies.
 * This is the reusable core that defines chart structure, encoding channels,
 * and processing logic.
 *
 * Three-phase pipeline hooks:
 *   1. declareLayoutMode — declare axis flags, type overrides, param overrides
 *   2. instantiate — build final spec from resolved encodings + layout
 */
export interface ChartTemplateDef {
    /** Display name of the chart type, e.g. "Scatter Plot" */
    chart: string;
    /** Vega-Lite spec skeleton (mark + encoding structure) */
    template: any;
    /** Which encoding channels are available for this chart */
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
     * Inspects channel semantics and data to decide:
     * - Which axes are banded (need spring model)
     * - Any type conversions (Q→O for banded axis)
     * - Layout parameter overrides (σ, step multiplier, etc.)
     * Grouping (from group channel + discrete axis detection)
     */
    declareLayoutMode?: (
        channelSemantics: Record<string, ChannelSemantics>,
        table: any[],
        chartProperties?: Record<string, any>,
    ) => LayoutDeclaration;

    /**
     * Build the final spec from resolved encodings + layout.
     * Runs AFTER layout computation.
     *
     * Receives the spec skeleton (deep clone of template),
     * and a context with resolved encodings, semantic decisions,
     * and layout result. Handles both encoding mapping and mark sizing.
     *
     * @param spec       The Vega-Lite spec skeleton (deep clone of template)
     * @param context    Complete context with all phase outputs
     */
    instantiate: (
        spec: any,
        context: InstantiateContext,
    ) => void;

    /** Optional configurable properties for the chart type */
    properties?: ChartPropertyDef[];

    /**
     * Optional post-processing hook.
     * Called after instantiation and layout application, before the final
     * result is returned.  Receives the assembled spec/option and the
     * effective canvas size so the template can adjust visual parameters
     * (e.g. symbol size, line width) proportionally.
     */
    postProcess?: (
        spec: any,
        context: InstantiateContext,
    ) => void;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/** A warning produced during chart assembly */
export interface ChartWarning {
    /** Warning severity */
    severity: 'info' | 'warning' | 'error';
    /** Short machine-readable warning code */
    code: string;
    /** Human-readable description */
    message: string;
    /** Optional: which channel(s) or field(s) triggered the warning */
    channel?: string;
    field?: string;
}

// ---------------------------------------------------------------------------
// Unified Assembly Input
// ---------------------------------------------------------------------------

/**
 * Unified input for all chart assembly functions (Vega-Lite, ECharts, Chart.js).
 *
 * Instead of passing multiple positional arguments, callers provide a single
 * JSON-serializable object with four top-level keys:
 *
 * ```ts
 * const result = assembleVegaLite({
 *   data: { values: myRows },
 *   semantic_types: { weight: 'Quantity', origin: 'Country' },
 *   chart_spec: {
 *     chartType: 'Scatter Plot',
 *     encodings: { x: { field: 'weight' }, y: { field: 'mpg' } },
 *     canvasSize: { width: 400, height: 300 },
 *   },
 *   options: { addTooltips: true },
 * });
 * ```
 */
export interface ChartAssemblyInput {
    /**
     * Data source — either inline rows or a URL to fetch.
     *
     * - `{ values: any[] }` — an array of row objects (like Vega-Lite `data.values`).
     * - `{ url: string }`   — a URL pointing to a JSON or CSV resource.
     *   The assembler will resolve this internally before processing.
     *
     * At least one of `values` or `url` must be provided.
     */
    data: { values: any[]; url?: never } | { url: string; values?: never };

    /**
     * Per-column semantic type annotations.
     *
     * Maps field names to semantic type strings (e.g., `"Quantity"`, `"Country"`,
     * `"Year"`, `"Percentage"`). These drive encoding type resolution, zero-baseline
     * decisions, color schemes, formatting, and more.
     *
     * Fields not listed here fall back to `inferVisCategory()` which inspects
     * raw data values.
     */
    semantic_types?: Record<string, string | SemanticAnnotation>;

    /**
     * Chart specification — describes *what* to draw.
     */
    chart_spec: {
        /** Template name, e.g. `"Scatter Plot"`, `"Bar Chart"` */
        chartType: string;
        /** Channel → encoding map (e.g., `{ x: { field: 'weight' }, y: { field: 'mpg' } }`) */
        encodings: Record<string, ChartEncoding>;
        /** Target canvas size in pixels (default: `{ width: 400, height: 320 }`) */
        canvasSize?: { width: number; height: number };
        /** Template-specific configurable properties (e.g., bar corner radius, show labels) */
        chartProperties?: Record<string, any>;
    };

    /**
     * Options for the assembler — layout tuning, tooltips, etc.
     * All fields are optional and have sensible defaults.
     */
    options?: AssembleOptions;
}

// ---------------------------------------------------------------------------
// Assembly Options
// ---------------------------------------------------------------------------

/**
 * Options for the chart assembly function.
 * Includes layout tuning parameters — all have sensible defaults.
 */
export interface AssembleOptions {
    /** Whether to add tooltips to the chart (default: false) */
    addTooltips?: boolean;
    /**
     * Fraction of each step reserved for inter-category padding (0–1).
     * VL pads *inside* the step (band = step × (1 − padding)), so this
     * value should match VL's paddingInner.  ECharts pads *outside* the
     * band, so the layout engine passes this through so ECharts can
     * compute barWidth = step × (1 − stepPadding) explicitly.
     *
     * Default: 0.1 (matching VL's default band paddingInner).
     */
    stepPadding?: number;
    /** Power-law exponent for discrete axis stretch (default: 0.5) */
    elasticity?: number;
    /**
     * Maximum total stretch multiplier cap (default: 2).
     *
     * This is a **unified** budget: the combined stretch from facet
     * layout AND discrete/banded axis sizing must stay within this
     * factor.  For example, with maxStretch=2 and a 400px canvas,
     * the total chart width never exceeds 800px regardless of how
     * many facet columns or discrete axis items there are.
     */
    maxStretch?: number;
    /** Power-law exponent for facet subplot stretch — lower = more conservative (default: 0.3) */
    facetElasticity?: number;
    /** Minimum pixels per discrete axis item (default: 6) */
    minStep?: number;
    /** Maximum number of distinct color values before overflow truncation (default: 24) */
    maxColorValues?: number;
    /** Minimum facet subplot size in px (default: 60) */
    minSubplotSize?: number;
    /**
     * Fixed overhead in px for axis labels, titles, legend, etc.
     * Subtracted once from the total canvas budget (not per-panel).
     * Each backend sets its own default; core uses { width: 0, height: 0 }.
     */
    facetFixedPadding?: { width: number; height: number };
    /**
     * Gap in px between adjacent facet panels (spacing, headers).
     * Used directly by the core layout engine to compute subplot sizes
     * and max canvas dimensions.
     * Each backend sets its own value (VL ≈ 10, ECharts ≈ 14); core uses 0.
     */
    facetGap?: number;
    /**
     * Base pixels per discrete category at a 300px baseline canvas.
     * Scaled proportionally with canvas size by the core layout engine.
     * The final default step size is:
     *
     *   defaultStepSize = defaultBandSize × max(1, canvasSize/300)
     *
     * Backends set this to match their native bar/band rendering:
     *   - VL:  ~20 (VL uses width:{step:N} which auto-sizes the plot area)
     *   - EC:  ~20 (ECharts adds generous grid margins)
     *   - CJS: ~30 (Chart.js fills the canvas; wider bands look more native)
     *
     * Templates can override via paramOverrides for chart types that need
     * more space per band (e.g. jitter: 40, funnel: 50, sankey: 60).
     *
     * Default: 20.
     */
    defaultBandSize?: number;
    /**
     * When true, continuous X and Y axes stretch together using the
     * larger of the two per-axis stretch factors. This preserves the
     * aspect ratio of the data space. (default: false — axes stretch
     * independently based on their own density.)
     */
    maintainContinuousAxisRatio?: boolean;
    /**
     * Gas-pressure tuning for continuous axes (default: scatter-plot settings).
     * - A single number overrides markCrossSection (σ) for both axes.
     * - An object allows per-axis σ plus optional elasticity / maxStretch:
     *   `{ x: 100, y: 0, elasticity: 0.7, maxStretch: 2 }`
     *   x/y = 0 means "don't stretch this axis".
     *   Useful for line/area charts where horizontal crowding matters
     *   far more than vertical.
     */
    continuousMarkCrossSection?: number | {
        x: number;
        y: number;
        /** Per-axis stretch elasticity (default: 0.3). Higher → more responsive. */
        elasticity?: number;
        /** Per-axis stretch cap (default: 1.5). */
        maxStretch?: number;
        /**
         * Which axis uses series-count-based pressure instead of pixel counting.
         * - 'x' or 'y': that axis uses nSeries × σ / dim for pressure.
         * - 'auto': auto-detect — in 2D (both continuous), defaults to 'y';
         *   in 1D (one continuous + one discrete), uses the continuous axis.
         * The σ for the series axis is used directly (not sqrt'd) since series
         * count is inherently 1D.
         */
        seriesCountAxis?: 'x' | 'y' | 'auto';
    };
    /**
     * Resistance to aspect-ratio distortion when faceting.
     *
     * When faceting divides one dimension (e.g. width by column count),
     * the subplot aspect ratio drifts away from the single-plot ratio.
     * Line and area charts are very sensitive to this because their
     * visual signal is encoded in slopes and curve shapes.
     *
     * This parameter partially compensates by shrinking the undivided
     * dimension so the panel aspect ratio stays closer to the original:
     *
     *   arDrift = facetedAR / baseAR          (< 1 when panel is narrower)
     *   correctedDim = dim × arDrift ^ resistance
     *
     * - 0 (default): no correction — current behavior.
     * - 0.3–0.5: moderate resistance (recommended for line / area).
     * - 1: fully preserve the single-plot aspect ratio.
     */
    facetAspectRatioResistance?: number;
    /**
     * Whether to auto-wrap column-only facets into a 2D grid.
     *
     * When `true` (default), `computeFacetGrid` considers wrapping N
     * column facets into multiple rows, choosing the layout whose
     * overall aspect ratio best matches the canvas AR.
     *
     * When `false`, column-only facets stay in a single row (capped
     * at the maximum that fits the canvas budget). Useful for small
     * multiples that should always be side-by-side.
     */
    autoFacetWrap?: boolean;
    /**
     * Target aspect ratio for a single band (step height ÷ step width).
     *
     * When a banded (discrete) axis is opposite a continuous axis, each
     * band has a natural AR = continuousAxisSize / stepSize.  If that
     * exceeds the target, the continuous axis is shrunk via a log-space
     * blend so bands don't become excessively tall/wide.
     *
     * - `undefined` / 0: no band-AR correction.
     * - Typical values: 8–15 (VL default ≈ 10, ECharts ≈ 12).
     *
     * Only affects charts with exactly one banded axis and one
     * continuous axis (e.g. bar, lollipop).  Has no effect on
     * scatter, line, or fully-banded charts.
     */
    targetBandAR?: number;
}
