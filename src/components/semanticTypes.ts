// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
 *     ┌──────────┐         ┌──────────┐         ┌──────────┐
 *     │ Temporal │         │ Numeric  │         │Categorical│
 *     └────┬─────┘         └────┬─────┘         └─────┬────┘
 *          │                    │                     │
 *    ┌─────┴─────┐        ┌─────┴─────┐         ┌─────┴─────┐
 *    │           │        │           │         │           │
 *  Point     Granule    Measure   Discrete    Entity     Coded
 *    │           │        │           │         │           │
 * DateTime    Year     Quantity    Rank      Person     Status
 * Date        Month    Count       Index     Company    Boolean
 * Time        Day      Price       Score     Product    Category
 *             Quarter  Percentage  Rating    Location
 *             Decade   Amount      ID
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
    TimeRange: 'TimeRange',     // Time interval: "9am-5pm", "2020-2024"
    
    // =========================================================================
    // NUMERIC MEASURE TYPES - Continuous values for aggregation
    // =========================================================================
    
    Quantity: 'Quantity',       // Generic continuous measure
    Count: 'Count',             // Discrete count of items
    Amount: 'Amount',           // Monetary or general amounts
    Price: 'Price',             // Unit price
    Revenue: 'Revenue',         // Total revenue/sales
    Cost: 'Cost',               // Expenses/costs
    Percentage: 'Percentage',   // 0-100% or 0-1 ratio
    Rate: 'Rate',               // Rate of change, interest rate
    Ratio: 'Ratio',             // Proportion between values
    Distance: 'Distance',       // Length, height, width
    Area: 'Area',               // Square units
    Volume: 'Volume',           // Cubic units
    Weight: 'Weight',           // Mass
    Temperature: 'Temperature', // Degrees
    Speed: 'Speed',             // Velocity
    
    // =========================================================================
    // NUMERIC DISCRETE TYPES - Numbers with ordinal/identifier meaning
    // =========================================================================
    
    Rank: 'Rank',               // Position in ordered list: 1st, 2nd, 3rd
    Index: 'Index',             // Row number, sequence number
    ID: 'ID',                   // Unique identifier (not for aggregation!)
    Score: 'Score',             // Rating score: 1-5, 1-10, 0-100
    Rating: 'Rating',           // Star rating, letter grade
    Level: 'Level',             // Discrete levels: 1, 2, 3
    
    // =========================================================================
    // GEOGRAPHIC TYPES - Location-based data
    // =========================================================================
    
    Latitude: 'Latitude',       // -90 to 90
    Longitude: 'Longitude',     // -180 to 180
    Coordinates: 'Coordinates', // Lat/Long pair
    Country: 'Country',         // Country name or code
    State: 'State',             // State/Province
    City: 'City',               // City name
    Region: 'Region',           // Geographic region
    Address: 'Address',         // Street address
    ZipCode: 'ZipCode',         // Postal code
    Location: 'Location',       // Generic location (fallback)
    
    // =========================================================================
    // CATEGORICAL ENTITY TYPES - Named entities
    // =========================================================================
    
    PersonName: 'PersonName',   // Full name, first/last name
    Username: 'Username',       // Account username
    Email: 'Email',             // Email address
    Company: 'Company',         // Company/Organization name
    Brand: 'Brand',             // Brand name
    Department: 'Department',   // Organizational unit
    Product: 'Product',         // Product name
    SKU: 'SKU',                 // Product identifier
    Category: 'Category',       // Product/item category
    Name: 'Name',               // Generic named entity (fallback)
    
    // =========================================================================
    // CATEGORICAL CODED TYPES - Discrete categories/statuses
    // =========================================================================
    
    Status: 'Status',           // State: "Active", "Pending", "Closed"
    Type: 'Type',               // Type classification
    Boolean: 'Boolean',         // True/False, Yes/No
    Binary: 'Binary',           // Two-value categorical
    Code: 'Code',               // Coded value: "A", "B", "C"
    
    // =========================================================================
    // BINNED/RANGE TYPES - Discretized continuous values
    // =========================================================================
    
    Range: 'Range',             // Numeric range: "10000-20000", "<50", "50+"
    AgeGroup: 'AgeGroup',       // Age range: "18-24", "25-34"
    Bucket: 'Bucket',           // Generic binned value
    
    // =========================================================================
    // FALLBACK TYPES
    // =========================================================================
    
    String: 'String',           // Generic string (categorical fallback)
    Number: 'Number',           // Generic number (measure fallback)
    Unknown: 'Unknown',         // Cannot determine type
} as const;

