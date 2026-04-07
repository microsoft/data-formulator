// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * FIELD SEMANTICS
 * =============================================================================
 *
 * Resolves what a data field *is* by combining its semantic annotation
 * (from LLM or user) with the actual data values. This resolves the
 * one-to-many ambiguities in the type registry (e.g., Score can be
 * quantitative or ordinal depending on cardinality).
 *
 * The entry point is `resolveFieldSemantics()`. It produces a
 * `FieldSemantics` object that captures the field's identity, format,
 * aggregation role, domain, scale hint, and ordering — everything
 * about *what the data represents*, independent of how it will be
 * visualized on any particular channel.
 *
 * Design doc: docs/design-compilation-context.md
 *
 * VL dependency: **None** — pure TypeScript, no rendering library imports.
 * =============================================================================
 */

import {
    type VisCategory,
    type TypeRegistryEntry,
    getRegistryEntry,
    isRegistered,
} from './type-registry';

import {
    getZeroClass,
    inferOrdinalSortOrder,
    inferVisCategory,
    type ZeroClass,
} from './semantic-types';

// Re-export for backward compatibility — consumers can import from here or type-registry
export { getRegistryEntry } from './type-registry';
export type { TypeRegistryEntry } from './type-registry';

// =============================================================================
// §1  PUBLIC TYPES
// =============================================================================

/**
 * Enriched semantic annotation from LLM or user.
 */
export interface SemanticAnnotation {
    /** The T2 semantic type string (e.g., "Amount", "Score", "Month") */
    semanticType: string;

    /**
     * Intrinsic domain (value range) of this field's scale.
     * Only for bounded/scaled types — NOT for open-ended measures.
     * E.g., [1, 5] for 5-star rating, [0, 100] for score, [-90, 90] for latitude.
     */
    intrinsicDomain?: [number, number];

    /** Unit or currency code. E.g., "USD", "°C", "kg" */
    unit?: string;

    /** Explicit ordinal ordering. E.g., ["Low", "Medium", "High"] */
    sortOrder?: string[];
}

/** d3-compatible format specification */
export interface FormatSpec {
    /** d3-format pattern: ",.2f", ".1%", "+.2f", etc. */
    pattern?: string;
    /** Prefix before the number: "$", "€", "£" */
    prefix?: string;
    /** Suffix after the number: "°C", "%", " kg" */
    suffix?: string;
    /** Whether large values should be abbreviated (1K, 1M, 1B) */
    abbreviate?: boolean;
}

/** Domain bounds constraint */
export interface DomainConstraint {
    min?: number;
    max?: number;
    /** Whether to hard-clamp values outside the domain */
    clamp?: boolean;
}

/** Tick mark constraint */
export interface TickConstraint {
    /** Only show integer tick values */
    integersOnly?: boolean;
    /** Exact tick values to show (for small domains like 1–5 rating) */
    exactTicks?: number[];
    /** Minimum step between ticks */
    minStep?: number;
}

/** Color scheme recommendation from semantic analysis */
export interface ColorSchemeHint {
    /** Whether the field is best shown with sequential, diverging, or categorical colors */
    type: 'sequential' | 'diverging' | 'categorical';
    /** For diverging: the midpoint value */
    divergingMidpoint?: number;
    /** Whether the field is inherently diverging (always show diverging) vs conditional */
    inherentlyDiverging?: boolean;
}

/** Result of diverging midpoint analysis */
export interface DivergingInfo {
    /** The midpoint value where the diverging center sits */
    midpoint: number;
    /** Whether this type is always diverging or only when data spans both sides */
    inherent: boolean;
    /** Source of the midpoint determination */
    source: 'unit' | 'type-intrinsic' | 'domain' | 'data';
}

/**
 * Resolved field semantics — what the data field *is*.
 *
 * Derived from a `SemanticAnnotation` (semantic type + optional metadata)
 * plus actual data values. Resolves the one-to-many ambiguities in the
 * type registry by inspecting the concrete data representation.
 *
 * This is purely about the field’s identity and intrinsic properties —
 * NOT about how it will be visualized on a particular channel.
 * Channel-specific decisions (color scheme, axis reversal, interpolation,
 * tick strategy, stacking, etc.) belong in `ChannelSemantics`.
 *
 * Built once per field per dataset by `resolveFieldSemantics()`.
 */
export interface FieldSemantics {
    // --- Identity ---
    /** The semantic annotation (normalized from string or object input) */
    semanticAnnotation: SemanticAnnotation;

    // --- Encoding ---
    /** Preferred encoding type, disambiguated from registry using data */
    defaultVisType: VisCategory;

    // --- Formatting ---
    /** Number format derived from data type and unit (only set when confident) */
    format?: FormatSpec;
    /** Tooltip format (typically higher precision than axis format) */
    tooltipFormat?: FormatSpec;

