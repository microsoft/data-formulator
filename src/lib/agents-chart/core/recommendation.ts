// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * CHART RECOMMENDATION & ADAPTATION ENGINE
 * =============================================================================
 *
 * Backend-agnostic logic for two chart operations:
 *
 *   1. **Adaptation** — remapping encoding channels when switching chart types
 *      (e.g. Bar→Pie: x→color, y→size because the semantic roles differ).
 *
 *   2. **Recommendation** — suggesting which data fields best fit each
 *      encoding channel for a given chart type, using semantic types,
 *      cardinality constraints, and data-fitness tests.
 *
 * Both functions operate on plain field names (string→string maps) with no
 * UI-layer dependencies.  Backend-specific wrappers (vegalite/recommendation.ts
 * etc.) filter results to channels that actually exist in that backend's
 * template registry.
 *
 * =============================================================================
 */

import {
    inferVisCategory,
    getVisCategory,
    isMeasureType,
    isTimeSeriesType,
    isCategoricalType,
    isOrdinalType,
    isGeoType,
    isGeoCoordinateType,
    isNonMeasureNumeric,
} from './semantic-types';

// ============================================================================
// 1. Semantic Role System (used by adaptation)
// ============================================================================

/**
 * Semantic role of a channel within a specific chart type.
 */
export type SemanticRole =
    | 'category'
    | 'measure'
    | 'measure2'
    | 'series'
    | 'facetCol'
    | 'facetRow'
    | 'auxiliary'
    | 'geo'
    | 'price';

type ChannelRoleMap = Partial<Record<string, SemanticRole>>;

// ── Chart Families ──────────────────────────────────────────────────────

/** Standard x/y charts: x=category, y=measure, color=series */
const FAMILY_XY_STANDARD: ChannelRoleMap = {
    x: 'category', y: 'measure', color: 'series',
    opacity: 'auxiliary', size: 'auxiliary', shape: 'auxiliary',
    detail: 'auxiliary', group: 'series',
    column: 'facetCol', row: 'facetRow',
};

/** Pie-like charts: color=category, size=measure */
const FAMILY_PIE: ChannelRoleMap = {
    color: 'category', size: 'measure',
    column: 'facetCol', row: 'facetRow',
};

/** Rose chart: polar radial bar — x=category, y=measure, color=series */
const FAMILY_ROSE: ChannelRoleMap = {
    x: 'category', y: 'measure', color: 'series',
    column: 'facetCol', row: 'facetRow',
};

/** Radar chart */
const FAMILY_RADAR: ChannelRoleMap = {
    x: 'category', y: 'measure', color: 'series',
    column: 'facetCol', row: 'facetRow',
};

/** Map charts: latitude/longitude = geo */
const FAMILY_MAP: ChannelRoleMap = {
    latitude: 'geo', longitude: 'geo',
    color: 'series', size: 'auxiliary', opacity: 'auxiliary',
};

/** Candlestick: x=category, open/high/low/close=price */
const FAMILY_CANDLESTICK: ChannelRoleMap = {
    x: 'category',
    open: 'price', high: 'price', low: 'price', close: 'price',
    column: 'facetCol', row: 'facetRow',
};

/** Histogram: x=measure (binned) */
const FAMILY_HISTOGRAM: ChannelRoleMap = {
    x: 'measure', color: 'series',
    column: 'facetCol', row: 'facetRow',
};

/** Density */
const FAMILY_DENSITY: ChannelRoleMap = {
    x: 'measure', color: 'series',
    column: 'facetCol', row: 'facetRow',
};

/** Heatmap: x=category, y=category, color=measure */
const FAMILY_HEATMAP: ChannelRoleMap = {
    x: 'category', y: 'category', color: 'measure',
    column: 'facetCol', row: 'facetRow',
};

/** Gauge: size=measure */
const FAMILY_GAUGE: ChannelRoleMap = {
    size: 'measure', column: 'facetCol',
};

/** Funnel: y=category, size=measure */
const FAMILY_FUNNEL: ChannelRoleMap = {
    y: 'category', size: 'measure',
};

/** Treemap / Sunburst */
const FAMILY_TREEMAP: ChannelRoleMap = {
    color: 'category', size: 'measure', detail: 'auxiliary',
};

/** Sankey */
const FAMILY_SANKEY: ChannelRoleMap = {
    x: 'category', y: 'category', size: 'measure',
};

/** Range charts with x2/y2 */
const FAMILY_RANGE: ChannelRoleMap = {
    x: 'category', y: 'measure', x2: 'measure2', y2: 'measure2',
    color: 'series', opacity: 'auxiliary',
    column: 'facetCol', row: 'facetRow',
};

// ── Chart → Family lookup ───────────────────────────────────────────────

