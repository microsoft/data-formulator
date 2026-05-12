// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish Area Chart template.
 *
 * Official GoFish area chart pattern:
 *   layer([
 *     chart(data).flow(spread(x, {dir:"x", spacing})).mark(scaffold({h:y}).name("points")),
 *     chart(select("points")).mark(area({opacity: 0.8})),
 *   ])
 *
 * Multi-series (stacked area) also needs group() — marked TODO.
 */

import { ChartTemplateDef } from '../../core/types';
import { detectAxes } from './utils';

export const gfAreaChartDef: ChartTemplateDef = {
    chart: 'Area Chart',
    template: { mark: 'area', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'area',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' }, facetAspectRatioResistance: 0.5 },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, layout, canvasSize } = ctx;
        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
        const colorField = channelSemantics.color?.field;

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const isHorizontal = categoryAxis === 'y';
        const spreadDir = isHorizontal ? 'y' : 'x';

        const catCount = new Set(table.map((r: any) => r[catField])).size;
        const canvasW = isHorizontal
            ? (layout?.subplotHeight ?? canvasSize.height)
            : (layout?.subplotWidth ?? canvasSize.width);
        const spacing = Math.max(10, Math.round(canvasW / Math.max(1, catCount)));

        if (colorField) {
            // Stacked/layered area: spread + stack + scaffold({h, fill}).name + group + area
            // Pattern from official GoFish stacked-area-chart example.
            spec._gofish = {
                type: 'area-multi',
                data: table,
                layers: [
                    {
                        flow: [
                            {
                                op: 'spread',
                                field: catField,
                                options: { dir: spreadDir, spacing },
                            },
                            {
                                op: 'stack',
                                field: colorField,
                                options: { dir: isHorizontal ? 'x' : 'y', label: false },
                            },
                        ],
                        mark: {
                            shape: 'scaffold',
                            options: isHorizontal
                                ? { w: valField, fill: colorField }
                                : { h: valField, fill: colorField },
                            name: 'bars',
                        },
                    },
                    {
                        select: 'bars',
                        flow: [{ op: 'group', field: colorField }],
                        mark: { shape: 'area', options: { opacity: 0.8 } },
                    },
                ],
            };
        } else {
            // Single-series area: spread + scaffold + select + area
            spec._gofish = {
                type: 'area',
                data: table,
                layers: [
                    {
                        flow: [{
                            op: 'spread',
                            field: catField,
                            options: { dir: spreadDir, spacing },
                        }],
                        mark: {
                            shape: 'scaffold',
                            options: isHorizontal
                                ? { w: valField }
                                : { h: valField },
                            name: 'points',
                        },
                    },
                    {
                        select: 'points',
                        flow: [],
                        mark: { shape: 'area', options: { opacity: 0.8 } },
                    },
                ],
            };
        }

        delete spec.mark;
        delete spec.encoding;
    },
};