    // --- Aggregation ---
    /** Default aggregate function — intrinsic to the field (additive vs intensive) */
    aggregationDefault?: 'sum' | 'average';

    // --- Scale ---
    /** Zero-baseline classification (meaningful / arbitrary / bipolar) */
    zeroClass: ZeroClass | 'unknown';
    /** Recommended scale type based on data distribution */
    scaleType?: 'linear' | 'log' | 'sqrt' | 'symlog';

    // --- Domain ---
    /** Intrinsic domain bounds (from annotation, type-intrinsic, or data-inferred) */
    domainConstraint?: DomainConstraint;

    // --- Ordering ---
    /** Canonical ordinal sort order (months, days, etc.) */
    canonicalOrder?: string[];
    /** Whether the canonical order is cyclic (wraps around) */
    cyclic: boolean;
    /** Default sort direction */
    sortDirection: 'ascending' | 'descending';

    // --- Histogram ---
    /** Whether this field’s data distribution benefits from binning */
    binningSuggested: boolean;
}

// =============================================================================
// §2  TYPE REGISTRY  →  see ./type-registry.ts (single source of truth)
// =============================================================================

/**
 * Extract the semantic type string from a bare string or annotation object.
 * Used when downstream code only needs the type string, not the full annotation.
 */
export function toTypeString(input: string | SemanticAnnotation | undefined): string {
    if (!input) return '';
    if (typeof input === 'string') return input;
    return input.semanticType || '';
}

// =============================================================================
// §3  ANNOTATION NORMALIZATION
// =============================================================================

/**
 * Normalize a bare string or enriched annotation object into a
 * consistent SemanticAnnotation.
 *
 * Accepts:
 *   "Amount"                                          → { semanticType: "Amount" }
 *   { semanticType: "Score", intrinsicDomain: [1,5] }  → as-is
 *   undefined / ""                                     → { semanticType: "Unknown" }
 */
export function normalizeAnnotation(
    input: string | SemanticAnnotation | undefined,
): SemanticAnnotation {
    if (!input) return { semanticType: 'Unknown' };
    if (typeof input === 'string') return { semanticType: input || 'Unknown' };
    return { ...input, semanticType: input.semanticType || 'Unknown' };
}

// =============================================================================
// §4  FORMAT RESOLUTION
// =============================================================================

/** Map currency codes to display symbols */
const CURRENCY_MAP: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥',
    KRW: '₩', INR: '₹', BRL: 'R$', CAD: 'CA$', AUD: 'A$',
    CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr',
};

/**
 * Map common unit strings to suffix display.
 *
 * Limited to a small set of well-known, universally understood units.
 * Unknown/arbitrary annotation.unit values are intentionally excluded
 * to keep axis labels clean and avoid displaying obscure or verbose
 * unit strings on tick marks.
 */
const UNIT_SUFFIX_MAP: Record<string, string> = {
    // Temperature
    '°C': '°C', '°F': '°F', C: '°C', F: '°F',
    // Mass
    kg: ' kg', lb: ' lb',
    // Distance
    km: ' km', mi: ' mi', m: ' m', ft: ' ft',
    // Speed
    'km/h': ' km/h', mph: ' mph',
    // Time
    sec: ' s', min: ' min', hr: ' hr',
    seconds: ' s', minutes: ' min', hours: ' hr',
    // Percentage (handled by formatClass, but allow explicit suffix)
    '%': '%',
};

/**
 * Detect whether percentage data uses 0–1 (fractional) or 0–100 (whole-number)
 * representation.
 *
 * Values can exceed the intrinsic range (e.g., 155 % growth), so we look at
 * the *majority* of absolute values rather than just the max.
 */
function detectPercentageRepresentation(values: number[]): '0-1' | '0-100' {
    if (values.length === 0) return '0-100';
    const abs = values.map(Math.abs);
    // If the majority of values are ≤ 1, treat as fractional 0–1 representation
    const countBelow1 = abs.filter(v => v <= 1).length;
    if (countBelow1 / abs.length >= 0.8) return '0-1';
    return '0-100';
}

/**
 * Detect the maximum number of meaningful decimal places in a set of values.
 *
 * Returns 0 for all-integer data, 1 for data like [3.7, 4.2], 2 for [1.25, 3.50], etc.
 * Caps at 4 to avoid floating-point noise (e.g., 0.1 + 0.2 = 0.30000000000000004).
 */
function detectPrecision(values: number[]): number {
    let maxDecimals = 0;
    for (const v of values) {
        if (!Number.isFinite(v)) continue;
        // Convert to string, trim trailing zeros, count decimal places
        const s = v.toFixed(10);  // enough digits to detect real precision
        const dot = s.indexOf('.');
        if (dot === -1) continue;
        // Trim trailing zeros
        let end = s.length - 1;
        while (end > dot && s[end] === '0') end--;
        const decimals = end > dot ? end - dot : 0;
        if (decimals > maxDecimals) maxDecimals = decimals;
    }
    return Math.min(maxDecimals, 4);
}

