// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Histogram template.
 *
 * Contrast with VL:
 *   VL: encoding.x.bin = true + encoding.y.aggregate = "count"
 *       (VL handles binning internally)
 *   EC: No built-in bin transform — we compute bins client-side and render
 *       as a bar chart with contiguous bars (barCategoryGap: 0).
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { DEFAULT_COLORS } from './utils';

export const ecHistogramDef: ChartTemplateDef = {
    chart: 'Histogram',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'color', 'column', 'row'],
    markCognitiveChannel: 'length',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xField = channelSemantics.x?.field;
        const colorField = channelSemantics.color?.field;
        if (!xField) return;

        const binCount = chartProperties?.binCount ?? 10;

        // Extract numeric values
        const values = table
            .map(r => Number(r[xField]))
            .filter(v => isFinite(v));

        if (values.length === 0) return;

        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = maxVal - minVal;
        const binWidth = range > 0 ? range / binCount : 1;

        if (!colorField) {
            // Simple histogram — single series
            const counts = new Array(binCount).fill(0);
            for (const v of values) {
                let idx = Math.floor((v - minVal) / binWidth);
                if (idx >= binCount) idx = binCount - 1;
                counts[idx]++;
            }

            const categories = counts.map((_, i) => {
                const lo = (minVal + i * binWidth).toFixed(1);
                const hi = (minVal + (i + 1) * binWidth).toFixed(1);
                return `${lo}–${hi}`;
            });

            const option: any = {
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'shadow' },
                },
                xAxis: {
                    type: 'category',
                    data: categories,
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 25,
                    axisTick: { show: true, alignWithLabel: true },
                    axisLabel: { rotate: categories.length > 10 ? 45 : 0 },
                },
                yAxis: {
                    type: 'value',
                    name: 'Count',
                    nameLocation: 'middle',
                    nameGap: 40,
                    axisTick: { show: true },
                },
                series: [{
                    type: 'bar',
                    data: counts,
                    barCategoryGap: '0%',   // contiguous bars
                    itemStyle: {
                        borderColor: '#fff',
                        borderWidth: 0.5,
                    },
                }],
            };
            option._encodingTooltip = { trigger: 'axis', categoryLabel: xField, valueLabel: 'Count' };

            Object.assign(spec, option);
        } else {
            // Stacked histogram — one series per color group
            const groupValues = new Map<string, number[]>();
            for (const row of table) {
                const v = Number(row[xField]);
                if (!isFinite(v)) continue;
                const g = String(row[colorField] ?? '');
                if (!groupValues.has(g)) groupValues.set(g, []);
                groupValues.get(g)!.push(v);
            }

            const categories = Array.from({ length: binCount }, (_, i) => {
                const lo = (minVal + i * binWidth).toFixed(1);
                const hi = (minVal + (i + 1) * binWidth).toFixed(1);
                return `${lo}–${hi}`;
            });

            const series: any[] = [];
            let colorIdx = 0;
            const legendData: string[] = [];

            for (const [name, vals] of groupValues) {
                const counts = new Array(binCount).fill(0);
                for (const v of vals) {
                    let idx = Math.floor((v - minVal) / binWidth);
                    if (idx >= binCount) idx = binCount - 1;
                    counts[idx]++;
                }
                legendData.push(name);
                series.push({
                    name,
                    type: 'bar',
                    data: counts,
                    stack: 'total',
                    barCategoryGap: '0%',
                    itemStyle: {
                        color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length],
                        borderColor: '#fff',
                        borderWidth: 0.5,
                    },
                });
                colorIdx++;
            }

            const option: any = {
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                legend: { data: legendData },
                xAxis: {
                    type: 'category',
                    data: categories,
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 25,
                    axisTick: { show: true, alignWithLabel: true },
                    axisLabel: { rotate: categories.length > 10 ? 45 : 0 },
                },
                yAxis: {
                    type: 'value',
                    name: 'Count',
                    nameLocation: 'middle',
                    nameGap: 40,
                    axisTick: { show: true },
                },
                series,
            };
            option._encodingTooltip = { trigger: 'axis', categoryLabel: xField, valueLabel: 'Count' };

            Object.assign(spec, option);
        }

        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'binCount', label: 'Bins', type: 'continuous', min: 5, max: 50, step: 1, defaultValue: 10 } as ChartPropertyDef,
    ],
};
