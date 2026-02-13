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
        buildEncodings: (spec, encodings) => {
            const { color, column, row, ...positional } = encodings;
            // x, y → both layers
            for (const [ch, enc] of Object.entries(positional)) {
                for (const layer of spec.layer) {
                    layer.encoding[ch] = { ...(layer.encoding[ch] || {}), ...enc };
                }
            }
            // color → circle layer only (layer[1])
            if (color) {
                spec.layer[1].encoding.color = { ...(spec.layer[1].encoding.color || {}), ...color };
            }
            // facets → top-level
            if (!spec.encoding) spec.encoding = {};
            if (column) spec.encoding.column = column;
            if (row) spec.encoding.row = row;
        },
        properties: [
            { key: "dotSize", label: "Dot Size", type: "continuous", min: 20, max: 300, step: 10, defaultValue: 80 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>) => {
            // Determine which axis is the "measure" axis (quantitative) and anchor
            // the rule from 0 on that axis.  Use a robust check: the measure axis
            // is whichever is NOT nominal/ordinal, rather than checking for specific types.
            const xEnc = vgSpec.layer[0]?.encoding?.x;
            const yEnc = vgSpec.layer[0]?.encoding?.y;
            const xType = xEnc?.type;
            const yType = yEnc?.type;

            const isMeasure = (t: string | undefined) =>
                t != null && t !== 'nominal' && t !== 'ordinal';

            if (isMeasure(yType)) {
                // Vertical lollipop: rule goes from y=0 to the value
                vgSpec.layer[0].encoding.y2 = { datum: 0 };
            } else if (isMeasure(xType)) {
                // Horizontal lollipop: rule goes from x=0 to the value
                vgSpec.layer[0].encoding.x2 = { datum: 0 };
            }

            // Adaptive rule strokeWidth: when multiple data points share the same
            // discrete-axis position (e.g. grouped by color), rules overlap and
            // appear as one thick line.  Thin the stroke based on max overlap.
            const discreteAxis = !isMeasure(xType) ? 'x' : !isMeasure(yType) ? 'y' : null;
            const discreteField = discreteAxis === 'x' ? xEnc?.field : discreteAxis === 'y' ? yEnc?.field : null;
            if (discreteField && table.length > 0) {
                const counts: Record<string, number> = {};
                for (const row of table) {
                    const key = String(row[discreteField] ?? '');
                    counts[key] = (counts[key] || 0) + 1;
                }
                const maxOverlap = Math.max(...Object.values(counts));
                if (maxOverlap > 1) {
                    // Scale stroke: 1.5 for 1, thinner as overlap grows
                    const baseStroke = 1.5;
                    const stroke = Math.max(0.3, baseStroke / Math.sqrt(maxOverlap));
                    vgSpec.layer[0].mark = { ...vgSpec.layer[0].mark, strokeWidth: stroke };
                }
            }

            // Apply dot size from config
            if (config?.dotSize) {
                vgSpec.layer[1].mark = { ...vgSpec.layer[1].mark, size: config.dotSize };
            }

            return vgSpec;
        },
};
