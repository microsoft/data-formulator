// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../types';

/**
 * Waterfall Chart template.
 *
 * Expects data with:
 *   - x (nominal): step labels in display order (e.g. "Revenue", "COGS", …)
 *   - y (quantitative): the delta/amount for each step
 *   - color (nominal, optional): a "Type" column with values like
 *     "start", "delta", "end" — used for identifying totals vs. changes.
 *
 * Uses a layered spec: bars + connector rules between steps.
 * Colors: warm beige for totals, muted green for increases, coral for decreases.
 */
export const waterfallCharts: ChartTemplateDef[] = [
    {
        chart: "Waterfall Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: (spec, encodings) => {
            const { x, y, color, column, row } = encodings;

            // Stash field names so postProcessor can build transforms + encodings.
            spec._wf = {
                xField: x?.field,
                yField: y?.field,
                colorField: color?.field,
            };

            if (!spec.encoding) spec.encoding = {};
            if (column) spec.encoding.column = column;
            if (row) spec.encoding.row = row;
        },
        properties: [
            {
                key: "cornerRadius", label: "Corners", type: "continuous",
                min: 0, max: 8, step: 1, defaultValue: 0,
            },
        ] as ChartPropertyDef[],
        postProcessor: (vgSpec: any, table: any[], config?: Record<string, any>, canvasSize?: { width: number; height: number }) => {
            const wf = vgSpec._wf || {};
            const xField: string = wf.xField || 'Category';
            const yField: string = wf.yField || 'Amount';
            const colorField: string | undefined = wf.colorField;
            delete vgSpec._wf;

            const hasTypeCol = !!colorField;
            const typeField = colorField || '__wf_type';

            // ── Transforms ───────────────────────────────────────────────
            const transforms: any[] = [];

            // Auto-infer type if no explicit type column
            if (!hasTypeCol) {
                transforms.push(
                    { window: [{ op: "row_number", as: "__wf_row" }] },
                    { joinaggregate: [{ op: "count", as: "__wf_total" }] },
                    {
                        calculate: `datum.__wf_row === 1 ? 'start' : datum.__wf_row === datum.__wf_total ? 'end' : 'delta'`,
                        as: typeField,
                    },
                );
            }

            // Running sum
            transforms.push({
                window: [{ op: "sum", field: yField, as: "__wf_sum_raw" }],
            });

            // For end rows, the Amount is the display total, not a delta —
            // override sum to exclude it (use the running total before this row).
            transforms.push({
                calculate: `datum['${typeField}'] === 'end' ? datum.__wf_sum_raw - datum['${yField}'] : datum.__wf_sum_raw`,
                as: "__wf_sum",
            });

            // previous_sum = bottom of floating bar
            transforms.push({
                calculate: `datum['${typeField}'] === 'end' ? 0 : datum.__wf_sum - datum['${yField}']`,
                as: "__wf_prev_sum",
            });

            // Color category: total for start/end, increase/decrease by sign
            transforms.push({
                calculate: `datum['${typeField}'] !== 'delta' ? 'total' : datum['${yField}'] >= 0 ? 'increase' : 'decrease'`,
                as: "__wf_color",
            });

            vgSpec.transform = transforms;

            // ── Shared x encoding ────────────────────────────────────────
            const xEnc = {
                field: xField,
                type: "ordinal" as const,
                sort: null,
                axis: { labelAngle: -45 },
            };

            // ── Build layered spec ───────────────────────────────────────
            // Preserve facet encodings from top level
            const facetEncodings: any = {};
            if (vgSpec.encoding?.column) facetEncodings.column = vgSpec.encoding.column;
            if (vgSpec.encoding?.row) facetEncodings.row = vgSpec.encoding.row;

            const cornerRadius = (config?.cornerRadius && config.cornerRadius > 0) ? config.cornerRadius : 0;

            vgSpec.encoding = {
                x: xEnc,
                ...facetEncodings,
            };

            vgSpec.layer = [
                // Bar layer
                {
                    mark: {
                        type: "bar",
                        ...(cornerRadius > 0 ? { cornerRadiusEnd: cornerRadius } : {}),
                    },
                    encoding: {
                        y: {
                            field: "__wf_prev_sum",
                            type: "quantitative",
                            title: yField,
                        },
                        y2: { field: "__wf_sum" },
                        color: {
                            field: "__wf_color",
                            type: "nominal",
                            scale: {
                                domain: ["total", "increase", "decrease"],
                                range: ["#f7e0b6", "#93c4aa", "#f78a64"],
                            },
                            legend: { title: "Type" },
                        },
                    },
                },
            ];

            // Remove top-level mark (now using layer)
            delete vgSpec.mark;

            return vgSpec;
        },
    },
];
