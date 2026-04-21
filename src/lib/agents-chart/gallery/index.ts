// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart Gallery–only assets (fixed datasets + test generators).
 */

export {
    REGIONAL_SURVEY_ROWS,
    regionalSurveyTable,
    REGIONAL_SURVEY_AXIS_LEVELS,
    type RegionalSurveyRow,
} from './regional-survey-data';

export {
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
} from './regional-survey-tests';

/** Keys registered in `TEST_GENERATORS` for the Regional Survey gallery tab. */
export const GALLERY_REGIONAL_SURVEY_GENERATOR_KEYS = [
    'Gallery: Scatter',
    'Gallery: Line',
    'Gallery: Bar',
    'Gallery: Stacked Bar',
    'Gallery: Grouped Bar',
    'Gallery: Area',
    'Gallery: Pie',
    'Gallery: Histogram',
    'Gallery: Radar',
    'Gallery: Rose',
    'Gallery: Stress Tests',
] as const;
