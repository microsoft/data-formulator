// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Barrel export for chart test-data generators.
 *
 * Re-exports every generator plus the shared types,
 * and exposes the master TEST_GENERATORS map and GALLERY_SECTIONS config.
 */

// Shared types & helpers
export type { TestCase, DateFormat, GallerySection } from './types';
export { makeField, makeEncodingItem, inferType, buildMetadata } from './types';

// Utilities
export { seededRandom, genDates, genMonths, genYears, genNaturalDates, genCategories, genRandomNames, genMeasure } from './generators';

// Chart-type generators
export { genScatterTests, genLinearRegressionTests } from './scatter-tests';
export { genBarTests, genStackedBarTests, genGroupedBarTests } from './bar-tests';
export { genHistogramTests, genBoxplotTests, genDensityTests, genStripPlotTests } from './distribution-tests';
export { genLineTests, genDottedLineTests, genBumpChartTests, genAreaTests, genStreamgraphTests } from './line-area-tests';
export {
    genHeatmapTests, genPieTests, genRangedDotPlotTests, genLollipopTests,
    genCustomTests, genWaterfallTests, genCandlestickTests, genRadarTests, genPyramidTests,
    genRoseTests,
} from './specialized-tests';
export { FACET_SIZES, DISCRETE_SIZES, genFacetColumnTests, genFacetRowTests, genFacetColRowTests, genFacetSmallTests, genFacetWrapTests, genFacetClipTests, genFacetOverflowedColTests, genFacetOverflowedColRowTests, genFacetOverflowedRowTests } from './facet-tests';
export { genOverflowTests, genElasticityTests } from './stress-tests';
export { genGasPressureTests } from './gas-pressure-tests';
export { genLineAreaStretchTests } from './line-area-stretch-tests';
export { genEChartsScatterTests, genEChartsLineTests, genEChartsBarTests, genEChartsStackedBarTests, genEChartsGroupedBarTests, genEChartsStressTests, genEChartsAreaTests, genEChartsPieTests, genEChartsHeatmapTests, genEChartsHistogramTests, genEChartsBoxplotTests, genEChartsRadarTests, genEChartsCandlestickTests, genEChartsStreamgraphTests, genEChartsFacetSmallTests, genEChartsFacetWrapTests, genEChartsFacetClipTests, genEChartsRoseTests, genEChartsGaugeTests, genEChartsFunnelTests, genEChartsTreemapTests, genEChartsSunburstTests, genEChartsSankeyTests, genEChartsUniqueStressTests } from './echarts-tests';
export { genChartJsScatterTests, genChartJsLineTests, genChartJsBarTests, genChartJsStackedBarTests, genChartJsGroupedBarTests, genChartJsAreaTests, genChartJsPieTests, genChartJsHistogramTests, genChartJsRadarTests, genChartJsStressTests, genChartJsRoseTests } from './chartjs-tests';
export { genGoFishScatterTests, genGoFishLineTests, genGoFishBarTests, genGoFishStackedBarTests, genGoFishGroupedBarTests, genGoFishAreaTests, genGoFishStackedAreaTests, genGoFishPieTests, genGoFishScatterPieTests, genGoFishStressTests } from './gofish-tests';
export { genDiscreteAxisTests } from './discrete-axis-tests';
export { genUnintendedScatterTests, genUnintendedBarTests, genUnintendedLineAreaTests, genUnintendedPartToWholeTests, genUnintendedStatisticalTests } from './unintended-tests';
export { genDateTests, genDateYearTests, genDateMonthTests, genDateYearMonthTests, genDateDecadeTests, genDateDateTimeTests, genDateHoursTests } from './date-tests';

// ---------------------------------------------------------------------------
// Master map & gallery sections
// ---------------------------------------------------------------------------
import { TestCase, GallerySection } from './types';

