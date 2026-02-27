// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts template registry.
 *
 * Mirrors the structure of vegalite/templates/index.ts but with ECharts
 * template definitions.
 */

import { ChartTemplateDef } from '../../core/types';
import { ecScatterPlotDef, ecLinearRegressionDef } from './scatter';
import { ecBarChartDef, ecStackedBarChartDef, ecGroupedBarChartDef } from './bar';
import { ecLineChartDef, ecDottedLineChartDef, ecBumpChartDef } from './line';
import { ecAreaChartDef } from './area';
import { ecPieChartDef } from './pie';
import { ecHeatmapDef } from './heatmap';
import { ecHistogramDef } from './histogram';
import { ecBoxplotDef } from './boxplot';
import { ecRadarChartDef } from './radar';
import { ecCandlestickDef } from './candlestick';
import { ecStreamgraphDef } from './streamgraph';
import { ecRoseChartDef } from './rose';
import { ecGaugeChartDef } from './gauge';
import { ecFunnelChartDef } from './funnel';
import { ecTreemapDef } from './treemap';
import { ecSunburstDef } from './sunburst';
import { ecSankeyDef } from './sankey';
import { ecLollipopChartDef } from './lollipop';
import { ecStripPlotDef } from './jitter';
import { ecWaterfallChartDef } from './waterfall';
import { ecPyramidChartDef } from './pyramid';
import { ecRangedDotPlotDef } from './ranged-dot';
import { ecDensityPlotDef } from './density';

/**
 * ECharts chart template definitions, grouped by category.
 * Mirrors vegalite/templates/index.ts so VegaLite test cases can run through ECharts.
 */
export const ecTemplateDefs: { [key: string]: ChartTemplateDef[] } = {
    'Scatter & Point': [ecScatterPlotDef, ecLinearRegressionDef, ecRangedDotPlotDef, ecBoxplotDef, ecStripPlotDef],
    'Bar':             [ecBarChartDef, ecGroupedBarChartDef, ecStackedBarChartDef, ecHistogramDef, ecLollipopChartDef, ecPyramidChartDef, ecHeatmapDef],
    'Line & Area':     [ecLineChartDef, ecDottedLineChartDef, ecBumpChartDef, ecAreaChartDef, ecStreamgraphDef],
    'Part-to-Whole':   [ecPieChartDef, ecFunnelChartDef, ecTreemapDef, ecSunburstDef],
    'Statistical':     [ecDensityPlotDef],
    'Financial':       [ecCandlestickDef],
    'Other':           [ecWaterfallChartDef],
    'Polar':           [ecRadarChartDef, ecRoseChartDef],
    'Indicator':       [ecGaugeChartDef],
    'Flow':            [ecSankeyDef],
};

/**
 * Flat list of all ECharts chart template definitions.
 */
export const ecAllTemplateDefs: ChartTemplateDef[] = Object.values(ecTemplateDefs).flat();

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
