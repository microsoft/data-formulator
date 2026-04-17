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
    fullPngDataUrl: string;     // Full-size PNG data URL (for agent/report use)
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
 * Get a higher-resolution PNG data URL from the cached SVG.
 * Renders the SVG onto a canvas at specified dimensions and
 * exports as a PNG data URL suitable for sending to a vision model.
 * Falls back to the thumbnail if SVG rendering fails.
 */
export async function getChartPngDataUrl(
    chartId: string,
    width: number = 400,
    height: number = 400,
): Promise<string | undefined> {
    const entry = cache.get(chartId);
    if (!entry) return undefined;

    // Use the full-res PNG from Vega's canvas renderer (avoids fragile SVG→Image→Canvas pipeline)
    if (entry.fullPngDataUrl) {
        return entry.fullPngDataUrl;
    }

    // Fallback to thumbnail if full PNG is not available
    return entry.thumbnailDataUrl || undefined;
}

/**
 * Downscale an image data URL for sending to an AI agent.
 * Renders the original onto a smaller canvas to reduce payload size
 * while preserving the original chart layout.
 */
export async function downscaleImageForAgent(
    dataUrl: string,
    maxDim: number = 200,
    quality: number = 0.75,
): Promise<string> {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = dataUrl;
    });
    const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
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
    tableMetadata?: any,
): string {
    return JSON.stringify({
        chartType,
        encodingMap,
        config: config || {},
        tableRowCount,
        tableContentHash: tableContentHash || tableId,
        tableMetadata: tableMetadata || {},
    });
}
