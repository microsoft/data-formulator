// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * TYPE REGISTRY — Single Source of Truth
 * =============================================================================
 *
 * Every recognized semantic type is registered here with its orthogonal
 * compilation dimensions. This is the ONLY place where per-type properties
 * are defined. All other files (field-semantics.ts, semantic-types.ts)
 * derive helper functions by querying this registry.
 *
 * To add a new semantic type: add an entry here.
 * To query a type's properties: use `getRegistryEntry()`.
 * =============================================================================
 */

// ---------------------------------------------------------------------------
// Visualization Categories
// ---------------------------------------------------------------------------

export type VisCategory = 'quantitative' | 'ordinal' | 'nominal' | 'temporal' | 'geographic';

// ---------------------------------------------------------------------------
// Registry Dimension Types
// ---------------------------------------------------------------------------

/** Top-level type family */
export type T0Family = 'Temporal' | 'Measure' | 'Discrete' | 'Geographic' | 'Categorical' | 'Identifier';

/** Mid-level category within a family */
export type T1Category =
    | 'DateTime' | 'DateGranule' | 'Duration'
    | 'Amount' | 'Physical' | 'Proportion' | 'SignedMeasure' | 'GenericMeasure'
    | 'Rank' | 'Score' | 'Index'
    | 'GeoCoordinate' | 'GeoPlace'
    | 'Entity' | 'Coded' | 'Binned'
    | 'ID';

export type DomainShape = 'open' | 'bounded' | 'fixed' | 'cyclic';
export type AggRole = 'additive' | 'intensive' | 'signed-additive' | 'dimension' | 'identifier';
export type DivergingClass = 'none' | 'inherent' | 'conditional';
export type FormatClass = 'currency' | 'percent' | 'signed-percent' | 'signed-currency'
    | 'signed-decimal' | 'unit-suffix' | 'integer' | 'decimal' | 'plain';

/**
 * Zero-baseline classification for quantitative axes.
 *
 * - `meaningful`: 0 = absence of the measured thing; axis should include 0 (Count, Revenue).
 * - `arbitrary`:  0 is arbitrary or nonexistent; data-fit the axis (Temperature, Year, Rank).
 * - `contextual`: 0 is meaningful but data-fitting may be better when data is far from 0 (Percentage, Score).
 * - `none`:       Not a quantitative type; zero question is irrelevant (all categorical/temporal types).
 */
export type ZeroBaseline = 'meaningful' | 'arbitrary' | 'contextual' | 'none';

export interface TypeRegistryEntry {
    t0: T0Family;
    t1: T1Category;
    visEncodings: VisCategory[];
    aggRole: AggRole;
    domainShape: DomainShape;
    diverging: DivergingClass;
    formatClass: FormatClass;
    /** Zero-baseline classification for quantitative axes */
    zeroBaseline: ZeroBaseline;
    /** Domain padding fraction for non-zero axes (0 = no padding) */
    zeroPad: number;
}

// ---------------------------------------------------------------------------
// The Registry
// ---------------------------------------------------------------------------

/**
 * Static registry mapping every recognized semantic type to its
 * tier membership and orthogonal compilation dimensions.
 *
 * Types not in this registry are treated as 'Unknown' → nominal/plain.
 */