const CHART_ROLE_MAP: Record<string, ChannelRoleMap> = {
    // Axis-based (x/y standard)
    'Bar Chart': FAMILY_XY_STANDARD,
    'Pyramid Chart': FAMILY_XY_STANDARD,
    'Grouped Bar Chart': FAMILY_XY_STANDARD,
    'Stacked Bar Chart': FAMILY_XY_STANDARD,
    'Lollipop Chart': FAMILY_XY_STANDARD,
    'Waterfall Chart': FAMILY_XY_STANDARD,
    'Line Chart': FAMILY_XY_STANDARD,
    'Dotted Line Chart': FAMILY_XY_STANDARD,
    'Bump Chart': FAMILY_XY_STANDARD,
    'Area Chart': FAMILY_XY_STANDARD,
    'Streamgraph': FAMILY_XY_STANDARD,
    'Scatter Plot': FAMILY_XY_STANDARD,
    'Linear Regression': FAMILY_XY_STANDARD,
    'Ranged Dot Plot': FAMILY_XY_STANDARD,
    'Boxplot': FAMILY_XY_STANDARD,
    'Strip Plot': FAMILY_XY_STANDARD,
    // Custom marks
    'Custom Point': FAMILY_XY_STANDARD,
    'Custom Line': FAMILY_XY_STANDARD,
    'Custom Bar': FAMILY_XY_STANDARD,
    'Custom Rect': FAMILY_RANGE,
    'Custom Area': FAMILY_RANGE,
    // Pie-like
    'Pie Chart': FAMILY_PIE,
    // Polar
    'Rose Chart': FAMILY_ROSE,
    'Radar Chart': FAMILY_RADAR,
    // Heatmap
    'Heatmap': FAMILY_HEATMAP,
    // Histogram / Density
    'Histogram': FAMILY_HISTOGRAM,
    'Density Plot': FAMILY_DENSITY,
    // Geographic
    'US Map': FAMILY_MAP,
    'World Map': FAMILY_MAP,
    // Financial
    'Candlestick Chart': FAMILY_CANDLESTICK,
    // ECharts-only
    'Gauge Chart': FAMILY_GAUGE,
    'Funnel Chart': FAMILY_FUNNEL,
    'Treemap': FAMILY_TREEMAP,
    'Sunburst Chart': FAMILY_TREEMAP,
    'Sankey Diagram': FAMILY_SANKEY,
};

// ── Role helpers ────────────────────────────────────────────────────────

function getChannelRole(chartType: string, channel: string): SemanticRole {
    const roleMap = CHART_ROLE_MAP[chartType];
    if (roleMap && channel in roleMap) return roleMap[channel]!;
    if (channel === 'column') return 'facetCol';
    if (channel === 'row') return 'facetRow';
    return 'auxiliary';
}

function findChannelsByRole(chartType: string, templateChannels: string[], role: SemanticRole): string[] {
    return templateChannels.filter(ch => getChannelRole(chartType, ch) === role);
}

/** Fallback chain when target has no channel with the exact source role. */
const FALLBACK_CHAIN: Partial<Record<SemanticRole, SemanticRole[]>> = {
    measure2: ['measure', 'auxiliary'],
    series: ['auxiliary'],
    category: ['series', 'auxiliary'],
    measure: ['auxiliary'],
    geo: ['category'],
    price: ['measure', 'auxiliary'],
};

const ROLE_PRIORITY: Record<SemanticRole, number> = {
    category: 0, measure: 1, series: 2, facetCol: 3, facetRow: 4,
    measure2: 5, auxiliary: 6, geo: 7, price: 8,
};

// ============================================================================
// 2. Adaptation — adapt channel encodings across chart types
// ============================================================================

/**
 * Adapt encoding channels from one chart type to another.
 *
 * When `data` is provided, uses **recommendation-based adaptation**: re-runs
 * the recommendation engine with a strong preference for the currently-assigned
 * fields, letting the target chart's field-type preferences take effect
 * (e.g. Line Chart prefers temporal on x).  Remaining empty channels are
 * optionally filled from all available fields.
 *
 * When no data is provided, falls back to **structural role-based** adaptation
 * (pure channel remapping by semantic role).
 *
 * @param sourceType      The current chart type name (e.g. "Bar Chart")
 * @param targetType      The target chart type name (e.g. "Pie Chart")
 * @param targetChannels  Available channels on the target template
 * @param encodings       Current channel→fieldName map (only filled channels)
 * @param data            (optional) Array of data row objects
 * @param semanticTypes   (optional) Field→semantic-type map
 * @returns               New channel→fieldName map for the target
 */
export function adaptChannels(
    sourceType: string,
    targetType: string,
    targetChannels: string[],
    encodings: Record<string, string>,
    data?: any[],
    semanticTypes?: Record<string, string>,
    recommendFn?: RecommendFn,
): Record<string, string> {
    // Recommendation-based adaptation when data is available
    if (data && data.length > 0) {
        return adaptViaRecommendation(targetType, targetChannels, encodings, data, semanticTypes ?? {}, recommendFn ?? getRecommendation);
    }

    // Fallback: structural role-based adaptation
    return adaptViaRoles(sourceType, targetType, targetChannels, encodings);
}

