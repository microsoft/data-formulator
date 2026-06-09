// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef, EncodingActionDef } from '../../core/types';
import { makeSortAction } from '../../core/encoding-actions';
import {
    defaultBuildEncodings, setMarkProp, adjustBarMarks, adjustRectTiling,
    detectBandedAxisFromSemantics, detectBandedAxisForceDiscrete,
    resolveAsDiscrete, ensureDiscreteTypes,
} from './utils';

const HEATMAP_SCHEME_COLORS: Record<string, [string, string]> = {
    viridis: ['#440154', '#fde725'],
    inferno: ['#000004', '#fcffa4'],
    magma: ['#000004', '#fcfdbf'],
    plasma: ['#0d0887', '#f0f921'],
    turbo: ['#30123b', '#7a0403'],
    blues: ['#f7fbff', '#08519c'],
    reds: ['#fff5f0', '#a50f15'],
    greens: ['#f7fcf5', '#00441b'],
    oranges: ['#fff5eb', '#7f2704'],
    purples: ['#fcfbfd', '#3f007d'],
    greys: ['#ffffff', '#252525'],
};

function hexLuma(hex: string): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 0;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function getSafeHeatmapIntrinsicDomain(ctx: any, colorField: string | undefined): [number, number] | undefined {
    if (!colorField) return undefined;

    const colorChannel = ctx.channelSemantics?.color;
    const annotation = colorChannel?.semanticAnnotation;

    if (annotation?.intrinsicDomain) {
        return annotation.intrinsicDomain;
    }

    const semanticType = annotation?.semanticType;
    if (semanticType === 'Correlation') return [-1, 1];
    if (semanticType === 'Latitude') return [-90, 90];
    if (semanticType === 'Longitude') return [-180, 180];

    return undefined;
}

// ─── Bar Chart ──────────────────────────────────────────────────────────────

export const barChartDef: ChartTemplateDef = {
    chart: "Bar Chart",
    template: { mark: "bar", encoding: {} },
    channels: ["x", "y", "color", "opacity", "column", "row"],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: 'x' });
        return {
            axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
        };
    },
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        const config = ctx.chartProperties;
        if (config && config.cornerRadius > 0) {
            spec.mark = setMarkProp(spec.mark, 'cornerRadius', config.cornerRadius);
        }
        adjustBarMarks(spec, ctx);
    },
    properties: [
        { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 15, step: 1, defaultValue: 0 },
    ] as ChartPropertyDef[],
    encodingActions: [makeSortAction()] as EncodingActionDef[],
};

// ─── Pyramid Chart ──────────────────────────────────────────────────────────