/**
 * Build a d3-format pattern that matches the detected data precision.
 *
 * @param values  Numeric data values
 * @param useGrouping  Whether to include thousands separator (,)
 * @param signMode  '' = default, '+' = always show sign
 * @returns  Format pattern string like ',d', ',.1f', ',.2f'
 */
function precisionFormat(values: number[], useGrouping = true, signMode: '' | '+' = ''): string {
    const p = detectPrecision(values);
    const group = useGrouping ? ',' : '';
    if (p === 0) return `${signMode}${group}d`;
    return `${signMode}${group}.${p}f`;
}

/**
 * Resolve the format specification for a field based on its semantic type,
 * annotation metadata, and data values.
 *
 * Priority: annotation.unit > type-specific defaults
 */
export function resolveFormat(
    semanticType: string,
    annotation: SemanticAnnotation,
    values: any[],
): { format?: FormatSpec; tooltipFormat?: FormatSpec } {
    const entry = getRegistryEntry(semanticType);
    const unit = annotation.unit;

    // Resolve currency prefix from annotation.unit
    const currencyPrefix = unit ? CURRENCY_MAP[unit.toUpperCase()] ?? CURRENCY_MAP[unit] : undefined;
    // Resolve unit suffix from annotation.unit — only use known units;
    // unknown units are dropped to avoid polluting tick labels with
    // obscure or verbose strings.
    const unitSuffix = unit ? UNIT_SUFFIX_MAP[unit] : undefined;

    const nums = values.filter((v: any) => typeof v === 'number' && !isNaN(v));

    // ─── Policy: only override axis format when the raw number would be
    // genuinely misleading.  Two cases qualify:
    //   1. Percent with 0–1 data + intrinsicDomain → representation transform
    //   2. Currency with a known unit → add currency symbol
    // Everything else: let VL handle axis formatting natively.
    // Tooltip format is lower-stakes (transient hover) so we're more liberal.

    switch (entry.formatClass) {
        case 'currency': {
            const pfx = currencyPrefix;
            // Only override axis when we have a known currency symbol;
            // without it the axis is better left to VL defaults.
            if (pfx) {
                const axisPattern = semanticType === 'Price' ? ',.2f' : precisionFormat(nums);
                return {
                    format: { pattern: axisPattern, prefix: pfx },
                    tooltipFormat: { pattern: ',.2f', prefix: pfx },
                };
            }
            return { tooltipFormat: { pattern: ',.2f' } };
        }

        case 'percent': {
            // Without intrinsicDomain we can't reliably distinguish 0–1
            // from 0–100, so defer to VL.
            if (!annotation.intrinsicDomain) {
                return { tooltipFormat: { pattern: precisionFormat(nums) } };
            }
            const rep = detectPercentageRepresentation(nums);
            if (rep === '0-1') {
                // 0–1 fractional → axis must transform (0.45 → "45%")
                const p = detectPrecision(nums);
                const axisP = Math.max(0, p - 2);
                const tipP  = Math.min(axisP + 1, 4);
                return {
                    format: { pattern: `.${axisP}~%` },
                    tooltipFormat: { pattern: `.${tipP}%` },
                };
            }
            // Whole-number 0–100: raw numbers are readable as-is.
            // Axis title conveys "percentage"; tooltip adds suffix for clarity.
            return {
                tooltipFormat: { pattern: precisionFormat(nums, false), suffix: '%' },
            };
        }

        case 'unit-suffix':
            return {
                tooltipFormat: unitSuffix
                    ? { pattern: precisionFormat(nums), suffix: unitSuffix }
                    : { pattern: precisionFormat(nums) },
            };

        case 'integer':
            // Year/Decade: no comma — '2,024' is wrong for a year.
            // Other integers (Count, Rank, Hour): comma separator aids readability.
            if (semanticType === 'Year' || semanticType === 'Decade') {
                return {};
            }
            return { tooltipFormat: { pattern: ',d' } };

        case 'decimal':
            return { tooltipFormat: { pattern: precisionFormat(nums) } };

        case 'plain':
        default:
            return {};
    }
}

// =============================================================================
// §5  DEFAULT VIS TYPE
// =============================================================================

/**
 * Resolve the default Vega-Lite encoding type for a field.
 *
 * When the registry lists multiple candidates (e.g., Score → ['quantitative', 'ordinal']),
 * disambiguate using data statistics (distinct value count).
 */
