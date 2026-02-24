// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js chart assembly — Two-Stage Pipeline Coordinator.
 *
 * Reuses the **same core analysis pipeline** as Vega-Lite and ECharts:
 *   Phase 0:  resolveSemantics     → ChannelSemantics
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
import { resolveSemantics, convertTemporalData } from '../core/resolve-semantics';
import { filterOverflow } from '../core/filter-overflow';
import { computeLayout, computeChannelBudgets } from '../core/compute-layout';
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

    // ── Channel budgets (shared, in layout module) ─────────────────────
    const budgets = computeChannelBudgets(
        channelSemantics, declaration, convertedData, canvasSize, effectiveOptions,
    );

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
    };

    // Standard single-panel rendering (no faceting for initial CJS backend)
    const cjsConfig: any = structuredClone(chartTemplate.template);

    chartTemplate.instantiate(cjsConfig, instantiateContext);

    // Apply layout decisions (CJS-specific)
    cjsApplyLayoutToSpec(cjsConfig, instantiateContext, warnings);

    // Tooltips
    if (addTooltipsOpt) {
        cjsApplyTooltips(cjsConfig);
    }

    // Template-specific post-processing
    if (chartTemplate.postProcess) {
        chartTemplate.postProcess(cjsConfig, instantiateContext);
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
