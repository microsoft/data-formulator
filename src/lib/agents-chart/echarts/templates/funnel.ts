// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Funnel Chart template.
 *
 * Unique to ECharts — no Vega-Lite equivalent.
 * Displays a funnel (descending trapezoids) showing sequential stage values,
 * commonly used for conversion pipelines (e.g., visits → signups → purchases).
 *
 * Data model:
 *   y    (nominal): stage name / category — drives vertical sizing via spring model
 *   size (quantitative): value for each stage — drives trapezoid width
 *
 * Each row represents one stage. Multiple rows per stage are aggregated (sum).
 *
 * Scaling: the `y` channel is declared as banded, so the spring model in
 * `computeLayout` decides `yStep` (px per stage).  Height = yStep × stageCount.
 * The `defaultStepMultiplier: 2.5` gives each stage generous vertical space
 * (≈50-67px default vs 20-27px for bars).
 *
 * The template does NOT create yAxis/xAxis in the ECharts option, so
 * `ecApplyLayoutToSpec` correctly skips grid processing.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, DEFAULT_COLORS } from './utils';
import { getPaletteForScheme } from '../colormap';

export const ecFunnelChartDef: ChartTemplateDef = {
    chart: 'Funnel Chart',
    template: { mark: 'rect', encoding: {} },
    channels: ['y', 'size'],
    markCognitiveChannel: 'area',
    declareLayoutMode: () => ({
        axisFlags: { y: { banded: true } },
        paramOverrides: {
            defaultStepMultiplier: 2.5,  // taller bands for funnel stages
        },
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties, layout, colorDecisions } = ctx;
        const stageField = channelSemantics.y?.field;
        const valField = channelSemantics.size?.field;

        if (!stageField) return;

        // Extract stages (categories from y channel)
        const stages = extractCategories(
            table, stageField, channelSemantics.y?.ordinalSortOrder,
        );
        if (stages.length === 0) return;

        // ── Resolve color palette from backend-agnostic color decisions ──
        const decision = colorDecisions?.color ?? colorDecisions?.group;
        let palette: string[] | undefined;
        if (decision?.schemeId) {
            const fromRegistry = getPaletteForScheme(decision.schemeId);
            if (fromRegistry && fromRegistry.length > 0) {
                palette = fromRegistry;
            }
        }
        if (!palette || palette.length === 0) {
            const catCount = stages.length;
            const fallbackId = catCount > 10 ? 'cat20' : 'cat10';
            palette = getPaletteForScheme(fallbackId) ?? DEFAULT_COLORS;
        }

        // Aggregate values per stage
        const funnelData: { name: string; value: number }[] = [];
        if (valField) {
            const agg = new Map<string, number>();
            for (const row of table) {
                const stage = String(row[stageField] ?? '');
                const val = Number(row[valField]) || 0;
                agg.set(stage, (agg.get(stage) ?? 0) + val);
            }
            for (const stage of stages) {
                funnelData.push({ name: stage, value: agg.get(stage) ?? 0 });
            }
        } else {
            // No value field — count occurrences per stage
            const counts = new Map<string, number>();
            for (const row of table) {
                const stage = String(row[stageField] ?? '');
                counts.set(stage, (counts.get(stage) ?? 0) + 1);
            }
            for (const stage of stages) {
                funnelData.push({ name: stage, value: counts.get(stage) ?? 0 });
            }
        }

        // Sort by value (largest first) for funnel shape
        const sortOrder = chartProperties?.sort ?? 'descending';
        if (sortOrder === 'descending') {
            funnelData.sort((a, b) => b.value - a.value);
        } else if (sortOrder === 'ascending') {
            funnelData.sort((a, b) => a.value - b.value);
        }
        // 'none' preserves original stage order

        // ── Layout-driven sizing ─────────────────────────────────────────
        // Use spring model results: yStep × stageCount → funnel body height
        const stageCount = layout.yNominalCount || stages.length;
        const yStep = layout.yStep;
        const funnelBodyH = Math.max(120, yStep * stageCount);

        const topMargin = 30;
        const bottomMargin = 20;
        const canvasH = funnelBodyH + topMargin + bottomMargin;

        // Estimate legend width from label text
        const maxLabelLen = Math.max(...funnelData.map(d => d.name.length), 3);
        const estimatedLegendWidth = Math.min(150, maxLabelLen * 7 + 30);

        const canvasW = Math.max(ctx.canvasSize.width, 300);

        // Leave room for legend on the right
        const funnelLeft = 40;
        const funnelRight = estimatedLegendWidth + 30;
        const funnelWidth = `${Math.max(100, canvasW - funnelLeft - funnelRight)}px`;

        const orient = chartProperties?.orient ?? 'vertical';

        const option: any = {
            tooltip: {
                trigger: 'item',
                formatter: '{b}: {c} ({d}%)',
            },
            legend: {
                data: funnelData.map(d => d.name),
                type: funnelData.length > 8 ? 'scroll' : 'plain',
                orient: 'vertical',
                right: 10,
                top: 'middle',
                textStyle: { fontSize: 11 },
            },
            series: [{
                type: 'funnel',
                left: funnelLeft,
                top: topMargin,
                bottom: bottomMargin,
                width: funnelWidth,
                sort: sortOrder,
                orient,
                gap: chartProperties?.gap ?? 2,
                data: funnelData.map((d, idx) => ({
                    ...d,
                    itemStyle: {
                        ...(palette ? { color: palette[idx % palette.length] } : {}),
                    },
                })),
                label: {
                    show: true,
                    position: 'inside',
                    formatter: '{b}\n{c}',
                    fontSize: 11,
                },
                emphasis: {
                    label: {
                        fontSize: 13,
                    },
                },
                itemStyle: {
                    borderColor: '#fff',
                    borderWidth: 1,
                },
            }],
            color: palette ?? DEFAULT_COLORS,
            _width: canvasW,
            _height: canvasH,
        };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        {
            key: 'sort', label: 'Sort', type: 'discrete', options: [
                { value: 'descending', label: 'Descending (default)' },
                { value: 'ascending', label: 'Ascending' },
                { value: 'none', label: 'Original order' },
            ],
        } as ChartPropertyDef,
        {
            key: 'orient', label: 'Orient', type: 'discrete', options: [
                { value: 'vertical', label: 'Vertical (default)' },
                { value: 'horizontal', label: 'Horizontal' },
            ],
        } as ChartPropertyDef,
        { key: 'gap', label: 'Gap', type: 'continuous', min: 0, max: 20, step: 1, defaultValue: 2 } as ChartPropertyDef,
    ],
};