/**
 * Recommendation-based adaptation: run the target chart type's recommendation
 * engine with existing fields marked as "preferred".  The recommendation logic
 * applies its normal type-matching (quantitative, categorical, temporal, etc.)
 * but, when multiple candidates match, prefers fields that were already in use.
 * Preferred fields also bypass heuristic filters like isLikelyIdentifierOrRank
 * since the user intentionally assigned them.
 *
 * Step 1 — Run recommendation with ALL fields present but existing fields
 *          marked as preferred.  This lets the engine reshuffle fields into
 *          their best-fitting channels for the target type while preferring
 *          the user's current selections.
 * Step 2 — Fill any remaining empty channels from ALL available fields
 *          (without preference bias) so the chart is as complete as possible.
 */
function adaptViaRecommendation(
    targetType: string,
    targetChannels: string[],
    encodings: Record<string, string>,
    data: any[],
    semanticTypes: Record<string, string>,
    recommendFn: RecommendFn,
): Record<string, string> {
    const existingFields = new Set(Object.values(encodings).filter(Boolean));
    const result: Record<string, string> = {};
    const usedFields = new Set<string>();

    // Step 0: Preserve facet channels (column, row) from existing encodings.
    // Then filter data to a single facet group so downstream checks like
    // isValidLineSeriesData see the data as it would appear within one facet.
    const FACET_CHANNELS = ['column', 'row'];
    let facetedData = data;
    for (const ch of FACET_CHANNELS) {
        const field = encodings[ch];
        if (field && targetChannels.includes(ch)) {
            result[ch] = field;
            usedFields.add(field);
            // Filter data to the first facet group value
            if (facetedData.length > 0) {
                const firstVal = facetedData[0][field];
                facetedData = facetedData.filter(row => row[field] === firstVal);
            }
        }
    }

    // Step 1: recommend with existing fields as preferred, using facet-filtered data
    const tv = buildTableView(facetedData, semanticTypes);
    tv.preferredFields = existingFields;
    const recommended = recommendFn(targetType, tv);

    for (const [ch, field] of Object.entries(recommended)) {
        if (targetChannels.includes(ch) && !usedFields.has(field) && !(ch in result)) {
            result[ch] = field;
            usedFields.add(field);
        }
    }

    // Step 2: fill remaining empty channels from ALL fields (no preference)
    const emptyChannels = targetChannels.filter(ch => !(ch in result));
    if (emptyChannels.length > 0) {
        const fullRec = recommendFn(
            targetType,
            buildTableView(facetedData, semanticTypes),   // no preferredFields
        );
        for (const ch of emptyChannels) {
            if (fullRec[ch] && !usedFields.has(fullRec[ch])) {
                result[ch] = fullRec[ch];
                usedFields.add(fullRec[ch]);
            }
        }
    }

    return result;
}

/**
 * Structural role-based adaptation: remap channels by semantic role when no
 * data is available.  Each field keeps its role (category, measure, series…)
 * and is placed into the target channel that has the same role.
 */
function adaptViaRoles(
    sourceType: string,
    targetType: string,
    targetChannels: string[],
    encodings: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {};

    // Collect filled encodings with their semantic roles
    const filledEncodings: { channel: string; role: SemanticRole; field: string }[] = [];
    for (const [ch, field] of Object.entries(encodings)) {
        if (field) {
            filledEncodings.push({ channel: ch, role: getChannelRole(sourceType, ch), field });
        }
    }

    // Sort by priority: category > measure > series > …
    filledEncodings.sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]);

    const assigned = new Set<string>();

    for (const { channel: srcCh, role: srcRole, field } of filledEncodings) {
        let placed = false;

        // (a) Direct match: same channel name with same role
        if (targetChannels.includes(srcCh) && !assigned.has(srcCh)) {
            if (getChannelRole(targetType, srcCh) === srcRole) {
                result[srcCh] = field;
                assigned.add(srcCh);
                placed = true;
            }
        }

        if (!placed) {
            // (b) Role match: find empty target channel with same role
            placed = tryAssign(srcRole, field, targetType, targetChannels, result, assigned, srcCh);
        }

        if (!placed) {
            // (c) Fallback chain
            const chain = FALLBACK_CHAIN[srcRole];
            if (chain) {
                for (const fallbackRole of chain) {
                    placed = tryAssign(fallbackRole, field, targetType, targetChannels, result, assigned, srcCh);
                    if (placed) break;
                }
            }
        }
        // (d) If not placed, encoding is dropped
    }

    return result;
}

