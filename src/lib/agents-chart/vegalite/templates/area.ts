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

export const areaChartDef: ChartTemplateDef = {
    chart: "Area Chart",
    template: { mark: "area", encoding: {} },
    channels: ["x", "y", "color", "opacity", "column", "row"],
    markCognitiveChannel: 'area',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' } },
    }),
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        const config = ctx.chartProperties;
        applyInterpolate(spec, config);
        if (config) {
            if (config.opacity !== undefined && config.opacity < 1) {
                spec.mark = setMarkProp(spec.mark, 'opacity', config.opacity);
            }
            if (config.stackMode) {
                for (const axis of ['x', 'y'] as const) {
                    if (spec.encoding?.[axis]?.type === 'quantitative' ||
                        spec.encoding?.[axis]?.aggregate) {
                        spec.encoding[axis].stack = config.stackMode === 'layered' ? null : config.stackMode;
                        break;
                    }
                }
            }
        }
    },
    properties: [
        interpolateConfigProperty,
        { key: "opacity", label: "Opacity", type: "continuous", min: 0.1, max: 1, step: 0.05, defaultValue: 0.7 },
        { key: "stackMode", label: "Stack", type: "discrete", options: [
            { value: undefined, label: "Stacked (default)" },
            { value: "normalize", label: "Normalize (100%)" },
            { value: "center", label: "Center" },
            { value: "layered", label: "Layered (overlap)" },
        ] },
    ] as ChartPropertyDef[],
};

export const streamgraphDef: ChartTemplateDef = {
    chart: "Streamgraph",
    template: { mark: "area", encoding: {} },
    channels: ["x", "y", "color", "column", "row"],
    markCognitiveChannel: 'area',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' } },
    }),
    instantiate: (spec, ctx) => {
        defaultBuildEncodings(spec, ctx.resolvedEncodings);
        // Force center stacking on the measure axis
        if (spec.encoding?.y && !spec.encoding.y.stack) {
            spec.encoding.y.stack = "center";
            spec.encoding.y.axis = null;
        } else if (spec.encoding?.x && !spec.encoding.x.stack) {
            spec.encoding.x.stack = "center";
            spec.encoding.x.axis = null;
        }
        applyInterpolate(spec, ctx.chartProperties);
    },
    properties: [interpolateConfigProperty] as ChartPropertyDef[],
};
