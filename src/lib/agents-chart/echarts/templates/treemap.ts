// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Treemap template.
 *
 * Unique to ECharts — no native Vega-Lite equivalent.
 * Displays hierarchical data as nested rectangles where area encodes value.
 *
 * Data model:
 *   color  (nominal): top-level category
 *   size   (quantitative): value (mapped to rectangle area)
 *   detail (nominal, optional): sub-category for two-level hierarchy
 *
 * If only color + size: flat treemap with one level.
 * If color + size + detail: two-level hierarchy (color → detail → value).
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, DEFAULT_COLORS } from './utils';
import { getPaletteForScheme } from '../../core/color-decisions';
import { computeEffectiveBarCount } from '../../core/decisions';

export const ecTreemapDef: ChartTemplateDef = {
    chart: 'Treemap',
    template: { mark: 'rect', encoding: {} },
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

        // Build treemap data
        let treemapData: any[];

        if (subCatField) {
            // Two-level hierarchy: color → detail → value
            treemapData = categories.map((cat, catIdx) => {
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
            // Flat treemap: one level
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

            treemapData = categories.map((cat, i) => ({
                name: cat,
                value: agg.get(cat) ?? 0,
                itemStyle: { color: palette![i % palette!.length] },
            }));
        }

        // ── Scaling: treat treemap items as variable-width vertical bars ──
        // Use effective bar count (total/min) to determine if the treemap
        // needs more area. Both axes share the area stretch but X takes
        // a larger share via the xBias factor:
        //   stretchX = areaStretch^(xBias/(xBias+1))
        //   stretchY = areaStretch^(1/(xBias+1))
        //   stretchX × stretchY = areaStretch  (total area preserved)
        // xBias=1 → uniform, xBias=2 → X gets 2/3 of the log-stretch.
        const leafValues = treemapData.flatMap((d: any) =>
            d.children ? d.children.map((c: any) => c.value as number) : [d.value as number]
        ).filter((v: number) => v > 0);

        const effectiveCount = leafValues.length > 0
            ? computeEffectiveBarCount(leafValues)
            : categories.length;

        const baseW = ctx.canvasSize.width;
        const baseH = ctx.canvasSize.height;
        const minBarPx = 30;          // minimum width per effective bar
        const elasticity = 0.5;
        const maxStretch = ctx.assembleOptions?.maxStretch ?? 2.0;       // max per-axis stretch
        const xBias = 1.5;            // X takes more of the stretch than Y

        const pressure = (effectiveCount * minBarPx) / baseW;
        const areaStretch = pressure <= 1 ? 1 : Math.min(maxStretch * maxStretch, Math.pow(pressure, elasticity));
        const stretchX = Math.min(maxStretch, Math.pow(areaStretch, xBias / (xBias + 1)));
        const stretchY = Math.min(maxStretch, Math.pow(areaStretch, 1 / (xBias + 1)));

        const canvasW = Math.round(baseW * stretchX);
        const canvasH = Math.round(baseH * stretchY);

        const showBreadcrumb = chartProperties?.breadcrumb !== false;

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
                type: 'treemap',
                data: treemapData,
                width: '90%',
                height: showBreadcrumb ? '80%' : '90%',
                top: 10,
                left: 'center',
                roam: false,
                leafDepth: subCatField ? 2 : 1,
                breadcrumb: {
                    show: showBreadcrumb,
                    bottom: 5,
                },
                label: {
                    show: true,
                    formatter: '{b}',
                    fontSize: 12,
                },
                upperLabel: subCatField ? {
                    show: true,
                    height: 20,
                    fontSize: 11,
                    color: '#fff',
                } : undefined,
                levels: subCatField ? [
                    {
                        // Root level (hidden)
                        itemStyle: { borderWidth: 0, gapWidth: 2 },
                    },
                    {
                        // Top-level categories
                        itemStyle: {
                            borderWidth: 2,
                            borderColor: '#fff',
                            gapWidth: 2,
                        },
                        upperLabel: { show: true },
                    },
                    {
                        // Leaf level (sub-categories)
                        itemStyle: {
                            borderWidth: 1,
                            borderColor: 'rgba(255,255,255,0.5)',
                            gapWidth: 1,
                        },
                        label: { show: true, fontSize: 10 },
                        colorSaturation: [0.3, 0.6],
                        colorMappingBy: 'value',
                    },
                ] : [
                    {
                        itemStyle: {
                            borderWidth: 2,
                            borderColor: '#fff',
                            gapWidth: 2,
                        },
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
        {
            key: 'breadcrumb', label: 'Breadcrumb', type: 'discrete', options: [
                { value: true, label: 'Show (default)' },
                { value: false, label: 'Hide' },
            ],
        } as ChartPropertyDef,
    ],
};