function tryAssign(
    role: SemanticRole,
    field: string,
    targetType: string,
    targetChannels: string[],
    result: Record<string, string>,
    assigned: Set<string>,
    preferredName?: string,
): boolean {
    const candidates = findChannelsByRole(targetType, targetChannels, role)
        .filter(ch => !assigned.has(ch));
    if (candidates.length === 0) return false;
    const best = preferredName && candidates.includes(preferredName)
        ? preferredName : candidates[0];
    result[best] = field;
    assigned.add(best);
    return true;
}

// ============================================================================
// 3. Internal Table View — field classification from data + semantic types
// ============================================================================

export interface InternalTableView {
    names: string[];
    fieldType: Record<string, string>;
    fieldSemanticType: Record<string, string>;
    fieldLevels: Record<string, any[]>;
    rows: any[];
    /** Fields the user has already assigned — preferred during pick(). */
    preferredFields?: Set<string>;
}

/**
 * Recommendation function signature — used to inject backend-specific
 * chart type handlers into adaptViaRecommendation.
 */
export type RecommendFn = (chartType: string, tv: InternalTableView) => Record<string, string>;

export function buildTableView(data: any[], semanticTypes: Record<string, string>): InternalTableView {
    const names = data.length > 0 ? Object.keys(data[0]) : [];
    const fieldType: Record<string, string> = {};
    const fieldSemanticType: Record<string, string> = {};
    const fieldLevels: Record<string, any[]> = {};

    for (const name of names) {
        const values = data.map(r => r[name]);
        const semanticType = semanticTypes[name] || '';
        fieldType[name] = (semanticType && getVisCategory(semanticType)) || inferVisCategory(values);
        fieldSemanticType[name] = semanticType;
        fieldLevels[name] = [...new Set(data.map(r => r[name]).filter(v => v != null))];
    }

    return { names, fieldType, fieldSemanticType, fieldLevels, rows: data };
}

// ============================================================================
// 4. Preference-Based Assignment Solver
// ============================================================================

/** Preference tiers for a (channel, field) pair. */
export const Pref = { STRONG: 3, OK: 2, WEAK: 1, EXCLUDE: -Infinity } as const;
export type PrefScore = number;

/**
 * A scoring function that returns a preference score for a field being
 * assigned to a particular channel.  Return Pref.EXCLUDE to forbid the
 * assignment.
 */
export type ChannelPrefFn = (
    name: string, type: string, semanticType: string,
    cardinality: number, hasLevels: boolean,
) => PrefScore;

/**
 * Solve the assignment problem: given N channels each with a preference
 * scoring function, and a set of candidate fields, find the assignment of
 * distinct fields to channels that maximises total score.
 *
 * Returns the best assignment as a Record<channel, fieldName>, or {} if
 * no valid (all-channels-filled) assignment exists.
 *
 * Complexity: O(C! · F^C) where C = number of channels, F = number of
 * fields.  Fine for C ≤ 5 and typical field counts.
 */
export function resolveAssignment(
    tv: InternalTableView,
    used: Set<string>,
    channelPrefs: { channel: string; pref: ChannelPrefFn }[],
): Record<string, string> {
    // Build the score matrix: scores[channelIdx][fieldIdx]
    const candidates: string[] = tv.names.filter(n => !used.has(n) && (!isLikelyIdentifierOrRank(n) || tv.preferredFields?.has(n)));
    const C = channelPrefs.length;
    const F = candidates.length;
    if (F < C) return {};

    // Pre-compute all scores
    const scores: number[][] = [];
    for (let ci = 0; ci < C; ci++) {
        scores[ci] = [];
        for (let fi = 0; fi < F; fi++) {
            const name = candidates[fi];
            const type = tv.fieldType[name] ?? 'nominal';
            const st = tv.fieldSemanticType[name] ?? '';
            const card = tv.fieldLevels[name]?.length ?? 0;
            scores[ci][fi] = channelPrefs[ci].pref(name, type, st, card, card > 0);
        }
    }

    // Brute-force search over all C-permutations of F fields
    let bestScore = -Infinity;
    let bestAssign: number[] | undefined;

    const perm = new Array<number>(C);
    const usedF = new Uint8Array(F);

    function search(depth: number, totalScore: number) {
        if (depth === C) {
            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestAssign = [...perm];
            }
            return;
        }
        for (let fi = 0; fi < F; fi++) {
            if (usedF[fi]) continue;
            const s = scores[depth][fi];
            if (s === -Infinity) continue;            // excluded
            if (totalScore + s <= bestScore - (C - depth - 1) * Pref.STRONG) continue; // prune
            perm[depth] = fi;
            usedF[fi] = 1;
            search(depth + 1, totalScore + s);
            usedF[fi] = 0;
        }
    }

    search(0, 0);

    if (!bestAssign) return {};

    const result: Record<string, string> = {};
    for (let ci = 0; ci < C; ci++) {
        const fieldName = candidates[bestAssign[ci]];
        result[channelPrefs[ci].channel] = fieldName;
        used.add(fieldName);
    }
    return result;
}

