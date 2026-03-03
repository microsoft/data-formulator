// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Strip Plot — scatter with jitter on categorical axis (mirror vegalite/templates/jitter.ts).
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS } from './utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/** Seeded jitter for reproducible strip plot. */
function jitter(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return (s / 0x7fffffff) * 2 - 1;
    };
}

export const ecStripPlotDef: ChartTemplateDef = {
    chart: 'Strip Plot',
    template: { mark: 'circle', encoding: {} },
    channels: ['x', 'y', 'color', 'size', 'column', 'row'],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { defaultStepMultiplier: 2, minStep: 16 },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const xField = xCS?.field;
        const yField = yCS?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField || !yField) return;

        const xIsDiscrete = isDiscrete(xCS?.type);
        const yIsDiscrete = isDiscrete(yCS?.type);
        const catAxis = xIsDiscrete ? 'x' : yIsDiscrete ? 'y' : 'x';
        const contAxis = catAxis === 'x' ? 'y' : 'x';
        const catField = catAxis === 'x' ? xField : yField;
        const contField = contAxis === 'x' ? xField : yField;

        const categories = extractCategories(table, catField!, (catAxis === 'x' ? xCS : yCS)?.ordinalSortOrder);
        const catToIndex = new Map(categories.map((c, i) => [c, i]));
        const jitterWidth = (chartProperties?.stepWidth ?? 20) * 0.8;
        const rand = jitter(42);

        const option: any = {
            tooltip: { trigger: 'item' },
            xAxis: {
                type: 'category',
                data: categories,
                name: catField,
                nameLocation: 'middle',
                nameGap: 30,
            },
            yAxis: {
                type: 'value',
                name: contField,
                nameLocation: 'middle',
                nameGap: 40,
            },
            series: [],
        };

        if (catAxis === 'y') {
            option.xAxis = { type: 'value', name: contField, nameLocation: 'middle', nameGap: 30 };
            option.yAxis = { type: 'category', data: categories, name: catField, nameLocation: 'middle', nameGap: 40 };
        }

        const buildPoint = (row: any) => {
            const cat = String(row[catField!] ?? '');
            const idx = catToIndex.get(cat) ?? 0;
            const offset = rand() * jitterWidth;
            const x = catAxis === 'x' ? idx + offset : row[contField];
            const y = catAxis === 'y' ? idx + offset : row[contField];
            return [x, y];
        };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                option.series.push({
                    name,
                    type: 'scatter',
                    data: rows.map(buildPoint),
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length], opacity: 0.7 },
                    symbolSize: 8,
                });
                colorIdx++;
            }
        } else {
            option.series.push({
                type: 'scatter',
                data: table.map(buildPoint),
                itemStyle: { opacity: 0.7 },
                symbolSize: 8,
            });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
