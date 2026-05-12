// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js chart assembly — Two-Stage Pipeline Coordinator.
 *
 * Reuses the **same core analysis pipeline** as Vega-Lite and ECharts:
 *   Phase 0:  resolveChannelSemantics  → ChannelSemantics
 *   Step 0a:  declareLayoutMode    → LayoutDeclaration
 *   Step 0b:  convertTemporalData  → converted data
 *   Step 0c:  filterOverflow       → filtered data, nominalCounts
 *   Phase 1:  computeLayout        → LayoutResult
 *
 * Then diverges for Phase 2 (Chart.js-specific):
 *   template.instantiate → builds Chart.js config structure
 *   cjsApplyLayoutToSpec → applies layout decisions to config
 *
 * Key structural differences from ECharts / VL output:
 *   VL: { mark, encoding, data: {values}, width, height }
 *   EC: { xAxis, yAxis, series: [{type, data}], tooltip, legend, grid }
 *   CJS: { type, data: { labels, datasets[] }, options: { scales, plugins } }
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
import { cjsGetTemplateDef } from './templates';
import { resolveChannelSemantics, convertTemporalData } from '../core/resolve-semantics';
import { computeZeroDecision } from '../core/semantic-types';
import { filterOverflow } from '../core/filter-overflow';
import { computeLayout, computeChannelBudgets } from '../core/compute-layout';
import { decideColorMaps } from '../core/color-decisions';
import { cjsApplyLayoutToSpec, cjsApplyTooltips } from './instantiate-spec';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a Chart.js config object.
 *
 * ```ts
 * const config = assembleChartjs({
 *   data: { values: myRows },
 *   semantic_types: { weight: 'Quantity' },
 *   chart_spec: { chartType: 'Bar Chart', encodings: { x: { field: 'category' }, y: { field: 'value' } } },
 *   options: { addTooltips: true },
 * });
 * ```
 *
 * @returns A Chart.js config object with optional `_warnings` and `_width`/`_height` hints
 */
