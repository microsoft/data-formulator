// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Area Chart template (single + multi-series, stacked / layered).
 *
 * Contrast with VL:
 *   VL: mark = "area" with encoding; stacking via y.stack property
 *   EC: line series with areaStyle; stacking via series[].stack property
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, groupBy, getCategoryOrder } from './utils';
import { getPaletteForScheme } from '../colormap';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/** True if all category labels parse as numbers → horizontal; otherwise vertical (x-axis only). */
function areCategoriesNumeric(cats: string[]): boolean {
    if (cats.length === 0) return true;
    return cats.every((c) => {
        const s = String(c).trim();
        if (s === '') return false;
        const n = Number(s);
        return !isNaN(n) && isFinite(n);
    });
}

export const ecAreaChartDef: ChartTemplateDef = {
    chart: 'Area Chart',
    template: { mark: 'area', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'area',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' } },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const colorField = channelSemantics.color?.field;
        const colorType = channelSemantics.color?.type;

        if (!xCS?.field || !yCS?.field) return;
        const xField = xCS.field;
        const yField = yCS.field;

        const xIsDiscrete = isDiscrete(xCS.type);
        const xIsTemporal = xCS.type === 'temporal';
        const yIsDiscrete = isDiscrete(yCS.type);
        const isContinuousColor = !!colorField && (colorType === 'quantitative' || colorType === 'temporal');
        const categories = xIsDiscrete
            ? extractCategories(table, xField, getCategoryOrder(ctx, 'x'))
            : undefined;
        const yCategories = yIsDiscrete ? extractCategories(table, yField, getCategoryOrder(ctx, 'y')) : undefined;

        const option: any = {
            tooltip: { trigger: 'axis' },
            xAxis: (() => {
                const type = xIsDiscrete ? 'category' : xIsTemporal ? 'time' : 'value';
                const base: any = {
                    type,
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 30,
                    boundaryGap: xIsDiscrete,
                    ...(categories ? { data: categories } : {}),
                };
                if (xIsDiscrete && categories) {
                    base.axisTick = { show: true, alignWithLabel: true };
                    base.axisLabel = { rotate: areCategoriesNumeric(categories) ? 0 : 90 };
                } else if (xIsTemporal) {
                    base.axisTick = { show: true, alignWithLabel: true };
                    base.axisLabel = { rotate: 90 };
                } else {
                    base.axisTick = { show: true };
                    base.axisLabel = { rotate: 0 };
                }
                return base;
            })(),
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
                : {
                    type: 'value',
                    name: yField,
                    nameLocation: 'middle',
                    nameGap: 40,
                    axisTick: { show: true },
                    axisLabel: { rotate: 0 },
                },
            series: [],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: xField, valueLabel: yField };

        // ECharts: scale=true means "data-fit", scale=false means "include zero"
        if (channelSemantics.y?.zero) {
            option.yAxis.scale = !channelSemantics.y.zero.zero;
        }

        // Stack / layer mode
        const stackMode = chartProperties?.stackMode;
        const stackGroup = stackMode === 'layered' ? undefined : 'total';

        // Opacity
        const opacity = chartProperties?.opacity ?? 0.7;

        // Interpolation / smooth
        const interpolate = chartProperties?.interpolate;
        const smooth = interpolate === 'monotone' || interpolate === 'basis' ||
            interpolate === 'cardinal' || interpolate === 'catmull-rom';
        const step = interpolate === 'step' ? 'middle'
            : interpolate === 'step-before' ? 'start'
                : interpolate === 'step-after' ? 'end'
                    : undefined;

        if (isContinuousColor && colorField) {
            // Continuous color (Quantity/Date): single area + colored points with continuous visualMap (mirror VL layer: area + point).
            const sorted = [...table].sort((a: any, b: any) => {
                const ax = a[xField];
                const bx = b[xField];
                if (xIsTemporal) return new Date(ax).getTime() - new Date(bx).getTime();
                const na = Number(ax);
                const nb = Number(bx);
                if (!isNaN(na) && !isNaN(nb)) return na - nb;
                return String(ax).localeCompare(String(bx));
            });

            const pointData = sorted.map((r: any) => [r[xField], r[yField], r[colorField]]);
            const lineData = sorted.map((r: any) => [r[xField], r[yField]]);

            const nums = sorted
                .map((r: any) => Number(r[colorField]))
                .filter((v: number) => !isNaN(v) && isFinite(v));
            const cMin = nums.length ? Math.min(...nums) : 0;
            const cMax = nums.length ? Math.max(...nums) : 1;

            option.tooltip = { trigger: 'item' };
            option._encodingTooltip = {
                trigger: 'item',
                parts: [
                    { from: 'data', index: 0, label: xField, format: xIsTemporal ? 'temporal' : 'number', temporalFormat: channelSemantics.x?.temporalFormat ?? '%b %d, %Y' },
                    { from: 'data', index: 1, label: yField, format: 'number' },
                    { from: 'data', index: 2, label: colorField, format: colorType === 'temporal' ? 'temporal' : 'number', temporalFormat: channelSemantics.color?.temporalFormat ?? '%b %d, %Y' },
                ],
            };

            const decisionSchemeId = colorDecisions?.color?.schemeId;
            const paletteFromDecision = decisionSchemeId ? getPaletteForScheme(decisionSchemeId) : undefined;

            option.visualMap = {
                type: 'continuous',
                min: cMin,
                max: cMax,
                dimension: 2,
                orient: 'vertical',
                right: 10,
                top: 'center',
                inRange: {
                    color: paletteFromDecision && paletteFromDecision.length > 0
                        ? paletteFromDecision
                        : ['#f7fcf5', '#74c476', '#00441b'],
                },
                seriesIndex: 1,
                name: colorField,
                textStyle: { fontSize: 10 },
                calculable: true,
            };
            option._visualMapWidth = 70;
            option.graphic = [
                ...(Array.isArray(option.graphic) ? option.graphic : (option.graphic ? [option.graphic] : [])),
                {
                    type: 'text' as const,
                    right: 10,
                    top: 4,
                    z: 100,
                    style: {
                        text: colorField,
                        fontSize: 11,
                        fontWeight: 'bold',
                        fill: '#333',
                        textAlign: 'right',
                    },
                },
            ];

            option.series.push({
                type: 'line',
                data: lineData,
                showSymbol: false,
                symbol: 'none',
                areaStyle: { opacity },
                itemStyle: { color: '#999' },
                lineStyle: { color: '#999' },
                ...(smooth ? { smooth: true } : {}),
                ...(step ? { step } : {}),
            });
            option.series.push({
                type: 'scatter',
                data: pointData,
                symbol: 'circle',
                symbolSize: 8,
                itemStyle: { opacity: 1 },
            });
        } else if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };

            // ECharts stacking only works correctly with category x-axis (stacks by index).
            // For stacked + continuous (value) x + value y: use category axis with sorted unique x as labels,
            // and value-aligned y arrays. Skip when y is category (e.g. x=Quantity, y=Step) — keep [x,y] pairs.
            const useValueAlignedStack =
                stackGroup && !xIsDiscrete && !xIsTemporal && !yIsDiscrete;
            const sortedX = useValueAlignedStack ? getSortedUniqueXValues(table, xField) : undefined;

            if (useValueAlignedStack && sortedX && sortedX.length > 0) {
                option.xAxis = {
                    type: 'category',
                    data: sortedX,
                    boundaryGap: false,
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 30,
                    axisLabel: { rotate: 0 },
                };
            }

            // For temporal x with stacking, align all series to the same timeline so stack indices match.
            const sortedDates = xIsTemporal ? getSortedUniqueDates(table, xField) : undefined;

            for (const [name, rows] of groups) {
                const seriesData = xIsDiscrete
                    ? buildCategoryAlignedData(rows, xField, yField, categories!)
                    : useValueAlignedStack && sortedX
                        ? buildValueAlignedYData(rows, xField, yField, sortedX)
                        : sortedDates
                            ? buildTimeAlignedData(rows, xField, yField, sortedDates)
                            : rows.map(r => [r[xField], r[yField]]);

                const series: any = {
                    name,
                    type: 'line',
                    data: seriesData,
                    showSymbol: false,
                    symbol: 'none',
                    areaStyle: { opacity },
                    // 颜色由 ecApplyLayoutToSpec 根据 colorDecisions 统一分配
                };
                if (stackGroup) series.stack = stackGroup;
                if (smooth) series.smooth = true;
                if (step) series.step = step;

                option.series.push(series);
            }
        } else {
            const seriesData =
                yIsDiscrete && yCategories
                    ? buildCategoryAlignedXYData(table, xField, yField, yCategories)
                    : xIsDiscrete
                        ? categories!.map(cat => {
                            const row = table.find(r => String(r[xField]) === cat);
                            return row ? row[yField] : null;
                        })
                        : xIsTemporal
                            ? (() => {
                                const sorted = [...table].sort((a, b) => new Date(a[xField]).getTime() - new Date(b[xField]).getTime());
                                return sorted.map(r => [r[xField], r[yField]]);
                            })()
                            : table.map(r => [r[xField], r[yField]]);

            const series: any = {
                type: 'line',
                data: seriesData,
                showSymbol: false,
                symbol: 'none',
                areaStyle: { opacity },
            };
            if (smooth) series.smooth = true;
            if (step) series.step = step;
            option.series.push(series);
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        {
            key: 'interpolate', label: 'Curve', type: 'discrete', options: [
                { value: undefined, label: 'Default (linear)' },
                { value: 'linear', label: 'Linear' },
                { value: 'monotone', label: 'Monotone (smooth)' },
                { value: 'step', label: 'Step' },
                { value: 'step-before', label: 'Step Before' },
                { value: 'step-after', label: 'Step After' },
            ],
        } as ChartPropertyDef,
        { key: 'opacity', label: 'Opacity', type: 'continuous', min: 0.1, max: 1, step: 0.05, defaultValue: 0.7 } as ChartPropertyDef,
        {
            key: 'stackMode', label: 'Stack', type: 'discrete', options: [
                { value: undefined, label: 'Stacked (default)' },
                { value: 'normalize', label: 'Normalize (100%)' },
                { value: 'center', label: 'Center' },
                { value: 'layered', label: 'Layered (overlap)' },
            ],
        } as ChartPropertyDef,
    ],
};

