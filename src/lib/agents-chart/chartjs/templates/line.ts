// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js Line Chart template (single + multi-series).
 *
 * Contrast with VL:
 *   VL: encoding.x + encoding.y + encoding.color → auto-groups into lines
 *   CJS: explicit datasets[] — each dataset is one line
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import {
    extractCategories, groupBy, buildCategoryAlignedData,
    DEFAULT_COLORS,
} from './utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

export const cjsLineChartDef: ChartTemplateDef = {
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

        const xIsDiscrete = isDiscrete(xCS.type);

        const categories = xIsDiscrete
            ? extractCategories(table, xField, xCS.ordinalSortOrder)
            : undefined;

        // Determine tension for interpolation
        const interpolate = chartProperties?.interpolate;
        const tension = (interpolate === 'monotone' || interpolate === 'basis' ||
                         interpolate === 'cardinal' || interpolate === 'catmull-rom')
            ? 0.4 : 0;
        const stepped = interpolate === 'step' ? 'middle' as const
                      : interpolate === 'step-before' ? 'before' as const
                      : interpolate === 'step-after' ? 'after' as const
                      : false as const;

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
                    },
                    y: {
                        type: 'linear',
                        title: { display: true, text: yField },
                    },
                },
                plugins: {
                    tooltip: { enabled: true },
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
                    : rows.map(r => ({ x: r[xField], y: r[yField] }));

                config.data.datasets.push({
                    label: name,
                    data,
                    borderColor: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length],
                    backgroundColor: 'transparent',
                    tension,
                    stepped,
                    pointRadius: 3,
                    fill: false,
                });
                colorIdx++;
            }
        } else {
            const data = xIsDiscrete
                ? categories!.map(cat => {
                    const row = table.find(r => String(r[xField]) === cat);
                    return row ? row[yField] : null;
                })
                : table.map(r => ({ x: r[xField], y: r[yField] }));

            config.data.datasets.push({
                label: yField,
                data,
                borderColor: DEFAULT_COLORS[0],
                backgroundColor: 'transparent',
                tension,
                stepped,
                pointRadius: 3,
                fill: false,
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
                { value: 'step', label: 'Step' },
                { value: 'step-before', label: 'Step Before' },
                { value: 'step-after', label: 'Step After' },
            ],
        } as ChartPropertyDef,
    ],
};
