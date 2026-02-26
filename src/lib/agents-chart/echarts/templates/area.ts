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
import { extractCategories, groupBy, DEFAULT_COLORS, getCategoryOrder } from './utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

export const ecAreaChartDef: ChartTemplateDef = {
    chart: 'Area Chart',
    template: { mark: 'area', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'area',
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
        const categories = xIsDiscrete
            ? extractCategories(table, xField, getCategoryOrder(ctx, 'x'))
            : undefined;

        const option: any = {
            tooltip: { trigger: 'axis' },
            xAxis: {
                type: xIsDiscrete ? 'category' : xIsTemporal ? 'time' : 'value',
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
                boundaryGap: xIsDiscrete,
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

        if (colorField) {
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
                    areaStyle: { opacity },
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                };
                if (stackGroup) series.stack = stackGroup;
                if (smooth) series.smooth = true;
                if (step) series.step = step;

                option.series.push(series);
                colorIdx++;
            }
        } else {
            const seriesData = xIsDiscrete
                ? categories!.map(cat => {
                    const row = table.find(r => String(r[xField]) === cat);
                    return row ? row[yField] : null;
                })
                : table.map(r => [r[xField], r[yField]]);

            const series: any = {
                type: 'line',
                data: seriesData,
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