import { genScatterTests, genLinearRegressionTests } from './scatter-tests';
import { genBarTests, genStackedBarTests, genGroupedBarTests } from './bar-tests';
import { genHistogramTests, genBoxplotTests, genDensityTests, genStripPlotTests } from './distribution-tests';
import { genLineTests, genDottedLineTests, genBumpChartTests, genAreaTests, genStreamgraphTests } from './line-area-tests';
import {
    genHeatmapTests, genPieTests, genRangedDotPlotTests, genLollipopTests,
    genCustomTests, genWaterfallTests, genCandlestickTests, genRadarTests, genPyramidTests,
    genRoseTests,
} from './specialized-tests';
import { genFacetColumnTests, genFacetRowTests, genFacetColRowTests, genFacetSmallTests, genFacetWrapTests, genFacetClipTests, genFacetOverflowedColTests, genFacetOverflowedColRowTests, genFacetOverflowedRowTests } from './facet-tests';
import { genOverflowTests, genElasticityTests } from './stress-tests';
import { genGasPressureTests } from './gas-pressure-tests';
import { genLineAreaStretchTests } from './line-area-stretch-tests';
import { genDiscreteAxisTests } from './discrete-axis-tests';
import { genUnintendedScatterTests, genUnintendedBarTests, genUnintendedLineAreaTests, genUnintendedPartToWholeTests, genUnintendedStatisticalTests } from './unintended-tests';
import { genDateYearTests, genDateMonthTests, genDateYearMonthTests, genDateDecadeTests, genDateDateTimeTests, genDateHoursTests } from './date-tests';
import { genEChartsScatterTests, genEChartsLineTests, genEChartsBarTests, genEChartsStackedBarTests, genEChartsGroupedBarTests, genEChartsStressTests, genEChartsAreaTests, genEChartsPieTests, genEChartsHeatmapTests, genEChartsHistogramTests, genEChartsBoxplotTests, genEChartsRadarTests, genEChartsCandlestickTests, genEChartsStreamgraphTests, genEChartsFacetSmallTests, genEChartsFacetWrapTests, genEChartsFacetClipTests, genEChartsRoseTests, genEChartsGaugeTests, genEChartsFunnelTests, genEChartsTreemapTests, genEChartsSunburstTests, genEChartsSankeyTests, genEChartsUniqueStressTests } from './echarts-tests';
import { genChartJsScatterTests, genChartJsLineTests, genChartJsBarTests, genChartJsStackedBarTests, genChartJsGroupedBarTests, genChartJsAreaTests, genChartJsPieTests, genChartJsHistogramTests, genChartJsRadarTests, genChartJsStressTests, genChartJsRoseTests } from './chartjs-tests';
import { genGoFishScatterTests, genGoFishLineTests, genGoFishBarTests, genGoFishStackedBarTests, genGoFishGroupedBarTests, genGoFishAreaTests, genGoFishStackedAreaTests, genGoFishPieTests, genGoFishScatterPieTests, genGoFishStressTests } from './gofish-tests';

