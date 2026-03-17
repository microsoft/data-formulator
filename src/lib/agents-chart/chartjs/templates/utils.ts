// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared helper functions for Chart.js template hooks.
 * Pure logic — no UI dependencies.
 */

import type { ChannelSemantics, InstantiateContext } from '../../core/types';
import { pickChartJsPalette } from '../colormap';

// ---------------------------------------------------------------------------
// Discrete-dimension helpers
// ---------------------------------------------------------------------------

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/**
 * Get the number of unique non-null values for a field in the data table.
 */
export function getFieldCardinality(field: string, table: any[]): number {
    return new Set(table.map((r: any) => r[field]).filter((v: any) => v != null)).size;
}

// ---------------------------------------------------------------------------
// Chart.js-specific helpers
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
 * Default Chart.js color palette (RGBA with alpha for fill).
 */
export const DEFAULT_COLORS = [
    'rgba(54, 162, 235, 1)',    // blue
    'rgba(255, 99, 132, 1)',    // red
    'rgba(255, 206, 86, 1)',    // yellow
    'rgba(75, 192, 192, 1)',    // teal
    'rgba(153, 102, 255, 1)',   // purple
    'rgba(255, 159, 64, 1)',    // orange
    'rgba(46, 204, 113, 1)',    // green
    'rgba(52, 73, 94, 1)',      // dark blue-grey
    'rgba(231, 76, 60, 1)',     // red-orange
    'rgba(149, 165, 166, 1)',   // grey
];

export const DEFAULT_BG_COLORS = [
    'rgba(54, 162, 235, 0.6)',
    'rgba(255, 99, 132, 0.6)',
    'rgba(255, 206, 86, 0.6)',
    'rgba(75, 192, 192, 0.6)',
    'rgba(153, 102, 255, 0.6)',
    'rgba(255, 159, 64, 0.6)',
    'rgba(46, 204, 113, 0.6)',
    'rgba(52, 73, 94, 0.6)',
    'rgba(231, 76, 60, 0.6)',
    'rgba(149, 165, 166, 0.6)',
];

// ---------------------------------------------------------------------------
// Color-decisions integration
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const intVal = parseInt(m[1], 16);
    return {
        r: (intVal >> 16) & 255,
        g: (intVal >> 8) & 255,
        b: intVal & 255,
    };
}

function rgbaFromHex(hex: string, alpha: number): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

function applyAlphaToColor(color: string, alpha: number): string {
    const a = Math.max(0, Math.min(1, alpha));
    if (color.startsWith('#')) {
        return rgbaFromHex(color, a);
    }
    if (color.startsWith('rgba')) {
        return color.replace(
            /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
            (_m, r, g, b) => `rgba(${r}, ${g}, ${b}, ${a})`,
        );
    }
    if (color.startsWith('rgb(')) {
        return color.replace(
            /rgb\((\d+),\s*(\d+),\s*(\d+)\)/,
            (_m, r, g, b) => `rgba(${r}, ${g}, ${b}, ${a})`,
        );
    }
    return color;
}

/**
 * 从 color-decisions 解析调色板；若没有决策则回退到 Chart.js 默认 cat10。
 */
export function getChartJsPalette(ctx: InstantiateContext, preferred: 'color' | 'group' = 'color'): string[] {
    const decisions = ctx.colorDecisions;
    const decision =
        preferred === 'color'
            ? decisions?.color ?? decisions?.group
            : decisions?.group ?? decisions?.color;

    const palette = pickChartJsPalette(decision);
    if (palette.length > 0) {
        return palette;
    }
    return DEFAULT_COLORS;
}

/**
 * 取得第 i 个系列的描边色（优先使用统一调色板）。
 */
export function getSeriesBorderColor(palette: string[], index: number): string {
    if (!palette.length) {
        return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    }
    return palette[index % palette.length];
}

/**
 * 取得第 i 个系列的填充色，自动按需要设置透明度。
 */
export function getSeriesBackgroundColor(palette: string[], index: number, alpha = 0.6): string {
    const border = getSeriesBorderColor(palette, index);
    return applyAlphaToColor(border, alpha);
}

/**
 * Detect which axis is the category (banded) axis and which is the value axis.
 */
export function detectAxes(
    channelSemantics: Record<string, ChannelSemantics>,
): { categoryAxis: 'x' | 'y'; valueAxis: 'x' | 'y' } {
    const xCS = channelSemantics.x;
    const yCS = channelSemantics.y;

    if (xCS && isDiscrete(xCS.type)) {
        return { categoryAxis: 'x', valueAxis: 'y' };
    }
    if (yCS && isDiscrete(yCS.type)) {
        return { categoryAxis: 'y', valueAxis: 'x' };
    }
    return { categoryAxis: 'x', valueAxis: 'y' };
}

/**
 * Build category-aligned data array for a subset of rows.
 * Returns values indexed by category position (null for missing).
 */
export function buildCategoryAlignedData(
    rows: any[],
    xField: string,
    yField: string,
    categories: string[],
): (number | null)[] {
    const map = new Map<string, number>();
    for (const row of rows) {
        const key = String(row[xField] ?? '');
        const val = row[yField];
        if (val != null && !isNaN(val)) {
            map.set(key, (map.get(key) ?? 0) + Number(val));
        }
    }
    return categories.map(cat => map.get(cat) ?? null);
}
