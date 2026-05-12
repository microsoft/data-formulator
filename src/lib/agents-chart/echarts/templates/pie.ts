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
import { extractCategories, computeCircumferencePressure, computeEffectiveBarCount } from './utils';

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
                // 增大 margin，给外侧标签留出更多画布空间，避免文字被裁切。
                margin: 80,
            });

        const canvasW = rawCanvasW;

        // ── Adaptive label sizing ─────────────────────────────────────
        // Scale font size and label width based on slice count so that
        // labels stay readable without crowding.
        const n = pieData.length;
        const labelFontSize = n <= 4 ? 13 : n <= 8 ? 11 : n <= 15 ? 10 : 9;

        // 估算最长标签需要的宽度（按字符数粗略估算），再反推饼图半径与标签宽度。
        const maxLabelChars = pieData.reduce((m, d) => {
            const len = String(d.name ?? '').length;
            return len > m ? len : m;
        }, 0);
        const approxCharWidth = labelFontSize * 0.55; // 略小一点，避免过度放大 label 宽度
        const neededLabelWidth = Math.max(40, maxLabelChars * approxCharWidth);

        // Label width budget: available space outside the pie on each side.
        // Shrink pie more when there are many slices or标签过长，以便让文字尽量完全展示在画布内。
        const baseRadiusFraction = n <= 4 ? 0.72 : n <= 8 ? 0.62 : n <= 15 ? 0.54 : 0.48;
        const halfCanvas = (canvasW - 40) / 2;
        const padding = 16;
        const maxLabelWidthAvailable = Math.max(40, halfCanvas - halfCanvas * baseRadiusFraction - padding);
        const labelBudget = Math.min(neededLabelWidth, maxLabelWidthAvailable);
        const radiusFraction = baseRadiusFraction;

        // 根据需要的文字宽度，适度调整引导线长度，但整体保持较短，避免文字被推到画布外。
        const labelLineLength = Math.max(10, Math.min(22, 10 + neededLabelWidth * 0.10));
        const labelLineLength2 = Math.max(8, Math.min(26, 8 + neededLabelWidth * 0.15));

        // Pie radius
        const outerRadiusPx = Math.max(60, Math.round(
            Math.min(pressureRadius,
                (canvasW - 40) / 2 * radiusFraction,
                (canvasH - 40) / 2 * radiusFraction)));
        const outerRadius = `${outerRadiusPx}px`;

        const categoryLabel = colorField ?? 'Category';
        const valueLabel = sizeField ?? 'Value';
        const option: any = {
            tooltip: { trigger: 'item' },
            _encodingTooltip: {
                trigger: 'item',
                parts: [
                    { from: 'name', label: categoryLabel },
                    { from: 'value', label: valueLabel, format: 'number' },
                ],
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
                // 让 ECharts 尝试自动避免标签重叠，并在必要时隐藏重叠标签，
                // 减少标签被挤到画布外的概率。
                avoidLabelOverlap: true,
                labelLayout: {
                    hideOverlap: true,
                },
                labelLine: {
                    show: true,
                    length: labelLineLength,
                    length2: labelLineLength2,
                },
                itemStyle: {
                    borderRadius: chartProperties?.cornerRadius ?? 0,
                },
            }],
            // 颜色由 ecApplyLayoutToSpec 根据 colorDecisions 设置 option.color
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
