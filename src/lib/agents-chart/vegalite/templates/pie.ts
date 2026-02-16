// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
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
    },
    properties: [
        { key: "innerRadius", label: "Donut", type: "continuous", min: 0, max: 100, step: 5, defaultValue: 0 },
    ] as ChartPropertyDef[],
};
