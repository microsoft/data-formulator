// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared module-level cache for display-row samples used by the focused
 * canvas. Lets background services (e.g. ChartRenderService) reuse the
 * same sample the canvas already fetched, so thumbnails match the main
 * chart instead of rendering against the small preview slice that virtual
 * tables ship in `table.rows`.
 *
 * Key shape: `${tableId}-${sortedFields.join('_')}-${contentSuffix}`
 *   where contentSuffix is `${contentHash.slice(0,8)}` if present,
 *   otherwise `${table.rows.length}`.
 */

import { Chart, DictTable, FieldItem } from '../components/ComponentType';
import { extractFieldsFromEncodingMap } from './utils';

export interface DisplayRowsEntry {
    rows: any[];
    totalCount: number;
}

export const displayRowsCache = new Map<string, DisplayRowsEntry>();

/** Build the cache key the canvas uses for a given table + chart. */
export function computeDisplayRowsCacheKey(
    table: DictTable,
    chart: Chart,
    conceptShelfItems: FieldItem[],
): string {
    const { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(
        chart.encodingMap, conceptShelfItems,
    );
    const sortedFields = [
        ...aggregateFields.map(f => `${f[0]}_${f[1]}`),
        ...groupByFields,
    ].sort();
    const contentSuffix = table.contentHash
        ? `-${table.contentHash.slice(0, 8)}`
        : `-${table.rows.length}`;
    return `${table.id}-${sortedFields.join('_')}${contentSuffix}`;
}
