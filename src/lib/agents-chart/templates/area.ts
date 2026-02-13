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

export const areaChartDef: ChartTemplateDef = {
        chart: "Area Chart",
        template: {
            mark: "area",
            encoding: {},
        },
        channels: ["x", "y", "color", "opacity", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [
            interpolateConfigProperty,
            { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 0.7 },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            vgSpec = applyInterpolate(vgSpec, config);
            if (config) {
                const opacity = config.opacity;
                if (opacity !== undefined && opacity < 1) {
                    if (typeof vgSpec.mark === 'string') {
                        vgSpec.mark = { type: vgSpec.mark, opacity };
                    } else {
                        vgSpec.mark = { ...vgSpec.mark, opacity };
                    }
                }
            }
            return vgSpec;
        },
};

export const streamgraphDef: ChartTemplateDef = {
        chart: "Streamgraph",
        template: {
            mark: "area",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: defaultBuildEncodings,
        properties: [interpolateConfigProperty] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, _table: any[], config?: Record<string, any>) => {
            // Force center stacking on the measure axis
            if (vgSpec.encoding?.y && !vgSpec.encoding.y.stack) {
                vgSpec.encoding.y.stack = "center";
                vgSpec.encoding.y.axis = null;
            } else if (vgSpec.encoding?.x && !vgSpec.encoding.x.stack) {
                vgSpec.encoding.x.stack = "center";
                vgSpec.encoding.x.axis = null;
            }
            return applyInterpolate(vgSpec, config);
        },
};
