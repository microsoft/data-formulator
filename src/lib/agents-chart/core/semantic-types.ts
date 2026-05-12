// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getRegistryEntry, getRegisteredTypes, isRegistered, type VisCategory } from './type-registry';
export type { VisCategory } from './type-registry';

/**
 * =============================================================================
 * SEMANTIC TYPE SYSTEM
 * =============================================================================
 * 
 * Semantic types classify data fields for intelligent chart recommendations.
 * Uses strings for flexibility and easy JSON serialization.
 * 
 * DESIGN GOALS:
 * 1. Comprehensive: Cover common data types seen in real-world datasets
 * 2. Visualization-aware: Map to Vega-Lite encoding types (Q, O, N, T)
 * 3. Hierarchical: Support generalization via lattice structure
 * 4. Simple: Use strings with helper functions, no complex enums
 * 
 * =============================================================================
 * SEMANTIC TYPE LATTICE
 * =============================================================================
 * 
 *                           ┌─────────────┐
 *                           │   AnyType   │
 *                           └──────┬──────┘
 *            ┌────────────────────┼────────────────────┐
 *            ▼                    ▼                    ▼
 *     ┌──────────┐         ┌──────────┐         ┌───────-───┐
 *     │ Temporal │         │ Numeric  │         │Categorical│
 *     └────┬─────┘         └────┬─────┘         └─────┬────┘
 *          │                    │                     │
 *    ┌─────┴─────┐        ┌─────┴─────┐         ┌─────┴─────┐
 *    │           │        │           │         │           │
 *  DateTime     Granule    Measure   Discrete    Entity     Coded
 *    │           │        │           │         │           │
 * DateTime    Year     Quantity    Rank      Category   Status
 * Date        Month    Count       Score     Name       Boolean
 * Time        Day      Price       ID                   Direction
 *             Quarter  Percentage
 *             Decade   Amount
 *                      Temperature
 * 
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// All Semantic Types (as string constants)
// ---------------------------------------------------------------------------

/**
 * All recognized semantic types.
 * Use these constants when comparing or assigning types.
 */
export const SemanticTypes = {
    // =========================================================================
    // TEMPORAL TYPES - Time-related concepts
    // =========================================================================
    
    // Point-in-time (full timestamp precision)
    DateTime: 'DateTime',       // Full date and time: "2024-01-15T14:30:00"
    Date: 'Date',               // Date only: "2024-01-15"
    Time: 'Time',               // Time only: "14:30:00"
    Timestamp: 'Timestamp',     // Unix timestamp (seconds or milliseconds since epoch)
    
    // Temporal granules (discrete time units, inherently ordered)
    Year: 'Year',               // "2024" (as a time unit, not a measure)
    Quarter: 'Quarter',         // "Q1", "Q2", "2024-Q1"
    Month: 'Month',             // "January", "Jan", 1-12
    Week: 'Week',               // "Week 1", 1-52
    Day: 'Day',                 // "Monday", "Mon", 1-31
    Hour: 'Hour',               // 0-23
    
    // Combined temporal
    YearMonth: 'YearMonth',     // "2024-01", "Jan 2024"
    YearQuarter: 'YearQuarter', // "2024-Q1"
    YearWeek: 'YearWeek',       // "2024-W01"
    Decade: 'Decade',           // "1990s", "2000s"
    
    // Temporal duration/span
    Duration: 'Duration',       // Time span: "2 hours", "3 days", milliseconds
    
    // =========================================================================
    // NUMERIC MEASURE TYPES - Continuous values for aggregation
    // =========================================================================
    
    Quantity: 'Quantity',       // Generic continuous measure
    Count: 'Count',             // Discrete count of items
    Amount: 'Amount',           // Monetary or general amounts
    Price: 'Price',             // Unit price
    Percentage: 'Percentage',   // 0-100% or 0-1 ratio
    Temperature: 'Temperature', // Degrees
    
    // Signed measures (can be positive or negative, zero has meaning)
    Profit: 'Profit',             // Gain/loss, profit/deficit
    PercentageChange: 'PercentageChange', // Growth rate, change %
    Sentiment: 'Sentiment',       // Positive/negative sentiment score
    Correlation: 'Correlation',   // Positive/negative correlation coefficient
    
    // =========================================================================
    // NUMERIC DISCRETE TYPES - Numbers with ordinal/identifier meaning
    // =========================================================================
    
    Rank: 'Rank',               // Position in ordered list: 1st, 2nd, 3rd
    ID: 'ID',                   // Unique identifier (not for aggregation!)
    Score: 'Score',             // Rating score: 1-5, 1-10, 0-100
    
    // =========================================================================
    // GEOGRAPHIC TYPES - Location-based data
    // =========================================================================
    
    Latitude: 'Latitude',       // -90 to 90
    Longitude: 'Longitude',     // -180 to 180
    Country: 'Country',         // Country name or code
    State: 'State',             // State/Province
    City: 'City',               // City name
    Region: 'Region',           // Geographic region
    Address: 'Address',         // Street address (geo lookup)
    ZipCode: 'ZipCode',         // Postal code (geo lookup)
    
    // =========================================================================
    // CATEGORICAL ENTITY TYPES - Named entities
    // =========================================================================
    
    Category: 'Category',       // Discrete category / product / entity class
    Name: 'Name',               // Generic named entity (person, company, product, etc.)
    
    // =========================================================================
    // CATEGORICAL CODED TYPES - Discrete categories/statuses
    // =========================================================================
    
    Status: 'Status',           // State: "Active", "Pending", "Closed"
    Boolean: 'Boolean',         // True/False, Yes/No
    Direction: 'Direction',     // Compass direction: "N", "NE", "East", etc.
    
    // =========================================================================
    // BINNED/RANGE TYPES - Discretized continuous values
    // =========================================================================
    
    Range: 'Range',             // Numeric range, age group, binned values
    
    // =========================================================================
    // FALLBACK TYPES
    // =========================================================================
    
    Number: 'Number',           // Generic number (measure fallback)
    Unknown: 'Unknown',         // Cannot determine type
} as const;

