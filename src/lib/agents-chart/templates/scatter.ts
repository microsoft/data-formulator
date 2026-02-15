// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { detectBandedAxis, resolveAsDiscrete, applyPointSizeScaling, defaultBuildEncodings, setMarkProp } from './utils';

export const scatterPlotDef: ChartTemplateDef = {
        chart: "Scatter Plot",
        template: {
            mark: "circle",
            encoding: {},
        },
        channels: ["x", "y", "color", "size", "opacity", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            defaultBuildEncodings(spec, encodings, context);

            applyPointSizeScaling(spec, context.table, context.canvasSize?.width, context.canvasSize?.height);
            const config = context.chartProperties;
            if (config) {
                const opacity = config.opacity;
                if (opacity !== undefined && opacity < 1) {
                    if (typeof spec.mark === 'string') {
                        spec.mark = { type: spec.mark, opacity };
                    } else {
                        spec.mark = { ...spec.mark, opacity };
                    }
                }
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
        buildEncodings: (spec, encodings, _context) => {
            const { x, y, color, size, column, row, ...rest } = encodings;
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
        buildEncodings: (spec, encodings, _context) => {
            const { color, ...rest } = encodings;
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
        template: {
            mark: "boxplot",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            if (encodings.x?.field && encodings.y?.field) {
                const result = detectBandedAxis(spec, encodings, context.table, { preferAxis: 'x' });
                const axis = result?.axis || 'x';
                context.axisFlags = { [axis]: { banded: true } };

                // Boxplot requires a truly discrete axis for per-group box computation.
                // If detectBandedAxis didn't convert (Q×Q, T×Q), force it.
                if (result && !result.converted && encodings[axis]) {
                    resolveAsDiscrete(encodings[axis], context.table);
                }
            }
            defaultBuildEncodings(spec, encodings, context);
        },
        postProcessing: (spec, context) => {
            const ip = context.inferredProperties;
            if (!ip) return;
            // Scale box width to the step size of the discrete axis
            if (ip.xNominalCount > 0 || ip.yNominalCount > 0) {
                const boxStep = ip.xNominalCount > 0 ? ip.xStepSize : ip.yStepSize;
                const boxSize = Math.max(4, Math.round(boxStep * 0.7));
                spec.mark = setMarkProp(spec.mark, 'size', boxSize);
            }
        },
};
