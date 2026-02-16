// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ZeroDecision } from './semantic-types';
import type { EncodingTypeDecision } from './decisions';

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
    "row", "latitude", "longitude", "theta", "radius", "detail", "group",
    "open", "high", "low", "close",
] as const;

export const channelGroups: Record<string, string[]> = {
    "": ["x", "x2", "y", "y2", "latitude", "longitude", "id", "radius", "theta", "detail"],
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

/**
 * Context passed to buildEncodings so templates can make dtype and
 * orientation decisions based on the actual data.
 *
 * The assembler populates this once and hands it to every template;
 * templates pick whatever they need.
 */
export interface BuildEncodingContext {
    /** The data table (array of row objects) */
    table: any[];
    /** Field name → semantic type string (e.g. "Quantity", "Country") */
    semanticTypes: Record<string, string>;
    /** Target canvas dimensions */
    canvasSize: { width: number; height: number };
    /** Chart type name (e.g. "Bar Chart") — for edge cases */
    chartType: string;
    /** User-configured chart properties (corner radius, bin count, etc.) */
    chartProperties?: Record<string, any>;

    /**
     * Semantic type metadata computed by the assembler.
     * Templates can use this to make informed decisions about axis scaling,
     * color schemes, and other encoding properties.
     *
     * Populated before buildEncodings is called.
     */
    semanticMetadata?: {
        /**
         * Per-field encoding type decisions.
         * Maps field name → EncodingTypeDecision (resolved VL type + reasoning).
         */
        encodingTypeDecisions: Record<string, EncodingTypeDecision>;
        /**
         * Per-channel zero-baseline decisions.
         * Maps channel ('x', 'y') → ZeroDecision.
         * Only populated for quantitative positional channels.
         */
        zeroDecisions: Record<string, ZeroDecision>;
    };

    /**
     * Axis flags set by templates during buildEncodings to communicate
     * layout intent to the assembler's sizing logic.
     *
     * `banded`: whether marks on this axis occupy discrete bands of space
     * (bars, rects, boxplots) and need per-position step sizing.
     * Non-banded marks (points, lines) are freely placed and don't need
     * step-based layout even on discrete axes.
     *
     * Templates set these; the assembler reads them for elastic stretch
     * and mark sizing decisions.
     */
    axisFlags?: {
        x?: { banded: boolean };
        y?: { banded: boolean };
    };

    /** Layout sizing computed after elastic step computation (populated before postProcessing) */
    inferredProperties?: {
        /** Computed step size for the X axis (px per discrete position) */
        xStepSize: number;
        /** Computed step size for the Y axis (px per discrete position) */
        yStepSize: number;
        /** Final subplot width in px (after elastic stretch) */
        subplotWidth: number;
        /** Final subplot height in px (after elastic stretch) */
        subplotHeight: number;
        /** Number of continuous-as-discrete values on X */
        xContinuousAsDiscrete: number;
        /** Number of continuous-as-discrete values on Y */
        yContinuousAsDiscrete: number;
        /** Number of nominal/ordinal values on X */
        xNominalCount: number;
        /** Number of nominal/ordinal values on Y */
        yNominalCount: number;
    };
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
 */
export interface ChartTemplateDef {
    /** Display name of the chart type, e.g. "Scatter Plot" */
    chart: string;
    /** Vega-Lite spec skeleton (mark + encoding structure) */
    template: any;
    /** Which encoding channels are available for this chart */
    channels: string[];
    /**
     * Build the encoding section of the spec from resolved encoding objects.
     * This is the primary extension point for chart-specific encoding logic
     * (e.g. multi-layer specs, grouped bar offsets, pyramid splits).
     *
     * Templates that need a discrete dimension (bar, grouped bar, boxplot, …)
     * should call helpers like `detectBandedAxis()` / `resolveAsDiscrete()`
     * here to finalize dtype decisions.
     *
     * Simple templates use defaultBuildEncodings which maps each channel
     * directly to spec.encoding[channel].
     *
     * @param spec       The Vega-Lite spec skeleton (deep clone of template)
     * @param encodings  Resolved encoding objects (field, type, sort, scale…)
     * @param context    Data context for dtype/orientation decisions
     */
    buildEncodings: (spec: any, encodings: Record<string, any>, context: BuildEncodingContext) => void;
    /** Optional configurable properties for the chart type */
    properties?: ChartPropertyDef[];
    /**
     * Optional hook to override default assembly settings before layout.
     * Templates that need different layout tuning (e.g. larger step sizes
     * for jittered plots) return a modified copy of the options here.
     */
    overrideDefaultSettings?: (options: AssembleOptions) => AssembleOptions;
    /**
     * Optional hook to adjust mark properties after layout computation.
     * Called after elastic step sizing so templates can set mark width,
     * height, size etc. based on final computed step sizes and subplot
     * dimensions. Mutates `spec` in place.
     */
    postProcessing?: (spec: any, context: BuildEncodingContext) => void;
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
// Assembly Options
// ---------------------------------------------------------------------------

/**
 * Options for the chart assembly function.
 * Includes layout tuning parameters — all have sensible defaults.
 */
export interface AssembleOptions {
    /** Whether to add tooltips to the chart (default: false) */
    addTooltips?: boolean;
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