// Type for any semantic type string
export type SemanticType = typeof SemanticTypes[keyof typeof SemanticTypes];

// ---------------------------------------------------------------------------
// Visualization Categories  →  defined in type-registry.ts (single source of truth)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type Sets for Classification — derived from type-registry.ts
// ---------------------------------------------------------------------------

// timeseriesXTypes: REMOVED — derived from type-registry.ts via isTimeSeriesType()

/**
 * Types suitable for quantitative encoding (true continuous measures).
 *
 * Derived from the registry: aggRole ∈ {additive, intensive, signed-additive},
 * excluding Score/Rating (t1='Score') which behave as bounded ordinal scales
 * for vis purposes (e.g., 1–5 star rating). This is an intentional vis-level
 * distinction, not a mathematical one.
 */
export const measureTypes = new Set<string>(
    getRegisteredTypes().filter(t => {
        const e = getRegistryEntry(t);
        return ['additive', 'intensive', 'signed-additive'].includes(e.aggRole) && e.t1 !== 'Score';
    })
);

/** Numeric types that should NOT be used as measures (don't aggregate) */
export const nonMeasureNumericTypes = new Set<string>([
    'Rank', 'ID', 'Score',
    'Year', 'Month', 'Day', 'Hour',
    'Latitude', 'Longitude',
]);

/**
 * Types suitable for categorical color/grouping encoding.
 *
 * Derived from the registry: types that include 'nominal' in visEncodings
 * (at any position — Direction has ['ordinal','nominal']),
 * plus binned types (Range, AgeGroup) which also work as categorical for
 * color/grouping despite having 'ordinal' as their primary encoding.
 * Excludes identifiers (ID) which are nominal but not useful for grouping.
 */
export const categoricalTypes = new Set<string>(
    getRegisteredTypes().filter(t => {
        const e = getRegistryEntry(t);
        return (e.visEncodings.includes('nominal') && e.aggRole !== 'identifier') || e.t1 === 'Binned';
    })
);

/**
 * Types suitable for ordinal encoding (have inherent order).
 *
 * Derived from the registry: types whose visEncodings include 'ordinal'.
 */
export const ordinalTypes = new Set<string>(
    getRegisteredTypes().filter(t => {
        const e = getRegistryEntry(t);
        return e.visEncodings.includes('ordinal');
    })
);

// geoTypes, geoCoordinateTypes, geoLocationTypes: REMOVED — derived from type-registry.ts
// via isGeoType(), isGeoCoordinateType(), isGeoLocationString()

