// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart/vegalite
 *
 * Vega-Lite backend for agents-chart.
 *
 * Compiles the core semantic layer into Vega-Lite specifications.
 * Contains VL-specific assembly, spec instantiation, and chart templates.
 */

// VL assembly function
export { assembleChart } from './assemble';

// VL spec instantiation (Phase 2)
export { applyLayoutToSpec, applyTooltips } from './instantiate-spec';

// VL template registry
export {
    chartTemplateDefs,
    allTemplateDefs,
    getTemplateDef,
    getTemplateChannels,
} from './templates';
