// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Template registry — collects all chart template definitions.
 * No UI/icon dependencies. This is the pure-data template catalog.
 *
 * Each template file exports individual ChartTemplateDef objects.
 * Categories are defined here to group related charts in the UI.
 */

import { ChartTemplateDef } from '../../core/types';

// --- Individual chart imports ---
import { scatterPlotDef, linearRegressionDef, rangedDotPlotDef, boxplotDef } from './scatter';
import { barChartDef, pyramidChartDef, groupedBarChartDef, stackedBarChartDef, histogramDef, heatmapDef } from './bar';
import { lineChartDef, dottedLineChartDef } from './line';
import { bumpChartDef } from './bump';
import { areaChartDef, streamgraphDef } from './area';
import { pieChartDef } from './pie';
import { lollipopChartDef } from './lollipop';
import { densityPlotDef } from './density';
import { stripPlotDef } from './jitter';
import { candlestickChartDef } from './candlestick';
import { waterfallChartDef } from './waterfall';
import { radarChartDef } from './radar';
import { roseChartDef } from './rose';
import { usMapDef, worldMapDef } from './map';
import { customPointDef, customLineDef, customBarDef, customRectDef, customAreaDef } from './custom';

/**
 * All chart template definitions, grouped by category.
 * Keys are category names shown in the UI, values are arrays of template definitions.
 */
export const vlTemplateDefs: { [key: string]: ChartTemplateDef[] } = {
    "Scatter & Point":  [scatterPlotDef, linearRegressionDef, boxplotDef, stripPlotDef],
    "Bar":              [barChartDef, groupedBarChartDef, stackedBarChartDef, histogramDef, lollipopChartDef, pyramidChartDef],
    "Line & Area":      [lineChartDef, dottedLineChartDef, bumpChartDef, areaChartDef, streamgraphDef],
    "Part-to-Whole":    [pieChartDef, roseChartDef, heatmapDef, waterfallChartDef],
    "Statistical":      [densityPlotDef, rangedDotPlotDef, radarChartDef, candlestickChartDef],
    "Map":              [usMapDef, worldMapDef],
    "Custom":           [customPointDef, customLineDef, customBarDef, customRectDef, customAreaDef],
};

/**
 * Flat list of all Vega-Lite chart template definitions.
 */
export const vlAllTemplateDefs: ChartTemplateDef[] = Object.values(vlTemplateDefs).flat();

/**
 * Look up a Vega-Lite chart template definition by chart type name.
 */
export function vlGetTemplateDef(chartType: string): ChartTemplateDef | undefined {
    return vlAllTemplateDefs.find(t => t.chart === chartType);
}

/**
 * Get the available channels for a Vega-Lite chart type.
 */
export function vlGetTemplateChannels(chartType: string): string[] {
    return vlGetTemplateDef(chartType)?.channels || [];
}