export function assembleChartjs(input: ChartAssemblyInput): any {
    const chartType = input.chart_spec.chartType;
    const encodings = input.chart_spec.encodings;
    const data = input.data.values ?? [];
    const semanticTypes = input.semantic_types ?? {};
    const canvasSize = input.chart_spec.canvasSize ?? { width: 400, height: 320 };
    const chartProperties = input.chart_spec.chartProperties;
    const options = input.options ?? {};
    const chartTemplate = cjsGetTemplateDef(chartType) as ChartTemplateDef;
    if (!chartTemplate) {
        throw new Error(`Unknown Chart.js chart type: ${chartType}. Use cjsAllTemplateDefs to see available types.`);
    }

    const warnings: ChartWarning[] = [];

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 0: Resolve Semantics (shared with VL + EC — completely target-agnostic)
    // ═══════════════════════════════════════════════════════════════════════

    const tplMark = chartTemplate.template?.mark;
    const templateMarkType = typeof tplMark === 'string' ? tplMark : tplMark?.type;

    // Convert temporal data once — feeds semantic resolution and all downstream stages
    const convertedData = convertTemporalData(data, semanticTypes);

    const channelSemantics = resolveChannelSemantics(
        encodings, data, semanticTypes, convertedData,
    );

    // Finalize zero-baseline (requires template mark knowledge)
    const effectiveMarkType = templateMarkType || 'point';
    for (const [channel, cs] of Object.entries(channelSemantics)) {
        if ((channel === 'x' || channel === 'y') && cs.type === 'quantitative') {
            const numericValues = data
                .map(r => r[cs.field])
                .filter((v: any) => v != null && typeof v === 'number' && !isNaN(v));
            cs.zero = computeZeroDecision(
                cs.semanticAnnotation.semanticType, channel, effectiveMarkType, numericValues,
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0a: declareLayoutMode (shared hook)
    // ═══════════════════════════════════════════════════════════════════════

    const declaration: LayoutDeclaration = chartTemplate.declareLayoutMode
        ? chartTemplate.declareLayoutMode(channelSemantics, data, chartProperties)
        : {};

    const effectiveOptions: AssembleOptions = {
        // Chart.js fills its canvas natively — a wider default band size
        // matches its generous category spacing behavior.
        defaultBandSize: 30,
        ...options,
        ...(declaration.paramOverrides || {}),
    };

    const {
        addTooltips: addTooltipsOpt = false,
    } = effectiveOptions;

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0b: filterOverflow (shared)
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
    // PHASE 2: Instantiate Chart.js Config (CJS-specific)
    // ═══════════════════════════════════════════════════════════════════════

    // Build resolved encodings for interface compatibility
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

    // Template instantiate
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
        colorDecisions: decideColorMaps({
            chartType,
            encodings,
            channelSemantics,
            table: values,
            background: 'light',
        }),
    };

    const colField = channelSemantics.column?.field;
    const rowField = channelSemantics.row?.field;
    const hasFacet = !!(colField || rowField);
    const hasAxes = chartTemplate.channels.includes('x') || chartTemplate.channels.includes('y');

    let cjsConfig: any;
    if (hasFacet && hasAxes) {
        const colValues = colField ? [...new Set(values.map((r: any) => String(r[colField])))] : [''];
        const rowValues = rowField ? [...new Set(values.map((r: any) => String(r[rowField])))] : [''];
        const facetLegend: Array<{ label: string; color: string }> = [];

        const yField = channelSemantics.y?.field;
        let sharedYDomain: { min: number; max: number } | undefined;
        if (yField) {
            const nums = values
                .map((r: any) => r[yField])
                .filter((v: any) => typeof v === 'number' && Number.isFinite(v)) as number[];
            if (nums.length > 0) {
                const rawMin = Math.min(...nums);
                const rawMax = Math.max(...nums);
                const forceZero = !!channelSemantics.y?.zero?.zero;
                const min = forceZero ? Math.min(0, rawMin) : rawMin;
                const max = forceZero ? Math.max(0, rawMax) : rawMax;
                sharedYDomain = { min, max };
            }
        }

        const panelRows: any[][] = [];
        for (let ri = 0; ri < rowValues.length; ri++) {
            const rowVal = rowValues[ri];
            const rowPanels: any[] = [];
            for (let ci = 0; ci < colValues.length; ci++) {
                const colVal = colValues[ci];
                const panelData = values.filter((r: any) => {
                    if (colField && String(r[colField]) !== colVal) return false;
                    if (rowField && String(r[rowField]) !== rowVal) return false;
                    return true;
                });

                const panelConfig: any = structuredClone(chartTemplate.template);
                const panelContext: InstantiateContext = {
                    ...instantiateContext,
                    table: panelData,
                    layout: layoutResult,
                };
                chartTemplate.instantiate(panelConfig, panelContext);
                // Keep all facet panels the same plot size: disable per-panel built-in legend.
                // A shared legend is rendered by the gallery host.
                if (!panelConfig.options) panelConfig.options = {};
                if (!panelConfig.options.plugins) panelConfig.options.plugins = {};
                panelConfig.options.plugins.legend = {
                    ...(panelConfig.options.plugins.legend || {}),
                    display: false,
                    position: 'right',
                };
                cjsApplyLayoutToSpec(panelConfig, panelContext, []);
                if (addTooltipsOpt) cjsApplyTooltips(panelConfig);
                if (chartTemplate.postProcess) chartTemplate.postProcess(panelConfig, panelContext);
                if (facetLegend.length === 0 && Array.isArray(panelConfig.data?.datasets)) {
                    for (const ds of panelConfig.data.datasets) {
                        const label = String(ds?.label ?? '').trim();
                        if (!label) continue;
                        const color = String(ds?.borderColor ?? ds?.backgroundColor ?? '#666');
                        facetLegend.push({ label, color });
                    }
                }

                rowPanels.push({
                    key: `${ri}:${ci}`,
                    rowIndex: ri,
                    colIndex: ci,
                    rowHeader: rowField ? rowVal : undefined,
                    colHeader: colField ? colVal : undefined,
                    config: panelConfig,
                });
            }
            panelRows.push(rowPanels);
        }

        cjsConfig = cjsCombineFacetPanels(
            panelRows,
            !!colField,
            !!rowField,
            sharedYDomain,
        );
        cjsConfig._facetLegend = facetLegend;
    } else {
        cjsConfig = structuredClone(chartTemplate.template);
        chartTemplate.instantiate(cjsConfig, instantiateContext);
        cjsApplyLayoutToSpec(cjsConfig, instantiateContext, warnings);
        if (addTooltipsOpt) cjsApplyTooltips(cjsConfig);
        if (chartTemplate.postProcess) chartTemplate.postProcess(cjsConfig, instantiateContext);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RESULT
    // ═══════════════════════════════════════════════════════════════════════

    if (warnings.length > 0) {
        cjsConfig._warnings = warnings;
    }

    cjsConfig._dataLength = values.length;

    return cjsConfig;
}

function cjsCombineFacetPanels(
    panelRows: any[][],
    hasColHeader: boolean,
    hasRowHeader: boolean,
    sharedYDomain?: { min: number; max: number },
): any {
    const rows = panelRows.length;
    const cols = Math.max(1, ...panelRows.map(r => r.length));
    const ref = panelRows[0]?.[0]?.config;
    const panelW = ref?._width || 400;
    const panelH = ref?._height || 300;
    const gap = 16;
    const colHeaderH = hasColHeader ? 22 : 0;
    const rowHeaderW = hasRowHeader ? 28 : 0;

    return {
        _facet: true,
        _facetPanels: panelRows,
        _facetRows: rows,
        _facetCols: cols,
        _facetSharedYDomain: sharedYDomain,
        _width: rowHeaderW + cols * panelW + (cols - 1) * gap,
        _height: colHeaderH + rows * panelH + (rows - 1) * gap,
    };
}
