// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Bar Chart templates: Bar, Stacked Bar, Grouped Bar.
 *
 * Key contrast with Vega-Lite:
 *   VL: encoding channels determine stacking/grouping implicitly
 *       - stacked bar:  color channel → auto-stacks
 *       - grouped bar:  xOffset/group channel → side-by-side
 *   EC: explicit series[] with stack property for stacking,
 *       and barGap/barCategoryGap for grouped layout
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import {
    extractCategories, groupBy, detectAxes, DEFAULT_COLORS, getCategoryOrder,
} from './utils';
import {
    detectBandedAxisFromSemantics, detectBandedAxisForceDiscrete,
} from '../../vegalite/templates/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/**
 * For a category-axis bar chart, build an array of values aligned to the
 * category array. Each entry is the sum of values for that category in the
 * given rows (to handle pre-aggregated or raw data).
 */
function buildCategoryValues(
    rows: any[],
    categoryField: string,
    valueField: string,
    categories: string[],
): (number | null)[] {
    const map = new Map<string, number>();
    for (const row of rows) {
        const cat = String(row[categoryField] ?? '');
        const val = row[valueField];
        if (val != null && !isNaN(val)) {
            map.set(cat, (map.get(cat) ?? 0) + Number(val));
        }
    }
    return categories.map(cat => map.get(cat) ?? null);
}

/** Count rows per category (when value axis has no numeric field, e.g. temporal). */
function buildCategoryCounts(
    rows: any[],
    categoryField: string,
    categories: string[],
): number[] {
    const map = new Map<string, number>();
    for (const row of rows) {
        const cat = String(row[categoryField] ?? '');
        map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return categories.map(cat => map.get(cat) ?? 0);
}

/** When both x and y are discrete: count per (category, group). Returns one row per group. */
function buildCategoryGroupCounts(
    rows: any[],
    categoryField: string,
    groupField: string,
    categories: string[],
    groups: string[],
): number[][] {
    return groups.map(group =>
        categories.map(cat =>
            rows.filter(r => String(r[categoryField] ?? '') === cat && String(r[groupField] ?? '') === group).length,
        ),
    );
}

// ─── Bar Chart ──────────────────────────────────────────────────────────────

export const ecBarChartDef: ChartTemplateDef = {
    chart: 'Bar Chart',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'y', 'color', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: 'x' });
        return {
            axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
        };
    },
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const catCS = channelSemantics[categoryAxis];
        const bothDiscrete =
            isDiscrete(channelSemantics.x?.type) && isDiscrete(channelSemantics.y?.type);

        if (bothDiscrete) {
            // x=Category, y=Group both nominal → heatmap: cell color = count per (Category, Group)
            const categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
            const groups = extractCategories(table, valField, getCategoryOrder(ctx, valueAxis));
            const countMatrix = buildCategoryGroupCounts(table, catField, valField, categories, groups);

            const heatData: [number, number, number][] = [];
            let minVal = Infinity;
            let maxVal = -Infinity;
            for (let yi = 0; yi < groups.length; yi++) {
                for (let xi = 0; xi < categories.length; xi++) {
                    const v = countMatrix[yi][xi];
                    heatData.push([xi, yi, v]);
                    if (v < minVal) minVal = v;
                    if (v > maxVal) maxVal = v;
                }
            }
            if (minVal === Infinity) minVal = 0;
            if (maxVal === -Infinity) maxVal = 1;

            const option: any = {
                tooltip: {
                    position: 'top',
                    formatter: (params: any) => {
                        const d = params.data;
                        return `${categories[d[0]]}, ${groups[d[1]]}: ${d[2]}`;
                    },
                },
                xAxis: {
                    type: 'category',
                    data: categories,
                    name: catField,
                    splitArea: { show: true },
                    axisLabel: { rotate: 90 },
                },
                yAxis: {
                    type: 'category',
                    data: groups,
                    name: valField,
                    splitArea: { show: true },
                },
                visualMap: {
                    min: minVal,
                    max: maxVal,
                    calculable: true,
                    orient: 'vertical',
                    right: 10,
                    top: 'center',
                    itemGap: 15,
                    inRange: { color: ['#f0f9ff', '#0ea5e9', '#0369a1'] },
                },
                _visualMapWidth: 50,
                series: [{
                    type: 'heatmap',
                    data: heatData,
                    label: { show: heatData.length <= 100 },
                    emphasis: {
                        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' },
                    },
                }],
            };
            Object.assign(spec, option);
            delete spec.mark;
            delete spec.encoding;
            return;
        }

        const valCS = channelSemantics[valueAxis];
        let categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
        let values: (number | null)[];
        if (valCS?.type === 'temporal') {
            // Value axis is date — use count per category (no numeric to sum)
            values = buildCategoryCounts(table, catField, categories);
        } else {
            values = buildCategoryValues(table, catField, valField, categories);
        }
        if (catCS?.type === 'temporal') {
            const pairs: [string, number | null][] = categories.map((c, i) => [c, values[i]]);
            pairs.sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
            categories = pairs.map(p => p[0]);
            values = pairs.map(p => p[1]);
        }

        const isHorizontal = categoryAxis === 'y';
        const valueLabel = valCS?.type === 'temporal' ? 'Count' : valField;

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: isHorizontal
                ? { type: 'value', name: valueLabel }
                : {
                    type: 'category',
                    data: categories,
                    name: catField,
                    // Numeric categories: keep labels horizontal so numbers read left-to-right.
                    axisLabel: { rotate: catCS?.type === 'quantitative' ? 0 : 90 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                },
            yAxis: isHorizontal
                ? { type: 'category', data: categories, name: catField }
                : { type: 'value', name: valueLabel },
            series: [{
                type: 'bar',
                data: values,
                itemStyle: {
                    borderRadius: chartProperties?.cornerRadius ?? 0,
                },
            }],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: catField, valueLabel };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'cornerRadius', label: 'Corners', type: 'continuous', min: 0, max: 15, step: 1, defaultValue: 0 },
    ] as ChartPropertyDef[],
};

