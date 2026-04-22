// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Barrel export for chart test-data generators.
 *
 * Re-exports every generator plus the shared types,
 * and exposes the master TEST_GENERATORS map and GALLERY_SECTIONS config.
 */

// Shared types & helpers
export type { TestCase, DateFormat } from './types';
export { makeField, makeEncodingItem, inferType, buildMetadata } from './types';

// Utilities
export { seededRandom, genDates, genMonths, genYears, genNaturalDates, genCategories, genRandomNames, genMeasure } from './generators';

// Chart-type generators
export { genScatterTests, genRegressionTests } from './scatter-tests';
export { genBarTests, genStackedBarTests, genGroupedBarTests } from './bar-tests';
export { genHistogramTests, genBoxplotTests, genDensityTests, genStripPlotTests } from './distribution-tests';
export { genLineTests } from './line-tests';
export { genDottedLineTests, genBumpChartTests } from './line-area-tests';
export { genAreaTests, genStreamgraphTests } from './area-tests';
export {
    genHeatmapTests, genPieTests, genRangedDotPlotTests, genLollipopTests,
    genCustomTests, genWaterfallTests, genCandlestickTests, genRadarTests, genPyramidTests,
    genRoseTests,
} from './specialized-tests';
export { FACET_SIZES, DISCRETE_SIZES, genFacetColumnTests, genFacetRowTests, genFacetColRowTests, genFacetSmallTests, genFacetWrapTests, genFacetClipTests, genFacetOverflowedColTests, genFacetOverflowedColRowTests, genFacetOverflowedRowTests, genFacetDenseLineTests } from './facet-tests';
export { genOverflowTests, genElasticityTests } from './stress-tests';
export { genGasPressureTests } from './gas-pressure-tests';
export { genLineAreaStretchTests } from './line-area-stretch-tests';
export { genEChartsScatterTests, genEChartsLineTests, genEChartsBarTests, genEChartsStackedBarTests, genEChartsGroupedBarTests, genEChartsStressTests, genEChartsAreaTests, genEChartsPieTests, genEChartsHeatmapTests, genEChartsHistogramTests, genEChartsBoxplotTests, genEChartsRadarTests, genEChartsCandlestickTests, genEChartsStreamgraphTests, genEChartsFacetSmallTests, genEChartsFacetWrapTests, genEChartsFacetClipTests, genEChartsRoseTests, genEChartsGaugeTests, genEChartsFunnelTests, genEChartsTreemapTests, genEChartsSunburstTests, genEChartsSankeyTests, genEChartsUniqueStressTests } from './echarts-tests';
export { genChartJsScatterTests, genChartJsLineTests, genChartJsBarTests, genChartJsStackedBarTests, genChartJsGroupedBarTests, genChartJsAreaTests, genChartJsPieTests, genChartJsHistogramTests, genChartJsRadarTests, genChartJsStressTests, genChartJsRoseTests } from './chartjs-tests';
export { genGoFishScatterTests, genGoFishLineTests, genGoFishBarTests, genGoFishStackedBarTests, genGoFishGroupedBarTests, genGoFishAreaTests, genGoFishStackedAreaTests, genGoFishPieTests, genGoFishScatterPieTests, genGoFishStressTests } from './gofish-tests';
export { genDiscreteAxisTests } from './discrete-axis-tests';
export { genDateTests, genDateYearTests, genDateMonthTests, genDateYearMonthTests, genDateDecadeTests, genDateDateTimeTests, genDateHoursTests } from './date-tests';
export { genSemanticContextTests, genSnapToBoundTests } from './semantic-tests';
export {
    OMNI_VIZ_ROWS,
    OMNI_VIZ_LEVELS,
    OMNI_VIZ_MONTHS,
    OMNI_VIZ_REGIONS,
    OMNI_VIZ_GAME_TYPES,
    OMNI_VIZ_GAME_ORDER,
    omniVizDetailTable,
    omniVizGroupedBarRegionGameTypeTable,
    omniVizHeatmapGameMonthTable,
    omniVizLineTable,
    omniVizSunburstTable,
    omniVizWaterfallTable,
    type OmniVizRow,
} from './omni-viz-dataset';
export {
    genOmniVizGroupedBarTests,
    genOmniVizLineTests,
    genOmniVizHeatmapTests,
    genOmniVizSunburstTests,
    genOmniVizWaterfallTests,
    GALLERY_OMNI_VIZ_GENERATOR_KEYS,
    OMNI_VIZ_GALLERY_DATA_TABLE_ENTRY,
} from './omni-viz-tests';

// Gallery navigation tree (language -> category -> page)
export {
    GALLERY_TREE,
    DEFAULT_PATH,
    findPage,
    firstPagePath,
} from './gallery-tree';
export type {
    GallerySection as GalleryTreeSection,
    GalleryCategory,
    GalleryPage,
    GalleryPageRender,
    SingleRenderLibrary,
} from './gallery-tree';

// ---------------------------------------------------------------------------
// Master TEST_GENERATORS map
// ---------------------------------------------------------------------------
import { TestCase } from './types';

