// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef } from '../../core/types';
import { defaultBuildEncodings } from './utils';

export const customPointDef: ChartTemplateDef = {
    chart: "Custom Point",
    template: { mark: "point", encoding: {} },
    channels: ["x", "y", "color", "opacity", "size", "shape", "column", "row"],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => defaultBuildEncodings(spec, ctx.resolvedEncodings),
};

export const customLineDef: ChartTemplateDef = {
    chart: "Custom Line",
    template: { mark: "line", encoding: {} },
    channels: ["x", "y", "color", "opacity", "detail", "column", "row"],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => defaultBuildEncodings(spec, ctx.resolvedEncodings),
};

export const customBarDef: ChartTemplateDef = {
    chart: "Custom Bar",
    template: { mark: "bar", encoding: {} },
    channels: ["x", "y", "color", "opacity", "size", "shape", "column", "row"],
    markCognitiveChannel: 'length',
    instantiate: (spec, ctx) => defaultBuildEncodings(spec, ctx.resolvedEncodings),
};

export const customRectDef: ChartTemplateDef = {
    chart: "Custom Rect",
    template: { mark: "rect", encoding: {} },
    channels: ["x", "y", "x2", "y2", "color", "opacity", "column", "row"],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => defaultBuildEncodings(spec, ctx.resolvedEncodings),
};

export const customAreaDef: ChartTemplateDef = {
    chart: "Custom Area",
    template: { mark: "area", encoding: {} },
    channels: ["x", "y", "x2", "y2", "color", "column", "row"],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => defaultBuildEncodings(spec, ctx.resolvedEncodings),
};
