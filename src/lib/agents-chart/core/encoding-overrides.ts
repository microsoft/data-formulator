// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChartEncoding, ChartTemplateDef } from './types';

/**
 * Compose a template's encoding-action overrides onto the base encodings.
 *
 * Category-B quick options (sort, color scheme, aggregate, orientation, …) are
 * stored by the host as *configuration overrides* keyed by the action's `key`
 * inside `chartProperties` — exactly like a chart property. They are NOT written
 * into the encoding map. This function is where the compiler composes them:
 * for each `encodingAction` whose override is present, it applies the action's
 * `set(encodings, value)` to produce the transformed encodings that feed the
 * rest of assembly.
 *
 * Backends call this once, at the very top of `assemble`, so every downstream
 * phase (semantic resolution → overflow → layout → instantiate) — and the
 * `InstantiateContext.encodings` handed to templates — sees the transformed
 * encodings. The base `encodings` argument is never mutated.
 *
 * An absent override (`undefined`) means "no override" and is skipped, so the
 * base encoding value (whatever the encoding shelf set, if anything) stands.
 * Because the override key matches the action key, charts saved before this
 * mechanism — which stored e.g. `chartProperties.colorScheme` directly — are
 * picked up automatically with no separate legacy fallback.
 */
export function applyEncodingOverrides(
    template: ChartTemplateDef,
    encodings: Record<string, ChartEncoding>,
    chartProperties?: Record<string, any>,
): Record<string, ChartEncoding> {
    const actions = template.encodingActions;
    if (!actions || actions.length === 0 || !chartProperties) return encodings;

    let result = encodings;
    for (const action of actions) {
        const override = chartProperties[action.key];
        if (override !== undefined) {
            result = action.set(result, override);
        }
    }
    return result;
}
