// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * GoFish chart assembly — Two-Stage Pipeline Coordinator.
 *
 * Reuses the **same core analysis pipeline** as all other backends:
 *   Phase 0:  resolveChannelSemantics  → ChannelSemantics
 *   Step 0a:  declareLayoutMode    → LayoutDeclaration
 *   Step 0b:  convertTemporalData  → converted data
 *   Step 0c:  filterOverflow       → filtered data, nominalCounts
 *   Phase 1:  computeLayout        → LayoutResult
 *
 * Then diverges for Phase 2 (GoFish-specific):
 *   template.instantiate → builds GoFish descriptor (_gofish)
 *   assembler wraps into GoFishSpec with render(container) method
 *
 * ── Backend Translation Responsibilities ────────────────────────────
 * GoFish renders directly to DOM via Solid.js. The assembler produces
 * a GoFishSpec object containing:
 *   - _gofish: descriptor of flow operators, mark shape, data
 *   - render(container): function that creates the GoFish chart
 *   - _width / _height: computed canvas dimensions
 *   - _warnings: any warnings from the pipeline
 *   - _specDescription: human-readable description for debugging
 *
 * Key structural differences from other backends:
 *   VL:  { mark, encoding, data: {values}, width, height }
 *   EC:  { xAxis, yAxis, series: [{type, data}], tooltip, legend, grid }
 *   CJS: { type, data: { labels, datasets[] }, options: { scales, plugins } }
 *   GF:  { _gofish: {type, data, flow, mark}, render: (el) => void }
 *
 * This module has NO React, Redux, or UI framework dependencies.
 */

import {
    ChartTemplateDef,
    ChartAssemblyInput,
    AssembleOptions,
    LayoutDeclaration,
    InstantiateContext,
} from '../core/types';
import type { ChartWarning } from '../core/types';
import { gfGetTemplateDef } from './templates';
import { resolveChannelSemantics, convertTemporalData } from '../core/resolve-semantics';
import { computeZeroDecision } from '../core/semantic-types';
import { filterOverflow } from '../core/filter-overflow';
import { computeLayout, computeChannelBudgets } from '../core/compute-layout';

// ---------------------------------------------------------------------------
// GoFish Spec Type
// ---------------------------------------------------------------------------

/**
 * Output of assembleGoFish — contains the GoFish descriptor and render function.
 */
export interface GoFishSpec {
    /** GoFish descriptor: data, flow operators, mark shape */
    _gofish: {
        type: string;
        data: any[];
        flow?: any[];
        mark?: any;
        layers?: any[];
        coord?: string;
    };
    /** Render the GoFish chart into a DOM container */
    render: (container: HTMLElement) => void;
    /** Computed width */
    _width: number;
    /** Computed height */
    _height: number;
    /** Warnings from assembly pipeline */
    _warnings?: ChartWarning[];
    /** Human-readable spec description for debugging */
    _specDescription: string;
    /** Length of data used */
    _dataLength: number;
}

// ---------------------------------------------------------------------------
// Render function builder
// ---------------------------------------------------------------------------

/**
 * Build a render function that calls GoFish's fluent API to render a chart.
 * Dynamically imports gofish-graphics to avoid bundling issues.
 */
