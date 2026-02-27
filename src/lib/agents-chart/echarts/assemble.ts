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
import { computeLayout, computeChannelBudgets } from '../core/compute-layout';
import { ecApplyLayoutToSpec, ecApplyTooltips } from './instantiate-spec';
import { ecCombineFacetPanels } from './facet';
import { DEFAULT_COLORS } from './templates/utils';
import { inferVisCategory } from '../core/semantic-types';

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

    // Default true so that _encodingTooltip is applied and all charts get encoding-style tooltips
    const {
        addTooltips: addTooltipsOpt = true,
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

    // ── Channel budgets (shared, in layout module) ─────────────────────
    const budgets = computeChannelBudgets(
        channelSemantics, declaration, convertedData, canvasSize, effectiveOptions,
    );
    const facetGridResult = budgets.facetGrid;

    const overflowResult = filterOverflow(
        channelSemantics, declaration, encodings, convertedData,
        budgets, allMarkTypes,
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

    // --- Build resolved encodings (EC analogue of VL buildVLEncodings) ---
    const resolvedEncodings = buildECEncodings(
        encodings,
        channelSemantics,
        declaration,
        values,
        canvasSize,
        semanticTypes,
        templateMarkType,
        chartTemplate,
    );

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
        const maxFacetCols = facetGridResult?.columns ?? 1;
        const maxFacetRows = facetGridResult?.rows ?? 1;
        const maxFacetNominalValues = maxFacetCols * maxFacetRows;

        // Bin quantitative facet channels when unique values exceed grid capacity (VL enc.bin = true)
        let colValues: string[];
        let rowValues: string[];
        if (colField && channelSemantics.column?.type === 'quantitative') {
            const raw = values.map((r: any) => r[colField]).filter((v: any) => v != null && typeof v === 'number' && !isNaN(v));
            const uniques = new Set(raw);
            if (uniques.size > maxFacetNominalValues) {
                const numBins = Math.min(maxFacetNominalValues, 20);
                const minVal = Math.min(...raw);
                const maxVal = Math.max(...raw);
                const step = (maxVal - minVal) / numBins || 1;
                const getColBin = (v: number) => Math.min(numBins - 1, Math.floor((v - minVal) / step));
                values = values.map((r: any) => {
                    const v = r[colField];
                    const bin = (v != null && typeof v === 'number' && !isNaN(v)) ? getColBin(v) : 0;
                    return { ...r, _ecColumnBin: bin };
                });
                colValues = Array.from({ length: numBins }, (_, i) => String(i));
            } else {
                colValues = [...new Set(values.map((r: any) => String(r[colField])))];
            }
        } else {
            colValues = colField ? [...new Set(values.map((r: any) => String(r[colField])))] : [];
        }
        if (rowField && channelSemantics.row?.type === 'quantitative') {
            const raw = values.map((r: any) => r[rowField]).filter((v: any) => v != null && typeof v === 'number' && !isNaN(v));
            const uniques = new Set(raw);
            if (uniques.size > maxFacetNominalValues) {
                const numBins = Math.min(maxFacetNominalValues, 20);
                const minVal = Math.min(...raw);
                const maxVal = Math.max(...raw);
                const step = (maxVal - minVal) / numBins || 1;
                const getRowBin = (v: number) => Math.min(numBins - 1, Math.floor((v - minVal) / step));
                values = values.map((r: any) => {
                    const v = r[rowField];
                    const bin = (v != null && typeof v === 'number' && !isNaN(v)) ? getRowBin(v) : 0;
                    return { ...r, _ecRowBin: bin };
                });
                rowValues = Array.from({ length: numBins }, (_, i) => String(i));
            } else {
                rowValues = [...new Set(values.map((r: any) => String(r[rowField])))];
            }
        } else {
            rowValues = rowField ? [...new Set(values.map((r: any) => String(r[rowField])))] : [];
        }

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
        const colBinned = colField && values.length > 0 && (values[0] as any)._ecColumnBin !== undefined;
        const rowBinned = rowField && values.length > 0 && (values[0] as any)._ecRowBin !== undefined;

        for (let ri = 0; ri < nRows; ri++) {
            const row: any[] = [];
            for (let ci = 0; ci < nCols; ci++) {
                const cv = colValues[ci];
                const rv = rowValues[ri];
                const panelData = values.filter((r: any) => {
                    if (colField) {
                        if (colBinned) { if ((r as any)._ecColumnBin !== ci) return false; }
                        else if (String(r[colField]) !== cv) return false;
                    }
                    if (rowField) {
                        if (rowBinned) { if ((r as any)._ecRowBin !== ri) return false; }
                        else if (String(r[rowField]) !== rv) return false;
                    }
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

// ===========================================================================
// buildECEncodings — Translate abstract semantics → EC-resolved encodings
// ===========================================================================
// Analogous to VegaLite's buildVLEncodings in vegalite/assemble.ts. Output is
// passed as context.resolvedEncodings so ecApplyLayoutToSpec and templates
// read colorPalette, ordinalSortOrder, sizeRange, etc. from one place.

interface ECResolvedChannelEncoding {
    field?: string;
    type?: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
    aggregate?: string;
    colorPalette?: string[];
    /** Diverging scale mid value (from Phase 0 colorScheme.domainMid). */
    colorDomainMid?: number;
    ordinalSortOrder?: string[];
    /** Explicit sort order when sortBy is a JSON array of values (e.g. custom order). */
    sortValues?: string[];
    /** When true, discrete axis should preserve data encounter order (no alphabetical sort). */
    preserveDataOrder?: boolean;
    sortOrder?: 'ascending' | 'descending';
    sortBy?: string;
    sizeRange?: [number, number];
    /** For radius channel: ECharts can use sqrt scale for area-proportional radius. */
    radiusScale?: { type: 'sqrt'; zero: boolean };
    /** When true, quantitative x axis should not "nice" the domain (line/area/point). */
    scaleNice?: boolean;
    /** High-cardinality legend: suggest smaller symbol/label (EC legend itemStyle.symbolSize, etc.). */
    legendSymbolSize?: number;
    legendLabelFontSize?: number;
    groupAxis?: 'x' | 'y';
    offsetChannel?: 'xOffset' | 'yOffset';
}

const TABLEAU10 = [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];
const TABLEAU20 = [
    '#4e79a7', '#a0cbe8', '#f28e2b', '#ffbe7d', '#59a14f', '#8cd17d',
    '#b6992d', '#f1ce63', '#499894', '#86bcb6', '#e15759', '#ff9d9a',
    '#79706e', '#bab0ac', '#d37295', '#fabfd2', '#b07aa1', '#d4a6c8',
    '#9d7660', '#cee0b4',
];
const SET1 = [
    '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
    '#ffff33', '#a65628', '#f781bf', '#999999',
];
const SET2 = [
    '#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854',
    '#ffd92f', '#e5c494', '#b3b3b3',
];
const CATEGORY10 = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

const SCHEME_TO_PALETTE: Record<string, string[]> = {
    tableau10: TABLEAU10,
    tableau20: TABLEAU20,
    set1: SET1,
    set2: SET2,
    set3: SET2.concat(SET1),
    category10: CATEGORY10,
    category20: TABLEAU20,
    pastel1: SET2,
    accent: SET1,
    paired: TABLEAU20,
    default: DEFAULT_COLORS,
};

function schemeToPalette(schemeName: string): string[] {
    const key = schemeName.toLowerCase().replace(/[- ]/g, '');
    for (const [name, palette] of Object.entries(SCHEME_TO_PALETTE)) {
        if (key === name.toLowerCase()) return palette;
    }
    return DEFAULT_COLORS;
}

/**
 * Translate Phase 0 channel semantics + declaration overrides into
 * ECharts-resolved encodings. Mirrors Vega-Lite buildVLEncodings logic
 * but outputs EC-specific fields (colorPalette, sizeRange, ordinalSortOrder,
 * etc.) for template.instantiate and ecApplyLayoutToSpec.
 */
function buildECEncodings(
    encodings: Record<string, ChartEncoding>,
    channelSemantics: Record<string, import('../core/types').ChannelSemantics>,
    declaration: LayoutDeclaration,
    data: any[],
    canvasSize: { width: number; height: number },
    semanticTypes: Record<string, string>,
    templateMarkType: string | undefined,
    chartTemplate: ChartTemplateDef,
): Record<string, ECResolvedChannelEncoding> {
    const resolved: Record<string, ECResolvedChannelEncoding> = {};
    const encodingsEntries = Object.entries(encodings);

    for (const [channel, encoding] of encodingsEntries) {
        const entry: ECResolvedChannelEncoding = {};
        const fieldName = encoding.field;
        const cs = channelSemantics[channel];

        // --- Radius: ECharts can use sqrt scale for area-proportional radius (mirror VL) ---
        if (channel === 'radius') {
            entry.radiusScale = { type: 'sqrt', zero: true };
        }

        // --- Count aggregate without a field (mirror VL) ---
        if (!fieldName && encoding.aggregate === 'count') {
            entry.field = '_count';
            entry.type = 'quantitative';
        }

        if (fieldName) {
            entry.field = fieldName;
            entry.type = (cs?.type ?? 'nominal') as ECResolvedChannelEncoding['type'];

            // Explicit type override; column/row forced to nominal when not discrete (mirror VL)
            if (encoding.type) {
                entry.type = encoding.type as ECResolvedChannelEncoding['type'];
            } else if (channel === 'column' || channel === 'row') {
                if (entry.type !== 'nominal' && entry.type !== 'ordinal') {
                    entry.type = 'nominal';
                }
            }

            if (encoding.aggregate) {
                if (encoding.aggregate === 'count') {
                    entry.field = '_count';
                    entry.type = 'quantitative';
                } else {
                    entry.field = `${fieldName}_${encoding.aggregate}`;
                    entry.type = 'quantitative';
                }
            }

            // Quantitative X axis: no "nice" for line/area/point (mirror VL scale.nice: false)
            if (entry.type === 'quantitative' && channel === 'x') {
                if (templateMarkType === 'line' || templateMarkType === 'area' ||
                    templateMarkType === 'trail' || templateMarkType === 'point') {
                    entry.scaleNice = false;
                }
            }

            // High-cardinality nominal color/group: suggest smaller legend (mirror VL)
            if (entry.type === 'nominal' && (channel === 'color' || channel === 'group')) {
                const actualDomain = [...new Set(data.map((r: any) => r[fieldName]))];
                if (actualDomain.length >= 16) {
                    entry.legendSymbolSize = 12;
                    entry.legendLabelFontSize = 8;
                }
            }
        }

        // --- Size channel: pixel range for ECharts symbolSize (mirror VL size scale logic) ---
        if (channel === 'size') {
            const EC_SIZE_MIN_PX = 10;
            const EC_SIZE_MAX_PX = 50;
            const plotArea = canvasSize.width * canvasSize.height;
            const n = Math.max(data.length, 1);
            const fairShare = plotArea / n;
            const targetPct = 0.05;
            const idealDiameterPx = Math.sqrt(fairShare * targetPct);
            const isQuant = entry.type === 'quantitative' || entry.type === 'temporal';
            const maxSize = Math.round(Math.max(EC_SIZE_MIN_PX, Math.min(EC_SIZE_MAX_PX, idealDiameterPx)));
            const minSize = isQuant ? Math.max(EC_SIZE_MIN_PX, Math.round(maxSize / 3)) : Math.round(maxSize / 4);
            entry.sizeRange = [Math.max(EC_SIZE_MIN_PX, minSize), Math.max(minSize, maxSize)];
        }

        // --- Sorting (mirror VL: sortBy/sortOrder + custom sortValues + auto ordinal/preserve order) ---
        if (encoding.sortBy || encoding.sortOrder) {
            entry.sortOrder = encoding.sortOrder as 'ascending' | 'descending';
            entry.sortBy = encoding.sortBy;
            if (encoding.sortBy) {
                if (encoding.sortBy === 'x' || encoding.sortBy === 'y' || encoding.sortBy === 'color') {
                    // Stored for templates to apply axis/series order
                } else {
                    try {
                        if (fieldName) {
                            const fieldSemType = semanticTypes[fieldName] ?? '';
                            const fieldVisCat = inferVisCategory(data.map((r: any) => r[fieldName]));
                            let sortedValues = JSON.parse(encoding.sortBy) as any[];
                            if (fieldVisCat === 'temporal' || fieldSemType === 'Year' || fieldSemType === 'Decade') {
                                sortedValues = sortedValues.map((v: any) => String(v));
                            }
                            entry.sortValues = (encoding.sortOrder === 'descending')
                                ? [...sortedValues].reverse() : sortedValues;
                        }
                    } catch {
                        // ignore invalid sortBy JSON
                    }
                }
            }
        } else {
            const isDiscrete = entry.type === 'nominal' || entry.type === 'ordinal';
            if (isDiscrete) {
                if (cs?.ordinalSortOrder?.length) {
                    entry.ordinalSortOrder = cs.ordinalSortOrder;
                } else {
                    entry.preserveDataOrder = true;
                }
            }
        }

        // --- Color / group: palette + diverging domainMid (mirror VL) ---
        if (channel === 'color' || channel === 'group') {
            const schemeSource = encoding.scheme && encoding.scheme !== 'default'
                ? encoding.scheme
                : (fieldName && cs?.colorScheme?.scheme) ? cs.colorScheme.scheme : undefined;
            if (schemeSource) {
                entry.colorPalette = schemeToPalette(schemeSource);
            }
            if (fieldName && cs?.colorScheme?.type === 'diverging' && cs.colorScheme.domainMid !== undefined) {
                entry.colorDomainMid = cs.colorScheme.domainMid;
            }
        }

        if (Object.keys(entry).length > 0) {
            resolved[channel] = entry;
        }
    }

    // --- Declaration overrides (mirror VL) ---
    if (declaration.resolvedTypes) {
        for (const [ch, type] of Object.entries(declaration.resolvedTypes)) {
            if (resolved[ch]) {
                resolved[ch].type = type as ECResolvedChannelEncoding['type'];
            }
        }
    }

    // --- Group → color + offset (mirror VL: ensure color exists from group; keep group for EC offset) ---
    const groupCS = channelSemantics.group;
    if (groupCS?.field && resolved.group) {
        const xType = resolved.x?.type;
        const yType = resolved.y?.type;
        const isDiscrete = (t: string | undefined) => t === 'nominal' || t === 'ordinal';
        const groupAxis = isDiscrete(xType) ? 'x' : isDiscrete(yType) ? 'y' : 'x';
        const offsetChannel = groupAxis === 'x' ? 'xOffset' : 'yOffset';
        resolved.group.groupAxis = groupAxis;
        resolved.group.offsetChannel = offsetChannel;
        if (!resolved.color) {
            resolved.color = {
                field: groupCS.field,
                type: (groupCS.type ?? 'nominal') as ECResolvedChannelEncoding['type'],
                colorPalette: resolved.group.colorPalette ?? (groupCS.colorScheme?.scheme ? schemeToPalette(groupCS.colorScheme.scheme) : undefined),
                colorDomainMid: resolved.group.colorDomainMid,
                ordinalSortOrder: resolved.group.ordinalSortOrder,
                sortOrder: resolved.group.sortOrder,
                sortBy: resolved.group.sortBy,
                sortValues: resolved.group.sortValues,
                preserveDataOrder: resolved.group.preserveDataOrder,
                legendSymbolSize: resolved.group.legendSymbolSize,
                legendLabelFontSize: resolved.group.legendLabelFontSize,
            };
        } else if (!resolved.color.colorPalette && groupCS.colorScheme?.scheme) {
            resolved.color.colorPalette = schemeToPalette(groupCS.colorScheme.scheme);
        }
    }

    // --- Merge template encoding defaults (mirror VL: template encoding as base) ---
    const templateEncoding = chartTemplate.template?.encoding as Record<string, any> | undefined;
    if (templateEncoding && typeof templateEncoding === 'object') {
        for (const [ch, enc] of Object.entries(templateEncoding)) {
            if (enc && typeof enc === 'object' && Object.keys(enc).length > 0 && resolved[ch]) {
                resolved[ch] = { ...enc, ...resolved[ch] };
            }
        }
    }

    return resolved;
}
