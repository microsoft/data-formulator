// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { defaultBuildEncodings } from './utils';

export const pieCharts: ChartTemplateDef[] = [
    {
        chart: "Pie Chart",
        template: {
            mark: "arc",
            encoding: {},
        },
        channels: ["theta", "color", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [
            { key: "innerRadius", label: "Donut", type: "continuous", min: 0, max: 100, step: 5, defaultValue: 0 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            if (!config) return vgSpec;
            const innerRadius = config.innerRadius;
            if (innerRadius !== undefined && innerRadius > 0) {
                if (typeof vgSpec.mark === 'string') {
                    vgSpec.mark = { type: vgSpec.mark, innerRadius };
                } else {
                    vgSpec.mark = { ...vgSpec.mark, innerRadius };
                }
            }
            return vgSpec;
        },
    },
];
