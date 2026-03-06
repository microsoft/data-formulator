// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Pyramid Chart — horizontal bar symmetric (mirror vegalite/templates/bar.ts pyramidChartDef).
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories } from './utils';

export const ecPyramidChartDef: ChartTemplateDef = {
    chart: 'Pyramid Chart',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'y', 'color'],
    markCognitiveChannel: 'length',
    declareLayoutMode: () => ({ axisFlags: { y: { banded: true } } }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const xField = xCS?.field;
        const yField = yCS?.field;
        if (!xField || !yField) return;

        const yDiscrete = yCS?.type === 'nominal' || yCS?.type === 'ordinal';
        const catField = yDiscrete ? yField : xField;
        const valField = yDiscrete ? xField : yField;

        const categories = extractCategories(table, catField, yCS?.ordinalSortOrder);
        const valueMap = new Map<string, number>();
        for (const row of table) {
            const cat = String(row[catField] ?? '');
            const v = row[valField];
            if (v != null && !isNaN(v)) valueMap.set(cat, (valueMap.get(cat) ?? 0) + Number(v));
        }
        const values = categories.map(cat => valueMap.get(cat) ?? 0);

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: {
                type: 'value',
                name: valField,
                axisTick: { show: true },
                axisLabel: { formatter: (v: number) => Math.abs(v).toString() },
            },
            yAxis: { type: 'category', data: categories, name: catField, axisTick: { show: true, alignWithLabel: true } },
            series: [
                { type: 'bar', data: values.map(v => -v), itemStyle: { color: '#4e79a7' }, barGap: '-100%' },
                { type: 'bar', data: values, itemStyle: { color: '#e15759' } },
            ],
        };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
