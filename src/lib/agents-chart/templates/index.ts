// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Template registry — collects all chart template definitions.
 * No UI/icon dependencies. This is the pure-data template catalog.
 *
 * Each template file exports individual ChartTemplateDef objects.
 * Categories are defined here to group related charts in the UI.
 */

import { ChartTemplateDef } from '../types';

// --- Individual chart imports ---
import { scatterPlotDef, linearRegressionDef, rangedDotPlotDef, boxplotDef } from './scatter';
import { barChartDef, pyramidChartDef, groupedBarChartDef, stackedBarChartDef, histogramDef, heatmapDef } from './bar';
import { lineChartDef, dottedLineChartDef } from './line';
import { areaChartDef, streamgraphDef } from './area';
import { pieChartDef } from './pie';
import { lollipopChartDef } from './lollipop';
import { densityPlotDef } from './density';
import { stripPlotDef } from './jitter';
import { candlestickChartDef } from './candlestick';
import { waterfallChartDef } from './waterfall';
import { radarChartDef } from './radar';
import { usMapDef, worldMapDef } from './map';
import { customPointDef, customLineDef, customBarDef, customRectDef, customAreaDef } from './custom';

/**
 * All chart template definitions, grouped by category.
 * Keys are category names shown in the UI, values are arrays of template definitions.
 */
export const chartTemplateDefs: { [key: string]: ChartTemplateDef[] } = {
    "Scatter & Point":  [scatterPlotDef, linearRegressionDef, boxplotDef, stripPlotDef],
    "Bar":              [barChartDef, groupedBarChartDef, stackedBarChartDef, histogramDef, lollipopChartDef, pyramidChartDef],
    "Line & Area":      [lineChartDef, dottedLineChartDef, areaChartDef, streamgraphDef],
    "Part-to-Whole":    [pieChartDef, heatmapDef, waterfallChartDef],
    "Statistical":      [densityPlotDef, rangedDotPlotDef, radarChartDef, candlestickChartDef],
    "Map":              [usMapDef, worldMapDef],
    "Custom":           [customPointDef, customLineDef, customBarDef, customRectDef, customAreaDef],
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
