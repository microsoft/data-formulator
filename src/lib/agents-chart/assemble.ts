// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Core chart assembly logic.
 *
 * Given data, encoding definitions, and semantic types,
 * produces a complete Vega-Lite specification.
 *
 * This module has NO React, Redux, or UI framework dependencies.
 * It is designed to be reusable outside of the Data Formulator app.
 */

import {
    ChartEncoding,
    ChartTemplateDef,
    AssembleOptions,
    BuildEncodingContext,
} from './types';
import { getTemplateDef } from './templates';
import {
    getVisCategory,
    inferVisCategory,
    getRecommendedColorSchemeWithMidpoint,
    computeZeroDecision,
    computePaddedDomain,
    type VisCategory,
    type ZeroDecision,
} from './semantic-types';
import {
    resolveEncodingType as resolveEncodingTypeDecision,
    computeElasticBudget,
    computeAxisStep,
    computeFacetLayout,
    computeLabelSizing,
    computeGasPressure,
    DEFAULT_GAS_PRESSURE_PARAMS,
    type ElasticStretchParams,
    type EncodingTypeDecision,
    type GasPressureDecision,
} from './decisions';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Upper bounds for plausible timestamps (~2099-12-31).
 */
const MAX_TIMESTAMP_SEC = 4102444800;
const MAX_TIMESTAMP_MS = 4102444800000;

/**
 * Check if a numeric value is likely a Unix timestamp (seconds or milliseconds).
 *
 * Seconds range:  1e9  .. MAX_TIMESTAMP_SEC  (~2001 .. ~2099)
 * Milliseconds:   anything above MAX_TIMESTAMP_SEC up to MAX_TIMESTAMP_MS
 *                 (covers ms timestamps from ~1970 onward)
 */
function isLikelyTimestamp(val: number): boolean {
    if (val >= 1e9 && val <= MAX_TIMESTAMP_SEC) return true;   // seconds
    if (val > MAX_TIMESTAMP_SEC && val <= MAX_TIMESTAMP_MS) return true;  // milliseconds
    return false;
}

/**
 * Convert a numeric timestamp to milliseconds.
 * Values in the seconds range are multiplied by 1000.
 */
function timestampToMs(val: number): number {
    return val <= MAX_TIMESTAMP_SEC ? val * 1000 : val;
}

/**
 * Determine the d3-time-format string for a temporal encoding based on
 * the semantic type and actual (converted) field values.
 *
 * - Known granularity types (Year, Month, …) → explicit format.
 * - Generic temporal (Timestamp, DateTime, unknown) → auto-detect from data.
 *
 * Returns `null` when VL's default auto-formatting is adequate.
 */
/**
 * Check if a string plausibly looks like a date.
 * Date.parse() is far too permissive — e.g. "FY 2018", "hello world 2018"
 * all parse as Jan 1, 2018 in V8.  We require the string to start with
 * a digit or a recognisable month-name prefix.
 */
function looksLikeDateString(s: string): boolean {
    const t = s.trim();
    return /^\d|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t);
}

// ---------------------------------------------------------------------------
// Temporal field analysis
// ---------------------------------------------------------------------------

/** Raw uniformity analysis returned by analyzeTemporalField. */
interface TemporalAnalysis {
    dates: Date[];
    /** Per-component uniformity flags. */
    same: {
        month: boolean;
        day: boolean;
        hour: boolean;   // ±1 hr tolerance for DST
        minute: boolean;
        second: boolean;
    };
    /** Higher-level compound uniformity. */
    sameYear: boolean;
    sameMonth: boolean;  // sameYear && same.month
    sameDay: boolean;    // sameMonth && same.day
}

/**
 * Parse dates from field values and analyse UTC component uniformity.
 * Returns `null` when fewer than 2 values or < 50% parse as dates.
 */
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
        hour:   isSmallSpread(hourSet, 1),   // ±1 hr for DST
        minute: minuteSet.size === 1,
        second: secondSet.size === 1,
    };

    const sameYear  = yearSet.size === 1;
    const sameMonth = sameYear && same.month;
    const sameDay   = sameMonth && same.day;

    return { dates, same, sameYear, sameMonth, sameDay };
}

/**
 * Compute data-driven votes per granularity level from component uniformity.
 * Levels: 5=year, 4=month, 3=day, 2=hour, 1=minute, 0=second.
 */
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

/** Semantic type → granularity level for voting. */
const SEMANTIC_LEVEL: Record<string, number> = {
    Year:        5, Decade:      5,
    YearMonth:   4, Month:       4, YearQuarter: 4, Quarter: 4,
    Date:        3, Day:         3,
    Hour:        2,
    DateTime:    1,
    Timestamp:   0,
};

/**
 * Pick the best granularity level from a votes array.
 * Ties go to the coarser (higher-numbered) level.
 */
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

/**
 * Map a granularity level + uniformity analysis to a compact d3-time-format string.
 * Drops redundant higher-level prefixes when all values share the same year/month/day.
 */
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
 * Resolve the Vega-Lite encoding type for a field.
 *
 * Thin wrapper around the pure decision function in decisions.ts.
 * Returns only the VL type string for backward compatibility.
 */
function resolveEncodingType(
    semanticType: string,
    fieldValues: any[],
    channel: string,
    data: any[],
    fieldName: string,
): string {
    const decision = resolveEncodingTypeDecision(semanticType, fieldValues, channel, data, fieldName);
    return decision.vlType;
}

/**
 * Resolve encoding type and return the full decision object.
 * Used internally when the assembler needs the reasoning metadata.
 */
