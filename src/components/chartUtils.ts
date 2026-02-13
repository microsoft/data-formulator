// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart encoding recommendation engine.
 *
 * Heuristic-based logic that, given a chart type and table data,
 * recommends which fields best fit each encoding channel.
 * This is app-level logic — not part of the reusable agents-chart-lib library.
 */

import { DictTable, EncodingItem, FieldItem } from './ComponentType';
import {
    getTemplateChannels,
} from '../lib/agents-chart-lib';
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
} from '../lib/agents-chart-lib/semantic-types';

// ---------------------------------------------------------------------------
// Internal Table View (built from data + semanticTypes)
// ---------------------------------------------------------------------------

interface InternalTableView {
    names: string[];
    fieldType: Record<string, string>;
    fieldSemanticType: Record<string, string>;
    fieldLevels: Record<string, any[]>;
    rows: any[];
}

function buildTableView(data: any[], semanticTypes: Record<string, string>): InternalTableView {
    const names = data.length > 0 ? Object.keys(data[0]) : [];
    const fieldType: Record<string, string> = {};
    const fieldSemanticType: Record<string, string> = {};
    const fieldLevels: Record<string, any[]> = {};

    for (const name of names) {
        const values = data.map(r => r[name]);
        const semanticType = semanticTypes[name] || '';
        // Prefer vis category from semantic type; fall back to data-driven inference
        fieldType[name] = (semanticType && getVisCategory(semanticType)) || inferVisCategory(values);
        fieldSemanticType[name] = semanticType;
        fieldLevels[name] = [...new Set(data.map(r => r[name]).filter(v => v != null))];
    }

    return { names, fieldType, fieldSemanticType, fieldLevels, rows: data };
}

// ---------------------------------------------------------------------------
// Field Classification
// ---------------------------------------------------------------------------

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

function isGeoField(semanticType: string): boolean {
    return isGeoType(semanticType);
}

function isCategoricalFieldCheck(type: string, semanticType: string): boolean {
    if (isTemporalField(type, semanticType)) return false;
    if (isQuantitativeField(type, semanticType)) return false;
    return type === 'nominal' || isCategoricalType(semanticType);
}

// Broader check: can this field plausibly serve as a discrete axis?
// Includes nominal, ordinal, temporal, AND low-cardinality quantitative
// fields (e.g. year=1955..2005 with 12 values, cluster=0..5).
function isDiscreteLike(type: string, semanticType: string, cardinality: number, maxCard = 50): boolean {
    if (isCategoricalFieldCheck(type, semanticType)) return true;
    if (isTemporalField(type, semanticType)) return true;
    if (isOrdinalType(semanticType)) return true;
    // Low-cardinality quantitative → treat as discrete
    if (type === 'quantitative' && cardinality > 0 && cardinality <= maxCard) return true;
    return false;
}

function nameMatches(name: string, patterns: string[]): boolean {
    const lower = name.toLowerCase();
    return patterns.some(p => lower === p) || patterns.some(p => lower.includes(p));
}

function isLikelyIdentifierOrRank(name: string): boolean {
    const lower = name.toLowerCase();
    const idPatterns = ['rank', 'id', 'index', 'idx', 'row', 'order', 'position', 'pos'];
    return idPatterns.some(p => lower === p || lower.endsWith('_' + p) || lower.endsWith(p));
}

// ---------------------------------------------------------------------------
// Field Selection Utilities
// ---------------------------------------------------------------------------

function pick(
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
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

// ---------------------------------------------------------------------------
// Convenience Pickers
// ---------------------------------------------------------------------------

const pickQuantitative = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (name, ty, st) =>
        isQuantitativeField(ty, st) && !isLikelyIdentifierOrRank(name)
    );

const pickTemporal = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, ty, st) => isTemporalField(ty, st));

const pickNominal = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, ty, st) => isCategoricalFieldCheck(ty, st));

// Default maxCard is generous — the smart layout system handles overflow
// via column/row faceting, so we don't need to be too restrictive.
const pickLowCardNominal = (tv: InternalTableView, u: Set<string>, maxCard = 30) =>
    pick(tv, u, (_n, ty, st, card) => isCategoricalFieldCheck(ty, st) && card > 0 && card <= maxCard);

const pickOrdinal = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, ty, st, _card, hasLevels) => isOrdinalField(ty, st, hasLevels));

const pickGeo = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, _ty, st) => isGeoField(st));

const pickGeoCoordinate = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, _ty, st) => isGeoCoordinateType(st));

const pickAxisField = (tv: InternalTableView, u: Set<string>) =>
    pickTemporal(tv, u) ?? pickOrdinal(tv, u) ?? pickNominal(tv, u);

// Pick any discrete field (nominal, ordinal, temporal, or low-cardinality quantitative).
// Ideal for bar / lollipop / strip / waterfall / heatmap x-axes where all
// discrete types are acceptable.  Prefers nominal → temporal → low-card quant.
const pickDiscrete = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (name, ty, st, card) =>
        isDiscreteLike(ty, st, card) && !isLikelyIdentifierOrRank(name)
    );

