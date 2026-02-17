// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart/chartjs
 *
 * Chart.js backend for agents-chart.
 *
 * Compiles the core semantic layer into Chart.js configuration objects.
 * Contains CJS-specific assembly, spec instantiation, and chart templates.
 *
 * Architecture contrast with other backends:
 *   VL: encoding-channel-based — { encoding: { x: { field, type }, y: ... } }
 *   EC: series-based           — { series: [{ type, data }], xAxis, yAxis }
 *   CJS: dataset-based         — { type, data: { labels, datasets[] }, options }
 *
 * Same core pipeline (Phase 0 + Phase 1), different Phase 2 output.
 */

// CJS assembly function
export { assembleChartjs } from './assemble';

// CJS spec instantiation (Phase 2)
export { cjsApplyLayoutToSpec, cjsApplyTooltips } from './instantiate-spec';

// CJS template registry
export {
    cjsTemplateDefs,
    cjsAllTemplateDefs,
    cjsGetTemplateDef,
    cjsGetTemplateChannels,
} from './templates';
