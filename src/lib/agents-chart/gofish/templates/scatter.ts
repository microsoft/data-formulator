// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish Scatter Plot template.
 *
 * GoFish approach:
 *   chart(data).flow(scatter(field, { x: xField, y: yField })).mark(circle({ r: N }))
 */

import { ChartTemplateDef } from '../../core/types';

export const gfScatterPlotDef: ChartTemplateDef = {
    chart: 'Scatter Plot',
    template: { mark: 'circle', encoding: {} },
    channels: ['x', 'y', 'color', 'size', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const xField = channelSemantics.x?.field;
        const yField = channelSemantics.y?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField || !yField) return;

        // For GoFish scatter, we need a unique id per row.
        const dataWithId = table.map((row, i) => ({ ...row, _gf_id: `p${i}` }));

        // GoFish circle({fill}) only accepts literal CSS colors, not data fields.
        // For data-driven color, use rect({fill: field}) with small fixed size,
        // matching how stacked/grouped bar use rect({fill}) for data-driven fill.
        const markShape = colorField ? 'rect' : 'circle';
        const markOptions: Record<string, any> = colorField
            ? { w: 8, h: 8, fill: colorField }
            : { r: 5 };

        spec._gofish = {
            type: 'scatter',
            data: dataWithId,
            flow: [{
                op: 'scatter',
                field: '_gf_id',
                options: { x: xField, y: yField },
            }],
            mark: {
                shape: markShape,
                options: markOptions,
            },
        };

        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'opacity', label: 'Opacity', type: 'continuous', min: 0.1, max: 1, step: 0.05, defaultValue: 1 },
    ],
};