// Type for any semantic type string
export type SemanticType = typeof SemanticTypes[keyof typeof SemanticTypes];

// ---------------------------------------------------------------------------
// Visualization Categories
// ---------------------------------------------------------------------------

export type VizCategory = 'quantitative' | 'ordinal' | 'nominal' | 'temporal' | 'geographic';

// ---------------------------------------------------------------------------
// Type Sets for Classification
// ---------------------------------------------------------------------------

/** Types suitable for time-series X axis (have inherent temporal ordering) */
export const TIMESERIES_X_TYPES = new Set<string>([
    'DateTime', 'Date', 'Time',
    'YearMonth', 'YearQuarter', 'YearWeek',
    'Year', 'Quarter', 'Month', 'Week', 'Day', 'Hour', 'Decade',
]);

/** Types suitable for quantitative encoding (true continuous measures) */
export const MEASURE_TYPES = new Set<string>([
    'Quantity', 'Count',
    'Amount', 'Price', 'Revenue', 'Cost',
    'Percentage', 'Rate', 'Ratio',
    'Distance', 'Area', 'Volume', 'Weight', 'Temperature', 'Speed',
    'Duration',
    'Number',  // Generic fallback
]);

/** Numeric types that should NOT be used as measures (don't aggregate) */
export const NON_MEASURE_NUMERIC_TYPES = new Set<string>([
    'Rank', 'Index', 'ID', 'Score', 'Rating', 'Level',
    'Year', 'Month', 'Day', 'Hour',
    'Latitude', 'Longitude',
]);

/** Types suitable for categorical color/grouping encoding */
export const CATEGORICAL_TYPES = new Set<string>([
    // Entities
    'Name', 'PersonName', 'Username', 'Email',
    'Company', 'Brand', 'Department', 'Product', 'Category',
    // Coded
    'Status', 'Type', 'Boolean', 'Binary', 'Code',
    // Geographic names
    'Location', 'Country', 'State', 'City', 'Region',
    // Ranges (ordinal but work as categorical for color)
    'Range', 'AgeGroup', 'Bucket',
    // Fallback
    'String',
]);

/** Types suitable for ordinal encoding (have inherent order) */
export const ORDINAL_TYPES = new Set<string>([
    // Temporal granules
    'Year', 'Quarter', 'Month', 'Week', 'Day', 'Hour', 'Decade',
    // Discrete numerics
    'Rank', 'Score', 'Rating', 'Level',
    // Ranges
    'Range', 'AgeGroup', 'Bucket', 'TimeRange',
]);

/** Types suitable for geographic/map visualizations */
export const GEO_TYPES = new Set<string>([
    'Latitude', 'Longitude', 'Coordinates',
    'Location', 'Country', 'State', 'City', 'Region', 'Address', 'ZipCode',
]);

/** Geographic coordinate types (for lat/lon matching) */
export const GEO_COORDINATE_TYPES = new Set<string>([
    'Latitude', 'Longitude', 'Coordinates',
]);

/** Geographic named location types (can be geocoded) */
export const GEO_LOCATION_TYPES = new Set<string>([
    'Location', 'Country', 'State', 'City', 'Region', 'Address', 'ZipCode',
]);

// ---------------------------------------------------------------------------
// Type Hierarchy for Generalization
// ---------------------------------------------------------------------------

/**
 * Parent type for each semantic type in the lattice.
 * null means this is a root type.
 */