/** Align series data to category array, returning y values by category position. */
function buildCategoryAlignedData(
    rows: any[],
    xField: string,
    yField: string,
    categories: string[],
): (number | null)[] {
    const map = new Map<string, number>();
    for (const row of rows) {
        map.set(String(row[xField]), row[yField]);
    }
    return categories.map(cat => map.get(cat) ?? null);
}

/** For y-category axis (x numeric, y discrete): output [x, yCategory] pairs in y category order. */
function buildCategoryAlignedXYData(
    rows: any[],
    xField: string,
    yField: string,
    yCategories: string[],
): Array<[any, string]> {
    const map = new Map<string, any>();
    for (const row of rows) {
        const key = String(row[yField] ?? '');
        if (!map.has(key)) {
            map.set(key, row[xField]);
        }
    }
    return yCategories
        .filter((cat) => map.has(cat))
        .map((cat) => [map.get(cat), cat] as [any, string]);
}

/** Collect sorted unique dates (as ISO strings) from table for temporal x. */
function getSortedUniqueDates(table: any[], xField: string): string[] {
    const set = new Set<string>();
    for (const row of table) {
        const v = row[xField];
        if (v != null && v !== '') set.add(String(v));
    }
    return [...set].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

/** Collect sorted unique numeric x values for value-aligned stacking (category x + y arrays). */
function getSortedUniqueXValues(table: any[], xField: string): number[] {
    const set = new Set<number>();
    for (const row of table) {
        const v = row[xField];
        if (v == null || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
}

/** Build y-only array aligned to sorted x for one series; missing x get y=0. Used with category xAxis.data. */
function buildValueAlignedYData(
    rows: any[],
    xField: string,
    yField: string,
    sortedX: number[],
): number[] {
    const map = new Map<number, number>();
    for (const row of rows) {
        const x = Number(row[xField]);
        const y = Number(row[yField]);
        if (!Number.isFinite(x)) continue;
        map.set(x, Number.isFinite(y) ? y : 0);
    }
    return sortedX.map(x => map.get(x) ?? 0);
}

/** Build time-aligned [date, value] data for one series so stacking matches across series. Missing dates get y=0. */
function buildTimeAlignedData(
    rows: any[],
    xField: string,
    yField: string,
    sortedDates: string[],
): Array<[string, number]> {
    const map = new Map<string, number>();
    for (const row of rows) {
        const n = Number(row[yField]);
        map.set(String(row[xField]), Number.isFinite(n) ? n : 0);
    }
    return sortedDates.map(d => [d, map.get(d) ?? 0]);
}
