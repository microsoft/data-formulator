// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish Scatter Pie template.
 *
 * Scatter-positioned pie charts.  Each (x, y) location shows a small pie
 * chart whose slices are coloured by `color` and sized by `angle`.
 *
 * GoFish pattern:
 *   chart(scatterData)
 *     .flow(scatter("_key", { x: "_x", y: "_y" }))
 *     .mark((data) =>
 *       chart(data[0].collection, { coord: clock() })
 *         .flow(stack(colorField, { dir: "x", h: pieSize }))
 *         .mark(rect({ w: angleField, fill: colorField }))
 *     )
 *
 * Channels: x (position), y (position), color (category), angle (value).
 */

import { ChartTemplateDef } from '../../core/types';

export const gfScatterPieChartDef: ChartTemplateDef = {
    chart: 'Scatter Pie Chart',
    template: { mark: 'arc', encoding: {} },
    channels: ['x', 'y', 'color', 'angle'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const xField = channelSemantics.x?.field;
        const yField = channelSemantics.y?.field;
        const colorField = channelSemantics.color?.field;
        const angleField = channelSemantics.angle?.field
            || channelSemantics.size?.field;   // fallback to size channel

        if (!xField || !yField || !colorField) return;

        // -----------------------------------------------------------------
        // Restructure flat table into scatter-of-pies data.
        //
        // Input rows: { x: 10, y: 20, cat: "A", val: 5 }, ...
        // Output:
        //   [{ _key:"10|20", _x:10, _y:20,
        //      collection: [{cat:"A",val:5}, {cat:"B",val:3}] }, …]
        // -----------------------------------------------------------------

        const positionMap = new Map<string, {
            _x: any;
            _y: any;
            collection: Record<string, any>[];
        }>();

        for (const row of table) {
            const xv = row[xField];
            const yv = row[yField];
            const key = `${xv}|${yv}`;

            if (!positionMap.has(key)) {
                positionMap.set(key, { _x: xv, _y: yv, collection: [] });
            }

            const entry: Record<string, any> = { [colorField]: row[colorField] };
            if (angleField) entry[angleField] = row[angleField];
            positionMap.get(key)!.collection.push(entry);
        }

        const scatterData = Array.from(positionMap.entries()).map(
            ([key, val]) => ({
                _key: key,
                _x: val._x,
                _y: val._y,
                collection: val.collection,
            }),
        );

        // Determine measure field for slice width
        const measureField = angleField || '_count';

        // If no angle field, add counts per category in each collection
        if (!angleField) {
            for (const pt of scatterData) {
                const counts = new Map<string, number>();
                for (const item of pt.collection) {
                    const cat = String(item[colorField] ?? '');
                    counts.set(cat, (counts.get(cat) ?? 0) + 1);
                }
                pt.collection = Array.from(counts.entries()).map(
                    ([cat, cnt]) => ({ [colorField]: cat, _count: cnt }),
                );
            }
        }

        // Pie radius — reasonable default relative to chart size
        const pieSize = 20;

        spec._gofish = {
            type: 'scatterpie',
            data: scatterData,
            flow: [{
                op: 'scatter',
                field: '_key',
                options: { x: '_x', y: '_y' },
            }],
            mark: {
                shape: 'scatterpie',
                options: {
                    colorField,
                    angleField: measureField,
                    pieSize,
                },
            },
        };

        delete spec.mark;
        delete spec.encoding;
    },
    properties: [],
};
