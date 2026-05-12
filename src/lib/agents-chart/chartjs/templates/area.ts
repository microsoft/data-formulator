// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js Area Chart template (single + multi-series).
 *
 * Chart.js renders area charts as line charts with `fill: true`.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import {
    extractCategories,
    groupBy,
    buildCategoryAlignedData,
    DEFAULT_COLORS,
    DEFAULT_BG_COLORS,
    getChartJsPalette,
    getSeriesBorderColor,
    getSeriesBackgroundColor,
    coerceUnixMsForChartJs,
} from './utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

export const cjsAreaChartDef: ChartTemplateDef = {
    chart: 'Area Chart',
    template: { mark: 'area', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'area',
    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' }, facetAspectRatioResistance: 0.5 },
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
        const mapContinuousX = (raw: unknown) =>
            (xIsTemporal ? coerceUnixMsForChartJs(raw) : raw);

        const categories = xIsDiscrete
            ? extractCategories(table, xField, xCS.ordinalSortOrder)
            : undefined;

        const opacity = chartProperties?.opacity ?? 0.4;

        // Stacking
        const stackMode = chartProperties?.stackMode;
        const stacked = stackMode !== 'layered';

        // Interpolation
        const interpolate = chartProperties?.interpolate;
        const tension = (interpolate === 'monotone' || interpolate === 'basis' ||
                         interpolate === 'cardinal' || interpolate === 'catmull-rom')
            ? 0.4 : 0;

        const palette = getChartJsPalette(ctx, 'color');

        const config: any = {
            type: 'line',
            data: {
                labels: categories || [],
                datasets: [],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: xIsDiscrete ? 'category' : 'linear',
                        title: { display: true, text: xField },
                        ticks: {
                            font: { size: 10 },
                            ...(xIsTemporal
                                ? {
                                    maxTicksLimit: 8,
                                    callback(v: number | string) {
                                        const n = typeof v === 'number' ? v : Number(v);
                                        if (!Number.isFinite(n)) return String(v);
                                        return new Date(n).toLocaleDateString(undefined, {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                        });
                                    },
                                }
                                : {}),
                        },
                    },
                    y: {
                        type: 'linear',
                        title: { display: true, text: yField },
                        stacked,
                        ticks: { font: { size: 10 } },
                    },
                },
                plugins: {
                    tooltip: { enabled: true },
                    filler: { propagate: true },
                },
            },
        };

        // Zero-baseline: Chart.js defaults beginAtZero to false, so
        // explicitly set true when the semantic decision includes zero.
        if (channelSemantics.y?.zero) {
            config.options.scales.y.beginAtZero = channelSemantics.y.zero.zero !== false;
        }

        if (colorField) {
            const groups = groupBy(table, colorField);
            config.options.plugins.legend = { display: true };

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const data = xIsDiscrete
                    ? buildCategoryAlignedData(rows, xField, yField, categories!)
                    : rows
                        .map(r => ({ x: mapContinuousX(r[xField]), y: r[yField] }))
                        .filter(p => p.y != null && (xIsTemporal ? Number.isFinite(p.x as number) : true));

                const borderColor = getSeriesBorderColor(palette, colorIdx);
                const bgColor = getSeriesBackgroundColor(palette, colorIdx, opacity);

                config.data.datasets.push({
                    label: name,
                    data,
                    borderColor,
                    backgroundColor: bgColor,
                    tension,
                    fill: stacked ? 'stack' : 'origin',
                    pointRadius: 2,
                });
                colorIdx++;
            }
        } else {
            const data = xIsDiscrete
                ? categories!.map(cat => {
                    const row = table.find(r => String(r[xField]) === cat);
                    return row ? row[yField] : null;
                })
                : table
                    .map(r => ({ x: mapContinuousX(r[xField]), y: r[yField] }))
                    .filter(p => p.y != null && (xIsTemporal ? Number.isFinite(p.x as number) : true));

            config.data.datasets.push({
                label: yField,
                data,
                borderColor: getSeriesBorderColor(palette, 0),
                backgroundColor: getSeriesBackgroundColor(palette, 0, opacity),
                tension,
                fill: 'origin',
                pointRadius: 2,
            });
            config.options.plugins.legend = { display: false };
        }

        Object.assign(spec, config);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        {
            key: 'interpolate', label: 'Curve', type: 'discrete', options: [
                { value: undefined, label: 'Default (linear)' },
                { value: 'linear', label: 'Linear' },
                { value: 'monotone', label: 'Monotone (smooth)' },
            ],
        } as ChartPropertyDef,
        { key: 'opacity', label: 'Opacity', type: 'continuous', min: 0.1, max: 1, step: 0.05, defaultValue: 0.4 } as ChartPropertyDef,
        {
            key: 'stackMode', label: 'Stack', type: 'discrete', options: [
                { value: undefined, label: 'Stacked (default)' },
                { value: 'layered', label: 'Layered (overlap)' },
            ],
        } as ChartPropertyDef,
    ],
};
