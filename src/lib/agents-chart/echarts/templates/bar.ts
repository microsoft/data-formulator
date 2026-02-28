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

/** True if all labels parse as numbers → horizontal axis labels; otherwise vertical (for heatmap). */
function areHeatmapCategoriesNumeric(cats: string[]): boolean {
    if (cats.length === 0) return true;
    return cats.every((c) => {
        const s = String(c).trim();
        if (s === '') return false;
        const n = Number(s);
        return !isNaN(n) && isFinite(n);
    });
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
        const valCS = channelSemantics[valueAxis];
        const colorField = channelSemantics.color?.field;
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
                tooltip: { position: 'top' },
                _encodingTooltip: {
                    trigger: 'item',
                    parts: [
                        { from: 'data', index: 0, label: catField, format: 'category', categoryNames: categories },
                        { from: 'data', index: 1, label: valField, format: 'category', categoryNames: groups },
                        { from: 'data', index: 2, label: 'Count', format: 'number' },
                    ],
                },
                xAxis: {
                    type: 'category',
                    data: categories,
                    name: catField,
                    splitArea: { show: true },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLabel: {
                        rotate: areHeatmapCategoriesNumeric(categories) ? 0 : 90,
                    },
                },
                yAxis: {
                    type: 'category',
                    data: groups,
                    name: valField,
                    splitArea: { show: true },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLabel: { rotate: 0 },
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

        // Color + quantitative value → default to stacked bar (like Vega-Lite).
        if (colorField && valCS?.type === 'quantitative') {
            const categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
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

            const groups = groupBy(table, colorField);
            const legendKeys = [...groups.keys()];
            const highCardinality = legendKeys.length > 10;
            option.legend = {
                data: legendKeys,
                orient: 'vertical',
                right: 10,
                top: highCardinality ? 30 : 20,
                bottom: highCardinality ? 10 : undefined,
                type: highCardinality ? 'scroll' : 'plain',
                align: 'left',
            };

            // Legend title (e.g., Segment) aligned with legend symbols on the right
            if (colorField) {
                const titleGraphic = {
                    type: 'text' as const,
                    right: 10,
                    top: 4,
                    z: 100,
                    style: {
                        text: colorField,
                        fontSize: 11,
                        fontWeight: 'bold',
                        fill: '#333',
                        textAlign: 'right',
                    },
                };
                const existingGraphic = (spec as any).graphic ?? option.graphic;
                option.graphic = Array.isArray(existingGraphic)
                    ? [...existingGraphic, titleGraphic]
                    : existingGraphic
                        ? [existingGraphic, titleGraphic]
                        : [titleGraphic];
            }

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const data = buildCategoryValues(rows, catField, valField, categories);
                option.series.push({
                    name,
                    type: 'bar',
                    data,
                    stack: 'total',
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }

            Object.assign(spec, option);
            delete spec.mark;
            delete spec.encoding;
            return;
        }

        // x=temporal, y=nominal → vertical grouped bar: x=dates (labels), y=count, series=group
        if (categoryAxis === 'y' && valCS?.type === 'temporal') {
            const dateCategories = extractCategories(table, valField, getCategoryOrder(ctx, valueAxis));
            dateCategories.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
            const groups = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
            const countMatrix = buildCategoryGroupCounts(table, valField, catField, dateCategories, groups);

            const option: any = {
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                legend: { data: groups },
                xAxis: {
                    type: 'category',
                    data: dateCategories,
                    name: valField,
                    axisLabel: { rotate: 90 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                },
                yAxis: { type: 'value', name: 'Count' },
                series: groups.map((name, i) => ({
                    name,
                    type: 'bar',
                    data: countMatrix[i],
                    itemStyle: {
                        color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                        borderRadius: chartProperties?.cornerRadius ?? 0,
                    },
                })),
            };
            option._encodingTooltip = { trigger: 'axis', categoryLabel: valField, valueLabel: 'Count', groupLabel: catField };
            Object.assign(spec, option);
            delete spec.mark;
            delete spec.encoding;
            return;
        }

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
        const valCS = channelSemantics[valueAxis];
        let categories = extractCategories(table, catField, getCategoryOrder(ctx, categoryAxis));
        if (catCS?.type === 'temporal') {
            categories = [...categories].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        }
        const isHorizontal = categoryAxis === 'y';
        const valueLabel = valCS?.type === 'temporal' ? 'Count' : valField;

        // All categorical (e.g., x=Category, y=Group, color=Segment) → count per (x, color) with stacked bars.
        if (colorField && isDiscrete(channelSemantics.x?.type) && isDiscrete(channelSemantics.y?.type)) {
            const categoriesX = extractCategories(table, channelSemantics.x!.field!, getCategoryOrder(ctx, 'x'));
            const groups = groupBy(table, colorField);

            const option: any = {
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                xAxis: {
                    type: 'category',
                    data: categoriesX,
                    name: channelSemantics.x!.field,
                    axisLabel: { rotate: 90 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                },
                yAxis: { type: 'value', name: 'Count' },
                series: [],
            };
            option._encodingTooltip = {
                trigger: 'axis',
                categoryLabel: channelSemantics.x!.field!,
                valueLabel: 'Count',
                groupLabel: colorField,
            };

            const legendKeys = [...groups.keys()];
            const highCardinality = legendKeys.length > 10;
            option.legend = {
                data: legendKeys,
                orient: 'vertical',
                right: 10,
                top: highCardinality ? 30 : 20,
                bottom: highCardinality ? 10 : undefined,
                type: highCardinality ? 'scroll' : 'plain',
                align: 'left',
            };

            const titleGraphic = {
                type: 'text' as const,
                right: 10,
                top: 4,
                z: 100,
                style: {
                    text: colorField,
                    fontSize: 11,
                    fontWeight: 'bold',
                    fill: '#333',
                    textAlign: 'right',
                },
            };
            const existingGraphic = (spec as any).graphic ?? option.graphic;
            option.graphic = Array.isArray(existingGraphic)
                ? [...existingGraphic, titleGraphic]
                : existingGraphic
                    ? [existingGraphic, titleGraphic]
                    : [titleGraphic];

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const data = buildCategoryCounts(rows, channelSemantics.x!.field!, categoriesX);
                option.series.push({
                    name,
                    type: 'bar',
                    data,
                    stack: 'total',
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }

            Object.assign(spec, option);
            delete spec.mark;
            delete spec.encoding;
            return;
        }

        const option: any = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: isHorizontal
                ? { type: 'value', name: valueLabel }
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
                : { type: 'value', name: valueLabel },
            series: [],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: catField, valueLabel };

        // Stack mode from chart properties
        const stackMode = chartProperties?.stackMode;
        // In ECharts, stack is a group name; normalize maps to '%' formatting
        const stackGroup = stackMode === 'layered' ? undefined : 'total';

        if (colorField) {
            const groups = groupBy(table, colorField);
            const legendKeys = [...groups.keys()];
            const highCardinality = legendKeys.length > 10;
            option.legend = {
                data: legendKeys,
                orient: 'vertical',
                right: 10,
                top: highCardinality ? 30 : 20,
                bottom: highCardinality ? 10 : undefined,
                type: highCardinality ? 'scroll' : 'plain',
                align: 'left',
            };

            // Legend title (e.g., Segment) aligned with legend symbols on the right
            const titleField = colorField;
            if (titleField) {
                const titleGraphic = {
                    type: 'text' as const,
                    right: 10,
                    top: 4,
                    z: 100,
                    style: {
                        text: titleField,
                        fontSize: 11,
                        fontWeight: 'bold',
                        fill: '#333',
                        textAlign: 'right',
                    },
                };
                const existingGraphic = (spec as any).graphic ?? option.graphic;
                option.graphic = Array.isArray(existingGraphic)
                    ? [...existingGraphic, titleGraphic]
                    : existingGraphic
                        ? [existingGraphic, titleGraphic]
                        : [titleGraphic];
            }

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const data = valCS?.type === 'temporal'
                    ? buildCategoryCounts(rows, catField, categories)
                    : buildCategoryValues(rows, catField, valField, categories);
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
            const data = valCS?.type === 'temporal'
                ? buildCategoryCounts(table, catField, categories)
                : buildCategoryValues(table, catField, valField, categories);
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

        // The "group" channel in the core maps to color/series in ECharts
        const groupField = channelSemantics.group?.field || channelSemantics.color?.field;

        // ── Special case: x=temporal, y=nominal, group=Segment → vertical grouped bars by Date ──
        // Mirror ecBarChartDef's "x=temporal, y=nominal" behaviour, but use the explicit group channel
        // for series instead of the y field. Result:
        //   - x axis: Date categories (sorted)
        //   - y axis: Count
        //   - series: Segment (group channel), values = count of rows per (Date, Segment)
        if (channelSemantics.x?.type === 'temporal'
            && isDiscrete(channelSemantics.y?.type)
            && groupField
            && channelSemantics.x.field) {
            const xField = channelSemantics.x.field;
            const xCS = channelSemantics.x;

            const dateCategories = extractCategories(table, xField, getCategoryOrder(ctx, 'x'));
            dateCategories.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

            const segments = extractCategories(table, groupField, getCategoryOrder(ctx, 'group'));
            const countMatrix = buildCategoryGroupCounts(table, xField, groupField, dateCategories, segments);

            const option: any = {
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                legend: { data: segments },
                xAxis: {
                    type: 'category',
                    data: dateCategories,
                    name: xField,
                    axisLabel: { rotate: xCS?.type === 'quantitative' ? 0 : 90 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                },
                yAxis: { type: 'value', name: 'Count' },
                series: segments.map((name, i) => ({
                    name,
                    type: 'bar',
                    data: countMatrix[i],
                    itemStyle: {
                        color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                    },
                })),
            };
            // Let ecApplyLayoutToSpec place a single legend title for the group channel.
            // Avoid adding our own graphic here, otherwise we'd get a duplicate "Segment" title.
            option._legendTitle = groupField;
            option._encodingTooltip = {
                trigger: 'axis',
                categoryLabel: xField,
                valueLabel: 'Count',
                groupLabel: groupField,
            };

            Object.assign(spec, option);
            delete spec.mark;
            delete spec.encoding;
            return;
        }

        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        const valType = channelSemantics[valueAxis]?.type;

        // ── Fallback: no numeric value axis, but we do have a group channel ──
        // Example specs:
        //   - x=Category (nominal), y=Group (nominal), group=Segment
        //   - x=Date (temporal),   y=Group (nominal), group=Segment
        // In these cases we mirror bar chart's "all categorical" behaviour:
        // use x as the category axis and plot grouped bars where height = count.
        if ((!valField || valType === 'nominal' || valType === 'ordinal') && groupField && channelSemantics.x?.field) {
            const xField = channelSemantics.x.field!;
            const xCS = channelSemantics.x;
            let categories = extractCategories(table, xField, getCategoryOrder(ctx, 'x'));
            if (xCS?.type === 'temporal') {
                categories = [...categories].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
            }

            const groups = groupBy(table, groupField);
            const legendKeys = [...groups.keys()];
            const highCardinality = legendKeys.length > 10;

            const option: any = {
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                xAxis: {
                    type: 'category',
                    data: categories,
                    name: xField,
                    axisLabel: { rotate: xCS?.type === 'quantitative' ? 0 : 90 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                },
                yAxis: { type: 'value', name: 'Count' },
                series: [],
            };
            option._encodingTooltip = {
                trigger: 'axis',
                categoryLabel: xField,
                valueLabel: 'Count',
                groupLabel: groupField,
            };

            option.legend = {
                data: legendKeys,
                orient: 'vertical',
                right: 10,
                top: highCardinality ? 30 : 20,
                bottom: highCardinality ? 10 : undefined,
                type: highCardinality ? 'scroll' : 'plain',
                align: 'left',
            };

            const titleGraphic = {
                type: 'text' as const,
                right: 10,
                top: 4,
                z: 100,
                style: {
                    text: groupField,
                    fontSize: 11,
                    fontWeight: 'bold',
                    fill: '#333',
                    textAlign: 'right',
                },
            };
            const existingGraphic = (spec as any).graphic ?? option.graphic;
            option.graphic = Array.isArray(existingGraphic)
                ? [...existingGraphic, titleGraphic]
                : existingGraphic
                    ? [existingGraphic, titleGraphic]
                    : [titleGraphic];

            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const data = buildCategoryCounts(rows, xField, categories);
                option.series.push({
                    name,
                    type: 'bar',
                    data,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }

            Object.assign(spec, option);
            delete spec.mark;
            delete spec.encoding;
            return;
        }

        // ── Default: we have a proper value axis (quantitative / temporal) ──
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
            const legendKeys = [...groups.keys()];
            const highCardinality = legendKeys.length > 10;
            option.legend = {
                data: legendKeys,
                orient: 'vertical',
                right: 10,
                top: highCardinality ? 30 : 20,
                bottom: highCardinality ? 10 : undefined,
                type: highCardinality ? 'scroll' : 'plain',
                align: 'left',
            };

            // Legend title (e.g., Segment) aligned with legend symbols on the right
            const titleField = groupField;
            if (titleField) {
                const titleGraphic = {
                    type: 'text' as const,
                    right: 10,
                    top: 4,
                    z: 100,
                    style: {
                        text: titleField,
                        fontSize: 11,
                        fontWeight: 'bold',
                        fill: '#333',
                        textAlign: 'right',
                    },
                };
                const existingGraphic = (spec as any).graphic ?? option.graphic;
                option.graphic = Array.isArray(existingGraphic)
                    ? [...existingGraphic, titleGraphic]
                    : existingGraphic
                        ? [existingGraphic, titleGraphic]
                        : [titleGraphic];
            }

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
