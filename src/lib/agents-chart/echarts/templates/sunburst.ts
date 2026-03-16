// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Sunburst Chart template.
 *
 * Unique to ECharts — no native Vega-Lite equivalent.
 * Displays hierarchical data as concentric rings where angular extent
 * encodes value and ring level encodes hierarchy depth.
 *
 * Data model:
 *   color  (nominal): top-level category (outer ring or first ring)
 *   size   (quantitative): value (mapped to angular extent)
 *   detail (nominal, optional): sub-category for two-level hierarchy
 *
 * If only color + size: single-ring sunburst (same as pie but styled differently).
 * If color + size + detail: two-ring sunburst (color = inner, detail = outer).
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, DEFAULT_COLORS, computeCircumferencePressure, computeEffectiveBarCount } from './utils';
import { getPaletteForScheme } from '../../core/color-decisions';

export const ecSunburstDef: ChartTemplateDef = {
    chart: 'Sunburst Chart',
    template: { mark: 'arc', encoding: {} },
    channels: ['color', 'size', 'detail'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
        const catField = channelSemantics.color?.field;
        const valField = channelSemantics.size?.field;
        const subCatField = channelSemantics.detail?.field;

        if (!catField) return;

        const categories = extractCategories(table, catField, channelSemantics.color?.ordinalSortOrder);
        if (categories.length === 0) return;

        // ── Resolve palette from backend-agnostic color decisions ────────
        const decision = colorDecisions?.color ?? colorDecisions?.group;
        let palette: string[] | undefined;
        if (decision?.schemeId) {
            const fromRegistry = getPaletteForScheme(decision.schemeId);
            if (fromRegistry && fromRegistry.length > 0) {
                palette = fromRegistry;
            }
        }
        if (!palette || palette.length === 0) {
            const catCount = categories.length;
            const fallbackId = catCount > 10 ? 'cat20' : 'cat10';
            palette = getPaletteForScheme(fallbackId) ?? DEFAULT_COLORS;
        }

        // Build sunburst data (hierarchical tree structure)
        let sunburstData: any[];

        if (subCatField) {
            // Two-level hierarchy: color (inner ring) → detail (outer ring)
            sunburstData = categories.map((cat, catIdx) => {
                const catRows = table.filter(r => String(r[catField]) === cat);
                const subCats = extractCategories(catRows, subCatField);

                const children = subCats.map(sub => {
                    const subRows = catRows.filter(r => String(r[subCatField]) === sub);
                    let value: number;
                    if (valField) {
                        value = subRows.reduce((sum, r) => sum + (Number(r[valField]) || 0), 0);
                    } else {
                        value = subRows.length;
                    }
                    return { name: sub, value };
                });

                return {
                    name: cat,
                    children,
                    itemStyle: { color: palette![catIdx % palette!.length] },
                };
            });
        } else {
            // Flat: single ring
            const agg = new Map<string, number>();
            if (valField) {
                for (const row of table) {
                    const cat = String(row[catField] ?? '');
                    const val = Number(row[valField]) || 0;
                    agg.set(cat, (agg.get(cat) ?? 0) + val);
                }
            } else {
                for (const row of table) {
                    const cat = String(row[catField] ?? '');
                    agg.set(cat, (agg.get(cat) ?? 0) + 1);
                }
            }

            sunburstData = categories.map((cat, i) => ({
                name: cat,
                value: agg.get(cat) ?? 0,
                itemStyle: { color: palette![i % palette!.length] },
            }));
        }

        // ── Circumference-pressure sizing (spring model) ──────────────
        // Compute effective bar count from outer-ring leaf values.
        // For two-level hierarchy: use the outer-ring leaves.
        // For flat: use slice values directly.
        let outerValues: number[];
        if (subCatField) {
            // Outer ring: collect all leaf values
            outerValues = sunburstData.flatMap(
                d => d.children?.map((c: any) => c.value as number) ?? []);
        } else {
            outerValues = sunburstData.map((d: any) => d.value as number);
        }
        const effectiveCount = computeEffectiveBarCount(outerValues);

        const { radius: pressureRadius, canvasW, canvasH }
            = computeCircumferencePressure(effectiveCount, ctx.canvasSize, {
                minArcPx: 45,
                minRadius: 80,
                maxStretch: ctx.assembleOptions?.maxStretch,
            });

        const outerRadius = Math.max(80, Math.round(Math.min(pressureRadius, (Math.min(canvasW, canvasH) / 2 - 20))));
        const innerRadius = chartProperties?.innerRadius ?? Math.round(outerRadius * 0.15);

        const option: any = {
            tooltip: {
                trigger: 'item',
                formatter: (params: any) => {
                    const { name, value, treePathInfo } = params;
                    const path = treePathInfo
                        ? treePathInfo.map((n: any) => n.name).filter(Boolean).join(' → ')
                        : name;
                    return `${path}<br/>Value: ${value}`;
                },
            },
            series: [{
                type: 'sunburst',
                data: sunburstData,
                radius: [`${innerRadius}px`, `${outerRadius}px`],
                center: ['50%', '50%'],
                label: {
                    show: true,
                    rotate: chartProperties?.labelRotate ?? 'radial',
                    fontSize: 11,
                },
                emphasis: {
                    focus: 'ancestor',
                },
                levels: subCatField ? [
                    {}, // root
                    {
                        // Inner ring (top-level categories)
                        r0: `${innerRadius}px`,
                        r: `${Math.round(innerRadius + (outerRadius - innerRadius) * 0.5)}px`,
                        label: { fontSize: 12, fontWeight: 'bold' },
                        itemStyle: { borderWidth: 2, borderColor: '#fff' },
                    },
                    {
                        // Outer ring (sub-categories)
                        r0: `${Math.round(innerRadius + (outerRadius - innerRadius) * 0.5)}px`,
                        r: `${outerRadius}px`,
                        label: { fontSize: 10 },
                        itemStyle: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
                    },
                ] : [
                    {}, // root
                    {
                        label: { fontSize: 12 },
                        itemStyle: { borderWidth: 2, borderColor: '#fff' },
                    },
                ],
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
        { key: 'innerRadius', label: 'Inner R', type: 'continuous', min: 0, max: 80, step: 5, defaultValue: 0 } as ChartPropertyDef,
        {
            key: 'labelRotate', label: 'Labels', type: 'discrete', options: [
                { value: 'radial', label: 'Radial (default)' },
                { value: 'tangential', label: 'Tangential' },
                { value: 0, label: 'Horizontal' },
            ],
        } as ChartPropertyDef,
    ],
};
