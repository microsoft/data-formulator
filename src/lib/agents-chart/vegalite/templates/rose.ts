// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Rose Chart (Nightingale / Coxcomb chart) template.
 *
 * A rose chart is essentially a bar chart on a polar axis:
 *   - x (categorical)  → theta (angular position of each category)
 *   - y (quantitative)  → radius (bar height / sector radius)
 *   - color             → stacking within each angular slice (like stacked bar)
 *
 * Implementation note: the template uses a flat (non-layered) spec as its
 * base.  For non-faceted charts the instantiate function dynamically adds
 * a text-label layer.  Faceted charts stay flat and use encoding.facet,
 * because the restructureFacets pipeline path (facet + spec.layer) does
 * not render arc marks correctly.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { setMarkProp } from './utils';

export const roseChartDef: ChartTemplateDef = {
    chart: "Rose Chart",
    template: {
        mark: {
            type: "arc",
            stroke: "white",
            padAngle: 0.02,
        },
        encoding: {},
    },
    channels: ["x", "y", "color", "column", "row"],
    markCognitiveChannel: 'area',

    // Polar charts have no positional axes — declare no banded axes
    // so the layout pipeline won't produce step-based sizing.
    declareLayoutMode: () => ({}),

    instantiate: (spec, ctx) => {
        if (!spec.encoding) spec.encoding = {};

        const { x, y, color, column, row, ...rest } = ctx.resolvedEncodings;
        const isFaceted = !!(column || row);

        // ── theta encoding (shared) ──
        if (x) {
            const thetaEnc: any = { ...x };
            if (thetaEnc.type === 'quantitative' || thetaEnc.type === 'temporal') {
                thetaEnc.type = 'nominal';
            }
            // Remove sort references to positional channels (x/y) — they are
            // remapped to theta/radius and Vega-Lite can't resolve "-y" etc.
            if (typeof thetaEnc.sort === 'string' && /^-?[xy]$/.test(thetaEnc.sort)) {
                delete thetaEnc.sort;
            }
            delete thetaEnc.scale;
            thetaEnc.stack = true;

            // Rotate so the first slice aligns to 12 o'clock.
            // 'center' (default): wedge center at top; 'left': wedge left edge at top.
            const n = new Set(ctx.table.map((r: any) => r[x.field])).size;
            if (n > 0) {
                const alignment = ctx.chartProperties?.alignment ?? 'left';
                if (alignment === 'center') {
                    const halfSlice = Math.PI / n;
                    thetaEnc.scale = { range: [-halfSlice, 2 * Math.PI - halfSlice] };
                }
                // 'left': no range offset needed — default [0, 2π] puts left edge at top
            }

            spec.encoding.theta = thetaEnc;
        }

        // ── Build radius encoding ──
        let radiusEnc: any | undefined;
        let radiusField: string | undefined;
        if (y) {
            radiusEnc = { ...y };
            if (typeof radiusEnc.sort === 'string' && /^-?[xy]$/.test(radiusEnc.sort)) {
                delete radiusEnc.sort;
            }
            radiusEnc.scale = { type: 'sqrt' };
            if (color) {
                radiusEnc.stack = true;
            }
            radiusField = radiusEnc.field;
        }

        // ── Build color encoding ──
        let colorEnc: any | undefined;
        if (color) {
            colorEnc = color;
        } else if (x) {
            // No color channel: color by category (like a pie chart)
            colorEnc = { field: x.field, type: x.type || 'nominal' };
            if (Array.isArray(x.sort)) {
                colorEnc.sort = x.sort;
            }
        }

        if (isFaceted) {
            // ── FACETED: keep flat spec with encoding.facet ──
            // The VL facet + spec.layer restructuring doesn't render arc
            // marks correctly.  Using encoding.facet inline on a unit
            // spec (single mark) works reliably.
            if (radiusEnc) spec.encoding.radius = radiusEnc;
            if (colorEnc)  spec.encoding.color  = colorEnc;

            if (column && !row) {
                const facetEnc: any = { ...column };
                const facetCount = new Set(ctx.table.map((r: any) => r[column.field])).size;
                facetEnc.columns = facetCount <= 6
                    ? facetCount
                    : Math.ceil(Math.sqrt(facetCount));
                spec.encoding.facet = facetEnc;
            } else if (row && !column) {
                spec.encoding.row = row;
            } else {
                spec.encoding.column = column;
                spec.encoding.row = row;
            }
        } else {
            // ── NON-FACETED: convert to layered spec for text labels ──
            const arcMark = spec.mark;
            spec.layer = [
                { mark: arcMark, encoding: {} as any },
                {
                    mark: { type: "text", radiusOffset: 15, fontSize: 11 },
                    encoding: {} as any,
                },
            ];
            delete spec.mark;

            // radius → arc layer only
            if (radiusEnc) {
                spec.layer[0].encoding.radius = radiusEnc;
            }

            // color → arc layer only (so text layer isn't split by color)
            if (colorEnc) {
                spec.layer[0].encoding.color = colorEnc;
            }

            // text label layer: one label per category
            if (x && spec.layer[1]) {
                const textLayer = spec.layer[1];
                textLayer.encoding.text = { field: x.field, type: x.type || 'nominal' };

                if (radiusField) {
                    // Aggregate: collapse to one row per category so labels
                    // aren't duplicated per color segment.
                    textLayer.transform = [
                        {
                            aggregate: [{ op: 'sum', field: radiusField, as: radiusField }],
                            groupby: [x.field],
                        },
                    ];
                    textLayer.encoding.radius = {
                        field: radiusField,
                        type: 'quantitative',
                        scale: { type: 'sqrt' },
                    };
                }
            }
        }

        // ── Fallbacks ──
        const hasRadius = spec.encoding.radius || spec.layer?.[0]?.encoding?.radius;
        if (!hasRadius) {
            const fallback = { aggregate: 'count', type: 'quantitative', scale: { type: 'sqrt' } };
            if (spec.layer) {
                spec.layer[0].encoding.radius = fallback;
            } else {
                spec.encoding.radius = fallback;
            }
        }
        if (!spec.encoding.theta) {
            spec.encoding.theta = { aggregate: 'count', type: 'quantitative' };
        }

        // ── Pass-through channels ──
        const mappedChannels = new Set(['x', 'y', 'color', 'column', 'row', 'radius', 'size', 'theta', 'facet']);
        for (const [ch, enc] of Object.entries(rest)) {
            if (mappedChannels.has(ch)) continue;
            if (!enc.field && !enc.aggregate) continue;
            spec.encoding[ch] = enc;
        }

        // ── Sizing: square aspect ratio ──
        // Use subplot dimensions (which account for faceting).
        const subW = ctx.layout.subplotWidth ?? ctx.canvasSize.width;
        const subH = ctx.layout.subplotHeight ?? ctx.canvasSize.height;
        const size = Math.min(subW, subH);
        spec.width = size;
        spec.height = size;

        // ── Chart properties ──
        const config = ctx.chartProperties;
        if (config) {
            const markTarget = spec.layer ? spec.layer[0] : spec;
            if (config.innerRadius > 0) {
                markTarget.mark = setMarkProp(markTarget.mark, 'innerRadius', config.innerRadius);
            }
            if (config.padAngle > 0) {
                markTarget.mark = setMarkProp(markTarget.mark, 'padAngle', config.padAngle);
            }
        }
    },

    properties: [
        { key: "innerRadius", label: "Inner Radius", type: "continuous", min: 0, max: 100, step: 5, defaultValue: 0 },
        { key: "padAngle", label: "Gap", type: "continuous", min: 0, max: 0.1, step: 0.005, defaultValue: 0 },
        {
            key: 'alignment', label: 'Alignment', type: 'discrete', options: [
                { value: 'left', label: 'Left (default)' },
                { value: 'center', label: 'Center' },
            ],
        },
    ] as ChartPropertyDef[],
};