function buildRenderFunction(
    gfDesc: any,
    width: number,
    height: number,
): (container: HTMLElement) => void {
    return (container: HTMLElement) => {
        // Dynamic import of gofish-graphics (ESM-only, optional dependency)
        // @ts-ignore — gofish-graphics may not be installed
        import('gofish-graphics').then((gf: any) => {
            // Clear previous content
            container.innerHTML = '';

            const renderOpts: any = {
                w: width,
                h: height,
                axes: true,
            };

            if (gfDesc.type === 'todo') {
                // TODO chart type — show informational message
                container.innerHTML = `<div style="color:#666;padding:16px;font-size:13px;line-height:1.5;">
                    <strong>GoFish TODO:</strong><br/>${gfDesc.message || 'Not yet implemented.'}
                </div>`;
                return;
            }

            if (gfDesc.layers) {
                // Layer-based charts (line, area with multi-series)
                const layerSpecs: any[] = [];

                for (const layerDef of gfDesc.layers) {
                    let spec: any;

                    if (layerDef.select) {
                        // Second layer: select from named marks
                        spec = gf.chart(gf.select(layerDef.select));
                    } else {
                        spec = gf.chart(gfDesc.data);
                    }

                    // Apply flow operators
                    if (layerDef.flow && layerDef.flow.length > 0) {
                        const flowOps = layerDef.flow.map((f: any) => buildFlowOp(gf, f));
                        spec = spec.flow(...flowOps);
                    }

                    // Apply mark
                    if (layerDef.mark) {
                        const mark = buildMark(gf, layerDef.mark);
                        const layerName = layerDef.mark.name;

                        if (layerName) {
                            // Try naming via mark.name() (official docs pattern:
                            //   scaffold({h:"count"}).name("points"))
                            // Falls back to spec.as() if mark.name isn't callable.
                            try {
                                const namedMark = mark.name(layerName);
                                spec = spec.mark(namedMark);
                            } catch {
                                spec = spec.mark(mark);
                                try {
                                    spec = spec.as(layerName);
                                } catch {
                                    // Layer naming not available — select() may fail
                                }
                            }
                        } else {
                            spec = spec.mark(mark);
                        }
                    }

                    layerSpecs.push(spec);
                }

                // Apply coordinate transform if specified
                if (gfDesc.coord === 'clock') {
                    gf.layer({ coord: gf.clock() }, layerSpecs)
                        .render(container, renderOpts);
                } else {
                    gf.layer(layerSpecs).render(container, renderOpts);
                }
            } else {
                // Simple single-flow charts (bar, scatter, pie)
                // Pass coord directly to chart() when specified (e.g. clock() for pie)
                const chartOpts: any = {};
                if (gfDesc.coord === 'clock') {
                    chartOpts.coord = gf.clock();
                }
                const hasChartOpts = Object.keys(chartOpts).length > 0;
                let spec = hasChartOpts
                    ? gf.chart(gfDesc.data, chartOpts)
                    : gf.chart(gfDesc.data);

                // Apply flow operators
                if (gfDesc.flow && gfDesc.flow.length > 0) {
                    const flowOps = gfDesc.flow.map((f: any) => buildFlowOp(gf, f));
                    spec = spec.flow(...flowOps);
                }

                // Apply mark
                if (gfDesc.mark && gfDesc.mark.shape === 'scatterpie') {
                    // Scatterpie: mark is a function that returns a sub-chart (pie per point)
                    const { colorField, angleField, pieSize } = gfDesc.mark.options;
                    spec = spec.mark((data: any) => {
                        return gf.chart(data[0].collection, { coord: gf.clock() })
                            .flow(gf.stack(colorField, { dir: 'x', h: pieSize || 20 }))
                            .mark(gf.rect({ w: angleField, fill: colorField }));
                    });
                } else if (gfDesc.mark) {
                    spec = spec.mark(buildMark(gf, gfDesc.mark));
                }

                // Render — add centering transform for polar charts
                if (gfDesc.coord === 'clock') {
                    spec.render(container, {
                        ...renderOpts,
                        transform: { x: width / 2, y: height / 2 },
                    });
                } else {
                    spec.render(container, renderOpts);
                }
            }
        }).catch((err: any) => {
            container.innerHTML = `<div style="color:red;padding:8px;font-size:12px;">
                GoFish render error: ${err.message}
            </div>`;
        });
    };
}

/**
 * Build a GoFish flow operator from descriptor.
 */
function buildFlowOp(gf: any, desc: any): any {
    switch (desc.op) {
        case 'spread':
            return gf.spread(desc.field, desc.options || {});
        case 'stack':
            return gf.stack(desc.field, desc.options || {});
        case 'scatter':
            return gf.scatter(desc.field, desc.options || {});
        case 'group':
            return gf.group(desc.field);
        case 'derive':
            return gf.derive(desc.fn);
        default:
            throw new Error(`Unknown GoFish flow operator: ${desc.op}`);
    }
}

/**
 * Build a GoFish mark from descriptor.
 */
function buildMark(gf: any, desc: any): any {
    const opts = desc.options;
    const hasOpts = opts && Object.keys(opts).length > 0;
    const callMark = (fn: any) => hasOpts ? fn(opts) : fn();
    switch (desc.shape) {
        case 'rect':
            return callMark(gf.rect);
        case 'circle':
            return callMark(gf.circle);
        case 'line':
            return callMark(gf.line);
        case 'area':
            return callMark(gf.area);
        case 'scaffold':
            return callMark(gf.scaffold);
        case 'ellipse':
            return callMark(gf.ellipse);
        case 'petal':
            return callMark(gf.petal);
        default:
            return callMark(gf.rect);
    }
}

/**
 * Build a human-readable description of the GoFish spec for debugging.
 */