// ─── Stacked Bar Chart ──────────────────────────────────────────────────────

export const ecStackedBarChartDef: ChartTemplateDef = {
    chart: 'Stacked Bar Chart',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'y', 'color', 'column', 'row'],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisFromSemantics(cs, table, { preferAxis: 'x' });
        return {
            axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
            paramOverrides: { continuousMarkCrossSection: { x: 20, y: 20, seriesCountAxis: 'auto' } },
        };
    },
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
        const colorField = channelSemantics.color?.field;

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const catCS = channelSemantics[categoryAxis];
        let categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
        if (catCS?.type === 'temporal') {
            categories = [...categories].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        }
        const isHorizontal = categoryAxis === 'y';

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: isHorizontal
                ? { type: 'value', name: valField }
                : {
                    type: 'category',
                    data: categories,
                    name: catField,
                    axisLabel: { rotate: catCS?.type === 'quantitative' ? 0 : 90 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                },
            yAxis: isHorizontal
                ? { type: 'category', data: categories, name: catField }
                : { type: 'value', name: valField },
            series: [],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: catField, valueLabel: valField };

        // Stack mode from chart properties
        const stackMode = chartProperties?.stackMode;
        // In ECharts, stack is a group name; normalize maps to '%' formatting
        const stackGroup = stackMode === 'layered' ? undefined : 'total';

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const data = buildCategoryValues(rows, catField, valField, categories);
                const series: any = {
                    name,
                    type: 'bar',
                    data,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                };
                if (stackGroup) {
                    series.stack = stackGroup;
                }
                // Normalize: ECharts doesn't have a built-in "normalize" stack,
                // but we can signal it via a custom label format
                if (stackMode === 'normalize') {
                    series.stack = 'total';
                    // Note: true normalize requires computing percentages;
                    // for now we just stack — full normalize would need data transform
                }
                option.series.push(series);
                colorIdx++;
            }
        } else {
            // Single series stacked (no color = just a regular bar)
            const data = buildCategoryValues(table, catField, valField, categories);
            option.series.push({ type: 'bar', data, stack: stackGroup });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        {
            key: 'stackMode', label: 'Stack', type: 'discrete', options: [
                { value: undefined, label: 'Stacked (default)' },
                { value: 'normalize', label: 'Normalize (100%)' },
                { value: 'layered', label: 'Layered (overlap)' },
            ],
        },
    ] as ChartPropertyDef[],
};

// ─── Grouped Bar Chart ──────────────────────────────────────────────────────

export const ecGroupedBarChartDef: ChartTemplateDef = {
    chart: 'Grouped Bar Chart',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'y', 'group', 'column', 'row'],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: 'x' });
        const axis = result?.axis || 'x';
        return {
            axisFlags: { [axis]: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
        };
    },
    instantiate: (spec, ctx) => {
        const { channelSemantics, table } = ctx;
        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);

        // The "group" channel in the core maps to color in ECharts
        const groupField = channelSemantics.group?.field || channelSemantics.color?.field;

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const catCS = channelSemantics[categoryAxis];
        let categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
        if (catCS?.type === 'temporal') {
            categories = [...categories].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        }
        const isHorizontal = categoryAxis === 'y';

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: isHorizontal
                ? { type: 'value', name: valField }
                : {
                    type: 'category',
                    data: categories,
                    name: catField,
                    axisLabel: { rotate: catCS?.type === 'quantitative' ? 0 : 90 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                },
            yAxis: isHorizontal
                ? { type: 'category', data: categories, name: catField }
                : { type: 'value', name: valField },
            series: [],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: catField, valueLabel: valField };

        if (groupField) {
            // Each group becomes a separate series — ECharts places them
            // side-by-side within each category automatically
            const groups = groupBy(table, groupField);
            option.legend = { data: [...groups.keys()] };

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const data = buildCategoryValues(rows, catField, valField, categories);
                option.series.push({
                    name,
                    type: 'bar',
                    data,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }
        } else {
            // No grouping — single series
            const data = buildCategoryValues(table, catField, valField, categories);
            option.series.push({ type: 'bar', data });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