/** All test generators mapped by chart group */
export const TEST_GENERATORS: Record<string, () => TestCase[]> = {
    'Scatter Plot': genScatterTests,
    'Linear Regression': genLinearRegressionTests,
    'Bar Chart': genBarTests,
    'Stacked Bar Chart': genStackedBarTests,
    'Grouped Bar Chart': genGroupedBarTests,
    'Histogram': genHistogramTests,
    'Heatmap': genHeatmapTests,
    'Line Chart': genLineTests,
    'Dotted Line Chart': genDottedLineTests,
    'Bump Chart': genBumpChartTests,
    'Boxplot': genBoxplotTests,
    'Pie Chart': genPieTests,
    'Ranged Dot Plot': genRangedDotPlotTests,
    'Area Chart': genAreaTests,
    'Streamgraph': genStreamgraphTests,
    'Lollipop Chart': genLollipopTests,
    'Density Plot': genDensityTests,
    'Candlestick Chart': genCandlestickTests,
    'Waterfall Chart': genWaterfallTests,
    'Strip Plot': genStripPlotTests,
    'Radar Chart': genRadarTests,
    'Pyramid Chart': genPyramidTests,
    'Rose Chart': genRoseTests,
    'Custom Charts': genCustomTests,
    'Facet: Columns': genFacetColumnTests,
    'Facet: Rows': genFacetRowTests,
    'Facet: Cols+Rows': genFacetColRowTests,
    'Facet: Small': genFacetSmallTests,
    'Facet: Wrap': genFacetWrapTests,
    'Facet: Clip': genFacetClipTests,
    'Facet: Overflowed Col': genFacetOverflowedColTests,
    'Facet: Overflowed Col+Row': genFacetOverflowedColRowTests,
    'Facet: Overflowed Row': genFacetOverflowedRowTests,
    'Overflow': genOverflowTests,
    'Elasticity & Stretch': genElasticityTests,
    'Dates: Year': genDateYearTests,
    'Dates: Month': genDateMonthTests,
    'Dates: Year-Month': genDateYearMonthTests,
    'Dates: Decade': genDateDecadeTests,
    'Dates: Date/DateTime': genDateDateTimeTests,
    'Dates: Hours': genDateHoursTests,
    'Unintended: Scatter & Point': genUnintendedScatterTests,
    'Unintended: Bar': genUnintendedBarTests,
    'Unintended: Line & Area': genUnintendedLineAreaTests,
    'Unintended: Part-to-Whole': genUnintendedPartToWholeTests,
    'Unintended: Statistical': genUnintendedStatisticalTests,
    'Discrete Axis Sizing': genDiscreteAxisTests,
    'Gas Pressure (§2)': genGasPressureTests,
    'Line/Area Stretch': genLineAreaStretchTests,
    'ECharts: Scatter': genEChartsScatterTests,
    'ECharts: Line': genEChartsLineTests,
    'ECharts: Bar': genEChartsBarTests,
    'ECharts: Stacked Bar': genEChartsStackedBarTests,
    'ECharts: Grouped Bar': genEChartsGroupedBarTests,
    'ECharts: Area': genEChartsAreaTests,
    'ECharts: Pie': genEChartsPieTests,
    'ECharts: Heatmap': genEChartsHeatmapTests,
    'ECharts: Histogram': genEChartsHistogramTests,
    'ECharts: Boxplot': genEChartsBoxplotTests,
    'ECharts: Radar': genEChartsRadarTests,
    'ECharts: Candlestick': genEChartsCandlestickTests,
    'ECharts: Streamgraph': genEChartsStreamgraphTests,
    'ECharts: Facet Small': genEChartsFacetSmallTests,
    'ECharts: Facet Wrap': genEChartsFacetWrapTests,
    'ECharts: Facet Clip': genEChartsFacetClipTests,
    'ECharts: Rose': genEChartsRoseTests,
    'ECharts: Stress Tests': genEChartsStressTests,
    'ECharts: Gauge': genEChartsGaugeTests,
    'ECharts: Funnel': genEChartsFunnelTests,
    'ECharts: Treemap': genEChartsTreemapTests,
    'ECharts: Sunburst': genEChartsSunburstTests,
    'ECharts: Sankey': genEChartsSankeyTests,
    'ECharts: Unique Stress': genEChartsUniqueStressTests,
    'Chart.js: Scatter': genChartJsScatterTests,
    'Chart.js: Line': genChartJsLineTests,
    'Chart.js: Bar': genChartJsBarTests,
    'Chart.js: Stacked Bar': genChartJsStackedBarTests,
    'Chart.js: Grouped Bar': genChartJsGroupedBarTests,
    'Chart.js: Area': genChartJsAreaTests,
    'Chart.js: Pie': genChartJsPieTests,
    'Chart.js: Histogram': genChartJsHistogramTests,
    'Chart.js: Radar': genChartJsRadarTests,
    'Chart.js: Rose': genChartJsRoseTests,
    'Chart.js: Stress Tests': genChartJsStressTests,
    'GoFish Basic': () => [
        ...genGoFishScatterTests(),
        ...genGoFishLineTests(),
        ...genGoFishBarTests(),
        ...genGoFishStackedBarTests(),
        ...genGoFishGroupedBarTests(),
        ...genGoFishAreaTests(),
        ...genGoFishStackedAreaTests(),
        ...genGoFishPieTests(),
        ...genGoFishScatterPieTests(),
        ...genGoFishStressTests(),
    ],
};