export function resolveDefaultVisType(
    semanticType: string,
    values: any[],
): VisCategory {
    // For unregistered types, defer entirely to data characteristics
    if (!isRegistered(semanticType)) {
        return inferVisCategory(values);
    }

    const entry = getRegistryEntry(semanticType);
    const candidates = entry.visEncodings;
    if (candidates.length === 1) {
        // Guard: if registry says quantitative but actual values are
        // strings (e.g. binned ranges like "91-95"), defer to data inference.
        if (candidates[0] === 'quantitative') {
            const nonNull = values.filter(v => v != null);
            const allNumeric = nonNull.length > 0 &&
                nonNull.every(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(+v) && v.trim() !== ''));
            if (!allNumeric) {
                return inferVisCategory(values);
            }
        }
        return candidates[0];
    }

    // Disambiguate between quantitative and ordinal based on distinct count
    if (candidates.includes('quantitative') && candidates.includes('ordinal')) {
        const distinct = new Set(values.filter(v => v != null)).size;
        // Small number of distinct values → ordinal feels more natural
        return distinct <= 12 ? 'ordinal' : 'quantitative';
    }

    // Disambiguate between temporal and ordinal
    if (candidates.includes('temporal') && candidates.includes('ordinal')) {
        const distinct = new Set(values.filter(v => v != null)).size;
        // Few values → ordinal (e.g., only 3 years: 2022, 2023, 2024)
        return distinct <= 6 ? 'ordinal' : 'temporal';
    }

    // If geographic + quantitative (lat/lon), prefer quantitative for standard charts
    if (candidates.includes('geographic') && candidates.includes('quantitative')) {
        return 'quantitative';
    }

    return candidates[0];
}

// =============================================================================
// §6  AGGREGATION DEFAULT
// =============================================================================

/**
 * Resolve the default aggregation function based on the field's role.
 *
 * - Additive measures → sum (parts sum to a meaningful total)
 * - Intensive measures → average (rates/averages shouldn't be summed)
 * - Signed-additive    → sum (preserves sign semantics)
 * - Dimensions/IDs     → undefined (aggregation not meaningful)
 */
export function resolveAggregationDefault(
    semanticType: string,
): 'sum' | 'average' | undefined {
    const entry = getRegistryEntry(semanticType);
    switch (entry.aggRole) {
        case 'additive':        return 'sum';
        case 'signed-additive': return 'sum';
        case 'intensive':       return 'average';
        case 'dimension':       return undefined;
        case 'identifier':      return undefined;
        default:                return undefined;
    }
}

// =============================================================================
// §7  ZERO-BASELINE CLASSIFICATION
// =============================================================================

/**
 * Resolve zero-baseline class, enhanced with annotation domain.
 *
 * If annotation provides a domain starting above 0 (e.g., Rating [1, 5]),
 * zero is arbitrary regardless of what the base type says.
 */
export function resolveZeroClassFromAnnotation(
    semanticType: string,
    domain?: [number, number],
): ZeroClass | 'unknown' {
    // If domain starts above zero (e.g., Rating [1,5]), zero is arbitrary
    if (domain && domain[0] > 0) return 'arbitrary';

    // Delegate to existing classification
    return getZeroClass(semanticType);
}

// =============================================================================
// §8  SCALE TYPE
// =============================================================================

/**
 * Recommend a scale type based on semantic type and data distribution.
 *
 * Conservative policy — only triggers when ALL of these hold:
 *   1. The semantic type is in the ALLOW-list (Population, GDP, etc.)
 *   2. Data spans ≥ 4 orders of magnitude (10 000×)
 *   3. At least 10 data points
 *
 * This avoids surprising users on normal datasets while still helping
 * with genuinely wide-range data like city populations or GDP figures.
 */
export function resolveScaleType(
    semanticType: string,
    values: number[],
): 'linear' | 'log' | 'sqrt' | 'symlog' | undefined {
    // Only consider log for additive measures with open domains —
    // these are the types that can legitimately span many orders of magnitude.
    // (E.g., revenue, population, quantities across different scales.)
    // Exclude generic fallback types (Number, Unknown) — they just mean
    // "we know it's numeric but not what it measures", so applying
    // log/symlog would be presumptuous.
    const entry = getRegistryEntry(semanticType);
    const eligible = entry.aggRole === 'additive' && entry.domainShape === 'open'
        && entry.t1 !== 'GenericMeasure';
    if (!eligible) return undefined;

    if (values.length < 10) return undefined;

    const filtered = values.filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
    if (filtered.length < 10) return undefined;

    const min = Math.min(...filtered);
    const max = Math.max(...filtered);
    if (max <= 0 || min === max) return undefined;

    // Only all-positive data — don't auto-log mixed-sign
    if (min < 0) return undefined;

    // Require ≥ 6 orders of magnitude (1000 000×) — very conservative
    const positiveMin = Math.min(...filtered.filter(v => v > 0));
    if (positiveMin > 0 && max / positiveMin >= 1000000) {
        // If data contains zeros, log(0) = -∞ breaks the scale.
        // Use symlog (linear near zero, logarithmic for large values)
        // so zeros remain representable.
        const hasZeros = filtered.some(v => v === 0);
        return hasZeros ? 'symlog' : 'log';
    }

    return undefined;
}

