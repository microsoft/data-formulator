// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { ensureNominalAxis, applyPointSizeScaling, defaultBuildEncodings } from './utils';

export const scatterPlots: ChartTemplateDef[] = [
    {
        chart: "Scatter Plot",
        template: {
            mark: "circle",
            encoding: {},
        },
        channels: ["x", "y", "color", "size", "opacity", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [
            { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 1 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>, canvasSize?: { width: number; height: number }) => {
            applyPointSizeScaling(vgSpec, table, canvasSize?.width, canvasSize?.height);
            if (!config) return vgSpec;
            const opacity = config.opacity;
            if (opacity !== undefined && opacity < 1) {
                if (typeof vgSpec.mark === 'string') {
                    vgSpec.mark = { type: vgSpec.mark, opacity };
                } else {
                    vgSpec.mark = { ...vgSpec.mark, opacity };
                }
            }
            return vgSpec;
        },
    },
    {
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
        buildEncodings: (spec, encodings) => {
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
    },
    {
        chart: "Ranged Dot Plot",
        template: {
            encoding: {},
            layer: [
                { mark: "line", encoding: { detail: {} } },
                { mark: { type: "point", filled: true }, encoding: { color: {} } },
            ],
        },
        channels: ["x", "y", "color"],
        buildEncodings: (spec, encodings) => {
            const { color, ...rest } = encodings;
            // x, y → top-level encoding
            if (!spec.encoding) spec.encoding = {};
            for (const [ch, enc] of Object.entries(rest)) {
                spec.encoding[ch] = { ...(spec.encoding[ch] || {}), ...enc };
            }
            // color → layer[1] only
            if (color) {
                spec.layer[1].encoding.color = { ...(spec.layer[1].encoding.color || {}), ...color };
            }
        },
        postProcessor: (vgSpec: any, _table: any[]) => {
            if (vgSpec.encoding.y?.type === "nominal") {
                vgSpec.layer[0].encoding.detail = JSON.parse(JSON.stringify(vgSpec.encoding.y));
            } else if (vgSpec.encoding.x?.type === "nominal") {
                vgSpec.layer[0].encoding.detail = JSON.parse(JSON.stringify(vgSpec.encoding.x));
            }
            return vgSpec;
        },
    },
    {
        chart: "Boxplot",
        template: {
            mark: "boxplot",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        postProcessor: (vgSpec: any, table: any[]) => {
            const hasX = vgSpec.encoding.x?.field;
            const hasY = vgSpec.encoding.y?.field;
            if (hasX && hasY) {
                ensureNominalAxis(vgSpec, table, true);
            }
            return vgSpec;
        },
    },
];
