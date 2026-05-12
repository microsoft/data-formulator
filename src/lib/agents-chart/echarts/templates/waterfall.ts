// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Waterfall Chart — cumulative bar with start/delta/end (mirror vegalite/templates/waterfall.ts).
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories } from './utils';

/** True if all category labels parse as numbers → horizontal; else vertical (align with line/bar). */
function areCategoriesNumeric(cats: string[]): boolean {
    if (cats.length === 0) return true;
    return cats.every((c) => {
        const s = String(c).trim();
        if (s === '') return false;
        const n = Number(s);
        return !isNaN(n) && isFinite(n);
    });
}

export const ecWaterfallChartDef: ChartTemplateDef = {
    chart: 'Waterfall Chart',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'y', 'color', 'column', 'row'],
    markCognitiveChannel: 'length',
    declareLayoutMode: () => ({ axisFlags: { x: { banded: true } } }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const xField = channelSemantics.x?.field || 'Category';
        const yField = channelSemantics.y?.field || 'Amount';
        const colorField = channelSemantics.color?.field;

        const categories = extractCategories(table, xField, undefined);
        const rows = categories.map(cat => table.find((r: any) => String(r[xField]) === cat)).filter(Boolean);
        const values = rows.map((r: any) => Number(r[yField]) || 0);

        const hasTypeCol = !!colorField;
        let types: string[];
        if (hasTypeCol) {
            types = rows.map((r: any) => String(r[colorField] ?? 'delta'));
        } else {
            types = values.map((_, i) => i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'delta');
        }

        let running = 0;
        const baseData: number[] = [];
        const deltaData: number[] = [];
        const colors: string[] = [];
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            const t = types[i];
            if (t === 'start') {
                baseData.push(0);
                deltaData.push(v);
                running = v;
                colors.push('#5470c6');
            } else if (t === 'end') {
                baseData.push(running);
                deltaData.push(v);
                colors.push('#5470c6');
            } else {
                baseData.push(running);
                running += v;
                deltaData.push(v);
                colors.push(v >= 0 ? '#91cc75' : '#ee6666');
            }
        }

        const legendItems = ['Start/End', 'Increase', 'Decrease'];
        const legendColors = ['#5470c6', '#91cc75', '#ee6666'];

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: {
                data: legendItems,
            },
            xAxis: {
                type: 'category',
                data: categories,
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
                axisTick: { show: true, alignWithLabel: true },
                axisLabel: {
                    rotate: areCategoriesNumeric(categories) ? 0 : 90,
                    formatter: (value: string, index: number) => {
                        const t = types[index];
                        return t === 'start' || t === 'end' ? '' : value;
                    },
                },
            },
            yAxis: { type: 'value', name: yField, axisTick: { show: true } },
            series: [
                { type: 'bar', name: '_base', data: baseData, stack: 'wf', itemStyle: { color: 'transparent' } },
                {
                    type: 'bar',
                    name: 'Delta',
                    data: deltaData,
                    stack: 'wf',
                    itemStyle: { color: (params: any) => colors[params.dataIndex] },
                },
                // Legend-only series: no data, only for legend color/symbol
                ...legendItems.map((name, i) => ({
                    type: 'bar' as const,
                    name,
                    data: [] as number[],
                    itemStyle: { color: legendColors[i] },
                })),
            ],
        };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
