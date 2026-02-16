// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * PHASE 0: RESOLVE SEMANTICS
 * =============================================================================
 *
 * Derive all data-meaning-dependent decisions from semantic types,
 * data values, channel assignments, and mark type. These decisions are
 * abstract — they describe *what* should happen, not *how* to express it
 * in any particular charting library.
 *
 * VL dependency: **None**
 * =============================================================================
 */

import type {
    ChartEncoding,
    ChannelSemantics,
    SemanticResult,
    MarkCognitiveChannel,
} from './types';
import {
    getVisCategory,
    inferVisCategory,
    getRecommendedColorSchemeWithMidpoint,
    computeZeroDecision,
    type ZeroDecision,
} from './semantic-types';
import {
    resolveEncodingType as resolveEncodingTypeDecision,
    type EncodingTypeDecision,
} from './decisions';

// ---------------------------------------------------------------------------
// Internal helpers (moved from assemble.ts)
// ---------------------------------------------------------------------------

/** Upper bounds for plausible timestamps (~2099-12-31). */
const MAX_TIMESTAMP_SEC = 4102444800;
const MAX_TIMESTAMP_MS = 4102444800000;

function isLikelyTimestamp(val: number): boolean {
    if (val >= 1e9 && val <= MAX_TIMESTAMP_SEC) return true;
    if (val > MAX_TIMESTAMP_SEC && val <= MAX_TIMESTAMP_MS) return true;
    return false;
}

function timestampToMs(val: number): number {
    return val <= MAX_TIMESTAMP_SEC ? val * 1000 : val;
}

function looksLikeDateString(s: string): boolean {
    const t = s.trim();
    return /^\d|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t);
}

// ---------------------------------------------------------------------------
// Temporal field analysis
// ---------------------------------------------------------------------------

interface TemporalAnalysis {
    dates: Date[];
    same: {
        month: boolean;
        day: boolean;
        hour: boolean;
        minute: boolean;
        second: boolean;
    };
    sameYear: boolean;
    sameMonth: boolean;
    sameDay: boolean;
}

function analyzeTemporalField(fieldValues: any[]): TemporalAnalysis | null {
    const dates: Date[] = [];
    let nonNull = 0;
    for (const v of fieldValues.slice(0, 100)) {
        if (v == null) continue;
        nonNull++;
        const d = v instanceof Date ? v : new Date(v);
        if (!isNaN(d.getTime())) dates.push(d);
    }
    if (dates.length < 2 || dates.length < nonNull * 0.5) return null;

    const monthSet  = new Set(dates.map(d => d.getUTCMonth()));
    const daySet    = new Set(dates.map(d => d.getUTCDate()));
    const hourSet   = new Set(dates.map(d => d.getUTCHours()));
    const minuteSet = new Set(dates.map(d => d.getUTCMinutes()));
    const secondSet = new Set(dates.map(d => d.getUTCSeconds()));
    const yearSet   = new Set(dates.map(d => d.getUTCFullYear()));

    const isSmallSpread = (s: Set<number>, maxSpread: number = 1) => {
        if (s.size <= 1) return true;
        const arr = [...s];
        return Math.max(...arr) - Math.min(...arr) <= maxSpread;
    };

    const same = {
        month:  monthSet.size  === 1,
        day:    daySet.size    === 1,
        hour:   isSmallSpread(hourSet, 1),
        minute: minuteSet.size === 1,
        second: secondSet.size === 1,
    };

    const sameYear  = yearSet.size === 1;
    const sameMonth = sameYear && same.month;
    const sameDay   = sameMonth && same.day;

    return { dates, same, sameYear, sameMonth, sameDay };
}

function computeDataVotes(same: TemporalAnalysis['same']): number[] {
    const votes = [0, 0, 0, 0, 0, 0];

    if (same.second)                                                           votes[5] += 1;
    if (same.minute && same.second)                                            votes[5] += 1;
    if (same.hour   && same.minute && same.second)                             votes[5] += 1;
    if (same.day    && same.hour   && same.minute && same.second)              votes[5] += 2;
    if (same.month  && same.day    && same.hour   && same.minute && same.second) votes[5] += 3;

    if (same.second)                                                           votes[4] += 1;
    if (same.minute && same.second)                                            votes[4] += 1;
    if (same.hour   && same.minute && same.second)                             votes[4] += 1;
    if (same.day    && same.hour   && same.minute && same.second)              votes[4] += 2;
    if (!same.month && same.day && same.hour && same.minute && same.second)    votes[4] += 3;

    if (same.second)                                                           votes[3] += 1;
    if (same.minute && same.second)                                            votes[3] += 1;
    if (same.hour   && same.minute && same.second)                             votes[3] += 1;
    if (!same.day && same.hour && same.minute && same.second)                  votes[3] += 3;

    if (same.second)                               votes[2] += 1;
    if (same.minute && same.second)                votes[2] += 1;
    if (!same.hour && same.minute && same.second)  votes[2] += 3;

    if (same.second)                    votes[1] += 1;
    if (!same.minute && same.second)    votes[1] += 3;

    if (!same.second) votes[0] += 4;

    return votes;
}

