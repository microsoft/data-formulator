// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Core chart assembly logic — Two-Stage Pipeline Coordinator.
 *
 * Given data, encoding definitions, and semantic types,
 * produces a complete Vega-Lite specification in two stages:
 *
 * ── ANALYSIS (VL-free) ──────────────────────────────────────
 *   Phase 0:  resolveSemantics     → ChannelSemantics
 *   Step 0a:  declareLayoutMode    → LayoutDeclaration
 *   Step 0b:  convertTemporalData  → converted data
 *   Step 0c:  filterOverflow       → filtered data, nominalCounts
 *   Phase 1:  computeLayout        → LayoutResult
 *
 * ── INSTANTIATE (VL-specific) ───────────────────────────────
 *   buildVLEncodings    → resolvedEncodings
 *   template.instantiate
 *   restructureFacets
 *   applyLayoutToSpec
 *   post-layout adjustments (facet binning, independent scales, tooltips)
 *
 * ── Backend Translation Responsibilities ────────────────────
 * The LayoutResult from Phase 1 is target-agnostic.  This assembler
 * translates it into Vega-Lite-specific structures:
 *
 *   subplotWidth / subplotHeight
 *     → VL `width` / `height` on the spec (or `width: {step: N}` for
 *       banded discrete axes).
 *
 *   xStep / yStep / stepPadding
 *     → VL `width: {step: N}`, `encoding.x.scale.paddingInner`, etc.
 *       VL handles bar sizing natively from the step declaration.
 *
 *   Facet wrapping
 *     → `restructureFacets()` converts column-only to `facet` +
 *       `columns: N`.  The wrapping decision uses the same parameters
 *       (facetMaxStretch, minStep, minSubplotSize) as ECharts.
 *
 *   Axis titles, labels, legends
 *     → VL handles these declaratively via encoding / config.
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
import { getTemplateDef } from './templates';
import { inferVisCategory } from '../core/semantic-types';
import { resolveSemantics, convertTemporalData } from '../core/resolve-semantics';
import { filterOverflow } from '../core/filter-overflow';
import { computeLayout } from '../core/compute-layout';
import { applyLayoutToSpec, applyTooltips } from './instantiate-spec';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a Vega-Lite specification.
 *
 * ```ts
 * const spec = assembleChart({
 *   data: { values: myRows },
 *   semantic_types: { weight: 'Quantity', mpg: 'Quantity' },
 *   chart_spec: {
 *     chartType: 'Scatter Plot',
 *     encodings: { x: { field: 'weight' }, y: { field: 'mpg' } },
 *     canvasSize: { width: 400, height: 300 },
 *   },
 *   options: { addTooltips: true },
 * });
 * ```
 */
