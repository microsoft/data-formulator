// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef } from '../types';

export const candlestickChartDef: ChartTemplateDef = {
        chart: "Candlestick Chart",
        template: {
            encoding: {},
            layer: [
                { mark: "rule", encoding: {} },
                { mark: { type: "bar", size: 14 }, encoding: {} },
            ],
        },
        channels: ["x", "open", "high", "low", "close", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            // Candlestick uses bars — x axis is banded
            context.axisFlags = { x: { banded: true } };
            const { x, open, high, low, close, column, row } = encodings;

            if (!spec.encoding) spec.encoding = {};
            if (x) {
                spec.encoding.x = x;
                if (x.type === 'nominal' || x.type === 'ordinal') {
                    spec.encoding.x.sort = null;
                }
            }

            if (column) spec.encoding.column = column;
            if (row) spec.encoding.row = row;

            spec.encoding.y = {
                type: "quantitative",
                scale: { zero: false },
                axis: { title: null },
            };

            spec.title = { text: "Price", anchor: "start", fontSize: 11, fontWeight: "normal", color: "#666" };

            if (low) spec.layer[0].encoding.y = { field: low.field };
            if (high) spec.layer[0].encoding.y2 = { field: high.field };
            if (open) spec.layer[1].encoding.y = { field: open.field };
            if (close) spec.layer[1].encoding.y2 = { field: close.field };

            if (open?.field && close?.field) {
                spec.encoding.color = {
                    condition: {
                        test: `datum['${open.field}'] < datum['${close.field}']`,
                        value: "#06982d",
                    },
                    value: "#ae1325",
                };
            }

            // Compute bar width from x-axis cardinality
            const table = context.table;
            const canvasSize = context.canvasSize;
            const xField = spec.encoding?.x?.field;
            const plotWidth = canvasSize?.width || 400;
            let barSize: number;

            if (xField && table?.length > 0) {
                const cardinality = new Set(table.map((r: any) => r[xField])).size;
                barSize = Math.max(2, Math.min(20, Math.round(plotWidth * 0.6 / cardinality)));
            } else {
                barSize = 14;
            }

            spec.layer[1].mark = { ...spec.layer[1].mark, size: barSize };

            // Independent Y-axis for faceted candlestick charts
            const config = context.chartProperties;
            if (config?.independentYAxis) {
                if (!spec.resolve) spec.resolve = {};
                if (!spec.resolve.scale) spec.resolve.scale = {};
                spec.resolve.scale.y = "independent";
            }
        },
        properties: [
            {
                key: "independentYAxis", label: "Independent Y-Axis", type: "binary",
                defaultValue: false,
            },
        ],
};