const SEMANTIC_LEVEL: Record<string, number> = {
    Year:        5, Decade:      5,
    YearMonth:   4, Month:       4, YearQuarter: 4, Quarter: 4,
    Date:        3, Day:         3,
    Hour:        2,
    DateTime:    1,
    Timestamp:   0,
};

function pickBestLevel(votes: number[]): { level: number; score: number } {
    let bestLevel = 0;
    let bestScore = votes[0];
    for (let i = 1; i <= 5; i++) {
        if (votes[i] >= bestScore) {
            bestScore = votes[i];
            bestLevel = i;
        }
    }
    return { level: bestLevel, score: bestScore };
}

function levelToFormat(level: number, analysis: TemporalAnalysis): string | null {
    switch (level) {
        case 5: return '%Y';
        case 4: return analysis.sameYear ? '%b' : '%b %Y';
        case 3: return analysis.sameYear ? '%b %d' : '%b %d, %Y';
        case 2: return analysis.sameDay  ? '%H:00' : '%b %d %H:00';
        case 1: return analysis.sameDay  ? '%H:%M' : '%b %d %H:%M';
        case 0: return analysis.sameDay  ? '%H:%M:%S' : '%b %d %H:%M:%S';
        default: return null;
    }
}

/**
 * Resolve temporal format for a field.
 * Used for both temporal and ordinal-temporal fields.
 */
function resolveTemporalFormat(
    fieldValues: any[],
    semanticType: string,
): string | null {
    const analysis = analyzeTemporalField(fieldValues);
    if (!analysis) return null;

    const votes = computeDataVotes(analysis.same);
    const semLevel = SEMANTIC_LEVEL[semanticType];
    if (semLevel !== undefined) votes[semLevel] += 3;
    const { level } = pickBestLevel(votes);
    return levelToFormat(level, analysis);
}

// ---------------------------------------------------------------------------
// Temporal data conversion
// ---------------------------------------------------------------------------

/**
 * Convert temporal field values in the data table to canonical string
 * representations for Vega-Lite consumption.
 *
 * This is a data-level concern (not VL-specific) — it ensures consistent
 * date parsing across backends.
 */
export function convertTemporalData(
    data: any[],
    semanticTypes: Record<string, string>,
): any[] {
    if (data.length === 0) return data;

    const keys = Object.keys(data[0]);
    const temporalKeys = keys.filter((k: string) => {
        const st = semanticTypes[k] || '';
        const vc = inferVisCategory(data.map(r => r[k]));
        const stCategory = st ? getVisCategory(st) : null;
        return vc === 'temporal' || stCategory === 'temporal' || st === 'Decade';
    });

    if (temporalKeys.length === 0) return data;

    const values = structuredClone(data);
    return values.map((r: any) => {
        for (const temporalKey of temporalKeys) {
            const val = r[temporalKey];
            const st = semanticTypes[temporalKey] || '';

            if (typeof val === 'number') {
                if (st === 'Year' || st === 'Decade') {
                    r[temporalKey] = `${Math.floor(val)}`;
                } else if (isLikelyTimestamp(val)) {
                    r[temporalKey] = new Date(timestampToMs(val)).toISOString();
                } else {
                    r[temporalKey] = String(val);
                }
            } else if (val instanceof Date) {
                r[temporalKey] = val.toISOString();
            } else {
                r[temporalKey] = String(val);
            }
        }
        return r;
    });
}

// ---------------------------------------------------------------------------
// Public API: resolveSemantics
// ---------------------------------------------------------------------------

/**
 * Phase 0: Resolve all semantic decisions from field data, semantic types,
 * and channel assignments.
 *
 * Produces a Record<channel, ChannelSemantics> where each entry carries the
 * field, resolved type, and all semantic decisions for that channel.
 *
 * @param encodings       Channel → ChartEncoding from user / AI agent
 * @param data            Array of data rows
 * @param semanticTypes   Field name → semantic type string
 * @param markCognitiveChannel  How the primary mark encodes its quantitative value
 * @param markType        The template's mark type string (for zero-baseline
 *                        decisions when markCognitiveChannel is not provided)
 */