// ---------------------------------------------------------------------------
// Type Hierarchy — REMOVED
// ---------------------------------------------------------------------------
// The typeHierarchy map and its helper functions (getParentType,
// getAncestorTypes, isSubtypeOf) have been removed. They were unused
// externally — no consumer ever imported them.
//
// The registry's t0/t1 dimensions capture family grouping (e.g., all
// Amount types share t1='Amount'). If fine-grained parent-child lattice
// traversal is ever needed in the future, it can be rebuilt from
// type-registry.ts with an explicit `parent` field per entry.
// ---------------------------------------------------------------------------

// visCategoryMap: REMOVED — derived from type-registry.ts via getRegistryEntry().visEncodings[0]

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Get the Vega-Lite visualization category for a semantic type.
 * Derived from the registry's visEncodings[0] (primary encoding).
 * Returns null for unrecognised types so callers can fall back
 * to data-driven inference.
 */
export function getVisCategory(semanticType: string): VisCategory | null {
    // Return null for empty, 'Unknown', or any unregistered type string
    // so callers fall back to data-driven inference (inferVisCategory).
    if (!semanticType || !isRegistered(semanticType)) return null;
    return getRegistryEntry(semanticType).visEncodings[0] ?? null;
}


/**
 * Infer a VisCategory from raw data values when no semantic type is available.
 * Mirrors the DataType → VL encoding type mapping:
 *   number/integer → quantitative, boolean → nominal, date → temporal, string → nominal.
 */
export function inferVisCategory(values: any[]): VisCategory {
    if (values.length === 0) return 'nominal';
    const isBoolean = (v: any) => v === true || v === false || Object.prototype.toString.call(v) === '[object Boolean]';
    const isNumber = (v: any) => !isNaN(+v) && !(Object.prototype.toString.call(v) === '[object Date]');
    // Date.parse is too permissive in V8 — "FY 2018", "hello world 2018" all parse.
    // Require the string to start with a digit or a known month-name prefix.
    const looksLikeDate = (s: string) => /^\d|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s.trim());
    const isDate = (v: any) => {
        if (v instanceof Date) return !isNaN(v.getTime());
        if (typeof v === 'string') return looksLikeDate(v) && !isNaN(Date.parse(v));
        return !isNaN(Date.parse(v));
    };
    const nonNull = values.filter(v => v != null);
    if (nonNull.length === 0) return 'nominal';
    if (nonNull.every(isBoolean)) return 'nominal';
    if (nonNull.every(isNumber)) return 'quantitative';
    if (nonNull.every(isDate)) return 'temporal';
    return 'nominal';
}

/**
 * Check if a semantic type is a true measure (suitable for quantitative encoding).
 */
export function isMeasureType(semanticType: string): boolean {
    return measureTypes.has(semanticType);
}

/**
 * Check if a semantic type is suitable for time-series X axis.
 * Derived from type-registry: t0 === 'Temporal' but not Duration.
 */
export function isTimeSeriesType(semanticType: string): boolean {
    const entry = getRegistryEntry(semanticType);
    return entry.t0 === 'Temporal' && entry.t1 !== 'Duration';
}

/**
 * Check if a semantic type is categorical (suitable for color/grouping).
 */
export function isCategoricalType(semanticType: string): boolean {
    return categoricalTypes.has(semanticType);
}

/**
 * Check if a semantic type is ordinal (has inherent order).
 */
export function isOrdinalType(semanticType: string): boolean {
    return ordinalTypes.has(semanticType);
}

/**
 * Check if a semantic type is geographic.
 * Derived from type-registry: t0 === 'Geographic'.
 */
export function isGeoType(semanticType: string): boolean {
    return getRegistryEntry(semanticType).t0 === 'Geographic';
}

/**
 * Check if a semantic type is a geographic coordinate (lat/lon).
 * Derived from type-registry: t1 === 'GeoCoordinate'.
 */
export function isGeoCoordinateType(semanticType: string): boolean {
    return getRegistryEntry(semanticType).t1 === 'GeoCoordinate';
}

/**
 * Check if a semantic type is a named geographic location.
 * Derived from type-registry: t1 === 'GeoPlace'.
 */
