// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts chart assembly — Two-Stage Pipeline Coordinator.
 *
 * Reuses the **same core analysis pipeline** as Vega-Lite:
 *   Phase 0:  resolveSemantics     → ChannelSemantics
 *   Step 0a:  declareLayoutMode    → LayoutDeclaration
 *   Step 0b:  convertTemporalData  → converted data
 *   Step 0c:  filterOverflow       → filtered data, nominalCounts
 *   Phase 1:  computeLayout        → LayoutResult
 *
 * Then diverges for Phase 2 (ECharts-specific):
 *   template.instantiate → builds ECharts option structure
 *   ecApplyLayoutToSpec  → applies layout decisions to option
 *
 * ── Backend Translation Responsibilities ────────────────────────────
 * The LayoutResult from Phase 1 is target-agnostic.  This assembler is
 * responsible for translating it into ECharts-specific structures:
 *
 *   subplotWidth / subplotHeight
 *     → ECharts `grid.width` / `grid.height` (the inner plot area).
 *       The assembler adds ECharts-specific margins (CANVAS_BUFFER,
 *       axis label space, legend width) to compute the outer canvas
 *       `_width` / `_height`.
 *
 *   xStep / yStep / stepPadding
 *     → ECharts `barWidth`, `barCategoryGap`, `barGap` on series.
 *       VL handles this via `width: {step: N}` natively; ECharts has
 *       no such declarative feature, so we compute explicit pixel
 *       values from the layout numbers.
 *
 *   Facet wrapping
 *     → When the user specifies column-only facets, this assembler
 *       computes `maxColsPerRow` using the same parameters VL uses
 *       (facetMaxStretch, minStep, minSubplotSize), restructures the
 *       flat 1×N panels into a wrapped 2D grid, and passes the result
 *       to ecCombineFacetPanels.  The combiner itself has NO wrapping
 *       logic — it renders whatever grid it receives.
 *
 *   Per-panel vs shared axis titles
 *     → The facet combiner keeps Y-axis titles on the left column only
 *       and renders the X-axis title as a shared centered element.
 *
 * Key structural differences from Vega-Lite output:
 *   VL: { mark, encoding, data: {values}, width, height }
 *   EC: { xAxis, yAxis, series: [{type, data}], tooltip, legend, grid }
 *
 * This module has NO React, Redux, or UI framework dependencies.
 */

import {
    ChartEncoding,
    ChartTemplateDef,
    AssembleOptions,
    LayoutDeclaration,
    InstantiateContext,
} from '../core/types';
import type { ChartWarning } from '../core/types';
import { ecGetTemplateDef } from './templates';
import { resolveSemantics, convertTemporalData } from '../core/resolve-semantics';
import { filterOverflow } from '../core/filter-overflow';
import { computeLayout } from '../core/compute-layout';
import { ecApplyLayoutToSpec, ecApplyTooltips } from './instantiate-spec';
import { ecCombineFacetPanels } from './facet';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble an ECharts option object from chart type, encodings, data, and semantic types.
 *
 * The returned object is a complete ECharts option that can be passed to
 * `echartsInstance.setOption(result)`.
 *
 * @returns An ECharts option object with optional `_warnings` and `_width`/`_height` hints
 */