// =============================================================================
// §9  DOMAIN CONSTRAINTS
// =============================================================================

/**
 * Merge an intrinsic (semantic) domain with the actual data range.
 *
 * For **hard** domains (Latitude, Correlation) the intrinsic bounds are
 * physically absolute — data cannot exceed them, so we clamp.
 *
 * For **soft** domains (Percentage, Score, Rating, annotation-supplied)
 * the intrinsic bounds describe the *typical* range but real data can
 * legitimately exceed them (e.g., 155 % growth).  The effective domain
 * is the union: min(intrinsic[0], dataMin) … max(intrinsic[1], dataMax).
 */
function mergeIntrinsicWithData(
    intrinsic: [number, number],
    values: any[],
    hard: boolean,
): DomainConstraint {
    if (hard) {
        return { min: intrinsic[0], max: intrinsic[1], clamp: true };
    }
    const nums = values.filter((v: any) => typeof v === 'number' && !isNaN(v));
    if (nums.length === 0) {
        return { min: intrinsic[0], max: intrinsic[1], clamp: false };
    }
    const dataMin = Math.min(...nums);
    const dataMax = Math.max(...nums);
    return {
        min: Math.min(intrinsic[0], dataMin),
        max: Math.max(intrinsic[1], dataMax),
        clamp: false,
    };
}

/**
 * Snap-to-bound heuristic for bounded types like Percentage / PercentageChange.
 *
 * Each bound is snapped independently:
 * - If data approaches the intrinsic lower bound → snap min
 * - If data approaches the intrinsic upper bound → snap max
 * - If data exceeds a bound → don't snap that side (let VL auto-extend)
 *
 * Threshold: 25% of the *effective side range*.
 *
 * We err on the side of snapping, because:
 * - Semantic types are opt-in — the bound carries meaning by definition.
 * - A wrong snap (extra white space) is less harmful than a wrong
 *   no-snap (viewer loses semantic reference, differences are
 *   exaggerated and proximity to the bound is hidden).
 * - Only when data is clearly in the interior (> 25% away from each
 *   bound) does the bound stop being a useful reference.
 *
 * When the intrinsic domain straddles zero (lo < 0 < hi), zero acts as a
 * visual baseline (bar charts, contextual zero).  Each bound's threshold
 * is computed relative to its distance from zero — not the full range —
 * so that snapping one side doesn't make values on the other side of zero
 * invisible (e.g., snapping to -100% when data has a tiny +0.2% bar).
 *
 * When the domain doesn't straddle zero (e.g., [0, 100]), the full range
 * is used as the reference.
 *
 * Examples for Percentage [0, 100] (threshold = 25, full range):
 *   20–45%   → snap min=0 only     (20 within 25 of 0; 45 far from 100)
 *   35–65%   → no snap             (both far from edges, in interior)
 *   55–82%   → snap max=100 only   (82 within 25 of 100; 55 far from 0)
 *   15–80%   → snap both [0, 100]  (15 near 0, 80 near 100)
 *   30–130%  → no snap             (130 exceeds 100 → no snap; 30 far from 0)
 *
 * Examples for PercentageChange [-1, 1] (threshold = 0.25 per side):
 *   -0.03 to +0.05 → no snap       (both far from ±0.75)
 *   -0.70 to +0.30 → no snap       (-0.70 > -0.75, not close enough)
 *   -0.80 to +0.30 → snap min=-1   (-0.80 ≤ -0.75; +0.30 < 0.75)
 *   -0.80 to +0.78 → snap both     (both within 0.25 of edges)
 */
export function snapToBoundHeuristic(
    intrinsic: [number, number],
    values: any[],
): DomainConstraint | undefined {
    const nums = values.filter((v: any) => typeof v === 'number' && !isNaN(v));
    if (nums.length === 0) return undefined;

    const [lo, hi] = intrinsic;
    const range = hi - lo;
    if (range <= 0) return undefined;

    const dataMin = Math.min(...nums);
    const dataMax = Math.max(...nums);

    // When the domain straddles zero, compute each side's threshold relative
    // to its distance from zero.  This prevents snapping one side from
    // stretching the axis so wide that values near zero on the other side
    // become invisible (sub-pixel bars).
    const zeroInside = lo < 0 && hi > 0;
    const thresholdLo = 0.25 * (zeroInside ? (0 - lo) : range);
    const thresholdHi = 0.25 * (zeroInside ? hi       : range);

    let snapMin: number | undefined;
    let snapMax: number | undefined;

    // Snap lower bound: data min is close to intrinsic lower bound
    // AND data doesn't go below it (if it does, VL auto-extends)
    if (dataMin >= lo && dataMin <= lo + thresholdLo) {
        snapMin = lo;
    }

    // Snap upper bound: data max is close to intrinsic upper bound
    // AND data doesn't exceed it
    if (dataMax <= hi && dataMax >= hi - thresholdHi) {
        snapMax = hi;
    }

    if (snapMin === undefined && snapMax === undefined) return undefined;

    return { min: snapMin, max: snapMax, clamp: false };
}

