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
            { key: "jitterWidth", label: "Jitter", type: "continuous", min: 0, max: 50, step: 1, defaultValue: 20 },
            { key: "pointSize", label: "Size", type: "continuous", min: 5, max: 150, step: 5, defaultValue: 30 },
            { key: "opacity", label: "Opacity", type: "continuous", min: 0.05, max: 1, step: 0.05, defaultValue: 0.6 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>) => {
            const jitterWidth = config?.jitterWidth ?? 20;
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

            if (jitterWidth > 0) {
                // Add a jitter transform: calculate a random offset
                if (!vgSpec.transform) vgSpec.transform = [];
                vgSpec.transform.push({
                    calculate: `${-jitterWidth / 2} + random() * ${jitterWidth}`,
                    as: "__jitter",
                });

                if (xType === 'nominal' || xType === 'ordinal') {
                    // Categorical on x → jitter along x via xOffset
                    vgSpec.encoding.xOffset = {
                        field: "__jitter",
                        type: "quantitative",
                        axis: null,
                        scale: { domain: [-jitterWidth, jitterWidth] },
                    };
                } else if (yType === 'nominal' || yType === 'ordinal') {
                    // Categorical on y → jitter along y via yOffset
                    vgSpec.encoding.yOffset = {
                        field: "__jitter",
                        type: "quantitative",
                        axis: null,
                        scale: { domain: [-jitterWidth, jitterWidth] },
                    };
                } else {
                    // Both quantitative: jitter on x by default
                    vgSpec.encoding.xOffset = {
                        field: "__jitter",
                        type: "quantitative",
                        axis: null,
                        scale: { domain: [-jitterWidth, jitterWidth] },
                    };
                }
            }

            return vgSpec;
        },
    },
];
