// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js Histogram template.
 *
 * Chart.js has no built-in binning — we compute bins client-side
 * and render as a bar chart.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { DEFAULT_COLORS, DEFAULT_BG_COLORS } from './utils';

export const cjsHistogramDef: ChartTemplateDef = {
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
        const numValues = table
            .map(r => Number(r[xField]))
            .filter(v => isFinite(v));

        if (numValues.length === 0) return;

        const minVal = Math.min(...numValues);
        const maxVal = Math.max(...numValues);
        const range = maxVal - minVal;
        const binWidth = range > 0 ? range / binCount : 1;

        const categories = Array.from({ length: binCount }, (_, i) => {
            const lo = (minVal + i * binWidth).toFixed(1);
            const hi = (minVal + (i + 1) * binWidth).toFixed(1);
            return `${lo}–${hi}`;
        });

        const config: any = {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [],
            },
            options: {
                responsive: false,
                scales: {
                    x: {
                        title: { display: true, text: xField },
                    },
                    y: {
                        title: { display: true, text: 'Count' },
                        beginAtZero: true,
                    },
                },
                plugins: {
                    tooltip: { enabled: true },
                },
            },
        };

        if (!colorField) {
            // Simple histogram
            const counts = new Array(binCount).fill(0);
            for (const v of numValues) {
                let idx = Math.floor((v - minVal) / binWidth);
                if (idx >= binCount) idx = binCount - 1;
                counts[idx]++;
            }

            config.data.datasets.push({
                label: 'Count',
                data: counts,
                backgroundColor: DEFAULT_BG_COLORS[0],
                borderColor: DEFAULT_COLORS[0],
                borderWidth: 1,
                barPercentage: 1.0,
                categoryPercentage: 1.0,
            });
            config.options.plugins.legend = { display: false };
        } else {
            // Stacked histogram
            const groupValues = new Map<string, number[]>();
            for (const row of table) {
                const v = Number(row[xField]);
                if (!isFinite(v)) continue;
                const g = String(row[colorField] ?? '');
                if (!groupValues.has(g)) groupValues.set(g, []);
                groupValues.get(g)!.push(v);
            }

            config.options.scales.x.stacked = true;
            config.options.scales.y.stacked = true;

            let colorIdx = 0;
            for (const [name, vals] of groupValues) {
                const counts = new Array(binCount).fill(0);
                for (const v of vals) {
                    let idx = Math.floor((v - minVal) / binWidth);
                    if (idx >= binCount) idx = binCount - 1;
                    counts[idx]++;
                }
                config.data.datasets.push({
                    label: name,
                    data: counts,
                    backgroundColor: DEFAULT_BG_COLORS[colorIdx % DEFAULT_BG_COLORS.length],
                    borderColor: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length],
                    borderWidth: 1,
                    barPercentage: 1.0,
                    categoryPercentage: 1.0,
                });
                colorIdx++;
            }
            config.options.plugins.legend = { display: true };
        }

        Object.assign(spec, config);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'binCount', label: 'Bins', type: 'continuous', min: 5, max: 50, step: 1, defaultValue: 10 } as ChartPropertyDef,
    ],
};