export function resolveSemantics(
    encodings: Record<string, ChartEncoding>,
    data: any[],
    semanticTypes: Record<string, string>,
    markCognitiveChannel?: MarkCognitiveChannel,
    markType?: string,
): SemanticResult {
    const result: SemanticResult = {};

    // Convert temporal data for consistent parsing
    const convertedData = convertTemporalData(data, semanticTypes);

    for (const [channel, encoding] of Object.entries(encodings)) {
        const fieldName = encoding.field;
        if (!fieldName && encoding.aggregate !== 'count') continue;

        // Handle count aggregate without a field
        if (!fieldName && encoding.aggregate === 'count') {
            result[channel] = {
                field: '_count',
                aggregate: 'count',
                type: 'quantitative',
                typeReason: 'count aggregate is always quantitative',
            };
            continue;
        }

        if (!fieldName) continue;

        const semanticType = semanticTypes[fieldName] || '';
        const fieldValues = data.map(r => r[fieldName]);

        // Resolve encoding type
        const typeDecision = resolveEncodingTypeDecision(
            semanticType, fieldValues, channel, data, fieldName,
        );

        // Apply explicit type override
        let resolvedType = typeDecision.vlType;
        let typeReason = `visCategory=${typeDecision.visCategory}`;
        if (typeDecision.channelOverride) typeReason += ', channelOverride';
        if (typeDecision.cardinalityGuard) typeReason += ', cardinalityGuard';

        if (encoding.type) {
            resolvedType = encoding.type;
            typeReason = 'explicit user override';
        } else if (channel === 'column' || channel === 'row') {
            if (resolvedType !== 'nominal' && resolvedType !== 'ordinal') {
                resolvedType = 'nominal';
                typeReason += ', facet→nominal';
            }
        }

        // ISO date hack
        if (resolvedType === 'quantitative') {
            const sampleValues = data.slice(0, 15).filter(r => r[fieldName] != undefined).map(r => r[fieldName]);
            const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
            if (sampleValues.length > 0 && sampleValues.every((val: any) => isoDateRegex.test(`${val}`.trim()))) {
                resolvedType = 'temporal';
                typeReason += ', isoDateHack';
            }
        }

        // Build ChannelSemantics entry
        const cs: ChannelSemantics = {
            field: fieldName,
            type: resolvedType,
            typeReason,
        };

        // Carry over encoding properties
        if (encoding.aggregate) cs.aggregate = encoding.aggregate;
        if (encoding.sortOrder) cs.sortOrder = encoding.sortOrder;
        if (encoding.sortBy) cs.sortBy = encoding.sortBy;

        // Adjust field name for aggregated fields
        if (encoding.aggregate) {
            if (encoding.aggregate === 'count') {
                cs.field = '_count';
                cs.type = 'quantitative';
            } else {
                cs.field = `${fieldName}_${encoding.aggregate}`;
                cs.type = 'quantitative';
            }
        }

        // --- Channel-specific semantic decisions ---

        // Zero-baseline (positional quantitative only)
        if ((channel === 'x' || channel === 'y') && cs.type === 'quantitative') {
            const numericValues = data
                .map(r => r[fieldName])
                .filter((v: any) => v != null && typeof v === 'number' && !isNaN(v));

            // Use markCognitiveChannel or fall back to mark type
            const effectiveMarkType = markType || 'point';
            const zero = computeZeroDecision(semanticType, channel, effectiveMarkType, numericValues);
            cs.zero = zero;
        }

        // Color scheme (color and group channels)
        if ((channel === 'color' || channel === 'group') && fieldName) {
            if (encoding.scheme && encoding.scheme !== 'default') {
                cs.colorScheme = {
                    scheme: encoding.scheme,
                    type: 'categorical',
                    reason: 'explicit user scheme',
                };
            } else {
                const encodingVLType = cs.type as 'nominal' | 'ordinal' | 'quantitative' | 'temporal';
                cs.colorScheme = getRecommendedColorSchemeWithMidpoint(
                    semanticType, encodingVLType, fieldValues, fieldName,
                );
            }
        }

        // Temporal format
        if (cs.type === 'temporal' || (semanticType && getVisCategory(semanticType) === 'temporal')) {
            const convertedFieldValues = convertedData.map(r => r[fieldName]);
            const fmt = resolveTemporalFormat(convertedFieldValues, semanticType);
            if (fmt) cs.temporalFormat = fmt;
        }

        result[channel] = cs;
    }

    return result;
}

// Re-export helpers needed by other modules
export {
    analyzeTemporalField,
    computeDataVotes,
    pickBestLevel,
    levelToFormat,
    looksLikeDateString,
    SEMANTIC_LEVEL,
    type TemporalAnalysis,
};
