// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { computeCircumferencePressure, computeEffectiveBarCount } from '../../core/decisions';
import { setMarkProp } from './utils';

export const pieChartDef: ChartTemplateDef = {
    chart: "Pie Chart",
    template: { mark: "arc", encoding: {} },
    channels: ["size", "color", "column", "row"],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        // Remap abstract channels to VL channels:
        //   "size" → VL "theta" (angular extent of each slice)
        if (!spec.encoding) spec.encoding = {};
        for (const [ch, enc] of Object.entries(ctx.resolvedEncodings)) {
            if (ch === 'size') {
                // Strip the sqrt/range scale that the assembler adds for generic
                // "size" channels — theta handles its own proportional scaling.
                const { scale: _scale, ...thetaEnc } = enc;
                spec.encoding.theta = thetaEnc;
            } else {
                spec.encoding[ch] = enc;
            }
        }

        // Fallback: when the user only maps color (no size/theta), use count
        // so every colour group gets a proportional slice.
        if (!spec.encoding.theta) {
            spec.encoding.theta = { aggregate: 'count', type: 'quantitative' };
        }

        const config = ctx.chartProperties;
        if (config && config.innerRadius > 0) {
            spec.mark = setMarkProp(spec.mark, 'innerRadius', config.innerRadius);
        }

        // ── Circumference-pressure sizing (spring model) ──────────────
        // Compute effective bar count from slice values to determine
        // whether the pie needs to grow beyond the base canvas.
        const thetaField = spec.encoding.theta?.field;
        const colorField = spec.encoding.color?.field;

        let effectiveCount: number;

        if (thetaField && colorField) {
            // Aggregate values per color category
            const agg = new Map<string, number>();
            for (const row of ctx.table) {
                const cat = String(row[colorField] ?? '');
                const val = Number(row[thetaField]) || 0;
                agg.set(cat, (agg.get(cat) ?? 0) + val);
            }
            effectiveCount = computeEffectiveBarCount([...agg.values()]);
        } else if (colorField) {
            // Count-based: each category gets equal slice
            const cats = new Set(ctx.table.map((r: any) => String(r[colorField] ?? '')));
            effectiveCount = cats.size;
        } else {
            effectiveCount = ctx.table.length;
        }

        const { radius, canvasW, canvasH } = computeCircumferencePressure(
            effectiveCount, ctx.canvasSize, {
                minArcPx: 45,
                minRadius: 60,
                maxStretch: ctx.assembleOptions?.maxStretch,
                margin: 50,   // room for labels around pie
            });

        // Set explicit width/height — overrides config.view defaults
        spec.width = canvasW;
        spec.height = canvasH;
    },
    properties: [
        { key: "innerRadius", label: "Donut", type: "continuous", min: 0, max: 100, step: 5, defaultValue: 0 },
    ] as ChartPropertyDef[],
};
