// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ZeroDecision, ColorSchemeRecommendation } from './semantic-types';
import type { LabelSizingDecision } from './decisions';

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
    "x", "y", "x2", "y2", "id", "color", "opacity", "size", "shape", "column",
    "row", "latitude", "longitude", "radius", "detail", "group",
    "open", "high", "low", "close",
] as const;

export const channelGroups: Record<string, string[]> = {
    "": ["x", "x2", "y", "y2", "latitude", "longitude", "id", "radius", "detail"],
    "legends": ["color", "group", "size", "shape", "text", "opacity"],
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
 * decisions (type, zero-baseline, color scheme, temporal format).
 * All downstream phases read this — no separate maps needed.
 */
export interface ChannelSemantics {
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
     */
    type: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
    /** Human-readable reason for the type decision (for debugging) */
    typeReason?: string;

    // --- Channel-specific semantic decisions ---
    /**
     * Zero-baseline decision (positional quantitative channels only).
     * Present only on 'x' and 'y' channels with type 'quantitative'.
     */
    zero?: ZeroDecision;

    /**
     * Color scheme recommendation (color channel only).
     */
    colorScheme?: ColorSchemeRecommendation;

    /**
     * Temporal format string (temporal fields on any channel).
     * E.g., "%Y", "%b %d", "%H:%M".
     * Present only when type is 'temporal' or field is ordinal-temporal.
     */
    temporalFormat?: string;

    /**
     * Canonical ordinal sort order for this field's values.
     * Present when the field's values match a known ordinal sequence
     * (e.g., month names, day-of-week, quarters).
     * Contains the unique data values sorted in their natural order.
     */
    ordinalSortOrder?: string[];
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

    /** Field name → semantic type string */
    semanticTypes: Record<string, string>;

    /** Chart type name */
    chartType: string;
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
    semantic_types?: Record<string, string>;

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
    /** Maximum axis stretch multiplier cap (default: 2) */
    maxStretch?: number;
    /** Power-law exponent for facet subplot stretch — lower = more conservative (default: 0.3) */
    facetElasticity?: number;
    /** Maximum facet stretch multiplier cap (default: 1.5) */
    facetMaxStretch?: number;
    /** Minimum pixels per discrete axis item (default: 6) */
    minStep?: number;
    /** Minimum facet subplot size in px (default: 60) */
    minSubplotSize?: number;
    /** Multiplier for the default step size (default: 1). Values >1 give more room per category. */
    defaultStepMultiplier?: number;
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
}
