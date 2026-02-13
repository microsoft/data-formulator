// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';
import { defaultBuildEncodings } from './utils';

const interpolateConfigProperty: ChartPropertyDef = {
    key: "interpolate", label: "Curve", type: "discrete", options: [
        { value: undefined, label: "Default (linear)" },
        { value: "linear", label: "Linear" },
        { value: "monotone", label: "Monotone (smooth)" },
        { value: "step", label: "Step" },
        { value: "step-before", label: "Step Before" },
        { value: "step-after", label: "Step After" },
        { value: "basis", label: "Basis (smooth)" },
        { value: "cardinal", label: "Cardinal" },
        { value: "catmull-rom", label: "Catmull-Rom" },
    ],
};

function applyInterpolate(vgSpec: any, config?: Record<string, any>): any {
    if (!config?.interpolate) return vgSpec;
    if (typeof vgSpec.mark === 'string') {
        vgSpec.mark = { type: vgSpec.mark, interpolate: config.interpolate };
    } else {
        vgSpec.mark = { ...vgSpec.mark, interpolate: config.interpolate };
    }
    return vgSpec;
}

export const lineChartDef: ChartTemplateDef = {
        chart: "Line Chart",
        template: {
            mark: "line",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [interpolateConfigProperty],
        postProcessor: (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            return applyInterpolate(vgSpec, config);
        },
};

export const dottedLineChartDef: ChartTemplateDef = {
        chart: "Dotted Line Chart",
        template: {
            mark: { type: "line", point: true },
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [interpolateConfigProperty],
        postProcessor: (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            return applyInterpolate(vgSpec, config);
        },
};