export function ecAssembleChart(
    chartType: string,
    encodings: Record<string, ChartEncoding>,
    data: any[],
    semanticTypes: Record<string, string> = {},
    canvasSize: { width: number; height: number } = { width: 400, height: 320 },
    chartProperties?: Record<string, any>,
    options: AssembleOptions = {},
): any {
    const chartTemplate = ecGetTemplateDef(chartType) as ChartTemplateDef;
    if (!chartTemplate) {
        throw new Error(`Unknown ECharts chart type: ${chartType}. Use ecAllTemplateDefs to see available types.`);
    }

    const warnings: ChartWarning[] = [];

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 0: Resolve Semantics (shared with VL — completely target-agnostic)
    // ═══════════════════════════════════════════════════════════════════════

    // Extract mark type from template (for semantic resolution)
    // ECharts templates still use VL-style `template.mark` for compatibility
    const tplMark = chartTemplate.template?.mark;
    const templateMarkType = typeof tplMark === 'string' ? tplMark : tplMark?.type;

    const channelSemantics = resolveSemantics(
        encodings, data, semanticTypes,
        chartTemplate.markCognitiveChannel,
        templateMarkType,
    );

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0a: declareLayoutMode (shared hook)
    // ═══════════════════════════════════════════════════════════════════════

    const declaration: LayoutDeclaration = chartTemplate.declareLayoutMode
        ? chartTemplate.declareLayoutMode(channelSemantics, data, chartProperties)
        : {};

    // Merge paramOverrides into effective options
    const effectiveOptions: AssembleOptions = {
        ...options,
        ...(declaration.paramOverrides || {}),
    };

    const {
        addTooltips: addTooltipsOpt = false,
    } = effectiveOptions;

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0b: Temporal Data Conversion (shared)
    // ═══════════════════════════════════════════════════════════════════════

    const convertedData = convertTemporalData(data, semanticTypes);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0c: filterOverflow (shared)
    // ═══════════════════════════════════════════════════════════════════════

    const allMarkTypes = new Set<string>();
    if (templateMarkType) allMarkTypes.add(templateMarkType);

    const overflowResult = filterOverflow(
        channelSemantics, declaration, encodings, convertedData,
        canvasSize, effectiveOptions, allMarkTypes,
    );

    let values = overflowResult.filteredData;
    warnings.push(...overflowResult.warnings);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: Compute Layout (shared — completely target-agnostic)
    // ═══════════════════════════════════════════════════════════════════════

    const layoutResult = computeLayout(
        channelSemantics,
        declaration,
        values,
        canvasSize,
        effectiveOptions,
    );

    layoutResult.truncations = overflowResult.truncations;

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: Instantiate ECharts Option (EC-specific)
    // ═══════════════════════════════════════════════════════════════════════

    // --- Build "resolved encodings" for template consumption ---
    // ECharts templates read channelSemantics directly (unlike VL which
    // needs a separate VL encoding translation step). We pass a minimal
    // resolvedEncodings for interface compatibility.
    const resolvedEncodings: Record<string, any> = {};
    for (const [channel, encoding] of Object.entries(encodings)) {
        const cs = channelSemantics[channel];
        if (cs) {
            resolvedEncodings[channel] = {
                field: cs.field,
                type: cs.type,
                aggregate: encoding.aggregate,
            };
        }
    }

    // --- Template instantiate ---

    const instantiateContext: InstantiateContext = {
        channelSemantics,
        layout: layoutResult,
        table: values,
        resolvedEncodings,
        encodings,
        chartProperties,
        canvasSize,
        semanticTypes,
        chartType,
    };

    // --- Detect faceting (column / row channels) ---

    const colField = channelSemantics.column?.field;
    const rowField = channelSemantics.row?.field;
    const hasFacet = !!(colField || rowField);

    // Multi-grid faceting only works for axis-based charts.
    // Pie, radar, themeRiver use different positioning.
    const hasAxes = chartTemplate.channels.includes('x') || chartTemplate.channels.includes('y');

    let ecOption: any;

    if (hasFacet && hasAxes) {
        // ── Faceted rendering — multi-grid layout ────────────────────────
        const colValues = colField
            ? [...new Set(values.map((r: any) => String(r[colField])))]
            : [];
        const rowValues = rowField
            ? [...new Set(values.map((r: any) => String(r[rowField])))]
            : [];

        // ── Shared layout (facet-aware, same as VL path) ─────────────────
        const facetLayout = computeLayout(
            channelSemantics, declaration, values, canvasSize, effectiveOptions,
        );
        facetLayout.truncations = overflowResult.truncations;

        const nRows = rowValues.length || 1;
        const nCols = colValues.length || 1;

        // ── Column wrapping (matches VL restructureFacets logic) ─────────
        // For column-only facets, compute how many columns fit per visual
        // row using the same parameters VL uses: facetMaxStretch, minStep,
        // minSubplotSize, and the x-axis discrete count.
        let maxColsPerRow = nCols;          // default: no wrapping
        if (colField && !rowField && nCols > 1) {
            const {
                facetMaxStretch: fms = 1.5,
                minStep: ms = 6,
                minSubplotSize: mss = 60,
            } = effectiveOptions;

            // Count discrete positions on x
            let xDiscreteCount = 0;
            const xCS = channelSemantics.x;
            if (xCS?.field) {
                const xType = declaration.resolvedTypes?.x || xCS.type;
                if (xType === 'nominal' || xType === 'ordinal') {
                    xDiscreteCount = new Set(values.map((r: any) => r[xCS.field])).size;
                }
            }
            // Account for grouping (color → multiple bars per category)
            const colorCS = channelSemantics.color;
            if (colorCS?.field) {
                const cType = declaration.resolvedTypes?.color || colorCS.type;
                if (cType === 'nominal' || cType === 'ordinal') {
                    const groupCount = new Set(values.map((r: any) => r[colorCS.field])).size;
                    if (groupCount > 0) xDiscreteCount *= groupCount;
                }
            }

            const minReadable = Math.max(mss, Math.round(canvasSize.width * 0.25));
            const minSubW = xDiscreteCount > 0
                ? Math.max(mss, xDiscreteCount * ms)
                : minReadable;

            const maxTotalW = fms * canvasSize.width;
            const maxByWidth = Math.max(1, Math.floor(maxTotalW / minSubW));

            if (nCols <= maxByWidth) {
                maxColsPerRow = nCols;
            } else {
                const minRows = Math.ceil(nCols / maxByWidth);
                maxColsPerRow = Math.ceil(nCols / minRows);
            }
        }

        const panels: any[][] = [];
        for (let ri = 0; ri < nRows; ri++) {
            const row: any[] = [];
            for (let ci = 0; ci < nCols; ci++) {
                const cv = colValues[ci];
                const rv = rowValues[ri];
                const panelData = values.filter((r: any) => {
                    if (colField && String(r[colField]) !== cv) return false;
                    if (rowField && String(r[rowField]) !== rv) return false;
                    return true;
                });

                const panelOption: any = structuredClone(chartTemplate.template);
                const panelCtx: InstantiateContext = {
                    ...instantiateContext,
                    table: panelData,
                    layout: facetLayout,
                    canvasSize,
                };

                // Let ecApplyLayoutToSpec compute step-based dimensions
                // naturally (plotWidth = step × itemCount for discrete,
                // subplotWidth for continuous).  _width/_height are NOT
                // pre-set so the computation runs.
                chartTemplate.instantiate(panelOption, panelCtx);
                ecApplyLayoutToSpec(panelOption, panelCtx, []);
                if (addTooltipsOpt) ecApplyTooltips(panelOption);
                if (chartTemplate.postProcess) chartTemplate.postProcess(panelOption, panelCtx);

                // Extract pure plot-area dimensions for facet.ts.
                // ecApplyLayoutToSpec set: _width = plotArea + margins (with
                // CANVAS_BUFFER).  facet.ts needs only the plot area so it
                // can set grid.width/height exactly — not derived from
                // panelW − margins, which would inflate when margins are
                // scaled down for non-edge panels.
                const g = panelOption.grid || {};
                panelOption._plotWidth = Math.max(20,
                    (panelOption._width || 200) - (g.left || 0) - (g.right || 0));
                panelOption._plotHeight = Math.max(20,
                    (panelOption._height || 150) - (g.top || 0) - (g.bottom || 0));

                // Attach facet header labels for the combiner
                if (colField) panelOption._colHeader = cv;
                if (rowField) panelOption._rowHeader = rv;

                row.push(panelOption);
            }
            panels.push(row);
        }

        // ── Wrap column-only facets into a proper 2D grid ────────────────
        // The wrapping decision was already computed above (maxColsPerRow).
        // Restructure the flat 1×N panels into displayCols×wrapRows so
        // that ecCombineFacetPanels receives a plain grid with no
        // wrapping logic of its own.
        let finalPanels = panels;
        let colHeaderPerRow = false;

        if (colField && !rowField && maxColsPerRow < nCols) {
            const displayCols = maxColsPerRow;
            const wrapRows = Math.ceil(nCols / displayCols);
            finalPanels = [];
            for (let wr = 0; wr < wrapRows; wr++) {
                const wrapRow: any[] = [];
                for (let vc = 0; vc < displayCols; vc++) {
                    const origCi = wr * displayCols + vc;
                    if (origCi < nCols) {
                        wrapRow.push(panels[0][origCi]);
                    }
                }
                if (wrapRow.length > 0) finalPanels.push(wrapRow);
            }
            colHeaderPerRow = true;
        }

        ecOption = ecCombineFacetPanels(finalPanels, {
            colField, rowField, colHeaderPerRow,
        });
    } else {
        // ── Standard single-panel rendering ──────────────────────────────
        ecOption = structuredClone(chartTemplate.template);

        chartTemplate.instantiate(ecOption, instantiateContext);

        // --- Apply layout decisions (EC-specific) ---

        ecApplyLayoutToSpec(ecOption, instantiateContext, warnings);

        // --- Tooltips ---

        if (addTooltipsOpt) {
            ecApplyTooltips(ecOption);
        }

        // --- ECharts-specific post-processing ---

        // Template-specific post-processing (e.g. scatter symbolSize)
        if (chartTemplate.postProcess) {
            chartTemplate.postProcess(ecOption, instantiateContext);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RESULT
    // ═══════════════════════════════════════════════════════════════════════

    // Attach metadata
    if (warnings.length > 0) {
        ecOption._warnings = warnings;
    }

    // Store data reference (unlike VL which embeds data.values,
    // ECharts data is embedded directly in series[].data)
    ecOption._dataLength = values.length;

    return ecOption;
}