export function assembleChart(input: ChartAssemblyInput): any {
    const chartType = input.chart_spec.chartType;
    const encodings = input.chart_spec.encodings;
    const data = input.data.values ?? [];
    const semanticTypes = input.semantic_types ?? {};
    const canvasSize = input.chart_spec.canvasSize ?? { width: 400, height: 320 };
    const chartProperties = input.chart_spec.chartProperties;
    const options = input.options ?? {};
    const chartTemplate = getTemplateDef(chartType) as ChartTemplateDef;
    if (!chartTemplate) {
        throw new Error(`Unknown chart type: ${chartType}`);
    }

    const warnings: ChartWarning[] = [];

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 0: Resolve Semantics (VL-free)
    // ═══════════════════════════════════════════════════════════════════════

    const tplMark = chartTemplate.template?.mark;
    const templateMarkType = typeof tplMark === 'string' ? tplMark : tplMark?.type;

    const channelSemantics = resolveSemantics(
        encodings, data, semanticTypes,
        chartTemplate.markCognitiveChannel,
        templateMarkType,
    );

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0a: declareLayoutMode (VL-free template hook)
    // ═══════════════════════════════════════════════════════════════════════

    const declaration: LayoutDeclaration = chartTemplate.declareLayoutMode
        ? chartTemplate.declareLayoutMode(channelSemantics, data, chartProperties)
        : {};

    // Auto-detect binnedAxes from template encoding if not declared
    if (!declaration.binnedAxes) {
        const templateEnc = chartTemplate.template?.encoding;
        if (templateEnc) {
            const binnedAxes: Record<string, boolean | { maxbins?: number }> = {};
            for (const axis of ['x', 'y']) {
                if (templateEnc[axis]?.bin) {
                    binnedAxes[axis] = templateEnc[axis].bin;
                }
            }
            if (Object.keys(binnedAxes).length > 0) {
                declaration.binnedAxes = binnedAxes;
            }
        }
    }

    // Merge paramOverrides into effective options
    const effectiveOptions: AssembleOptions = {
        ...options,
        ...(declaration.paramOverrides || {}),
    };

    const {
        addTooltips: addTooltipsOpt = false,
        facetMaxStretch: facetMaxStretchVal = 1.5,
        minSubplotSize: minSubplotVal = 60,
    } = effectiveOptions;

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0b: Temporal Data Conversion
    // ═══════════════════════════════════════════════════════════════════════

    const convertedData = convertTemporalData(data, semanticTypes);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0c: filterOverflow (VL-free)
    // ═══════════════════════════════════════════════════════════════════════

    // Collect mark types for sort strategy
    const allMarkTypes = new Set<string>();
    if (templateMarkType) allMarkTypes.add(templateMarkType);
    if (Array.isArray(chartTemplate.template?.layer)) {
        for (const layer of chartTemplate.template.layer) {
            const lm = typeof layer.mark === 'string' ? layer.mark : layer.mark?.type;
            if (lm) allMarkTypes.add(lm);
        }
    }

    const overflowResult = filterOverflow(
        channelSemantics, declaration, encodings, convertedData,
        canvasSize, effectiveOptions, allMarkTypes,
    );

    let values = overflowResult.filteredData;
    const nominalCounts = overflowResult.nominalCounts;
    warnings.push(...overflowResult.warnings);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: Compute Layout (VL-free)
    // ═══════════════════════════════════════════════════════════════════════

    const layoutResult = computeLayout(
        channelSemantics,
        declaration,
        values,  // post-overflow filtered data
        canvasSize,
        effectiveOptions,
    );

    // Attach overflow truncations from filterOverflow
    layoutResult.truncations = overflowResult.truncations;

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: Instantiate VL Spec
    // ═══════════════════════════════════════════════════════════════════════

    // --- Build VL encodings (abstract semantics → VL encoding objects) ---

    const resolvedEncodings = buildVLEncodings(
        encodings, channelSemantics, declaration, data,
        canvasSize, semanticTypes, templateMarkType, chartTemplate,
    );

    // Detect x/y discrete counts inside template layers for layered specs
    const isDiscreteType = (t: string | undefined) => t === 'nominal' || t === 'ordinal';
    if (Array.isArray(chartTemplate.template?.layer)) {
        for (const axis of ['x', 'y'] as const) {
            if (nominalCounts[axis] === 0) {
                for (const layer of chartTemplate.template.layer) {
                    const layerEnc = layer.encoding?.[axis];
                    if (layerEnc?.field && isDiscreteType(layerEnc.type)) {
                        nominalCounts[axis] = new Set(values.map((r: any) => r[layerEnc.field])).size;
                        break;
                    }
                }
                if (nominalCounts[axis] === 0 && resolvedEncodings[axis]?.field) {
                    const enc = resolvedEncodings[axis];
                    if (isDiscreteType(enc.type)) {
                        nominalCounts[axis] = new Set(values.map((r: any) => r[enc.field])).size;
                    }
                }
            }
        }
    }

    // --- template.instantiate (template-specific VL spec building) ---

    const vgObj = structuredClone(chartTemplate.template);

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

    chartTemplate.instantiate(vgObj, instantiateContext);

    // Merge any warnings emitted by instantiate
    if (vgObj._warnings && Array.isArray(vgObj._warnings)) {
        warnings.push(...vgObj._warnings);
        delete vgObj._warnings;
    }

    // --- restructureFacets (VL-specific) ---

    restructureFacets(vgObj, nominalCounts, canvasSize, effectiveOptions);

    // --- applyLayoutToSpec (VL-specific: config, sizing, formatting) ---

    applyLayoutToSpec(vgObj, instantiateContext, warnings);

    // --- Post-layout adjustments (VL-specific) ---

    const defaultChartWidth = canvasSize.width;
    const defaultChartHeight = canvasSize.height;
    const maxFacetColumns = Math.max(2, Math.floor(defaultChartWidth * facetMaxStretchVal / minSubplotVal));
    const maxFacetRows = Math.max(2, Math.floor(defaultChartHeight * facetMaxStretchVal / minSubplotVal));
    const maxFacetNominalValues = maxFacetColumns * maxFacetRows;

    // Bin quantitative facets
    for (const channel of ['facet', 'column', 'row']) {
        const enc = vgObj.encoding?.[channel];
        if (enc?.type === 'quantitative') {
            const fieldName = enc.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];
            if (uniqueValues.length > maxFacetNominalValues) {
                enc.bin = true;
            }
        }
    }

    // Independent y-axis scaling for faceted charts with vastly different ranges
    const effectiveEncoding = vgObj.spec?.encoding || vgObj.encoding;
    const effectiveFacet = vgObj.facet || vgObj.encoding?.facet;
    if (effectiveFacet != undefined && effectiveEncoding?.y?.type === 'quantitative') {
        const yField = effectiveEncoding.y.field;
        const columnField = effectiveFacet.field;

        if (yField && columnField) {
            const columnGroups = new Map<any, number>();
            for (const row of data) {
                const columnValue = row[columnField];
                const yValue = row[yField];
                if (yValue != null && !isNaN(yValue)) {
                    const currentMax = columnGroups.get(columnValue) || 0;
                    columnGroups.set(columnValue, Math.max(currentMax, Math.abs(yValue)));
                }
            }

            const maxValues = Array.from(columnGroups.values()).filter(v => v > 0);
            if (maxValues.length >= 2) {
                const maxValue = Math.max(...maxValues);
                const minValue = Math.min(...maxValues);
                const ratio = maxValue / minValue;
                const totalFacets = (layoutResult.facet?.columns ?? 1) * (layoutResult.facet?.rows ?? 1);
                if (ratio >= 100 && totalFacets < 6) {
                    if (!vgObj.resolve) vgObj.resolve = {};
                    if (!vgObj.resolve.scale) vgObj.resolve.scale = {};
                    vgObj.resolve.scale.y = "independent";
                }
            }
        }
    }

    if (addTooltipsOpt) {
        applyTooltips(vgObj);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RESULT
    // ═══════════════════════════════════════════════════════════════════════

    const result: any = { ...vgObj, data: { values } };
    if (warnings.length > 0) {
        result._warnings = warnings;
    }
    result._width = layoutResult.subplotWidth;
    result._height = layoutResult.subplotHeight;
    return result;
}

