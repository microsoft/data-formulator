// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { defaultBuildEncodings, setMarkProp } from './utils';

const interpolateConfigProperty: ChartPropertyDef = {
    key: "interpolate", label: "Curve", type: "discrete", options: [
        { value: undefined, label: "Default (linear)" },
        { value: "linear", label: "Linear" },
        { value: "monotone", label: "Monotone (smooth)" },
        { value: "step", label: "Step" },
        { value: "step-before", label: "Step Before" },
        { value: "step-after", label: "Step After" },
        { value: "basis", label: "Basis (smooth)" },
        { value: "cardinal", label: "Cardinal" },
        { value: "catmull-rom", label: "Catmull-Rom" },
    ],
};

function applyInterpolate(vgSpec: any, config?: Record<string, any>): void {
    if (!config?.interpolate) return;
    vgSpec.mark = setMarkProp(vgSpec.mark, 'interpolate', config.interpolate);
}

/**
 * Detect whether color is continuous (quantitative/temporal) on a connected mark.
 *
 * In Vega-Lite, encoding `color` on a `line` mark groups data by the
 * color field.  With a continuous field each unique value becomes its own
 * group, producing isolated single-point segments.
 *
 * The idiomatic VL pattern: convert to a layered spec where the `line`
 * layer uses `detail` for series grouping (without color mapping) and an
 * overlaid `point` layer carries the quantitative color encoding.
 */
function hasContinuousColor(resolvedEncodings: Record<string, any>): boolean {
    const colorEnc = resolvedEncodings.color;
    return !!(colorEnc?.field && (colorEnc.type === 'quantitative' || colorEnc.type === 'temporal'));
}

/**
 * Build a layered line + point spec for continuous color on line marks.
 *
 * Handles both single-series and multi-series cases:
 *
 *   Single-series (no `detail` / `opacity` nominal grouping):
 *     line layer  → plain connected path, neutral grey
 *     point layer → colored dots with quantitative color encoding
 *
 *   Multi-series (`detail` or nominal `opacity` encoding present):
 *     line layer  → connected paths grouped by `detail`/`opacity`, neutral grey
 *     point layer → colored dots with the quantitative color encoding
 *
 * The `detail` encoding is preserved on the line layer so that series
 * remain individually connected.  The quantitative `color` is only
 * applied to the point layer where grouping doesn't matter.
 */
function buildContinuousColorLineLayers(
    spec: any,
    resolvedEncodings: Record<string, any>,
    config?: Record<string, any>,
    dataLength: number = 30,
): void {
    const colorEnc = { ...resolvedEncodings.color };

    // Separate encodings: everything except color goes to both layers.
    // The line layer may additionally get `detail` for series grouping.
    const sharedEncodings: Record<string, any> = {};
    for (const [ch, enc] of Object.entries(resolvedEncodings)) {
        if (ch !== 'color') {
            sharedEncodings[ch] = enc;
        }
    }

    // Line layer: connected path, neutral color, no color encoding.
    // If `detail` is present it groups lines without mapping to color.
    const lineMark: any = { type: 'line', color: '#ccc' };
    if (config?.interpolate) {
        lineMark.interpolate = config.interpolate;
    }

    // Point layer: individual colored dots — size scales inversely with density
    const pointSize = Math.round(Math.max(15, Math.min(60, 1200 / dataLength)));
    const pointMark: any = { type: 'point', filled: true, size: pointSize };

    spec.layer = [
        { mark: lineMark, encoding: { ...sharedEncodings } },
        { mark: pointMark, encoding: { ...sharedEncodings, color: colorEnc } },
    ];

    // Remove top-level mark — layered spec uses per-layer marks
    delete spec.mark;
    // Encodings live inside each layer, not at the top
    spec.encoding = {};
}

export const lineChartDef: ChartTemplateDef = {
    chart: "Line Chart",
    template: { mark: "line", encoding: {} },
    channels: ["x", "y", "color", "strokeDash", "detail", "opacity", "column", "row"],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' }, facetAspectRatioResistance: 0.5 },
    }),
    instantiate: (spec, ctx) => {
        if (hasContinuousColor(ctx.resolvedEncodings)) {
            buildContinuousColorLineLayers(spec, ctx.resolvedEncodings, ctx.chartProperties, ctx.table.length);
        } else {
            defaultBuildEncodings(spec, ctx.resolvedEncodings);
            applyInterpolate(spec, ctx.chartProperties);
        }
    },
    properties: [interpolateConfigProperty],
};

export const dottedLineChartDef: ChartTemplateDef = {
    chart: "Dotted Line Chart",
    template: { mark: { type: "line", point: true }, encoding: {} },
    channels: ["x", "y", "color", "detail", "column", "row"],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' }, facetAspectRatioResistance: 0.5 },
    }),
    instantiate: (spec, ctx) => {
        if (hasContinuousColor(ctx.resolvedEncodings)) {
            buildContinuousColorLineLayers(spec, ctx.resolvedEncodings, ctx.chartProperties, ctx.table.length);
        } else {
            defaultBuildEncodings(spec, ctx.resolvedEncodings);
            applyInterpolate(spec, ctx.chartProperties);
        }
    },
    properties: [interpolateConfigProperty],
};