export function isGeoLocationString(semanticType: string): boolean {
    return getRegistryEntry(semanticType).t1 === 'GeoPlace';
}

/**
 * Check if a semantic type is numeric but should not be aggregated.
 */
export function isNonMeasureNumeric(semanticType: string): boolean {
    return nonMeasureNumericTypes.has(semanticType);
}

// ---------------------------------------------------------------------------
// Zero-Baseline Classification  →  data lives in type-registry.ts (zeroBaseline, zeroPad)
// ---------------------------------------------------------------------------

/**
 * Classification of whether zero is a meaningful baseline for a semantic type.
 *
 * - `meaningful`: 0 has a real-world interpretation (absence of the measured thing).
 *   Comparisons to zero and ratios between values are meaningful.
 *   Examples: Count, Revenue, Distance, Weight.
 *
 * - `arbitrary`: 0 is either meaningless, doesn't exist, or is an arbitrary
 *   reference point. The data's range is what matters.
 *   Examples: Temperature (0°F is arbitrary), Year (year 0 doesn't exist),
 *   Rank (0th place doesn't exist).
 *
 * - `contextual`: 0 is meaningful but data-fitting may be better when data
 *   is concentrated far from zero and the mark is not bar/area.
 *   Examples: Percentage (0–100% natural, but 48–52% benefits from zoom),
 *   Score (1–5 scale, but 4.2–4.8 benefits from zoom).
 */
export type ZeroClass = 'meaningful' | 'arbitrary' | 'contextual';

/**
 * Result of the zero-baseline decision.
 * Encapsulates both the boolean decision and domain padding for non-zero axes.
 */
export interface ZeroDecision {
    /** Whether the axis should include zero */
    zero: boolean;
    /**
     * For non-zero axes: fraction of data range to pad on each side
     * so edge values aren't crushed against the axis boundary.
     * e.g. 0.05 = 5% padding on each side.
     */
    domainPadFraction: number;
    /** The zero class that drove this decision */
    zeroClass: ZeroClass | 'unknown';
}

// zeroMeaningfulTypes, zeroArbitraryTypes, zeroContextualTypes, zeroPadMap:
// REMOVED — now stored as zeroBaseline/zeroPad in type-registry.ts

/**
 * Classify a semantic type's relationship to zero.
 * Derived from the registry's zeroBaseline dimension.
 */
export function getZeroClass(semanticType: string): ZeroClass | 'unknown' {
    const baseline = getRegistryEntry(semanticType).zeroBaseline;
    if (baseline === 'none') return 'unknown';
    return baseline;
}

/**
 * Compute whether a quantitative axis should start at zero, based on
 * semantic type, mark type, channel, and data values.
 *
 * Priority: semantic type > mark type > data range > VL default.
 *
 * This is a pure decision function — it returns a ZeroDecision object
 * without modifying any spec. The caller applies the decision to VL.
 *
 * @param semanticType  The semantic type of the field (e.g. 'Amount', 'Temperature')
 * @param channel       The VL channel ('x', 'y', 'size', etc.)
 * @param markType      The mark type ('bar', 'line', 'point', etc.)
 * @param values        Optional numeric data values for data-range analysis
 */
export function computeZeroDecision(
    semanticType: string,
    channel: string,
    markType: string,
    values?: number[],
): ZeroDecision {
    const isBarLike = ['bar', 'area', 'rect'].includes(markType);
    const isPositional = ['x', 'y'].includes(channel);
    const entry = getRegistryEntry(semanticType);
    const zeroClass = getZeroClass(semanticType);

    // --- Zero-meaningful types: always zero ---
    if (zeroClass === 'meaningful') {
        return { zero: true, domainPadFraction: 0, zeroClass };
    }

    // --- Zero-arbitrary types: never zero, apply padding ---
    if (zeroClass === 'arbitrary') {
        // Exception: bar/area marks with data that touches/crosses zero
        if (isBarLike && values && values.length > 0) {
            const dataMin = Math.min(...values);
            if (dataMin <= 0) {
                return { zero: true, domainPadFraction: 0, zeroClass };
            }
        }
        return {
            zero: false,
            domainPadFraction: entry.zeroPad || 0.05,
            zeroClass,
        };
    }

    // --- Contextual types: use data range + mark to decide ---
    if (zeroClass === 'contextual' && values && values.length > 0) {
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);

        // Data touches/crosses zero → include it
        if (dataMin <= 0) {
            return { zero: true, domainPadFraction: 0, zeroClass };
        }

        // How far is data from zero?
        const proximity = dataMax > 0 ? dataMin / dataMax : 0;

        // Close to zero → include it
        if (proximity < 0.3) {
            return { zero: true, domainPadFraction: 0, zeroClass };
        }

        // Far from zero + bar/area → still include (bar length integrity)
        if (isBarLike) {
            return { zero: true, domainPadFraction: 0, zeroClass };
        }

        // Far from zero + non-bar → data-fit with padding
        return { zero: false, domainPadFraction: 0.05, zeroClass };
    }

    // --- No semantic type or unrecognized → no opinion, let VL decide ---
    if (isBarLike && isPositional) {
        return { zero: true, domainPadFraction: 0, zeroClass: 'unknown' };
    }
    return { zero: false, domainPadFraction: 0.05, zeroClass: 'unknown' };
}

