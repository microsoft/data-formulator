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
        fieldType[name] = inferVisCategory(values);
        fieldSemanticType[name] = semanticTypes[name] || '';
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

const pickLowCardNominal = (tv: InternalTableView, u: Set<string>, maxCard = 20) =>
    pick(tv, u, (_n, ty, st, card) => isCategoricalFieldCheck(ty, st) && card > 0 && card <= maxCard);

const pickOrdinal = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, ty, st, _card, hasLevels) => isOrdinalField(ty, st, hasLevels));

const pickGeo = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, _ty, st) => isGeoField(st));

const pickGeoCoordinate = (tv: InternalTableView, u: Set<string>) =>
    pick(tv, u, (_n, _ty, st) => isGeoCoordinateType(st));

const pickAxisField = (tv: InternalTableView, u: Set<string>) =>
    pickTemporal(tv, u) ?? pickOrdinal(tv, u) ?? pickNominal(tv, u);

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
    maxCard = 10,
): string | undefined {
    const candidates: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        const cardinality = tv.fieldLevels[name]?.length ?? 0;
        if (!isCategoricalFieldCheck(type, semanticType)) continue;
        if (cardinality <= 0 || cardinality > maxCard) continue;
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
    maxCard = 10,
): string | undefined {
    const candidates: string[] = [];
    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        const cardinality = tv.fieldLevels[name]?.length ?? 0;
        if (!isCategoricalFieldCheck(type, semanticType)) continue;
        if (cardinality <= 0 || cardinality > maxCard) continue;
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
    maxMultiplicity = 3,
): string | undefined {
    const baseMultiplicity = calculateMultiplicity(tv, xField);
    if (baseMultiplicity <= 1.0) return undefined;

    let bestField: string | undefined;
    let bestMultiplicity = baseMultiplicity;

    for (const name of tv.names) {
        if (used.has(name)) continue;
        const type = tv.fieldType[name] ?? 'nominal';
        const semanticType = tv.fieldSemanticType[name] ?? '';
        if (!isCategoricalFieldCheck(type, semanticType)) continue;

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
            const xField = pickNominal(tv, used) ?? pickOrdinal(tv, used) ?? pickTemporal(tv, used);
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
            const xField = pickOrdinal(tv, used) ?? pickNominal(tv, used);
            const yField = pickQuantitative(tv, used);
            const colorField = pickLowCardNominal(tv, used, 10);
            if (!xField || !yField || !colorField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', colorField);
            break;
        }

        case 'Ranged Dot Plot': {
            const yField = pickGeo(tv, used) ?? pickNominal(tv, used);
            const xField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('y', yField);
            assign('x', xField);
            break;
        }

        case 'Pyramid Chart': {
            const yField = pickOrdinal(tv, used) ?? pickNominal(tv, used);
            const xField = pickQuantitative(tv, used);
            const colorField = pickLowCardNominal(tv, used, 5);
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
            const xField = pickOrdinal(tv, used) ?? pickNominal(tv, used);
            const yField = pickNominal(tv, used);
            const colorField = pickQuantitative(tv, used);
            if (!xField || !yField || !colorField) return {};
            assign('x', xField);
            assign('y', yField);
            assign('color', colorField);
            break;
        }

        case 'Line Chart':
        case 'Dotted Line Chart': {
            const xField = pickTemporal(tv, used) ?? pickOrdinal(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            if (isValidLineSeriesData(tv, xField, undefined)) {
                assign('x', xField);
                assign('y', yField);
            } else {
                const colorField = pickLineChartColorField(tv, used, xField, 10);
                if (!colorField) return {};
                assign('x', xField);
                assign('y', yField);
                assign('color', colorField);
            }
            break;
        }

        case 'Boxplot': {
            const xField = pickNominal(tv, used);
            const yField = pickQuantitative(tv, used);
            if (!xField || !yField) return {};
            assign('x', xField);
            assign('y', yField);
            break;
        }

        case 'Pie Chart': {
            const thetaField = pickQuantitative(tv, used);
            const colorField = pickLowCardNominal(tv, used, 7);
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
