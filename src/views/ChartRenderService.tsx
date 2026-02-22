// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ChartRenderService — headless chart rendering background service.
 *
 * This invisible component watches all charts in the Redux store and
 * renders them off-screen using Vega's headless rendering pipeline:
 *   vegaLite.compile() → vega.parse() → new vega.View() → toSVG() / toImageURL('png')
 *
 * Results are stored in:
 *   1. Module-level chartCache (SVG + PNG) — for VisualizationView to read
 *   2. chart.thumbnail in Redux (PNG data URL) — for DataThread <img> tags
 *
 * This eliminates redundant DOM-based Vega rendering in DataThread
 * and EncodingShelfThread, replacing heavy <VegaLite> / embed() calls
 * with lightweight <img src={thumbnail}> elements.
 */

import { FC, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { Chart, DictTable, FieldItem } from '../components/ComponentType';
import { assembleVegaChart, prepVisTable } from '../app/utils';
import { getDataTable, checkChartAvailability } from './VisualizationView';
import { getCachedChart, setCachedChart, computeCacheKey, invalidateChart, ChartCacheEntry } from '../app/chartCache';
import { compile } from 'vega-lite';
import { parse, View } from 'vega';
import _ from 'lodash';

/** Thumbnail rendering dimensions (matches DataThread's 100×80 spec assembly) */
const THUMB_WIDTH = 120;
const THUMB_HEIGHT = 90;

/** Full-size base rendering dimensions */
const FULL_WIDTH = 300;
const FULL_HEIGHT = 300;

/** Maximum rows to use for thumbnail rendering (matches DataThread's sampling) */
const MAX_THUMBNAIL_ROWS = 1000;

interface RenderJob {
    chart: Chart;
    table: DictTable;
    conceptShelfItems: FieldItem[];
    cacheKey: string;
}

/**
 * Render a Vega-Lite spec headlessly to SVG and PNG.
 * Uses vega.View with no DOM attachment — pure string/canvas output.
 */
async function renderHeadless(
    vlSpec: any,
): Promise<{ svg: string; pngDataUrl: string }> {
    // Compile Vega-Lite → Vega spec
    const vgSpec = compile(vlSpec as any).spec;

    // Parse into Vega runtime dataflow
    const runtime = parse(vgSpec);

    // Create a headless View (no DOM container needed)
    const view = new View(runtime, { renderer: 'none' });

    // Initialize the view (runs dataflow)
    await view.runAsync();

    // Generate SVG string and PNG data URL in parallel
    const [svg, pngDataUrl] = await Promise.all([
        view.toSVG(),
        view.toImageURL('png', 2),  // scale factor 2 for retina
    ]);

    // Finalize the view to free resources
    view.finalize();

    return { svg, pngDataUrl };
}

/**
 * Scale a PNG data URL down to the given dimensions.
 * Renders the full-size image onto a smaller canvas to produce a
 * properly downscaled thumbnail that preserves the chart's visual
 * appearance (avoiding Vega-Lite layout optimizations for small sizes).
 */
async function scalePngDown(
    pngDataUrl: string,
    targetWidth: number,
    targetHeight: number,
): Promise<string> {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = pngDataUrl;
    });

    // Compute scaled size that fits within target bounds while preserving aspect ratio
    const scale = Math.min(targetWidth / img.width, targetHeight / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w * 2;   // 2x for retina
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/png');
}

