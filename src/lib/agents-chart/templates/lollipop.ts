// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';

export const lollipopChartDef: ChartTemplateDef = {
        chart: "Lollipop Chart",
        template: {
            encoding: {},
            layer: [
                { mark: { type: "rule", strokeWidth: 1.5 }, encoding: {} },
                { mark: { type: "circle", size: 80 }, encoding: {} },
            ],
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            const { color, column, row, ...positional } = encodings;
            for (const [ch, enc] of Object.entries(positional)) {
                for (const layer of spec.layer) {
                    layer.encoding[ch] = { ...(layer.encoding[ch] || {}), ...enc };
                }
            }
            if (color) {
                spec.layer[1].encoding.color = { ...(spec.layer[1].encoding.color || {}), ...color };
            }
            if (!spec.encoding) spec.encoding = {};
            if (column) spec.encoding.column = column;
            if (row) spec.encoding.row = row;

            // --- Lollipop-specific configuration ---
            const table = context.table;
            const config = context.chartProperties;

            // Anchor rule from 0 on the measure axis
            const xEnc = spec.layer[0]?.encoding?.x;
            const yEnc = spec.layer[0]?.encoding?.y;
            const xType = xEnc?.type;
            const yType = yEnc?.type;

            const isMeasure = (t: string | undefined) =>
                t != null && t !== 'nominal' && t !== 'ordinal';

            if (isMeasure(yType)) {
                spec.layer[0].encoding.y2 = { datum: 0 };
            } else if (isMeasure(xType)) {
                spec.layer[0].encoding.x2 = { datum: 0 };
            }

            // Adaptive rule strokeWidth based on overlap
            const discreteAxis = !isMeasure(xType) ? 'x' : !isMeasure(yType) ? 'y' : null;
            const discreteField = discreteAxis === 'x' ? xEnc?.field : discreteAxis === 'y' ? yEnc?.field : null;
            if (discreteField && table && table.length > 0) {
                const counts: Record<string, number> = {};
                for (const row of table) {
                    const key = String(row[discreteField] ?? '');
                    counts[key] = (counts[key] || 0) + 1;
                }
                const maxOverlap = Math.max(...Object.values(counts));
                if (maxOverlap > 1) {
                    const baseStroke = 1.5;
                    const stroke = Math.max(0.3, baseStroke / Math.sqrt(maxOverlap));
                    spec.layer[0].mark = { ...spec.layer[0].mark, strokeWidth: stroke };
                }
            }

            // Apply dot size from config
            if (config?.dotSize) {
                spec.layer[1].mark = { ...spec.layer[1].mark, size: config.dotSize };
            }
        },
        properties: [
            { key: "dotSize", label: "Dot Size", type: "continuous", min: 20, max: 300, step: 10, defaultValue: 80 },
        ] as ChartPropertyDef[],
};
