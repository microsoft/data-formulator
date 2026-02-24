// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart/echarts
 *
 * ECharts backend for agents-chart.
 *
 * Compiles the core semantic layer into ECharts option objects.
 * Contains EC-specific assembly, spec instantiation, and chart templates.
 *
 * Architecture contrast with Vega-Lite backend:
 *   VL: encoding-channel-based — { encoding: { x: { field, type }, y: ... } }
 *   EC: series-based           — { series: [{ type, data }], xAxis, yAxis }
 *
 * Same core pipeline (Phase 0 + Phase 1), different Phase 2 output.
 */

// EC assembly function
export { assembleECharts } from './assemble';

// EC spec instantiation (Phase 2)
export { ecApplyLayoutToSpec, ecApplyTooltips } from './instantiate-spec';

// EC template registry
export {
    ecTemplateDefs,
    ecAllTemplateDefs,
    ecGetTemplateDef,
    ecGetTemplateChannels,
} from './templates';

// EC recommendation & adaptation
export { ecAdaptChart, ecRecommendEncodings } from './recommendation';