// ============================================================================
// 5. Field Classification Utilities (renumbered)
// ============================================================================

function isTemporalField(type: string, semanticType: string): boolean {
    return type === 'temporal' || isTimeSeriesType(semanticType);
}

function isQuantitativeField(type: string, semanticType: string): boolean {
    if (isTemporalField(type, semanticType)) return false;
    if (type !== 'quantitative') return false;
    if (isNonMeasureNumeric(semanticType)) return false;
    return isMeasureType(semanticType) || semanticType === '';
}

function isOrdinalField(type: string, semanticType: string, hasLevels: boolean): boolean {
    if (hasLevels) return true;
    return isOrdinalType(semanticType);
}

function isCategoricalFieldCheck(type: string, semanticType: string): boolean {
    if (isTemporalField(type, semanticType)) return false;
    if (isQuantitativeField(type, semanticType)) return false;
    return type === 'nominal' || isCategoricalType(semanticType);
}

function isDiscreteLike(type: string, semanticType: string, cardinality: number, maxCard = 50): boolean {
    if (isCategoricalFieldCheck(type, semanticType)) return true;
    if (isTemporalField(type, semanticType)) return true;
    if (isOrdinalType(semanticType)) return true;
    if (type === 'quantitative' && cardinality > 0 && cardinality <= maxCard) return true;
    return false;
}

export function nameMatches(name: string, patterns: string[]): boolean {
    const lower = name.toLowerCase();
    return patterns.some(p => lower === p) || patterns.some(p => lower.includes(p));
}

function isLikelyIdentifierOrRank(name: string): boolean {
    const lower = name.toLowerCase();
    const idPatterns = ['rank', 'id', 'index', 'idx', 'row', 'order', 'position', 'pos'];
    return idPatterns.some(p => lower === p || lower.endsWith('_' + p) || lower.endsWith(p));
}

// ============================================================================
// 6. Field Picker Utilities
// ============================================================================

export function pick(
    tv: InternalTableView,
    used: Set<string>,
    predicate: (name: string, type: string, semanticType: string, cardinality: number, hasLevels: boolean) => boolean,
): string | undefined {
    const candidates: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        const cardinality = tv.fieldLevels[name]?.length ?? 0;
        const hasLevels = cardinality > 0;
        if (predicate(name, type, semanticType, cardinality, hasLevels)) {
            candidates.push(name);
        }
    }
    if (candidates.length === 0) return undefined;
    // Prefer fields from the user's existing encodings when available
    if (tv.preferredFields) {
        const preferred = candidates.filter(n => tv.preferredFields!.has(n));
        if (preferred.length > 0) {
            const chosen = preferred[Math.floor(Math.random() * preferred.length)];
            used.add(chosen);
            return chosen;
        }
    }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

export const pickQuantitative = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (name, ty, st) => isQuantitativeField(ty, st) && (!isLikelyIdentifierOrRank(name) || !!tv.preferredFields?.has(name)));

export const pickTemporal = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, ty, st) => isTemporalField(ty, st));

export const pickNominal = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, ty, st) => isCategoricalFieldCheck(ty, st));

export const pickLowCardNominal = (tv: InternalTableView, u: Set<string>, maxCard = 30) =>
    pick(tv, u, (_n, ty, st, card) => isCategoricalFieldCheck(ty, st) && card > 0 && card <= maxCard);

export const pickOrdinal = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, ty, st, _card, hasLevels) => isOrdinalField(ty, st, hasLevels));

export const pickGeo = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, _ty, st) => isGeoType(st));

export const pickDiscrete = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (name, ty, st, card) => isDiscreteLike(ty, st, card) && (!isLikelyIdentifierOrRank(name) || !!tv.preferredFields?.has(name)));

export const pickLowCardDiscrete = (tv: InternalTableView, u: Set<string>, maxCard = 30) =>
    pick(tv, u, (name, ty, st, card) =>
        isDiscreteLike(ty, st, card, maxCard) && card > 0 && card <= maxCard
        && (!isLikelyIdentifierOrRank(name) || !!tv.preferredFields?.has(name))
    );

export const pickSeriesAxis = (tv: InternalTableView, u: Set<string>) =>
    pickTemporal(tv, u) ?? pickOrdinal(tv, u) ?? pickNominal(tv, u);

export const pickQuantitativeByName = (tv: InternalTableView, u: Set<string>, patterns: string[]) =>
    pick(tv, u, (name, ty, st) => isQuantitativeField(ty, st) && nameMatches(name, patterns));

export function pickAllQuantitative(tv: InternalTableView, used: Set<string>): string[] {
    const result: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        if (isQuantitativeField(type, semanticType) && (!isLikelyIdentifierOrRank(name) || tv.preferredFields?.has(name))) {
            result.push(name);
        }
    }
    for (const name of result) used.add(name);
    return result;
}

// ============================================================================
// 7. Data Fitness Tests
// ============================================================================

