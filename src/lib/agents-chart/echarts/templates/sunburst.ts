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
 *   Hues follow inner palette; inner opacity 100%, outer 80%.
 * If color + size + detail + group: three-ring (inner → middle → outer).
 *   Same base hue per inner branch: 100% / 80% / 60% opacity by depth.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, DEFAULT_COLORS, computeCircumferencePressure, computeEffectiveBarCount } from './utils';
import { getPaletteForScheme } from '../colormap';

function collectSunburstLeafValues(nodes: any[]): number[] {
    return nodes.flatMap((d: any) => {
        if (d.children?.length) {
            return collectSunburstLeafValues(d.children);
        }
        return [Number(d.value) || 0];
    });
}

/** Inner ring = 100%, middle = 80%, outer = 60% — same hue as inner (palette base). */
const SUNBURST_OPACITY_L1 = 1;
const SUNBURST_OPACITY_L2 = 0.8;
const SUNBURST_OPACITY_L3 = 0.6;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const s = hex.trim();
    let m = /^#?([0-9a-f]{6})$/i.exec(s);
    if (m) {
        const intVal = parseInt(m[1], 16);
        return { r: (intVal >> 16) & 255, g: (intVal >> 8) & 255, b: intVal & 255 };
    }
    m = /^#?([0-9a-f]{3})$/i.exec(s);
    if (m) {
        const x = m[1];
        const full = x.split('').map(c => c + c).join('');
        const intVal = parseInt(full, 16);
        return { r: (intVal >> 16) & 255, g: (intVal >> 8) & 255, b: intVal & 255 };
    }
    return null;
}

function sunburstColorWithOpacity(baseColor: string, alpha: number): string {
    const rgb = hexToRgb(baseColor);
    if (rgb) {
        return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
    }
    const rgbaM = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(baseColor.trim());
    if (rgbaM) {
        return `rgba(${rgbaM[1]},${rgbaM[2]},${rgbaM[3]},${alpha})`;
    }
    return baseColor;
}

export const ecSunburstDef: ChartTemplateDef = {
    chart: 'Sunburst Chart',
    template: { mark: 'arc', encoding: {} },
    channels: ['color', 'size', 'detail', 'group'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
        const catField = channelSemantics.color?.field;
        const valField = channelSemantics.size?.field;
        const subCatField = channelSemantics.detail?.field;
        const leafField = channelSemantics.group?.field;

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

        if (subCatField && leafField) {
            // Three-level: inner = color channel (100%), detail (80%), group leaves (60%)
            sunburstData = categories.map((cat, catIdx) => {
                const base = palette![catIdx % palette!.length];
                const catRows = table.filter(r => String(r[catField]) === cat);
                const subCats = extractCategories(catRows, subCatField);

                const children = subCats.map(sub => {
                    const subRows = catRows.filter(r => String(r[subCatField]) === sub);
                    const leaves = extractCategories(subRows, leafField);
                    const grandchildren = leaves.map(leaf => {
                        const leafRows = subRows.filter(r => String(r[leafField]) === leaf);
                        let value: number;
                        if (valField) {
                            value = leafRows.reduce((sum, r) => sum + (Number(r[valField]) || 0), 0);
                        } else {
                            value = leafRows.length;
                        }
                        return {
                            name: leaf,
                            value,
                            itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L3) },
                        };
                    });
                    return {
                        name: sub,
                        children: grandchildren,
                        itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L2) },
                    };
                });

                return {
                    name: cat,
                    children,
                    itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L1) },
                };
            });
        } else if (subCatField) {
            // Two-level: inner 100%, outer 80%
            sunburstData = categories.map((cat, catIdx) => {
                const base = palette![catIdx % palette!.length];
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
                    return {
                        name: sub,
                        value,
                        itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L2) },
                    };
                });

                return {
                    name: cat,
                    children,
                    itemStyle: { color: sunburstColorWithOpacity(base, SUNBURST_OPACITY_L1) },
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
            outerValues = collectSunburstLeafValues(sunburstData);
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
        const span = outerRadius - innerRadius;
        const ringThird1 = innerRadius + Math.round(span / 3);
        const ringThird2 = innerRadius + Math.round((2 * span) / 3);
        const ringHalf = Math.round(innerRadius + span * 0.5);

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
                    color: '#000000',
                },
                emphasis: {
                    focus: 'ancestor',
                    label: { color: '#000000' },
                },
                levels: subCatField && leafField ? [
                    {},
                    {
                        r0: `${innerRadius}px`,
                        r: `${ringThird1}px`,
                        label: { fontSize: 11, fontWeight: 'bold', color: '#000000' },
                        itemStyle: { borderWidth: 2, borderColor: '#fff' },
                    },
                    {
                        r0: `${ringThird1}px`,
                        r: `${ringThird2}px`,
                        label: { fontSize: 10, color: '#000000' },
                        itemStyle: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
                    },
                    {
                        r0: `${ringThird2}px`,
                        r: `${outerRadius}px`,
                        label: { fontSize: 9, color: '#000000' },
                        itemStyle: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
                    },
                ] : subCatField ? [
                    {}, // root
                    {
                        // Inner ring (top-level categories)
                        r0: `${innerRadius}px`,
                        r: `${ringHalf}px`,
                        label: { fontSize: 12, fontWeight: 'bold', color: '#000000' },
                        itemStyle: { borderWidth: 2, borderColor: '#fff' },
                    },
                    {
                        // Outer ring (sub-categories)
                        r0: `${ringHalf}px`,
                        r: `${outerRadius}px`,
                        label: { fontSize: 10, color: '#000000' },
                        itemStyle: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
                    },
                ] : [
                    {}, // root
                    {
                        label: { fontSize: 12, color: '#000000' },
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