// ===========================================================================
// buildVLEncodings — Translate abstract semantics → VL encoding objects
// ===========================================================================

/**
 * Translate Phase 0 channel semantics + declaration overrides into
 * concrete Vega-Lite encoding objects. This is the only place outside
 * template.instantiate() that constructs VL-specific syntax.
 */
function buildVLEncodings(
    encodings: Record<string, ChartEncoding>,
    channelSemantics: Record<string, import('../core/types').ChannelSemantics>,
    declaration: LayoutDeclaration,
    data: any[],
    canvasSize: { width: number; height: number },
    semanticTypes: Record<string, string>,
    templateMarkType: string | undefined,
    chartTemplate: ChartTemplateDef,
): Record<string, any> {
    const resolvedEncodings: Record<string, any> = {};

    for (const [channel, encoding] of Object.entries(encodings)) {
        const encodingObj: any = {};
        const fieldName = encoding.field;
        const cs = channelSemantics[channel];

        if (channel === "radius") {
            encodingObj.scale = { type: "sqrt", zero: true };
        }

        // Handle count aggregate without a field
        if (!fieldName && encoding.aggregate === "count") {
            encodingObj.field = "_count";
            encodingObj.title = "Count";
            encodingObj.type = "quantitative";
        }

        if (fieldName) {
            encodingObj.field = fieldName;

            // Use Phase 0's resolved type
            encodingObj.type = cs?.type || 'nominal';

            // Explicit type override
            if (encoding.type) {
                encodingObj.type = encoding.type;
            } else if (channel === 'column' || channel === 'row') {
                if (encodingObj.type !== 'nominal' && encodingObj.type !== 'ordinal') {
                    encodingObj.type = 'nominal';
                }
            }

            // Aggregation handling — data is always pre-aggregated
            if (encoding.aggregate) {
                if (encoding.aggregate === "count") {
                    encodingObj.field = "_count";
                    encodingObj.title = "Count";
                    encodingObj.type = "quantitative";
                } else {
                    encodingObj.field = `${fieldName}_${encoding.aggregate}`;
                    encodingObj.type = "quantitative";
                }
            }

            // Scale: quantitative X axes need tight domains for line-like marks
            if (encodingObj.type === "quantitative" && channel === "x") {
                if (templateMarkType === 'line' || templateMarkType === 'area' ||
                    templateMarkType === 'trail' || templateMarkType === 'point') {
                    encodingObj.scale = { nice: false };
                }
            }

            // Legend sizing for high-cardinality nominal color/group
            if (encodingObj.type === "nominal" && (channel === 'color' || channel === 'group')) {
                const actualDomain = [...new Set(data.map(r => r[fieldName]))];
                if (actualDomain.length >= 16) {
                    if (!encodingObj.legend) encodingObj.legend = {};
                    encodingObj.legend.symbolSize = 12;
                    encodingObj.legend.labelFontSize = 8;
                }
            }
        }

        // Size channel: set scale based on resolved encoding type
        if (channel === "size") {
            const vlDefaultMax = 361;
            const plotArea = canvasSize.width * canvasSize.height;
            const n = Math.max(data.length, 1);
            const fairShare = plotArea / n;
            const targetPct = 0.6;
            const absoluteMin = 16;

            const isQuantitative = encodingObj.type === 'quantitative' || encodingObj.type === 'temporal';
            if (isQuantitative) {
                const maxSize = Math.round(Math.max(absoluteMin, Math.min(vlDefaultMax, fairShare * targetPct)));
                const minSize = 9;
                encodingObj.scale = { type: "sqrt", zero: true, range: [minSize, maxSize] };
            } else {
                const maxSize = Math.round(Math.max(absoluteMin, Math.min(vlDefaultMax, fairShare * targetPct)));
                const minSize = Math.round(maxSize / 4);
                encodingObj.scale = { range: [minSize, maxSize] };
            }
        }

        // --- Sorting ---
        if (encoding.sortBy || encoding.sortOrder) {
            if (!encoding.sortBy) {
                if (encoding.sortOrder) {
                    encodingObj.sort = encoding.sortOrder;
                }
            } else if (encoding.sortBy === 'x' || encoding.sortBy === 'y') {
                if (encoding.sortBy === channel) {
                    encodingObj.sort = `${encoding.sortOrder === "descending" ? "-" : ""}${encoding.sortBy}`;
                } else {
                    encodingObj.sort = `${encoding.sortOrder === "ascending" ? "" : "-"}${encoding.sortBy}`;
                }
            } else if (encoding.sortBy === 'color') {
                if (encodings.color?.field) {
                    encodingObj.sort = `${encoding.sortOrder === "ascending" ? "" : "-"}${encoding.sortBy}`;
                }
            } else {
                try {
                    if (fieldName) {
                        const fieldSemType = semanticTypes[fieldName] || '';
                        const fieldVisCat = inferVisCategory(data.map(r => r[fieldName]));
                        let sortedValues = JSON.parse(encoding.sortBy);

                        if (fieldVisCat === 'temporal' || fieldSemType === "Year" || fieldSemType === "Decade") {
                            sortedValues = sortedValues.map((v: any) => v.toString());
                        }

                        encodingObj.sort = (encoding.sortOrder === "ascending" || !encoding.sortOrder)
                            ? sortedValues : sortedValues.reverse();
                    }
                } catch {
                    console.warn(`sort error > ${encoding.sortBy}`);
                }
            }
        } else {
            // Auto-sort: discrete axis (nominal/ordinal) with quantitative opposite
            const isDiscreteType = encodingObj.type === 'nominal' || encodingObj.type === 'ordinal';
            if ((channel === 'x' && isDiscreteType && encodings.y?.field) ||
                (channel === 'y' && isDiscreteType && encodings.x?.field)) {

                // If Phase 0 detected a canonical ordinal sort (months, days, etc.),
                // use that instead of sorting by the quantitative opposite.
                if (cs?.ordinalSortOrder && cs.ordinalSortOrder.length > 0) {
                    encodingObj.sort = cs.ordinalSortOrder;
                } else {
                    const fieldOrigType = fieldName ? inferVisCategory(data.map(r => r[fieldName])) : undefined;
                    if (fieldOrigType !== 'temporal') {
                        // Sort-by-measure only makes sense for bar-like charts where
                        // reordering categories by their value is informative.
                        // For line/area/streamgraph charts the x-axis sequence carries
                        // meaning (trends, progression) — sorting by y destroys that.
                        const sequentialMarks = new Set(['line', 'area', 'trail']);
                        const isSequentialMark = templateMarkType && sequentialMarks.has(templateMarkType);

                        if (!isSequentialMark) {
                            const colorField = encodings.color?.field;
                            let colorFieldType: string | undefined;
                            if (colorField) {
                                colorFieldType = inferVisCategory(data.map(r => r[colorField]));
                            }

                            if (colorField && colorFieldType === 'quantitative') {
                                encodingObj.sort = "-color";
                            } else {
                                const oppositeChannel = channel === 'x' ? 'y' : 'x';
                                const oppositeField = encodings[oppositeChannel]?.field;
                                if (oppositeField) {
                                    if (inferVisCategory(data.map(r => r[oppositeField])) === 'quantitative') {
                                        encodingObj.sort = `-${oppositeChannel}`;
                                    }
                                }
                            }
                        } else {
                            // Sequential marks: preserve data order (VL default)
                            encodingObj.sort = null;
                        }
                    }
                }
            }
        }

        // Color scheme from Phase 0 decisions
        if (channel === "color" || channel === "group") {
            if (encoding.scheme && encoding.scheme !== "default") {
                if ('scale' in encodingObj) {
                    encodingObj.scale.scheme = encoding.scheme;
                } else {
                    encodingObj.scale = { scheme: encoding.scheme };
                }
            } else if (fieldName && cs?.colorScheme) {
                if (!('scale' in encodingObj)) {
                    encodingObj.scale = {};
                }
                encodingObj.scale.scheme = cs.colorScheme.scheme;
                if (cs.colorScheme.type === 'diverging' && cs.colorScheme.domainMid !== undefined) {
                    encodingObj.scale.domainMid = cs.colorScheme.domainMid;
                }
            }
        }

        // --- Collect resolved encoding ---
        if (Object.keys(encodingObj).length !== 0) {
            resolvedEncodings[channel] = encodingObj;
        }
    }

    // --- Apply declaration overrides ---

    // Apply resolved types from declareLayoutMode
    if (declaration.resolvedTypes) {
        for (const [ch, type] of Object.entries(declaration.resolvedTypes)) {
            if (resolvedEncodings[ch]) {
                resolvedEncodings[ch].type = type;
            }
        }
    }

    // Translate group channel → VL color + xOffset/yOffset encodings
    const groupCS = channelSemantics.group;
    if (groupCS?.field && resolvedEncodings.group) {
        // Determine which axis the group subdivides (the discrete one)
        const xType = resolvedEncodings.x?.type;
        const yType = resolvedEncodings.y?.type;
        const isDiscreteT = (t: string | undefined) => t === 'nominal' || t === 'ordinal';
        const groupAxis = isDiscreteT(xType) ? 'x' : isDiscreteT(yType) ? 'y' : 'x';
        const offsetChannel = groupAxis === 'x' ? 'xOffset' : 'yOffset';

        // Map group → color encoding
        if (!resolvedEncodings.color) {
            resolvedEncodings.color = { ...resolvedEncodings.group };
        }
        delete resolvedEncodings.group;

        // Create offset encoding for position subdivision
        if (!resolvedEncodings[offsetChannel]) {
            resolvedEncodings[offsetChannel] = { field: groupCS.field, type: 'nominal' };
        }
    }

    // Merge template encoding defaults (bin, aggregate, etc.)
    const templateEncoding = chartTemplate.template?.encoding;
    if (templateEncoding) {
        for (const [ch, enc] of Object.entries(templateEncoding)) {
            if (enc && typeof enc === 'object' && Object.keys(enc as any).length > 0) {
                if (resolvedEncodings[ch]) {
                    resolvedEncodings[ch] = { ...(enc as any), ...resolvedEncodings[ch] };
                }
            }
        }
    }

    return resolvedEncodings;
}

