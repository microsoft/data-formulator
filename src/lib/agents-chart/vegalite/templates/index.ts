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
import { scatterPlotDef, regressionDef, rangedDotPlotDef, boxplotDef } from './scatter';
import { barChartDef, pyramidChartDef, groupedBarChartDef, stackedBarChartDef, histogramDef, heatmapDef } from './bar';
import { lineChartDef } from './line';
import { bumpChartDef } from './bump';
import { areaChartDef, streamgraphDef } from './area';
import { pieChartDef } from './pie';
import { lollipopChartDef } from './lollipop';
import { densityPlotDef } from './density';
import { stripPlotDef } from './jitter';
import { candlestickChartDef } from './candlestick';
import { waterfallChartDef } from './waterfall';
import { barTableDef } from './bar-table';
import { radarChartDef } from './radar';
import { roseChartDef } from './rose';
import { usMapDef, worldMapDef } from './map';
import { customPointDef, customLineDef, customBarDef, customRectDef, customAreaDef } from './custom';
import { kpiCardDef } from './kpi-card';

/**
 * All chart template definitions, grouped by category.
 * Keys are category names shown in the UI, values are arrays of template definitions.
 *
 * Categories are organized by *mark family* — charts in the same group share
 * their dominant visual primitive (point, bar, line/area, etc.). This keeps
 * placement objective and the picker readable.
 */
export const vlTemplateDefs: { [key: string]: ChartTemplateDef[] } = {
    "Points":          [scatterPlotDef, regressionDef, rangedDotPlotDef, stripPlotDef],
    "Bars":            [barChartDef, groupedBarChartDef, stackedBarChartDef, lollipopChartDef, waterfallChartDef],
    "Distributions":   [histogramDef, densityPlotDef, boxplotDef, pyramidChartDef, candlestickChartDef],
    "Lines & Areas":   [lineChartDef, bumpChartDef, areaChartDef, streamgraphDef],
    "Circular":        [pieChartDef, roseChartDef, radarChartDef],
    "Tables & Maps":   [heatmapDef, barTableDef, kpiCardDef, usMapDef, worldMapDef],
    "Custom":          [customPointDef, customLineDef, customBarDef, customRectDef, customAreaDef],
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