export function hasMultipleValuesPerField(tv: InternalTableView, fieldName: string): boolean {
    if (!fieldName || !tv.rows || tv.rows.length === 0) return false;
    const seen = new Set<any>();
    for (const row of tv.rows) {
        const val = row[fieldName];
        if (seen.has(val)) return true;
        seen.add(val);
    }
    return false;
}

function isValidGroupingField(tv: InternalTableView, xField: string, colorField: string): boolean {
    if (!xField || !colorField || !tv.rows || tv.rows.length === 0) return false;
    const seen = new Set<string>();
    for (const row of tv.rows) {
        const key = `${row[xField]}|||${row[colorField]}`;
        if (seen.has(key)) return false;
        seen.add(key);
    }
    return true;
}

export function pickValidGroupingField(
    tv: InternalTableView, used: Set<string>, xField: string, maxCard = 20,
): string | undefined {
    const candidates: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        const cardinality = tv.fieldLevels[name]?.length ?? 0;
        if (!isDiscreteLike(type, semanticType, cardinality, maxCard)) continue;
        if (cardinality <= 0 || cardinality > maxCard) continue;
        if (isLikelyIdentifierOrRank(name) && !tv.preferredFields?.has(name)) continue;
        if (isValidGroupingField(tv, xField, name)) candidates.push(name);
    }
    if (candidates.length === 0) return undefined;
    // Prefer fields from existing encodings
    if (tv.preferredFields) {
        const preferred = candidates.filter(n => tv.preferredFields!.has(n));
        if (preferred.length > 0) {
            const chosen = preferred[Math.floor(Math.random() * preferred.length)];
            used.add(chosen);
            return chosen;
        }
    }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

export function isValidLineSeriesData(tv: InternalTableView, xField: string, colorField?: string): boolean {
    if (!tv.rows || tv.rows.length === 0) return false;
    const xColorCombinations = new Set<string>();
    const colorGroupCounts = new Map<string, number>();

    for (const row of tv.rows) {
        const xVal = row[xField];
        const colorVal = colorField ? row[colorField] : '__single__';
        const xColorKey = `${xVal}|||${colorVal}`;
        if (xColorCombinations.has(xColorKey)) return false;
        xColorCombinations.add(xColorKey);
        colorGroupCounts.set(colorVal, (colorGroupCounts.get(colorVal) ?? 0) + 1);
    }

    let validGroups = 0;
    let totalGroups = 0;
    for (const count of colorGroupCounts.values()) {
        totalGroups++;
        if (count >= 2) validGroups++;
    }
    return totalGroups > 0 && (validGroups / totalGroups) > 0.5;
}

export function pickLineChartColorField(
    tv: InternalTableView, used: Set<string>, xField: string, maxCard = 20,
): string | undefined {
    const candidates: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        const cardinality = tv.fieldLevels[name]?.length ?? 0;
        if (!isDiscreteLike(type, semanticType, cardinality, maxCard)) continue;
        if (cardinality <= 0 || cardinality > maxCard) continue;
        if (isLikelyIdentifierOrRank(name) && !tv.preferredFields?.has(name)) continue;
        if (isValidLineSeriesData(tv, xField, name)) candidates.push(name);
    }
    if (candidates.length === 0) return undefined;
    // Prefer fields from existing encodings
    if (tv.preferredFields) {
        const preferred = candidates.filter(n => tv.preferredFields!.has(n));
        if (preferred.length > 0) {
            const chosen = preferred[Math.floor(Math.random() * preferred.length)];
            used.add(chosen);
            return chosen;
        }
    }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

function calculateMultiplicity(tv: InternalTableView, xField: string, colorField?: string): number {
    if (!tv.rows || tv.rows.length === 0) return 1;
    const groups = new Set<string>();
    for (const row of tv.rows) {
        const key = colorField ? `${row[xField]}|||${row[colorField]}` : `${row[xField]}`;
        groups.add(key);
    }
    return tv.rows.length / groups.size;
}

export function pickBestGroupingField(
    tv: InternalTableView, used: Set<string>, xField: string, maxMultiplicity = 5,
): string | undefined {
    const baseMultiplicity = calculateMultiplicity(tv, xField);
    if (baseMultiplicity <= 1.0) return undefined;

    let bestField: string | undefined;
    let bestMultiplicity = baseMultiplicity;

    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        const cardinality = tv.fieldLevels[name]?.length ?? 0;
        if (!isDiscreteLike(type, semanticType, cardinality)) continue;
        if (isLikelyIdentifierOrRank(name) && !tv.preferredFields?.has(name)) continue;

        const multiplicity = calculateMultiplicity(tv, xField, name);
        if (multiplicity < bestMultiplicity) {
            bestMultiplicity = multiplicity;
            bestField = name;
            if (multiplicity <= 1.0) break;
        }
    }

    if (bestField && bestMultiplicity < baseMultiplicity && bestMultiplicity <= maxMultiplicity) {
        used.add(bestField);
        return bestField;
    }
    return undefined;
}

