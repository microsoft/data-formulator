// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js Bar Chart templates: Bar, Stacked Bar, Grouped Bar.
 *
 * Key contrast with Vega-Lite:
 *   VL: encoding channels determine stacking/grouping implicitly
 *   CJS: explicit datasets[] with stacked option on scales
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import {
    extractCategories,
    groupBy,
    detectAxes,
    buildCategoryAlignedData,
    DEFAULT_COLORS,
    DEFAULT_BG_COLORS,
    getChartJsPalette,
    getSeriesBorderColor,
    getSeriesBackgroundColor,
} from './utils';
import {
    detectBandedAxisFromSemantics, detectBandedAxisForceDiscrete,
} from '../../vegalite/templates/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

// ─── Bar Chart ──────────────────────────────────────────────────────────────

export const cjsBarChartDef: ChartTemplateDef = {
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
        const categories = extractCategories(table, catField, catCS?.ordinalSortOrder);
        const values = buildCategoryAlignedData(table, catField, valField, categories);

        const isHorizontal = categoryAxis === 'y';

        const palette = getChartJsPalette(ctx);

        const config: any = {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [{
                    label: valField,
                    data: values,
                    backgroundColor: getSeriesBackgroundColor(palette, 0),
                    borderColor: getSeriesBorderColor(palette, 0),
                    borderWidth: 1,
                    borderRadius: chartProperties?.cornerRadius ?? 0,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: isHorizontal ? 'y' as const : 'x' as const,
                scales: {
                    x: {
                        title: { display: true, text: isHorizontal ? valField : catField },
                        ...(isHorizontal ? {} : {}),
                    },
                    y: {
                        title: { display: true, text: isHorizontal ? catField : valField },
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true },
                },
            },
        };

        // Apply zero-baseline from semantic decision
        const valScale = isHorizontal ? 'x' : 'y';
        const valCS = channelSemantics[valueAxis];
        if (valCS?.zero) {
            config.options.scales[valScale].beginAtZero = valCS.zero.zero !== false;
        } else {
            // Default: bars should include zero for length integrity
            config.options.scales[valScale].beginAtZero = true;
        }

        Object.assign(spec, config);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'cornerRadius', label: 'Corners', type: 'continuous', min: 0, max: 15, step: 1, defaultValue: 0 },
    ] as ChartPropertyDef[],
};

// ─── Stacked Bar Chart ──────────────────────────────────────────────────────

export const cjsStackedBarChartDef: ChartTemplateDef = {
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
        const categories = extractCategories(table, catField, catCS?.ordinalSortOrder);
        const isHorizontal = categoryAxis === 'y';

        const palette = getChartJsPalette(ctx, 'color');

        const config: any = {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: isHorizontal ? 'y' as const : 'x' as const,
                scales: {
                    x: {
                        stacked: true,
                        title: { display: true, text: isHorizontal ? valField : catField },
                    },
                    y: {
                        stacked: true,
                        title: { display: true, text: isHorizontal ? catField : valField },
                    },
                },
                plugins: {
                    legend: { display: !!colorField },
                    tooltip: { enabled: true },
                },
            },
        };

        if (colorField) {
            const groups = groupBy(table, colorField);
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const values = buildCategoryAlignedData(rows, catField, valField, categories);
                config.data.datasets.push({
                    label: name,
                    data: values,
                    backgroundColor: getSeriesBackgroundColor(palette, colorIdx),
                    borderColor: getSeriesBorderColor(palette, colorIdx),
                    borderWidth: 1,
                });
                colorIdx++;
            }
        } else {
            const values = buildCategoryAlignedData(table, catField, valField, categories);
            config.data.datasets.push({
                label: valField,
                data: values,
                backgroundColor: getSeriesBackgroundColor(palette, 0),
                borderColor: getSeriesBorderColor(palette, 0),
                borderWidth: 1,
            });
        }

        // Apply zero-baseline from semantic decision
        const valScaleS = isHorizontal ? 'x' : 'y';
        const valCSs = channelSemantics[valueAxis];
        if (valCSs?.zero) {
            config.options.scales[valScaleS].beginAtZero = valCSs.zero.zero !== false;
        } else {
            config.options.scales[valScaleS].beginAtZero = true;
        }

        Object.assign(spec, config);
        delete spec.mark;
        delete spec.encoding;
    },
};

// ─── Grouped Bar Chart ──────────────────────────────────────────────────────

export const cjsGroupedBarChartDef: ChartTemplateDef = {
    chart: 'Grouped Bar Chart',
    template: { mark: 'bar', encoding: {} },
    channels: ['x', 'y', 'group', 'color', 'column', 'row'],
    markCognitiveChannel: 'length',
    declareLayoutMode: (cs, table) => {
        const result = detectBandedAxisForceDiscrete(cs, table, { preferAxis: 'x' });
        return {
            axisFlags: result ? { [result.axis]: { banded: true } } : { x: { banded: true } },
            resolvedTypes: result?.resolvedTypes,
            paramOverrides: { continuousMarkCrossSection: { x: 20, y: 20, seriesCountAxis: 'auto' } },
        };
    },
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
        const groupField = channelSemantics.group?.field || channelSemantics.color?.field;

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const catCS = channelSemantics[categoryAxis];
        const categories = extractCategories(table, catField, catCS?.ordinalSortOrder);
        const isHorizontal = categoryAxis === 'y';

        const palette = getChartJsPalette(ctx, 'group');

        const config: any = {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: isHorizontal ? 'y' as const : 'x' as const,
                scales: {
                    x: {
                        title: { display: true, text: isHorizontal ? valField : catField },
                    },
                    y: {
                        title: { display: true, text: isHorizontal ? catField : valField },
                    },
                },
                plugins: {
                    legend: { display: !!groupField },
                    tooltip: { enabled: true },
                },
            },
        };

        if (groupField) {
            const groups = groupBy(table, groupField);
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const values = buildCategoryAlignedData(rows, catField, valField, categories);
                config.data.datasets.push({
                    label: name,
                    data: values,
                    backgroundColor: getSeriesBackgroundColor(palette, colorIdx),
                    borderColor: getSeriesBorderColor(palette, colorIdx),
                    borderWidth: 1,
                });
                colorIdx++;
            }
        } else {
            const values = buildCategoryAlignedData(table, catField, valField, categories);
            config.data.datasets.push({
                label: valField,
                data: values,
                backgroundColor: getSeriesBackgroundColor(palette, 0),
                borderColor: getSeriesBorderColor(palette, 0),
                borderWidth: 1,
            });
        }

        // Apply zero-baseline from semantic decision
        const valScaleG = isHorizontal ? 'x' : 'y';
        const valCSg = channelSemantics[valueAxis];
        if (valCSg?.zero) {
            config.options.scales[valScaleG].beginAtZero = valCSg.zero.zero !== false;
        } else {
            config.options.scales[valScaleG].beginAtZero = true;
        }

        Object.assign(spec, config);
        delete spec.mark;
        delete spec.encoding;
    },
};
