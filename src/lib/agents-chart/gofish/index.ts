// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @module agents-chart/gofish
 *
 * GoFish backend for agents-chart.
 *
 * Compiles the core semantic layer into GoFish render calls.
 * GoFish uses a fluent API: chart(data).flow(...).mark(...).render(el, opts).
 *
 * Unlike VL/EC/CJS which produce JSON specs, GoFish renders directly to the
 * DOM via Solid.js. The assembler produces a GoFishSpec descriptor object
 * containing a `render(container)` function plus metadata for debugging.
 *
 * Architecture contrast with other backends:
 *   VL:  encoding-channel-based — { encoding: { x: { field, type }, y: ... } }
 *   EC:  series-based           — { series: [{ type, data }], xAxis, yAxis }
 *   CJS: dataset-based          — { type, data: { labels, datasets[] }, options }
 *   GF:  flow-based             — chart(data).flow(spread/stack/scatter).mark(rect/circle/line)
 *
 * Same core pipeline (Phase 0 + Phase 1), different Phase 2 output.
 */

// GF assembly function
export { assembleGoFish, type GoFishSpec } from './assemble';

// GF template registry
export {
    gfTemplateDefs,
    gfAllTemplateDefs,
    gfGetTemplateDef,
    gfGetTemplateChannels,
} from './templates';
