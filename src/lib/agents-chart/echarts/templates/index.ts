// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts template registry.
 *
 * Mirrors the structure of vegalite/templates/index.ts but with ECharts
 * template definitions.
 */

import { ChartTemplateDef } from '../../core/types';
import { ecScatterPlotDef } from './scatter';
import { ecBarChartDef, ecStackedBarChartDef, ecGroupedBarChartDef } from './bar';
import { ecLineChartDef } from './line';
import { ecAreaChartDef } from './area';
import { ecPieChartDef } from './pie';
import { ecHeatmapDef } from './heatmap';
import { ecHistogramDef } from './histogram';
import { ecBoxplotDef } from './boxplot';
import { ecRadarChartDef } from './radar';
import { ecCandlestickDef } from './candlestick';
import { ecStreamgraphDef } from './streamgraph';

/**
 * ECharts chart template definitions, grouped by category.
 */
export const ecChartTemplateDefs: { [key: string]: ChartTemplateDef[] } = {
    'Scatter & Point': [ecScatterPlotDef, ecBoxplotDef],
    'Bar':             [ecBarChartDef, ecGroupedBarChartDef, ecStackedBarChartDef, ecHistogramDef, ecHeatmapDef],
    'Line & Area':     [ecLineChartDef, ecAreaChartDef, ecStreamgraphDef],
    'Part-to-Whole':   [ecPieChartDef],
    'Financial':       [ecCandlestickDef],
    'Polar':           [ecRadarChartDef],
};

/**
 * Flat list of all ECharts chart template definitions.
 */
export const ecAllTemplateDefs: ChartTemplateDef[] = Object.values(ecChartTemplateDefs).flat();

/**
 * Look up an ECharts chart template definition by chart type name.
 */
export function ecGetTemplateDef(chartType: string): ChartTemplateDef | undefined {
    return ecAllTemplateDefs.find(t => t.chart === chartType);
}

/**
 * Get the available channels for an ECharts chart type.
 */
export function ecGetTemplateChannels(chartType: string): string[] {
    return ecGetTemplateDef(chartType)?.channels || [];
}
