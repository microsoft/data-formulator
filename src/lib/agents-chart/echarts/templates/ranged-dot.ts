// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Ranged Dot Plot — line segments + points (mirror vegalite/templates/scatter.ts rangedDotPlotDef).
 * Expects x (e.g. category), y (value); optional color. Renders as line + scatter.
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS } from './utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

export const ecRangedDotPlotDef: ChartTemplateDef = {
    chart: 'Ranged Dot Plot',
    template: { mark: 'line', encoding: {} },
    channels: ['x', 'y', 'color'],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const xField = channelSemantics.x?.field;
        const yField = channelSemantics.y?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField || !yField) return;

        const xIsDiscrete = isDiscrete(channelSemantics.x?.type);
        const categories = xIsDiscrete ? extractCategories(table, xField, channelSemantics.x?.ordinalSortOrder) : undefined;

        const option: any = {
            tooltip: { trigger: 'item' },
            xAxis: {
                type: xIsDiscrete ? 'category' : 'value',
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
                ...(categories ? { data: categories } : {}),
            },
            yAxis: { type: 'value', name: yField, nameLocation: 'middle', nameGap: 40 },
            series: [],
        };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const lineData = xIsDiscrete
                    ? categories!.map(cat => {
                        const row = rows.find((r: any) => String(r[xField]) === cat);
                        return row ? row[yField] : null;
                    })
                    : rows.map((r: any) => [r[xField], r[yField]]);
                const scatterData = xIsDiscrete
                    ? categories!.map((cat, i) => [cat, lineData[i]])
                    : lineData;
                option.series.push({ name, type: 'line', data: lineData, showSymbol: false, itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] } });
                option.series.push({ name: `${name} pts`, type: 'scatter', data: scatterData, symbolSize: 8, itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] } });
                colorIdx++;
            }
        } else {
            const lineData = xIsDiscrete
                ? categories!.map(cat => {
                    const row = table.find((r: any) => String(r[xField]) === cat);
                    return row ? row[yField] : null;
                })
                : table.map((r: any) => [r[xField], r[yField]]);
            const scatterData = xIsDiscrete
                ? categories!.map((cat, i) => [cat, lineData[i]])
                : lineData;
            option.series.push({ type: 'line', data: lineData, showSymbol: false });
            option.series.push({ type: 'scatter', data: scatterData, symbolSize: 8 });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
