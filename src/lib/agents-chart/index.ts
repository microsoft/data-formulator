// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart
 *
 * Semantic-level chart assembly library.
 *
 * Given data, semantic types, encoding definitions, and a canvas size,
 * generates a chart specification. No React/Redux/UI dependencies.
 *
 * Architecture:
 *   core/       — Target-agnostic: semantic types, layout, decisions, types
 *   vegalite/   — Vega-Lite backend: assembly, templates, spec instantiation
 *   echarts/    — ECharts backend: assembly, templates, spec instantiation
 *   chartjs/    — Chart.js backend: assembly, templates, spec instantiation
 *
 * Assembly functions:
 *   assembleVegaLite(input)  — Vega-Lite spec
 *   assembleECharts(input)   — ECharts option object
 *   assembleChartjs(input)   — Chart.js config object
 *
 * Template registries:
 *   vlTemplateDefs / vlGetTemplateDef / vlGetTemplateChannels
 *   ecTemplateDefs / ecGetTemplateDef / ecGetTemplateChannels
 *   cjsTemplateDefs / cjsGetTemplateDef / cjsGetTemplateChannels
 *
 * Usage:
 * ```ts
 * import { assembleVegaLite } from './lib/agents-chart';
 *
 * const spec = assembleVegaLite({
 *   data: { values: myData },
 *   semantic_types: { weight: 'Quantity', mpg: 'Quantity', origin: 'Country' },
 *   chart_spec: {
 *     chartType: 'Scatter Plot',
 *     encodings: { x: { field: 'weight' }, y: { field: 'mpg' }, color: { field: 'origin' } },
 *     canvasSize: { width: 400, height: 300 },
 *   },
 * });
 * ```
 */

// Core: types, semantic types, decisions, layout, overflow
export * from './core';

// Vega-Lite backend: assembleVegaLite, templates, spec instantiation
export * from './vegalite';

// ECharts backend: assembleECharts, templates, spec instantiation
export * from './echarts';

// Chart.js backend: assembleChartjs, templates, spec instantiation
export * from './chartjs';
