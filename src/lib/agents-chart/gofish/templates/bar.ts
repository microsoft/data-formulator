// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish Bar Chart templates: Bar, Stacked Bar, Grouped Bar.
 *
 * GoFish approach:
 *   chart(data).flow(spread(catField, { dir: "x" })).mark(rect({ h: valField }))
 *   Stacked: add stack(colorField, { dir: "y" })
 */

import { ChartTemplateDef } from '../../core/types';
import {
    detectBandedAxisFromSemantics,
    detectBandedAxisForceDiscrete,
} from '../../vegalite/templates/utils';
import { detectAxes, aggregateByCategory, extractCategories, groupBy } from './utils';

// ─── Bar Chart ──────────────────────────────────────────────────────────────

export const gfBarChartDef: ChartTemplateDef = {
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
        const { channelSemantics, table } = ctx;
        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const isHorizontal = categoryAxis === 'y';

        // Aggregate data: one bar per category
        const catCS = channelSemantics[categoryAxis];
        const categories = extractCategories(table, catField, catCS?.ordinalSortOrder);
        const aggData = aggregateByCategory(table, catField, valField, categories);

        // Store GoFish render descriptor
        spec._gofish = {
            type: 'bar',
            data: aggData.map(d => ({ [catField]: d.category, [valField]: d.value })),
            flow: [{
                op: 'spread',
                field: catField,
                options: { dir: isHorizontal ? 'y' : 'x' },
            }],
            mark: {
                shape: 'rect',
                options: isHorizontal
                    ? { w: valField }
                    : { h: valField },
            },
        };

        delete spec.mark;
        delete spec.encoding;
    },
};

// ─── Stacked Bar Chart ──────────────────────────────────────────────────────

export const gfStackedBarChartDef: ChartTemplateDef = {
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
        const { channelSemantics, table } = ctx;
        const { categoryAxis, valueAxis } = detectAxes(channelSemantics);
        const colorField = channelSemantics.color?.field;

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const isHorizontal = categoryAxis === 'y';
        const spreadDir = isHorizontal ? 'y' : 'x';
        const stackDir = isHorizontal ? 'x' : 'y';

        const flow: any[] = [
            { op: 'spread', field: catField, options: { dir: spreadDir } },
        ];

        if (colorField) {
            flow.push({
                op: 'stack', field: colorField,
                options: { dir: stackDir, label: false },
            });
        }

        spec._gofish = {
            type: 'stacked-bar',
            data: table,
            flow,
            mark: {
                shape: 'rect',
                options: isHorizontal
                    ? { w: valField, fill: colorField || undefined }
                    : { h: valField, fill: colorField || undefined },
            },
        };

        delete spec.mark;
        delete spec.encoding;
    },
};

// ─── Grouped Bar Chart ──────────────────────────────────────────────────────

export const gfGroupedBarChartDef: ChartTemplateDef = {
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
        const groupField = channelSemantics.group?.field;

        const catField = channelSemantics[categoryAxis]?.field;
        const valField = channelSemantics[valueAxis]?.field;
        if (!catField || !valField) return;

        const isHorizontal = categoryAxis === 'y';
        const spreadDir = isHorizontal ? 'y' : 'x';

        const flow: any[] = [
            { op: 'spread', field: catField, options: { dir: spreadDir } },
        ];

        // Group by group field using stack in same direction (side-by-side within each category)
        if (groupField) {
            flow.push({
                op: 'stack', field: groupField,
                options: { dir: spreadDir, label: false },
            });
        }

        spec._gofish = {
            type: 'grouped-bar',
            data: table,
            flow,
            mark: {
                shape: 'rect',
                options: isHorizontal
                    ? { w: valField, fill: groupField || undefined }
                    : { h: valField, fill: groupField || undefined },
            },
        };

        delete spec.mark;
        delete spec.encoding;
    },
};
