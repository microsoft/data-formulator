// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart encoding recommendation utility.
 *
 * Given a chart type and a DictTable, recommends which table fields best fit
 * each encoding channel so the user can see basic trends immediately after
 * selecting a chart type.
 */

import { DictTable, EncodingItem, FieldItem } from './ComponentType';
import { Type } from '../data/types';
import { getChartChannels } from './ChartTemplates';

// ---------------------------------------------------------------------------
// Field classification
// ---------------------------------------------------------------------------

const TEMPORAL_SEMANTIC_TYPES = new Set([
    'Date', 'DateTime', 'YearMonth', 'Year', 'Decade', 'Duration',
]);

function isTemporalField(type: Type, semanticType: string): boolean {
    return type === Type.Date || TEMPORAL_SEMANTIC_TYPES.has(semanticType);
}

function isQuantitativeField(type: Type, semanticType: string): boolean {
    return !isTemporalField(type, semanticType) && (type === Type.Number || type === Type.Integer);
}

function nameMatches(name: string, patterns: string[]): boolean {
    const lower = name.toLowerCase();
    return patterns.some(p => lower === p) || patterns.some(p => lower.includes(p));
}

/**
 * Find a random unused field in `table` matching a predicate.
 * When multiple fields qualify, one is chosen at random.
 * Marks the chosen field as used.
 */
function pick(
    table: DictTable,
    used: Set<string>,
    predicate: (name: string, type: Type, semanticType: string, cardinality: number) => boolean,
): string | undefined {
    const candidates: string[] = [];
    for (const name of table.names) {
        if (used.has(name)) continue;
        const meta = table.metadata[name];
        const type = meta?.type ?? Type.String;
        const semanticType = meta?.semanticType ?? '';
        const cardinality = meta?.levels?.length ?? 0;
        if (predicate(name, type, semanticType, cardinality)) {
            candidates.push(name);
        }
    }
    if (candidates.length === 0) return undefined;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(chosen);
    return chosen;
}

// Convenience wrappers
const pickQuantitative = (t: DictTable, u: Set<string>) =>
    pick(t, u, (_n, ty, st) => isQuantitativeField(ty, st));

const pickTemporal = (t: DictTable, u: Set<string>) =>
    pick(t, u, (_n, ty, st) => isTemporalField(ty, st));

const pickNominal = (t: DictTable, u: Set<string>) =>
    pick(t, u, (_n, ty, st) => !isQuantitativeField(ty, st) && !isTemporalField(ty, st));

const pickLowCardNominal = (t: DictTable, u: Set<string>, maxCard = 20) =>
    pick(t, u, (_n, ty, st, card) => !isQuantitativeField(ty, st) && !isTemporalField(ty, st) && card > 0 && card <= maxCard);

/** Temporal first, fall back to nominal – good for a primary axis (line / bar x). */
const pickAxisField = (t: DictTable, u: Set<string>) =>
    pickTemporal(t, u) ?? pickNominal(t, u);

// ---------------------------------------------------------------------------
// Per-chart-type recommendation logic
// ---------------------------------------------------------------------------

/**
 * Returns `{ channel: fieldName }` for the channels that should be
 * auto-filled.  Each case uses a shared `used` set so the same field
 * isn't assigned to multiple channels.
 */
function getRecommendation(chartType: string, table: DictTable): Record<string, string> {
    const used = new Set<string>();
    const rec: Record<string, string> = {};

    const assign = (channel: string, fieldName: string | undefined) => {
        if (fieldName) rec[channel] = fieldName;
    };

    switch (chartType) {
        case 'Scatter Plot':
        case 'Linear Regression': {
            assign('x', pickQuantitative(table, used));
            assign('y', pickQuantitative(table, used));
            assign('color', pickLowCardNominal(table, used));
            break;
        }
        case 'Bar Chart': {
            assign('x', pickAxisField(table, used));
            assign('y', pickQuantitative(table, used));
            break;
        }
        case 'Grouped Bar Chart':
        case 'Stacked Bar Chart': {
            assign('x', pickNominal(table, used));
            assign('y', pickQuantitative(table, used));
            assign('color', pickLowCardNominal(table, used));
            break;
        }
        case 'Ranged Dot Plot': {
            assign('y', pickNominal(table, used));
            assign('x', pickQuantitative(table, used));
            break;
        }
        case 'Pyramid Chart': {
            assign('y', pickNominal(table, used));
            assign('x', pickQuantitative(table, used));
            assign('color', pickLowCardNominal(table, used));
            break;
        }
        case 'Histogram': {
            assign('x', pickQuantitative(table, used));
            // y is typically count – leave empty so Vega-Lite infers aggregate
            break;
        }
        case 'Heatmap': {
            assign('x', pickNominal(table, used));
            assign('y', pickNominal(table, used));
            assign('color', pickQuantitative(table, used));
            break;
        }
        case 'Line Chart':
        case 'Dotted Line Chart': {
            assign('x', pickAxisField(table, used));
            assign('y', pickQuantitative(table, used));
            assign('color', pickLowCardNominal(table, used));
            break;
        }
        case 'Boxplot': {
            assign('x', pickNominal(table, used));
            assign('y', pickQuantitative(table, used));
            break;
        }
        case 'Pie Chart': {
            assign('theta', pickQuantitative(table, used));
            assign('color', pickLowCardNominal(table, used));
            break;
        }
        case 'US Map':
        case 'World Map': {
            assign('latitude',  pick(table, used, (n) => nameMatches(n, ['latitude', 'lat'])));
            assign('longitude', pick(table, used, (n) => nameMatches(n, ['longitude', 'lon', 'lng', 'long'])));
            assign('color', pickLowCardNominal(table, used));
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
