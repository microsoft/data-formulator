// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * PHASE 2: INSTANTIATE SPEC
 * =============================================================================
 *
 * Combine semantic decisions (Phase 0) and layout dimensions (Phase 1) to
 * produce the final Vega-Lite specification.
 *
 * This is the **only phase that knows about Vega-Lite** (or whichever
 * output format is targeted).
 *
 * VL dependency: **Yes — this is where VL lives**
 * =============================================================================
 */

import type {
    ChannelSemantics,
    LayoutResult,
    InstantiateContext,
    ChartWarning,
} from '../core/types';
import {
    computePaddedDomain,
} from '../core/semantic-types';
import {
    looksLikeDateString,
    analyzeTemporalField,
    computeDataVotes,
    pickBestLevel,
    levelToFormat,
    SEMANTIC_LEVEL,
} from '../core/resolve-semantics';
import {
    getVisCategory,
    inferVisCategory,
} from '../core/semantic-types';

// ---------------------------------------------------------------------------
// Public API: instantiateSpec
// ---------------------------------------------------------------------------

/**
 * Phase 2: Build the final VL specification from semantic decisions and
 * layout results.
 *
 * This is the shared assembler logic that translates abstract decisions
 * into VL syntax. Template-specific logic is handled by
 * template.instantiate(spec, context).
 *
 * This function handles the VL-specific plumbing that is common across
 * all templates:
 *   - Canvas dimensions (config.view.continuousWidth/Height)
 *   - Discrete step sizing (width: {step: N})
 *   - Zero-baseline application
 *   - Color scheme application
 *   - Temporal format application
 *   - Label sizing application
 *   - Overflow warning styling
 *
 * @param vgObj       The mutated VL spec (after template encoding construction)
 * @param context     Combined context from all phases
 * @param warnings    Array to append warnings to
 */
