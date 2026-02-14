// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { applyDynamicMarkResizing, ensureNominalAxis, defaultBuildEncodings } from './utils';

export const barChartDef: ChartTemplateDef = {
        chart: "Bar Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [
            { key: "cornerRadius", label: "Corners", type: "continuous", min: 0, max: 15, step: 1, defaultValue: 0 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            applyDynamicMarkResizing(vgSpec, _table, { x: 'size', y: 'size' });
            if (config) {
                const cr = config.cornerRadius;
                if (cr !== undefined && cr > 0) {
                    if (typeof vgSpec.mark === 'string') {
                        vgSpec.mark = { type: vgSpec.mark, cornerRadiusEnd: cr };
                    } else {
                        vgSpec.mark = { ...vgSpec.mark, cornerRadiusEnd: cr };
                    }
                }
            }
            return vgSpec;
        },
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
        buildEncodings: (spec, encodings) => {
            let { y, x, color } = encodings;

            // Auto-detect flipped axes: if x is discrete and y is quantitative, swap them
            const isDiscrete = (enc: any) => enc && (enc.type === 'nominal' || enc.type === 'ordinal');
            const isQuant = (enc: any) => enc && (enc.type === 'quantitative' || enc.type === 'temporal');
            if (isDiscrete(x) && isQuant(y)) {
                [x, y] = [y, x];
            }

            // y → both panels (shared category axis, always nominal)
            if (y) {
                const yEnc = { ...y };
                if (yEnc.type === 'temporal') yEnc.type = 'nominal';
                spec.hconcat[0].encoding.y = { ...spec.hconcat[0].encoding.y, ...yEnc };
                spec.hconcat[1].encoding.y = { ...spec.hconcat[1].encoding.y, ...yEnc };
            }
            // x → both panels (same value field)
            if (x) {
                spec.hconcat[0].encoding.x = { ...spec.hconcat[0].encoding.x, ...x };
                spec.hconcat[1].encoding.x = { ...spec.hconcat[1].encoding.x, ...x };
            }
            // color → store the field name for postProcessor to create filters
            if (color && color.field) {
                spec._pyramidColorField = color.field;
            }
        },
        postProcessor: (vgSpec: any, table: any[], _config?: Record<string, any>, canvasSize?: { width: number; height: number }) => {
            try {
                const colorField = vgSpec._pyramidColorField;
                delete vgSpec._pyramidColorField;

                if (table && colorField) {
                    // Get unique group values from the color field
                    const groups = [...new Set(table.map(r => r[colorField]))] as string[];

                    // Pick first two groups (pyramid is inherently binary)
                    const leftGroup = groups[0];
                    const rightGroup = groups.length > 1 ? groups[1] : groups[0];

                    // Add filter transforms to split data into panels
                    vgSpec.hconcat[0].transform = [{ filter: { field: colorField, equal: leftGroup } }];
                    vgSpec.hconcat[1].transform = [{ filter: { field: colorField, equal: rightGroup } }];

                    // Set panel titles from group values
                    vgSpec.hconcat[0].title = String(leftGroup);
                    vgSpec.hconcat[1].title = String(rightGroup);

                    // Warn if more than 2 groups
                    if (groups.length > 2) {
                        if (!vgSpec._warnings) vgSpec._warnings = [];
                        vgSpec._warnings.push({
                            severity: 'warning',
                            code: 'too-many-groups-pyramid',
                            message: `Pyramid chart works best with exactly 2 groups, but found ${groups.length} (${groups.map(g => `'${g}'`).join(', ')}). Only the first two are shown.`,
                            channel: 'color',
                            field: colorField,
                        });
                    }
                }

                // Compute shared x domain across both panels
                if (table) {
                    const xField = vgSpec.hconcat[0].encoding.x?.field;
                    if (xField) {
                        const allVals = table.map(r => r[xField]).filter(v => typeof v === 'number');
                        if (allVals.length > 0) {
                            const domain = [Math.min(0, ...allVals), Math.max(...allVals)];
                            vgSpec.hconcat[0].encoding.x.scale = { ...vgSpec.hconcat[0].encoding.x.scale, domain };
                            vgSpec.hconcat[1].encoding.x.scale = { ...vgSpec.hconcat[1].encoding.x.scale, domain };
                        }
                        // Warn about negative values
                        if (allVals.some(v => v < 0)) {
                            if (!vgSpec._warnings) vgSpec._warnings = [];
                            vgSpec._warnings.push({
                                severity: 'warning',
                                code: 'negative-values-pyramid',
                                message: `Negative values detected in '${xField}'. Pyramid charts work best with non-negative values.`,
                                channel: 'x',
                                field: xField,
                            });
                        }
                    }

                    // --- Elastic sizing ---
                    const baseWidth = canvasSize?.width ?? 400;
                    const baseHeight = canvasSize?.height ?? 320;

                    const facetCols = 2;
                    const facetStretch = Math.min(1.5, Math.pow(facetCols, 0.3));
                    const panelWidth = Math.round(Math.max(40, baseWidth * facetStretch / facetCols));

                    const yField = vgSpec.hconcat[0].encoding.y?.field;
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

                    for (const panel of vgSpec.hconcat) {
                        panel.width = panelWidth;
                        panel.height = panelHeight;
                    }
                }
            } catch {
                // ignore errors
            }
            return vgSpec;
        },
};

