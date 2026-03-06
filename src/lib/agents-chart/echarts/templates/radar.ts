// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Radar Chart template.
 *
 * Contrast with VL:
 *   VL: No native radar — the VL template manually computes polar coordinates
 *       using trig and draws with layered point/line/rule marks.
 *   EC: Native radar series with polar coordinate system — much simpler.
 *       ECharts handles the axis spokes, grid rings, and polar projection natively.
 *
 * Data model (long format):
 *   x (nominal): metric / axis name
 *   y (quantitative): value for that metric
 *   color (nominal): entity / group
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, groupBy, computeCircumferencePressure } from './utils';

/** Round up to a nice ceiling for radar axis max. */
function niceMax(v: number): number {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const mantissa = v / pow;
    const nice = mantissa <= 1 ? 1
        : mantissa <= 2 ? 2
        : mantissa <= 2.5 ? 2.5
        : mantissa <= 5 ? 5
        : 10;
    return nice * pow;
}

export const ecRadarChartDef: ChartTemplateDef = {
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

        // Compute max value per metric for axis scaling
        const metricMax = new Map<string, number>();
        for (const m of metrics) {
            const vals = table
                .filter(r => String(r[axisField]) === m)
                .map(r => Number(r[valueField]))
                .filter(v => isFinite(v));
            metricMax.set(m, niceMax(vals.length > 0 ? Math.max(...vals) : 1));
        }

        // Build radar indicator (axis) definitions
        const indicator = metrics.map(m => ({
            name: m,
            max: metricMax.get(m) || 1,
        }));

        // Build series data
        const filled = chartProperties?.filled !== false;
        const fillOpacity = chartProperties?.fillOpacity ?? 0.3;

        const seriesData: any[] = [];
        const legendData: string[] = [];

        if (groupField) {
            // Multi-group: one polygon per group
            const groups = groupBy(table, groupField);

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                legendData.push(name);

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

                seriesData.push({
                    name,
                    value: values,
                    areaStyle: filled ? { opacity: fillOpacity } : undefined,
                });
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

            seriesData.push({
                value: values,
                areaStyle: filled ? { opacity: fillOpacity } : undefined,
            });
        }

        // ── Layout: keep radar and axis labels inside canvas, legend not overlapping ──
        // Use percentage center/radius so top/bottom axis labels don't overflow; reserve bottom for legend.
        const hasLegend = legendData.length > 0;
        const { canvasW, canvasH }
            = computeCircumferencePressure(metrics.length, ctx.canvasSize, {
                minArcPx: 60,
                minRadius: 80,
                maxStretch: ctx.assembleOptions?.maxStretch,
            });
        const chartH = canvasH + (hasLegend ? 36 : 0);

        const option: any = {
            tooltip: { trigger: 'item' },
            radar: {
                indicator,
                shape: chartProperties?.shape === 'circle' ? 'circle' : 'polygon',
                center: ['50%', '46%'],
                radius: '38%',
                axisName: { fontSize: 11 },
            },
            series: [{
                type: 'radar',
                data: seriesData,
                emphasis: {
                    lineStyle: { width: 3 },
                },
            }],
            _width: canvasW,
            _height: chartH,
        };

        if (hasLegend) {
            option.legend = {
                data: legendData,
                bottom: 12,
                left: 'center',
                orient: 'horizontal',
            };
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        {
            key: 'shape', label: 'Grid', type: 'discrete', options: [
                { value: undefined, label: 'Polygon (default)' },
                { value: 'circle', label: 'Circle' },
            ],
        } as ChartPropertyDef,
        {
            key: 'filled', label: 'Fill', type: 'discrete', options: [
                { value: true, label: 'Filled (default)' },
                { value: false, label: 'Outline only' },
            ],
        } as ChartPropertyDef,
        { key: 'fillOpacity', label: 'Opacity', type: 'continuous', min: 0.05, max: 0.8, step: 0.05, defaultValue: 0.3 } as ChartPropertyDef,
    ],
};