export const pyramidChartDef: ChartTemplateDef = {
    chart: "Pyramid Chart",
    template: {
        spacing: 0,
        resolve: { scale: { y: "shared" } },
        hconcat: [
            {
                mark: "bar",
                encoding: {
                    y: {},
                    x: { scale: { reverse: true }, stack: null },
                    opacity: { value: 0.9 },
                    color: { value: "#4e79a7" },
                },
            },
            {
                mark: "bar",
                encoding: {
                    y: { axis: null },
                    x: { stack: null },
                    opacity: { value: 0.9 },
                    color: { value: "#e15759" },
                },
            },
        ],
        config: { view: { stroke: null }, axis: { grid: false } },
    },
    channels: ["x", "y", "color"],
    markCognitiveChannel: 'length',
    declareLayoutMode: () => ({
        axisFlags: { y: { banded: true } },
    }),
    instantiate: (spec, ctx) => {
        let { y, x, color } = ctx.resolvedEncodings;

        // Auto-detect flipped axes
        const isDiscreteType = (enc: any) => enc && (enc.type === 'nominal' || enc.type === 'ordinal');
        const isQuant = (enc: any) => enc && (enc.type === 'quantitative' || enc.type === 'temporal');
        if (isDiscreteType(x) && isQuant(y)) {
            [x, y] = [y, x];
        }

        // y → both panels (shared category axis, always discrete)
        if (y) {
            const yEnc = { ...y };
            resolveAsDiscrete(yEnc, ctx.table);
            spec.hconcat[0].encoding.y = { ...spec.hconcat[0].encoding.y, ...yEnc };
            spec.hconcat[1].encoding.y = { ...spec.hconcat[1].encoding.y, ...yEnc };
        }
        // x → both panels
        if (x) {
            spec.hconcat[0].encoding.x = { ...spec.hconcat[0].encoding.x, ...x };
            spec.hconcat[1].encoding.x = { ...spec.hconcat[1].encoding.x, ...x };
        }

        // --- Pyramid-specific configuration ---
        const colorField = color?.field;
        const table = ctx.table;
        const canvasSize = ctx.canvasSize;

        try {
            if (table && colorField) {
                const groups = [...new Set(table.map(r => r[colorField]))] as string[];
                const leftGroup = groups[0];
                const rightGroup = groups.length > 1 ? groups[1] : groups[0];

                spec.hconcat[0].transform = [{ filter: { field: colorField, equal: leftGroup } }];
                spec.hconcat[1].transform = [{ filter: { field: colorField, equal: rightGroup } }];
                spec.hconcat[0].title = String(leftGroup);
                spec.hconcat[1].title = String(rightGroup);

                if (groups.length > 2) {
                    if (!spec._warnings) spec._warnings = [];
                    spec._warnings.push({
                        severity: 'warning',
                        code: 'too-many-groups-pyramid',
                        message: `Pyramid chart works best with exactly 2 groups, but found ${groups.length} (${groups.map((g: string) => `'${g}'`).join(', ')}). Only the first two are shown.`,
                        channel: 'color',
                        field: colorField,
                    });
                }
            }

            if (table) {
                const xField = spec.hconcat[0].encoding.x?.field;
                if (xField) {
                    const allVals = table.map(r => r[xField]).filter((v: any) => typeof v === 'number');
                    if (allVals.length > 0) {
                        const domain = [Math.min(0, ...allVals), Math.max(...allVals)];
                        spec.hconcat[0].encoding.x.scale = { ...spec.hconcat[0].encoding.x.scale, domain };
                        spec.hconcat[1].encoding.x.scale = { ...spec.hconcat[1].encoding.x.scale, domain };
                    }
                    if (allVals.some((v: number) => v < 0)) {
                        if (!spec._warnings) spec._warnings = [];
                        spec._warnings.push({
                            severity: 'warning',
                            code: 'negative-values-pyramid',
                            message: `Negative values detected in '${xField}'. Pyramid charts work best with non-negative values.`,
                            channel: 'x',
                            field: xField,
                        });
                    }
                }

                const baseWidth = canvasSize?.width ?? 400;
                const baseHeight = canvasSize?.height ?? 320;

                const facetCols = 2;
                const facetStretch = Math.min(1.5, Math.pow(facetCols, 0.3));
                const panelWidth = Math.round(Math.max(40, baseWidth * facetStretch / facetCols));

                const yField = spec.hconcat[0].encoding.y?.field;
                let panelHeight = baseHeight;
                if (yField) {
                    const yCardinality = new Set(table.map(r => r[yField])).size;
                    const baseRefSize = 300;
                    const sizeRatio = Math.max(baseWidth, baseHeight) / baseRefSize;
                    const defaultStep = Math.round(20 * Math.max(1, sizeRatio));
                    if (yCardinality > 0) {
                        const pressure = (yCardinality * defaultStep) / baseHeight;
                        if (pressure > 1) {
                            const stretch = Math.min(2, Math.pow(pressure, 0.5));
                            panelHeight = Math.round(baseHeight * stretch);
                        }
                    }
                }

                for (const panel of spec.hconcat) {
                    panel.width = panelWidth;
                    panel.height = panelHeight;
                }
            }
        } catch {
            // ignore errors
        }
    },
};

// ─── Grouped Bar Chart ──────────────────────────────────────────────────────

export const groupedBarChartDef: ChartTemplateDef = {
    chart: "Grouped Bar Chart",
    template: { mark: "bar", encoding: {} },
    channels: ["x", "y", "group", "column", "row"],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: 'x' });
        const axis = result?.axis || 'x';

        return {
            axisFlags: { [axis]: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
        };
    },
    instantiate: (spec, ctx) => {
        // resolvedEncodings already includes color + xOffset/yOffset from group channel
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        adjustBarMarks(spec, ctx);
    },
    encodingActions: [makeSortAction()] as EncodingActionDef[],
};

// ─── Stacked Bar Chart ──────────────────────────────────────────────────────

