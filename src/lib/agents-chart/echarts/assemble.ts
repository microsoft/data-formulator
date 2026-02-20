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
 *     → Column wrapping is decided by filterOverflow (shared with VL).
 *       This assembler reads `overflowResult.facetGrid` for the grid
 *       dimensions, restructures the flat 1×N panels into a wrapped
 *       2D grid, and passes the result to ecCombineFacetPanels.
 *       The combiner itself has NO wrapping logic — it renders
 *       whatever grid it receives.
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
    ChartAssemblyInput,
    AssembleOptions,
    LayoutDeclaration,
    InstantiateContext,
} from '../core/types';
import type { ChartWarning } from '../core/types';
import { ecGetTemplateDef } from './templates';
import { resolveSemantics, convertTemporalData } from '../core/resolve-semantics';
import { filterOverflow } from '../core/filter-overflow';
import { computeLayout, computeFacetGrid } from '../core/compute-layout';
import { ecApplyLayoutToSpec, ecApplyTooltips } from './instantiate-spec';
import { ecCombineFacetPanels } from './facet';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble an ECharts option object.
 *
 * ```ts
 * const option = assembleECharts({
 *   data: { values: myRows },
 *   semantic_types: { weight: 'Quantity' },
 *   chart_spec: { chartType: 'Bar Chart', encodings: { x: { field: 'category' }, y: { field: 'value' } } },
 *   options: { addTooltips: true },
 * });
 * ```
 *
 * @returns An ECharts option object with optional `_warnings` and `_width`/`_height` hints
 */
export function assembleECharts(input: ChartAssemblyInput): any {
    const chartType = input.chart_spec.chartType;
    const encodings = input.chart_spec.encodings;
    const data = input.data.values ?? [];
    const semanticTypes = input.semantic_types ?? {};
    const canvasSize = input.chart_spec.canvasSize ?? { width: 400, height: 320 };
    const chartProperties = input.chart_spec.chartProperties;
    const options = input.options ?? {};
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

    // ECharts facet overhead:
    //   Fixed: mLeft (~35-55px width) + mBottom (~22px height).
    //   Gap:   GAP + PAD between panels (ref 14px at 400px canvas,
    //          core scales proportionally).
    if (effectiveOptions.facetFixedPadding == null) {
        effectiveOptions.facetFixedPadding = { width: 55, height: 22 };
    }
    if (effectiveOptions.facetGap == null) {
        effectiveOptions.facetGap = 14;   // reference at 400px canvas
    }

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

    // ── Facet grid decision (shared, in layout module) ─────────────────
    const facetGridResult = computeFacetGrid(
        channelSemantics, declaration, convertedData, canvasSize, effectiveOptions,
    );

    const overflowResult = filterOverflow(
        channelSemantics, declaration, encodings, convertedData,
        canvasSize, effectiveOptions, allMarkTypes, facetGridResult,
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
        facetGridResult,
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
        assembleOptions: effectiveOptions,
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
            facetGridResult,
        );
        facetLayout.truncations = overflowResult.truncations;

        const nRows = rowValues.length || 1;
        const nCols = colValues.length || 1;

        // ── Column wrapping ─────────────────────────────────────────────
        // Use the facet grid decided by computeFacetGrid.
        const maxColsPerRow = facetGridResult?.columns ?? nCols;

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

    // Clean internal-only props
    delete ecOption._legendWidth;

    return ecOption;
}