export function vlApplyLayoutToSpec(
    vgObj: any,
    context: InstantiateContext,
    warnings: ChartWarning[],
): void {
    const { channelSemantics, layout, canvasSize } = context;

    const xIsDiscrete = layout.xNominalCount > 0;
    const yIsDiscrete = layout.yNominalCount > 0;

    // --- Helper: iterate encoding targets across top-level, spec, and layers ---
    // After facet restructuring, encodings may live under vgObj.spec instead
    // of vgObj directly, and layers may be under vgObj.spec.layer.
    const collectEncodingTargets = (ch: string): any[] => {
        const targets: any[] = [];
        if (vgObj.encoding?.[ch]) targets.push(vgObj.encoding[ch]);
        if (vgObj.spec?.encoding?.[ch]) targets.push(vgObj.spec.encoding[ch]);
        if (Array.isArray(vgObj.layer)) {
            for (const layer of vgObj.layer) {
                if (layer.encoding?.[ch]) targets.push(layer.encoding[ch]);
            }
        }
        if (Array.isArray(vgObj.spec?.layer)) {
            for (const layer of vgObj.spec.layer) {
                if (layer.encoding?.[ch]) targets.push(layer.encoding[ch]);
            }
        }
        return targets;
    };

    // --- Apply zero-baseline decisions ---
    for (const ch of ['x', 'y'] as const) {
        const cs = channelSemantics[ch];
        if (!cs?.zero) continue;
        const decision = cs.zero;

        const targets = collectEncodingTargets(ch)
            .filter(enc => enc.type === 'quantitative');

        for (const enc of targets) {
            if (!enc.scale) enc.scale = {};
            if (enc.scale.zero !== undefined) continue;
            if (enc.scale.domain && Array.isArray(enc.scale.domain)) continue;

            enc.scale.zero = decision.zero;

            if (!decision.zero && decision.domainPadFraction > 0) {
                const fieldName = enc.field;
                if (fieldName) {
                    const numericValues = context.table
                        .map(r => r[fieldName])
                        .filter((v: any) => v != null && typeof v === 'number' && !isNaN(v));
                    const paddedDomain = computePaddedDomain(numericValues, decision.domainPadFraction);
                    if (paddedDomain) {
                        enc.scale.domain = paddedDomain;
                        enc.scale.nice = false;
                    }
                }
            }
        }
    }

    // --- Apply temporal formatting ---
    const applyTemporalFormat = (enc: any, channel: string, cs: ChannelSemantics | undefined) => {
        if (!enc || !cs?.temporalFormat) return;
        if (enc.type === 'temporal') {
            if (channel === 'x' || channel === 'y') {
                if (!enc.axis) enc.axis = {};
                enc.axis.format = cs.temporalFormat;
            } else if (channel === 'color') {
                if (!enc.legend) enc.legend = {};
                enc.legend.format = cs.temporalFormat;
            }
        }
    };

    const applyOrdinalTemporalFormat = (enc: any, channel: string, cs: ChannelSemantics | undefined) => {
        if (!enc || !enc.field) return;
        if (enc.type !== 'ordinal' && enc.type !== 'nominal') return;
        if (!cs) return;

        const semanticType = context.semanticTypes[enc.field] || '';
        const stCategory = semanticType ? getVisCategory(semanticType) : null;
        if (stCategory !== 'temporal') return;

        const fieldVals = context.table.map((r: any) => r[enc.field]).filter((v: any) => v != null);
        const datelikeCnt = fieldVals.filter((v: any) =>
            typeof v !== 'string' || looksLikeDateString(String(v))
        ).length;
        if (datelikeCnt < fieldVals.length * 0.5) return;

        const analysis = analyzeTemporalField(fieldVals);
        if (!analysis) return;

        const votes = computeDataVotes(analysis.same);
        const semLevel = SEMANTIC_LEVEL[semanticType];
        if (semLevel !== undefined) votes[semLevel] += 3;
        const { level, score } = pickBestLevel(votes);
        if (score < 5) return;

        const fmt = levelToFormat(level, analysis);
        if (!fmt) return;

        const expr = `isValid(toDate(datum.label)) ? timeFormat(toDate(datum.label), '${fmt}') : datum.label`;
        if (channel === 'x' || channel === 'y') {
            if (!enc.axis) enc.axis = {};
            enc.axis.labelExpr = expr;
        } else if (channel === 'color') {
            if (!enc.legend) enc.legend = {};
            enc.legend.labelExpr = expr;
        }
    };

    // Iterate all encoding locations (top-level, spec, layers)
    const applyTemporalToEncoding = (encoding: Record<string, any>) => {
        for (const [ch, enc] of Object.entries(encoding)) {
            applyTemporalFormat(enc, ch, channelSemantics[ch]);
            applyOrdinalTemporalFormat(enc, ch, channelSemantics[ch]);
        }
    };

    if (vgObj.encoding) applyTemporalToEncoding(vgObj.encoding);
    if (vgObj.spec?.encoding) applyTemporalToEncoding(vgObj.spec.encoding);
    if (Array.isArray(vgObj.layer)) {
        for (const layer of vgObj.layer) {
            if (layer.encoding) applyTemporalToEncoding(layer.encoding);
        }
    }
    if (Array.isArray(vgObj.spec?.layer)) {
        for (const layer of vgObj.spec.layer) {
            if (layer.encoding) applyTemporalToEncoding(layer.encoding);
        }
    }

    // --- Banded continuous axis domain padding ---
    for (const axis of ['x', 'y'] as const) {
        const count = axis === 'x' ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
        if (count <= 0) continue;

        // Check both top-level and spec encoding
        const enc = vgObj.encoding?.[axis] || vgObj.spec?.encoding?.[axis];
        if (enc) {
            if (!enc.scale) enc.scale = {};
            enc.scale.nice = false;

            const isTemporal = enc.type === 'temporal';
            const numericVals = context.table
                .map((r: any) => {
                    const raw = r[enc.field];
                    if (raw == null) return NaN;
                    if (isTemporal) return +new Date(raw);
                    return +raw;
                })
                .filter((v: number) => !isNaN(v));
            if (numericVals.length > 1) {
                const minVal = Math.min(...numericVals);
                const maxVal = Math.max(...numericVals);
                const dataRange = maxVal - minVal;
                const halfStep = dataRange / (count - 1) / 2;
                if (isTemporal) {
                    enc.scale.domain = [
                        new Date(minVal - halfStep).toISOString(),
                        new Date(maxVal + halfStep).toISOString(),
                    ];
                } else {
                    enc.scale.domain = [minVal - halfStep, maxVal + halfStep];
                }
            }
        }
    }

    // --- Canvas sizing ---
    const axisXConfig: Record<string, any> = {
        labelLimit: layout.xLabel.labelLimit,
        labelFontSize: layout.xLabel.fontSize,
    };
    if (layout.xLabel.labelAngle !== undefined) {
        axisXConfig.labelAngle = layout.xLabel.labelAngle;
        axisXConfig.labelAlign = layout.xLabel.labelAlign;
        axisXConfig.labelBaseline = layout.xLabel.labelBaseline;
    }
    const axisYConfig: Record<string, any> = { labelFontSize: layout.yLabel.fontSize };

    vgObj.config = {
        view: {
            continuousWidth: layout.subplotWidth,
            continuousHeight: layout.subplotHeight,
            ...(!vgObj.encoding && { stroke: null }),
        },
        axisX: axisXConfig,
        axisY: axisYConfig,
    };

    // --- Step-based sizing for discrete axes ---
    if (xIsDiscrete && typeof vgObj.width !== 'number') {
        vgObj.width = layout.xStepUnit === 'group'
            ? { step: layout.xStep, for: 'position' }
            : { step: layout.xStep };
    }
    if (yIsDiscrete && typeof vgObj.height !== 'number') {
        vgObj.height = layout.yStepUnit === 'group'
            ? { step: layout.yStep, for: 'position' }
            : { step: layout.yStep };
    }

    // Sync hardcoded template width/height to config.view
    if (typeof vgObj.width === 'number') {
        vgObj.config.view.continuousWidth = vgObj.width;
    } else if (vgObj.width && typeof vgObj.width === 'object' && 'step' in vgObj.width) {
        vgObj.width = layout.xStepUnit === 'group'
            ? { step: layout.xStep, for: 'position' }
            : { step: layout.xStep };
    }
    if (typeof vgObj.height === 'number') {
        vgObj.config.view.continuousHeight = vgObj.height;
    } else if (vgObj.height && typeof vgObj.height === 'object' && 'step' in vgObj.height) {
        vgObj.height = layout.yStepUnit === 'group'
            ? { step: layout.yStep, for: 'position' }
            : { step: layout.yStep };
    }

    // Facet header sizing
    const totalFacets = (layout.facet?.columns ?? 1) * (layout.facet?.rows ?? 1);
    if (totalFacets > 6) {
        vgObj.config.header = { labelLimit: 120, labelFontSize: 9 };
    }

    // Reduce clutter in faceted charts
    const facetRows = layout.facet?.rows ?? 1;
    const facetCols = layout.facet?.columns ?? 1;
    const encTarget = vgObj.spec?.encoding || vgObj.encoding;
    const yTitleThreshold = 100;
    const xTitleThreshold = 100;

    if (facetRows > 1 && layout.subplotHeight < yTitleThreshold) {
        if (vgObj.config?.axisY) vgObj.config.axisY.title = null;
        if (encTarget?.y) {
            if (!encTarget.y.axis) encTarget.y.axis = {};
            encTarget.y.axis.title = null;
        }
    }
    if (facetCols > 1 && facetRows > 1 && layout.subplotWidth < xTitleThreshold) {
        if (vgObj.config?.axisX) vgObj.config.axisX.title = null;
        if (encTarget?.x) {
            if (!encTarget.x.axis) encTarget.x.axis = {};
            encTarget.x.axis.title = null;
        }
    }

    // --- Dual-legend repositioning ---
    // When multiple channels produce legends (e.g. color + size, color + opacity),
    // Vega-Lite stacks them all on the right, which eats into the plot area on a
    // 400×300 canvas.  Detect this and move the categorical (nominal/ordinal)
    // legend to the bottom with horizontal orientation, keeping the quantitative
    // legend compact on the right.
    const legendChannels = (['color', 'size', 'shape', 'opacity', 'strokeDash', 'strokeWidth'] as const)
        .filter(ch => {
            const targets = collectEncodingTargets(ch);
            return targets.some(enc => enc.field && enc.legend !== null);
        });

    if (legendChannels.length >= 2) {
        // Separate categorical vs quantitative legend channels
        const categoricalChs: string[] = [];
        const quantitativeChs: string[] = [];
        for (const ch of legendChannels) {
            const targets = collectEncodingTargets(ch);
            const isQuant = targets.some(enc => enc.type === 'quantitative' || enc.type === 'temporal');
            if (isQuant) {
                quantitativeChs.push(ch);
            } else {
                categoricalChs.push(ch);
            }
        }

        // Move categorical legends to bottom, keep quantitative ones on right
        if (categoricalChs.length > 0 && quantitativeChs.length > 0) {
            for (const ch of categoricalChs) {
                const targets = collectEncodingTargets(ch);
                for (const enc of targets) {
                    if (!enc.field) continue;
                    if (!enc.legend) enc.legend = {};
                    enc.legend.orient = 'bottom';
                    enc.legend.direction = 'horizontal';

                    // Responsive columns: estimate how many legend entries fit
                    // per row based on the available canvas width.
                    // Each entry ≈ symbol(16) + label + padding.  Estimate label
                    // width from the longest domain value, then derive columns.
                    const domainValues = [...new Set(context.table.map((r: any) => r[enc.field]))];
                    const domainSize = domainValues.length;
                    const maxLabelLen = Math.max(
                        ...domainValues.map((v: any) => String(v ?? '').length), 3,
                    );
                    // VL legend: symbol (~15px) + label (~5px/char at 11px proportional font) + gap (~8px)
                    const entryWidth = 15 + maxLabelLen * 5 + 8;
                    // Available width: VL's bottom legend spans the full SVG width,
                    // which includes the plot area plus the right-side quantitative
                    // legend (~130px).  Use that total for column estimation.
                    const rightLegendWidth = 130;
                    const availableWidth = canvasSize.width + rightLegendWidth;
                    const columnsByWidth = Math.max(1, Math.floor(availableWidth / entryWidth));
                    enc.legend.columns = Math.min(columnsByWidth, domainSize);

                    // For very high cardinality, cap visible symbols to keep
                    // the bottom legend from growing too tall.
                    const maxRows = 4;
                    const maxVisible = columnsByWidth * maxRows;
                    if (domainSize > maxVisible) {
                        enc.legend.symbolLimit = maxVisible;
                    }
                }
            }
        }
    }

    // --- Overflow styling (from TruncationWarning[]) ---
    // Applied AFTER template.instantiate and facet restructuring,
    // so we modify the spec's actual encoding objects.
    for (const trunc of layout.truncations) {
        const ch = trunc.channel;
        const targets = collectEncodingTargets(ch);

        for (const enc of targets) {
            if (!enc.field) continue;

            // Axis/legend label color: grey for placeholder
            if (ch === 'x' || ch === 'y') {
                if (!enc.axis) enc.axis = {};
                enc.axis.labelColor = {
                    condition: {
                        test: `datum.label == '${trunc.placeholder}'`,
                        value: "#999999",
                    },
                    value: "#000000",
                };
                // Set domain to kept values + placeholder
                if (!enc.scale) enc.scale = {};
                enc.scale.domain = [...trunc.keptValues, trunc.placeholder];
            } else if (ch === 'color') {
                if (!enc.legend) enc.legend = {};
                enc.legend.values = [...trunc.keptValues, trunc.placeholder];
            }
        }
    }
}

/**
 * Apply tooltip configuration to a VL spec.
 */
export function vlApplyTooltips(vgObj: any): void {
    if (!vgObj.config) vgObj.config = {};
    vgObj.config.mark = { ...vgObj.config.mark, tooltip: true };
}
