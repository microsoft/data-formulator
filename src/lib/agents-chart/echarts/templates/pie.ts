// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Pie Chart template.
 *
 * Contrast with VL:
 *   VL: mark = "arc" with theta (angular extent) + color (slice groups)
 *   EC: series type = 'pie' with data = [{ name, value }, ...]
 *
 * Pie charts have no axes — a fundamentally different layout from bar/line/scatter.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, DEFAULT_COLORS, computeCircumferencePressure, computeEffectiveBarCount } from './utils';

export const ecPieChartDef: ChartTemplateDef = {
    chart: 'Pie Chart',
    template: { mark: 'arc', encoding: {} },
    channels: ['size', 'color', 'column', 'row'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const colorField = channelSemantics.color?.field;
        const sizeField = channelSemantics.size?.field;

        // Build pie data: { name, value } pairs
        const pieData: { name: string; value: number }[] = [];

        if (colorField && sizeField) {
            // color = category (slice label), size = measure (slice value)
            // Aggregate: sum values per category
            const agg = new Map<string, number>();
            for (const row of table) {
                const cat = String(row[colorField] ?? '');
                const val = Number(row[sizeField]) || 0;
                agg.set(cat, (agg.get(cat) ?? 0) + val);
            }
            // Preserve ordinal sort if available
            const categories = extractCategories(table, colorField, channelSemantics.color?.ordinalSortOrder);
            for (const cat of categories) {
                pieData.push({ name: cat, value: agg.get(cat) ?? 0 });
            }
        } else if (colorField) {
            // No size field → count occurrences per category
            const counts = new Map<string, number>();
            for (const row of table) {
                const cat = String(row[colorField] ?? '');
                counts.set(cat, (counts.get(cat) ?? 0) + 1);
            }
            const categories = extractCategories(table, colorField, channelSemantics.color?.ordinalSortOrder);
            for (const cat of categories) {
                pieData.push({ name: cat, value: counts.get(cat) ?? 0 });
            }
        } else if (sizeField) {
            // Only size field, no categories
            for (const row of table) {
                const val = Number(row[sizeField]) || 0;
                pieData.push({ name: String(val), value: val });
            }
        }

        const innerRadius = chartProperties?.innerRadius ?? 0;

        // ── Circumference-pressure sizing (spring model) ──────────────
        // Pie slices have variable width — use effective bar count based
        // on the smallest slice to determine worst-case pressure.
        const sliceValues = pieData.map(d => d.value);
        const effectiveCount = computeEffectiveBarCount(sliceValues);
        const { radius: pressureRadius, canvasW: rawCanvasW, canvasH }
            = computeCircumferencePressure(effectiveCount, ctx.canvasSize, {
                minArcPx: 45,
                minRadius: 60,
                maxStretch: ctx.assembleOptions?.maxStretch,
                margin: 50,   // extra room for pie label lines + text
            });

        const canvasW = rawCanvasW;

        // ── Adaptive label sizing ─────────────────────────────────────
        // Scale font size and label width based on slice count so that
        // labels stay readable without crowding.
        const n = pieData.length;
        const labelFontSize = n <= 4 ? 13 : n <= 8 ? 11 : n <= 15 ? 10 : 9;

        // Label width budget: available space outside the pie on each side.
        // Shrink pie more when there are many slices to leave label room.
        const radiusFraction = n <= 4 ? 0.70 : n <= 8 ? 0.60 : n <= 15 ? 0.55 : 0.50;
        const labelBudget = Math.max(40, Math.round((canvasW - 40) / 2 * (1 - radiusFraction)));

        // Pie radius
        const outerRadiusPx = Math.max(60, Math.round(
            Math.min(pressureRadius,
                (canvasW - 40) / 2 * radiusFraction,
                (canvasH - 40) / 2 * radiusFraction)));
        const outerRadius = `${outerRadiusPx}px`;

        const option: any = {
            tooltip: {
                trigger: 'item',
                formatter: '{b}: {c} ({d}%)',
            },
            series: [{
                type: 'pie',
                radius: innerRadius > 0
                    ? [`${Math.round(outerRadiusPx * innerRadius / 100)}px`, outerRadius]
                    : ['0%', outerRadius],
                center: ['50%', '50%'],
                data: pieData,
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowOffsetX: 0,
                        shadowColor: 'rgba(0, 0, 0, 0.5)',
                    },
                },
                label: {
                    show: true,
                    formatter: '{b}: {d}%',
                    fontSize: labelFontSize,
                    width: labelBudget,
                    overflow: 'break',     // word-wrap long labels
                },
                labelLine: {
                    show: true,
                },
                itemStyle: {
                    borderRadius: chartProperties?.cornerRadius ?? 0,
                },
            }],
            // Assign colors
            color: DEFAULT_COLORS,
        };

        // Canvas size from context
        option._width = canvasW;
        option._height = canvasH;

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'innerRadius', label: 'Donut', type: 'continuous', min: 0, max: 60, step: 5, defaultValue: 0 } as ChartPropertyDef,
        { key: 'cornerRadius', label: 'Corners', type: 'continuous', min: 0, max: 10, step: 1, defaultValue: 0 } as ChartPropertyDef,
    ],
};