// ============================================================================
// 8. Per-Chart-Type Recommendation Heuristics
// ============================================================================

/**
 * Recommend channel→fieldName assignments for a given chart type.
 *
 * Pure logic: takes raw data rows + semantic type annotations, returns
 * a channel→fieldName map.  Backend wrappers filter to valid channels.
 *
 * @param chartType      Chart template name (e.g. "Bar Chart")
 * @param data           Array of row objects
 * @param semanticTypes  Field→semantic-type map (e.g. { weight: "Quantity" })
 * @returns              channel→fieldName map
 */
export function recommendChannels(
    chartType: string,
    data: any[],
    semanticTypes: Record<string, string>,
    recommendFn?: RecommendFn,
): Record<string, string> {
    const fn = recommendFn ?? getRecommendation;
    return fn(chartType, buildTableView(data, semanticTypes));
}

/**
 * Core recommendation engine — handles chart types shared across 2+ backends.
 * Backend-specific chart types should be handled in their own recommendation files
 * by extending this function.
 *
 * Exported so that backend wrappers can call it as a fallback in their own
 * extended `getRecommendation` implementations.
 */
export function getRecommendation(chartType: string, tv: InternalTableView): Record<string, string> {
    const used = new Set<string>();
    const rec: Record<string, string> = {};

    const assign = (channel: string, fieldName: string | undefined) => {
        if (fieldName) rec[channel] = fieldName;
    };

    switch (chartType) {
        case 'Scatter Plot': {
            const yField = pickQuantitative(tv, used) ?? pickTemporal(tv, used) ?? pickNominal(tv, used);
            const xField = pickQuantitative(tv, used) ?? pickTemporal(tv, used) ?? pickNominal(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', pickLowCardNominal(tv, used));
            break;
        }

        case 'Bar Chart':
        case 'Stacked Bar Chart': {
            const xField = pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            if (hasMultipleValuesPerField(tv, xField)) {
                assign('color', pickBestGroupingField(tv, used, xField));
            }
            break;
        }

        case 'Grouped Bar Chart': {
            const xField = pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            const colorField = pickValidGroupingField(tv, used, xField, 20);
            if (!colorField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', colorField);
            break;
        }

        case 'Histogram': {
            const xField = pickQuantitative(tv, used);
            if (!xField) return {};
            assign('x', xField);
            break;
        }

        case 'Heatmap': {
            // Semantic-first preference scoring.
            // 1. Semantic type determines preference (temporal, categorical, measure)
            // 2. Data type (ty) is a safeguard for compatibility
            const heatmapResult = resolveAssignment(tv, used, [
                {
                    channel: 'x',
                    pref: (_n, ty, st, card) => {
                        // Semantic preference
                        if (isTimeSeriesType(st))                         return Pref.STRONG;
                        if (isCategoricalType(st))                        return Pref.OK;
                        if (isOrdinalType(st))                            return Pref.OK;
                        if (isNonMeasureNumeric(st))                      return Pref.OK;
                        // Data type safeguard: allow nominal or low-card continuous
                        if (ty === 'nominal')                             return Pref.OK;
                        if (ty === 'temporal')                            return Pref.STRONG;
                        if (ty === 'quantitative' && card > 0 && card <= 50) return Pref.WEAK;
                        return Pref.EXCLUDE;
                    },
                },
                {
                    channel: 'y',
                    pref: (_n, ty, st, card) => {
                        // Semantic preference
                        if (isCategoricalType(st))                        return Pref.STRONG;
                        if (isTimeSeriesType(st))                         return Pref.OK;
                        if (isOrdinalType(st))                            return Pref.OK;
                        if (isNonMeasureNumeric(st))                      return Pref.OK;
                        // Data type safeguard
                        if (ty === 'nominal')                             return Pref.STRONG;
                        if (ty === 'temporal')                            return Pref.OK;
                        if (ty === 'quantitative' && card > 0 && card <= 50) return Pref.WEAK;
                        return Pref.EXCLUDE;
                    },
                },
                {
                    channel: 'color',
                    pref: (_n, ty, st) => {
                        // Semantic preference: measures are ideal for heatmap color
                        if (isMeasureType(st))                            return Pref.STRONG;
                        if (isOrdinalType(st))                            return Pref.OK;
                        // Data type safeguard: quantitative with no semantic type
                        if (ty === 'quantitative' && !st)                 return Pref.STRONG;
                        if (ty === 'temporal')                            return Pref.WEAK;
                        if (ty === 'nominal')                             return Pref.WEAK;
                        return Pref.EXCLUDE;
                    },
                },
            ]);
            if (!heatmapResult['x'] || !heatmapResult['y'] || !heatmapResult['color']) return {};
            assign('x', heatmapResult['x']);
            assign('y', heatmapResult['y']);
            assign('color', heatmapResult['color']);
            break;
        }

        case 'Line Chart': {
            const xField = pickSeriesAxis(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            if (!isValidLineSeriesData(tv, xField, undefined)) {
                const colorField = pickLineChartColorField(tv, used, xField, 20)
                    ?? pickLineChartColorField(tv, used, xField, 200);
                if (!colorField) return {};
                assign('color', colorField);
            }
            break;
        }

        case 'Boxplot': {
            const xField = pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            break;
        }

        case 'Pie Chart': {
            const sizeField = pickQuantitative(tv, used);
            const colorField = pickLowCardDiscrete(tv, used, 12);
            if (!sizeField || !colorField) return {};
            assign('size', sizeField);
            assign('color', colorField);
            break;
        }

        case 'Area Chart': {
            const xField = pickSeriesAxis(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', pickLineChartColorField(tv, used, xField, 20));
            break;
        }

        case 'Streamgraph': {
            // Semantic-first preference scoring.
            // 1. Semantic type determines preference (temporal→x, measure→y, categorical→color)
            // 2. Data type (ty) is a safeguard for compatibility
            const streamResult = resolveAssignment(tv, used, [
                {
                    channel: 'x',
                    pref: (_n, ty, st, card) => {
                        // Semantic preference: temporal types are ideal series axes
                        if (isTimeSeriesType(st))                            return Pref.STRONG;
                        if (isOrdinalType(st))                               return Pref.OK;
                        if (isCategoricalType(st))                           return Pref.OK;
                        if (isNonMeasureNumeric(st))                         return Pref.OK;
                        // Data type safeguard
                        if (ty === 'temporal')                               return Pref.STRONG;
                        if (ty === 'nominal')                                return Pref.OK;
                        if (ty === 'quantitative' && card > 0 && card <= 50) return Pref.OK;
                        return Pref.EXCLUDE;
                    },
                },
                {
                    channel: 'y',
                    pref: (_n, ty, st, card) => {
                        // Semantic preference: true measures are ideal
                        if (isMeasureType(st))                               return Pref.STRONG;
                        // Semantic exclusion: temporal / categorical / non-measure
                        // numeric types should not be used as y-axis measures
                        if (isTimeSeriesType(st))                            return Pref.EXCLUDE;
                        if (isCategoricalType(st))                           return Pref.EXCLUDE;
                        if (isNonMeasureNumeric(st))                         return Pref.EXCLUDE;
                        // Data type safeguard: quantitative with no semantic type
                        if (ty === 'quantitative' && !st)
                            return card > 20 ? Pref.STRONG : Pref.OK;
                        return Pref.EXCLUDE;
                    },
                },
                {
                    channel: 'color',
                    pref: (_n, ty, st, card) => {
                        // Semantic preference
                        if (isCategoricalType(st))                           return Pref.STRONG;
                        if (isOrdinalType(st))                               return Pref.OK;
                        if (isTimeSeriesType(st))                            return Pref.OK;
                        // Data type safeguard
                        if (ty === 'nominal')                                return Pref.STRONG;
                        if (ty === 'temporal' || ty === 'ordinal')           return Pref.OK;
                        if (isDiscreteLike(ty, st, card, 20))                return Pref.WEAK;
                        return Pref.EXCLUDE;
                    },
                },
            ]);
            if (!streamResult['x'] || !streamResult['y'] || !streamResult['color']) return {};
            assign('x', streamResult['x']);
            assign('y', streamResult['y']);
            assign('color', streamResult['color']);
            break;
        }

        case 'Radar Chart': {
            const xField = pickDiscrete(tv, used) ?? pickLowCardDiscrete(tv, used, 20);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', pickLowCardDiscrete(tv, used, 20));
            break;
        }

        case 'Candlestick Chart': {
            const xField = pickTemporal(tv, used)
                ?? pick(tv, used, (name) => nameMatches(name, ['date', 'time', 'day', 'datetime', 'timestamp', 'period']))
                ?? pickQuantitativeByName(tv, used, ['date', 'time', 'day'])
                ?? pickDiscrete(tv, used);
            if (!xField) return {};
            assign('x', xField);
            const openField = pickQuantitativeByName(tv, used, ['open']);
            const highField = pickQuantitativeByName(tv, used, ['high']);
            const lowField = pickQuantitativeByName(tv, used, ['low']);
            const closeField = pickQuantitativeByName(tv, used, ['close']);
            if (openField && highField && lowField && closeField) {
                assign('open', openField);
                assign('high', highField);
                assign('low', lowField);
                assign('close', closeField);
            } else {
                const quants = pickAllQuantitative(tv, used);
                if (quants.length >= 4) {
                    assign('open', quants[0]);
                    assign('high', quants[1]);
                    assign('low', quants[2]);
                    assign('close', quants[3]);
                }
            }
            break;
        }

        default:
            break;
    }

    return rec;
}
