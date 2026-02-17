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
import { extractCategories, DEFAULT_COLORS } from './utils';

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

        // Estimate legend width from label text
        const maxLabelLen = Math.max(...pieData.map(d => d.name.length), 3);
        const estimatedLegendWidth = Math.min(150, maxLabelLen * 7 + 30); // icon + padding

        // Enforce minimum canvas for pie readability
        const canvasW = Math.max(ctx.canvasSize.width, 300);
        const canvasH = Math.max(ctx.canvasSize.height, 250);
        const isSmall = canvasW <= 350 || canvasH <= 300;

        // Compute pie radius and center based on available space
        const legendSpace = estimatedLegendWidth + 20; // legend + gap
        const availableForPie = canvasW - legendSpace;
        const pieCenterX = `${Math.round(availableForPie / 2)}px`;
        const pieCenterY = '50%';
        const maxPieRadius = Math.min(availableForPie, canvasH - 20) / 2;
        const outerRadiusPx = Math.max(60, Math.round(maxPieRadius * 0.85));
        const outerRadius = `${outerRadiusPx}px`;

        const option: any = {
            tooltip: {
                trigger: 'item',
                formatter: '{b}: {c} ({d}%)',
            },
            legend: {
                data: pieData.map(d => d.name),
                type: pieData.length > 8 ? 'scroll' : 'plain',
                orient: 'vertical',
                right: 10,
                top: 'middle',
                textStyle: { fontSize: 11 },
            },
            series: [{
                type: 'pie',
                radius: innerRadius > 0
                    ? [`${Math.round(outerRadiusPx * innerRadius / 100)}px`, outerRadius]
                    : ['0%', outerRadius],
                center: [pieCenterX, pieCenterY],
                data: pieData,
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowOffsetX: 0,
                        shadowColor: 'rgba(0, 0, 0, 0.5)',
                    },
                },
                label: {
                    show: !isSmall,
                    formatter: '{b}: {d}%',
                    fontSize: 11,
                },
                labelLine: {
                    show: !isSmall,
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