/**
 * Compute padded domain bounds for a non-zero axis.
 * Pure computation — returns [paddedMin, paddedMax] without modifying any spec.
 *
 * @param values         Numeric data values
 * @param padFraction    Fraction of data range to pad on each side
 * @returns              [paddedMin, paddedMax] or null if padding is not applicable
 */
export function computePaddedDomain(
    values: number[],
    padFraction: number,
): [number, number] | null {
    if (padFraction <= 0 || values.length < 2) return null;

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const span = dataMax - dataMin;
    if (span <= 0) return null;

    const padding = span * padFraction;
    return [dataMin - padding, dataMax + padding];
}

// ---------------------------------------------------------------------------
// Color Scheme Recommendations
// ---------------------------------------------------------------------------

export type ColorSchemeType = 'categorical' | 'sequential' | 'diverging';

export interface ColorSchemeRecommendation {
    scheme: string;
    type: ColorSchemeType;
    reason: string;
    /** For diverging schemes, the recommended midpoint value */
    domainMid?: number;
}

// getDivergingMidpoint: REMOVED — superseded by resolveDivergingInfo() in field-semantics.ts
// which uses a priority chain (unit → type-intrinsic → domain → data) and
// distinguishes inherent vs conditional diverging.

/**
 * Vega-Lite color schemes organized by use case
 * See: https://vega.github.io/vega/docs/schemes/
 */
const colorSchemes = {
    // Categorical (nominal) - good for distinct categories
    categorical: {
        default: 'category10',
        large: 'category20',
        pastel: 'pastel1',
        accent: 'accent',
        paired: 'paired',      // Good for paired comparisons
        set1: 'set1',          // Distinct, saturated
        set2: 'set2',          // Pastel
        set3: 'set3',          // Larger set
        tableau10: 'tableau10',
        tableau20: 'tableau20',
    },
    // Sequential - good for ordered/quantitative data
    sequential: {
        blues: 'blues',
        greens: 'greens',
        oranges: 'oranges',
        reds: 'reds',
        purples: 'purples',
        greys: 'greys',
        // Multi-hue sequential
        viridis: 'viridis',
        inferno: 'inferno',
        magma: 'magma',
        plasma: 'plasma',
        turbo: 'turbo',
        // Domain-specific
        yellowGreen: 'yellowgreen',
        yellowOrangeBrown: 'yelloworangebrown',
        goldGreen: 'goldgreen',
        goldOrange: 'goldorange',
        goldRed: 'goldred',
    },
    // Diverging - good for data with meaningful center point
    diverging: {
        redBlue: 'redblue',
        redGrey: 'redgrey',
        redYellowBlue: 'redyellowblue',
        redYellowGreen: 'redyellowgreen',
        pinkYellowGreen: 'pinkyellowgreen',
        purpleGreen: 'purplegreen',
        purpleOrange: 'purpleorange',
        brownBlueGreen: 'brownbluegreen',
    },
};

/**
 * Get recommended color scheme based on semantic type and encoding context.
 * 
 * @param semanticType - The semantic type of the field
 * @param encodingType - The Vega-Lite encoding type ('nominal', 'ordinal', 'quantitative')
 * @param uniqueValueCount - Number of unique values (for categorical sizing)
 * @param fieldName - Field name (for consistent hashing)
 * @param values - Optional actual data values (for inspecting data range)
 * @param colorHint - Optional classification from resolveColorSchemeHint().
 *        When provided, the hint's type ('diverging'|'sequential'|'categorical')
 *        overrides inline detection, avoiding duplicate diverging logic.
 */
