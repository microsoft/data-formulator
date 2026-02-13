// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart-lib
 *
 * Reusable chart assembly library.
 *
 * Given data, semantic types, encoding definitions, and a canvas size,
 * generates a Vega-Lite specification. No React/Redux/UI dependencies.
 *
 * Usage:
 * ```ts
 * import { assembleChart } from './lib/agents-chart-lib';
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
} from './types';

// Template registry
export {
    chartTemplateDefs,
    allTemplateDefs,
    getTemplateDef,
    getTemplateChannels,
} from './templates';

// Specialized sub-modules — import directly:
//   import { ... } from './lib/agents-chart-lib/semantic-types'
//   import { ... } from './lib/agents-chart-lib/helpers'
