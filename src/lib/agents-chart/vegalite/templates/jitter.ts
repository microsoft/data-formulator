// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { defaultBuildEncodings } from './utils';

export const stripPlotDef: ChartTemplateDef = {
    chart: "Strip Plot",
    template: {
        mark: { type: "circle", opacity: 0.7 },
        encoding: {},
    },
    channels: ["x", "y", "color", "size", "column", "row"],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { defaultStepMultiplier: 2, minStep: 16 },
    }),
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);

        const table = ctx.table;
        const canvasSize = ctx.canvasSize;
        const config = ctx.chartProperties;

        const stepWidth = config?.stepWidth ?? 20;
        let pointSize = config?.pointSize ?? 0;
        let opacity = config?.opacity ?? 0;

        // Determine which axis is categorical
        const xType = spec.encoding?.x?.type;
        const yType = spec.encoding?.y?.type;

        const catAxis = (xType === 'nominal' || xType === 'ordinal') ? 'x'
            : (yType === 'nominal' || yType === 'ordinal') ? 'y'
            : null;

        // Count points in the largest categorical group
        let maxGroupCount = table?.length ?? 0;
        if (catAxis && spec.encoding?.[catAxis]?.field && table) {
            const catField = spec.encoding[catAxis].field;
            const groupCounts: Record<string, number> = {};
            for (const row of table) {
                const key = String(row[catField] ?? '');
                groupCounts[key] = (groupCounts[key] || 0) + 1;
            }
            maxGroupCount = Math.max(1, ...Object.values(groupCounts));
        }

        // Continuous axis length
        const contLen = catAxis === 'x'
            ? (canvasSize?.height || 400)
            : (canvasSize?.width || 400);

        const areaBudget = stepWidth * contLen;
        const targetCoverage = 0.35;

        // Auto-compute size
        if (pointSize === 0) {
            const idealSize = (targetCoverage * areaBudget) / maxGroupCount;
            pointSize = Math.max(5, Math.min(100, Math.round(idealSize)));
        }

        // Auto-compute opacity
        if (opacity === 0) {
            const density = (maxGroupCount * pointSize) / areaBudget;
            if (density < 0.2) {
                opacity = 0.8;
            } else if (density < 0.5) {
                opacity = 0.6;
            } else if (density < 1) {
                opacity = 0.4;
            } else {
                opacity = Math.max(0.1, 0.3 / density);
            }
            opacity = Math.round(opacity * 20) / 20;
        }

        // Apply mark properties
        if (typeof spec.mark === 'string') {
            spec.mark = { type: spec.mark };
        }
        spec.mark.size = pointSize;
        spec.mark.opacity = opacity;

        // Set step width and derive jitter
        const jitterWidth = stepWidth * 0.8;
        if (catAxis === 'x') {
            spec.width = { step: stepWidth };
        } else if (catAxis === 'y') {
            spec.height = { step: stepWidth };
        }

        if (jitterWidth > 0) {
            if (!spec.transform) spec.transform = [];
            spec.transform.push({
                calculate: `${-jitterWidth / 2} + random() * ${jitterWidth}`,
                as: "__jitter",
            });

            const offsetEnc = {
                field: "__jitter",
                type: "quantitative",
                axis: null,
                scale: { domain: [-stepWidth / 2, stepWidth / 2] },
            };

            if (catAxis === 'x') {
                spec.encoding.xOffset = offsetEnc;
            } else if (catAxis === 'y') {
                spec.encoding.yOffset = offsetEnc;
            } else {
                spec.encoding.xOffset = offsetEnc;
            }
        }
    },
    properties: [
        { key: "stepWidth", label: "Jitter", type: "continuous", min: 10, max: 100, step: 5, defaultValue: 20 },
        { key: "pointSize", label: "Size", type: "continuous", min: 0, max: 150, step: 5, defaultValue: 0 },
        { key: "opacity", label: "Opacity", type: "continuous", min: 0, max: 1, step: 0.05, defaultValue: 0 },
    ] as ChartPropertyDef[],
};