export function getRecommendedColorScheme(
    semanticType: string | undefined,
    encodingType: 'nominal' | 'ordinal' | 'quantitative' | 'temporal',
    uniqueValueCount: number = 10,
    fieldName: string = '',
    values: any[] = [],
    colorHint?: { type: 'categorical' | 'sequential' | 'diverging' },
): ColorSchemeRecommendation {
    
    // Helper for consistent scheme selection from array
    const pickScheme = (schemes: string[], name: string): string => {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = ((hash << 5) - hash) + name.charCodeAt(i);
            hash = hash & hash;
        }
        return schemes[Math.abs(hash) % schemes.length];
    };

    // If no semantic type, use defaults based on encoding type
    if (!semanticType) {
        if (encodingType === 'quantitative') {
            return { scheme: 'viridis', type: 'sequential', reason: 'default for quantitative' };
        }
        if (encodingType === 'ordinal') {
            return { scheme: 'blues', type: 'sequential', reason: 'default for ordinal' };
        }
        // nominal/temporal default to categorical — use saturated schemes for readability
        return { 
            scheme: uniqueValueCount > 10 ? 'tableau20' : 'tableau10', 
            type: 'categorical', 
            reason: 'default for categorical' 
        };
    }

    // --- Diverging-capable types ---
    // When a colorHint is provided (from resolveColorSchemeHint), it drives the
    // diverging/sequential decision. Without a hint, fall back to sequential.
    // This avoids duplicating the diverging detection logic from field-semantics.ts.

    // Temperature
    if (semanticType === 'Temperature') {
        if (colorHint?.type === 'diverging') {
            return { scheme: 'redblue', type: 'diverging', reason: 'temperature diverging around freezing point' };
        }
        return { scheme: 'reds', type: 'sequential', reason: 'temperature single-direction uses sequential' };
    }

    // Percentage
    if (semanticType === 'Percentage') {
        if (colorHint?.type === 'diverging') {
            return { scheme: 'redblue', type: 'diverging', reason: 'percentage spans positive and negative' };
        }
        return { scheme: 'oranges', type: 'sequential', reason: 'percentage all same sign uses sequential' };
    }

    // Price/Amount
    if (['Price', 'Amount'].includes(semanticType)) {
        if (colorHint?.type === 'diverging') {
            return { scheme: 'redblue', type: 'diverging', reason: 'financial data spans positive and negative' };
        }
        return { scheme: 'goldgreen', type: 'sequential', reason: 'financial data uses gold-green' };
    }

    // Score - evaluation metrics; diverging when hint says so (e.g., domain midpoint)
    if (semanticType === 'Score') {
        if (colorHint?.type === 'diverging') {
            return { scheme: 'redblue', type: 'diverging', reason: 'score/rating diverging around midpoint' };
        }
        return { scheme: 'yelloworangebrown', type: 'sequential', reason: 'scores use warm sequential' };
    }

    // Rank - use single-hue sequential
    if (semanticType === 'Rank') {
        return { scheme: 'purples', type: 'sequential', reason: 'ranks use single-hue sequential' };
    }

    // Ranges - use sequential
    if (semanticType === 'Range') {
        return { scheme: 'blues', type: 'sequential', reason: 'range groups use sequential' };
    }

    // Temporal granules (Year, Month, Quarter, etc.) - sequential for continuity
    if (ordinalTypes.has(semanticType) && ['Year', 'Quarter', 'Month', 'Week', 'Day', 'Hour', 'Decade'].includes(semanticType)) {
        return { scheme: 'viridis', type: 'sequential', reason: 'temporal granules use perceptually uniform' };
    }

    // Geographic locations - use geographic-friendly palettes
    if (getRegistryEntry(semanticType ?? '').t1 === 'GeoPlace') {
        if (uniqueValueCount <= 10) {
            return { scheme: 'set2', type: 'categorical', reason: 'geographic regions use distinct pastels' };
        }
        return { scheme: 'tableau20', type: 'categorical', reason: 'many regions use large categorical' };
    }

    // Status/Boolean - use accent colors for clear distinction
    if (['Status', 'Boolean'].includes(semanticType)) {
        return { scheme: 'set1', type: 'categorical', reason: 'status uses high-contrast categorical' };
    }

    // Categories - use standard categorical
    if (semanticType === 'Category') {
        return { 
            scheme: uniqueValueCount > 10 ? 'tableau20' : 'tableau10', 
            type: 'categorical', 
            reason: 'categories use standard categorical' 
        };
    }

    // Names (persons, companies, products) - use saturated schemes for readability
    if (semanticType === 'Name') {
        return { 
            scheme: uniqueValueCount > 8 ? 'tableau20' : 'set2', 
            type: 'categorical', 
            reason: 'names use readable categorical' 
        };
    }

    // Duration - use sequential (longer = more intense)
    if (semanticType === 'Duration') {
        return { scheme: 'oranges', type: 'sequential', reason: 'duration uses intensity-based sequential' };
    }

    // Quantity/Count/Distance/etc. - general measures
    // Check colorHint first — signed measures (Profit, Sentiment, Correlation,
    // PercentageChange) pass through here and should honor their diverging hint.
    if (measureTypes.has(semanticType)) {
        if (colorHint?.type === 'diverging') {
            return { scheme: 'redblue', type: 'diverging', reason: 'measure with diverging nature' };
        }
        const sequentialSchemes = ['viridis', 'blues', 'greens', 'reds', 'yelloworangebrown', 'goldgreen'];
        return { 
            scheme: pickScheme(sequentialSchemes, fieldName), 
            type: 'sequential', 
            reason: 'measures use perceptually uniform sequential' 
        };
    }

    // Ordinal types not already handled
    if (ordinalTypes.has(semanticType) || encodingType === 'ordinal') {
        const ordinalSchemes = ['blues', 'greens', 'purples', 'oranges'];
        return { 
            scheme: pickScheme(ordinalSchemes, fieldName), 
            type: 'sequential', 
            reason: 'ordinal data uses sequential scheme' 
        };
    }

    // Default categorical for nominal
    if (encodingType === 'nominal' || encodingType === 'temporal') {
        return { 
            scheme: uniqueValueCount > 10 ? 'tableau20' : 'tableau10', 
            type: 'categorical', 
            reason: 'default categorical palette' 
        };
    }

    // Fallback
    return { scheme: 'viridis', type: 'sequential', reason: 'universal fallback' };
}