// Same but with a cardinality cap — useful for color / grouping channels.
const pickLowCardDiscrete = (tv: InternalTableView, u: Set<string>, maxCard = 30) =>
    pick(tv, u, (name, ty, st, card) =>
        isDiscreteLike(ty, st, card, maxCard) && card > 0 && card <= maxCard
        && !isLikelyIdentifierOrRank(name)
    );

// Pick a series axis — prefers temporal → ordinal → nominal.
// Used by line / area / streamgraph where temporal is the best fit.
const pickSeriesAxis = (tv: InternalTableView, u: Set<string>) =>
    pickTemporal(tv, u) ?? pickOrdinal(tv, u) ?? pickNominal(tv, u);

// Pick a quantitative field whose name matches one of `patterns`
const pickQuantitativeByName = (tv: InternalTableView, u: Set<string>, patterns: string[]) =>
    pick(tv, u, (name, ty, st) =>
        isQuantitativeField(ty, st) && nameMatches(name, patterns)
    );

// Pick all quantitative fields (for radar charts that need many numeric axes)
function pickAllQuantitative(tv: InternalTableView, used: Set<string>): string[] {
    const result: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        if (isQuantitativeField(type, semanticType) && !isLikelyIdentifierOrRank(name)) {
            result.push(name);
        }
    }
    for (const name of result) used.add(name);
    return result;
}

// ---------------------------------------------------------------------------
// Data Analysis Utilities
// ---------------------------------------------------------------------------

