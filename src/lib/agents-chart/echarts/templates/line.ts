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

        if (!xCS?.field || !yCS?.field) return;
        const xField = xCS.field;
        const yField = yCS.field;

        // Determine x-axis type
        const xIsDiscrete = isDiscrete(xCS.type);
        const xIsTemporal = xCS.type === 'temporal';

        // Build x-axis categories for discrete/temporal axes
        const categories = xIsDiscrete ? extractCategories(table, xField, getCategoryOrder(ctx, 'x')) : undefined;

        const option: any = {
            tooltip: {
                trigger: 'axis',
            },
            xAxis: {
                type: xIsDiscrete ? 'category' : xIsTemporal ? 'time' : 'value',
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
                ...(categories ? { data: categories } : {}),
            },
            yAxis: {
                type: 'value',
                name: yField,
                nameLocation: 'middle',
                nameGap: 40,
            },
            series: [],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: xField, valueLabel: yField };

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

        if (colorField) {
            // Multi-series line chart
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const seriesData = xIsDiscrete
                    ? buildCategoryAlignedData(rows, xField, yField, categories!)
                    : rows.map(r => [r[xField], r[yField]]);

                const series: any = {
                    name,
                    type: 'line',
                    data: seriesData,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                };
                if (smooth) series.smooth = true;
                if (step) series.step = step;

                option.series.push(series);
                colorIdx++;
            }
        } else {
            // Single series
            const seriesData = xIsDiscrete
                ? categories!.map(cat => {
                    const row = table.find(r => String(r[xField]) === cat);
                    return row ? row[yField] : null;
                })
                : table.map(r => [r[xField], r[yField]]);

            const series: any = { type: 'line', data: seriesData };
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
 */
function buildCategoryAlignedData(
    rows: any[],
    xField: string,
    yField: string,
    categories: string[],
): (number | null)[] {
    // Build a map: category → y value
    const map = new Map<string, number>();
    for (const row of rows) {
        map.set(String(row[xField]), row[yField]);
    }
    return categories.map(cat => map.get(cat) ?? null);
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
            xAxis: {
                type: xIsDiscrete ? 'category' : xIsTemporal ? 'time' : 'value',
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
                ...(categories ? { data: categories } : {}),
            },
            yAxis: {
                type: 'value',
                name: yField,
                nameLocation: 'middle',
                nameGap: 40,
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
        const categories = xIsDiscrete ? extractCategories(table, xField, getCategoryOrder(ctx, 'x')) : undefined;

        const option: any = {
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: xIsDiscrete ? 'category' : 'value',
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
                ...(categories ? { data: categories } : {}),
            },
            yAxis: {
                type: 'value',
                name: yField,
                nameLocation: 'middle',
                nameGap: 40,
                inverse: !!rankOnY,
            },
            series: [],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: xField, valueLabel: yField };

        const baseSeriesOpt = { showSymbol: true, symbolSize: 6, smooth: true };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const seriesData = xIsDiscrete
                    ? buildCategoryAlignedData(rows, xField, yField, categories!)
                    : (rankOnX ? [...rows].sort((a, b) => Number(a[xField]) - Number(b[xField])) : rows)
                        .map(r => [r[xField], r[yField]]);
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
            let rows = table;
            if (rankOnX) rows = [...rows].sort((a, b) => Number(a[xField]) - Number(b[xField]));
            const seriesData = xIsDiscrete
                ? categories!.map(cat => {
                    const row = rows.find(r => String(r[xField]) === cat);
                    return row ? row[yField] : null;
                })
                : rows.map(r => [r[xField], r[yField]]);
            option.series.push({ type: 'line', data: seriesData, ...baseSeriesOpt });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
