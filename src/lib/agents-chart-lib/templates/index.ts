// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Template registry — collects all chart template definitions.
 * No UI/icon dependencies. This is the pure-data template catalog.
 */

import { ChartTemplateDef } from '../types';
import { scatterPlots } from './scatter';
import { barCharts } from './bar';
import { mapCharts } from './map';
import { pieCharts } from './pie';
import { lineCharts } from './line';
import { customCharts } from './custom';

// Re-export helpers for consumers who need them
export { applyDynamicMarkResizing, ensureNominalAxis, applyPointSizeScaling } from '../helpers';

/**
 * All chart template definitions, grouped by category.
 * Keys are category names, values are arrays of template definitions.
 */
export const chartTemplateDefs: { [key: string]: ChartTemplateDef[] } = {
    scatter: scatterPlots,
    bar: barCharts,
    map: mapCharts,
    pie: pieCharts,
    line: lineCharts,
    custom: customCharts,
};

/**
 * Flat list of all chart template definitions.
 */
export const allTemplateDefs: ChartTemplateDef[] = Object.values(chartTemplateDefs).flat();

/**
 * Look up a chart template definition by chart type name.
 */
export function getTemplateDef(chartType: string): ChartTemplateDef | undefined {
    return allTemplateDefs.find(t => t.chart === chartType);
}

/**
 * Get the available channels for a chart type.
 */
export function getTemplateChannels(chartType: string): string[] {
    return getTemplateDef(chartType)?.channels || [];
}
