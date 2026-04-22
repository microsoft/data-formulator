// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { detectBandedAxisFromSemantics, setMarkProp } from './utils';

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
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: 'x' });
        return {
            axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
            // Lollipops need far less room per position than bars:
            // a thin rule + small dot vs a full-width bar.  Use tighter
            // band sizing so the chart stays compact with dense data.
            // Allow wider stretch (3×) and taller bands (AR 30 vs bar's 10)
            // since thin marks tolerate elongated cells without looking cramped.
            paramOverrides: { defaultBandSize: 6, minStep: 2, maxStretch: 3, targetBandAR: 240 },
        };
    },
    instantiate: (spec, ctx) => {
        const { color, column, row, ...positional } = ctx.resolvedEncodings;
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
        const table = ctx.table;
        const config = ctx.chartProperties;
        const layout = ctx.layout;

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

        // --- Adaptive sizing for crowded lollipops ---
        const n = table?.length ?? 0;
        const plotWidth = layout?.subplotWidth ?? ctx.canvasSize?.width ?? 400;
        const plotHeight = layout?.subplotHeight ?? ctx.canvasSize?.height ?? 300;

        // 1. Coverage-based point size scaling (like scatter plot)
        const defaultDotSize = config?.dotSize ?? 80;
        const plotArea = plotWidth * plotHeight;
        const targetCoverage = 0.15;
        const currentCoverage = (n * defaultDotSize) / plotArea;
        let dotSize = defaultDotSize;
        if (n > 0 && currentCoverage > targetCoverage) {
            dotSize = Math.round(Math.max(4, (targetCoverage * plotArea) / n));
        }
        spec.layer[1].mark = { ...spec.layer[1].mark, size: dotSize };

        // 2. Aggressive rule strokeWidth reduction — use ratio directly
        //    (not sqrt) so strokes thin out fast with dense data
        const baseStroke = 1.5;
        if (dotSize < defaultDotSize) {
            const ratio = dotSize / defaultDotSize;
            const stroke = Math.max(0.15, baseStroke * ratio);
            spec.layer[0].mark = { ...spec.layer[0].mark, strokeWidth: stroke };
        }

        // 3. Per-group overlap-based stroke thinning
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
                const currentStroke = (spec.layer[0].mark as any).strokeWidth ?? baseStroke;
                const stroke = Math.max(0.15, currentStroke / maxOverlap);
                spec.layer[0].mark = { ...spec.layer[0].mark, strokeWidth: stroke };
            }
        }

        // 4. Step sizing for dense lollipops.
        //    Lollipops sit between fully-discrete (bar) and fully-continuous
        //    (scatter): dots are small so steps can be tighter than bars.
        for (const axis of ['x', 'y'] as const) {
            const count = axis === 'x' ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
            if (count <= 0) continue;
            const effStep = axis === 'x' ? layout.xStep : layout.yStep;
            // Tighter rule width: cap at 40% step but floor very low
            const maxRuleWidth = Math.max(0.15, Math.min(effStep * 0.4, 2));
            // Dot area budget: ~60% of step² (smaller than bar's full step)
            const maxDotSize = Math.max(4, Math.round(effStep * effStep * 0.6));
            spec.layer[0].mark = setMarkProp(spec.layer[0].mark, 'strokeWidth',
                Math.min((spec.layer[0].mark as any).strokeWidth ?? baseStroke, maxRuleWidth));
            const currentDotSize = (spec.layer[1].mark as any).size ?? dotSize;
            spec.layer[1].mark = setMarkProp(spec.layer[1].mark, 'size',
                Math.min(currentDotSize, maxDotSize));
        }

        // Apply explicit dot size from config (user override wins)
        if (config?.dotSize) {
            spec.layer[1].mark = { ...spec.layer[1].mark, size: config.dotSize };
        }
    },
    properties: [
        { key: "dotSize", label: "Dot Size", type: "continuous", min: 20, max: 300, step: 10, defaultValue: 80 },
    ] as ChartPropertyDef[],
};
