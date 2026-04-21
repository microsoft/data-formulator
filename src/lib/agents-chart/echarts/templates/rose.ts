// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Rose Chart (Nightingale / Coxcomb) template.
 *
 * Contrast with VL:
 *   VL: mark = "arc" with theta (angular extent fixed per slice) + radius (value)
 *   EC: series type = 'bar' with coordinateSystem = 'polar',
 *       angleAxis (categorical — directions/categories) +
 *       radiusAxis (value — the measure mapped to wedge radius).
 *
 * Data model (long format):
 *   x (nominal): angular category (direction, month, etc.)
 *   y (quantitative): value mapped to wedge radius
 *   color (nominal, optional): stack / group variable — stacked rose (one series per group).
 *   Without color: single polar bar series with one data item per category (each item named for
 *   legend). Multiple series would be grouped by ECharts and shrink each petal — wrong geometry.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, groupBy, computeCircumferencePressure } from './utils';

/**
 * Invisible pie series: polar `bar` has no `legendVisualProvider`, so ECharts would draw zero
 * legend rows (see LegendView.renderInner). Slices are not shown (radius 0); only names/colors
 * feed the legend. Must match `ecApplyLayoutToSpec` / facet polar merge.
 */
export const EC_ROSE_LEGEND_BRIDGE_SERIES_NAME = '__dfRoseLegendBridge__';

export const ecRoseChartDef: ChartTemplateDef = {
    chart: 'Rose Chart',
    template: { mark: 'arc', encoding: {} },
    channels: ['x', 'y', 'color', 'column', 'row'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const catField = channelSemantics.x?.field;   // angular categories
        const valField = channelSemantics.y?.field;    // wedge radius value
        const colorField = channelSemantics.color?.field; // stack groups

        if (!catField || !valField) return;

        // Extract unique angular categories (directions, months, etc.)
        const categories = extractCategories(table, catField, channelSemantics.x?.ordinalSortOrder);
        if (categories.length === 0) return;

        // Build series data
        const seriesArr: any[] = [];
        const legendData: string[] = [];

        if (colorField) {
            // Stacked rose: one series per color group
            const groups = groupBy(table, colorField);

            for (const [name, rows] of groups) {
                legendData.push(name);

                // Aggregate: sum per category
                const catAgg = new Map<string, number>();
                for (const row of rows) {
                    const cat = String(row[catField] ?? '');
                    const val = Number(row[valField]) || 0;
                    catAgg.set(cat, (catAgg.get(cat) ?? 0) + val);
                }

                const values = categories.map(c => catAgg.get(c) ?? 0);

                seriesArr.push({
                    type: 'bar',
                    name,
                    data: values,
                    coordinateSystem: 'polar',
                    stack: 'rose',
                    emphasis: { focus: 'series' },
                });
            }
        } else {
            // No color channel: one series, one value per angle — full wedge width. Per-item colors
            // + legend are applied in ecApplyLayoutToSpec (multi-series would trigger grouped barWidth).
            const catAgg = new Map<string, number>();
            for (const row of table) {
                const cat = String(row[catField] ?? '');
                const val = Number(row[valField]) || 0;
                catAgg.set(cat, (catAgg.get(cat) ?? 0) + val);
            }

            const values = categories.map(c => catAgg.get(c) ?? 0);
            for (const c of categories) {
                legendData.push(String(c));
            }

            seriesArr.push({
                type: 'bar',
                data: categories.map((c, i) => ({
                    value: values[i],
                    name: String(c),
                })),
                coordinateSystem: 'polar',
                emphasis: { focus: 'series' },
            });
            // Legend binding (bar alone does not implement legendVisualProvider in ECharts).
            seriesArr.push({
                type: 'pie',
                name: EC_ROSE_LEGEND_BRIDGE_SERIES_NAME,
                z: -10,
                silent: true,
                tooltip: { show: false },
                radius: 0,
                center: ['50%', '50%'],
                label: { show: false },
                labelLine: { show: false },
                emphasis: { disabled: true },
                data: categories.map(c => ({
                    name: String(c),
                    value: 1,
                    label: { show: false },
                    labelLine: { show: false },
                })),
            });
        }

        // Alignment: 'center' puts wedge center at 12 o'clock,
        // 'left' puts wedge left edge at 12 o'clock.
        const alignment = ctx.chartProperties?.alignment ?? 'left';
        const n = categories.length;
        // ECharts angleAxis: startAngle is where the first wedge's LEFT edge begins,
        // and categories proceed clockwise (decreasing angle).
        // Left alignment: startAngle=90 → left edge at top.
        // Center alignment: shift forward (increase) by half a wedge so the center lands at top.
        const startAngle = alignment === 'center' && n > 0
            ? 90 + 180 / n
            : 90;

        const hasLegend = legendData.length > 0;

        // Estimate legend width from label text
        const maxLabelLen = hasLegend ? Math.max(...legendData.map(d => d.length), 3) : 0;
        const estimatedLegendWidth = hasLegend ? Math.min(150, maxLabelLen * 7 + 40) : 0;

        // ── Circumference-pressure sizing (spring model) ──────────────
        // Rose: uniform angular width — each petal is one "bar".
        const { radius: pressureRadius, canvasW: rawCanvasW, canvasH }
            = computeCircumferencePressure(categories.length, ctx.canvasSize, {
                minArcPx: 45,
                minRadius: 80,
                maxStretch: ctx.assembleOptions?.maxStretch,
            });

        // Canvas size — grow width to fit legend without squeezing the chart
        const canvasW = rawCanvasW + (hasLegend ? estimatedLegendWidth : 0);

        // Shrink polar radius and shift center left to leave room for legend
        const polarRadius = hasLegend
            ? Math.min(pressureRadius, (canvasW - estimatedLegendWidth - 40) / 2, (canvasH - 40) / 2)
            : pressureRadius;
        const polarCenter = hasLegend
            ? [`${Math.round((canvasW - estimatedLegendWidth) / 2)}px`, '50%']
            : undefined;

        const option: any = {
            tooltip: {
                trigger: 'item',
            },
            angleAxis: {
                type: 'category',
                data: categories,
                startAngle,
            },
            radiusAxis: {
                // hide axis line for cleaner look
                axisLine: { show: false },
                axisTick: { show: false },
            },
            polar: {
                radius: polarRadius,
                ...(polarCenter != null ? { center: polarCenter } : {}),
            },
            series: seriesArr,
            // 颜色调色板由 color-decisions / ecApplyLayoutToSpec 注入到 option.color
            // Canvas size
            _width: canvasW,
            _height: canvasH,
        };

        if (hasLegend) {
            option.legend = {
                data: legendData,
                type: legendData.length > 8 ? 'scroll' : 'plain',
                orient: 'vertical',
                right: 10,
                top: 'middle',
                textStyle: { fontSize: 11 },
            };
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        {
            key: 'alignment', label: 'Alignment', type: 'discrete', options: [
                { value: 'left', label: 'Left (default)' },
                { value: 'center', label: 'Center' },
            ],
        } as ChartPropertyDef,
    ],
};
