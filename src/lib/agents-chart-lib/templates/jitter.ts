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
            { key: "pointSize", label: "Size", type: "continuous", min: 5, max: 150, step: 5, defaultValue: 30 },
            { key: "opacity", label: "Opacity", type: "continuous", min: 0.05, max: 1, step: 0.05, defaultValue: 0.6 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>) => {
            const stepWidth = config?.stepWidth ?? 20;
            const pointSize = config?.pointSize ?? 30;
            const opacity = config?.opacity ?? 0.6;

            // Apply mark properties
            if (typeof vgSpec.mark === 'string') {
                vgSpec.mark = { type: vgSpec.mark };
            }
            vgSpec.mark.size = pointSize;
            vgSpec.mark.opacity = opacity;

            // Determine which axis is categorical (the one to jitter along)
            const xType = vgSpec.encoding?.x?.type;
            const yType = vgSpec.encoding?.y?.type;

            // Set step width and derive jitter from it (80% of step)
            const jitterWidth = stepWidth * 0.8;
            if (xType === 'nominal' || xType === 'ordinal') {
                vgSpec.width = { step: stepWidth };
            } else if (yType === 'nominal' || yType === 'ordinal') {
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

                if (xType === 'nominal' || xType === 'ordinal') {
                    vgSpec.encoding.xOffset = offsetEnc;
                } else if (yType === 'nominal' || yType === 'ordinal') {
                    vgSpec.encoding.yOffset = offsetEnc;
                } else {
                    vgSpec.encoding.xOffset = offsetEnc;
                }
            }

            return vgSpec;
        },
    },
];
