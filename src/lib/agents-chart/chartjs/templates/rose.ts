// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js Rose Chart (Nightingale / Coxcomb) template.
 *
 * Contrast with VL:
 *   VL: mark = "arc" with theta (angular extent fixed per slice) + radius (value)
 *   CJS: type = 'polarArea' — each wedge spans an equal angle, radius encodes value.
 *
 * Data model (long format):
 *   x (nominal): angular category (direction, month, etc.)
 *   y (quantitative): value mapped to wedge radius
 *   color (nominal, optional): stack / group variable
 *
 * Note: Chart.js polarArea doesn't support native stacking. When a color
 * field is present we aggregate per category (sum across groups) and show
 * the total, with the legend listing the color groups for reference.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import {
    extractCategories,
    groupBy,
    DEFAULT_COLORS,
    DEFAULT_BG_COLORS,
    getChartJsPalette,
    getSeriesBorderColor,
    getSeriesBackgroundColor,
} from './utils';

export const cjsRoseChartDef: ChartTemplateDef = {
    chart: 'Rose Chart',
    template: { mark: 'arc', encoding: {} },
    channels: ['x', 'y', 'color', 'column', 'row'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const catField = channelSemantics.x?.field;   // angular categories
        const valField = channelSemantics.y?.field;    // wedge radius value
        const colorField = channelSemantics.color?.field; // optional grouping

        if (!catField || !valField) return;

        const palette = getChartJsPalette(ctx, 'color');

        // Extract unique angular categories
        const categories = extractCategories(table, catField, channelSemantics.x?.ordinalSortOrder);
        if (categories.length === 0) return;

        let labels: string[];
        let values: number[];
        let bgColors: string[];
        let borderColors: string[];

        if (colorField) {
            // Stacked: aggregate per (category × group), then sum across groups per category
            const groups = groupBy(table, colorField);
            const groupNames = [...groups.keys()];

            // Build per-category totals
            const catTotals = new Map<string, number>();
            for (const cat of categories) catTotals.set(cat, 0);

            for (const [, rows] of groups) {
                for (const row of rows) {
                    const cat = String(row[catField] ?? '');
                    const val = Number(row[valField]) || 0;
                    if (catTotals.has(cat)) {
                        catTotals.set(cat, catTotals.get(cat)! + val);
                    }
                }
            }

            labels = categories;
            values = categories.map(c => catTotals.get(c) ?? 0);

            // Assign distinct colors per wedge (category)
            bgColors = categories.map((_, i) => getSeriesBackgroundColor(palette, i, 0.6));
            borderColors = categories.map((_, i) => getSeriesBorderColor(palette, i));
        } else {
            // Simple: one value per category
            const catAgg = new Map<string, number>();
            for (const row of table) {
                const cat = String(row[catField] ?? '');
                const val = Number(row[valField]) || 0;
                catAgg.set(cat, (catAgg.get(cat) ?? 0) + val);
            }

            labels = categories;
            values = categories.map(c => catAgg.get(c) ?? 0);
            bgColors = categories.map((_, i) => getSeriesBackgroundColor(palette, i, 0.6));
            borderColors = categories.map((_, i) => getSeriesBorderColor(palette, i));
        }

        // Alignment: 'center' puts wedge center at 12 o'clock,
        // 'left' puts wedge left edge at 12 o'clock.
        const alignment = ctx.chartProperties?.alignment ?? 'left';
        const n = categories.length;
        // Chart.js polarArea: startAngle 0 = 12 o'clock, CW.
        // Default (startAngle=0) is left alignment.
        // For center: offset by -halfSlice degrees.
        const startAngle = alignment === 'center' && n > 0
            ? -(180 / n)
            : 0;

        const config: any = {
            type: 'polarArea',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                startAngle,
                scales: {
                    r: {
                        beginAtZero: true,
                        ticks: { display: true },
                    },
                },
                plugins: {
                    legend: { display: true, position: 'right' as const },
                    tooltip: { enabled: true },
                },
            },
            _width: Math.max(ctx.canvasSize.width, 350),
            _height: Math.max(ctx.canvasSize.height, 300),
        };

        Object.assign(spec, config);
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
