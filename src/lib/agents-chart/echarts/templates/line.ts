// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Line Chart template (supports multi-series).
 *
 * Contrast with VL:
 *   VL: encoding.x + encoding.y + encoding.color → auto-groups into separate lines
 *   EC: explicit series[] with each series.data = [v1, v2, ...] aligned to xAxis.data
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS, getCategoryOrder } from './utils';

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

const interpolateMap: Record<string, string> = {
    'linear': 'linear',       // default
    'monotone': 'monotone',   // ECharts smooth: true approximates this
    'step': 'step',
    'step-before': 'stepBefore',   // Not directly supported; mapped
    'step-after': 'stepAfter',     // Not directly supported; mapped
    'basis': 'smooth',
    'cardinal': 'smooth',
    'catmull-rom': 'smooth',
};

export const ecLineChartDef: ChartTemplateDef = {
    chart: 'Line Chart',
    template: { mark: 'line', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' } },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const colorField = channelSemantics.color?.field;
        const colorType = channelSemantics.color?.type;

        if (!xCS?.field || !yCS?.field) return;
        const xField = xCS.field;
        const yField = yCS.field;

        // Determine x-axis type
        const xIsDiscrete = isDiscrete(xCS.type);
        const xIsTemporal = xCS.type === 'temporal';
        const yIsDiscrete = isDiscrete(yCS.type);
        const isContinuousColor = !!colorField && (colorType === 'quantitative' || colorType === 'temporal');

        // Build x-axis categories for discrete/temporal axes
        const categories = xIsDiscrete ? extractCategories(table, xField, getCategoryOrder(ctx, 'x')) : undefined;
        const yCategories = yIsDiscrete ? extractCategories(table, yField, getCategoryOrder(ctx, 'y')) : undefined;

        const option: any = {
            tooltip: {
                trigger: 'axis',
            },
            xAxis: (() => {
                const type = xIsDiscrete ? 'category' : xIsTemporal ? 'time' : 'value';
                const base: any = {
                    type,
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 30,
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
        // Default: axis tooltip for standard line charts.
        // When color is continuous (Quantity/Date), we switch to item tooltip to support per-point color values.
        option._encodingTooltip = isContinuousColor
            ? {
                trigger: 'item',
                parts: [
                    { from: 'data', index: 0, label: xField, format: 'number' },
                    { from: 'data', index: 1, label: yField, format: 'number' },
                    { from: 'data', index: 2, label: colorField, format: 'number' },
                ],
            }
            : { trigger: 'axis', categoryLabel: xField, valueLabel: yField };

        // Apply zero-baseline
        // ECharts: scale=true means "data-fit", scale=false means "include zero"
        if (channelSemantics.y?.zero) {
            option.yAxis.scale = !channelSemantics.y.zero.zero;
        }

        // Interpolation / smooth
        const interpolate = chartProperties?.interpolate;
        const smooth = interpolate === 'monotone' || interpolate === 'basis' ||
                        interpolate === 'cardinal' || interpolate === 'catmull-rom';
        const step = interpolate === 'step' ? 'middle'
                   : interpolate === 'step-before' ? 'start'
                   : interpolate === 'step-after' ? 'end'
                   : undefined;

        if (isContinuousColor && colorField) {
            // Continuous color (Quantity/Date): single line + colored points with a continuous visualMap.
            // This mirrors Vega-Lite's common pattern: gray line + colored points.
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

            // VisualMap domain
            const nums = sorted
                .map((r: any) => Number(r[colorField]))
                .filter((v: number) => !isNaN(v) && isFinite(v));
            const cMin = nums.length ? Math.min(...nums) : 0;
            const cMax = nums.length ? Math.max(...nums) : 1;

            option.visualMap = {
                type: 'continuous',
                min: cMin,
                max: cMax,
                dimension: 2, // [x, y, color]
                orient: 'vertical',
                right: 10,
                top: 'center',
                // Greens (matches VL example); can be overridden later via chartProperties if needed.
                inRange: { color: ['#f7fcf5', '#74c476', '#00441b'] },
                seriesIndex: 1, // apply to point series
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
                itemStyle: { color: '#cccccc' },
                lineStyle: { color: '#cccccc' },
                showSymbol: false,
                symbol: 'none',
                ...(smooth ? { smooth: true } : {}),
                ...(step ? { step } : {}),
            });
            option.series.push({
                type: 'scatter',
                data: pointData,
                symbol: 'circle',
                symbolSize: 7,
                itemStyle: { opacity: 1 },
            });
        } else if (colorField && isDiscrete(colorType)) {
            // Multi-series line chart
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const seriesData =
                    yIsDiscrete && yCategories
                        ? buildCategoryAlignedXYData(rows, xField, yField, yCategories)
                        : xIsDiscrete
                            ? buildCategoryAlignedData(rows, xField, yField, categories!)
                            : rows.map(r => [r[xField], r[yField]]);

                const series: any = {
                    name,
                    type: 'line',
                    data: seriesData,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                    // Default line chart: don't draw point markers.
                    showSymbol: false,
                    symbol: 'none',
                };
                if (smooth) series.smooth = true;
                if (step) series.step = step;

                option.series.push(series);
                colorIdx++;
            }
        } else {
            // Single series
            const seriesData =
                yIsDiscrete && yCategories
                    ? buildCategoryAlignedXYData(table, xField, yField, yCategories)
                    : xIsDiscrete
                        ? categories!.map(cat => {
                            const row = table.find(r => String(r[xField]) === cat);
                            return row ? row[yField] : null;
                        })
                        : table.map(r => [r[xField], r[yField]]);

            const series: any = {
                type: 'line',
                data: seriesData,
                // Default line chart: don't draw point markers.
                showSymbol: false,
                symbol: 'none',
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
    ],
};

/**
 * For category-axis line charts, align series data to the shared category array.
 * Returns an array of y-values (or null) indexed by category position.
 * Optional yTransform applies to non-null values (e.g. rank inversion for Bump chart).
 */
function buildCategoryAlignedData(
    rows: any[],
    xField: string,
    yField: string,
    categories: string[],
    yTransform?: (y: number) => number,
): (number | null)[] {
    const map = new Map<string, number>();
    for (const row of rows) {
        const v = row[yField];
        if (v != null && !isNaN(Number(v))) map.set(String(row[xField]), Number(v));
    }
    return categories.map(cat => {
        const v = map.get(cat);
        return v != null ? (yTransform ? yTransform(v) : v) : null;
    });
}

/**
 * For y-category axis line charts (x is numeric/time, y is discrete),
 * align points by y category order and output [x, yCategory] pairs.
 */
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

/** RANK_SEMANTIC_TYPES: used to detect rank axis for Bump Chart (mirror vegalite/templates/bump.ts). */
const RANK_SEMANTIC_TYPES = new Set(['Rank', 'Index', 'Score', 'Rating', 'Level']);

/**
 * Dotted Line Chart — same as Line Chart with showSymbol and dashed line (mirror vegalite Dotted Line).
 */
export const ecDottedLineChartDef: ChartTemplateDef = {
    chart: 'Dotted Line Chart',
    template: { mark: 'line', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' } },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const colorField = channelSemantics.color?.field;

        if (!xCS?.field || !yCS?.field) return;
        const xField = xCS.field;
        const yField = yCS.field;

        const xIsDiscrete = isDiscrete(xCS.type);
        const xIsTemporal = xCS.type === 'temporal';
        const categories = xIsDiscrete ? extractCategories(table, xField, getCategoryOrder(ctx, 'x')) : undefined;

        const option: any = {
            tooltip: { trigger: 'axis' },
            xAxis: (() => {
                const type = xIsDiscrete ? 'category' : xIsTemporal ? 'time' : 'value';
                const base: any = {
                    type,
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 30,
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
                }
                return base;
            })(),
            yAxis: {
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

        if (channelSemantics.y?.zero) {
            option.yAxis.scale = !channelSemantics.y.zero.zero;
        }

        const interpolate = chartProperties?.interpolate;
        const smooth = interpolate === 'monotone' || interpolate === 'basis' ||
                        interpolate === 'cardinal' || interpolate === 'catmull-rom';

        const baseSeriesOpt = {
            showSymbol: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { type: 'dashed' as const },
            smooth: !!smooth,
        };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const seriesData = xIsDiscrete
                    ? buildCategoryAlignedData(rows, xField, yField, categories!)
                    : rows.map(r => [r[xField], r[yField]]);
                option.series.push({
                    name,
                    type: 'line',
                    data: seriesData,
                    ...baseSeriesOpt,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }
        } else {
            const seriesData = xIsDiscrete
                ? categories!.map(cat => {
                    const row = table.find(r => String(r[xField]) === cat);
                    return row ? row[yField] : null;
                })
                : table.map(r => [r[xField], r[yField]]);
            option.series.push({ type: 'line', data: seriesData, ...baseSeriesOpt });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};

/**
 * Bump Chart — line with points, rank axis reversed when y is rank-like (mirror vegalite/templates/bump.ts).
 * Use yAxis as category with data ['1','2',...,'maxRank'] and inverse: true so rank 1 is at top without
 * using value-axis inverse (which in ECharts moves the x-axis to the top). Series y values are category
 * indices (rank - 1). All serializable — no formatter needed.
 */
export const ecBumpChartDef: ChartTemplateDef = {
    chart: 'Bump Chart',
    template: { mark: 'line', encoding: {} },
    channels: ['x', 'y', 'color', 'detail', 'column', 'row'],
    markCognitiveChannel: 'position',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 80, y: 20, seriesCountAxis: 'auto' } },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, semanticTypes } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const colorField = channelSemantics.color?.field;

        if (!xCS?.field || !yCS?.field) return;
        const xField = xCS.field;
        const yField = yCS.field;

        const ySemType = semanticTypes?.[yField] || '';
        const xSemType = semanticTypes?.[xField] || '';
        const yIsRank = RANK_SEMANTIC_TYPES.has(ySemType);
        const xIsRank = RANK_SEMANTIC_TYPES.has(xSemType);
        const rankOnY = yIsRank && !xIsRank;
        const rankOnX = xIsRank && !yIsRank;

        const xIsDiscrete = isDiscrete(xCS.type);
        const xIsTemporal = xCS.type === 'temporal';
        const categories = xIsDiscrete ? extractCategories(table, xField, getCategoryOrder(ctx, 'x')) : undefined;

        const rankValues = table.map((r: any) => Number(r[yField])).filter((v: number) => !isNaN(v) && isFinite(v));
        const maxRank = rankValues.length ? Math.max(...rankValues) : 1;
        const rankCategories = Array.from({ length: maxRank }, (_, i) => String(i + 1));
        const rankToIndex = (rank: number) => Math.max(0, Math.min(maxRank - 1, Math.round(rank) - 1));

        const toXValue = (v: any): number | string => {
            if (v == null) return NaN;
            if (xIsTemporal) return typeof v === 'number' ? v : new Date(String(v)).getTime();
            const n = Number(v);
            return isNaN(n) ? String(v) : n;
        };
        const sortRowsByX = (rows: any[]) =>
            [...rows].sort((a, b) => {
                const ax = toXValue(a[xField]);
                const bx = toXValue(b[xField]);
                if (typeof ax === 'number' && typeof bx === 'number') return ax - bx;
                return String(ax).localeCompare(String(bx));
            });

        const option: any = {
            tooltip: { trigger: 'axis' },
            xAxis: (() => {
                const type = xIsDiscrete ? 'category' : xIsTemporal ? 'time' : 'value';
                const base: any = {
                    type,
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 30,
                    axisLine: { show: true },
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
                }
                return base;
            })(),
            yAxis: rankOnY
                ? {
                    type: 'category',
                    data: rankCategories,
                    inverse: true,
                    name: yField,
                    nameLocation: 'middle',
                    nameGap: 40,
                    axisLabel: { rotate: 0 },
                    axisTick: { show: true, alignWithLabel: true },
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
        if (rankOnY) {
            option.tooltip = {
                trigger: 'axis',
                formatter: (params: any) => {
                    const list = Array.isArray(params) ? params : [params];
                    if (list.length === 0) return '';
                    const p = list[0];
                    const cat = p.axisValue ?? p.name ?? '';
                    let html = `<b>${cat}</b><br/>`;
                    list.forEach((item: any) => {
                        const idx = item.value != null ? Number(item.value) : null;
                        const displayRank = idx != null && Number.isInteger(idx) ? String(idx + 1) : '–';
                        html += `${item.marker} ${item.seriesName}: ${displayRank}<br/>`;
                    });
                    return html;
                },
            };
        } else {
            option._encodingTooltip = { trigger: 'axis', categoryLabel: xField, valueLabel: yField };
        }

        const baseSeriesOpt = { showSymbol: true, symbolSize: 6, smooth: true };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const orderedRows = xIsDiscrete ? rows : sortRowsByX(rows);
                const seriesData = xIsDiscrete
                    ? buildCategoryAlignedData(rows, xField, yField, categories!, rankOnY ? rankToIndex : undefined)
                    : orderedRows.map(r => [toXValue(r[xField]), rankOnY ? rankToIndex(Number(r[yField])) : r[yField]]);
                option.series.push({
                    name,
                    type: 'line',
                    data: seriesData,
                    ...baseSeriesOpt,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }
        } else {
            const rows = xIsDiscrete ? table : sortRowsByX(table);
            const seriesData = xIsDiscrete
                ? buildCategoryAlignedData(rows, xField, yField, categories!, rankOnY ? rankToIndex : undefined)
                : rows.map(r => [toXValue(r[xField]), rankOnY ? rankToIndex(Number(r[yField])) : r[yField]]);
            option.series.push({ type: 'line', data: seriesData, ...baseSeriesOpt });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
