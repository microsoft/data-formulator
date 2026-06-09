// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChartEncoding, EncodingActionDef } from './types';

/**
 * Reusable factories for Category-B encoding actions (see EncodingActionDef).
 *
 * These are authored once and attached to many templates, so the per-chart
 * knowledge (which channel is the category axis, which carries the measure)
 * lives in one place instead of being re-implemented per template.
 */

/** The semantic sort choices the Sort control exposes. */
export type SortChoice = 'value-asc' | 'value-desc';

// A measure is a quantitative channel or any aggregated channel.
const isMeasureEnc = (e?: ChartEncoding): boolean =>
    !!e?.field && (!!e.aggregate || e.type === 'quantitative');

// A sortable category axis is discrete (nominal/ordinal). Temporal axes are
// deliberately excluded: reordering a time axis by value scrambles the
// chronology, so Sort should not apply to them.
const isDiscreteCategoryEnc = (e?: ChartEncoding): boolean =>
    !!e?.field && !e.aggregate && e.type !== 'quantitative' && e.type !== 'temporal';

/**
 * Identify the discrete category axis and the measure axis among a pair of
 * position channels, so Sort works under either orientation (vertical or
 * horizontal) and only when a discrete axis actually exists.
 *
 * Returns `null` when there is no discrete category + measure pair to sort —
 * e.g. a temporal-x time series, or two quantitative axes (scatter). Callers
 * use this both to gate visibility and to no-op safely.
 */
function resolveSortChannels(
    encodings: Record<string, ChartEncoding>,
    candidates: [string, string],
): { category: string; measure: string } | null {
    const category = candidates.find(c => isDiscreteCategoryEnc(encodings[c]));
    const measure = candidates.find(c => isMeasureEnc(encodings[c]));
    if (!category || !measure || category === measure) return null;
    return { category, measure };
}

/**
 * Sort the category axis of a bar-like chart by the measure value.
 *
 * Encoding model: a value sort writes `sortBy = <measure channel>` (one of
 * 'x' | 'y', which the assembler understands) on the category channel.
 * "Default" clears the sort so the field's canonical ordering wins — the
 * natural order for ordinal/temporal-like categories, or alphabetic otherwise,
 * as decided by semantic resolution. The action is only applicable — and only
 * visible — when one position channel is a discrete category and the other is
 * a measure.
 *
 * @param channels Position-channel pair (default ['x', 'y']); the orientation
 *                 (which one is the category) is resolved per-encoding at runtime.
 */
export function makeSortAction(options?: {
    key?: string;
    label?: string;
    channels?: [string, string];
}): EncodingActionDef {
    const candidates = options?.channels ?? ['x', 'y'];
    return {
        key: options?.key ?? 'sort',
        label: options?.label ?? 'Sort',
        dependencies: candidates,
        isApplicable: (ctx) => resolveSortChannels(ctx.encodings, candidates) !== null,
        control: {
            type: 'discrete',
            options: [
                { value: undefined, label: 'Default' },
                { value: 'value-desc', label: 'Value ↓' },
                { value: 'value-asc', label: 'Value ↑' },
            ],
        },
        get: (encodings) => {
            const resolved = resolveSortChannels(encodings, candidates);
            if (!resolved) return undefined;
            const { category, measure } = resolved;
            const enc = encodings[category];
            if (enc.sortBy === measure) {
                return enc.sortOrder === 'descending' ? 'value-desc' : 'value-asc';
            }
            // Any other sort (label order, custom value order, sort-by-color)
            // isn't representable by this control → show as Default.
            return undefined;
        },
        set: (encodings, value: SortChoice | undefined) => {
            const resolved = resolveSortChannels(encodings, candidates);
            if (!resolved) return encodings;
            const { category, measure } = resolved;
            const base = encodings[category];
            let next: ChartEncoding;
            switch (value) {
                case 'value-asc':
                    next = { ...base, sortBy: measure, sortOrder: 'ascending' };
                    break;
                case 'value-desc':
                    next = { ...base, sortBy: measure, sortOrder: 'descending' };
                    break;
                default:
                    next = { ...base, sortBy: undefined, sortOrder: undefined };
            }
            return { ...encodings, [category]: next };
        },
    };
}
