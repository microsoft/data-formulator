// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';

const mapProjections = [
    { value: "mercator", label: "Mercator" },
    { value: "equalEarth", label: "Equal Earth" },
    { value: "orthographic", label: "Orthographic (Globe)" },
    { value: "stereographic", label: "Stereographic" },
    { value: "conicEqualArea", label: "Conic Equal Area" },
    { value: "conicEquidistant", label: "Conic Equidistant" },
    { value: "azimuthalEquidistant", label: "Azimuthal Equidistant" },
    { value: "mollweide", label: "Mollweide" },
    { value: "albersUsa", label: "Albers USA" },
] as const;

const projectionCenterPresets: { label: string; center: [number, number] }[] = [
    { label: "World (Atlantic)", center: [0, 0] },
    { label: "World (Pacific)", center: [150, 0] },
    { label: "China", center: [105, 35] },
    { label: "USA", center: [-98, 39] },
    { label: "Europe", center: [10, 50] },
    { label: "Japan", center: [138, 36] },
    { label: "India", center: [78, 22] },
    { label: "Brazil", center: [-52, -14] },
    { label: "Australia", center: [134, -25] },
    { label: "Russia", center: [100, 60] },
    { label: "Africa", center: [20, 0] },
    { label: "Middle East", center: [45, 28] },
    { label: "Southeast Asia", center: [115, 5] },
    { label: "South America", center: [-60, -15] },
    { label: "North America", center: [-100, 45] },
    { label: "UK", center: [-2, 54] },
    { label: "Germany", center: [10, 51] },
    { label: "France", center: [2, 47] },
    { label: "Korea", center: [128, 36] },
];

export const usMapDef: ChartTemplateDef = {
    chart: "US Map",
    template: {
        width: 500,
        height: 300,
        layer: [
            {
                data: {
                    url: "https://vega.github.io/vega-lite/data/us-10m.json",
                    format: { type: "topojson", feature: "states" },
                },
                projection: { type: "albersUsa" },
                mark: { type: "geoshape", fill: "lightgray", stroke: "white" },
            },
            {
                projection: { type: "albersUsa" },
                mark: "circle",
                encoding: { longitude: {}, latitude: {}, size: {}, color: {} },
            },
        ],
    },
    channels: ["longitude", "latitude", "color", "size"],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        if (!spec.layer[1].encoding) spec.layer[1].encoding = {};
        for (const [ch, enc] of Object.entries(ctx.resolvedEncodings)) {
            spec.layer[1].encoding[ch] = { ...(spec.layer[1].encoding[ch] || {}), ...enc };
        }
    },
    properties: [] as ChartPropertyDef[],
};

export const worldMapDef: ChartTemplateDef = {
    chart: "World Map",
    template: {
        width: 600,
        height: 350,
        layer: [
            {
                data: {
                    url: "https://vega.github.io/vega-lite/data/world-110m.json",
                    format: { type: "topojson", feature: "countries" },
                },
                projection: { type: "equalEarth" },
                mark: { type: "geoshape", fill: "lightgray", stroke: "white" },
            },
            {
                projection: { type: "equalEarth" },
                mark: "circle",
                encoding: { longitude: {}, latitude: {}, size: {}, color: {}, opacity: {} },
            },
        ],
    },
    channels: ["longitude", "latitude", "color", "size", "opacity"],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        if (!spec.layer[1].encoding) spec.layer[1].encoding = {};
        for (const [ch, enc] of Object.entries(ctx.resolvedEncodings)) {
            spec.layer[1].encoding[ch] = { ...(spec.layer[1].encoding[ch] || {}), ...enc };
        }

        const config = ctx.chartProperties;
        if (config) {
            const projection = config.projection;
            const projectionCenter = config.projectionCenter;
            const applyProjection = (obj: any) => {
                if (obj?.projection) {
                    if (projection && projection !== 'default') {
                        obj.projection.type = projection;
                    }
                    if (projectionCenter && obj.projection.type !== 'albersUsa') {
                        obj.projection.rotate = [-projectionCenter[0], -projectionCenter[1], 0];
                    }
                }
            };
            if (spec.layer && Array.isArray(spec.layer)) {
                for (const layer of spec.layer) applyProjection(layer);
            }
            applyProjection(spec);
        }
    },
    properties: [
        {
            key: "projection",
            label: "Projection",
            type: "discrete",
            options: [
                { value: "default", label: "Default" },
                ...mapProjections.map(p => ({ value: p.value, label: p.label })),
            ],
            defaultValue: "default",
        },
        {
            key: "projectionCenter",
            label: "Center",
            type: "discrete",
            options: [
                { value: undefined, label: "Default" },
                ...projectionCenterPresets.map(p => ({
                    value: p.center,
                    label: `${p.label} [${p.center[0]}, ${p.center[1]}]`,
                })),
            ],
            defaultValue: undefined,
        },
    ] as ChartPropertyDef[],
};
