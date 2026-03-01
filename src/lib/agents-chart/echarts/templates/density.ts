// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Density Plot — KDE area (align with vegalite/templates/density.ts).
 *
 * Why VL and EC specs differ:
 *   - Vega-Lite: spec keeps raw data + transform [{ density: field }]; the runtime computes
 *     kernel density (KDE) when rendering. Encoding uses transform outputs "value" and "density".
 *   - ECharts: no transform pipeline; we compute KDE here and put (value, density) points
 *     into series[].data. The spec therefore contains the derived curve, not the raw rows.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { groupBy, DEFAULT_COLORS } from './utils';

/**
 * Bandwidth for KDE — match vega-statistics (bandwidth.js).
 * Scott/Silverman-style: 1.06 * v * n^(-0.2) with v = min(std, IQR/1.34).
 */
function estimateBandwidth(values: number[]): number {
    const n = values.length;
    if (n < 2) return 1;
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const d = Math.sqrt(variance); // standard deviation
    const q1 = sorted[Math.floor((n - 1) * 0.25)];
    const q3 = sorted[Math.floor((n - 1) * 0.75)];
    const iqr = (q3 != null && q1 != null) ? q3 - q1 : 0;
    const h = iqr / 1.34;
    const v = Math.min(d, h || d) || d || 1;
    return 1.06 * v * Math.pow(n, -0.2);
}

/** One-dimensional Gaussian KDE over extent; formula matches vega-statistics kde.pdf. */
function kde(values: number[], steps: number, bandwidthMultiplier: number, extent?: { min: number; max: number }): { x: number[]; y: number[] } {
    if (values.length === 0) return { x: [], y: [] };
    const min = extent ? extent.min : Math.min(...values);
    const max = extent ? extent.max : Math.max(...values);
    const range = max - min || 1;
    const lo = min;
    const hi = max;
    const h = estimateBandwidth(values) * bandwidthMultiplier;
    const n = values.length;

    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = lo + (i / steps) * (hi - lo || range);
        let sum = 0;
        for (const v of values) {
            const z = (t - v) / h;
            sum += Math.exp(-0.5 * z * z);
        }
        const density = sum / (n * h * Math.sqrt(2 * Math.PI));
        x.push(t);
        y.push(density);
    }
    return { x, y };
}

export const ecDensityPlotDef: ChartTemplateDef = {
    chart: 'Density Plot',
    template: { mark: 'area', encoding: {} },
    channels: ['x', 'color', 'column', 'row'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xField = channelSemantics.x?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField) return;

        const steps = 200; // match Vega density minsteps/maxsteps (default up to 200)
        const bandwidthMultiplier = (chartProperties?.bandwidth != null && chartProperties.bandwidth > 0)
            ? chartProperties.bandwidth
            : 1;

        const option: any = {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'value', name: xField, nameLocation: 'middle', nameGap: 30, axisTick: { show: true } },
            yAxis: { type: 'value', name: 'Density', nameLocation: 'middle', nameGap: 40, axisTick: { show: true } },
            series: [],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: xField, valueLabel: 'Density' };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            // Shared extent (like Vega's density with groupby) so all curves use the same x domain
            const allValues = table.map((r: any) => Number(r[xField])).filter((v: number) => !isNaN(v));
            const sharedExtent = allValues.length > 0
                ? { min: Math.min(...allValues), max: Math.max(...allValues) }
                : undefined;
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const values = rows.map((r: any) => Number(r[xField])).filter((v: number) => !isNaN(v));
                const { x, y } = kde(values, steps, bandwidthMultiplier, sharedExtent);
                const data = x.map((xi, i) => [xi, y[i]]);
                option.series.push({
                    name,
                    type: 'line',
                    data,
                    symbol: 'none',
                    areaStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length], opacity: 0.5 },
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }
        } else {
            const values = table.map((r: any) => Number(r[xField])).filter((v: number) => !isNaN(v));
            const { x, y } = kde(values, steps, bandwidthMultiplier);
            const data = x.map((xi, i) => [xi, y[i]]);
            option.series.push({
                type: 'line',
                data,
                symbol: 'none',
                areaStyle: { opacity: 0.5 },
            });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'bandwidth', label: 'Bandwidth', type: 'continuous', min: 0.05, max: 2, step: 0.05, defaultValue: 0 },
    ] as ChartPropertyDef[],
};
