// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Lollipop Chart — rule from 0 to value + dot at end (mirror vegalite/templates/lollipop.ts).
 * Vega-Lite: rule strokeWidth 1.5、圆 size 80；茎黑色，圆点用图例色。
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS, getCategoryOrder } from './utils';
import { detectAxes } from './utils';
import { detectBandedAxisFromSemantics } from '../../vegalite/templates/utils';

/** Vega-Lite 风格：茎（rule）黑色、细线，圆点与 color 图例一致 */
const STEM_COLOR = '#000000';
/** 茎线宽度，对应 VL rule strokeWidth: 1.5 */
const STEM_WIDTH_PX = 1.5;
/** 圆点直径约 10px，对应 VL circle size: 80（面积量级） */
const DOT_SIZE_BASE = 10;

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
        const colorField = channelSemantics.color?.field;
        const categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis) ?? catCS?.ordinalSortOrder);

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
        const dotSizeConfig = chartProperties?.dotSize ?? 80;
        const symbolSizePx = Math.max(6, Math.min(DOT_SIZE_BASE + (dotSizeConfig - 80) / 40, 16));

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
                    barWidth: STEM_WIDTH_PX,
                    itemStyle: { color: STEM_COLOR },
                },
            ],
        };

        // Tooltip：只展示圆点（scatter）的值，不展示茎（bar）
        option.tooltip = option.tooltip ?? {};
        option._encodingTooltip = {
            trigger: 'axis',
            categoryLabel: catField,
            valueLabel: valField,
            // 由 buildEncodingTooltipFormatter 只保留 seriesType === 'scatter' 的条目
            filterScatterOnly: true,
        };

        if (colorField) {
            const groups = groupBy(table, colorField);
            const colorOrder = getCategoryOrder(ctx, 'color');
            const legendKeys = colorOrder && colorOrder.length > 0
                ? colorOrder.filter((k: string) => groups.has(k))
                : [...groups.keys()];
            if (legendKeys.length > 0) {
                option.legend = { data: legendKeys };
                option._legendTitle = colorField;
            }
            for (const name of legendKeys) {
                const rows = groups.get(name) ?? [];
                const scatterData = rows
                    .filter((r: any) => {
                        const v = r[valField];
                        return v != null && !isNaN(Number(v));
                    })
                    .map((r: any) => {
                        const cat = String(r[catField] ?? '');
                        const v = Number(r[valField]);
                        return isHorizontal ? [v, cat] : [cat, v];
                    });
                option.series.push({
                    name,
                    type: 'scatter',
                    data: scatterData,
                    symbolSize: symbolSizePx,
                    itemStyle: { borderColor: '#fff', borderWidth: 1 },
                    z: 2,
                });
            }
        } else {
            option.series.push({
                type: 'scatter',
                data: categories.map((cat, i) => {
                    const v = values[i];
                    return isHorizontal ? [v, cat] : [cat, v];
                }),
                symbolSize: symbolSizePx,
                itemStyle: { color: DEFAULT_COLORS[0], borderColor: '#fff', borderWidth: 1 },
                z: 2,
            });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'dotSize', label: 'Dot Size', type: 'continuous', min: 20, max: 300, step: 10, defaultValue: 80 },
    ] as ChartPropertyDef[],
};