// getRecommendedColorSchemeWithMidpoint: REMOVED — diverging midpoint is now
// resolved via resolveDivergingInfo() in field-semantics.ts and applied directly
// by the caller in resolve-semantics.ts. See resolveChannelSemantics().

// ===========================================================================
// Canonical Ordinal Sort Orders
// ===========================================================================

/**
 * Well-known canonical ordinal sequences.
 *
 * Used to detect when data values belong to a known ordinal domain
 * (months, days of the week, quarters, etc.) and sort them in their
 * natural order instead of alphabetically or by a quantitative axis.
 */

/** Full and abbreviated English month names (case-insensitive lookup). */
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_ABBR3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NUM = ['1','2','3','4','5','6','7','8','9','10','11','12'];

/** Full and abbreviated English day-of-week names. */
const DOW_FULL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DOW_ABBR3 = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DOW_ABBR2 = ['Mo','Tu','We','Th','Fr','Sa','Su'];

/** Sunday-first variant (US convention). */
const DOW_FULL_SUN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DOW_ABBR3_SUN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/** Quarter labels. */
const QUARTER_LABELS = ['Q1','Q2','Q3','Q4'];

/** Compass directions — clockwise from North (top of chart). */
const COMPASS_8 = ['N','NE','E','SE','S','SW','W','NW'];
const COMPASS_8_FULL = ['North','Northeast','East','Southeast','South','Southwest','West','Northwest'];
const COMPASS_4 = ['N','E','S','W'];
const COMPASS_4_FULL = ['North','East','South','West'];

interface OrdinalSequence {
    /** Canonical labels in order */
    labels: string[];
    /** Case-insensitive matching */
    caseInsensitive: boolean;
}

