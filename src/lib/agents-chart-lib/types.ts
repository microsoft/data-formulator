// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
] as const;

export const channelGroups: Record<string, string[]> = {
    "": ["x", "y", "x2", "y2", "latitude", "longitude", "id", "radius", "theta", "detail"],
    "legends": ["color", "group", "size", "shape", "text", "opacity"],
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
    stack?: "layered" | "zero" | "center" | "normalize";
    sortOrder?: "ascending" | "descending";
    sortBy?: string;
    scheme?: string;
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
 * This is the reusable core that defines chart structure, encoding paths,
 * and post-processing logic.
 */
export interface ChartTemplateDef {
    /** Display name of the chart type, e.g. "Scatter Plot" */
    chart: string;
    /** Vega-Lite spec skeleton (mark + encoding structure) */
    template: any;
    /** Which encoding channels are available for this chart */
    channels: string[];
    /** JSON paths into the template for each channel */
    paths: { [key: string]: (string | number)[] | (string | number)[][] };
    /** Optional post-processor to finalize the spec */
    postProcessor?: (vgSpec: any, table: any[], config?: Record<string, any>, canvasSize?: { width: number; height: number }) => any;
    /** Optional configurable properties for the chart type */
    properties?: ChartPropertyDef[];
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
}
