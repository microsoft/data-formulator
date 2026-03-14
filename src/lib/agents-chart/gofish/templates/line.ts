// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish Line Chart template.
 *
 * Official GoFish line chart pattern:
 *   layer([
 *     chart(data).flow(scatter(key, {x, y})).mark(scaffold().name("points")),
 *     chart(select("points")).mark(line()),
 *   ])
 *
 * For categorical x-axis we use spread() instead of scatter().
 * Multi-series (color) requires group() which needs layer naming — marked TODO.
 */

import { ChartTemplateDef } from '../../core/types';
import { detectAxes } from './utils';

export const gfLineChartDef: ChartTemplateDef = {
    chart: 'Line Chart',
    template: { mark: 'line', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'position',
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
            // Multi-series line: spread + scaffold({h, fill}).name + group + line
            // scaffold(options).name() works because configured marks have .name().
            spec._gofish = {
                type: 'line-multi',
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
                                ? { w: valField, fill: colorField }
                                : { h: valField, fill: colorField },
                            name: 'points',
                        },
                    },
                    {
                        select: 'points',
                        flow: [{ op: 'group', field: colorField }],
                        mark: { shape: 'line' },
                    },
                ],
            };
        } else {
            // Single-series line: spread + scaffold + select + line
            spec._gofish = {
                type: 'line',
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
                        mark: { shape: 'line' },
                    },
                ],
            };
        }

        delete spec.mark;
        delete spec.encoding;
    },
};