export const groupedBarChartDef: ChartTemplateDef = {
        chart: "Grouped Bar Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        postProcessor: (vgSpec: any, table: any[]) => {
            if (!vgSpec.encoding.color?.field) {
                applyDynamicMarkResizing(vgSpec, table, { x: 'size', y: 'size' });
                return vgSpec;
            }

            const nominalChannel = ensureNominalAxis(vgSpec, table, true);
            const offsetChannel = nominalChannel === "x" ? "xOffset" : nominalChannel === "y" ? "yOffset" : null;

            if (nominalChannel && offsetChannel) {
                if (!vgSpec.encoding[offsetChannel]) {
                    vgSpec.encoding[offsetChannel] = {};
                }
                vgSpec.encoding[offsetChannel].field = vgSpec.encoding.color.field;
                vgSpec.encoding[offsetChannel].type = "nominal";
            }

            applyDynamicMarkResizing(vgSpec, table, { x: 'size', y: 'size' });
            return vgSpec;
        },
};

export const stackedBarChartDef: ChartTemplateDef = {
        chart: "Stacked Bar Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [
            { key: "stackMode", label: "Stack", type: "discrete", options: [
                { value: undefined, label: "Stacked (default)" },
                { value: "normalize", label: "Normalize (100%)" },
                { value: "center", label: "Center" },
                { value: "layered", label: "Layered (overlap)" },
            ] },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>) => {
            applyDynamicMarkResizing(vgSpec, table, { x: 'size', y: 'size' });
            if (config?.stackMode) {
                // Find the quantitative axis and apply stack mode
                for (const axis of ['x', 'y'] as const) {
                    if (vgSpec.encoding?.[axis]?.type === 'quantitative' ||
                        vgSpec.encoding?.[axis]?.aggregate) {
                        vgSpec.encoding[axis].stack = config.stackMode === 'layered' ? null : config.stackMode;
                        break;
                    }
                }
            }
            return vgSpec;
        },
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
        buildEncodings: defaultBuildEncodings,
        properties: [
            { key: "binCount", label: "Bins", type: "continuous", min: 5, max: 50, step: 1, defaultValue: 10 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (!config) return vgSpec;
            const binCount = config.binCount;
            if (binCount !== undefined && vgSpec.encoding?.x) {
                vgSpec.encoding.x.bin = { maxbins: binCount };
            }
            return vgSpec;
        },
};

export const heatmapDef: ChartTemplateDef = {
        chart: "Heatmap",
        template: {
            mark: "rect",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: defaultBuildEncodings,
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
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>) => {
            applyDynamicMarkResizing(vgSpec, table, { x: 'width', y: 'height' }, 20);
            if (config?.colorScheme && vgSpec.encoding.color) {
                if (!vgSpec.encoding.color.scale) vgSpec.encoding.color.scale = {};
                vgSpec.encoding.color.scale.scheme = config.colorScheme;
            }
            return vgSpec;
        },
};
