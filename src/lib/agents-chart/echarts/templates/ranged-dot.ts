// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Ranged Dot Plot — line segments + points (mirror vegalite/templates/scatter.ts rangedDotPlotDef).
 * Expects x (e.g. category), y (value); optional color. Renders as line + scatter.
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS, getCategoryOrder } from './utils';

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
        const yIsDiscrete = isDiscrete(channelSemantics.y?.type);
        const xCategories = xIsDiscrete ? extractCategories(table, xField, channelSemantics.x?.ordinalSortOrder) : undefined;
        const yCategories = yIsDiscrete ? extractCategories(table, yField, getCategoryOrder(ctx, 'y')) : undefined;
        const yIndexMap = yCategories ? new Map(yCategories.map((c, i) => [c, i])) : null;

        const option: any = {
            tooltip: { trigger: 'item' },
            xAxis: {
                type: xIsDiscrete ? 'category' : 'value',
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
                ...(xCategories ? { data: xCategories } : {}),
            },
            yAxis: yIsDiscrete && yCategories
                ? {
                    type: 'category',
                    data: yCategories,
                    name: yField,
                    nameLocation: 'middle',
                    nameGap: 40,
                    axisTick: { show: true, alignWithLabel: true },
                    axisLabel: { rotate: 0 },
                }
                : { type: 'value', name: yField, nameLocation: 'middle', nameGap: 40 },
            series: [],
        };

        const pointForRow = (r: any): [number, number] | [any, string] => {
            if (yIndexMap != null) {
                const yi = yIndexMap.get(String(r[yField] ?? ''));
                if (yi === undefined) return [Number(r[xField]), 0];
                return [Number(r[xField]), yi];
            }
            return [r[xField], r[yField]];
        };

        if (colorField) {
            const groups = groupBy(table, colorField);
            const colorCategories = [...groups.keys()];
            option.legend = { data: colorCategories };
            option._legendTitle = colorField;

            // One line series: each y-category gets one segment from min(x) to max(x) (e.g. Min–Max per country). Use null between segments.
            if (yCategories && yIndexMap) {
                const segmentData: Array<[number, number] | null> = [];
                for (let i = 0; i < yCategories.length; i++) {
                    const yCat = yCategories[i];
                    const rows = table.filter((r: any) => String(r[yField] ?? '') === yCat);
                    if (xIsDiscrete && xCategories) {
                        const indices = rows.map((r: any) => xCategories.indexOf(String(r[xField] ?? ''))).filter((idx: number) => idx >= 0);
                        if (indices.length >= 1) {
                            const minXi = Math.min(...indices);
                            const maxXi = Math.max(...indices);
                            segmentData.push([minXi, i], [maxXi, i], null);
                        }
                    } else {
                        const vals = rows.map((r: any) => Number(r[xField])).filter((v: number) => isFinite(v));
                        if (vals.length >= 1) {
                            const minX = Math.min(...vals);
                            const maxX = Math.max(...vals);
                            segmentData.push([minX, i], [maxX, i], null);
                        }
                    }
                }
                if (segmentData.length > 0) {
                    segmentData.pop(); // remove trailing null
                    option.series.push({
                        name: '', // no legend entry for connector line
                        type: 'line',
                        data: segmentData,
                        showSymbol: false,
                        itemStyle: { color: '#999' },
                        lineStyle: { color: '#999' },
                    });
                }
            }

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const scatterData = xIsDiscrete
                    ? xCategories!.map((cat, xi) => {
                        const row = rows.find((r: any) => String(r[xField]) === cat);
                        if (!row) return null;
                        return yIndexMap ? [xi, yIndexMap.get(String(row[yField] ?? '')) ?? 0] : [xi, row[yField]];
                    }).filter(Boolean)
                    : (yCategories && yIndexMap
                        ? [...rows].sort((a, b) => (yIndexMap.get(String(a[yField])) ?? 0) - (yIndexMap.get(String(b[yField])) ?? 0)).map((r: any) => pointForRow(r))
                        : rows.map((r: any) => [r[xField], r[yField]]));
                option.series.push({
                    name,
                    type: 'scatter',
                    data: scatterData,
                    symbolSize: 8,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }
        } else {
            const lineData = xIsDiscrete
                ? xCategories!.map((cat, xi) => {
                    const row = table.find((r: any) => String(r[xField]) === cat);
                    if (!row) return null;
                    return yIndexMap ? [xi, yIndexMap.get(String(row[yField] ?? '')) ?? 0] : [xi, row[yField]];
                })
                : (yCategories
                    ? [...table].sort((a, b) => (yIndexMap!.get(String(a[yField])) ?? 0) - (yIndexMap!.get(String(b[yField])) ?? 0)).map((r: any) => pointForRow(r))
                    : table.map((r: any) => [r[xField], r[yField]]));
            const scatterData = xIsDiscrete
                ? (yIndexMap ? lineData : xCategories!.map((cat, i) => [cat, (lineData as any[])[i]]))
                : lineData;
            option.series.push({ type: 'line', data: lineData, showSymbol: false });
            option.series.push({ type: 'scatter', data: scatterData, symbolSize: 8 });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