/**
 * Resolve domain constraints from annotation, type-intrinsic rules, or data.
 *
 * Only truly fixed physical domains (Latitude, Longitude, Correlation)
 * use hard clamping. Bounded types like Percentage use a snap-to-bound
 * heuristic: the axis extends to the theoretical endpoint (e.g., 100%)
 * only when data is close to it, avoiding wasted space when data is
 * concentrated in a small region.
 *
 * Priority: annotation.intrinsicDomain > type-intrinsic > data-inferred
 */
export function resolveDomainConstraint(
    semanticType: string,
    annotation: SemanticAnnotation,
    values: any[],
): DomainConstraint | undefined {
    const entry = getRegistryEntry(semanticType);

    // 1. Explicit annotation intrinsicDomain
    if (annotation.intrinsicDomain) {
        // Proportion (Percentage) and SignedMeasure (PercentageChange, Profit):
        // use snap-to-bound heuristic on both ends independently.
        // Don't force the full theoretical range — only snap to a bound
        // when data approaches it (e.g., 97% → snap to 100%, -0.95 → snap to -1).
        if (entry.t1 === 'Proportion' || entry.t1 === 'SignedMeasure') {
            return snapToBoundHeuristic(annotation.intrinsicDomain, values);
        }
        // All other types: soft merge (union of intrinsic + data)
        return mergeIntrinsicWithData(annotation.intrinsicDomain, values, false);
    }

    // 2. Type-intrinsic hard domains (physically impossible to exceed)
    if (semanticType === 'Latitude')    return mergeIntrinsicWithData([-90, 90], values, true);
    if (semanticType === 'Longitude')   return mergeIntrinsicWithData([-180, 180], values, true);
    if (semanticType === 'Correlation') return mergeIntrinsicWithData([-1, 1], values, true);

    // 3. Percentage without explicit annotation — detect scale and apply snap
    if (semanticType === 'Percentage') {
        const nums = values.filter((v: any) => typeof v === 'number' && !isNaN(v));
        if (nums.length > 0) {
            const rep = detectPercentageRepresentation(nums);
            const M = rep === '0-1' ? 1 : 100;
            return snapToBoundHeuristic([0, M], values);
        }
    }

    return undefined;
}

// =============================================================================
// §10  TICK CONSTRAINTS
// =============================================================================

/**
 * Resolve tick constraints based on semantic type and domain.
 *
 * For bounded integer domains (e.g., Rating [1, 5]), generates exact ticks.
 * For integer types (Count, Rank, Year), enforces integer-only ticks.
 */
export function resolveTickConstraint(
    semanticType: string,
    domain?: [number, number],
): TickConstraint | undefined {
    const entry = getRegistryEntry(semanticType);

    if (entry.formatClass === 'integer') {
        const tc: TickConstraint = { integersOnly: true, minStep: 1 };
        // If domain provided and span is small, generate exact ticks
        if (domain) {
            const span = domain[1] - domain[0];
            if (span <= 20 && span > 0) {
                tc.exactTicks = [];
                for (let i = domain[0]; i <= domain[1]; i++) {
                    tc.exactTicks.push(i);
                }
            }
        }
        return tc;
    }

    // Score with bounded domain → integer ticks
    if (semanticType === 'Score' && domain) {
        const span = domain[1] - domain[0];
        const tc: TickConstraint = { integersOnly: true, minStep: 1 };
        if (span <= 20 && span > 0) {
            tc.exactTicks = [];
            for (let i = domain[0]; i <= domain[1]; i++) {
                tc.exactTicks.push(i);
            }
        }
        return tc;
    }

    return undefined;
}

// =============================================================================
// §11  CANONICAL ORDERING & CYCLIC
// =============================================================================

/**
 * Resolve the canonical sort order for a field.
 *
 * Priority: annotation.sortOrder > well-known type sequence > auto-detect from data
 */
export function resolveCanonicalOrder(
    semanticType: string,
    annotation: SemanticAnnotation,
    values: any[],
): string[] | undefined {
    // 1. Explicit annotation sortOrder
    if (annotation.sortOrder && annotation.sortOrder.length > 0) {
        return annotation.sortOrder;
    }

    // 2. Delegate to existing well-known sequence detection
    return inferOrdinalSortOrder(semanticType, values);
}

/**
 * Determine whether a field's values form a cyclic (wrap-around) sequence.
 *
 * Derived purely from semantic type — NOT an LLM annotation.
 * Types with domainShape='cyclic' in the registry are cyclic.
 */