function buildSpecDescription(gfDesc: any): string {
    const parts: string[] = [`chart(data[${gfDesc.data?.length ?? 0}])`];

    if (gfDesc.layers) {
        for (const layer of gfDesc.layers) {
            const layerParts: string[] = [];
            if (layer.select) layerParts.push(`select("${layer.select}")`);
            if (layer.flow) {
                for (const f of layer.flow) {
                    layerParts.push(`.${f.op}("${f.field}")`);
                }
            }
            if (layer.mark) {
                layerParts.push(`.mark(${layer.mark.shape}(${JSON.stringify(layer.mark.options)}))`);
            }
            parts.push(`  layer: ${layerParts.join('')}`);
        }
    } else {
        if (gfDesc.flow) {
            for (const f of gfDesc.flow) {
                parts.push(`.flow(${f.op}("${f.field}", ${JSON.stringify(f.options || {})}))`);
            }
        }
        if (gfDesc.mark) {
            parts.push(`.mark(${gfDesc.mark.shape}(${JSON.stringify(gfDesc.mark.options || {})}))`);
        }
    }

    if (gfDesc.coord) {
        parts.push(`coord: ${gfDesc.coord}`);
    }

    return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a GoFish spec — a descriptor + render function.
 *
 * ```ts
 * const spec = assembleGoFish({
 *   data: { values: myRows },
 *   semantic_types: { weight: 'Quantity' },
 *   chart_spec: { chartType: 'Bar Chart', encodings: { x: { field: 'category' }, y: { field: 'value' } } },
 * });
 * spec.render(document.getElementById('chart'));
 * ```
 *
 * @returns A GoFishSpec with render function, dimensions, and metadata
 */
export function assembleGoFish(input: ChartAssemblyInput): GoFishSpec {
    const chartType = input.chart_spec.chartType;
    const encodings = input.chart_spec.encodings;
    const data = input.data.values ?? [];
    const semanticTypes = input.semantic_types ?? {};
    const canvasSize = input.chart_spec.canvasSize ?? { width: 400, height: 320 };
    const chartProperties = input.chart_spec.chartProperties;
    const options = input.options ?? {};
    const chartTemplate = gfGetTemplateDef(chartType) as ChartTemplateDef;
    if (!chartTemplate) {
        throw new Error(`Unknown GoFish chart type: ${chartType}. Use gfAllTemplateDefs to see available types.`);
    }

    const warnings: ChartWarning[] = [];

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 0: Resolve Semantics (shared with all backends)
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
        ...options,
        ...(declaration.paramOverrides || {}),
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0b: filterOverflow (shared)
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

    const values = overflowResult.filteredData;
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
    // PHASE 2: Instantiate GoFish Spec (GF-specific)
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

    const gfSpec: any = structuredClone(chartTemplate.template);

    chartTemplate.instantiate(gfSpec, instantiateContext);

    // Template-specific post-processing
    if (chartTemplate.postProcess) {
        chartTemplate.postProcess(gfSpec, instantiateContext);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Compute dimensions
    // ═══════════════════════════════════════════════════════════════════════

    const gfDescriptor = gfSpec._gofish;
    if (!gfDescriptor) {
        throw new Error(`GoFish template for "${chartType}" did not produce a _gofish descriptor`);
    }

    const PADDING = 80;

    // For layered charts (line, area) GoFish's spread() handles discrete
    // positioning internally — use the full subplot canvas, not step × count.
    const isLayered = !!gfDescriptor.layers;

    let plotWidth: number;
    let plotHeight: number;

    if (isLayered) {
        // Line / area charts: pass full canvas to GoFish
        plotWidth = layoutResult.subplotWidth || canvasSize.width;
        plotHeight = layoutResult.subplotHeight || canvasSize.height;
    } else {
        const xIsDiscrete = layoutResult.xNominalCount > 0 || layoutResult.xContinuousAsDiscrete > 0;
        const yIsDiscrete = layoutResult.yNominalCount > 0 || layoutResult.yContinuousAsDiscrete > 0;

        if (xIsDiscrete) {
            if (layoutResult.xStepUnit === 'group') {
                plotWidth = layoutResult.subplotWidth;
            } else {
                const xItemCount = layoutResult.xNominalCount || layoutResult.xContinuousAsDiscrete || 0;
                plotWidth = xItemCount > 0 ? layoutResult.xStep * xItemCount : (layoutResult.subplotWidth || canvasSize.width);
            }
        } else {
            plotWidth = layoutResult.subplotWidth || canvasSize.width;
        }

        if (yIsDiscrete) {
            if (layoutResult.yStepUnit === 'group') {
                plotHeight = layoutResult.subplotHeight;
            } else {
                const yItemCount = layoutResult.yNominalCount || layoutResult.yContinuousAsDiscrete || 0;
                plotHeight = yItemCount > 0 ? layoutResult.yStep * yItemCount : (layoutResult.subplotHeight || canvasSize.height);
            }
        } else {
            plotHeight = layoutResult.subplotHeight || canvasSize.height;
        }
    }

    const finalWidth = plotWidth + PADDING;
    const finalHeight = plotHeight + PADDING;

    // ═══════════════════════════════════════════════════════════════════════
    // RESULT
    // ═══════════════════════════════════════════════════════════════════════

    const result: GoFishSpec = {
        _gofish: gfDescriptor,
        render: buildRenderFunction(gfDescriptor, finalWidth - PADDING, finalHeight - PADDING),
        _width: finalWidth,
        _height: finalHeight,
        _specDescription: buildSpecDescription(gfDescriptor),
        _dataLength: values.length,
    };

    if (warnings.length > 0) {
        result._warnings = warnings;
    }

    return result;
}