function hasMultipleValuesPerField(tv: InternalTableView, fieldName: string): boolean {
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

function pickValidGroupingField(
    tv: InternalTableView,
    used: Set<string>,
    xField: string,
    maxCard = 20,
): string | undefined {
    const candidates: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        const cardinality = tv.fieldLevels[name]?.length ?? 0;
        if (!isDiscreteLike(type, semanticType, cardinality, maxCard)) continue;
        if (cardinality <= 0 || cardinality > maxCard) continue;
        if (isLikelyIdentifierOrRank(name)) continue;
        if (isValidGroupingField(tv, xField, name)) {
            candidates.push(name);
        }
    }
    if (candidates.length === 0) return undefined;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

function isValidLineSeriesData(tv: InternalTableView, xField: string, colorField?: string): boolean {
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

function pickLineChartColorField(
    tv: InternalTableView,
    used: Set<string>,
    xField: string,
    maxCard = 20,
): string | undefined {
    const candidates: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        const cardinality = tv.fieldLevels[name]?.length ?? 0;
        if (!isDiscreteLike(type, semanticType, cardinality, maxCard)) continue;
        if (cardinality <= 0 || cardinality > maxCard) continue;
        if (isLikelyIdentifierOrRank(name)) continue;
        if (isValidLineSeriesData(tv, xField, name)) {
            candidates.push(name);
        }
    }
    if (candidates.length === 0) return undefined;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

function calculateMultiplicity(tv: InternalTableView, xField: string, colorField?: string): number {
    if (!tv.rows || tv.rows.length === 0) return 1;
    const groups = new Set<string>();
    for (const row of tv.rows) {
        const key = colorField
            ? `${row[xField]}|||${row[colorField]}`
            : `${row[xField]}`;
        groups.add(key);
    }
    return tv.rows.length / groups.size;
}

function pickBestGroupingField(
    tv: InternalTableView,
    used: Set<string>,
    xField: string,
    maxMultiplicity = 5,
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
        if (isLikelyIdentifierOrRank(name)) continue;

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

// ---------------------------------------------------------------------------
// Per-chart-type Recommendation Logic
// ---------------------------------------------------------------------------

function getRecommendation(chartType: string, tv: InternalTableView): Record<string, string> {
    const used = new Set<string>();
    const rec: Record<string, string> = {};

    const assign = (channel: string, fieldName: string | undefined) => {
        if (fieldName) rec[channel] = fieldName;
    };

    switch (chartType) {
        case 'Scatter Plot':
        case 'Linear Regression': {
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
            // Color must form a valid grouping with x (each x×color → unique row)
            const colorField = pickValidGroupingField(tv, used, xField, 20);
            if (!colorField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', colorField);
            break;
        }

        case 'Ranged Dot Plot': {
            const yField = pickGeo(tv, used) ?? pickDiscrete(tv, used);
            const xField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('y', yField);
            assign('x', xField);
            break;
        }

        case 'Pyramid Chart': {
            const yField = pickDiscrete(tv, used);
            const xField = pickQuantitative(tv, used);
            const colorField = pickLowCardDiscrete(tv, used, 10);
            if (!xField || !yField || !colorField) return {};
            assign('y', yField);
            assign('x', xField);
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
            const xField = pickDiscrete(tv, used);
            const yField = pickDiscrete(tv, used);
            const colorField = pickQuantitative(tv, used);
            if (!xField || !yField || !colorField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', colorField);
            break;
        }

        case 'Line Chart':
        case 'Dotted Line Chart': {
            const xField = pickSeriesAxis(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            if (!isValidLineSeriesData(tv, xField, undefined)) {
                // Multiple values per x — must find a grouping field to resolve duplicates.
                // Try strict limit first, then relax if needed.
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
            const thetaField = pickQuantitative(tv, used);
            const colorField = pickLowCardDiscrete(tv, used, 12);
            if (!thetaField || !colorField) return {};
            assign('theta', thetaField);
            assign('color', colorField);
            break;
        }

        case 'US Map':
        case 'World Map': {
            const latField = pick(tv, used, (_n, _ty, st) => st === 'Latitude')
                ?? pick(tv, used, (n) => nameMatches(n, ['latitude', 'lat']));
            const lonField = pick(tv, used, (_n, _ty, st) => st === 'Longitude')
                ?? pick(tv, used, (n) => nameMatches(n, ['longitude', 'lon', 'lng', 'long']));
            if (!latField || !lonField) return {};
            assign('latitude', latField);
            assign('longitude', lonField);
            assign('color', pickQuantitative(tv, used) ?? pickLowCardNominal(tv, used));
            break;
        }

        // ---- Area / Streamgraph ----
        case 'Area Chart': {
            // Like line chart: x → temporal/ordinal/nominal, y → quantitative, color → series
            const xField = pickSeriesAxis(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            const colorField = pickLineChartColorField(tv, used, xField, 20);
            assign('color', colorField);
            break;
        }

        case 'Streamgraph': {
            // x → temporal/ordinal/nominal, y → quantitative, color → discrete (required for stacking)
            const xField = pickSeriesAxis(tv, used);
            const yField = pickQuantitative(tv, used);
            const colorField = pickLowCardDiscrete(tv, used, 20);
            if (!xField || !yField || !colorField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', colorField);
            break;
        }

        // ---- Lollipop ----
        case 'Lollipop Chart': {
            // Like bar chart: x → any discrete, y → quantitative
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

        // ---- Density Plot ----
        case 'Density Plot': {
            // x → quantitative (the distribution axis), color → group
            const xField = pickQuantitative(tv, used);
            if (!xField) return {};
            assign('x', xField);
            assign('color', pickLowCardNominal(tv, used, 15));
            break;
        }

        // ---- Candlestick ----
        case 'Candlestick Chart': {
            // x → temporal (date) preferred, but any discrete axis works
            const xField = pickTemporal(tv, used)
                ?? pickQuantitativeByName(tv, used, ['date', 'time', 'day'])
                ?? pickDiscrete(tv, used);
            if (!xField) return {};
            assign('x', xField);
            // Try to match OHLC by field names
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
                // Fallback: assign any 4 quantitative fields in order
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

        // ---- Waterfall ----
        case 'Waterfall Chart': {
            // x → any discrete (categories/steps), y → quantitative (values)
            const xField = pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            // Color is auto-computed by postProcessor (total/increase/decrease)
            break;
        }

        // ---- Strip / Jitter Plot ----
        case 'Strip Plot': {
            // x → any discrete (category axis), y → quantitative (value axis)
            const xField = pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', pickLowCardDiscrete(tv, used, 20));
            break;
        }

        // ---- Radar Chart ----
        case 'Radar Chart': {
            // x → any discrete (entity/group), y → first quantitative (the rest auto-detected)
            const xField = pickLowCardDiscrete(tv, used, 20) ?? pickDiscrete(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!yField) return {};
            assign('y', yField);
            if (xField) assign('x', xField);
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
 * data and semantic types.  Returns a partial encoding map (only channels
 * with a suggested field) that can be merged into the chart's current encodingMap.
 *
 * Only fills channels that the chart template actually declares.
 */
export function recommendEncodings(
    chartType: string,
    table: DictTable,
    conceptShelfItems: FieldItem[],
): Partial<Record<string, EncodingItem>> {
    // Extract semantic types from table metadata
    const semanticTypes: Record<string, string> = {};
    for (const [fieldName, meta] of Object.entries(table.metadata)) {
        if (meta?.semanticType) {
            semanticTypes[fieldName] = meta.semanticType;
        }
    }

    // Build internal view and run recommendation heuristic
    const tv = buildTableView(table.rows, semanticTypes);
    const channelToFieldName = getRecommendation(chartType, tv);

    // Filter to channels that actually exist on this template
    const channels = getTemplateChannels(chartType);
    const result: Partial<Record<string, EncodingItem>> = {};
    for (const [channel, fieldName] of Object.entries(channelToFieldName)) {
        if (channels.includes(channel)) {
            const fieldItem = conceptShelfItems.find(f => f.name === fieldName && table.names.includes(f.name));
            if (fieldItem) {
                result[channel] = { fieldID: fieldItem.id };
            }
        }
    }

    return result;
}
