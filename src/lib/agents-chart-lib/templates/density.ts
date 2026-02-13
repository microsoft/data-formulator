// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';

export const densityCharts: ChartTemplateDef[] = [
    {
        chart: "Density Plot",
        template: {
            mark: "area",
            transform: [{ density: "__field__" }],
            encoding: {
                x: { field: "value", type: "quantitative" },
                y: { field: "density", type: "quantitative" },
            },
        },
        channels: ["x", "color", "column", "row"],
        buildEncodings: (spec, encodings) => {
            const { x, color, column, row } = encodings;
            // x → sets the density transform field + x encoding title
            if (x?.field) {
                spec.transform[0].density = x.field;
                spec.encoding.x.title = x.field;
            }
            // color → groupby in transform + encoding color
            if (color?.field) {
                spec.transform[0].groupby = [color.field];
                spec.encoding.color = { ...(spec.encoding.color || {}), ...color };
            }
            // facets → top-level encoding
            if (column) spec.encoding.column = column;
            if (row) spec.encoding.row = row;
        },
        properties: [
            { key: "bandwidth", label: "Bandwidth", type: "continuous", min: 0.05, max: 2, step: 0.05, defaultValue: 0 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (config?.bandwidth && config.bandwidth > 0) {
                vgSpec.transform[0].bandwidth = config.bandwidth;
            }
            return vgSpec;
        },
    },
];
