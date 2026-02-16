// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart/core
 *
 * Target-language-agnostic core of the chart engine.
 *
 * Contains semantic type system, layout computation, overflow filtering,
 * decision functions, and shared type definitions. No Vega-Lite or other
 * rendering-library dependencies.
 */

// Types & constants
export {
    channels,
    channelGroups,
    type ChartEncoding,
    type AssembleOptions,
    type ChartTemplateDef,
    type ChartWarning,
    type ChannelSemantics,
    type SemanticResult,
    type MarkCognitiveChannel,
    type LayoutDeclaration,
    type TruncationWarning,
    type LayoutResult,
    type InstantiateContext,
    type ChartPropertyDef,
    type OverflowStrategy,
    type OverflowStrategyContext,
    type OverflowResult,
} from './types';

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
    inferOrdinalSortOrder,
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

// Phase modules (analysis pipeline — VL-free)
export { resolveSemantics, convertTemporalData } from './resolve-semantics';
export { filterOverflow } from './filter-overflow';
export { computeLayout } from './compute-layout';
