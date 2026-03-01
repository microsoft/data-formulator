// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Lollipop Chart — rule from 0 to value + dot at end (mirror vegalite/templates/lollipop.ts).
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, DEFAULT_COLORS } from './utils';
import { detectAxes } from './utils';
import { detectBandedAxisFromSemantics } from '../../vegalite/templates/utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/** True if all category labels parse as numbers → horizontal labels; otherwise vertical (align with line chart). */
function areCategoriesNumeric(cats: string[]): boolean {
    if (cats.length === 0) return true;
    return cats.every((c) => {
        const s = String(c).trim();
        if (s === '') return false;
        const n = Number(s);
        return !isNaN(n) && isFinite(n);
    });
}

export const ecLollipopChartDef: ChartTemplateDef = {
    chart: 'Lollipop Chart',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'y', 'color', 'column', 'row'],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: 'x' });
        return {
            axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
        };
    },
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const catCS = channelSemantics[categoryAxis];
        const categories = extractCategories(table, catField, catCS?.ordinalSortOrder);

        const valueMap = new Map<string, number>();
        for (const row of table) {
            const cat = String(row[catField] ?? '');
            const val = row[valField];
            if (val != null && !isNaN(val)) {
                valueMap.set(cat, (valueMap.get(cat) ?? 0) + Number(val));
            }
        }
        const values = categories.map(cat => valueMap.get(cat) ?? null);

        const isHorizontal = categoryAxis === 'y';
        const dotSize = chartProperties?.dotSize ?? 80;
        const barWidth = Math.max(2, Math.min(8, dotSize / 10));

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: isHorizontal
                ? {
                    type: 'value',
                    name: valField,
                    nameLocation: 'middle',
                    nameGap: 30,
                    axisTick: { show: true },
                    axisLabel: { rotate: 0 },
                }
                : {
                    type: 'category',
                    data: categories,
                    name: catField,
                    nameLocation: 'middle',
                    nameGap: 30,
                    axisTick: { show: true, alignWithLabel: true },
                    axisLabel: { rotate: areCategoriesNumeric(categories) ? 0 : 90 },
                },
            yAxis: isHorizontal
                ? {
                    type: 'category',
                    data: categories,
                    name: catField,
                    nameLocation: 'middle',
                    nameGap: 40,
                    axisTick: { show: true, alignWithLabel: true },
                    axisLabel: { rotate: 0 },
                }
                : {
                    type: 'value',
                    name: valField,
                    nameLocation: 'middle',
                    nameGap: 40,
                    axisTick: { show: true },
                    axisLabel: { rotate: 0 },
                },
            series: [
                {
                    type: 'bar',
                    data: values,
                    barWidth,
                    itemStyle: { color: '#5470c6' },
                },
                {
                    type: 'scatter',
                    data: categories.map((cat, i) => {
                        const v = values[i];
                        return isHorizontal ? [v, cat] : [cat, v];
                    }),
                    symbolSize: Math.min(20, dotSize / 4),
                    itemStyle: { color: '#5470c6', borderColor: '#fff', borderWidth: 1 },
                    z: 2,
                },
            ],
        };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'dotSize', label: 'Dot Size', type: 'continuous', min: 20, max: 300, step: 10, defaultValue: 80 },
    ] as ChartPropertyDef[],
};
