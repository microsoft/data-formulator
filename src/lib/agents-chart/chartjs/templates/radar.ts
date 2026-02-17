// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js Radar Chart template.
 *
 * Chart.js has native radar chart support via type: 'radar'.
 *
 * Data model (long format):
 *   x (nominal): metric / axis name
 *   y (quantitative): value for that metric
 *   color (nominal): entity / group
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS, DEFAULT_BG_COLORS } from './utils';

export const cjsRadarChartDef: ChartTemplateDef = {
    chart: 'Radar Chart',
    template: { mark: 'point', encoding: {} },
    channels: ['x', 'y', 'color', 'column', 'row'],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const axisField = channelSemantics.x?.field;   // metric names
        const valueField = channelSemantics.y?.field;   // metric values
        const groupField = channelSemantics.color?.field; // entities

        if (!axisField || !valueField) return;

        // Extract unique metrics (radar axes)
        const metrics = extractCategories(table, axisField, channelSemantics.x?.ordinalSortOrder);
        if (metrics.length < 2) return;

        const filled = chartProperties?.filled !== false;
        const fillOpacity = chartProperties?.fillOpacity ?? 0.3;

        const config: any = {
            type: 'radar',
            data: {
                labels: metrics,
                datasets: [],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        beginAtZero: true,
                        ticks: { display: true },
                        pointLabels: { display: true },
                    },
                },
                plugins: {
                    tooltip: { enabled: true },
                },
            },
            // Canvas size from context (no axes)
            _width: Math.max(ctx.canvasSize.width, 350),
            _height: Math.max(ctx.canvasSize.height, 300),
        };

        if (groupField) {
            const groups = groupBy(table, groupField);
            config.options.plugins.legend = { display: true };

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                // Aggregate: mean per metric
                const metricVals = new Map<string, { sum: number; count: number }>();
                for (const row of rows) {
                    const m = String(row[axisField]);
                    const v = Number(row[valueField]) || 0;
                    if (!metricVals.has(m)) metricVals.set(m, { sum: 0, count: 0 });
                    const entry = metricVals.get(m)!;
                    entry.sum += v;
                    entry.count++;
                }

                const values = metrics.map(m => {
                    const entry = metricVals.get(m);
                    return entry ? Math.round((entry.sum / entry.count) * 100) / 100 : 0;
                });

                const borderColor = DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length];
                const bgColor = borderColor.replace(/[\d.]+\)$/, `${fillOpacity})`);

                config.data.datasets.push({
                    label: name,
                    data: values,
                    borderColor,
                    backgroundColor: filled ? bgColor : 'transparent',
                    pointBackgroundColor: borderColor,
                    fill: filled,
                });
                colorIdx++;
            }
        } else {
            // Single group
            const metricVals = new Map<string, { sum: number; count: number }>();
            for (const row of table) {
                const m = String(row[axisField]);
                const v = Number(row[valueField]) || 0;
                if (!metricVals.has(m)) metricVals.set(m, { sum: 0, count: 0 });
                const entry = metricVals.get(m)!;
                entry.sum += v;
                entry.count++;
            }

            const values = metrics.map(m => {
                const entry = metricVals.get(m);
                return entry ? Math.round((entry.sum / entry.count) * 100) / 100 : 0;
            });

            config.data.datasets.push({
                label: valueField,
                data: values,
                borderColor: DEFAULT_COLORS[0],
                backgroundColor: filled
                    ? DEFAULT_COLORS[0].replace(/[\d.]+\)$/, `${fillOpacity})`)
                    : 'transparent',
                pointBackgroundColor: DEFAULT_COLORS[0],
                fill: filled,
            });
            config.options.plugins.legend = { display: false };
        }

        Object.assign(spec, config);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        {
            key: 'filled', label: 'Fill', type: 'discrete', options: [
                { value: true, label: 'Filled (default)' },
                { value: false, label: 'Outline only' },
            ],
        } as ChartPropertyDef,
        { key: 'fillOpacity', label: 'Opacity', type: 'continuous', min: 0.05, max: 0.8, step: 0.05, defaultValue: 0.3 } as ChartPropertyDef,
    ],
};
