// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { applyDynamicMarkResizing, ensureNominalAxis, defaultBuildEncodings } from './utils';

export const barCharts: ChartTemplateDef[] = [
    {
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
    },
    {
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
                        color: { legend: null },
                        opacity: { value: 0.9 },
                    },
                },
                {
                    mark: "bar",
                    encoding: {
                        y: { axis: null },
                        x: { stack: null },
                        color: { legend: null },
                        opacity: { value: 0.9 },
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
            // Inject each channel into both hconcat panels
            for (const [ch, enc] of Object.entries(encodings)) {
                for (const panel of spec.hconcat) {
                    if (!panel.encoding) panel.encoding = {};
                    panel.encoding[ch] = { ...(panel.encoding[ch] || {}), ...enc };
                }
            }
        },
        postProcessor: (vgSpec: any, table: any[]) => {
            try {
                if (table) {
                    const colorField = vgSpec.hconcat[0].encoding.color.field;
                    const colorValues = [...new Set(table.map(r => r[colorField]))];
                    vgSpec.hconcat[0].transform = [{ filter: `datum["${colorField}"] == "${colorValues[0]}"` }];
                    vgSpec.hconcat[0].title = colorValues[0];
                    vgSpec.hconcat[1].transform = [{ filter: `datum["${colorField}"] == "${colorValues[1]}"` }];
                    vgSpec.hconcat[1].title = colorValues[1];
                    const xField = vgSpec.hconcat[0].encoding.x.field;
                    const xValues = [...new Set(
                        table
                            .filter(r => r[colorField] === colorValues[0] || r[colorField] === colorValues[1])
                            .map(r => r[xField])
                    )];
                    const domain = [Math.min(...xValues, 0), Math.max(...xValues)];
                    vgSpec.hconcat[0].encoding.x.scale.domain = domain;
                    vgSpec.hconcat[1].encoding.x.scale = { domain };
                }
            } catch {
                // ignore errors
            }
            return vgSpec;
        },
    },
    {
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
    },
    {
        chart: "Stacked Bar Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        postProcessor: (vgSpec: any, table: any[]) => {
            applyDynamicMarkResizing(vgSpec, table, { x: 'size', y: 'size' });
            return vgSpec;
        },
    },
    {
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
    },
    {
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
    },
];
