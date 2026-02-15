// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { defaultBuildEncodings } from './utils';

export const pieChartDef: ChartTemplateDef = {
        chart: "Pie Chart",
        template: {
            mark: "arc",
            encoding: {},
        },
        channels: ["theta", "color", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            defaultBuildEncodings(spec, encodings, context);

            const config = context.chartProperties;
            if (config) {
                const innerRadius = config.innerRadius;
                if (innerRadius !== undefined && innerRadius > 0) {
                    if (typeof spec.mark === 'string') {
                        spec.mark = { type: spec.mark, innerRadius };
                    } else {
                        spec.mark = { ...spec.mark, innerRadius };
                    }
                }
            }
        },
        properties: [
            { key: "innerRadius", label: "Donut", type: "continuous", min: 0, max: 100, step: 5, defaultValue: 0 },
        ] as ChartPropertyDef[],
};