export const stackedBarChartDef: ChartTemplateDef = {
    chart: "Stacked Bar Chart",
    template: { mark: "bar", encoding: {} },
    channels: ["x", "y", "color", "column", "row"],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: 'x' });
        return {
            axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
            paramOverrides: { continuousMarkCrossSection: { x: 20, y: 20, seriesCountAxis: 'auto' } },
        };
    },
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        // Apply stack mode
        const config = ctx.chartProperties;
        if (config?.stackMode) {
            for (const axis of ['x', 'y'] as const) {
                if (spec.encoding?.[axis]?.type === 'quantitative' ||
                    spec.encoding?.[axis]?.aggregate) {
                    spec.encoding[axis].stack = config.stackMode === 'layered' ? null : config.stackMode;
                    break;
                }
            }
        }
        adjustBarMarks(spec, ctx);
    },
    properties: [
        { key: "stackMode", label: "Stack", type: "discrete",
          // A stack mode only does something when a series dimension (color) is
          // present to stack; without it there is a single bar per category.
          check: (ctx) => ({ applicable: !!ctx.encodings.color?.field }),
          options: [
            { value: undefined, label: "Stacked (default)" },
            { value: "normalize", label: "Normalize (100%)" },
            { value: "center", label: "Center" },
            { value: "layered", label: "Layered (overlap)" },
        ] },
    ] as ChartPropertyDef[],
    encodingActions: [makeSortAction()] as EncodingActionDef[],
};

// ─── Histogram ──────────────────────────────────────────────────────────────

export const histogramDef: ChartTemplateDef = {
    chart: "Histogram",
    template: {
        mark: "bar",
        encoding: {
            x: { bin: true },
            y: { aggregate: "count" },
        },
    },
    channels: ["x", "color", "column", "row"],
    markCognitiveChannel: 'length',
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        // Apply bin count from chart properties
        const config = ctx.chartProperties;
        if (config?.binCount !== undefined && spec.encoding?.x) {
            spec.encoding.x.bin = { maxbins: config.binCount };
        }
        adjustBarMarks(spec, ctx);
    },
    properties: [
        { key: "binCount", label: "Bins", type: "continuous", min: 5, max: 50, step: 1, defaultValue: 10 },
    ] as ChartPropertyDef[],
};

// ─── Heatmap ────────────────────────────────────────────────────────────────