import { genScatterTests, genRegressionTests } from './scatter-tests';
import { genBarTests, genStackedBarTests, genGroupedBarTests } from './bar-tests';
import { genHistogramTests, genBoxplotTests, genDensityTests, genStripPlotTests } from './distribution-tests';
import { genLineTests } from './line-tests';
import { genDottedLineTests, genBumpChartTests } from './line-area-tests';
import { genAreaTests, genStreamgraphTests } from './area-tests';
import {
    genHeatmapTests, genPieTests, genRangedDotPlotTests, genLollipopTests,
    genCustomTests, genWaterfallTests, genCandlestickTests, genRadarTests, genPyramidTests,
    genRoseTests,
} from './specialized-tests';
import { genFacetColumnTests, genFacetRowTests, genFacetColRowTests, genFacetSmallTests, genFacetWrapTests, genFacetClipTests, genFacetOverflowedColTests, genFacetOverflowedColRowTests, genFacetOverflowedRowTests, genFacetDenseLineTests } from './facet-tests';
import { genOverflowTests, genElasticityTests } from './stress-tests';
import { genGasPressureTests } from './gas-pressure-tests';
import { genLineAreaStretchTests } from './line-area-stretch-tests';
import { genDiscreteAxisTests } from './discrete-axis-tests';
import { genDateYearTests, genDateMonthTests, genDateYearMonthTests, genDateDecadeTests, genDateDateTimeTests, genDateHoursTests } from './date-tests';
import { genSemanticContextTests, genSnapToBoundTests } from './semantic-tests';
import { genEChartsScatterTests, genEChartsLineTests, genEChartsBarTests, genEChartsStackedBarTests, genEChartsGroupedBarTests, genEChartsStressTests, genEChartsAreaTests, genEChartsPieTests, genEChartsHeatmapTests, genEChartsHistogramTests, genEChartsBoxplotTests, genEChartsRadarTests, genEChartsCandlestickTests, genEChartsStreamgraphTests, genEChartsFacetSmallTests, genEChartsFacetWrapTests, genEChartsFacetClipTests, genEChartsRoseTests, genEChartsGaugeTests, genEChartsFunnelTests, genEChartsTreemapTests, genEChartsSunburstTests, genEChartsSankeyTests, genEChartsUniqueStressTests } from './echarts-tests';
import { genChartJsScatterTests, genChartJsLineTests, genChartJsBarTests, genChartJsStackedBarTests, genChartJsGroupedBarTests, genChartJsAreaTests, genChartJsPieTests, genChartJsHistogramTests, genChartJsRadarTests, genChartJsStressTests, genChartJsRoseTests } from './chartjs-tests';
import { genGoFishScatterTests, genGoFishLineTests, genGoFishBarTests, genGoFishStackedBarTests, genGoFishGroupedBarTests, genGoFishAreaTests, genGoFishStackedAreaTests, genGoFishPieTests, genGoFishScatterPieTests, genGoFishStressTests } from './gofish-tests';
import {
    genGalleryRegionalSurveyScatterTests,
    genGalleryRegionalSurveyLineTests,
    genGalleryRegionalSurveyBarTests,
    genGalleryRegionalSurveyStackedBarTests,
    genGalleryRegionalSurveyGroupedBarTests,
    genGalleryRegionalSurveyAreaTests,
    genGalleryRegionalSurveyPieTests,
    genGalleryRegionalSurveyHistogramTests,
    genGalleryRegionalSurveyRadarTests,
    genGalleryRegionalSurveyRoseTests,
} from '../gallery/regional-survey-tests';
import {
    genOmniVizGroupedBarTests,
    genOmniVizLineTests,
    genOmniVizHeatmapTests,
    genOmniVizSunburstTests,
    genOmniVizWaterfallTests,
    GALLERY_OMNI_VIZ_GENERATOR_KEYS,
    OMNI_VIZ_GALLERY_DATA_TABLE_ENTRY,
} from './omni-viz-tests';

/** All test generators mapped by chart group */
export const TEST_GENERATORS: Record<string, () => TestCase[]> = {
    'Scatter Plot': genScatterTests,
    'Regression': genRegressionTests,
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
    'Facet: Dense Line': genFacetDenseLineTests,
    'Overflow': genOverflowTests,
    'Elasticity & Stretch': genElasticityTests,
    'Dates: Year': genDateYearTests,
    'Dates: Month': genDateMonthTests,
    'Dates: Year-Month': genDateYearMonthTests,
    'Dates: Decade': genDateDecadeTests,
    'Dates: Date/DateTime': genDateDateTimeTests,
    'Dates: Hours': genDateHoursTests,
    'Discrete Axis Sizing': genDiscreteAxisTests,
    'Gas Pressure (§2)': genGasPressureTests,
    'Line/Area Stretch': genLineAreaStretchTests,
    'Semantic Context': genSemanticContextTests,
    'Snap-to-Bound': genSnapToBoundTests,
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
    'Gallery: Scatter': genGalleryRegionalSurveyScatterTests,
    'Gallery: Line': genGalleryRegionalSurveyLineTests,
    'Gallery: Bar': genGalleryRegionalSurveyBarTests,
    'Gallery: Stacked Bar': genGalleryRegionalSurveyStackedBarTests,
    'Gallery: Grouped Bar': genGalleryRegionalSurveyGroupedBarTests,
    'Gallery: Area': genGalleryRegionalSurveyAreaTests,
    'Gallery: Pie': genGalleryRegionalSurveyPieTests,
    'Gallery: Histogram': genGalleryRegionalSurveyHistogramTests,
    'Gallery: Radar': genGalleryRegionalSurveyRadarTests,
    'Gallery: Rose': genGalleryRegionalSurveyRoseTests,
    'Omni: Line': genOmniVizLineTests,
    'Omni: Grouped Bar': genOmniVizGroupedBarTests,
    'Omni: Waterfall': genOmniVizWaterfallTests,
    'Omni: Heatmap': genOmniVizHeatmapTests,
    'Omni: Sunburst': genOmniVizSunburstTests,
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