/** All known ordinal sequences, keyed by semantic type. */
const ORDINAL_SEQUENCES: Record<string, OrdinalSequence[]> = {
    Month: [
        { labels: MONTH_FULL, caseInsensitive: true },
        { labels: MONTH_ABBR3, caseInsensitive: true },
        { labels: MONTH_NUM, caseInsensitive: false },
    ],
    Day: [
        { labels: DOW_FULL, caseInsensitive: true },
        { labels: DOW_ABBR3, caseInsensitive: true },
        { labels: DOW_ABBR2, caseInsensitive: true },
        { labels: DOW_FULL_SUN, caseInsensitive: true },
        { labels: DOW_ABBR3_SUN, caseInsensitive: true },
    ],
    Quarter: [
        { labels: QUARTER_LABELS, caseInsensitive: true },
    ],
    Direction: [
        { labels: COMPASS_8, caseInsensitive: true },
        { labels: COMPASS_8_FULL, caseInsensitive: true },
        { labels: COMPASS_4, caseInsensitive: true },
        { labels: COMPASS_4_FULL, caseInsensitive: true },
    ],
};

/**
 * Build a case-insensitive lookup map from a sequence's labels.
 * Returns map: lowercased label → index.
 */
function buildLookup(seq: OrdinalSequence): Map<string, number> {
    const m = new Map<string, number>();
    for (let i = 0; i < seq.labels.length; i++) {
        const key = seq.caseInsensitive ? seq.labels[i].toLowerCase() : seq.labels[i];
        m.set(key, i);
    }
    return m;
}

/**
 * Try to match a set of data values against a well-known ordinal sequence.
 *
 * Returns the canonical sort order (subset of the sequence, in order) if
 * enough values match, or `undefined` if no match.
 *
 * Matching rules:
 * - At least 60% of unique data values must be found in the sequence
 * - All matched values are returned in canonical order
 * - Unmatched values are appended at the end (preserving data order)
 *
 * @param values     The data values (strings or numbers) on this channel
 * @param sequences  The candidate sequences for the semantic type
 */
function matchSequence(values: any[], sequences: OrdinalSequence[]): string[] | undefined {
    const uniqueValues = [...new Set(values.map(v => v != null ? String(v) : ''))].filter(v => v !== '');
    if (uniqueValues.length === 0) return undefined;

    for (const seq of sequences) {
        const lookup = buildLookup(seq);
        const matched: { value: string; index: number }[] = [];
        const unmatched: string[] = [];

        for (const val of uniqueValues) {
            const key = seq.caseInsensitive ? val.toLowerCase() : val;
            const idx = lookup.get(key);
            if (idx !== undefined) {
                matched.push({ value: val, index: idx });
            } else {
                unmatched.push(val);
            }
        }

        // Require at least 60% match rate
        if (matched.length >= uniqueValues.length * 0.6 && matched.length >= 2) {
            // Sort matched values by canonical index
            matched.sort((a, b) => a.index - b.index);
            const result = matched.map(m => m.value);
            // Append unmatched at the end
            result.push(...unmatched);
            return result;
        }
    }
    return undefined;
}

/**
 * Infer a canonical ordinal sort order for a field based on its semantic type
 * and data values.
 *
 * Works for:
 * - Month names (full/abbreviated/numeric): Jan, Feb, ... or January, February, ...
 * - Day-of-week names (full/abbreviated): Mon, Tue, ... or Monday, Tuesday, ...
 * - Quarter labels: Q1, Q2, Q3, Q4
 *
 * Falls back to `undefined` if no known sequence is detected, letting the
 * caller use its own default sort logic.
 *
 * @param semanticType  The semantic type of the field (e.g. 'Month', 'Day')
 * @param values        The data values on this channel
 * @returns Sorted unique values in canonical order, or undefined
 */
export function inferOrdinalSortOrder(
    semanticType: string,
    values: any[],
): string[] | undefined {
    // 1. Check by explicit semantic type
    const sequences = ORDINAL_SEQUENCES[semanticType];
    if (sequences) {
        return matchSequence(values, sequences);
    }

    // 2. Auto-detect: try all sequences if semantic type is generic
    if (!semanticType || semanticType === 'Category' || semanticType === 'Unknown') {
        for (const seqs of Object.values(ORDINAL_SEQUENCES)) {
            const result = matchSequence(values, seqs);
            if (result) return result;
        }
    }

    return undefined;
}

