// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import {
    defaultBuildEncodings, applyPointSizeScaling, setMarkProp,
    detectBandedAxisForceDiscrete,
} from './utils';

export const scatterPlotDef: ChartTemplateDef = {
    chart: "Scatter Plot",
    template: { mark: "circle", encoding: {} },
    channels: ["x", "y", "color", "size", "opacity", "column", "row"],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        applyPointSizeScaling(spec, ctx.table, ctx.canvasSize?.width, ctx.canvasSize?.height);
        const config = ctx.chartProperties;
        if (config?.opacity !== undefined && config.opacity < 1) {
            spec.mark = setMarkProp(spec.mark, 'opacity', config.opacity);
        }
    },
    properties: [
        { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 1 },
    ] as ChartPropertyDef[],
};

export const linearRegressionDef: ChartTemplateDef = {
    chart: "Linear Regression",
    template: {
        layer: [
            {
                mark: "circle",
                encoding: { x: {}, y: {}, color: {}, size: {} },
            },
            {
                mark: { type: "line", color: "red" },
                transform: [{ regression: "field1", on: "field2", group: "field3" }],
                encoding: { x: {}, y: {} },
            },
        ],
    },
    channels: ["x", "y", "size", "color", "column", "row"],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { x, y, color, size, column, row } = ctx.resolvedEncodings;
        // x & y → both layers + transform field names
        if (x) {
            spec.layer[0].encoding.x = { ...spec.layer[0].encoding.x, ...x };
            spec.layer[1].encoding.x = { ...spec.layer[1].encoding.x, ...x };
            if (x.field) spec.layer[1].transform[0].on = x.field;
        }
        if (y) {
            spec.layer[0].encoding.y = { ...spec.layer[0].encoding.y, ...y };
            spec.layer[1].encoding.y = { ...spec.layer[1].encoding.y, ...y };
            if (y.field) spec.layer[1].transform[0].regression = y.field;
        }
        // color, size → scatter layer only
        if (color) spec.layer[0].encoding.color = { ...spec.layer[0].encoding.color, ...color };
        if (size) spec.layer[0].encoding.size = { ...spec.layer[0].encoding.size, ...size };
        // facets → top-level encoding
        if (!spec.encoding) spec.encoding = {};
        if (column) spec.encoding.column = column;
        if (row) spec.encoding.row = row;
    },
};

export const rangedDotPlotDef: ChartTemplateDef = {
    chart: "Ranged Dot Plot",
    template: {
        encoding: {},
        layer: [
            { mark: "line", encoding: { detail: {} } },
            { mark: { type: "point", filled: true }, encoding: { color: {} } },
        ],
    },
    channels: ["x", "y", "color"],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { color, ...rest } = ctx.resolvedEncodings;
        if (!spec.encoding) spec.encoding = {};
        for (const [ch, enc] of Object.entries(rest)) {
            spec.encoding[ch] = { ...(spec.encoding[ch] || {}), ...enc };
        }
        if (color) {
            spec.layer[1].encoding.color = { ...(spec.layer[1].encoding.color || {}), ...color };
        }

        // Copy nominal axis into detail encoding for line layer
        if (spec.encoding.y?.type === "nominal") {
            spec.layer[0].encoding.detail = JSON.parse(JSON.stringify(spec.encoding.y));
        } else if (spec.encoding.x?.type === "nominal") {
            spec.layer[0].encoding.detail = JSON.parse(JSON.stringify(spec.encoding.x));
        }
    },
};

export const boxplotDef: ChartTemplateDef = {
    chart: "Boxplot",
    template: { mark: "boxplot", encoding: {} },
    channels: ["x", "y", "color", "opacity", "column", "row"],
    markCognitiveChannel: 'position',
    declareLayoutMode: (cs, table) => {
        if (!cs.x?.field || !cs.y?.field) return {};
        const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: 'x' });
        if (!result) return {};
        return {
            axisFlags: { [result.axis]: { banded: true } },
            resolvedTypes: result.resolvedTypes,
        };
    },
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);

        // Scale box width to the step size of the discrete axis
        const layout = ctx.layout;
        if (layout.xNominalCount > 0 || layout.yNominalCount > 0) {
            const boxStep = layout.xNominalCount > 0 ? layout.xStep : layout.yStep;
            const boxSize = Math.max(4, Math.round(boxStep * 0.7));
            spec.mark = setMarkProp(spec.mark, 'size', boxSize);
        }
    },
};
