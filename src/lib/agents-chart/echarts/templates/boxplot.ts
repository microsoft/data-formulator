// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Boxplot template.
 *
 * Contrast with VL:
 *   VL: mark = "boxplot" — VL computes quartiles automatically from raw data
 *   EC: series type = 'boxplot' — we compute quartiles client-side and pass
 *       [min, Q1, median, Q3, max] per category.
 *       Optionally an "outlier" scatter series.
 */

import { ChartTemplateDef } from '../../core/types';
import { extractCategories, groupBy, DEFAULT_COLORS, getCategoryOrder } from './utils';
import { detectBandedAxisForceDiscrete } from '../../vegalite/templates/utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/** True if all category labels parse as numbers → horizontal; otherwise vertical (x-axis only, same as line chart). */
function areCategoriesNumeric(cats: string[]): boolean {
    if (cats.length === 0) return true;
    return cats.every((c) => {
        const s = String(c).trim();
        if (s === '') return false;
        const n = Number(s);
        return !isNaN(n) && isFinite(n);
    });
}

/** Compute the five-number summary for an array of values. */
function fiveNumberSummary(values: number[]): [number, number, number, number, number] {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) return [0, 0, 0, 0, 0];
    if (n === 1) return [sorted[0], sorted[0], sorted[0], sorted[0], sorted[0]];

    const median = quantile(sorted, 0.5);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;

    // Whisker extent: min/max within 1.5×IQR
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const whiskerLow = sorted.find(v => v >= lowerFence) ?? sorted[0];
    const whiskerHigh = [...sorted].reverse().find(v => v <= upperFence) ?? sorted[n - 1];

    return [whiskerLow, q1, median, q3, whiskerHigh];
}

function quantile(sorted: number[], p: number): number {
    const n = sorted.length;
    const idx = p * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Find outliers outside 1.5×IQR fences. */
function findOutliers(values: number[]): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    return values.filter(v => v < lo || v > hi);
}

export const ecBoxplotDef: ChartTemplateDef = {
    chart: 'Boxplot',
    template: { mark: 'boxplot', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'position',
    declareLayoutMode: (cs, table) => {
        if (!cs.x?.field || !cs.y?.field) return {};
        const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: 'x' });
        if (!result) return {};
        return {
            axisFlags: { [result.axis]: { banded: true } },
            resolvedTypes: result.resolvedTypes,
        };
    },
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const colorField = channelSemantics.color?.field;
        const colorType = channelSemantics.color?.type;
        const colorIsDiscrete = colorField && isDiscrete(colorType);

        if (!xCS?.field || !yCS?.field) return;

        // Determine which axis is categorical and which is quantitative
        const xIsDiscrete = isDiscrete(xCS.type);
        const yIsDiscrete = isDiscrete(yCS.type);

        // Default: x is category, y is value
        let catAxis: 'x' | 'y' = 'x';
        let valAxis: 'x' | 'y' = 'y';
        if (yIsDiscrete && !xIsDiscrete) {
            catAxis = 'y';
            valAxis = 'x';
        }

        const catField = channelSemantics[catAxis]!.field!;
        const valField = channelSemantics[valAxis]!.field!;
        const catCS = channelSemantics[catAxis];
        const categories = extractCategories(table, catField, catCS?.ordinalSortOrder);

        const colorPalette = (ctx.resolvedEncodings as any)?.color?.colorPalette ?? DEFAULT_COLORS;
        const isHorizontal = catAxis === 'y';

        const catAxisLabel = {
            rotate: isHorizontal ? 0 : (areCategoriesNumeric(categories) ? 0 : 90),
        };
        const option: any = {
            tooltip: { trigger: 'item' },
            [isHorizontal ? 'yAxis' : 'xAxis']: {
                type: 'category',
                data: categories,
                name: catField,
                boundaryGap: true,
                axisTick: { show: true, alignWithLabel: true },
                axisLabel: catAxisLabel,
            },
            [isHorizontal ? 'xAxis' : 'yAxis']: {
                type: 'value',
                name: valField,
                axisTick: { show: true },
                axisLabel: { rotate: 0 },
            },
            series: [],
        };

        if (colorIsDiscrete && colorField) {
            // Grouped boxplot: one series per color value (e.g. Male, Female)
            const colorCategories = extractCategories(table, colorField, getCategoryOrder(ctx, 'color'));
            const catGroups = groupBy(table, catField);

            for (let cIdx = 0; cIdx < colorCategories.length; cIdx++) {
                const colorName = colorCategories[cIdx];
                const boxData: [number, number, number, number, number][] = [];
                const outlierData: [number, number][] = [];

                for (let i = 0; i < categories.length; i++) {
                    const cat = categories[i];
                    const rows = (catGroups.get(cat) || []).filter(
                        (r: any) => String(r[colorField] ?? '') === colorName,
                    );
                    const values = rows.map((r: any) => Number(r[valField])).filter(v => isFinite(v));
                    boxData.push(fiveNumberSummary(values));

                    const outliers = findOutliers(values);
                    for (const o of outliers) {
                        outlierData.push([i, o]);
                    }
                }

                const borderColor = colorPalette[cIdx % colorPalette.length];
                option.series.push({
                    name: colorName,
                    type: 'boxplot',
                    data: boxData,
                    itemStyle: { borderColor },
                });
                if (outlierData.length > 0) {
                    option.series.push({
                        name: colorName + ' (outliers)',
                        type: 'scatter',
                        data: outlierData,
                        symbolSize: 4,
                        itemStyle: { color: borderColor },
                    });
                }
            }

            option.legend = { data: colorCategories };
            option._legendTitle = colorField;
        } else {
            // Single boxplot series (no color grouping)
            const catGroups = groupBy(table, catField);
            const boxData: [number, number, number, number, number][] = [];
            const outlierData: [number, number][] = [];

            for (let i = 0; i < categories.length; i++) {
                const cat = categories[i];
                const rows = catGroups.get(cat) || [];
                const values = rows.map((r: any) => Number(r[valField])).filter((v: number) => isFinite(v));
                boxData.push(fiveNumberSummary(values));

                const outliers = findOutliers(values);
                for (const o of outliers) {
                    outlierData.push([i, o]);
                }
            }

            option.series.push({
                type: 'boxplot',
                data: boxData,
                itemStyle: { borderColor: '#5470c6' },
            });
            if (outlierData.length > 0) {
                option.series.push({
                    name: 'Outliers',
                    type: 'scatter',
                    data: outlierData,
                    symbolSize: 4,
                    itemStyle: { color: '#ee6666' },
                });
            }
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