const TYPE_HIERARCHY: Record<string, string | null> = {
    // Temporal point-in-time
    DateTime: null,
    Date: 'DateTime',
    Time: 'DateTime',
    
    // Temporal granules
    Year: null,
    Quarter: null,
    Month: null,
    Week: null,
    Day: null,
    Hour: null,
    YearMonth: 'Date',
    YearQuarter: 'Date',
    YearWeek: 'Date',
    Decade: 'Year',
    
    // Duration/Range
    Duration: 'Quantity',
    TimeRange: 'Range',
    
    // Measures
    Quantity: null,
    Count: 'Quantity',
    Amount: 'Quantity',
    Price: 'Amount',
    Revenue: 'Amount',
    Cost: 'Amount',
    Percentage: 'Quantity',
    Rate: 'Quantity',
    Ratio: 'Percentage',
    Distance: 'Quantity',
    Area: 'Quantity',
    Volume: 'Quantity',
    Weight: 'Quantity',
    Temperature: 'Quantity',
    Speed: 'Quantity',
    
    // Discrete numerics
    Rank: null,
    Index: 'Rank',
    ID: null,
    Score: 'Rank',
    Rating: 'Score',
    Level: 'Rank',
    
    // Geographic coordinates
    Latitude: null,
    Longitude: null,
    Coordinates: null,
    
    // Geographic locations
    Location: null,
    Country: 'Location',
    State: 'Location',
    City: 'Location',
    Region: 'Location',
    Address: 'Location',
    ZipCode: 'Location',
    
    // Entity names
    Name: null,
    PersonName: 'Name',
    Username: 'Name',
    Email: 'Name',
    Company: 'Name',
    Brand: 'Name',
    Department: 'Name',
    Product: 'Name',
    SKU: 'ID',
    Category: null,
    
    // Coded categoricals
    Status: null,
    Type: 'Category',
    Boolean: null,
    Binary: 'Boolean',
    Code: null,
    
    // Ranges
    Range: null,
    AgeGroup: 'Range',
    Bucket: 'Range',
    
    // Fallbacks
    String: null,
    Number: 'Quantity',
    Unknown: null,
};

/**
 * Mapping from semantic type to preferred Vega-Lite encoding type.
 */
