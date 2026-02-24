// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';

export const densityPlotDef: ChartTemplateDef = {
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
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { x, color, column, row } = ctx.resolvedEncodings;
        if (x?.field) {
            spec.transform[0].density = x.field;
            spec.encoding.x.title = x.field;
        }
        if (color?.field) {
            spec.transform[0].groupby = [color.field];
            spec.encoding.color = { ...(spec.encoding.color || {}), ...color };
        }
        if (column) spec.encoding.column = column;
        if (row) spec.encoding.row = row;

        const config = ctx.chartProperties;
        if (config?.bandwidth && config.bandwidth > 0) {
            spec.transform[0].bandwidth = config.bandwidth;
        }
    },
    properties: [
        { key: "bandwidth", label: "Bandwidth", type: "continuous", min: 0.05, max: 2, step: 0.05, defaultValue: 0 },
    ] as ChartPropertyDef[],
};