const TYPE_REGISTRY: Record<string, TypeRegistryEntry> = {
    // --- Temporal: DateTime ---
    DateTime:      { t0: 'Temporal', t1: 'DateTime', visEncodings: ['temporal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none', formatClass: 'plain',           zeroBaseline: 'none', zeroPad: 0 },
    Date:          { t0: 'Temporal', t1: 'DateTime', visEncodings: ['temporal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none', formatClass: 'plain',           zeroBaseline: 'none', zeroPad: 0 },
    Time:          { t0: 'Temporal', t1: 'DateTime', visEncodings: ['temporal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none', formatClass: 'plain',           zeroBaseline: 'none', zeroPad: 0 },
    Timestamp:     { t0: 'Temporal', t1: 'DateTime', visEncodings: ['temporal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none', formatClass: 'plain',           zeroBaseline: 'none', zeroPad: 0 },

    // --- Temporal: DateGranule ---
    Year:          { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['temporal', 'ordinal'], aggRole: 'dimension', domainShape: 'open',    diverging: 'none', formatClass: 'integer',        zeroBaseline: 'arbitrary', zeroPad: 0.03 },
    Quarter:       { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['ordinal'],            aggRole: 'dimension', domainShape: 'cyclic',  diverging: 'none', formatClass: 'plain',          zeroBaseline: 'none', zeroPad: 0 },
    Month:         { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['ordinal'],            aggRole: 'dimension', domainShape: 'cyclic',  diverging: 'none', formatClass: 'plain',          zeroBaseline: 'arbitrary', zeroPad: 0 },
    Week:          { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['ordinal'],            aggRole: 'dimension', domainShape: 'cyclic',  diverging: 'none', formatClass: 'plain',          zeroBaseline: 'none', zeroPad: 0 },
    Day:           { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['ordinal'],            aggRole: 'dimension', domainShape: 'cyclic',  diverging: 'none', formatClass: 'plain',          zeroBaseline: 'arbitrary', zeroPad: 0 },
    Hour:          { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['ordinal'],            aggRole: 'dimension', domainShape: 'cyclic',  diverging: 'none', formatClass: 'integer',        zeroBaseline: 'arbitrary', zeroPad: 0 },
    YearMonth:     { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['temporal', 'ordinal'], aggRole: 'dimension', domainShape: 'open',   diverging: 'none', formatClass: 'plain',          zeroBaseline: 'none', zeroPad: 0 },
    YearQuarter:   { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['temporal', 'ordinal'], aggRole: 'dimension', domainShape: 'open',   diverging: 'none', formatClass: 'plain',          zeroBaseline: 'none', zeroPad: 0 },
    YearWeek:      { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['temporal', 'ordinal'], aggRole: 'dimension', domainShape: 'open',   diverging: 'none', formatClass: 'plain',          zeroBaseline: 'none', zeroPad: 0 },
    Decade:        { t0: 'Temporal', t1: 'DateGranule', visEncodings: ['temporal', 'ordinal'], aggRole: 'dimension', domainShape: 'open',   diverging: 'none', formatClass: 'integer',        zeroBaseline: 'arbitrary', zeroPad: 0.03 },

    // --- Temporal: Duration ---
    Duration:      { t0: 'Temporal', t1: 'Duration', visEncodings: ['quantitative'],       aggRole: 'additive',   domainShape: 'open',    diverging: 'none', formatClass: 'unit-suffix',     zeroBaseline: 'meaningful', zeroPad: 0 },

    // --- Measure: Amount ---
    Amount:        { t0: 'Measure', t1: 'Amount', visEncodings: ['quantitative'],          aggRole: 'additive',   domainShape: 'open',    diverging: 'none',        formatClass: 'currency',   zeroBaseline: 'meaningful', zeroPad: 0 },
    Price:         { t0: 'Measure', t1: 'Amount', visEncodings: ['quantitative'],          aggRole: 'intensive',  domainShape: 'open',    diverging: 'none',        formatClass: 'currency',   zeroBaseline: 'meaningful', zeroPad: 0 },
    Revenue:       { t0: 'Measure', t1: 'Amount', visEncodings: ['quantitative'],          aggRole: 'additive',   domainShape: 'open',    diverging: 'none',        formatClass: 'currency',   zeroBaseline: 'meaningful', zeroPad: 0 },
    Cost:          { t0: 'Measure', t1: 'Amount', visEncodings: ['quantitative'],          aggRole: 'additive',   domainShape: 'open',    diverging: 'none',        formatClass: 'currency',   zeroBaseline: 'meaningful', zeroPad: 0 },

    // --- Measure: Physical ---
    Quantity:      { t0: 'Measure', t1: 'Physical', visEncodings: ['quantitative'],        aggRole: 'additive',   domainShape: 'open',    diverging: 'none',        formatClass: 'unit-suffix', zeroBaseline: 'meaningful', zeroPad: 0 },
    Temperature:   { t0: 'Measure', t1: 'Physical', visEncodings: ['quantitative'],        aggRole: 'intensive',  domainShape: 'open',    diverging: 'conditional', formatClass: 'unit-suffix', zeroBaseline: 'arbitrary', zeroPad: 0.05 },

    // --- Measure: Proportion ---
    Percentage:    { t0: 'Measure', t1: 'Proportion', visEncodings: ['quantitative'],      aggRole: 'intensive',  domainShape: 'bounded', diverging: 'none',        formatClass: 'percent',    zeroBaseline: 'contextual', zeroPad: 0 },

    // --- Measure: SignedMeasure ---
    Profit:             { t0: 'Measure', t1: 'SignedMeasure', visEncodings: ['quantitative'], aggRole: 'signed-additive', domainShape: 'open', diverging: 'conditional', formatClass: 'signed-currency',  zeroBaseline: 'meaningful', zeroPad: 0 },
    PercentageChange:   { t0: 'Measure', t1: 'SignedMeasure', visEncodings: ['quantitative'], aggRole: 'intensive',       domainShape: 'open', diverging: 'conditional', formatClass: 'signed-percent',   zeroBaseline: 'contextual', zeroPad: 0.05 },
    Sentiment:          { t0: 'Measure', t1: 'SignedMeasure', visEncodings: ['quantitative'], aggRole: 'intensive',       domainShape: 'open', diverging: 'inherent',    formatClass: 'signed-decimal',   zeroBaseline: 'meaningful', zeroPad: 0 },
    Correlation:        { t0: 'Measure', t1: 'SignedMeasure', visEncodings: ['quantitative'], aggRole: 'intensive',       domainShape: 'bounded', diverging: 'inherent', formatClass: 'signed-decimal',   zeroBaseline: 'meaningful', zeroPad: 0 },

    // --- Measure: GenericMeasure ---
    Count:         { t0: 'Measure', t1: 'GenericMeasure', visEncodings: ['quantitative'],  aggRole: 'additive',   domainShape: 'open',    diverging: 'none',        formatClass: 'integer',    zeroBaseline: 'meaningful', zeroPad: 0 },
    Number:        { t0: 'Measure', t1: 'GenericMeasure', visEncodings: ['quantitative'],  aggRole: 'additive',   domainShape: 'open',    diverging: 'none',        formatClass: 'decimal',    zeroBaseline: 'meaningful', zeroPad: 0 },

    // --- Discrete ---
    Rank:          { t0: 'Discrete', t1: 'Rank',  visEncodings: ['ordinal'],               aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'integer',    zeroBaseline: 'arbitrary', zeroPad: 0.08 },
    Score:         { t0: 'Discrete', t1: 'Score', visEncodings: ['quantitative', 'ordinal'], aggRole: 'intensive', domainShape: 'bounded', diverging: 'conditional', formatClass: 'decimal',    zeroBaseline: 'contextual', zeroPad: 0.05 },
    Rating:        { t0: 'Discrete', t1: 'Score', visEncodings: ['quantitative', 'ordinal'], aggRole: 'intensive', domainShape: 'bounded', diverging: 'conditional', formatClass: 'decimal',    zeroBaseline: 'contextual', zeroPad: 0.05 },
    Index:         { t0: 'Discrete', t1: 'Index', visEncodings: ['ordinal'],               aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'integer',    zeroBaseline: 'arbitrary', zeroPad: 0.08 },
    ID:            { t0: 'Identifier', t1: 'ID',  visEncodings: ['nominal'],               aggRole: 'identifier', domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'arbitrary', zeroPad: 0 },

    // --- Geographic ---
    Latitude:      { t0: 'Geographic', t1: 'GeoCoordinate', visEncodings: ['quantitative', 'geographic'], aggRole: 'dimension', domainShape: 'fixed', diverging: 'none', formatClass: 'decimal',    zeroBaseline: 'arbitrary', zeroPad: 0.02 },
    Longitude:     { t0: 'Geographic', t1: 'GeoCoordinate', visEncodings: ['quantitative', 'geographic'], aggRole: 'dimension', domainShape: 'fixed', diverging: 'none', formatClass: 'decimal',    zeroBaseline: 'arbitrary', zeroPad: 0.02 },
    Country:       { t0: 'Geographic', t1: 'GeoPlace', visEncodings: ['nominal'],         aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    State:         { t0: 'Geographic', t1: 'GeoPlace', visEncodings: ['nominal'],         aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    City:          { t0: 'Geographic', t1: 'GeoPlace', visEncodings: ['nominal'],         aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Region:        { t0: 'Geographic', t1: 'GeoPlace', visEncodings: ['nominal'],         aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Address:       { t0: 'Geographic', t1: 'GeoPlace', visEncodings: ['nominal'],         aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    ZipCode:       { t0: 'Geographic', t1: 'GeoPlace', visEncodings: ['nominal'],         aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },

    // --- Categorical: Entity ---
    PersonName:    { t0: 'Categorical', t1: 'Entity', visEncodings: ['nominal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Company:       { t0: 'Categorical', t1: 'Entity', visEncodings: ['nominal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Product:       { t0: 'Categorical', t1: 'Entity', visEncodings: ['nominal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Category:      { t0: 'Categorical', t1: 'Entity', visEncodings: ['nominal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Name:          { t0: 'Categorical', t1: 'Entity', visEncodings: ['nominal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },

    // --- Categorical: Coded ---
    Status:        { t0: 'Categorical', t1: 'Coded', visEncodings: ['nominal'],            aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Type:          { t0: 'Categorical', t1: 'Coded', visEncodings: ['nominal'],            aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Boolean:       { t0: 'Categorical', t1: 'Coded', visEncodings: ['nominal'],            aggRole: 'dimension',  domainShape: 'fixed',   diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Direction:     { t0: 'Categorical', t1: 'Coded', visEncodings: ['ordinal', 'nominal'], aggRole: 'dimension',  domainShape: 'cyclic',  diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },

    // --- Categorical: Binned ---
    Range:         { t0: 'Categorical', t1: 'Binned', visEncodings: ['ordinal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    AgeGroup:      { t0: 'Categorical', t1: 'Binned', visEncodings: ['ordinal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },

    // --- Fallbacks ---
    String:        { t0: 'Categorical', t1: 'Entity', visEncodings: ['nominal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
    Unknown:       { t0: 'Categorical', t1: 'Entity', visEncodings: ['nominal'],           aggRole: 'dimension',  domainShape: 'open',    diverging: 'none',        formatClass: 'plain',      zeroBaseline: 'none', zeroPad: 0 },
};

/** Default entry for unrecognized types */
const UNKNOWN_ENTRY: TypeRegistryEntry = {
    t0: 'Categorical', t1: 'Entity',
    visEncodings: ['nominal'],
    aggRole: 'dimension',
    domainShape: 'open',
    diverging: 'none',
    formatClass: 'plain',
    zeroBaseline: 'none',
    zeroPad: 0,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Look up a semantic type in the registry. Falls back to UNKNOWN_ENTRY. */
export function getRegistryEntry(semanticType: string): TypeRegistryEntry {
    return TYPE_REGISTRY[semanticType] ?? UNKNOWN_ENTRY;
}

/** Check whether a semantic type string is explicitly registered. */
export function isRegistered(semanticType: string): boolean {
    return semanticType in TYPE_REGISTRY;
}

/**
 * Get all registered type names.
 * Useful for validation or iterating over the type system.
 */
export function getRegisteredTypes(): string[] {
    return Object.keys(TYPE_REGISTRY);
}
