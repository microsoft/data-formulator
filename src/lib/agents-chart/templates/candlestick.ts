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
        buildEncodings: (spec, encodings) => {
            const { x, open, high, low, close, column, row } = encodings;

            // x → shared encoding (date/category axis)
            if (!spec.encoding) spec.encoding = {};
            if (x) spec.encoding.x = x;

            // facets → top-level encoding
            if (column) spec.encoding.column = column;
            if (row) spec.encoding.row = row;

            // Shared y axis: quantitative, zero=false (prices rarely start at 0)
            spec.encoding.y = {
                type: "quantitative",
                scale: { zero: false },
                axis: { title: null },
            };

            // Add "Price" as the overall chart title (sits above facets)
            spec.title = { text: "Price", anchor: "start", fontSize: 11, fontWeight: "normal", color: "#666" };

            // Rule layer (wick): low → y, high → y2
            if (low) spec.layer[0].encoding.y = { field: low.field };
            if (high) spec.layer[0].encoding.y2 = { field: high.field };

            // Bar layer (body): open → y, close → y2
            if (open) spec.layer[1].encoding.y = { field: open.field };
            if (close) spec.layer[1].encoding.y2 = { field: close.field };

            // Conditional color: green if bullish (open < close), red otherwise
            if (open?.field && close?.field) {
                spec.encoding.color = {
                    condition: {
                        test: `datum['${open.field}'] < datum['${close.field}']`,
                        value: "#06982d",
                    },
                    value: "#ae1325",
                };
            }
        },
        properties: [
            {
                key: "independentYAxis", label: "Independent Y-Axis", type: "binary",
                defaultValue: false,
            },
        ],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>, canvasSize?: { width: number; height: number }) => {
            // Compute bar width from x-axis cardinality (same logic as applyDynamicMarkResizing)
            const xField = vgSpec.encoding?.x?.field;
            const plotWidth = canvasSize?.width || 400;
            let barSize: number;

            if (xField && table?.length > 0) {
                // Auto-size: use plot width / cardinality, capped to look good
                const cardinality = new Set(table.map((r: any) => r[xField])).size;
                barSize = Math.max(2, Math.min(20, Math.round(plotWidth * 0.6 / cardinality)));
            } else {
                barSize = 14;
            }

            vgSpec.layer[1].mark = { ...vgSpec.layer[1].mark, size: barSize };

            // Independent Y-axis for faceted candlestick charts
            if (config?.independentYAxis) {
                if (!vgSpec.resolve) vgSpec.resolve = {};
                if (!vgSpec.resolve.scale) vgSpec.resolve.scale = {};
                vgSpec.resolve.scale.y = "independent";
            }

            return vgSpec;
        },
};
