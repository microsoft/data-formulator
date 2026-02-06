// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart encoding recommendation utility.
 *
 * Given a chart type and a DictTable, recommends which table fields best fit
 * each encoding channel so the user can see basic trends immediately after
 * selecting a chart type.
 * 
 * Uses the semantic type system from semanticTypes.ts to classify fields
 * and make intelligent encoding recommendations.
 */

import { DictTable, EncodingItem, FieldItem } from './ComponentType';
import { Type } from '../data/types';
import { getChartChannels } from './ChartTemplates';
import {
    isMeasureType,
    isTimeSeriesType,
    isCategoricalType,
    isOrdinalType,
    isGeoType,
    isGeoCoordinateType,
    isNonMeasureNumeric,
    MEASURE_TYPES,
    TIMESERIES_X_TYPES,
    CATEGORICAL_TYPES,
    ORDINAL_TYPES,
    GEO_TYPES,
} from './semanticTypes';

// ---------------------------------------------------------------------------
// Field Classification Functions (using semantic types)
// ---------------------------------------------------------------------------

/**
 * Check if field is temporal (suitable for time-series X axis).
 * Uses both data type and semantic type.
 */
function isTemporalField(type: Type, semanticType: string): boolean {
    return type === Type.Date || isTimeSeriesType(semanticType);
}

/**
 * Check if field is a true quantitative measure (suitable for aggregation).
 * Excludes ordinal numerics like Rank, Year, Month stored as integers.
 */
function isQuantitativeField(type: Type, semanticType: string): boolean {
    if (isTemporalField(type, semanticType)) return false;
    if (type !== Type.Number && type !== Type.Integer) return false;
    // If semantic type indicates non-measure numeric, reject
    if (isNonMeasureNumeric(semanticType)) return false;
    // Accept if it's a known measure type or unknown (empty string)
    return isMeasureType(semanticType) || semanticType === '';
}

/**
 * Check if field is ordinal (has inherent order but discrete categories).
 */
function isOrdinalField(type: Type, semanticType: string, hasLevels: boolean): boolean {
    // Fields with explicit levels (sort order) are ordinal
    if (hasLevels) return true;
    // Check semantic type
    return isOrdinalType(semanticType);
}

/**
 * Check if field represents a geographic location.
 */
function isGeoField(semanticType: string): boolean {
    return isGeoType(semanticType);
}

/**
 * Check if field is good for categorical encoding (color, facet).
 */
function isCategoricalFieldCheck(type: Type, semanticType: string): boolean {
    if (isTemporalField(type, semanticType)) return false;
    if (isQuantitativeField(type, semanticType)) return false;
    // Accept known categorical types or string type
    return type === Type.String || isCategoricalType(semanticType);
}

function nameMatches(name: string, patterns: string[]): boolean {
    const lower = name.toLowerCase();
    return patterns.some(p => lower === p) || patterns.some(p => lower.includes(p));
}

/**
 * Check if field name suggests it's an identifier/rank (not a measure).
 * This is a heuristic fallback when semantic type is not available.
 */
function isLikelyIdentifierOrRank(name: string): boolean {
    const lower = name.toLowerCase();
    const idPatterns = ['rank', 'id', 'index', 'idx', 'row', 'order', 'position', 'pos'];
    return idPatterns.some(p => lower === p || lower.endsWith('_' + p) || lower.endsWith(p));
}

// ---------------------------------------------------------------------------
// Field Selection Utilities
// ---------------------------------------------------------------------------

/**
 * Find a random unused field in `table` matching a predicate.
 * When multiple fields qualify, one is chosen at random.
 * Marks the chosen field as used.
 */