const VIZ_CATEGORY_MAP: Record<string, VizCategory> = {
    // Temporal → temporal
    DateTime: 'temporal', Date: 'temporal', Time: 'temporal',
    YearMonth: 'temporal', YearQuarter: 'temporal', YearWeek: 'temporal',
    Year: 'temporal',
    
    // Temporal granules → ordinal
    Quarter: 'ordinal', Month: 'ordinal',
    Week: 'ordinal', Day: 'ordinal', Hour: 'ordinal', Decade: 'ordinal',
    TimeRange: 'ordinal',
    
    // Duration → quantitative
    Duration: 'quantitative',
    
    // Measures → quantitative
    Quantity: 'quantitative', Count: 'quantitative',
    Amount: 'quantitative', Price: 'quantitative', Revenue: 'quantitative', Cost: 'quantitative',
    Percentage: 'quantitative', Rate: 'quantitative', Ratio: 'quantitative',
    Distance: 'quantitative', Area: 'quantitative', Volume: 'quantitative',
    Weight: 'quantitative', Temperature: 'quantitative', Speed: 'quantitative',
    
    // Discrete numerics → ordinal (except ID, Score, Rating which are quantitative)
    Rank: 'ordinal', Index: 'ordinal', Score: 'quantitative', Rating: 'quantitative', Level: 'ordinal',
    ID: 'nominal',
    
    // Geographic coordinates → geographic
    Latitude: 'geographic', Longitude: 'geographic', Coordinates: 'geographic',
    
    // Geographic locations → nominal
    Location: 'nominal', Country: 'nominal', State: 'nominal', City: 'nominal',
    Region: 'nominal', Address: 'nominal', ZipCode: 'nominal',
    
    // Entity names → nominal
    Name: 'nominal', PersonName: 'nominal', Username: 'nominal', Email: 'nominal',
    Company: 'nominal', Brand: 'nominal', Department: 'nominal',
    Product: 'nominal', SKU: 'nominal', Category: 'nominal',
    
    // Coded → nominal
    Status: 'nominal', Type: 'nominal', Boolean: 'nominal', Binary: 'nominal', Code: 'nominal',
    
    // Ranges → ordinal
    Range: 'ordinal', AgeGroup: 'ordinal', Bucket: 'ordinal',
    
    // Fallbacks
    String: 'nominal', Number: 'quantitative', Unknown: 'nominal',
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Get the Vega-Lite visualization category for a semantic type.
 */
export function getVizCategory(semanticType: string): VizCategory {
    return VIZ_CATEGORY_MAP[semanticType] ?? 'nominal';
}

/**
 * Check if a semantic type has an explicit mapping in the viz category map.
 * Unknown/generic types (e.g. 'Value') return false, meaning callers should
 * fall back to JS-type-based inference instead of using the nominal default.
 */
export function hasVizCategory(semanticType: string): boolean {
    return semanticType in VIZ_CATEGORY_MAP;
}

/**
 * Check if a semantic type is a true measure (suitable for quantitative encoding).
 */
export function isMeasureType(semanticType: string): boolean {
    return MEASURE_TYPES.has(semanticType);
}

/**
 * Check if a semantic type is suitable for time-series X axis.
 */
export function isTimeSeriesType(semanticType: string): boolean {
    return TIMESERIES_X_TYPES.has(semanticType);
}

/**
 * Check if a semantic type is categorical (suitable for color/grouping).
 */
export function isCategoricalType(semanticType: string): boolean {
    return CATEGORICAL_TYPES.has(semanticType);
}

/**
 * Check if a semantic type is ordinal (has inherent order).
 */
export function isOrdinalType(semanticType: string): boolean {
    return ORDINAL_TYPES.has(semanticType);
}

/**
 * Check if a semantic type is geographic.
 */
export function isGeoType(semanticType: string): boolean {
    return GEO_TYPES.has(semanticType);
}

/**
 * Check if a semantic type is a geographic coordinate (lat/lon).
 */
export function isGeoCoordinateType(semanticType: string): boolean {
    return GEO_COORDINATE_TYPES.has(semanticType);
}

/**
 * Check if a semantic type is a named geographic location.
 */
export function isGeoLocationString(semanticType: string): boolean {
    return GEO_LOCATION_TYPES.has(semanticType);
}

/**
 * Get the parent type in the hierarchy (for generalization).
 */
export function getParentType(semanticType: string): string | null {
    return TYPE_HIERARCHY[semanticType] ?? null;
}

/**
 * Check if a semantic type is numeric but should not be aggregated.
 */
export function isNonMeasureNumeric(semanticType: string): boolean {
    return NON_MEASURE_NUMERIC_TYPES.has(semanticType);
}

/**
 * Get all ancestor types in the hierarchy (for type matching).
 */
export function getAncestorTypes(semanticType: string): string[] {
    const ancestors: string[] = [];
    let current = getParentType(semanticType);
    while (current) {
        ancestors.push(current);
        current = getParentType(current);
    }
    return ancestors;
}

/**
 * Check if one type is a subtype of another (including self).
 */
export function isSubtypeOf(semanticType: string, parentType: string): boolean {
    if (semanticType === parentType) return true;
    return getAncestorTypes(semanticType).includes(parentType);
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

/**
 * Determine the appropriate midpoint for a diverging color scale.
 * 
 * @param semanticType - The semantic type of the field
 * @param values - Array of numeric values from the data
 * @returns The recommended midpoint value, or undefined if not applicable
 */
export function getDivergingMidpoint(
    semanticType: string | undefined,
    values: number[]
): number | undefined {
    if (values.length === 0) return undefined;
    
    const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
    if (validValues.length === 0) return undefined;
    
    const min = Math.min(...validValues);
    const max = Math.max(...validValues);
    
    // If data doesn't span both sides of any potential midpoint, 
    // diverging might not be ideal - return undefined
    const spansBothSides = (mid: number) => min < mid && max > mid;
    
    // Type-specific midpoints
    switch (semanticType) {
        case 'Temperature':
            // 0°C is a natural midpoint for temperature
            // But check if data is likely Fahrenheit (spans around 32)
            if (spansBothSides(0)) return 0;
            if (spansBothSides(32) && max > 50) return 32; // Likely Fahrenheit
            return (min + max) / 2;
            
        case 'Percentage':
        case 'Rate':
        case 'Ratio':
            // 0 is natural for percentage change, growth rates
            if (spansBothSides(0)) return 0;
            // For 0-100% data, 50% could be meaningful
            if (min >= 0 && max <= 100 && spansBothSides(50)) return 50;
            // For 0-1 normalized data
            if (min >= 0 && max <= 1 && spansBothSides(0.5)) return 0.5;
            return (min + max) / 2;
            
        case 'Score':
        case 'Rating':
            // For ratings, midpoint of scale is natural
            // Common scales: 1-5, 1-10, 0-100
            if (min >= 0 && max <= 5) return 2.5;
            if (min >= 0 && max <= 10) return 5;
            if (min >= 0 && max <= 100) return 50;
            return (min + max) / 2;
            
        case 'Amount':
        case 'Revenue':
        case 'Cost':
        case 'Price':
            // For financial data, 0 is meaningful if data spans it
            if (spansBothSides(0)) return 0;
            return (min + max) / 2;
            
        default:
            // General case: use 0 if data spans it, otherwise use median
            if (spansBothSides(0)) return 0;
            return (min + max) / 2;
    }
}

/**
 * Vega-Lite color schemes organized by use case
 * See: https://vega.github.io/vega/docs/schemes/
 */
const COLOR_SCHEMES = {
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
 */
export function getRecommendedColorScheme(
    semanticType: string | undefined,
    encodingType: 'nominal' | 'ordinal' | 'quantitative' | 'temporal',
    uniqueValueCount: number = 10,
    fieldName: string = '',
    values: any[] = []
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

    // Temperature - use diverging only when data actually spans both hot and cold (crosses 0)
    if (semanticType === 'Temperature') {
        if (encodingType === 'quantitative') {
            const nums = values.filter((v: any) => typeof v === 'number' && !isNaN(v));
            const min = nums.length > 0 ? Math.min(...nums) : 0;
            const max = nums.length > 0 ? Math.max(...nums) : 0;
            if (min < 0 && max > 0) {
                return { scheme: 'redblue', type: 'diverging', reason: 'temperature spans hot-cold around 0' };
            }
        }
        return { scheme: 'reds', type: 'sequential', reason: 'temperature single-direction uses sequential' };
    }

    // Percentage/Rate/Ratio - diverging ONLY when data has both positive and negative values
    if (['Percentage', 'Rate', 'Ratio'].includes(semanticType)) {
        if (encodingType === 'quantitative') {
            const nums = values.filter((v: any) => typeof v === 'number' && !isNaN(v));
            const min = nums.length > 0 ? Math.min(...nums) : 0;
            const max = nums.length > 0 ? Math.max(...nums) : 0;
            if (min < 0 && max > 0) {
                return { scheme: 'redblue', type: 'diverging', reason: 'percentage/rate spans positive and negative' };
            }
        }
        return { scheme: 'oranges', type: 'sequential', reason: 'percentage/rate all same sign uses sequential' };
    }

    // Revenue/Price/Cost/Amount - diverging only when data spans negative
    if (['Revenue', 'Price', 'Cost', 'Amount'].includes(semanticType)) {
        if (encodingType === 'quantitative') {
            const nums = values.filter((v: any) => typeof v === 'number' && !isNaN(v));
            const min = nums.length > 0 ? Math.min(...nums) : 0;
            const max = nums.length > 0 ? Math.max(...nums) : 0;
            if (min < 0 && max > 0) {
                return { scheme: 'redblue', type: 'diverging', reason: 'financial data spans positive and negative' };
            }
        }
        return { scheme: 'goldgreen', type: 'sequential', reason: 'financial data uses gold-green' };
    }

    // Score/Rating - evaluation metrics, use warm colors
    if (['Score', 'Rating'].includes(semanticType)) {
        return { scheme: 'yelloworangebrown', type: 'sequential', reason: 'scores use warm sequential' };
    }

    // Rank/Level - use single-hue sequential
    if (['Rank', 'Level', 'Index'].includes(semanticType)) {
        return { scheme: 'purples', type: 'sequential', reason: 'ranks use single-hue sequential' };
    }

    // Age groups / ranges - use sequential
    if (['AgeGroup', 'Range', 'Bucket'].includes(semanticType)) {
        return { scheme: 'blues', type: 'sequential', reason: 'age/range groups use sequential' };
    }

    // Temporal granules (Year, Month, Quarter, etc.) - sequential for continuity
    if (ORDINAL_TYPES.has(semanticType) && ['Year', 'Quarter', 'Month', 'Week', 'Day', 'Hour', 'Decade'].includes(semanticType)) {
        return { scheme: 'viridis', type: 'sequential', reason: 'temporal granules use perceptually uniform' };
    }

    // Geographic locations - use geographic-friendly palettes
    if (GEO_LOCATION_TYPES.has(semanticType)) {
        if (uniqueValueCount <= 10) {
            return { scheme: 'set2', type: 'categorical', reason: 'geographic regions use distinct pastels' };
        }
        return { scheme: 'tableau20', type: 'categorical', reason: 'many regions use large categorical' };
    }

    // Status/Boolean/Binary - use accent colors for clear distinction
    if (['Status', 'Boolean', 'Binary'].includes(semanticType)) {
        return { scheme: 'set1', type: 'categorical', reason: 'status uses high-contrast categorical' };
    }

    // Categories/Types - use standard categorical
    if (['Category', 'Type', 'Code'].includes(semanticType)) {
        return { 
            scheme: uniqueValueCount > 10 ? 'tableau20' : 'tableau10', 
            type: 'categorical', 
            reason: 'categories use standard categorical' 
        };
    }

    // Companies/Brands/Products - use paired for small sets, tableau for large
    if (['Company', 'Brand', 'Product', 'Department'].includes(semanticType)) {
        return { 
            scheme: uniqueValueCount > 10 ? 'tableau20' : 'paired', 
            type: 'categorical', 
            reason: 'entities use distinct categorical' 
        };
    }

    // Person names - use saturated schemes for readability; only pastel for very small sets
    if (['Name', 'PersonName', 'Username'].includes(semanticType)) {
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
    if (MEASURE_TYPES.has(semanticType)) {
        const sequentialSchemes = ['viridis', 'blues', 'greens', 'reds', 'yelloworangebrown', 'goldgreen'];
        return { 
            scheme: pickScheme(sequentialSchemes, fieldName), 
            type: 'sequential', 
            reason: 'measures use perceptually uniform sequential' 
        };
    }

    // Ordinal types not already handled
    if (ORDINAL_TYPES.has(semanticType) || encodingType === 'ordinal') {
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

/**
 * Get recommended color scheme with midpoint calculation for diverging schemes.
 * This is a convenience wrapper that combines scheme recommendation with midpoint calculation.
 * 
 * @param semanticType - The semantic type of the field
 * @param encodingType - The Vega-Lite encoding type
 * @param values - The actual data values (for calculating midpoint and unique count)
 * @param fieldName - Field name (for consistent hashing)
 */
export function getRecommendedColorSchemeWithMidpoint(
    semanticType: string | undefined,
    encodingType: 'nominal' | 'ordinal' | 'quantitative' | 'temporal',
    values: any[],
    fieldName: string = ''
): ColorSchemeRecommendation {
    const uniqueValues = [...new Set(values)];
    const recommendation = getRecommendedColorScheme(
        semanticType,
        encodingType,
        uniqueValues.length,
        fieldName,
        values
    );
    
    // For diverging schemes, calculate the midpoint
    if (recommendation.type === 'diverging' && encodingType === 'quantitative') {
        const numericValues = values.filter(v => typeof v === 'number' && !isNaN(v));
        const midpoint = getDivergingMidpoint(semanticType, numericValues);
        if (midpoint !== undefined) {
            recommendation.domainMid = midpoint;
        }
    }
    
    return recommendation;
}

