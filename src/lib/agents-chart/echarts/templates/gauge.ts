// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Gauge Chart template.
 *
 * Unique to ECharts — no Vega-Lite equivalent.
 * Displays numeric KPI values on speedometer-style dials.
 *
 * Data model:
 *   size   (quantitative): the value to display
 *   column (nominal, optional): splits into separate gauge subplots with
 *          facet-style wrapping — each unique value creates one gauge dial
 *
 * When multiple rows share the same column value, the size values are
 * averaged.  With no column channel, all rows are averaged into a single
 * gauge.
 *
 * Scaling: uses facet-style wrapping — the template computes a grid layout
 * internally (since gauge is axis-less, the assembler's facet path doesn't
 * apply).  The grid respects a minimum gauge cell size and wraps to multiple
 * rows when there are too many dials for a single row.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS } from './utils';

export const ecGaugeChartDef: ChartTemplateDef = {
    chart: 'Gauge Chart',
    template: { mark: 'point', encoding: {} },
    channels: ['size', 'column'],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const valueField = channelSemantics.size?.field;
        const columnField = channelSemantics.column?.field;

        if (!valueField) return;

        // Compute data range for axis scaling
        const allValues = table.map(r => Number(r[valueField])).filter(v => isFinite(v));
        const dataMax = allValues.length > 0 ? Math.max(...allValues) : 100;

        const scaleMin = chartProperties?.min ?? 0;
        const scaleMax = chartProperties?.max ?? niceGaugeMax(dataMax);

        // ── Build gauge items: one per column category, or single ────────
        const gaugeItems: { name: string; value: number; color?: string }[] = [];

        if (columnField) {
            const groups = groupBy(table, columnField);
            const categories = extractCategories(
                table, columnField, channelSemantics.column?.ordinalSortOrder,
            );
            categories.forEach((cat, idx) => {
                const rows = groups.get(cat) || [];
                const vals = rows.map(r => Number(r[valueField])).filter(v => isFinite(v));
                const avg = vals.length > 0
                    ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100
                    : 0;
                gaugeItems.push({
                    name: cat,
                    value: avg,
                    color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
                });
            });
        } else {
            const avg = allValues.length > 0
                ? Math.round(allValues.reduce((a, b) => a + b, 0) / allValues.length * 100) / 100
                : 0;
            gaugeItems.push({ name: valueField, value: avg });
        }

        // ── Facet-style grid wrapping ────────────────────────────────────
        const n = gaugeItems.length;
        const baseW = ctx.canvasSize.width;
        const baseH = ctx.canvasSize.height;
        const minCellDim = 180;       // minimum px per gauge cell
        const facetMaxStretch = ctx.assembleOptions?.maxStretch ?? 2.0;  // max canvas stretch

        let gridCols: number, gridRows: number;
        if (n === 1) {
            gridCols = 1;
            gridRows = 1;
        } else {
            const maxCols = Math.max(1,
                Math.floor(baseW * facetMaxStretch / minCellDim));
            if (n <= maxCols) {
                gridCols = n;
                gridRows = 1;
            } else {
                gridRows = Math.ceil(n / maxCols);
                gridCols = Math.ceil(n / gridRows);
            }
        }

        const canvasW = Math.max(baseW, gridCols * minCellDim);
        const canvasH = Math.max(baseH, gridRows * (minCellDim + 20));
        const cellW = canvasW / gridCols;
        const cellH = canvasH / gridRows;
        const gaugeRadius = Math.max(40,
            Math.round(Math.min(cellW * 0.38, cellH * 0.38)));

        // Scale all gauge element sizes proportionally to the radius.
        // Reference radius ~100px maps to baseline sizes.
        const s = gaugeRadius / 100;
        const progressWidth = Math.max(4, Math.round(12 * s));
        const pointerWidth = Math.max(2, Math.round(5 * s));
        const detailFontSize = Math.max(10, Math.round(20 * s));
        const titleFontSize = Math.max(8, Math.round(14 * s));
        const axisLabelFontSize = Math.max(6, Math.round(9 * s));
        const tickLength = Math.max(3, Math.round(5 * s));
        const tickDistance = -Math.round(16 * s);
        const splitLength = Math.max(5, Math.round(12 * s));
        const splitDistance = -Math.round(20 * s);
        const labelDistance = -Math.round(24 * s);

        const showProgress = chartProperties?.showProgress !== false;

        // ── Build one ECharts gauge series per item ──────────────────────
        const series = gaugeItems.map((item, i) => {
            const col = i % gridCols;
            const row = Math.floor(i / gridCols);
            const cx = Math.round((col + 0.5) * cellW);
            const cy = Math.round((row + 0.5) * cellH);

            return {
                type: 'gauge' as const,
                min: scaleMin,
                max: scaleMax,
                center: [`${cx}px`, `${cy}px`],
                radius: `${gaugeRadius}px`,
                data: [{
                    name: item.name,
                    value: item.value,
                    ...(item.color ? { itemStyle: { color: item.color } } : {}),
                }],
                detail: {
                    formatter: '{value}',
                    fontSize: detailFontSize,
                    offsetCenter: [0, '70%'],
                },
                title: {
                    fontSize: titleFontSize,
                    offsetCenter: [0, '85%'],
                },
                axisLine: {
                    lineStyle: { width: progressWidth },
                },
                progress: {
                    show: showProgress,
                    width: progressWidth,
                    ...(item.color ? { itemStyle: { color: item.color } } : {}),
                },
                pointer: {
                    length: '60%',
                    width: pointerWidth,
                    ...(item.color ? { itemStyle: { color: item.color } } : {}),
                },
                axisTick: {
                    distance: tickDistance,
                    length: tickLength,
                    lineStyle: { color: '#999', width: 1 },
                },
                splitLine: {
                    distance: splitDistance,
                    length: splitLength,
                    lineStyle: { color: '#999', width: 2 },
                },
                axisLabel: {
                    distance: labelDistance,
                    fontSize: axisLabelFontSize,
                    color: '#666',
                },
            };
        });

        const option: any = {
            tooltip: { trigger: 'item', formatter: '{b}: {c}' },
            series,
            color: DEFAULT_COLORS,
            _width: canvasW,
            _height: canvasH,
        };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'min', label: 'Min', type: 'continuous', min: 0, max: 1000, step: 10, defaultValue: 0 } as ChartPropertyDef,
        { key: 'max', label: 'Max', type: 'continuous', min: 0, max: 10000, step: 100, defaultValue: 100 } as ChartPropertyDef,
        {
            key: 'showProgress', label: 'Progress', type: 'discrete', options: [
                { value: true, label: 'Show (default)' },
                { value: false, label: 'Hide' },
            ],
        } as ChartPropertyDef,
    ],
};

/** Round up to a nice gauge maximum. */
function niceGaugeMax(v: number): number {
    if (v <= 0) return 100;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const mantissa = v / pow;
    const nice = mantissa <= 1 ? 1
        : mantissa <= 2 ? 2
        : mantissa <= 5 ? 5
        : 10;
    return nice * pow;
}