function pick(
    table: DictTable,
    used: Set<string>,
    predicate: (name: string, type: Type, semanticType: string, cardinality: number, hasLevels: boolean) => boolean,
): string | undefined {
    const candidates: string[] = [];
    for (const name of table.names) {
        if (used.has(name)) continue;
        const meta = table.metadata[name];
        const type = meta?.type ?? Type.String;
        const semanticType = meta?.semanticType ?? '';
        const cardinality = meta?.levels?.length ?? 0;
        const hasLevels = (meta?.levels?.length ?? 0) > 0;
        if (predicate(name, type, semanticType, cardinality, hasLevels)) {
            candidates.push(name);
        }
    }
    if (candidates.length === 0) return undefined;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

// ---------------------------------------------------------------------------
// Convenience Pickers (with semantic type awareness)
// ---------------------------------------------------------------------------

/**
 * Pick a quantitative field - a numeric field representing an actual measure.
 * Excludes: Rank, ID, Year/Month as numbers, and other ordinal numerics.
 * 
 * Strategy: Prefer fields with Percentage, Number semantic types.
 *           Exclude fields whose names suggest rank/id.
 */
const pickQuantitative = (t: DictTable, u: Set<string>) =>
    pick(t, u, (name, ty, st, _card, _hasLevels) => 
        isQuantitativeField(ty, st) && !isLikelyIdentifierOrRank(name)
    );

/** Pick a temporal field (Date type or temporal semantic type) */
const pickTemporal = (t: DictTable, u: Set<string>) =>
    pick(t, u, (_n, ty, st) => isTemporalField(ty, st));

/** Pick a nominal/categorical field (not quantitative, not temporal) */
const pickNominal = (t: DictTable, u: Set<string>) =>
    pick(t, u, (_n, ty, st) => isCategoricalFieldCheck(ty, st));

/** Pick a low-cardinality nominal field - good for color encoding */
const pickLowCardNominal = (t: DictTable, u: Set<string>, maxCard = 20) =>
    pick(t, u, (_n, ty, st, card) => isCategoricalFieldCheck(ty, st) && card > 0 && card <= maxCard);

/** Pick an ordinal field - has inherent order but discrete values */
const pickOrdinal = (t: DictTable, u: Set<string>) =>
    pick(t, u, (_n, ty, st, _card, hasLevels) => isOrdinalField(ty, st, hasLevels));

/** Pick a geographic field (semantic type indicates location) */
const pickGeo = (t: DictTable, u: Set<string>) =>
    pick(t, u, (_n, _ty, st) => isGeoField(st));

/** Pick a geographic coordinate field (Latitude, Longitude) */
const pickGeoCoordinate = (t: DictTable, u: Set<string>) =>
    pick(t, u, (_n, _ty, st) => isGeoCoordinateType(st));

/** 
 * Temporal first, fall back to ordinal, then nominal.
 * Good for a primary axis in time-series charts (line / bar x).
 */
const pickAxisField = (t: DictTable, u: Set<string>) =>
    pickTemporal(t, u) ?? pickOrdinal(t, u) ?? pickNominal(t, u);

// ---------------------------------------------------------------------------
// Data Analysis Utilities
// ---------------------------------------------------------------------------

/**
 * Check if a field has duplicate values in the data.
 * Returns true if there are multiple rows with the same value for this field.
 */
function hasMultipleValuesPerField(table: DictTable, fieldName: string): boolean {
    if (!fieldName || !table.rows || table.rows.length === 0) return false;
    const seen = new Set<any>();
    for (const row of table.rows) {
        const val = row[fieldName];
        if (seen.has(val)) return true;
        seen.add(val);
    }
    return false;
}

/**
 * Check if grouping by a color field makes (X, Color) combinations unique.
 * This ensures that within each color group, each X value has only one Y value,
 * resulting in clean lines without overlapping points.
 * 
 * For example, if data has (Date, Company, Price) where each (Date, Company) 
 * is unique, then Company is a valid color field for a line chart with Date on X.
 */
function isValidGroupingField(table: DictTable, xField: string, colorField: string): boolean {
    if (!xField || !colorField || !table.rows || table.rows.length === 0) return false;
    const seen = new Set<string>();
    for (const row of table.rows) {
        const key = `${row[xField]}|||${row[colorField]}`;
        if (seen.has(key)) return false; // Duplicate (X, Color) combination
        seen.add(key);
    }
    return true;
}

/**
 * Find a low-cardinality nominal field that properly partitions the data,
 * such that (X, Color) combinations are unique.
 * This ensures clean lines/bars for each color group.
 */
function pickValidGroupingField(
    table: DictTable, 
    used: Set<string>, 
    xField: string, 
    maxCard = 10
): string | undefined {
    const candidates: string[] = [];
    for (const name of table.names) {
        if (used.has(name)) continue;
        const meta = table.metadata[name];
        const type = meta?.type ?? Type.String;
        const semanticType = meta?.semanticType ?? '';
        const cardinality = meta?.levels?.length ?? 0;
        
        // Must be categorical with reasonable cardinality
        if (!isCategoricalFieldCheck(type, semanticType)) continue;
        if (cardinality <= 0 || cardinality > maxCard) continue;
        
        // Must make (X, Color) unique
        if (isValidGroupingField(table, xField, name)) {
            candidates.push(name);
        }
    }
    if (candidates.length === 0) return undefined;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

/**
 * Check if X field (with optional color grouping) creates valid line series.
 * Requirements:
 * 1. Each (X, Color) combination has at most 1 Y value (multiplicity <= 1)
 * 2. Each color group has at least 2 data points (otherwise it's just dots)
 * 
 * @returns true if the data forms valid line series
 */
function isValidLineSeriesData(table: DictTable, xField: string, colorField?: string): boolean {
    if (!table.rows || table.rows.length === 0) return false;
    
    // Track: unique (X, Color) combinations and count per color group
    const xColorCombinations = new Set<string>();
    const colorGroupCounts = new Map<string, number>();
    
    for (const row of table.rows) {
        const xVal = row[xField];
        const colorVal = colorField ? row[colorField] : '__single__';
        const xColorKey = `${xVal}|||${colorVal}`;
        
        // Check for duplicate (X, Color) - violates requirement 1
        if (xColorCombinations.has(xColorKey)) {
            return false;
        }
        xColorCombinations.add(xColorKey);
        
        // Count points per color group
        colorGroupCounts.set(colorVal, (colorGroupCounts.get(colorVal) ?? 0) + 1);
    }
    
    // Check requirement 2: majority of color groups should have at least 2 points
    let validGroups = 0;
    let totalGroups = 0;
    for (const count of colorGroupCounts.values()) {
        totalGroups++;
        if (count >= 2) validGroups++;
    }
    
    // Require majority (>50%) of groups to have at least 2 points
    return totalGroups > 0 && (validGroups / totalGroups) > 0.5;
}

/**
 * Find a categorical field that creates valid line series:
 * 1. Each (X, Color) has exactly 1 Y value
 * 2. Majority of color groups have at least 2 points
 * 
 * Returns undefined if no valid field exists.
 */
function pickLineChartColorField(
    table: DictTable, 
    used: Set<string>, 
    xField: string, 
    maxCard = 10
): string | undefined {
    const candidates: string[] = [];
    
    for (const name of table.names) {
        if (used.has(name)) continue;
        const meta = table.metadata[name];
        const type = meta?.type ?? Type.String;
        const semanticType = meta?.semanticType ?? '';
        const cardinality = meta?.levels?.length ?? 0;
        
        // Must be categorical with reasonable cardinality
        if (!isCategoricalFieldCheck(type, semanticType)) continue;
        if (cardinality <= 0 || cardinality > maxCard) continue;
        
        // Must create valid line series
        if (isValidLineSeriesData(table, xField, name)) {
            candidates.push(name);
        }
    }
    
    if (candidates.length === 0) return undefined;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

/**
 * Calculate the average multiplicity of Y values per (X, Color) group.
 * Returns rows / unique(X, Color) combinations.
 * A value of 1.0 means perfect 1:1 mapping.
 */
function calculateMultiplicity(table: DictTable, xField: string, colorField?: string): number {
    if (!table.rows || table.rows.length === 0) return 1;
    const groups = new Set<string>();
    for (const row of table.rows) {
        const key = colorField 
            ? `${row[xField]}|||${row[colorField]}`
            : `${row[xField]}`;
        groups.add(key);
    }
    return table.rows.length / groups.size;
}

/**
 * Find a categorical field that best reduces the multiplicity of Y values per X.
 * Prefers fields that achieve 1:1 (X, Color) -> Y mapping.
 * If no perfect field exists, picks the one that reduces multiplicity the most.
 * 
 * Returns undefined if no field can reduce multiplicity below the threshold,
 * or if adding color wouldn't meaningfully reduce multiplicity.
 */
function pickBestGroupingField(
    table: DictTable, 
    used: Set<string>, 
    xField: string, 
    maxMultiplicity = 3  // Don't bother if result still has high multiplicity
): string | undefined {
    const baseMultiplicity = calculateMultiplicity(table, xField);
    
    // If X is already unique, no need for color grouping
    if (baseMultiplicity <= 1.0) return undefined;
    
    let bestField: string | undefined;
    let bestMultiplicity = baseMultiplicity;
    
    for (const name of table.names) {
        if (used.has(name)) continue;
        const meta = table.metadata[name];
        const type = meta?.type ?? Type.String;
        const semanticType = meta?.semanticType ?? '';
        
        // Must be categorical with reasonable cardinality
        if (!isCategoricalFieldCheck(type, semanticType)) continue;
        
        const multiplicity = calculateMultiplicity(table, xField, name);
        
        // Must improve over current best
        if (multiplicity < bestMultiplicity) {
            bestMultiplicity = multiplicity;
            bestField = name;
            // Perfect 1:1 - no need to check more
            if (multiplicity <= 1.0) break;
        }
    }
    
    // Only return if it meaningfully reduces multiplicity and result is acceptable
    if (bestField && bestMultiplicity < baseMultiplicity && bestMultiplicity <= maxMultiplicity) {
        used.add(bestField);
        return bestField;
    }
    
    return undefined;
}

// ---------------------------------------------------------------------------
// Per-chart-type Recommendation Logic
// ---------------------------------------------------------------------------

/**
 * Returns `{ channel: fieldName }` for the channels that should be
 * auto-filled.  Each case uses a shared `used` set so the same field
 * isn't assigned to multiple channels.
 * 
 * Returns empty object if required fields for the chart type cannot be found.
 */
function getRecommendation(chartType: string, table: DictTable): Record<string, string> {
    const used = new Set<string>();
    const rec: Record<string, string> = {};

    const assign = (channel: string, fieldName: string | undefined) => {
        if (fieldName) rec[channel] = fieldName;
    };

    switch (chartType) {
        /**
         * SCATTER PLOT / LINEAR REGRESSION
         * 
         * Required: X, Y (prefer quantitative, but can use temporal/nominal)
         * Optional: Color (categorical)
         * 
         * Strategy: Prefer quantitative measures for both axes, but be flexible.
         * - Best: Amount vs Price, Sales vs Revenue, Height vs Weight
         * - OK: Date vs Price (temporal X), Category vs Price (nominal X)
         * - Avoid: Rank, ID fields (ordinal/identifier semantics)
         * 
         * Color: Low-cardinality categorical for grouping (e.g., Category, Region)
         * 
         * TODO improvements to consider:
         * - Prefer Percentage fields for axes when available (naturally bounded)
         * - Consider field correlation hints if available
         * - Deprioritize fields with very low variance
         */
        case 'Scatter Plot':
        case 'Linear Regression': {
            // Prefer quantitative, fall back to temporal, then nominal
            const yField = pickQuantitative(table, used) ?? pickTemporal(table, used) ?? pickNominal(table, used);
            const xField = pickQuantitative(table, used) ?? pickTemporal(table, used) ?? pickNominal(table, used);
            // Required: both X and Y
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', pickLowCardNominal(table, used));
            break;
        }

        /**
         * BAR CHART
         * 
         * Required: X (categorical/temporal), Y (quantitative)
         * Optional: Color (categorical, when X has duplicates)
         * 
         * Strategy: X should be categorical first, Y should be quantitative.
         * - Best X: Categorical fields (Category, Region, Product) - bar charts excel at comparing categories
         * - OK X: Temporal fields (Year, Month) for time trends, but line charts are often better
         * - Best Y: True measures (Amount, Count, Percentage)
         * - Color: Include when data has multiple Y values per X (to stack/group bars)
         * 
         * TODO improvements to consider:
         * - Prefer ordinal fields with defined levels for X (respects natural order)
         * - Consider cardinality: too many X values = unreadable chart
         * - Auto-suggest aggregation when X has duplicates
         */
        case 'Bar Chart':
        case 'Stacked Bar Chart':  {
            // Bar charts prefer categorical X axis - nominal first, then ordinal, then temporal as fallback
            const xField = pickNominal(table, used) ?? pickOrdinal(table, used) ?? pickTemporal(table, used);
            const yField = pickQuantitative(table, used);
            // Required: both X and Y
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            // Include color to distinguish series when there are multiple Y per X
            // Pick the field that best reduces multiplicity (ideally to 1:1)
            if (hasMultipleValuesPerField(table, xField)) {
                assign('color', pickBestGroupingField(table, used, xField));
            }
            break;
        }

        /**
         * GROUPED / STACKED BAR CHART
         * 
         * Required: X (categorical), Y (quantitative), Color (categorical)
         * 
         * Strategy: X is primary category, Color is secondary grouping, Y is measure.
         * - X: Primary categorical dimension (e.g., Year, Product)
         * - Color: Secondary dimension with low cardinality (e.g., Region, Category)
         * - Y: True quantitative measure (Sum, Count, Amount)
         * 
         * TODO improvements to consider:
         * - X and Color should have meaningful cross-product (not too sparse)
         * - Prefer ordinal X if available (respects order in grouped bars)
         * - Consider total cardinality: X * Color shouldn't be too large
         */
        case 'Grouped Bar Chart': {
            const xField = pickOrdinal(table, used) ?? pickNominal(table, used);
            const yField = pickQuantitative(table, used);
            const colorField = pickLowCardNominal(table, used, 10);
            // Required: X, Y, and Color for grouped/stacked
            if (!xField || !yField || !colorField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', colorField);
            break;
        }

        /**
         * RANGED DOT PLOT
         * 
         * Required: Y (categorical), X (quantitative)
         * 
         * Strategy: Y is categorical (labels), X is quantitative (values/range).
         * - Y: Category names (Product, State, Person)
         * - X: Quantitative measure, often showing range or comparison
         * 
         * TODO improvements to consider:
         * - Good for comparing values across categories
         * - Prefer Name/Location semantic types for Y
         * - Could support x2 for range visualization
         */
        case 'Ranged Dot Plot': {
            const yField = pickGeo(table, used) ?? pickNominal(table, used);
            const xField = pickQuantitative(table, used);
            // Required: both X and Y
            if (!xField || !yField) return {};
            assign('y', yField);
            assign('x', xField);
            break;
        }

        /**
         * PYRAMID CHART
         * 
         * Required: Y (categorical), X (quantitative), Color (categorical)
         * 
         * Strategy: Y is categorical (rows), X is quantitative, Color distinguishes sides.
         * - Y: Categories being compared (Age groups, Regions)
         * - X: Measure for comparison
         * - Color: Binary or low-card field for left/right distinction
         * 
         * TODO improvements to consider:
         * - Ideal for demographic pyramids: Y=Age Range, X=Population, Color=Gender
         * - Prefer ordinal Y (e.g., age ranges with natural order)
         * - Color should ideally have exactly 2 values for true pyramid
         */
        case 'Pyramid Chart': {
            const yField = pickOrdinal(table, used) ?? pickNominal(table, used);
            const xField = pickQuantitative(table, used);
            const colorField = pickLowCardNominal(table, used, 5);
            // Required: Y, X, and Color for pyramid
            if (!xField || !yField || !colorField) return {};
            assign('y', yField);
            assign('x', xField);
            assign('color', colorField);
            break;
        }

        /**
         * HISTOGRAM
         * 
         * Required: X (quantitative)
         * 
         * Strategy: X should be a continuous quantitative field for binning.
         * - Best X: True measures with continuous distribution (Age, Price, Duration)
         * - Avoid: Ordinal numbers (Rank), categorical-like numerics
         * - Y is typically count (auto-aggregated by Vega-Lite)
         * 
         * TODO improvements to consider:
         * - Prefer fields with high cardinality (many unique values)
         * - Percentage fields are good candidates
         * - Avoid discrete/integer fields with very few unique values
         */
        case 'Histogram': {
            const xField = pickQuantitative(table, used);
            // Required: X
            if (!xField) return {};
            assign('x', xField);
            // y is typically count – leave empty so Vega-Lite infers aggregate
            break;
        }

        /**
         * HEATMAP
         * 
         * Required: X (categorical), Y (categorical), Color (quantitative)
         * 
         * Strategy: X and Y are categorical dimensions, Color is the measure.
         * - X, Y: Categorical fields forming a matrix (e.g., Month x Region)
         * - Color: Quantitative measure shown as color intensity
         * 
         * TODO improvements to consider:
         * - Prefer ordinal fields for X (e.g., Month, Weekday) for natural order
         * - Consider cardinality: X * Y should form a reasonable matrix
         * - Temporal fields work well for one axis (Month, Day of Week)
         * - Location fields can be good for geographic heatmaps
         */
        case 'Heatmap': {
            const xField = pickOrdinal(table, used) ?? pickNominal(table, used);
            const yField = pickNominal(table, used);
            const colorField = pickQuantitative(table, used);
            // Required: X, Y, and Color
            if (!xField || !yField || !colorField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', colorField);
            break;
        }

        /**
         * LINE CHART / DOTTED LINE CHART
         * 
         * Required: X (temporal/ordinal), Y (quantitative)
         * Optional: Color (categorical, when needed for valid line series)
         * 
         * Strategy: X should be temporal or ordinal, Y is the measure, Color groups series.
         * - Best X: Date, DateTime, YearMonth, Year (temporal progression) or ordinal fields
         * - Y: Quantitative measure (Stock price, Temperature, Sales)
         * - Color: Categorical field that partitions data properly
         * - X must be ordinal (has inherent order) - nominal fields don't make sense for lines
         * 
         * Line chart validity requirements:
         * 1. Each (X, Color) must have exactly 1 Y value (no overlapping points)
         * 2. Majority of color groups must have >= 2 points (otherwise just dots)
         * 
         * TODO improvements to consider:
         * - Strongly prefer temporal X - line charts imply continuity over time
         * - Consider: is the data actually time-series? Or just sequential?
         * - Color cardinality: too many lines = spaghetti chart
         */
        case 'Line Chart':
        case 'Dotted Line Chart': {
            // Line charts require ordinal X axis (temporal or ordered) - no nominal fallback
            const xField = pickTemporal(table, used) ?? pickOrdinal(table, used);
            const yField = pickQuantitative(table, used);
            // Required: X (ordinal) and Y
            if (!xField || !yField) return {};
            
            // Check if data is valid for line chart
            // First try without color grouping
            if (isValidLineSeriesData(table, xField, undefined)) {
                // Data already valid without color - no grouping needed
                assign('x', xField);
                assign('y', yField);
            } else {
                // Need color field to partition data into valid line series
                const colorField = pickLineChartColorField(table, used, xField, 10);
                if (!colorField) {
                    // Can't create valid line series - don't recommend
                    return {};
                }
                assign('x', xField);
                assign('y', yField);
                assign('color', colorField);
            }
            break;
        }

        /**
         * BOXPLOT
         * 
         * Required: X (categorical), Y (quantitative)
         * 
         * Strategy: X is categorical grouping, Y is the quantitative distribution.
         * - X: Category field to group by (Region, Product Category)
         * - Y: Continuous quantitative field to show distribution (Price, Duration)
         * 
         * TODO improvements to consider:
         * - Y should have enough variance to show meaningful distribution
         * - X cardinality: too many boxes = hard to read
         * - Prefer true measures for Y (not ranks, IDs)
         * - Could support color for additional grouping
         */
        case 'Boxplot': {
            const xField = pickNominal(table, used);
            const yField = pickQuantitative(table, used);
            // Required: X and Y
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            break;
        }

        /**
         * PIE CHART
         * 
         * Required: Theta (quantitative), Color (categorical)
         * 
         * Strategy: Theta is the quantitative measure, Color is category slices.
         * - Theta: Quantitative measure (usually sum/count per category)
         * - Color: Low-cardinality categorical (too many slices = unreadable)
         * 
         * TODO improvements to consider:
         * - Strictly limit color cardinality (5-7 max for readability)
         * - Theta should be positive values (negative = weird rendering)
         * - Prefer Percentage semantic type for theta (naturally sums to whole)
         * - Consider: most data viz experts recommend bar over pie
         */
        case 'Pie Chart': {
            const thetaField = pickQuantitative(table, used);
            const colorField = pickLowCardNominal(table, used, 7);
            // Required: Theta and Color
            if (!thetaField || !colorField) return {};
            assign('theta', thetaField);
            assign('color', colorField);
            break;
        }

        /**
         * US MAP / WORLD MAP
         * 
         * Required: Latitude, Longitude
         * Optional: Color (quantitative or categorical)
         * 
         * Strategy: Lat/Long for positioning, Color for data values.
         * - Latitude/Longitude: Fields with Latitude/Longitude semantic type, or by name matching
         * - Color: Can be quantitative (choropleth) or categorical (region coloring)
         * 
         * TODO improvements to consider:
         * - Support state/country name fields for choropleth maps
         * - Consider size encoding for bubble maps
         * - For choropleth: prefer quantitative color, for categorical: nominal color
         */
        case 'US Map':
        case 'World Map': {
            // First try semantic type matching, then fall back to name matching
            const latField = pick(table, used, (_n, _ty, st) => st === 'Latitude') 
                ?? pick(table, used, (n) => nameMatches(n, ['latitude', 'lat']));
            const lonField = pick(table, used, (_n, _ty, st) => st === 'Longitude')
                ?? pick(table, used, (n) => nameMatches(n, ['longitude', 'lon', 'lng', 'long']));
            // Required: both lat and long
            if (!latField || !lonField) return {};
            assign('latitude', latField);
            assign('longitude', lonField);
            // For maps, quantitative color makes good choropleth, else use categorical
            assign('color', pickQuantitative(table, used) ?? pickLowCardNominal(table, used));
            break;
        }

        default:
            break;
    }

    return rec;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recommend encoding fields for the given chart type based on a table's
 * metadata.  Returns a partial encoding map (only channels with a suggested
 * field) that can be merged into the chart's current encodingMap.
 *
 * Only fills channels that the chart template actually declares.
 */
export function recommendEncodings(
    chartType: string,
    table: DictTable,
    conceptShelfItems: FieldItem[],
): Partial<Record<string, EncodingItem>> {
    const channelToFieldName = getRecommendation(chartType, table);

    // Resolve field names → FieldItem ids
    const result: Partial<Record<string, EncodingItem>> = {};
    const channels = getChartChannels(chartType);

    for (const [channel, fieldName] of Object.entries(channelToFieldName)) {
        if (!channels.includes(channel)) continue;
        const fieldItem = conceptShelfItems.find(f => f.name === fieldName && table.names.includes(f.name));
        if (fieldItem) {
            result[channel] = { fieldID: fieldItem.id };
        }
    }

    return result;
}
