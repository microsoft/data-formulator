// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { defaultBuildEncodings, setMarkProp } from './utils';

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

function applyInterpolate(vgSpec: any, config?: Record<string, any>): void {
    if (!config?.interpolate) return;
    vgSpec.mark = setMarkProp(vgSpec.mark, 'interpolate', config.interpolate);
}

export const lineChartDef: ChartTemplateDef = {
    chart: "Line Chart",
    template: { mark: "line", encoding: {} },
    channels: ["x", "y", "color", "opacity", "column", "row"],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' } },
    }),
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        applyInterpolate(spec, ctx.chartProperties);
    },
    properties: [interpolateConfigProperty],
};

export const dottedLineChartDef: ChartTemplateDef = {
    chart: "Dotted Line Chart",
    template: { mark: { type: "line", point: true }, encoding: {} },
    channels: ["x", "y", "color", "column", "row"],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' } },
    }),
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        applyInterpolate(spec, ctx.chartProperties);
    },
    properties: [interpolateConfigProperty],
};