export const ChartRenderService: FC = () => {
    const dispatch = useDispatch();

    const charts = useSelector(dfSelectors.getAllCharts);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);
    const maxStretchFactor = useSelector((state: DataFormulatorState) => state.config.maxStretchFactor);

    // Track which charts are currently being rendered to avoid duplicates
    const renderingRef = useRef<Set<string>>(new Set());

    // Track previous chart count for cleanup
    const prevChartIdsRef = useRef<Set<string>>(new Set());

    const processChart = useCallback(async (job: RenderJob) => {
        const { chart, table, conceptShelfItems: items, cacheKey } = job;

        // Skip if already rendering this chart
        if (renderingRef.current.has(chart.id)) return;
        renderingRef.current.add(chart.id);

        try {
            // --- Prepare data (mirror MemoizedChartObject's pipeline) ---
            let visTableRows: any[];
            if (table.rows.length > MAX_THUMBNAIL_ROWS) {
                // Use deterministic sampling (same seed) for stability
                visTableRows = structuredClone(_.sampleSize(table.rows, MAX_THUMBNAIL_ROWS));
            } else {
                visTableRows = structuredClone(table.rows);
            }

            // Pre-aggregate for the encoding map
            visTableRows = prepVisTable(visTableRows, items, chart.encodingMap);

            // --- Assemble full-size spec (with tooltips) ---
            // We render at the default full size and scale down for the thumbnail,
            // so the chart looks like a miniature of the real thing instead of a
            // completely different chart due to Vega-Lite layout optimizations.
            const fullSpec = assembleVegaChart(
                chart.chartType,
                chart.encodingMap,
                items,
                visTableRows,
                table.metadata,
                FULL_WIDTH,
                FULL_HEIGHT,
                true,   // add tooltips
                chart.config,
                1,
                maxStretchFactor,
            );

            if (!fullSpec || fullSpec === "Table") return;
            fullSpec['background'] = 'white';

            // --- Render headlessly (single full-size render) ---
            const fullResult = await renderHeadless(fullSpec);

            // Scale the full-size PNG down to thumbnail dimensions
            const thumbnailPng = await scalePngDown(
                fullResult.pngDataUrl,
                THUMB_WIDTH,
                THUMB_HEIGHT,
            );

            // --- Store in cache ---
            const entry: ChartCacheEntry = {
                svg: fullResult.svg,
                thumbnailDataUrl: thumbnailPng,
                specKey: cacheKey,
            };
            setCachedChart(chart.id, entry);

            // --- Dispatch thumbnail to Redux for DataThread ---
            dispatch(dfActions.updateChartThumbnail({
                chartId: chart.id,
                thumbnail: thumbnailPng,
            }));

        } catch (err) {
            // Rendering failures are non-fatal — chart will just show skeleton
            console.warn(`ChartRenderService: failed to render chart ${chart.id}`, err);
        } finally {
            renderingRef.current.delete(chart.id);
        }
    }, [dispatch]);

    useEffect(() => {
        // Clean up cache entries for deleted charts
        const currentIds = new Set(charts.map(c => c.id));
        for (const prevId of prevChartIdsRef.current) {
            if (!currentIds.has(prevId)) {
                invalidateChart(prevId);
            }
        }
        prevChartIdsRef.current = currentIds;

        // Build render jobs for charts that need (re-)rendering
        const jobs: RenderJob[] = [];

        for (const chart of charts) {
            // Skip non-renderable chart types
            if (['Auto', '?', 'Table'].includes(chart.chartType)) continue;

            // Skip charts whose synthesis is in progress
            if (chartSynthesisInProgress.includes(chart.id)) continue;

            // Get the chart's data table
            const table = getDataTable(chart, tables, charts, conceptShelfItems);
            if (!table || table.rows.length === 0) continue;

            // Check if chart fields are available in the table
            if (!checkChartAvailability(chart, conceptShelfItems, table.rows)) continue;

            // Compute cache key and check if rendering is needed
            const cacheKey = computeCacheKey(
                chart.chartType,
                chart.encodingMap,
                chart.config,
                table.rows.length,
                table.contentHash,
                table.id,
            );

            const cached = getCachedChart(chart.id);
            if (cached && cached.specKey === cacheKey) {
                // Already up-to-date — but ensure Redux thumbnail is set
                // (e.g., after page reload where module cache is cleared but Redux persisted)
                if (!chart.thumbnail || chart.thumbnail !== cached.thumbnailDataUrl) {
                    dispatch(dfActions.updateChartThumbnail({
                        chartId: chart.id,
                        thumbnail: cached.thumbnailDataUrl,
                    }));
                }
                continue;
            }

            jobs.push({ chart, table, conceptShelfItems, cacheKey });
        }

        // Process jobs sequentially to avoid overwhelming the browser
        // Use a small delay between renders to keep the UI responsive
        if (jobs.length > 0) {
            let cancelled = false;

            const processJobs = async () => {
                for (const job of jobs) {
                    if (cancelled) break;
                    await processChart(job);
                    // Small yield to let React process updates
                    await new Promise(resolve => setTimeout(resolve, 16));
                }
            };

            processJobs();

            return () => { cancelled = true; };
        }
    }, [charts, tables, conceptShelfItems, chartSynthesisInProgress, processChart, dispatch]);

    // This component renders nothing
    return null;
};