export function resolveCyclic(semanticType: string): boolean {
    const entry = getRegistryEntry(semanticType);
    return entry.domainShape === 'cyclic';
}

// =============================================================================
// §12  REVERSED AXIS
// =============================================================================

/**
 * Whether the axis should be reversed for this field.
 *
 * Rank is the primary case: 1st place should appear at the top of the
 * y-axis.  On the x-axis, rank 1 should stay on the left (no reversal).
 */
export function resolveReversed(semanticType: string, channel?: string): boolean {
    if (semanticType === 'Rank') {
        // Only reverse on the y-axis (rank 1 at top).
        // On x-axis, natural left-to-right order is correct.
        return channel !== 'x';
    }
    return false;
}

// =============================================================================
// §13  NICE (domain rounding)
// =============================================================================

/**
 * Whether to apply "nice" rounding to scale domain endpoints.
 *
 * Nice is false when:
 * - There's a fixed domain constraint (Rating [1, 5] → axis should show exactly 1–5)
 * - The type has a fixed domain shape (Latitude, Correlation)
 */
export function resolveNice(
    semanticType: string,
    domainConstraint?: DomainConstraint,
): boolean {
    if (domainConstraint?.clamp) return false;
    if (domainConstraint && domainConstraint.min !== undefined && domainConstraint.max !== undefined) {
        return false;
    }
    const entry = getRegistryEntry(semanticType);
    if (entry.domainShape === 'fixed') return false;
    return true;
}

// =============================================================================
// §14  DIVERGING & COLOR SCHEME HINT
// =============================================================================

/**
 * Resolve diverging midpoint information for a field.
 *
 * Priority chain:
 *   1. annotation.unit → type lookup (°C → 0, °F → 32)
 *   2. type-intrinsic midpoint (Sentiment → 0, Correlation → 0)
 *   3. annotation.intrinsicDomain midpoint (Rating [1,5] → 3)
 *   4. data-driven: data spans 0 → midpoint 0
 *
 * Returns undefined if no diverging treatment applies.
 */
export function resolveDivergingInfo(
    semanticType: string,
    annotation: SemanticAnnotation,
    values: number[],
): DivergingInfo | undefined {
    const entry = getRegistryEntry(semanticType);
    // Types with diverging='none' don't get diverging treatment

    // 1. Unit-derived (Temperature)
    if (semanticType === 'Temperature' && annotation.unit) {
        const unitMidpoints: Record<string, number> = {
            '°C': 0, '°F': 32, 'K': 273.15, C: 0, F: 32,
        };
        const mid = unitMidpoints[annotation.unit];
        if (mid !== undefined) {
            return { midpoint: mid, inherent: false, source: 'unit' };
        }
    }

    // 3. Type-intrinsic
    if (entry.diverging === 'inherent') {
        return { midpoint: 0, inherent: true, source: 'type-intrinsic' };
    }
    if (entry.diverging === 'conditional') {
        return { midpoint: 0, inherent: false, source: 'type-intrinsic' };
    }

    // 3. Domain-derived midpoint (e.g., Rating [1,5] → 3)
    if (annotation.intrinsicDomain) {
        return {
            midpoint: (annotation.intrinsicDomain[0] + annotation.intrinsicDomain[1]) / 2,
            inherent: false,
            source: 'domain',
        };
    }

    // 4. Data-driven: if data spans 0, use 0 as midpoint
    if (values.length > 0) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (min < 0 && max > 0) {
            return { midpoint: 0, inherent: false, source: 'data' };
        }
    }

    return undefined;
}

/**
 * Resolve color scheme hint based on semantic type, diverging analysis,
 * and data values.
 */
export function resolveColorSchemeHint(
    semanticType: string,
    annotation: SemanticAnnotation,
    values: any[],
): ColorSchemeHint {
    const entry = getRegistryEntry(semanticType);
    const nums = values.filter((v: any) => typeof v === 'number' && !isNaN(v));

    // Try diverging analysis
    const divInfo = resolveDivergingInfo(semanticType, annotation, nums);
    if (divInfo) {
        const min = nums.length > 0 ? Math.min(...nums) : 0;
        const max = nums.length > 0 ? Math.max(...nums) : 0;
        const spansBothSides = min < divInfo.midpoint && max > divInfo.midpoint;

        if (divInfo.inherent || spansBothSides) {
            return {
                type: 'diverging',
                divergingMidpoint: divInfo.midpoint,
                inherentlyDiverging: divInfo.inherent,
            };
        }
    }

    // Sequential for quantitative, categorical for nominal/ordinal
    if (entry.visEncodings.includes('quantitative')) {
        return { type: 'sequential' };
    }
    return { type: 'categorical' };
}

// =============================================================================
// §15  BINNING SUITABILITY
// =============================================================================