/** Gallery organised into three sections */
export const GALLERY_SECTIONS: GallerySection[] = [
    {
        label: 'VegaLite: Chart Types',
        description: 'Demos for every supported chart type',
        entries: [
            'Scatter Plot', 'Linear Regression', 'Bar Chart', 'Stacked Bar Chart',
            'Grouped Bar Chart', 'Histogram', 'Heatmap', 'Line Chart', 'Dotted Line Chart',
            'Boxplot', 'Pie Chart', 'Ranged Dot Plot', 'Area Chart', 'Streamgraph',
            'Lollipop Chart', 'Density Plot', 'Bump Chart', 'Candlestick Chart', 'Waterfall Chart',
            'Strip Plot', 'Radar Chart', 'Pyramid Chart', 'Rose Chart', 'Custom Charts',
        ],
    },
    {
        label: 'VegaLite: Features & Facets',
        description: 'Faceting modes and feature combinations',
        entries: ['Facet: Columns', 'Facet: Rows', 'Facet: Cols+Rows', 'Facet: Small', 'Facet: Wrap', 'Facet: Clip', 'Facet: Overflowed Col', 'Facet: Overflowed Col+Row', 'Facet: Overflowed Row'],
    },
    {
        label: 'VegaLite: Stress Tests',
        description: 'Overflow, elasticity, and temporal format stress tests',
        entries: [
            'Overflow', 'Elasticity & Stretch', 'Discrete Axis Sizing', 'Gas Pressure (§2)',
            'Line/Area Stretch',
            'Dates: Year', 'Dates: Month', 'Dates: Year-Month',
            'Dates: Decade', 'Dates: Date/DateTime', 'Dates: Hours',
        ],
    },
    {
        label: 'VegaLite: Unintended Use',
        description: 'Wrong field types, degenerate data, and missing encodings — graceful failure tests',
        entries: [
            'Unintended: Scatter & Point',
            'Unintended: Bar',
            'Unintended: Line & Area',
            'Unintended: Part-to-Whole',
            'Unintended: Statistical',
        ],
    },
    {
        label: 'ECharts Backend',
        description: 'Same inputs through ECharts backend — compare series-based output vs VL encoding-based output',
        entries: [
            'ECharts: Scatter',
            'ECharts: Line',
            'ECharts: Bar',
            'ECharts: Stacked Bar',
            'ECharts: Grouped Bar',
            'ECharts: Area',
            'ECharts: Pie',
            'ECharts: Heatmap',
            'ECharts: Histogram',
            'ECharts: Boxplot',
            'ECharts: Radar',
            'ECharts: Candlestick',
            'ECharts: Streamgraph',
            'ECharts: Facet Small',
            'ECharts: Facet Wrap',
            'ECharts: Facet Clip',
            'ECharts: Rose',
            'ECharts: Gauge',
            'ECharts: Funnel',
            'ECharts: Treemap',
            'ECharts: Sunburst',
            'ECharts: Sankey',
            'ECharts: Unique Stress',
            'ECharts: Stress Tests',
        ],
    },
    {
        label: 'Chart.js Backend',
        description: 'Same inputs through Chart.js backend — compare dataset-based output vs VL/EC output',
        entries: [
            'Chart.js: Scatter',
            'Chart.js: Line',
            'Chart.js: Bar',
            'Chart.js: Stacked Bar',
            'Chart.js: Grouped Bar',
            'Chart.js: Area',
            'Chart.js: Pie',
            'Chart.js: Histogram',
            'Chart.js: Radar',
            'Chart.js: Rose',
            'Chart.js: Stress Tests',
        ],
    },
    {
        label: 'GoFish Basic',
        description: 'All GoFish chart examples on one page',
        entries: [
            'GoFish Basic',
        ],
    },
];
