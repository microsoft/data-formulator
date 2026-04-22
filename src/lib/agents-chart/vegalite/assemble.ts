// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Core chart assembly logic — Two-Stage Pipeline Coordinator.
 *
 * Given data, encoding definitions, and semantic types,
 * produces a complete Vega-Lite specification in two stages:
 *
 * ── ANALYSIS (VL-free) ──────────────────────────────────────
 *   Phase 0:  resolveChannelSemantics  → ChannelSemantics
 *   Step 0a:  declareLayoutMode    → LayoutDeclaration
 *   Step 0b:  convertTemporalData  → converted data
 *   Step 0c:  filterOverflow       → filtered data, nominalCounts
 *   Phase 1:  computeLayout        → LayoutResult
 *
 * ── INSTANTIATE (VL-specific) ───────────────────────────────
 *   buildVLEncodings    → resolvedEncodings
 *   template.instantiate
 *   restructureFacets
 *   vlApplyLayoutToSpec
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
 *       (maxStretch, minStep, minSubplotSize) as ECharts.
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
import { vlGetTemplateDef } from './templates';
import { inferVisCategory, computeZeroDecision } from '../core/semantic-types';
import { resolveChannelSemantics, convertTemporalData } from '../core/resolve-semantics';
import { toTypeString, type SemanticAnnotation } from '../core/field-semantics';
import { filterOverflow } from '../core/filter-overflow';
import { computeLayout, computeChannelBudgets, computeMinSubplotDimensions } from '../core/compute-layout';
import { vlApplyLayoutToSpec, vlApplyTooltips } from './instantiate-spec';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a Vega-Lite specification.
 *
 * ```ts
 * const spec = assembleVegaLite({
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
export function assembleVegaLite(input: ChartAssemblyInput): any {
    const chartType = input.chart_spec.chartType;
    const encodings = input.chart_spec.encodings;
    const data = input.data.values ?? [];
    const semanticTypes = input.semantic_types ?? {};
    const canvasSize = input.chart_spec.canvasSize ?? { width: 400, height: 320 };
    const chartProperties = input.chart_spec.chartProperties;
    const options = input.options ?? {};
    const chartTemplate = vlGetTemplateDef(chartType) as ChartTemplateDef;
    if (!chartTemplate) {
        throw new Error(`Unknown chart type: ${chartType}`);
    }

    const warnings: ChartWarning[] = [];

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 0: Resolve Semantics (VL-free)
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
                    // Use chartProperties.binCount when available so layout
                    // sizing matches the actual number of bins rendered.
                    const propBins = chartProperties?.binCount;
                    if (propBins != null) {
                        binnedAxes[axis] = { maxbins: propBins };
                    } else if (typeof templateEnc[axis].bin === 'object' && templateEnc[axis].bin.maxbins) {
                        binnedAxes[axis] = templateEnc[axis].bin;
                    } else {
                        // Find the template's default binCount from its property definitions
                        const binPropDef = chartTemplate.properties?.find(
                            (p: any) => p.key === 'binCount'
                        );
                        const defaultBins = binPropDef?.defaultValue ?? 10;
                        binnedAxes[axis] = { maxbins: defaultBins };
                    }
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
        maxStretch: maxStretchVal = 2,
        minSubplotSize: minSubplotVal = 60,
    } = effectiveOptions;

    // VL facet overhead:
    //   Fixed: y-axis labels (~35px width) + x-axis labels (~22px height)
    //          + titles/legend margin.
    //   Gap:   config.facet.spacing between panels; shrunk post-layout for
    //          small subplots (see facetGapVal below).
    if (effectiveOptions.facetFixedPadding == null) {
        effectiveOptions.facetFixedPadding = { width: 50, height: 40 };
    }
    if (effectiveOptions.facetGap == null) {
        effectiveOptions.facetGap = 10;
    }
    if (effectiveOptions.targetBandAR == null) {
        effectiveOptions.targetBandAR = 10;
    }
    const facetFixW = effectiveOptions.facetFixedPadding.width;
    const facetFixH = effectiveOptions.facetFixedPadding.height;

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0b: filterOverflow (VL-free)
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

    // ── Channel budgets (shared, in layout module) ─────────────────────
    // Computes per-channel max-to-keep using the most conservative
    // assumptions (minStep, maxStretch).  Also decides facet grid.
    const budgets = computeChannelBudgets(
        channelSemantics, declaration, convertedData, canvasSize, effectiveOptions,
    );
    const facetGridResult = budgets.facetGrid;

    const overflowResult = filterOverflow(
        channelSemantics, declaration, encodings, convertedData,
        budgets, allMarkTypes,
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
        facetGridResult,
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

    // --- Align sort/domain arrays to converted data types ---
    // buildVLEncodings uses the original data, but the VL spec embeds
    // post-conversion data (e.g. Year 1980 → "1980").  Re-map sort and
    // scale.domain entries so VL can match them against data.values.
    for (const enc of Object.values(resolvedEncodings)) {
        const field = enc?.field;
        if (!field) continue;
        // Build a lookup from the converted (spec-embedded) data
        const valMap = new Map<string, any>();
        for (const r of values) {
            const v = r[field];
            if (v != null && !valMap.has(String(v))) valMap.set(String(v), v);
        }
        if (valMap.size === 0) continue;
        const remap = (arr: any[]) => arr.map(v => {
            const key = String(v);
            return valMap.has(key) ? valMap.get(key) : v;
        });
        if (Array.isArray(enc.sort)) enc.sort = remap(enc.sort);
        if (Array.isArray(enc.scale?.domain)) enc.scale.domain = remap(enc.scale.domain);
    }

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
        assembleOptions: effectiveOptions,
    };

    chartTemplate.instantiate(vgObj, instantiateContext);

    // Merge any warnings emitted by instantiate
    if (vgObj._warnings && Array.isArray(vgObj._warnings)) {
        warnings.push(...vgObj._warnings);
        delete vgObj._warnings;
    }

    // --- restructureFacets (VL-specific) ---
    // The facet grid (including wrapping) was already decided by
    // computeChannelBudgets.  restructureFacets only performs the VL structural
    // transform (column encoding → facet + spec for layered specs).

    restructureFacets(vgObj, nominalCounts, facetGridResult);

    // --- vlApplyLayoutToSpec (VL-specific: config, sizing, formatting) ---

    vlApplyLayoutToSpec(vgObj, instantiateContext, warnings);

    // --- Post-layout adjustments (VL-specific) ---

    const defaultChartWidth = canvasSize.width;
    const defaultChartHeight = canvasSize.height;

    // Compute banded-aware minimum subplot dimensions from core helper.
    const { minSubplotWidth, minSubplotHeight } = computeMinSubplotDimensions(
        channelSemantics, declaration, values, effectiveOptions,
    );

    // Shrink gap for small subplots: scale linearly from the reference
    // (10px gap at 100px subplot), with a floor of 4px.
    const refGap = effectiveOptions.facetGap ?? 0;
    const subplotDim = Math.min(layoutResult.subplotWidth, layoutResult.subplotHeight);
    const REF_SUBPLOT = 100;
    const facetGapVal = Math.max(6, Math.round(refGap * subplotDim / REF_SUBPLOT));

    // Apply the computed gap to the VL spec so Vega-Lite uses it for spacing.
    vgObj.config = vgObj.config || {};
    vgObj.config.facet = { spacing: facetGapVal };

    const maxFacetColumns = Math.max(2, Math.floor((defaultChartWidth * maxStretchVal - facetFixW) / (minSubplotWidth + facetGapVal)));
    const maxFacetRows = Math.max(2, Math.floor((defaultChartHeight * maxStretchVal - facetFixH) / (minSubplotHeight + facetGapVal)));
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

    // Independent y-axis scaling for faceted charts.
    // For layered specs (e.g. Regression), y encoding lives inside layer items, not at the top.
    const effectiveEncoding = vgObj.spec?.encoding || vgObj.encoding;
    const layerEncodings = (vgObj.spec?.layer || vgObj.layer || []).map((l: any) => l.encoding).filter(Boolean);
    const yEnc = effectiveEncoding?.y || layerEncodings.find((e: any) => e.y)?.y;
    const effectiveFacet = vgObj.facet || vgObj.encoding?.facet;
    const hasFacetedQuant = effectiveFacet != undefined && yEnc?.type === 'quantitative';
    let computedIndependentYAxis = false;
    if (hasFacetedQuant) {
        const userChoice = chartProperties?.independentYAxis; // true | false | undefined

        if (userChoice === undefined) {
            // Auto-heuristic: independent when value ranges differ by ≥100×
            const yField = yEnc.field;
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
                        computedIndependentYAxis = true;
                    }
                }
            }
        } else {
            computedIndependentYAxis = !!userChoice;
        }

        if (computedIndependentYAxis) {
            if (!vgObj.resolve) vgObj.resolve = {};
            if (!vgObj.resolve.scale) vgObj.resolve.scale = {};
            vgObj.resolve.scale.y = "independent";
        }
    }

    if (addTooltipsOpt) {
        vlApplyTooltips(vgObj);
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
    // Expose computed config so the UI can seed toggle defaults from heuristic results.
    // Only include keys when the corresponding property is relevant (e.g. faceted).
    const computedConfig: Record<string, any> = {};
    if (hasFacetedQuant) {
        computedConfig.independentYAxis = computedIndependentYAxis;
    }
    result._computedConfig = computedConfig;
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
    semanticTypes: Record<string, string | SemanticAnnotation>,
    templateMarkType: string | undefined,
    chartTemplate: ChartTemplateDef,
): Record<string, any> {
    const resolvedEncodings: Record<string, any> = {};

    // Only process channels the template declares (plus facets which are always valid)
    const templateChannels = new Set([
        ...(chartTemplate.channels || []),
        'column', 'row',  // faceting is always allowed
    ]);

    for (const [channel, encoding] of Object.entries(encodings)) {
        // Skip channels not supported by this chart type
        if (!templateChannels.has(channel)) continue;

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
        // Helper: when the field's actual data values are numeric but the
        // encoding is nominal, domain/sort arrays must keep numeric types
        // so Vega-Lite can match them against the data.
        const fieldIsNumeric = fieldName
            ? data.some(r => typeof r[fieldName] === 'number')
            : false;
        const preserveDomainTypes = (arr: any[]): any[] => {
            if (!fieldIsNumeric) return arr;
            return arr.map(v => {
                if (typeof v === 'string') {
                    const n = Number(v);
                    if (!isNaN(n) && String(n) === v.trim()) return n;
                }
                return v;
            });
        };

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
                // Temporal fields sort chronologically by default in VL; an explicit
                // value array is redundant, pollutes the spec with potentially hundreds
                // of date strings, and can break continuous temporal scales.
                if (encodingObj.type !== 'temporal') {
                    try {
                        if (fieldName) {
                            const fieldSemType = toTypeString(semanticTypes[fieldName]);
                            const fieldVisCat = inferVisCategory(data.map(r => r[fieldName]));
                            let sortedValues = JSON.parse(encoding.sortBy);

                            if (fieldVisCat === 'temporal' || fieldSemType === "Year" || fieldSemType === "Decade") {
                                sortedValues = sortedValues.map((v: any) => v.toString());
                            }

                            // Preserve numeric types for nominal fields with numeric data
                            sortedValues = preserveDomainTypes(sortedValues);

                            encodingObj.sort = (encoding.sortOrder === "ascending" || !encoding.sortOrder)
                                ? sortedValues : sortedValues.reverse();
                        }
                    } catch {
                        console.warn(`sort error > ${encoding.sortBy}`);
                    }
                }
            }
        } else {
            // Auto-sort: apply canonical ordinal sort (months, days, quarters, etc.)
            // when available. Otherwise, set `sort: null` so VL preserves the data
            // encounter order rather than its default alphabetical sort.
            // Alphabetical sort breaks labels like "Stage 1", "Stage 10", "Stage 2"
            // which should follow their natural data order.
            const isDiscreteType = encodingObj.type === 'nominal' || encodingObj.type === 'ordinal';
            if (isDiscreteType) {
                if (cs?.ordinalSortOrder && cs.ordinalSortOrder.length > 0) {
                    encodingObj.sort = preserveDomainTypes(cs.ordinalSortOrder);
                } else if (fieldIsNumeric && fieldName) {
                        // Numeric data treated as nominal/ordinal: sort by numeric
                        // value so labels appear as 0,1,2,3… instead of data-encounter
                        // order.  Use "ascending" instead of an explicit value array
                        // to keep the spec compact (avoids enumerating every unique
                        // value, which can be hundreds for fields like Rank).
                        encodingObj.sort = "ascending";
                } else {
                    encodingObj.sort = null;
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

        // Create offset encoding for position subdivision.
        // Coordinate sort with color so bar order matches legend order.
        if (!resolvedEncodings[offsetChannel]) {
            const offsetEnc: any = { field: groupCS.field, type: 'nominal' };
            if (resolvedEncodings.color?.sort !== undefined) {
                offsetEnc.sort = resolvedEncodings.color.sort;
            }
            resolvedEncodings[offsetChannel] = offsetEnc;
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

/**
 * Purely structural VL transform for faceted charts.
 *
 * This function does NOT decide wrapping or column counts — that is done
 * earlier by computeFacetGrid, which returns a `FacetGridResult`.  This function
 * only:
 *   1. Moves `encoding.column` → `encoding.facet` (with `columns: N`).
 *   2. For layered specs, hoists to top-level `facet` + `spec`.
 */
function restructureFacets(
    vgObj: any,
    nominalCounts: Record<string, number>,
    facetGrid?: { columns: number; rows: number },
): void {

    if (vgObj.encoding?.column != undefined && vgObj.encoding?.row == undefined) {
        vgObj.encoding.facet = vgObj.encoding.column;

        // Use the grid decided by computeFacetGrid.
        const numCols = facetGrid?.columns ?? (nominalCounts.column || 1);
        const numRows = facetGrid?.rows ?? 1;

        vgObj.encoding.facet.columns = numCols;

        // Axis title suppression for faceted charts is handled by
        // vlApplyLayoutToSpec, which uses actual subplot dimensions
        // to decide whether titles should be hidden (size-based threshold).

        delete vgObj.encoding.column;

        // For layered specs, VL doesn't support encoding.facet inline —
        // restructure to top-level facet + spec.
        // IMPORTANT: In top-level facet mode, `columns` must be a sibling
        // of `facet`, not nested inside it. (VL ignores columns inside
        // the facet object when it's a top-level property.)
        if (vgObj.layer && Array.isArray(vgObj.layer)) {
            const facetDef = { ...vgObj.encoding.facet };
            const wrapColumns = facetDef.columns;
            delete facetDef.columns; // remove from facet object
            delete vgObj.encoding.facet;

            vgObj.facet = facetDef;
            if (wrapColumns != null) {
                vgObj.columns = wrapColumns; // top-level sibling
            }
            vgObj.spec = {
                layer: vgObj.layer,
                encoding: vgObj.encoding,
            };
            delete vgObj.layer;
            delete vgObj.encoding;
        }

        return;
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
