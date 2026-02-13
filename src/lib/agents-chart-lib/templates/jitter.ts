// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { defaultBuildEncodings } from './utils';

export const jitterCharts: ChartTemplateDef[] = [
    {
        chart: "Strip Plot",
        template: {
            mark: { type: "circle", opacity: 0.7 },
            encoding: {},
        },
        channels: ["x", "y", "color", "size", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [
            { key: "stepWidth", label: "Jitter", type: "continuous", min: 10, max: 100, step: 5, defaultValue: 20 },
            { key: "pointSize", label: "Size", type: "continuous", min: 0, max: 150, step: 5, defaultValue: 0 },
            { key: "opacity", label: "Opacity", type: "continuous", min: 0, max: 1, step: 0.05, defaultValue: 0 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>, canvasSize?: { width: number; height: number }) => {
            const stepWidth = config?.stepWidth ?? 20;
            let pointSize = config?.pointSize ?? 0;
            let opacity = config?.opacity ?? 0;

            // Determine which axis is categorical (the one to jitter along)
            const xType = vgSpec.encoding?.x?.type;
            const yType = vgSpec.encoding?.y?.type;

            const catAxis = (xType === 'nominal' || xType === 'ordinal') ? 'x'
                : (yType === 'nominal' || yType === 'ordinal') ? 'y'
                : null;

            // Count points in the largest categorical group
            let maxGroupCount = table.length;
            if (catAxis && vgSpec.encoding?.[catAxis]?.field) {
                const catField = vgSpec.encoding[catAxis].field;
                const groupCounts: Record<string, number> = {};
                for (const row of table) {
                    const key = String(row[catField] ?? '');
                    groupCounts[key] = (groupCounts[key] || 0) + 1;
                }
                maxGroupCount = Math.max(1, ...Object.values(groupCounts));
            }

            // Continuous axis length (the non-jitter dimension)
            const contLen = catAxis === 'x'
                ? (canvasSize?.height || 400)
                : (canvasSize?.width || 400);

            // Area budget per group = stepWidth × contLen
            // Each point is roughly a circle of area = pointSize (VL size = area in px²)
            // Target coverage ≈ 30-50% of area
            const areaBudget = stepWidth * contLen;
            const targetCoverage = 0.35;

            // Auto-compute size: solve for size such that N * size ≈ coverage * area
            if (pointSize === 0) {
                const idealSize = (targetCoverage * areaBudget) / maxGroupCount;
                pointSize = Math.max(5, Math.min(100, Math.round(idealSize)));
            }

            // Auto-compute opacity: more points → more transparent
            if (opacity === 0) {
                // density = fraction of area covered if fully opaque
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
                opacity = Math.round(opacity * 20) / 20; // snap to 0.05
            }

            // Apply mark properties
            if (typeof vgSpec.mark === 'string') {
                vgSpec.mark = { type: vgSpec.mark };
            }
            vgSpec.mark.size = pointSize;
            vgSpec.mark.opacity = opacity;

            // Set step width and derive jitter from it (80% of step)
            const jitterWidth = stepWidth * 0.8;
            if (catAxis === 'x') {
                vgSpec.width = { step: stepWidth };
            } else if (catAxis === 'y') {
                vgSpec.height = { step: stepWidth };
            }

            if (jitterWidth > 0) {
                if (!vgSpec.transform) vgSpec.transform = [];
                vgSpec.transform.push({
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
                    vgSpec.encoding.xOffset = offsetEnc;
                } else if (catAxis === 'y') {
                    vgSpec.encoding.yOffset = offsetEnc;
                } else {
                    vgSpec.encoding.xOffset = offsetEnc;
                }
            }

            return vgSpec;
        },
    },
];
