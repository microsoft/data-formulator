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
} from './specialized-tests';
export { FACET_SIZES, DISCRETE_SIZES, genFacetColumnTests, genFacetRowTests, genFacetColRowTests } from './facet-tests';
export { genOverflowTests, genElasticityTests } from './stress-tests';
export { genGasPressureTests } from './gas-pressure-tests';
export { genLineAreaStretchTests } from './line-area-stretch-tests';
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
} from './specialized-tests';
import { genFacetColumnTests, genFacetRowTests, genFacetColRowTests } from './facet-tests';
import { genOverflowTests, genElasticityTests } from './stress-tests';
import { genGasPressureTests } from './gas-pressure-tests';
import { genLineAreaStretchTests } from './line-area-stretch-tests';
import { genDiscreteAxisTests } from './discrete-axis-tests';
import { genUnintendedScatterTests, genUnintendedBarTests, genUnintendedLineAreaTests, genUnintendedPartToWholeTests, genUnintendedStatisticalTests } from './unintended-tests';
import { genDateYearTests, genDateMonthTests, genDateYearMonthTests, genDateDecadeTests, genDateDateTimeTests, genDateHoursTests } from './date-tests';

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
    'Custom Charts': genCustomTests,
    'Facet: Columns': genFacetColumnTests,
    'Facet: Rows': genFacetRowTests,
    'Facet: Cols+Rows': genFacetColRowTests,
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
};

/** Gallery organised into three sections */
export const GALLERY_SECTIONS: GallerySection[] = [
    {
        label: 'Chart Types',
        description: 'Demos for every supported chart type',
        entries: [
            'Scatter Plot', 'Linear Regression', 'Bar Chart', 'Stacked Bar Chart',
            'Grouped Bar Chart', 'Histogram', 'Heatmap', 'Line Chart', 'Dotted Line Chart',
            'Boxplot', 'Pie Chart', 'Ranged Dot Plot', 'Area Chart', 'Streamgraph',
            'Lollipop Chart', 'Density Plot', 'Bump Chart', 'Candlestick Chart', 'Waterfall Chart',
            'Strip Plot', 'Radar Chart', 'Pyramid Chart', 'Custom Charts',
        ],
    },
    {
        label: 'Features & Facets',
        description: 'Faceting modes and feature combinations',
        entries: ['Facet: Columns', 'Facet: Rows', 'Facet: Cols+Rows'],
    },
    {
        label: 'Stress Tests',
        description: 'Overflow, elasticity, and temporal format stress tests',
        entries: [
            'Overflow', 'Elasticity & Stretch', 'Discrete Axis Sizing', 'Gas Pressure (§2)',
            'Line/Area Stretch',
            'Dates: Year', 'Dates: Month', 'Dates: Year-Month',
            'Dates: Decade', 'Dates: Date/DateTime', 'Dates: Hours',
        ],
    },
    {
        label: 'Unintended Use',
        description: 'Wrong field types, degenerate data, and missing encodings — graceful failure tests',
        entries: [
            'Unintended: Scatter & Point',
            'Unintended: Bar',
            'Unintended: Line & Area',
            'Unintended: Part-to-Whole',
            'Unintended: Statistical',
        ],
    },
];
