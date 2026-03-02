// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import {
    defaultBuildEncodings, setMarkProp, adjustBarMarks, adjustRectTiling,
    detectBandedAxisFromSemantics, detectBandedAxisForceDiscrete,
    resolveAsDiscrete, ensureDiscreteTypes,
} from './utils';

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
        { key: "stackMode", label: "Stack", type: "discrete", options: [
            { value: undefined, label: "Stacked (default)" },
            { value: "normalize", label: "Normalize (100%)" },
            { value: "center", label: "Center" },
            { value: "layered", label: "Layered (overlap)" },
        ] },
    ] as ChartPropertyDef[],
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
    declareLayoutMode: () => ({
        axisFlags: { x: { banded: true }, y: { banded: true } },
    }),
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        // Apply color scheme from chart properties
        const config = ctx.chartProperties;
        if (config?.colorScheme && spec.encoding?.color) {
            if (!spec.encoding.color.scale) spec.encoding.color.scale = {};
            spec.encoding.color.scale.scheme = config.colorScheme;
        }
        adjustBarMarks(spec, ctx);
        adjustRectTiling(spec, ctx);
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
};