function resolveEncodingTypeFull(
    semanticType: string,
    fieldValues: any[],
    channel: string,
    data: any[],
    fieldName: string,
): EncodingTypeDecision {
    return resolveEncodingTypeDecision(semanticType, fieldValues, channel, data, fieldName);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a Vega-Lite specification from chart type, encodings, data, and semantic types.
 *
 * @param chartType       Name of the chart template (e.g. "Scatter Plot", "Bar Chart")
 * @param encodings       Record mapping channel names to ChartEncoding (field names, not IDs)
 * @param data            Array of data rows
 * @param semanticTypes   Record mapping field names to semantic type strings (e.g. "Quantity", "Country")
 * @param canvasSize      Target canvas dimensions { width, height }
 * @param options         Assembly options (scale factor, etc.)
 * @returns               A Vega-Lite spec object, or ["Table", undefined] for table type
 */
export function assembleChart(
    chartType: string,
    encodings: Record<string, ChartEncoding>,
    data: any[],
    semanticTypes: Record<string, string> = {},
    canvasSize: { width: number; height: number } = { width: 400, height: 320 },
    chartProperties?: Record<string, any>,
    options: AssembleOptions = {},
): any {
    const chartTemplate = getTemplateDef(chartType) as ChartTemplateDef;
    if (!chartTemplate) {
        throw new Error(`Unknown chart type: ${chartType}`);
    }

    // Let the template override assembly defaults before destructuring.
    const effectiveOptions = chartTemplate.overrideDefaultSettings
        ? chartTemplate.overrideDefaultSettings({ ...options })
        : options;

    const {
        addTooltips = false,
        elasticity: elasticityVal = 0.5,
        maxStretch: maxStretchVal = 2,
        facetElasticity: facetElasticityVal = 0.3,
        facetMaxStretch: facetMaxStretchVal = 1.5,
        minStep: minStepVal = 6,
        minSubplotSize: minSubplotVal = 60,
        defaultStepMultiplier = 1,
        maintainContinuousAxisRatio = false,
        continuousMarkCrossSection,
    } = effectiveOptions;

    const vgObj = structuredClone(chartTemplate.template);

    // --- Warnings collector ---
    const warnings: import('./types').ChartWarning[] = [];

    // --- Resolve encodings ---
    const resolvedEncodings: Record<string, any> = {};
    const encodingTypeDecisions: Record<string, EncodingTypeDecision> = {};
    for (const [channel, encoding] of Object.entries(encodings)) {
        const encodingObj: any = {};

        if (channel === "radius") {
            encodingObj.scale = { type: "sqrt", zero: true };
        }

        const fieldName = encoding.field;

        // Handle count aggregate without a field
        if (!fieldName && encoding.aggregate === "count") {
            encodingObj.field = "_count";
            encodingObj.title = "Count";
            encodingObj.type = "quantitative";
        }

        if (fieldName) {
            encodingObj.field = fieldName;
            const semanticType = semanticTypes[fieldName] || '';
            const fieldValues = data.map(r => r[fieldName]);

            // Unified type resolution: semantic type + data inference + channel rules
            const typeDecision = resolveEncodingTypeFull(semanticType, fieldValues, channel, data, fieldName);
            encodingObj.type = typeDecision.vlType;
            encodingTypeDecisions[fieldName] = typeDecision;

            // Explicit type override
            if (encoding.type) {
                encodingObj.type = encoding.type;
            } else if (channel === 'column' || channel === 'row') {
                if (encodingObj.type !== 'nominal' && encodingObj.type !== 'ordinal') {
                    encodingObj.type = 'nominal';
                }
            }

            // ISO date hack: if quantitative but values are ISO strings, switch to temporal
            if (encodingObj.type === "quantitative") {
                const sampleValues = data.slice(0, 15).filter(r => r[fieldName] != undefined).map(r => r[fieldName]);
                const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
                if (sampleValues.length > 0 && sampleValues.every((val: any) => isoDateRegex.test(`${val}`.trim()))) {
                    encodingObj.type = "temporal";
                }
            }

            // Aggregation handling — data is always pre-aggregated
            if (encoding.aggregate) {
                if (encoding.aggregate === "count") {
                    encodingObj.field = "_count";
                    encodingObj.title = "Count";
                    encodingObj.type = "quantitative";
                } else {
                    encodingObj.field = `${fieldName}_${encoding.aggregate}`;
                    encodingObj.type = "quantitative";
                }
            }

            // Scale tweaks: quantitative X axes need tight domains to avoid
            // extra whitespace at the edges.  We apply this for line-like and
            // area-like templates (anything with a connected mark) but NOT for
            // bar/rect charts where VL's nice axis ticks look better.
            // At this point vgObj.mark is not yet set, so check the template.
            if (encodingObj.type === "quantitative" && channel === "x") {
                const tplMark = chartTemplate.template?.mark;
                const tplMarkType = typeof tplMark === 'string' ? tplMark : tplMark?.type;
                if (tplMarkType === 'line' || tplMarkType === 'area' || tplMarkType === 'trail' || tplMarkType === 'point') {
                    encodingObj.scale = { nice: false };
                }
            }

            // Legend sizing for high-cardinality nominal color
            if (encodingObj.type === "nominal" && channel === 'color') {
                const actualDomain = [...new Set(data.map(r => r[fieldName]))];
                if (actualDomain.length >= 16) {
                    if (!encodingObj.legend) encodingObj.legend = {};
                    encodingObj.legend.symbolSize = 12;
                    encodingObj.legend.labelFontSize = 8;
                }
            }
        }

        // Size channel: set scale based on resolved encoding type.
        // For quantitative: sqrt scale with zero=true, density-aware max (≤ VL default 361).
        // For categorical (nominal/ordinal): no zero, balanced min:max ratio (~1:4)
        //   so all levels are visually distinguishable.
        if (channel === "size") {
            const vlDefaultMax = 361;                   // VL's default size scale max (19²)
            const plotArea = canvasSize.width * canvasSize.height;
            const n = Math.max(data.length, 1);
            const fairShare = plotArea / n;
            const targetPct = 0.6;
            const absoluteMin = 16;

            const isQuantitative = encodingObj.type === 'quantitative' || encodingObj.type === 'temporal';
            if (isQuantitative) {
                // Sqrt scale, zero-based — small values get small dots proportionally
                const maxSize = Math.round(Math.max(absoluteMin, Math.min(vlDefaultMax, fairShare * targetPct)));
                const minSize = 9;
                encodingObj.scale = { type: "sqrt", zero: true, range: [minSize, maxSize] };
            } else {
                // Categorical size: balanced ratio so smallest level is still readable
                const maxSize = Math.round(Math.max(absoluteMin, Math.min(vlDefaultMax, fairShare * targetPct)));
                const minSize = Math.round(maxSize / 4);  // 1:4 ratio
                encodingObj.scale = { range: [minSize, maxSize] };
            }
        }

        // --- Sorting ---
        if (encoding.sortBy || encoding.sortOrder) {
            if (!encoding.sortBy) {
                if (encoding.sortOrder) {
                    encodingObj.sort = encoding.sortOrder;
                }
            } else if (encoding.sortBy === 'x' || encoding.sortBy === 'y') {
                if (encoding.sortBy === channel) {
                    encodingObj.sort = `${encoding.sortOrder === "descending" ? "-" : ""}${encoding.sortBy}`;
                } else {
                    encodingObj.sort = `${encoding.sortOrder === "ascending" ? "" : "-"}${encoding.sortBy}`;
                }
            } else if (encoding.sortBy === 'color') {
                if (encodings.color?.field) {
                    encodingObj.sort = `${encoding.sortOrder === "ascending" ? "" : "-"}${encoding.sortBy}`;
                }
            } else {
                try {
                    if (fieldName) {
                        const fieldSemType = semanticTypes[fieldName] || '';
                        const fieldVisCat = inferVisCategory(data.map(r => r[fieldName]));
                        let sortedValues = JSON.parse(encoding.sortBy);

                        if (fieldVisCat === 'temporal' || fieldSemType === "Year" || fieldSemType === "Decade") {
                            sortedValues = sortedValues.map((v: any) => v.toString());
                        }

                        encodingObj.sort = (encoding.sortOrder === "ascending" || !encoding.sortOrder)
                            ? sortedValues : sortedValues.reverse();

                        if (channel === 'color' && (vgObj.mark === 'bar' || vgObj.mark === 'area')) {
                            vgObj.encoding = vgObj.encoding || {};
                            vgObj.encoding.order = {
                                field: `color_${fieldName}_sort_index`,
                            };
                        }
                    }
                } catch (err) {
                    console.warn(`sort error > ${encoding.sortBy}`);
                }
            }
        } else {
            // Auto-sort: nominal axis with quantitative opposite
            if ((channel === 'x' && encodingObj.type === 'nominal' && encodings.y?.field) ||
                (channel === 'y' && encodingObj.type === 'nominal' && encodings.x?.field)) {

                // Skip auto-sort when the field's original data is temporal
                // (converted to nominal/ordinal by detectBandedAxis) — sorting
                // by quantitative value would break chronological order.
                const fieldOrigType = fieldName ? inferVisCategory(data.map(r => r[fieldName])) : undefined;
                if (fieldOrigType !== 'temporal') {
                    const colorField = encodings.color?.field;
                    let colorFieldType: string | undefined;
                    if (colorField) {
                        colorFieldType = inferVisCategory(data.map(r => r[colorField]));
                    }

                    if (colorField && colorFieldType === 'quantitative') {
                        encodingObj.sort = "-color";
                    } else {
                        const oppositeChannel = channel === 'x' ? 'y' : 'x';
                        const oppositeField = encodings[oppositeChannel]?.field;
                        if (oppositeField) {
                            if (inferVisCategory(data.map(r => r[oppositeField])) === 'quantitative') {
                                encodingObj.sort = `-${oppositeChannel}`;
                            }
                        }
                    }
                }
            }
        }

        // Color scheme
        if (channel === "color") {
            if (encoding.scheme && encoding.scheme !== "default") {
                if ('scale' in encodingObj) {
                    encodingObj.scale.scheme = encoding.scheme;
                } else {
                    encodingObj.scale = { scheme: encoding.scheme };
                }
            } else if (fieldName) {
                const colorSemanticType = semanticTypes[fieldName];
                const fieldValues = data.map(r => r[fieldName]);
                const encodingVLType = encodingObj.type as 'nominal' | 'ordinal' | 'quantitative' | 'temporal';

                const recommendation = getRecommendedColorSchemeWithMidpoint(
                    colorSemanticType, encodingVLType, fieldValues, fieldName
                );

                if (!('scale' in encodingObj)) {
                    encodingObj.scale = {};
                }
                encodingObj.scale.scheme = recommendation.scheme;

                if (recommendation.type === 'diverging' && recommendation.domainMid !== undefined) {
                    encodingObj.scale.domainMid = recommendation.domainMid;
                }
            }
        }

        // --- Collect resolved encoding ---
        if (Object.keys(encodingObj).length !== 0) {
            resolvedEncodings[channel] = encodingObj;
        }
    }

    // --- Compute zero-baseline decisions for quantitative positional axes ---
    const tplMark = chartTemplate.template?.mark;
    const templateMarkType = typeof tplMark === 'string' ? tplMark : tplMark?.type;
    const zeroDecisions: Record<string, ZeroDecision> = {};
    for (const ch of ['x', 'y'] as const) {
        const enc = resolvedEncodings[ch];
        if (!enc?.field || enc.type !== 'quantitative') continue;
        const fieldName = enc.field;
        const semType = semanticTypes[fieldName] || '';
        const numericValues = data
            .map(r => r[fieldName])
            .filter((v: any) => v != null && typeof v === 'number' && !isNaN(v));

        // Determine effective mark type — check layers if present
        let effectiveMarkType = templateMarkType || 'point';
        if (!templateMarkType && chartTemplate.template?.layer) {
            const firstLayerMark = chartTemplate.template.layer[0]?.mark;
            effectiveMarkType = typeof firstLayerMark === 'string' ? firstLayerMark : firstLayerMark?.type || 'point';
        }

        const decision = computeZeroDecision(semType, ch, effectiveMarkType, numericValues);
        zeroDecisions[ch] = decision;
    }

    // --- Build encodings into spec ---
    const buildContext: BuildEncodingContext = {
        table: data,
        semanticTypes,
        canvasSize,
        chartType,
        chartProperties,
        semanticMetadata: {
            encodingTypeDecisions,
            zeroDecisions,
        },
    };
    chartTemplate.buildEncodings(vgObj, resolvedEncodings, buildContext);

    // Merge any warnings emitted by buildEncodings
    if (vgObj._warnings && Array.isArray(vgObj._warnings)) {
        warnings.push(...vgObj._warnings);
        delete vgObj._warnings;
    }

    // --- Apply zero-baseline decisions to VL spec ---
    // This applies the semantic-type-driven zero decisions computed above.
    // It sets scale.zero and scale.domain on quantitative positional encodings.
    // Must run after buildEncodings because templates may change encoding types.
    for (const [ch, decision] of Object.entries(zeroDecisions)) {
        // Find the encoding — may be on top-level or in a layer
        const targets: any[] = [];
        if (vgObj.encoding?.[ch]?.type === 'quantitative') {
            targets.push(vgObj.encoding[ch]);
        }
        if (Array.isArray(vgObj.layer)) {
            for (const layer of vgObj.layer) {
                if (layer.encoding?.[ch]?.type === 'quantitative') {
                    targets.push(layer.encoding[ch]);
                }
            }
        }

        for (const enc of targets) {
            if (!enc.scale) enc.scale = {};

            // Don't override if the template already set scale.zero explicitly
            if (enc.scale.zero !== undefined) continue;
            // Don't override if domain is already constrained
            if (enc.scale.domain && Array.isArray(enc.scale.domain)) continue;

            enc.scale.zero = decision.zero;

            // Apply domain padding for non-zero axes
            if (!decision.zero && decision.domainPadFraction > 0) {
                const fieldName = enc.field;
                if (fieldName) {
                    const numericValues = data
                        .map(r => r[fieldName])
                        .filter((v: any) => v != null && typeof v === 'number' && !isNaN(v));
                    const paddedDomain = computePaddedDomain(numericValues, decision.domainPadFraction);
                    if (paddedDomain) {
                        enc.scale.domain = paddedDomain;
                        enc.scale.nice = false; // Don't let VL re-introduce 0 via nice rounding
                    }
                }
            }
        }
    }

    // --- Temporal data conversion ---
    let values = structuredClone(data);
    if (values.length > 0) {
        const keys = Object.keys(values[0]);
        const temporalKeys = keys.filter((k: string) => {
            const st = semanticTypes[k] || '';
            const vc = inferVisCategory(data.map(r => r[k]));
            const stCategory = st ? getVisCategory(st) : null;
            return vc === 'temporal' || stCategory === 'temporal' || st === 'Decade';
        });
        if (temporalKeys.length > 0) {
            values = values.map((r: any) => {
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
    }

    // --- Temporal axis formatting ---

    // 1. Temporal encodings (line/area/scatter): use axis.format (d3-time-format)
    //    to pick a compact label like "%Y" or "%H:%M" instead of VL's default.
    const applyTemporalFormat = (enc: any, channel: string) => {
        if (!enc || !enc.field || enc.type !== 'temporal') return;
        const st = semanticTypes[enc.field] || '';
        const fieldVals = values.map((r: any) => r[enc.field]);
        const analysis = analyzeTemporalField(fieldVals);
        if (!analysis) return;

        const votes = computeDataVotes(analysis.same);
        const semLevel = SEMANTIC_LEVEL[st];
        if (semLevel !== undefined) votes[semLevel] += 3;
        const { level } = pickBestLevel(votes);
        const fmt = levelToFormat(level, analysis);
        if (!fmt) return;

        if (channel === 'x' || channel === 'y') {
            if (!enc.axis) enc.axis = {};
            enc.axis.format = fmt;
        } else if (channel === 'color') {
            if (!enc.legend) enc.legend = {};
            enc.legend.format = fmt;
        }
    };

    // 2. Ordinal/nominal encodings of temporal data (e.g. bar charts):
    //    use axis.labelExpr with Vega's timeFormat(toDate(...), fmt).
    //    More conservative — requires looksLikeDateString + high vote score.
    const applyOrdinalTemporalFormat = (enc: any, channel: string) => {
        if (!enc || !enc.field) return;
        if (enc.type !== 'ordinal' && enc.type !== 'nominal') return;
        const st = semanticTypes[enc.field] || '';
        const stCategory = st ? getVisCategory(st) : null;
        if (stCategory !== 'temporal') return;

        // Check that the raw values actually look like date strings
        // so V8's over-permissive Date.parse doesn't silently mangle
        // labels like "FY 2018" → "2018".
        const fieldVals = values.map((r: any) => r[enc.field]).filter((v: any) => v != null);
        const datelikeCnt = fieldVals.filter((v: any) =>
            typeof v !== 'string' || looksLikeDateString(String(v))
        ).length;
        if (datelikeCnt < fieldVals.length * 0.5) return;

        const analysis = analyzeTemporalField(fieldVals);
        if (!analysis) return;

        // Require both data and semantic agreement (minScore ≥ 5).
        const votes = computeDataVotes(analysis.same);
        const semLevel = SEMANTIC_LEVEL[st];
        if (semLevel !== undefined) votes[semLevel] += 3;
        const { level, score } = pickBestLevel(votes);
        if (score < 5) return;

        const fmt = levelToFormat(level, analysis);
        if (!fmt) return;

        // Guard with isValid so unparseable values fall back to the original label.
        const expr = `isValid(toDate(datum.label)) ? timeFormat(toDate(datum.label), '${fmt}') : datum.label`;
        if (channel === 'x' || channel === 'y') {
            if (!enc.axis) enc.axis = {};
            enc.axis.labelExpr = expr;
        } else if (channel === 'color') {
            if (!enc.legend) enc.legend = {};
            enc.legend.labelExpr = expr;
        }
    };
    if (vgObj.encoding) {
        for (const [ch, enc] of Object.entries(vgObj.encoding)) {
            applyTemporalFormat(enc, ch);
            applyOrdinalTemporalFormat(enc, ch);
        }
    }
    if (vgObj.layer && Array.isArray(vgObj.layer)) {
        for (const layer of vgObj.layer) {
            if (layer.encoding) {
                for (const [ch, enc] of Object.entries(layer.encoding)) {
                    applyTemporalFormat(enc, ch);
                    applyOrdinalTemporalFormat(enc, ch);
                }
            }
        }
    }

    // --- Canvas sizing & discrete axis handling ---
    const defaultChartWidth = canvasSize.width;
    const defaultChartHeight = canvasSize.height;

    // Dynamically compute max facet values based on canvas size.
    // Each subplot needs at least minSubplotVal px, allow up to facetMaxStretch elastic stretch.
    const maxFacetColumns = Math.max(2, Math.floor(defaultChartWidth * facetMaxStretchVal / minSubplotVal));
    const maxFacetRows = Math.max(2, Math.floor(defaultChartHeight * facetMaxStretchVal / minSubplotVal));
    const maxFacetNominalValues = maxFacetColumns * maxFacetRows;

    const baseRefSize = 300;
    const sizeRatio = Math.max(defaultChartWidth, defaultChartHeight) / baseRefSize;
    const defaultStepSize = Math.round(20 * Math.max(1, sizeRatio) * defaultStepMultiplier);

    const isDiscreteType = (t: string | undefined) => t === 'nominal' || t === 'ordinal';
    const xOffsetEnc = vgObj.encoding?.xOffset;
    const yOffsetEnc = vgObj.encoding?.yOffset;
    const xOffsetMultiplier = (xOffsetEnc?.field && isDiscreteType(xOffsetEnc.type))
        ? new Set(values.map((r: any) => r[xOffsetEnc.field])).size : 1;
    const yOffsetMultiplier = (yOffsetEnc?.field && isDiscreteType(yOffsetEnc.type))
        ? new Set(values.map((r: any) => r[yOffsetEnc.field])).size : 1;

    // For grouped bars, compute overflow cutoff at the group level:
    // each group needs at least 2 × itemsPerGroup pixels (min group step),
    // and we allow up to maxStretch × canvas size.
    const xMinGroupStep = xOffsetMultiplier > 1 ? 2 * xOffsetMultiplier : minStepVal;
    const yMinGroupStep = yOffsetMultiplier > 1 ? 2 * yOffsetMultiplier : minStepVal;
    let maxXToKeep = Math.floor(defaultChartWidth * maxStretchVal / xMinGroupStep);
    let maxYToKeep = Math.floor(defaultChartHeight * maxStretchVal / yMinGroupStep);

    // --- Mark type detection (needed for overflow sort strategy) ---
    const markType = typeof vgObj.mark === 'string' ? vgObj.mark : vgObj.mark?.type;
    const allMarkTypes = new Set<string>();
    if (markType) allMarkTypes.add(markType);
    if (Array.isArray(vgObj.layer)) {
        for (const layer of vgObj.layer) {
            const lm = typeof layer.mark === 'string' ? layer.mark : layer.mark?.type;
            if (lm) allMarkTypes.add(lm);
        }
    }
    const hasConnectedMark = allMarkTypes.has('line') || allMarkTypes.has('area') || allMarkTypes.has('trail');

    const nominalCount: Record<string, number> = {
        x: 0, y: 0, column: 0, row: 0, xOffset: 0, yOffset: 0,
    };

    // Count discrete values and filter data for overflowing axes
    for (const channel of ['x', 'y', 'column', 'row', 'xOffset', 'yOffset', 'color']) {
        const enc = vgObj.encoding?.[channel];
        if (enc?.field && isDiscreteType(enc.type)) {
            // For column-only facets (no row), we'll wrap into multiple rows
            // later, so the cap should be the full wrappable grid — not just
            // a single row of facets.
            const hasRow = vgObj.encoding?.row != undefined;
            const columnCap = hasRow ? maxFacetColumns : maxFacetNominalValues;
            const maxNominalValuesToKeep = channel === 'x' ? maxXToKeep
                : channel === 'y' ? maxYToKeep
                : channel === 'row' ? maxFacetRows
                : channel === 'column' ? columnCap
                : maxFacetNominalValues;
            const fieldName = enc.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];

            nominalCount[channel] = uniqueValues.length > maxNominalValuesToKeep ? maxNominalValuesToKeep : uniqueValues.length;

            const fieldOriginalType = inferVisCategory(data.map(r => r[fieldName]));

            let valuesToKeep: any[];
            if (uniqueValues.length > maxNominalValuesToKeep) {
                if (fieldOriginalType === 'quantitative' || channel === 'color') {
                    valuesToKeep = uniqueValues.sort((a, b) => a - b).slice(0, channel === 'color' ? 24 : maxNominalValuesToKeep);
                } else if (channel === 'facet' || channel === 'column' || channel === 'row') {
                    valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                } else if (channel === 'x' || channel === 'y') {
                    const oppositeChannel = channel === 'x' ? 'y' : 'x';
                    const oppositeEncoding = vgObj.encoding?.[oppositeChannel];
                    const colorEncoding = vgObj.encoding?.color;

                    let isDescending = true;
                    let sortChannel: string | undefined;
                    let sortField: string | undefined;
                    let sortFieldType: string | undefined;

                    if (enc.sort) {
                        if (typeof enc.sort === 'string' && (enc.sort === 'descending' || enc.sort === 'ascending')) {
                            isDescending = enc.sort === 'descending';
                            sortChannel = oppositeChannel;
                            sortField = oppositeEncoding?.field;
                            sortFieldType = oppositeEncoding?.type;
                        } else if (typeof enc.sort === 'string' &&
                            (enc.sort === '-y' || enc.sort === '-x' || enc.sort === '-color' ||
                             enc.sort === 'y' || enc.sort === 'x' || enc.sort === 'color')) {
                            isDescending = enc.sort.startsWith('-');
                            sortChannel = isDescending ? enc.sort.substring(1) : enc.sort;
                            if (sortChannel) {
                                sortField = vgObj.encoding?.[sortChannel]?.field;
                                sortFieldType = vgObj.encoding?.[sortChannel]?.type;
                            }
                        }
                    } else {
                        // For rect marks (heatmaps), color is the primary value channel —
                        // don't auto-sort by it.  For other marks, sorting by a quantitative
                        // color can help surface the most important items.
                        if (markType !== 'rect' && colorEncoding?.field && colorEncoding.type === 'quantitative') {
                            sortChannel = 'color';
                            sortField = colorEncoding.field;
                            sortFieldType = colorEncoding.type;
                        } else if (oppositeEncoding?.type === 'quantitative') {
                            sortChannel = oppositeChannel;
                            sortField = oppositeEncoding.field;
                            sortFieldType = oppositeEncoding.type;
                        } else {
                            isDescending = false;
                        }
                    }

                    // Connected marks (line/area/trail) need chronological/natural
                    // order preserved — skip aggregate-based sorting for them.
                    if (!hasConnectedMark &&
                        sortField != undefined && sortChannel != undefined && sortFieldType === 'quantitative') {

                        // Bar marks typically stack values, so SUM gives the
                        // true visual height for picking the top-N items.
                        // Other marks use MAX.
                        let aggregateOp = Math.max;
                        let initialValue = -Infinity;
                        if (allMarkTypes.has('bar') && sortChannel !== 'color') {
                            aggregateOp = (x: number, y: number) => x + y;
                            initialValue = 0;
                        }

                        const valueAggregates = new Map<string, number>();
                        for (const row of data) {
                            const fieldValue = row[fieldName];
                            const sortValue = row[sortField as keyof typeof row] || 0;
                            if (valueAggregates.has(fieldValue)) {
                                valueAggregates.set(fieldValue, aggregateOp(valueAggregates.get(fieldValue)!, sortValue));
                            } else {
                                valueAggregates.set(fieldValue, aggregateOp(initialValue, sortValue));
                            }
                        }

                        const valueSortPairs = Array.from(valueAggregates.entries()).map(([value, sortValue]) => ({
                            value, sortValue,
                        }));

                        const compareFn = (a: { value: string; sortValue: number }, b: { value: string; sortValue: number }) =>
                            isDescending ? b.sortValue - a.sortValue : a.sortValue - b.sortValue;

                        valuesToKeep = valueSortPairs
                            .sort(compareFn)
                            .slice(0, maxNominalValuesToKeep)
                            .map(v => v.value);
                    } else {
                        if (typeof enc.sort === 'string' &&
                            (enc.sort === 'descending' || enc.sort === `-${channel}`)) {
                            valuesToKeep = uniqueValues.reverse().slice(0, maxNominalValuesToKeep);
                        } else {
                            valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                        }
                    }
                } else {
                    valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                }

                const omittedCount = uniqueValues.length - valuesToKeep.length;
                warnings.push({
                    severity: 'warning',
                    code: 'overflow',
                    message: `${omittedCount} of ${uniqueValues.length} values in '${fieldName}' were omitted (showing top ${valuesToKeep.length}).`,
                    channel,
                    field: fieldName,
                });
                const placeholder = `...${omittedCount} items omitted`;
                if (channel !== 'color') {
                    values = values.filter((row: any) => valuesToKeep.includes(row[fieldName]));
                }

                if (!enc.axis) enc.axis = {};
                enc.axis.labelColor = {
                    condition: {
                        test: `datum.label == '${placeholder}'`,
                        value: "#999999",
                    },
                    value: "#000000",
                };

                if (channel === 'x' || channel === 'y') {
                    if (!enc.scale) enc.scale = {};
                    enc.scale.domain = [...valuesToKeep, placeholder];
                } else if (channel === 'color') {
                    if (!enc.legend) enc.legend = {};
                    enc.legend.values = [...valuesToKeep, placeholder];
                }
            }
        }
    }

    // --- Facet layout ---
    // --- Detect x/y discrete counts inside layer encodings for layered specs ---
    // The nominalCount loop above only checks vgObj.encoding, but layered specs
    // put x/y in layer[*].encoding. Scan layers so facet subplot sizing is correct.
    if (vgObj.layer && Array.isArray(vgObj.layer)) {
        for (const axis of ['x', 'y'] as const) {
            if (nominalCount[axis] === 0) {
                // Check first layer that has this axis
                for (const layer of vgObj.layer) {
                    const enc = layer.encoding?.[axis];
                    if (enc?.field && isDiscreteType(enc.type)) {
                        const uniqueValues = [...new Set(values.map((r: any) => r[enc.field]))];
                        nominalCount[axis] = uniqueValues.length;
                        break;
                    }
                }
            }
        }
    }

    if (vgObj.encoding?.column != undefined && vgObj.encoding?.row == undefined) {
        vgObj.encoding.facet = vgObj.encoding.column;

        let xDiscreteCount = nominalCount.x;
        if (nominalCount.xOffset > 0) {
            xDiscreteCount = nominalCount.x * nominalCount.xOffset;
        }

        // For wrapping decisions, continuous axes need a larger minimum
        // subplot width than discrete axes — a 60px scatter plot is
        // unreadable. Use a fraction of the base canvas width as the
        // minimum readable size for continuous subplots.
        const minReadableSubplot = Math.max(minSubplotVal, Math.round(defaultChartWidth * 0.25));
        const minSubplotWidth = xDiscreteCount > 0
            ? Math.max(minSubplotVal, xDiscreteCount * minStepVal)
            : minReadableSubplot;

        const maxTotalWidth = facetMaxStretchVal * defaultChartWidth;
        const maxColsByWidth = Math.max(1, Math.floor(maxTotalWidth / minSubplotWidth));
        const facetCount = nominalCount.column || 1;

        // Balanced wrapping: prefer fewer rows first, then balance columns
        // within that row count. Strategy:
        //   1. Find the minimum number of rows: ceil(N / maxColsByWidth)
        //   2. Given that row count, pick the smallest number of columns
        //      that still fits: ceil(N / numRows)
        //   This maximizes subplot width while keeping the grid compact.
        let numCols: number;
        if (facetCount <= maxColsByWidth) {
            // All fit in one row — no wrapping needed
            numCols = facetCount;
        } else {
            const minRows = Math.ceil(facetCount / maxColsByWidth);
            // Balance: use just enough columns to fill minRows rows evenly
            numCols = Math.ceil(facetCount / minRows);
        }

        vgObj.encoding.facet.columns = numCols;

        const numRows = Math.ceil(facetCount / numCols);

        // For wrapped facets with multiple rows, keep axes independent
        // (each subplot retains its own tick labels for readability) but
        // suppress the per-subplot axis titles — the facet header already
        // identifies each subplot, so repeating "Category" etc. is clutter.
        if (numRows >= 2) {
            const encTarget = vgObj.encoding;
            if (encTarget?.x) {
                if (!encTarget.x.axis) encTarget.x.axis = {};
                encTarget.x.axis.title = null;
            }
            if (encTarget?.y) {
                if (!encTarget.y.axis) encTarget.y.axis = {};
                encTarget.y.axis.title = null;
            }
        }

        delete vgObj.encoding.column;

        // For layered specs, VL doesn't support encoding.facet inline —
        // restructure to top-level facet + spec pattern.
        if (vgObj.layer && Array.isArray(vgObj.layer)) {
            const facetDef = { ...vgObj.encoding.facet };
            delete vgObj.encoding.facet;

            // Move layer + encoding into a nested spec
            vgObj.facet = facetDef;
            vgObj.spec = {
                layer: vgObj.layer,
                encoding: vgObj.encoding,
            };
            delete vgObj.layer;
            delete vgObj.encoding;
        }
    }

    // For layered specs with row-only or column+row facets, VL needs the
    // outer facet + spec structure. encoding.column/row don't work inline
    // on specs with a layer property.
    if (vgObj.layer && Array.isArray(vgObj.layer) &&
        (vgObj.encoding?.column || vgObj.encoding?.row)) {
        const facetDef: any = {};
        if (vgObj.encoding.column) {
            facetDef.column = vgObj.encoding.column;
            delete vgObj.encoding.column;
        }
        if (vgObj.encoding.row) {
            facetDef.row = vgObj.encoding.row;
            delete vgObj.encoding.row;
        }
        vgObj.facet = facetDef;
        vgObj.spec = {
            layer: vgObj.layer,
            encoding: vgObj.encoding,
        };
        delete vgObj.layer;
        delete vgObj.encoding;
    }

    // --- Compute facet grid dimensions ---
    let facetCols = 1;
    let facetRows = 1;

    // Check both inline encoding.facet (non-layered) and top-level facet (layered wrapped)
    const wrappedFacet = vgObj.encoding?.facet || (vgObj.facet && !vgObj.facet.column && !vgObj.facet.row ? vgObj.facet : null);
    if (wrappedFacet) {
        const layoutCols = wrappedFacet.columns || 1;
        const totalFacetValues = nominalCount.column || 1;
        facetCols = Math.min(layoutCols, totalFacetValues);
        facetRows = Math.ceil(totalFacetValues / layoutCols);
    }
    // Non-layered inline column/row or layered column+row via vgObj.facet.column/row
    if (vgObj.encoding?.column || vgObj.facet?.column) {
        facetCols = nominalCount.column || 1;
    }
    if (vgObj.encoding?.row || vgObj.facet?.row) {
        facetRows = nominalCount.row || 1;
    }

    const totalFacets = facetCols * facetRows;

    // --- Dynamic per-subplot sizing with elastic stretch ---
    const minContinuousSize = Math.max(10, minStepVal);

    let subplotWidth: number;
    if (facetCols > 1) {
        const stretch = Math.min(facetMaxStretchVal, Math.pow(facetCols, facetElasticityVal));
        subplotWidth = Math.round(Math.max(minContinuousSize, defaultChartWidth * stretch / facetCols));
    } else {
        subplotWidth = defaultChartWidth;
    }

    let subplotHeight: number;
    if (facetRows > 1) {
        const stretch = Math.min(facetMaxStretchVal, Math.pow(facetRows, facetElasticityVal));
        subplotHeight = Math.round(Math.max(minContinuousSize, defaultChartHeight * stretch / facetRows));
    } else {
        subplotHeight = defaultChartHeight;
    }

    // Bin quantitative facets
    for (const channel of ['facet', 'column', 'row']) {
        const enc = vgObj.encoding?.[channel];
        if (enc?.type === 'quantitative') {
            const fieldName = enc.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];
            if (uniqueValues.length > maxFacetNominalValues) {
                enc.bin = true;
            }
        }
    }

    // Total discrete items per axis
    let xTotalNominalCount = nominalCount.x;
    if (nominalCount.xOffset > 0) {
        xTotalNominalCount = nominalCount.x * nominalCount.xOffset;
    }
    let yTotalNominalCount = nominalCount.y;
    if (nominalCount.yOffset > 0) {
        yTotalNominalCount = nominalCount.y * nominalCount.yOffset;
    }

    // --- Count banded continuous axes ---
    // Two sources of banded continuous axes:
    // 1. Template-declared: axisFlags.banded (bars, rects, boxplots on
    //    continuous scales).
    // 2. Binned axes: enc.bin automatically implies banded — each bin
    //    acts as a discrete band regardless of axisFlags.
    //
    // Banded continuous axes get elastic stretch via subplotWidth/Height
    // but NOT VL's step-based layout (which only works for nominal/ordinal).
    // Non-banded axes (scatter, line, area) don't need per-position sizing.
    const xBanded = buildContext.axisFlags?.x?.banded ?? false;
    const yBanded = buildContext.axisFlags?.y?.banded ?? false;

    let xContinuousAsDiscrete = 0;
    let yContinuousAsDiscrete = 0;
    for (const axis of ['x', 'y'] as const) {
        const enc = vgObj.encoding?.[axis];
        if (!enc?.field) continue;
        if (isDiscreteType(enc.type)) continue;   // already counted in nominalCount
        if (enc.aggregate) continue;

        const isBanded = (axis === 'x' ? xBanded : yBanded) || !!enc.bin;
        if (!isBanded) continue;

        let count: number;
        if (enc.bin) {
            // Binned axis — discrete count is the number of bins.
            count = typeof enc.bin === 'object' && enc.bin.maxbins
                ? enc.bin.maxbins : 6;
        } else {
            // Temporal or quantitative used as banded dimension
            count = new Set(values.map((r: any) => r[enc.field])).size;
        }
        if (count <= 1) continue;

        if (axis === 'x') {
            xContinuousAsDiscrete = count;
        } else {
            yContinuousAsDiscrete = count;
        }
    }

    // Independent y-axis scaling for faceted charts with vastly different ranges
    // For layered specs, encodings may be on vgObj.spec.encoding or vgObj.encoding
    const effectiveEncoding = vgObj.spec?.encoding || vgObj.encoding;
    const effectiveFacet = vgObj.facet || vgObj.encoding?.facet;
    if (effectiveFacet != undefined && effectiveEncoding?.y?.type === 'quantitative') {
        const yField = effectiveEncoding.y.field;
        const columnField = effectiveFacet.field;

        if (yField && columnField) {
            const columnGroups = new Map<any, number>();
            for (const row of data) {
                const columnValue = row[columnField];
                const yValue = row[yField];
                if (yValue != null && !isNaN(yValue)) {
                    const currentMax = columnGroups.get(columnValue) || 0;
                    columnGroups.set(columnValue, Math.max(currentMax, Math.abs(yValue)));
                }
            }

            const maxValues = Array.from(columnGroups.values()).filter(v => v > 0);
            if (maxValues.length >= 2) {
                const maxValue = Math.max(...maxValues);
                const minValue = Math.min(...maxValues);
                const ratio = maxValue / minValue;
                if (ratio >= 100 && totalFacets < 6) {
                    if (!vgObj.resolve) vgObj.resolve = {};
                    if (!vgObj.resolve.scale) vgObj.resolve.scale = {};
                    vgObj.resolve.scale.y = "independent";
                }
            }
        }
    }

    // --- Helper: count distinct series (color/detail categories) ---
    const countDistinctSeries = (spec: any, data: any[]): number => {
        const seriesFields: string[] = [];
        const colorField = (spec.encoding?.color as any)?.field;
        const detailField = (spec.encoding?.detail as any)?.field;
        if (colorField) seriesFields.push(colorField);
        if (detailField && detailField !== colorField) seriesFields.push(detailField);

        if (seriesFields.length === 0) return 1; // single series

        const seriesKeys = new Set<string>();
        for (const row of data) {
            const key = seriesFields.map(f => String(row[f] ?? '')).join('\x00');
            seriesKeys.add(key);
        }
        return seriesKeys.size;
    };

    // --- Gas pressure stretch for non-banded continuous axes (§2) ---
    // When both x and y are continuous and non-banded (e.g. scatter plot),
    // compute density-aware stretch using the gas pressure model.
    const xIsContinuousNonBanded = xTotalNominalCount === 0 && xContinuousAsDiscrete === 0;
    const yIsContinuousNonBanded = yTotalNominalCount === 0 && yContinuousAsDiscrete === 0;

    let gasPressureResult: GasPressureDecision | null = null;

    if (xIsContinuousNonBanded && yIsContinuousNonBanded) {
        // Both axes are continuous — run gas pressure model on the 2D point cloud
        const xEnc = vgObj.encoding?.x;
        const yEnc = vgObj.encoding?.y;

        if (xEnc?.field && yEnc?.field) {
            const isTempX = xEnc.type === 'temporal';
            const isTempY = yEnc.type === 'temporal';

            const xNumeric: number[] = [];
            const yNumeric: number[] = [];
            for (const row of values) {
                let xv = row[xEnc.field];
                let yv = row[yEnc.field];
                if (xv == null || yv == null) continue;
                if (isTempX) xv = +new Date(xv);
                else xv = +xv;
                if (isTempY) yv = +new Date(yv);
                else yv = +yv;
                if (isNaN(xv) || isNaN(yv)) continue;
                xNumeric.push(xv);
                yNumeric.push(yv);
            }

            if (xNumeric.length > 1) {
                const xMin = Math.min(...xNumeric);
                const xMax = Math.max(...xNumeric);
                const yMin = Math.min(...yNumeric);
                const yMax = Math.max(...yNumeric);

                // Use axis domain if available (e.g. zero-based), else data extent
                const xDomain: [number, number] = xEnc.scale?.domain
                    ? [+xEnc.scale.domain[0], +xEnc.scale.domain[1]]
                    : [xMin, xMax];
                const yDomain: [number, number] = yEnc.scale?.domain
                    ? [+yEnc.scale.domain[0], +yEnc.scale.domain[1]]
                    : [yMin, yMax];

                let gasPressureParams = DEFAULT_GAS_PRESSURE_PARAMS;
                if (continuousMarkCrossSection != null) {
                    if (typeof continuousMarkCrossSection === 'number') {
                        gasPressureParams = { ...DEFAULT_GAS_PRESSURE_PARAMS, markCrossSection: continuousMarkCrossSection };
                    } else {
                        // Per-axis: use max for global pressure, individual for per-axis stretch
                        const maxCS = Math.max(continuousMarkCrossSection.x, continuousMarkCrossSection.y);
                        gasPressureParams = {
                            ...DEFAULT_GAS_PRESSURE_PARAMS,
                            markCrossSection: maxCS,
                            markCrossSectionX: continuousMarkCrossSection.x,
                            markCrossSectionY: continuousMarkCrossSection.y,
                            ...(continuousMarkCrossSection.elasticity != null && { elasticity: continuousMarkCrossSection.elasticity }),
                            ...(continuousMarkCrossSection.maxStretch != null && { maxStretch: continuousMarkCrossSection.maxStretch }),
                        };

                        // Series-count-based pressure: count distinct color/detail categories
                        // and assign to the appropriate axis.
                        if (continuousMarkCrossSection.seriesCountAxis) {
                            const resolvedAxis = continuousMarkCrossSection.seriesCountAxis === 'auto'
                                ? 'y'  // In 2D (both continuous), default series axis is Y
                                : continuousMarkCrossSection.seriesCountAxis;

                            const nSeries = countDistinctSeries(vgObj, values);
                            if (resolvedAxis === 'y') {
                                gasPressureParams.yItemCountOverride = nSeries;
                            } else {
                                gasPressureParams.xItemCountOverride = nSeries;
                            }
                        }
                    }
                }

                gasPressureResult = computeGasPressure(
                    xNumeric, yNumeric,
                    xDomain, yDomain,
                    subplotWidth, subplotHeight,
                    gasPressureParams,
                );

                if (gasPressureResult.stretchX > 1 || gasPressureResult.stretchY > 1) {
                    let sx = gasPressureResult.stretchX;
                    let sy = gasPressureResult.stretchY;
                    if (maintainContinuousAxisRatio) {
                        const maxStretch = Math.max(sx, sy);
                        sx = maxStretch;
                        sy = maxStretch;
                    }
                    // For series-based pressure: stretching the positional axis
                    // also reduces visual overlap. Ensure the non-series axis
                    // stretches at least as much as the series axis.
                    if (typeof continuousMarkCrossSection === 'object' &&
                        continuousMarkCrossSection.seriesCountAxis) {
                        const sAxis = continuousMarkCrossSection.seriesCountAxis === 'auto'
                            ? 'y' : continuousMarkCrossSection.seriesCountAxis;
                        if (sAxis === 'y' && sy > 1 && sx < sy) sx = sy;
                        if (sAxis === 'x' && sx > 1 && sy < sx) sy = sx;
                    }
                    subplotWidth = Math.round(subplotWidth * sx);
                    subplotHeight = Math.round(subplotHeight * sy);
                }
            }
        }
    } else if (xIsContinuousNonBanded || yIsContinuousNonBanded) {
        // One axis continuous, one discrete.
        // Two modes:
        //   1. Series-based: stretch the continuous axis based on series count
        //      (e.g. stacked bar — each stacked segment needs min height).
        //   2. Positional: stretch based on point count / unique positions
        //      (only when the continuous axis is positional, not a measure).
        const contAxis = xIsContinuousNonBanded ? 'x' : 'y';
        const otherAxisHasDiscreteItems = contAxis === 'x'
            ? (yTotalNominalCount > 0 || yContinuousAsDiscrete > 0)
            : (xTotalNominalCount > 0 || xContinuousAsDiscrete > 0);

        // Check if series-based stretch is configured for this axis
        let seriesStretchApplied = false;
        if (typeof continuousMarkCrossSection === 'object' && continuousMarkCrossSection.seriesCountAxis) {
            const resolvedAxis = continuousMarkCrossSection.seriesCountAxis === 'auto'
                ? contAxis  // In 1D, 'auto' → the continuous axis
                : continuousMarkCrossSection.seriesCountAxis;

            if (resolvedAxis === contAxis) {
                // Series-based stretch on the continuous axis
                const sigmaPerSeries = contAxis === 'x'
                    ? continuousMarkCrossSection.x
                    : continuousMarkCrossSection.y;
                const baseDim = contAxis === 'x' ? subplotWidth : subplotHeight;
                const nSeries = countDistinctSeries(vgObj, values);
                const pressure = (nSeries * sigmaPerSeries) / baseDim;

                const elast = continuousMarkCrossSection.elasticity ?? DEFAULT_GAS_PRESSURE_PARAMS.elasticity;
                const maxS = continuousMarkCrossSection.maxStretch ?? DEFAULT_GAS_PRESSURE_PARAMS.maxStretch;

                if (pressure > 1) {
                    const stretch = Math.min(maxS, Math.pow(pressure, elast));
                    if (contAxis === 'x') {
                        subplotWidth = Math.round(subplotWidth * stretch);
                    } else {
                        subplotHeight = Math.round(subplotHeight * stretch);
                    }
                }
                seriesStretchApplied = true;
            }
        }

        // Fallback: positional 1D stretch (only when no series stretch and
        // the continuous axis is positional, not a pure measure).
        if (!seriesStretchApplied && !otherAxisHasDiscreteItems) {
            const contEnc = vgObj.encoding?.[contAxis];
            if (contEnc?.field) {
                const isTemporal = contEnc.type === 'temporal';
                const contValues: number[] = [];
                for (const row of values) {
                    let v = row[contEnc.field];
                    if (v == null) continue;
                    if (isTemporal) v = +new Date(v);
                    else v = +v;
                    if (!isNaN(v)) contValues.push(v);
                }
                const sigma1d = Math.sqrt(DEFAULT_GAS_PRESSURE_PARAMS.markCrossSection);
                const baseDim = contAxis === 'x' ? subplotWidth : subplotHeight;
                const pressure1d = (contValues.length * sigma1d) / baseDim;
                if (pressure1d > 1) {
                    const stretch1d = Math.min(
                        DEFAULT_GAS_PRESSURE_PARAMS.maxStretch,
                        Math.pow(pressure1d, DEFAULT_GAS_PRESSURE_PARAMS.elasticity),
                    );
                    if (contAxis === 'x') {
                        subplotWidth = Math.round(subplotWidth * stretch1d);
                    } else {
                        subplotHeight = Math.round(subplotHeight * stretch1d);
                    }
                }
            }
        }
    }

    // --- Elastic stretch for discrete axes ---
    // Use reusable decision functions from decisions.ts
    const elasticParams: ElasticStretchParams = {
        elasticity: elasticityVal,
        maxStretch: maxStretchVal,
        defaultStepSize,
        minStep: minStepVal,
    };

    const xAxis = computeAxisStep(xTotalNominalCount, xContinuousAsDiscrete, subplotWidth, elasticParams);
    const yAxis = computeAxisStep(yTotalNominalCount, yContinuousAsDiscrete, subplotHeight, elasticParams);

    // Per-axis step sizes for VL step-based layout.
    // Only nominal/ordinal axes use VL's {step: N} layout.
    // Banded continuous axes (binned, temporal, quantitative) get elastic
    // stretch via Phase 1 subplotWidth/Height and mark sizing via postProcessing,
    // but NOT step-based layout — VL rejects {step: N} on continuous scales.
    const xIsDiscrete = xTotalNominalCount > 0;
    const yIsDiscrete = yTotalNominalCount > 0;

    // Grouped bar chart: compute step at the group level using
    // "width"/"height": {"step": N, "for": "position"} so each group
    // (not each sub-bar) is the unit of elastic squeeze.
    const xHasOffset = nominalCount.xOffset > 0;
    const yHasOffset = nominalCount.yOffset > 0;

    let xStepSize: number;
    let yStepSize: number;
    let xStepFor: string | undefined;
    let yStepFor: string | undefined;

    if (xIsDiscrete && xHasOffset) {
        // Grouped X: squeeze at group level (nominalCount.x groups)
        const itemsPerGroup = nominalCount.xOffset;
        const defaultGroupStep = itemsPerGroup * defaultStepSize;
        const minGroupStep = 2 * itemsPerGroup;
        const groupAxis = computeAxisStep(nominalCount.x, 0, subplotWidth, elasticParams);
        // Apply elastic budget at group level, then clamp
        const groupStep = Math.max(minGroupStep, Math.min(defaultGroupStep, groupAxis.step));
        xStepSize = groupStep;
        xStepFor = 'position';
    } else if (xIsDiscrete) {
        xStepSize = Math.max(minStepVal, Math.min(defaultStepSize, xAxis.step));
    } else if (xContinuousAsDiscrete > 0) {
        // Continuous + banded: compute step using discrete approach
        // so effective step drives continuousWidth below.
        xStepSize = Math.max(minStepVal, Math.min(defaultStepSize, xAxis.step));
    } else {
        xStepSize = defaultStepSize;
    }

    if (yIsDiscrete && yHasOffset) {
        // Grouped Y: squeeze at group level (nominalCount.y groups)
        const itemsPerGroup = nominalCount.yOffset;
        const defaultGroupStep = itemsPerGroup * defaultStepSize;
        const minGroupStep = 2 * itemsPerGroup;
        const groupAxis = computeAxisStep(nominalCount.y, 0, subplotHeight, elasticParams);
        const groupStep = Math.max(minGroupStep, Math.min(defaultGroupStep, groupAxis.step));
        yStepSize = groupStep;
        yStepFor = 'position';
    } else if (yIsDiscrete) {
        yStepSize = Math.max(minStepVal, Math.min(defaultStepSize, yAxis.step));
    } else if (yContinuousAsDiscrete > 0) {
        // Continuous + banded: compute step using discrete approach
        // so effective step drives continuousHeight below.
        yStepSize = Math.max(minStepVal, Math.min(defaultStepSize, yAxis.step));
    } else {
        yStepSize = defaultStepSize;
    }

    // --- Phase 1: Axis compression (universal, mark-agnostic) ---
    // For continuous-as-discrete (banded) axes, compute the canvas size
    // from the effective step × item count, mirroring how VL's {step: N}
    // works for truly discrete axes.  An extra step is added (half on each
    // side) so marks aren't flush against the axis edges.
    // Mark-specific sizing happens in Phase 2 below.
    for (const axis of ['x', 'y'] as const) {
        const count = axis === 'x' ? xContinuousAsDiscrete : yContinuousAsDiscrete;
        if (count <= 0) continue;
        const stepSize = axis === 'x' ? xStepSize : yStepSize;
        // count steps for the items + 1 extra step for half-step padding on each side
        const continuousSize = Math.round(stepSize * (count + 1));
        if (axis === 'x') {
            subplotWidth = continuousSize;
        } else {
            subplotHeight = continuousSize;
        }

        // Set scale padding so VL extends the domain by half a step on
        // each side, matching the extra canvas budget we just added.
        const enc = vgObj.encoding?.[axis];
        if (enc) {
            if (!enc.scale) enc.scale = {};
            enc.scale.nice = false;

            // Compute data-space extent and derive padding in data units.
            // Handle both numeric and temporal (date string) values.
            const isTemporal = enc.type === 'temporal';
            const numericVals = values
                .map((r: any) => {
                    const raw = r[enc.field];
                    if (raw == null) return NaN;
                    if (isTemporal) return +new Date(raw);
                    return +raw;
                })
                .filter((v: number) => !isNaN(v));
            if (numericVals.length > 1) {
                const minVal = Math.min(...numericVals);
                const maxVal = Math.max(...numericVals);
                const dataRange = maxVal - minVal;
                // Actual spacing between consecutive items = dataRange / (count - 1)
                const halfStep = dataRange / (count - 1) / 2;
                if (isTemporal) {
                    enc.scale.domain = [
                        new Date(minVal - halfStep).toISOString(),
                        new Date(maxVal + halfStep).toISOString(),
                    ];
                } else {
                    enc.scale.domain = [minVal - halfStep, maxVal + halfStep];
                }
            }
        }
    }

    // Effective step per axis (covers both nominal and continuous-as-discrete)
    const xEffStep = xStepSize;
    const yEffStep = yStepSize;

    // Dynamic label sizing — use reusable decision function
    const xHasDiscreteItems = xTotalNominalCount > 0;
    const yHasDiscreteItems = yTotalNominalCount > 0;

    const xLabelDecision = computeLabelSizing(xEffStep, xHasDiscreteItems);
    const yLabelDecision = computeLabelSizing(yEffStep, yHasDiscreteItems);

    const axisXConfig: Record<string, any> = {
        labelLimit: xLabelDecision.labelLimit,
        labelFontSize: xLabelDecision.fontSize,
    };
    if (xLabelDecision.labelAngle !== undefined) {
        axisXConfig.labelAngle = xLabelDecision.labelAngle;
        axisXConfig.labelAlign = xLabelDecision.labelAlign;
        axisXConfig.labelBaseline = xLabelDecision.labelBaseline;
    }
    const axisYConfig: Record<string, any> = { labelFontSize: yLabelDecision.fontSize };

    vgObj.config = {
        view: {
            continuousWidth: subplotWidth,
            continuousHeight: subplotHeight,
            // Hide view border for buildEncodings-owned specs (e.g. radar)
            ...(!vgObj.encoding && { stroke: null }),
        },
        axisX: axisXConfig,
        axisY: axisYConfig,
    };

    // Set per-axis step-based sizing for discrete axes.
    // Use width: {step: N} / height: {step: N} directly on the spec
    // so each axis gets its own step independently.
    // For grouped bars, use {step: N, for: "position"} so the step
    // controls the group width rather than individual sub-bars.
    if (xIsDiscrete && typeof vgObj.width !== 'number') {
        vgObj.width = xStepFor ? { step: xStepSize, for: xStepFor } : { step: xStepSize };
    }
    if (yIsDiscrete && typeof vgObj.height !== 'number') {
        vgObj.height = yStepFor ? { step: yStepSize, for: yStepFor } : { step: yStepSize };
    }

    // Sync hardcoded template width/height to config.view
    if (typeof vgObj.width === 'number') {
        vgObj.config.view.continuousWidth = vgObj.width;
    } else if (vgObj.width && typeof vgObj.width === 'object' && 'step' in vgObj.width) {
        // buildEncodings set a step-based width (e.g. strip plot jitter).
        // Override the step with the assembler's computed step size so
        // elastic stretch and overflow work correctly.
        vgObj.width = xStepFor ? { step: xStepSize, for: xStepFor } : { step: xStepSize };
    }
    if (typeof vgObj.height === 'number') {
        vgObj.config.view.continuousHeight = vgObj.height;
    } else if (vgObj.height && typeof vgObj.height === 'object' && 'step' in vgObj.height) {
        vgObj.height = yStepFor ? { step: yStepSize, for: yStepFor } : { step: yStepSize };
    }

    if (totalFacets > 6) {
        vgObj.config.header = { labelLimit: 120, labelFontSize: 9 };
    }

    // Reduce clutter in faceted charts when subplots are compressed.
    // Hide per-facet axis titles when the subplot dimension shrinks below
    // a threshold — repeated titles waste space on small panels.
    // For layered specs, encoding may be nested under vgObj.spec.encoding
    const encTarget = vgObj.spec?.encoding || vgObj.encoding;
    const yTitleThreshold = 100;   // hide Y title when subplot height < this
    const xTitleThreshold = 100;   // hide X title when subplot width < this

    if (facetRows > 1 && subplotHeight < yTitleThreshold) {
        // Suppress via config (covers independent-scale facets)
        if (vgObj.config?.axisY) {
            vgObj.config.axisY.title = null;
        }
        // Also suppress via encoding (covers shared-scale facets)
        if (encTarget) {
            if (!encTarget.y?.axis) {
                if (encTarget.y) encTarget.y.axis = {};
            }
            if (encTarget.y?.axis !== undefined) {
                encTarget.y.axis.title = null;
            }
        }
    }
    // For column facets, X-axis title is shared (appears once at the bottom),
    // so only suppress it when rows also facet and the title would repeat.
    if (facetCols > 1 && facetRows > 1 && subplotWidth < xTitleThreshold) {
        if (vgObj.config?.axisX) {
            vgObj.config.axisX.title = null;
        }
        if (encTarget) {
            if (!encTarget.x?.axis) {
                if (encTarget.x) encTarget.x.axis = {};
            }
            if (encTarget.x?.axis !== undefined) {
                encTarget.x.axis.title = null;
            }
        }
    }

    if (addTooltips) {
        if (!vgObj.config) vgObj.config = {};
        vgObj.config.mark = { ...vgObj.config.mark, tooltip: true };
    }

    // --- Phase 2: Mark-specific sizing (delegated to templates) ---
    if (chartTemplate.postProcessing) {
        buildContext.inferredProperties = {
            xStepSize,
            yStepSize,
            subplotWidth,
            subplotHeight,
            xContinuousAsDiscrete,
            yContinuousAsDiscrete,
            xNominalCount: xTotalNominalCount,
            yNominalCount: yTotalNominalCount,
        };
        chartTemplate.postProcessing(vgObj, buildContext);
    }

    // --- Attach warnings ---
    const result: any = { ...vgObj, data: { values } };
    if (warnings.length > 0) {
        result._warnings = warnings;
    }
    return result;
}
