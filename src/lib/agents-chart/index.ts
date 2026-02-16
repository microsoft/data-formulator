// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart
 *
 * Reusable chart assembly library.
 *
 * Given data, semantic types, encoding definitions, and a canvas size,
 * generates a Vega-Lite specification. No React/Redux/UI dependencies.
 *
 * Usage:
 * ```ts
 * import { assembleChart } from './lib/agents-chart';
 *
 * const spec = assembleChart(
 *   'Scatter Plot',
 *   { x: { field: 'weight' }, y: { field: 'mpg' }, color: { field: 'origin' } },
 *   myData,
 *   { weight: 'Quantity', mpg: 'Quantity', origin: 'Country' },
 *   { width: 400, height: 300 },
 * );
 * ```
 */

// Core assembly function
export { assembleChart } from './assemble';

// Types & constants
export {
    channels,
    channelGroups,
    type ChartEncoding,
    type AssembleOptions,
    type ChartTemplateDef,
    type ChartWarning,
} from './types';

// Template registry
export {
    chartTemplateDefs,
    allTemplateDefs,
    getTemplateDef,
    getTemplateChannels,
} from './templates';

// Semantic type system
export {
    SemanticTypes,
    type SemanticType,
    type VisCategory,
    type ZeroClass,
    type ZeroDecision,
    getVisCategory,
    inferVisCategory,
    getZeroClass,
    computeZeroDecision,
    computePaddedDomain,
    isMeasureType,
    isTimeSeriesType,
    isCategoricalType,
    isOrdinalType,
    isGeoType,
    getRecommendedColorScheme,
    getRecommendedColorSchemeWithMidpoint,
} from './semantic-types';

// Reusable decision functions
export {
    resolveEncodingType,
    computeElasticBudget,
    computeAxisStep,
    computeFacetLayout,
    computeLabelSizing,
    computeOverflow,
    computeGasPressure,
    DEFAULT_GAS_PRESSURE_PARAMS,
    type EncodingTypeDecision,
    type ElasticStretchParams,
    type ElasticBudget,
    type AxisStepDecision,
    type FacetLayoutDecision,
    type LabelSizingDecision,
    type OverflowDecision,
    type GasPressureParams,
    type GasPressureDecision,
} from './decisions';
