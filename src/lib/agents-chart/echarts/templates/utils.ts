// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared helper functions for ECharts template hooks.
 * Pure logic — no UI dependencies.
 */

import type { ChannelSemantics, InstantiateContext } from '../../core/types';

// Re-export circumference-pressure functions from core (shared with VL backend)
export {
    computeCircumferencePressure,
    computeEffectiveBarCount,
    type CircumferencePressureParams,
    type CircumferencePressureResult,
} from '../../core/decisions';

// ---------------------------------------------------------------------------
// Discrete-dimension helpers (mirrored from vegalite/templates/utils.ts)
// ---------------------------------------------------------------------------

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/**
 * Get the number of unique non-null values for a field in the data table.
 */
export function getFieldCardinality(field: string, table: any[]): number {
    return new Set(table.map((r: any) => r[field]).filter((v: any) => v != null)).size;
}

/**
 * Determine the discrete type for a given encoding type.
 */
export function resolveDiscreteType(
    currentType: string,
    field: string | undefined,
    table: any[],
): 'nominal' | 'ordinal' {
    if (currentType === 'nominal') return 'nominal';
    if (currentType === 'ordinal') return 'ordinal';
    if (currentType === 'temporal') return 'ordinal';
    if (currentType === 'quantitative' && field && table.length > 0) {
        const cardinality = getFieldCardinality(field, table);
        return cardinality <= 20 ? 'ordinal' : 'nominal';
    }
    return 'nominal';
}

// ---------------------------------------------------------------------------
// ECharts-specific helpers
// ---------------------------------------------------------------------------

/**
 * Extract unique category values from data for a given field, preserving order.
 * If `ordinalSortOrder` is provided, returns values sorted in that canonical order.
 */
export function extractCategories(data: any[], field: string, ordinalSortOrder?: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of data) {
        const val = row[field];
        if (val != null) {
            const key = String(val);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(key);
            }
        }
    }

    // Apply canonical ordinal sort if available
    if (ordinalSortOrder && ordinalSortOrder.length > 0) {
        const orderMap = new Map(ordinalSortOrder.map((v, i) => [v, i]));
        result.sort((a, b) => {
            const ia = orderMap.get(a);
            const ib = orderMap.get(b);
            if (ia !== undefined && ib !== undefined) return ia - ib;
            if (ia !== undefined) return -1;
            if (ib !== undefined) return 1;
            return 0;
        });
    }

    return result;
}

/**
 * Group data by a categorical field.
 * Returns a map: seriesName → rows[].
 */
export function groupBy(data: any[], field: string): Map<string, any[]> {
    const groups = new Map<string, any[]>();
    for (const row of data) {
        const key = String(row[field] ?? '');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
    }
    return groups;
}

/**
 * Build ECharts axis config from a channel semantic.
 */
export function buildAxisConfig(
    cs: ChannelSemantics | undefined,
    position: 'x' | 'y',
    categories?: string[],
): any {
    if (!cs) return { type: 'value' };

    const axisType = isDiscrete(cs.type) ? 'category' : cs.type === 'temporal' ? 'time' : 'value';
    const axis: any = { type: axisType };

    if (axisType === 'category' && categories) {
        axis.data = categories;
    }

    // Add field name as axis name
    if (cs.field) {
        axis.name = cs.field;
        axis.nameLocation = 'middle';
        axis.nameGap = 30;
    }

    return axis;
}

/**
 * Pick a default ECharts color palette.
 */
export const DEFAULT_COLORS = [
    '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
    '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0',
];

/**
 * Detect which axis is the category (banded) axis and which is the value axis.
 * Returns { categoryAxis, valueAxis } with 'x' or 'y'.
 */
export function detectAxes(
    channelSemantics: Record<string, ChannelSemantics>,
): { categoryAxis: 'x' | 'y'; valueAxis: 'x' | 'y' } {
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;

    // If x is discrete → x is category
    if (xCS && isDiscrete(xCS.type)) {
        return { categoryAxis: 'x', valueAxis: 'y' };
    }
    // If y is discrete → y is category (horizontal bars)
    if (yCS && isDiscrete(yCS.type)) {
        return { categoryAxis: 'y', valueAxis: 'x' };
    }
    // Default: x is category
    return { categoryAxis: 'x', valueAxis: 'y' };
}


