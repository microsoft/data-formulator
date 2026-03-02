// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish Pie Chart template.
 *
 * GoFish uses spread with polar coordinate transform for pie.
 * However the basic approach is:
 *   chart(data).flow(stack(catField, { dir: "y" }))
 *     .mark(rect({ h: valField, fill: catField }))
 * with a clock() coordinate transform on the layer.
 *
 * For simplicity in V1, we'll use spread + rect in polar space.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, aggregateByCategory } from './utils';

export const gfPieChartDef: ChartTemplateDef = {
    chart: 'Pie Chart',
    template: { mark: 'arc', encoding: {} },
    channels: ['size', 'color', 'column', 'row'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const colorField = channelSemantics.color?.field;
        const sizeField = channelSemantics.size?.field;

        if (!colorField && !sizeField) return;

        const catField = colorField || sizeField!;
        const valField = sizeField || colorField!;

        const categories = extractCategories(table, catField, channelSemantics.color?.ordinalSortOrder);

        let pieData: any[];
        if (sizeField && colorField && sizeField !== colorField) {
            // color = category, size = measure
            const aggData = aggregateByCategory(table, catField, valField, categories);
            pieData = aggData.map(d => ({ [catField]: d.category, [valField]: d.value }));
        } else if (colorField && !sizeField) {
            // Count occurrences per category
            const counts = new Map<string, number>();
            for (const row of table) {
                const cat = String(row[catField] ?? '');
                counts.set(cat, (counts.get(cat) ?? 0) + 1);
            }
            pieData = categories.map(cat => ({
                [catField]: cat,
                _count: counts.get(cat) ?? 0,
            }));
        } else {
            pieData = table;
        }

        const measureField = (sizeField && colorField && sizeField !== colorField)
            ? valField
            : (sizeField || '_count');

        spec._gofish = {
            type: 'pie',
            data: pieData,
            coord: 'clock',
            flow: [{
                op: 'stack',
                field: catField,
                options: { dir: 'x' },
            }],
            mark: {
                shape: 'rect',
                options: {
                    w: measureField,
                    fill: catField,
                },
            },
        };

        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'innerRadius', label: 'Donut', type: 'continuous', min: 0, max: 60, step: 5, defaultValue: 0 } as ChartPropertyDef,
    ],
};
