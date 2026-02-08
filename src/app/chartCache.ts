// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Module-level chart render cache.
 * 
 * Stores pre-rendered SVG and PNG thumbnail data for each chart,
 * keyed by chart ID. A specKey is stored alongside to detect
 * when the chart's inputs have changed and re-rendering is needed.
 * 
 * This is deliberately NOT stored in Redux to avoid:
 * - Bloating serializable state with large SVG/PNG strings
 * - Breaking Redux DevTools with huge payloads
 * - Persisting stale render artifacts across sessions
 */

export interface ChartCacheEntry {
    svg: string;                // Full-size SVG string (for VisualizationView)
    thumbnailDataUrl: string;   // PNG data URL (for DataThread thumbnails)
    specKey: string;            // Deterministic key of the inputs that produced this render
}

const cache = new Map<string, ChartCacheEntry>();

/** Get a cached entry for a chart. Returns undefined if not cached. */
export function getCachedChart(chartId: string): ChartCacheEntry | undefined {
    return cache.get(chartId);
}

/** Store a rendered chart in the cache. */
export function setCachedChart(chartId: string, entry: ChartCacheEntry): void {
    cache.set(chartId, entry);
}

/** Remove a chart from the cache (e.g., on deletion). */
export function invalidateChart(chartId: string): void {
    cache.delete(chartId);
}

/** Clear the entire cache. */
export function clearCache(): void {
    cache.clear();
}

/**
 * Compute a deterministic cache key from chart rendering inputs.
 * This is used to detect when a chart needs re-rendering.
 * We intentionally use JSON.stringify for simplicity — it's fast enough
 * for the data sizes involved (~KB range).
 */
export function computeCacheKey(
    chartType: string,
    encodingMap: any,
    config: any,
    tableRowCount: number,
    tableContentHash: string | undefined,
    tableId: string,
): string {
    return JSON.stringify({
        chartType,
        encodingMap,
        config: config || {},
        tableRowCount,
        tableContentHash: tableContentHash || tableId,
    });
}
