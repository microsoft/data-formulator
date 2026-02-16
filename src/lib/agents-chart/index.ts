// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart
 *
 * Semantic-level chart assembly library.
 *
 * Given data, semantic types, encoding definitions, and a canvas size,
 * generates a Vega-Lite specification. No React/Redux/UI dependencies.
 *
 * Architecture:
 *   core/       — Target-agnostic: semantic types, layout, decisions, types
 *   vegalite/   — Vega-Lite backend: assembly, templates, spec instantiation
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

// Core: types, semantic types, decisions, layout, overflow
export * from './core';

// Vega-Lite backend: assembleChart, templates, spec instantiation
export * from './vegalite';

// ECharts backend: ecAssembleChart, templates, spec instantiation
export * from './echarts';

// Chart.js backend: cjsAssembleChart, templates, spec instantiation
export * from './chartjs';
