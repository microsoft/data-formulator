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
export const waterfallChartDef: ChartTemplateDef = {
        chart: "Waterfall Chart",
        template: {
            mark: "bar",
            encoding: {},
        },
        channels: ["x", "y", "color", "column", "row"],
        buildEncodings: (spec, encodings, context) => {
            // Waterfall uses bars — x axis is banded
            context.axisFlags = { x: { banded: true } };
            const { x, y, color, column, row } = encodings;
            const config = context.chartProperties;

            const xField: string = x?.field || 'Category';
            const yField: string = y?.field || 'Amount';
            const colorField: string | undefined = color?.field;

            if (!spec.encoding) spec.encoding = {};
            if (column) spec.encoding.column = column;
            if (row) spec.encoding.row = row;

            const hasTypeCol = !!colorField;
            const typeField = colorField || '__wf_type';

            // ── Transforms ───────────────────────────────────────────────
            const transforms: any[] = [];

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

            transforms.push({
                window: [{ op: "sum", field: yField, as: "__wf_sum_raw" }],
            });

            transforms.push({
                calculate: `datum['${typeField}'] === 'end' ? datum.__wf_sum_raw - datum['${yField}'] : datum.__wf_sum_raw`,
                as: "__wf_sum",
            });

            transforms.push({
                calculate: `datum['${typeField}'] === 'end' ? 0 : datum.__wf_sum - datum['${yField}']`,
                as: "__wf_prev_sum",
            });

            transforms.push({
                calculate: `datum['${typeField}'] !== 'delta' ? 'total' : datum['${yField}'] >= 0 ? 'increase' : 'decrease'`,
                as: "__wf_color",
            });

            spec.transform = transforms;

            // ── Shared x encoding ────────────────────────────────────────
            const xEnc = {
                field: xField,
                type: "ordinal" as const,
                sort: null,
                axis: { labelAngle: -45 },
            };

            // ── Preserve facet encodings ─────────────────────────────────
            const facetEncodings: any = {};
            if (spec.encoding?.column) facetEncodings.column = spec.encoding.column;
            if (spec.encoding?.row) facetEncodings.row = spec.encoding.row;

            const cornerRadius = (config?.cornerRadius && config.cornerRadius > 0) ? config.cornerRadius : 0;

            spec.encoding = {
                x: xEnc,
                ...facetEncodings,
            };

            spec.layer = [
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

            delete spec.mark;
        },
        properties: [
            {
                key: "cornerRadius", label: "Corners", type: "continuous",
                min: 0, max: 8, step: 1, defaultValue: 0,
            },
        ] as ChartPropertyDef[],
};
