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
    extractCategories, groupBy, detectAxes, buildCategoryAlignedData,
    DEFAULT_COLORS, DEFAULT_BG_COLORS,
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

        const config: any = {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [{
                    label: valField,
                    data: values,
                    backgroundColor: DEFAULT_BG_COLORS[0],
                    borderColor: DEFAULT_COLORS[0],
                    borderWidth: 1,
                    borderRadius: chartProperties?.cornerRadius ?? 0,
                }],
            },
            options: {
                responsive: false,
                indexAxis: isHorizontal ? 'y' as const : 'x' as const,
                scales: {
                    x: {
                        title: { display: true, text: isHorizontal ? valField : catField },
                        ...(isHorizontal ? {} : {}),
                    },
                    y: {
                        title: { display: true, text: isHorizontal ? catField : valField },
                        ...(isHorizontal ? {} : { beginAtZero: true }),
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true },
                },
            },
        };

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

        const config: any = {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [],
            },
            options: {
                responsive: false,
                indexAxis: isHorizontal ? 'y' as const : 'x' as const,
                scales: {
                    x: {
                        stacked: true,
                        title: { display: true, text: isHorizontal ? valField : catField },
                    },
                    y: {
                        stacked: true,
                        title: { display: true, text: isHorizontal ? catField : valField },
                        beginAtZero: true,
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
                    backgroundColor: DEFAULT_BG_COLORS[colorIdx % DEFAULT_BG_COLORS.length],
                    borderColor: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length],
                    borderWidth: 1,
                });
                colorIdx++;
            }
        } else {
            const values = buildCategoryAlignedData(table, catField, valField, categories);
            config.data.datasets.push({
                label: valField,
                data: values,
                backgroundColor: DEFAULT_BG_COLORS[0],
                borderColor: DEFAULT_COLORS[0],
                borderWidth: 1,
            });
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
    channels: ['x', 'y', 'color', 'column', 'row'],
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
        const colorField = channelSemantics.color?.field;

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const catCS = channelSemantics[categoryAxis];
        const categories = extractCategories(table, catField, catCS?.ordinalSortOrder);
        const isHorizontal = categoryAxis === 'y';

        const config: any = {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [],
            },
            options: {
                responsive: false,
                indexAxis: isHorizontal ? 'y' as const : 'x' as const,
                scales: {
                    x: {
                        title: { display: true, text: isHorizontal ? valField : catField },
                    },
                    y: {
                        title: { display: true, text: isHorizontal ? catField : valField },
                        beginAtZero: true,
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
                    backgroundColor: DEFAULT_BG_COLORS[colorIdx % DEFAULT_BG_COLORS.length],
                    borderColor: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length],
                    borderWidth: 1,
                });
                colorIdx++;
            }
        } else {
            const values = buildCategoryAlignedData(table, catField, valField, categories);
            config.data.datasets.push({
                label: valField,
                data: values,
                backgroundColor: DEFAULT_BG_COLORS[0],
                borderColor: DEFAULT_COLORS[0],
                borderWidth: 1,
            });
        }

        Object.assign(spec, config);
        delete spec.mark;
        delete spec.encoding;
    },
};