/**
 * Whether this field benefits from histogram-style binning.
 *
 * False for small bounded domains (Rating 1–5), non-numeric types,
 * and identifiers.
 */
export function resolveBinningSuggested(
    semanticType: string,
    domain?: [number, number],
): boolean {
    const entry = getRegistryEntry(semanticType);

    // Non-quantitative types don't get binned
    if (!entry.visEncodings.includes('quantitative')) return false;

    // Identifiers/dimensions don't get binned
    if (entry.aggRole === 'identifier' || entry.aggRole === 'dimension') return false;

    // Year should use temporal axis, not bins
    if (semanticType === 'Year' || semanticType === 'Decade') return false;

    // Small bounded domains have too few values to bin
    if (domain && (domain[1] - domain[0]) <= 20) return false;

    // Score with known small range
    if (semanticType === 'Score' && !domain) return false;

    return true;
}

// =============================================================================
// §17  STACKING COMPATIBILITY
// =============================================================================

/**
 * Whether values of this type can be stacked in a bar/area chart, and how.
 *
 * - 'sum':       Additive measures (parts sum to whole)
 * - 'normalize': Proportions (show 100% breakdown)
 * - false:       Stacking is meaningless (rates, scores, identifiers)
 */
export function resolveStackable(
    semanticType: string,
): 'sum' | 'normalize' | false {
    const entry = getRegistryEntry(semanticType);

    switch (entry.aggRole) {
        case 'additive':        return 'sum';
        case 'signed-additive': return 'sum';
        case 'intensive':
            // Percentage is the exception — normalizable
            if (semanticType === 'Percentage') return 'normalize';
            return false;
        case 'dimension':       return false;
        case 'identifier':      return false;
        default:                return false;
    }
}

// =============================================================================
// §18  SORT DIRECTION
// =============================================================================

/**
 * Default sort direction for this field when used on an axis.
 */
export function resolveSortDirection(
    semanticType: string,
): 'ascending' | 'descending' {
    // Rank: show best first
    if (semanticType === 'Rank') return 'descending';
    return 'ascending';
}

// =============================================================================
// §19  BUILDER: resolveFieldSemantics()
// =============================================================================

/**
 * Resolve field semantics from annotation + data.
 *
 * This is the sole entry point for data-identity decisions. It resolves
 * the one-to-many ambiguities in the type registry by inspecting the
 * concrete data representation.
 *
 * Visualization-specific decisions (color scheme, axis reversal,
 * interpolation, tick strategy, nice rounding, stacking) are NOT
 * computed here — those belong in `resolveChannelSemantics()`.
 *
 * @param input       The semantic type annotation (string or enriched object)
 * @param fieldName   Column name (used for unit detection heuristics)
 * @param values      Sampled data values from this field
 * @returns           Resolved field semantics
 */
export function resolveFieldSemantics(
    input: string | SemanticAnnotation | undefined,
    fieldName: string,
    values: any[],
): FieldSemantics {
    // 1. Normalize annotation
    const annotation = normalizeAnnotation(input);
    const semanticType = annotation.semanticType;

    // 2. Numeric values (filtered once, reused across resolvers)
    const numericValues = values
        .filter((v: any) => typeof v === 'number' && !isNaN(v) && isFinite(v));

    // 3. Resolve field-intrinsic properties
    const defaultVisType = resolveDefaultVisType(semanticType, values);
    const { format, tooltipFormat } = resolveFormat(semanticType, annotation, values);
    let aggregationDefault = resolveAggregationDefault(semanticType);
    let zeroClass = resolveZeroClassFromAnnotation(semanticType, annotation.intrinsicDomain);
    const scaleType = resolveScaleType(semanticType, numericValues);
    const domainConstraint = resolveDomainConstraint(semanticType, annotation, values);
    const canonicalOrder = resolveCanonicalOrder(semanticType, annotation, values);
    const cyclic = resolveCyclic(semanticType);
    let binningSuggested = resolveBinningSuggested(semanticType, annotation.intrinsicDomain);
    const sortDirection = resolveSortDirection(semanticType);

    // 4. For unregistered types, provide data-driven fallbacks.
    //    The registry treats unknown types as categorical, but if the data
    //    is actually numeric, we should behave like a generic measure.
    if (!isRegistered(semanticType) && defaultVisType === 'quantitative') {
        // Data looks numeric → treat like Number (GenericMeasure)
        if (!aggregationDefault) aggregationDefault = 'sum';
        if (zeroClass === 'unknown') zeroClass = 'meaningful';
        binningSuggested = true;
    }

    return {
        semanticAnnotation: annotation,
        defaultVisType,
        format,
        tooltipFormat,
        aggregationDefault,
        zeroClass,
        scaleType: scaleType ?? undefined,
        domainConstraint,
        canonicalOrder,
        cyclic,
        sortDirection,
        binningSuggested,
    };
}