// ===========================================================================
// restructureFacets — VL-specific spec transforms for faceted charts
// ===========================================================================

function restructureFacets(
    vgObj: any,
    nominalCounts: Record<string, number>,
    canvasSize: { width: number; height: number },
    options: AssembleOptions,
): void {
    const {
        facetMaxStretch: facetMaxStretchVal = 1.5,
        minStep: minStepVal = 6,
        minSubplotSize: minSubplotVal = 60,
    } = options;

    const defaultChartWidth = canvasSize.width;

    if (vgObj.encoding?.column != undefined && vgObj.encoding?.row == undefined) {
        vgObj.encoding.facet = vgObj.encoding.column;

        let xDiscreteCount = nominalCounts.x;
        if (nominalCounts.group > 0) {
            xDiscreteCount = nominalCounts.x * nominalCounts.group;
        }

        const minReadableSubplot = Math.max(minSubplotVal, Math.round(defaultChartWidth * 0.25));
        const minSubplotWidth = xDiscreteCount > 0
            ? Math.max(minSubplotVal, xDiscreteCount * minStepVal)
            : minReadableSubplot;

        const maxTotalWidth = facetMaxStretchVal * defaultChartWidth;
        const maxColsByWidth = Math.max(1, Math.floor(maxTotalWidth / minSubplotWidth));
        const facetCount = nominalCounts.column || 1;

        let numCols: number;
        if (facetCount <= maxColsByWidth) {
            numCols = facetCount;
        } else {
            const minRows = Math.ceil(facetCount / maxColsByWidth);
            numCols = Math.ceil(facetCount / minRows);
        }

        vgObj.encoding.facet.columns = numCols;
        const numRows = Math.ceil(facetCount / numCols);

        if (numRows >= 2) {
            const encTarget = vgObj.encoding;
            if (encTarget?.x) {
                if (!encTarget.x.axis) encTarget.x.axis = {};
                encTarget.x.axis.title = null;
            }
            if (encTarget?.y) {
                if (!encTarget.y.axis) encTarget.y.axis = {};
                encTarget.y.axis.title = null;
            }
        }

        delete vgObj.encoding.column;

        // For layered specs, VL doesn't support encoding.facet inline
        if (vgObj.layer && Array.isArray(vgObj.layer)) {
            const facetDef = { ...vgObj.encoding.facet };
            delete vgObj.encoding.facet;

            vgObj.facet = facetDef;
            vgObj.spec = {
                layer: vgObj.layer,
                encoding: vgObj.encoding,
            };
            delete vgObj.layer;
            delete vgObj.encoding;
        }
    }

    // For layered specs with row-only or column+row facets
    if (vgObj.layer && Array.isArray(vgObj.layer) &&
        (vgObj.encoding?.column || vgObj.encoding?.row)) {
        const facetDef: any = {};
        if (vgObj.encoding.column) {
            facetDef.column = vgObj.encoding.column;
            delete vgObj.encoding.column;
        }
        if (vgObj.encoding.row) {
            facetDef.row = vgObj.encoding.row;
            delete vgObj.encoding.row;
        }
        vgObj.facet = facetDef;
        vgObj.spec = {
            layer: vgObj.layer,
            encoding: vgObj.encoding,
        };
        delete vgObj.layer;
        delete vgObj.encoding;
    }
}
