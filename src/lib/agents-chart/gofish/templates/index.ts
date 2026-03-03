// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish template registry.
 *
 * Mirrors the structure of other backend template registries.
 */

import { ChartTemplateDef } from '../../core/types';
import { gfScatterPlotDef } from './scatter';
import { gfBarChartDef, gfStackedBarChartDef, gfGroupedBarChartDef } from './bar';
import { gfLineChartDef } from './line';
import { gfAreaChartDef } from './area';
import { gfPieChartDef } from './pie';
import { gfScatterPieChartDef } from './scatterpie';

/**
 * GoFish chart template definitions, grouped by category.
 */
export const gfTemplateDefs: { [key: string]: ChartTemplateDef[] } = {
    'Scatter & Point': [gfScatterPlotDef],
    'Bar':             [gfBarChartDef, gfGroupedBarChartDef, gfStackedBarChartDef],
    'Line & Area':     [gfLineChartDef, gfAreaChartDef],
    'Part-to-Whole':   [gfPieChartDef, gfScatterPieChartDef],
};

/**
 * Flat list of all GoFish chart template definitions.
 */
export const gfAllTemplateDefs: ChartTemplateDef[] = Object.values(gfTemplateDefs).flat();

/**
 * Look up a GoFish chart template definition by chart type name.
 */
export function gfGetTemplateDef(chartType: string): ChartTemplateDef | undefined {
    return gfAllTemplateDefs.find(t => t.chart === chartType);
}

/**
 * Get the available channels for a GoFish chart type.
 */
export function gfGetTemplateChannels(chartType: string): string[] {
    return gfGetTemplateDef(chartType)?.channels || [];
}
