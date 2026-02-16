// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef, BuildEncodingContext } from '../types';
import { detectBandedAxis, ensureDiscreteAxes, defaultBuildEncodings, resolveAsDiscrete, adjustBarMarks, adjustRectTiling } from './utils';

export const barChartDef: ChartTemplateDef = {
        chart: "Bar Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            // Bar chart needs one discrete dimension
            const result = detectBandedAxis(spec, encodings, context.table, { preferAxis: 'x' });
            context.axisFlags = { [result?.axis || 'x']: { banded: true } };
            defaultBuildEncodings(spec, encodings, context);

            // Apply corner radius from chart properties
            const config = context.chartProperties;
            if (config) {
                const cr = config.cornerRadius;
                if (cr !== undefined && cr > 0) {
                    if (typeof spec.mark === 'string') {
                        spec.mark = { type: spec.mark, cornerRadiusEnd: cr };
                    } else {
                        spec.mark = { ...spec.mark, cornerRadiusEnd: cr };
                    }
                }
            }
        },
        properties: [
            { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 15, step: 1, defaultValue: 0 },
        ] as ChartPropertyDef[],
        postProcessing: adjustBarMarks,
};

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
            config: {
                view: { stroke: null },
                axis: { grid: false },
            },
        },
        channels: ["x", "y", "color"],
        buildEncodings: (spec, encodings, context) => {
            let { y, x, color } = encodings;

            // Auto-detect flipped axes: if x is discrete and y is quantitative, swap them
            const isDiscreteType = (enc: any) => enc && (enc.type === 'nominal' || enc.type === 'ordinal');
            const isQuant = (enc: any) => enc && (enc.type === 'quantitative' || enc.type === 'temporal');
            if (isDiscreteType(x) && isQuant(y)) {
                [x, y] = [y, x];
            }

            // y → both panels (shared category axis, always discrete)
            if (y) {
                const yEnc = { ...y };
                resolveAsDiscrete(yEnc, context.table);
                context.axisFlags = { y: { banded: true } };
                spec.hconcat[0].encoding.y = { ...spec.hconcat[0].encoding.y, ...yEnc };
                spec.hconcat[1].encoding.y = { ...spec.hconcat[1].encoding.y, ...yEnc };
            }
            // x → both panels (same value field)
            if (x) {
                spec.hconcat[0].encoding.x = { ...spec.hconcat[0].encoding.x, ...x };
                spec.hconcat[1].encoding.x = { ...spec.hconcat[1].encoding.x, ...x };
            }

            // --- Pyramid-specific configuration ---
            const colorField = color?.field;
            const table = context.table;
            const canvasSize = context.canvasSize;

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
                            message: `Pyramid chart works best with exactly 2 groups, but found ${groups.length} (${groups.map(g => `'${g}'`).join(', ')}). Only the first two are shown.`,
                            channel: 'color',
                            field: colorField,
                        });
                    }
                }

                if (table) {
                    const xField = spec.hconcat[0].encoding.x?.field;
                    if (xField) {
                        const allVals = table.map(r => r[xField]).filter(v => typeof v === 'number');
                        if (allVals.length > 0) {
                            const domain = [Math.min(0, ...allVals), Math.max(...allVals)];
                            spec.hconcat[0].encoding.x.scale = { ...spec.hconcat[0].encoding.x.scale, domain };
                            spec.hconcat[1].encoding.x.scale = { ...spec.hconcat[1].encoding.x.scale, domain };
                        }
                        if (allVals.some(v => v < 0)) {
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

export const groupedBarChartDef: ChartTemplateDef = {
        chart: "Grouped Bar Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            const result = detectBandedAxis(spec, encodings, context.table, { preferAxis: 'x' });
            const axis = result?.axis || 'x';
            context.axisFlags = { [axis]: { banded: true } };

            // Grouped bar requires a truly discrete axis for xOffset grouping.
            // If detectBandedAxis didn't convert (Q×Q, T×Q), force it.
            if (result && !result.converted && encodings[axis]) {
                resolveAsDiscrete(encodings[axis], context.table);
            }

            if (encodings.color?.field && result) {
                const offsetChannel = result.axis === "x" ? "xOffset" : "yOffset";
                encodings[offsetChannel] = {
                    field: encodings.color.field,
                    type: "nominal",
                };
            }

            defaultBuildEncodings(spec, encodings, context);
        },
        postProcessing: adjustBarMarks,
};

export const stackedBarChartDef: ChartTemplateDef = {
        chart: "Stacked Bar Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            const result = detectBandedAxis(spec, encodings, context.table, { preferAxis: 'x' });
            context.axisFlags = { [result?.axis || 'x']: { banded: true } };
            defaultBuildEncodings(spec, encodings, context);

            // Apply stack mode from chart properties
            const config = context.chartProperties;
            if (config?.stackMode) {
                for (const axis of ['x', 'y'] as const) {
                    if (spec.encoding?.[axis]?.type === 'quantitative' ||
                        spec.encoding?.[axis]?.aggregate) {
                        spec.encoding[axis].stack = config.stackMode === 'layered' ? null : config.stackMode;
                        break;
                    }
                }
            }
        },
        properties: [
            { key: "stackMode", label: "Stack", type: "discrete", options: [
                { value: undefined, label: "Stacked (default)" },
                { value: "normalize", label: "Normalize (100%)" },
                { value: "center", label: "Center" },
                { value: "layered", label: "Layered (overlap)" },
            ] },
        ] as ChartPropertyDef[],
        overrideDefaultSettings: (opts) => ({ ...opts, continuousMarkCrossSection: { x: 20, y: 20, seriesCountAxis: 'auto' } }),
        postProcessing: adjustBarMarks,
};

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
        buildEncodings: (spec, encodings, context) => {
            defaultBuildEncodings(spec, encodings, context);

            // Apply bin count from chart properties
            const config = context.chartProperties;
            if (config) {
                const binCount = config.binCount;
                if (binCount !== undefined && spec.encoding?.x) {
                    spec.encoding.x.bin = { maxbins: binCount };
                }
            }
        },
        properties: [
            { key: "binCount", label: "Bins", type: "continuous", min: 5, max: 50, step: 1, defaultValue: 10 },
        ] as ChartPropertyDef[],
        postProcessing: adjustBarMarks,
};

export const heatmapDef: ChartTemplateDef = {
        chart: "Heatmap",
        template: {
            mark: "rect",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            context.axisFlags = { x: { banded: true }, y: { banded: true } };
            defaultBuildEncodings(spec, encodings, context);

            // Apply color scheme from chart properties
            const config = context.chartProperties;
            if (config?.colorScheme && spec.encoding.color) {
                if (!spec.encoding.color.scale) spec.encoding.color.scale = {};
                spec.encoding.color.scale.scheme = config.colorScheme;
            }
        },
        properties: [
            {
                key: "colorScheme", label: "Scheme", type: "discrete", options: [
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
        ] as ChartPropertyDef[],
        postProcessing: (spec: any, context: BuildEncodingContext) => {
            adjustBarMarks(spec, context);
            adjustRectTiling(spec, context);
        },
};