export const heatmapDef: ChartTemplateDef = {
    chart: "Heatmap",
    template: { mark: "rect", encoding: {} },
    channels: ["x", "y", "color", "column", "row"],
    markCognitiveChannel: 'color',
    declareLayoutMode: (_cs, _table, chartProperties) => {
        const showTextLabels = !!chartProperties?.showTextLabels;
        return {
            axisFlags: { x: { banded: true }, y: { banded: true } },
            // Labels need slightly larger cells so the value text isn't crushed,
            // but we keep this close to the unlabeled defaults (minStep 6 /
            // defaultBandSize 20) so a labeled heatmap doesn't balloon. The small
            // label font (see instantiate) is what lets these stay compact.
            paramOverrides: showTextLabels
                ? { minStep: 9, defaultBandSize: 22 }
                : undefined,
        };
    },
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        // Apply color scheme from chart properties
        const config = ctx.chartProperties;
        const showTextLabels = !!config?.showTextLabels;
        const colorField = spec.encoding?.color?.field;
        const colorVals = colorField
            ? ctx.table
                .map((r: any) => Number(r[colorField]))
                .filter((v: number) => Number.isFinite(v))
            : [];
        const observedMin = colorVals.length > 0 ? Math.min(...colorVals) : 0;
        const observedMax = colorVals.length > 0 ? Math.max(...colorVals) : 1;
        const existingScheme = spec.encoding?.color?.scale?.scheme;
        // Color scheme is a Category-B encoding override: the compiler already
        // composed chartProperties.colorScheme onto encoding.color.scheme before
        // assembly (see applyEncodingOverrides), so we just read it here. This
        // also transparently covers charts saved before the migration, whose
        // value lived in chartProperties.colorScheme.
        const encScheme = ctx.encodings?.color?.scheme;
        const userScheme = (encScheme && encScheme !== 'default') ? encScheme : undefined;
        const schemeName = userScheme || existingScheme;
        const isDiverging = schemeName === 'blueorange' || schemeName === 'redblue';
        const intrinsicDomain = getSafeHeatmapIntrinsicDomain(ctx, colorField);

        let effectiveMin = intrinsicDomain?.[0] ?? observedMin;
        let effectiveMax = intrinsicDomain?.[1] ?? observedMax;

        if (spec.encoding?.color) {
            if (!spec.encoding.color.scale) spec.encoding.color.scale = {};
            if (userScheme) {
                spec.encoding.color.scale.scheme = userScheme;
            }
            if (isDiverging && effectiveMin < 0 && effectiveMax > 0) {
                const sym = Math.max(Math.abs(effectiveMin), Math.abs(effectiveMax));
                effectiveMin = -sym;
                effectiveMax = sym;
                spec.encoding.color.scale.domain = [-sym, sym];
                spec.encoding.color.scale.domainMid = 0;
            } else if (intrinsicDomain) {
                spec.encoding.color.scale.domain = [effectiveMin, effectiveMax];
            }
        }
        adjustBarMarks(spec, ctx);
        adjustRectTiling(spec, ctx);

        if (showTextLabels && spec.encoding?.color?.field) {
            const baseEncoding = spec.encoding || {};
            const xEncoding = baseEncoding.x;
            const yEncoding = baseEncoding.y;
            const span = effectiveMax - effectiveMin;

            const cellMinDim = Math.min(ctx.layout.xStep || 50, ctx.layout.yStep || 50);
            // Keep the in-cell value text small so cells can stay compact (close
            // to the unlabeled heatmap). Cap at 9px and step down for tighter
            // cells rather than growing the font/cells to fit it.
            const labelFontSize = cellMinDim >= 40 ? 9 : cellMinDim >= 28 ? 8 : 7;
            const labelFormat = cellMinDim >= 44 ? '.2f' : '.1f';

            const sequentialPalette = HEATMAP_SCHEME_COLORS[schemeName || 'viridis'] || HEATMAP_SCHEME_COLORS.viridis;
            const highIsLight = hexLuma(sequentialPalette[1]) >= hexLuma(sequentialPalette[0]);
            const strongThreshold = span > 0
                ? (isDiverging
                    ? Math.max(Math.abs(effectiveMin), Math.abs(effectiveMax)) * 0.5
                    : effectiveMin + span * 0.6)
                : undefined;

            spec.layer = [
                {
                    mark: spec.mark,
                    encoding: {
                        ...(xEncoding ? { x: xEncoding } : {}),
                        ...(yEncoding ? { y: yEncoding } : {}),
                        ...(baseEncoding.color ? { color: baseEncoding.color } : {}),
                    },
                },
                {
                    mark: {
                        type: 'text',
                        align: 'center',
                        baseline: 'middle',
                        fontSize: labelFontSize,
                    },
                    encoding: {
                        ...(xEncoding ? { x: xEncoding } : {}),
                        ...(yEncoding ? { y: yEncoding } : {}),
                        text: {
                            field: colorField,
                            type: 'quantitative',
                            format: labelFormat,
                        },
                        color: strongThreshold == null
                            ? { value: 'black' }
                            : {
                                condition: {
                                    test: isDiverging
                                        ? `datum.${colorField} > ${strongThreshold} || datum.${colorField} < ${-strongThreshold}`
                                        : `datum.${colorField} >= ${strongThreshold}`,
                                    value: isDiverging
                                        ? 'white'
                                        : (highIsLight ? 'black' : 'white'),
                                },
                                value: isDiverging
                                    ? 'black'
                                    : (highIsLight ? 'white' : 'black'),
                            },
                    },
                },
            ];
            delete spec.mark;
        }
    },
    properties: [
        { key: 'showTextLabels', label: 'Show labels', type: 'binary', defaultValue: false },
    ] as ChartPropertyDef[],
    // Color scheme is an encoding-level edit (writes encoding.scheme on the
    // color channel), so it is exposed as a Category-B encoding action rather
    // than a chart-native property. The host stores the chosen value as an
    // override in chartProperties.colorScheme; the compiler composes it onto the
    // encoding (see applyEncodingOverrides). `dependencies` tells the host to
    // reset the override when the color channel's binding changes in the shelf.
    encodingActions: [
        {
            key: 'colorScheme',
            label: 'Scheme',
            isApplicable: (ctx) => !!ctx.encodings.color?.field,
            dependencies: ['color'],
            control: {
                type: 'discrete', options: [
                    { value: undefined, label: "Default" },
                    { value: "viridis", label: "Viridis" },
                    { value: "inferno", label: "Inferno" },
                    { value: "magma", label: "Magma" },
                    { value: "plasma", label: "Plasma" },
                    { value: "turbo", label: "Turbo" },
                    { value: "blues", label: "Blues" },
                    { value: "reds", label: "Reds" },
                    { value: "greens", label: "Greens" },
                    { value: "oranges", label: "Oranges" },
                    { value: "purples", label: "Purples" },
                    { value: "greys", label: "Greys" },
                    { value: "blueorange", label: "Blue-Orange (diverging)" },
                    { value: "redblue", label: "Red-Blue (diverging)" },
                ],
            },
            get: (encodings) => encodings.color?.scheme,
            set: (encodings, value) => ({ ...encodings, color: { ...encodings.color, scheme: value } }),
        },
    ] as EncodingActionDef[],
};
