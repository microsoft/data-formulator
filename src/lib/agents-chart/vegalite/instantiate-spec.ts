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
import type { FormatSpec } from '../core/field-semantics';
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
import { toTypeString, snapToBoundHeuristic } from '../core/field-semantics';

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
            // Skip binned encodings — the bin axis represents data values,
            // not bar length, so zero-baseline is inappropriate (e.g. histograms).
            if (enc.bin) continue;
            // Skip encodings using a private/synthetic field distinct from
            // the channel's semantic field (e.g. Radar's `__y` polar coord).
            if (cs.field && enc.field && enc.field !== cs.field) continue;
            if (!enc.scale) enc.scale = {};
            if (enc.scale.zero !== undefined) continue;
            if (enc.scale.domain && Array.isArray(enc.scale.domain)) continue;

            enc.scale.zero = decision.zero;

            // No explicit domain padding — VL's native `nice` rounding
            // (on by default) already provides breathing room with clean
            // tick-aligned bounds, which is superior to computed fractional
            // bounds like [1.86, 4.94] that also conflict with semantic
            // domain constraints and log scales.
        }
    }

    // --- Apply field-context semantic decisions (format, domain, ticks, etc.) ---
    vlApplyFieldContext(vgObj, channelSemantics, collectEncodingTargets, context);

    // --- Apply temporal formatting ---
    // For positional temporal axes (x/y), do NOT set axis.format — VL's
    // built-in multi-level temporal labeling (e.g. "2016" at year boundaries,
    // "April" / "July" within a year) is far superior to a single uniform
    // format string which loses hierarchical context.
    // We still apply the format to color legends where multi-level is unavailable.
    const applyTemporalFormat = (enc: any, channel: string, cs: ChannelSemantics | undefined) => {
        if (!enc || !cs?.temporalFormat) return;
        if (enc.type === 'temporal') {
            if (channel === 'color') {
                if (!enc.legend) enc.legend = {};
                enc.legend.format = cs.temporalFormat;
            }
            // x/y: intentionally omitted — let VL use native multi-level labels
        }
    };

    const applyOrdinalTemporalFormat = (enc: any, channel: string, cs: ChannelSemantics | undefined) => {
        if (!enc || !enc.field) return;
        if (enc.type !== 'ordinal' && enc.type !== 'nominal') return;
        if (!cs) return;

        const semanticType = toTypeString(context.semanticTypes[enc.field]);
        const stCategory = semanticType ? getVisCategory(semanticType) : null;
        if (stCategory !== 'temporal') return;

        const fieldVals = context.table.map((r: any) => r[enc.field]).filter((v: any) => v != null);

        // Single unique value → no temporal formatting (would lose precision, e.g. "2007-12" → "2007")
        const uniqueVals = new Set(fieldVals.map(String));
        if (uniqueVals.size <= 1) return;

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
            if (enc.axis === null) return; // preserve axis suppression
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
    // For banded continuous axes (e.g. Heatmap with quantitative X/Y),
    // add a half-step buffer so edge cells aren't clipped at the boundary.
    // Without this, the domain starts/ends exactly at min/max data values
    // and rect marks at the edges are only half-visible.
    for (const axis of ['x', 'y'] as const) {
        const bandedCount = axis === 'x' ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
        if (bandedCount <= 1) continue;

        const enc = vgObj.encoding?.[axis] || vgObj.spec?.encoding?.[axis];
        if (!enc) continue;

        // Skip binned encodings — VL handles bin domain automatically
        if (enc.bin) continue;

        const isTemporal = enc.type === 'temporal';
        const isContinuous = enc.type === 'quantitative' || isTemporal;
        if (!isContinuous) continue;
        if (enc.scale?.domain) continue;

        const numericVals = context.table
            .map((r: any) => {
                const raw = r[enc.field];
                if (raw == null) return NaN;
                if (isTemporal) return +new Date(raw);
                return +raw;
            })
            .filter((v: number) => !isNaN(v));
        if (numericVals.length <= 1) continue;

        const minVal = Math.min(...numericVals);
        const maxVal = Math.max(...numericVals);
        const dataRange = maxVal - minVal;
        if (dataRange === 0) continue;

        const pad = dataRange / (bandedCount - 1) / 2;
        if (!enc.scale) enc.scale = {};
        enc.scale.nice = false;

        if (isTemporal) {
            enc.scale.domain = [
                new Date(minVal - pad).toISOString(),
                new Date(maxVal + pad).toISOString(),
            ];
        } else {
            enc.scale.domain = [minVal - pad, maxVal + pad];
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

    // Facet header sizing — constrain labels to subplot width
    const totalFacets = (layout.facet?.columns ?? 1) * (layout.facet?.rows ?? 1);
    const facetRows = layout.facet?.rows ?? 1;
    const facetCols = layout.facet?.columns ?? 1;
    if (facetRows > 1 || facetCols > 1) {
        const limit = Math.max(80, layout.subplotWidth + 20);
        const headerCfg: Record<string, any> = { labelLimit: limit };
        if (totalFacets > 6) {
            headerCfg.labelFontSize = 9;
        }
        vgObj.config.header = { ...(vgObj.config.header || {}), ...headerCfg };
    }
    const encTarget = vgObj.spec?.encoding || vgObj.encoding;

    if (facetRows > 1 || facetCols > 1) {
        if (!vgObj.config) vgObj.config = {};
        const lightTitle = { titleFontWeight: 'normal' as const, titleFontSize: 11, titleColor: '#666' };
        vgObj.config.axisX = { ...(vgObj.config.axisX || {}), ...lightTitle };
        vgObj.config.axisY = { ...(vgObj.config.axisY || {}), ...lightTitle };
    }

    // When row faceting is used, use lighter y axis title styling;
    // hide it entirely if y is nominal (the labels speak for themselves).
    if (encTarget?.row || (facetRows > 1 && encTarget?.y)) {
        if (encTarget?.y?.type === 'nominal') {
            if (!vgObj.config) vgObj.config = {};
            vgObj.config.axisY = { ...(vgObj.config.axisY || {}), title: null };
            if (!encTarget.y.axis) encTarget.y.axis = {};
            encTarget.y.axis.title = null;
        }
    }

    // --- Dual-legend repositioning ---
    // When multiple channels produce legends (e.g. color + size, color + opacity),
    // Vega-Lite stacks them all on the right, which eats into the plot area on a
    // 400×300 canvas.  Detect this and move the categorical (nominal/ordinal)
    // legend to the bottom with horizontal orientation, keeping the quantitative
    // legend compact on the right — BUT only when the total chart height is too
    // short to fit both stacked on the right comfortably.
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
        // — but only if the total chart height can't comfortably fit both.
        if (categoricalChs.length > 0 && quantitativeChs.length > 0) {
            // Estimate total right-side legend height:
            //   Quantitative legend ≈ 100px (gradient + title + labels)
            //   Categorical legend ≈ title(20px) + entries × 20px each
            const QUANT_LEGEND_HEIGHT = 100;
            const CAT_TITLE_HEIGHT = 20;
            const CAT_ENTRY_HEIGHT = 20;

            // Estimate domain sizes for categorical legends
            let totalCatEntries = 0;
            for (const ch of categoricalChs) {
                const targets = collectEncodingTargets(ch);
                for (const enc of targets) {
                    if (!enc.field) continue;
                    const domainSize = new Set(context.table.map((r: any) => r[enc.field])).size;
                    totalCatEntries += domainSize;
                }
            }
            const estCatHeight = CAT_TITLE_HEIGHT * categoricalChs.length + totalCatEntries * CAT_ENTRY_HEIGHT;
            const estTotalLegendHeight = QUANT_LEGEND_HEIGHT + estCatHeight + 20; // 20px gap between legends

            // Total chart height = subplot height × facet rows + overhead
            const totalChartHeight = layout.subplotHeight * (layout.facet?.rows ?? 1)
                + (layout.facet?.rows ?? 1) * 10; // approx facet spacing

            const fitsOnRight = totalChartHeight >= estTotalLegendHeight;

            if (!fitsOnRight) {
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
            // else: chart is tall enough — leave both legends on the right (VL default)
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
                if (enc.axis === null) continue; // preserve axis suppression
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

// ---------------------------------------------------------------------------
// vlApplyFieldContext — Apply field-level semantic decisions to VL encodings
// ---------------------------------------------------------------------------

/**
 * Build a Vega expression that abbreviates large numbers using a small
 * set of universally understood suffixes: K (thousands), M (millions),
 * B (billions), T (trillions).
 *
 * The expression is a nested ternary that picks the right divisor:
 *   abs(v) >= 1e12 → v/1e12 + "T"
 *   abs(v) >= 1e9  → v/1e9  + "B"
 *   abs(v) >= 1e6  → v/1e6  + "M"
 *   abs(v) >= 1e3  → v/1e3  + "K"
 *   else           → plain number
 *
 * @param prefix  Optional prefix (e.g., "$")
 * @param suffix  Optional suffix (e.g., " kg")
 * @returns  A Vega labelExpr string
 */
function buildAbbreviationExpr(prefix?: string, suffix?: string): string {
    const pfx = prefix ? `'${prefix}' + ` : '';
    const sfx = suffix ? ` + '${suffix}'` : '';
    // Use ~g to drop trailing zeros from the fractional digit
    return (
        `${pfx}(abs(datum.value) >= 1e12 ? format(datum.value / 1e12, '~g') + 'T' : ` +
        `abs(datum.value) >= 1e9 ? format(datum.value / 1e9, '~g') + 'B' : ` +
        `abs(datum.value) >= 1e6 ? format(datum.value / 1e6, '~g') + 'M' : ` +
        `abs(datum.value) >= 1e3 ? format(datum.value / 1e3, '~g') + 'K' : ` +
        `format(datum.value, ','))${sfx}`
    );
}

/**
 * Build a VL-compatible format expression from a FormatSpec.
 *
 * - d3's `format()` handles the numeric pattern.
 * - Prefix/suffix are prepended/appended via a Vega expression.
 * - When `abbreviate` is true, large values are compacted (1K, 1M, 1B, 1T).
 *
 * Returns an `axis.labelExpr` / `legend.labelExpr` string, or null if
 * no formatting is needed (plain data labels suffice).
 */
function formatSpecToLabelExpr(fmt: FormatSpec): string | null {
    // Abbreviation takes priority — produces its own complete expression
    if (fmt.abbreviate) {
        return buildAbbreviationExpr(fmt.prefix, fmt.suffix);
    }

    if (!fmt.pattern) return null;
    const hasPrefix = !!fmt.prefix;
    const hasSuffix = !!fmt.suffix;

    if (!hasPrefix && !hasSuffix) {
        // Pure d3-format — can use axis.format directly (no expr needed)
        return null;
    }

    // Build Vega expression: format(datum.value, pattern) with prefix/suffix
    const pfx = hasPrefix ? `'${fmt.prefix}' + ` : '';
    const sfx = hasSuffix ? ` + '${fmt.suffix}'` : '';
    return `${pfx}format(datum.value, '${fmt.pattern}')${sfx}`;
}

/**
 * Compute the maximum stacked (group) total for a quantitative field.
 *
 * For a stacked bar chart with:
 *   x = category (grouping), y = value (stacked), color = series
 *
 * This computes sum(value) for each category group and returns the max.
 * Used to check whether stacked totals exceed an intrinsic domain bound
 * (e.g., percentages summing to >100%).
 *
 * Returns undefined if the grouping field can't be determined.
 */
function computeMaxStackedTotal(
    table: any[],
    measureField: string,
    measureChannel: string,
    channelSemantics: Record<string, ChannelSemantics>,
): number | undefined {
    if (!table || table.length === 0) return undefined;

    // The grouping axis is the *other* positional channel
    const groupChannel = measureChannel === 'y' ? 'x' : 'y';
    const groupCS = channelSemantics[groupChannel];
    if (!groupCS) return undefined;
    const groupField = groupCS.field;
    if (!groupField) return undefined;

    // Also consider facet fields (row/column) as additional grouping
    const facetFields: string[] = [];
    for (const ch of ['row', 'column']) {
        const fcs = channelSemantics[ch];
        if (fcs?.field) facetFields.push(fcs.field);
    }

    // Group rows and sum the measure field per group
    const totals = new Map<string, number>();
    for (const row of table) {
        const val = row[measureField];
        if (typeof val !== 'number' || isNaN(val)) continue;

        // Build group key from grouping field + facet fields
        const keyParts = [String(row[groupField])];
        for (const ff of facetFields) {
            keyParts.push(String(row[ff]));
        }
        const key = keyParts.join('|||');
        totals.set(key, (totals.get(key) ?? 0) + val);
    }

    if (totals.size === 0) return undefined;
    return Math.max(...totals.values());
}

/**
 * Get the effective intrinsic domain for a field, even when no explicit
 * `intrinsicDomain` is provided in the annotation.
 *
 * Mirrors steps 2–3 of `resolveDomainConstraint` (in field-semantics.ts)
 * which infer intrinsic bounds from the semantic type:
 *   - Percentage → [0, 1] or [0, 100] depending on data scale
 *   - Latitude → [-90, 90]
 *   - Longitude → [-180, 180]
 *   - Correlation → [-1, 1]
 *
 * Without this: stacked charts with Percentage fields that lack explicit
 * annotation never get domain constraints, because the stacking re-check
 * in vlApplyFieldContext couldn't find the intrinsic bounds.
 */
function getEffectiveIntrinsicDomain(
    cs: ChannelSemantics,
    table: any[],
    field: string,
): [number, number] | undefined {
    // 1. Explicit annotation — authoritative
    if (cs.semanticAnnotation?.intrinsicDomain) {
        return cs.semanticAnnotation.intrinsicDomain;
    }

    // 2. Infer from semantic type
    const semanticType = cs.semanticAnnotation?.semanticType;
    if (!semanticType) return undefined;

    if (semanticType === 'Latitude')    return [-90, 90];
    if (semanticType === 'Longitude')   return [-180, 180];
    if (semanticType === 'Correlation') return [-1, 1];

    if (semanticType === 'Percentage') {
        const nums = table
            .map(r => r[field])
            .filter((v: any) => typeof v === 'number' && !isNaN(v));
        if (nums.length > 0) {
            // Inline scale detection: if ≥80% of |values| are ≤1, it's 0-1 scale
            const countBelow1 = nums.filter(v => Math.abs(v) <= 1).length;
            const isFractional = countBelow1 / nums.length >= 0.8;
            return isFractional ? [0, 1] : [0, 100];
        }
    }

    return undefined;
}

/**
 * Apply field-context semantic properties to VL encoding objects.
 *
 * Consumes the following ChannelSemantics properties that were previously
 * dead writes (computed by resolveChannelSemantics but never read):
 *
 *   1. format       → axis.format / axis.labelExpr  (number formatting)
 *   2. tooltipFormat → tooltip encoding format
 *   3. domainConstraint → scale.domain + scale.clamp  (bounded types)
 *   4. tickConstraint   → axis.tickMinStep + axis.values  (integer ticks)
 *   5. reversed     → scale.reverse  (rank axes)
 *   6. nice         → scale.nice  (bounded types disable nice)
 *   7. scaleType    → scale.type  (log, sqrt, symlog)
 */
function vlApplyFieldContext(
    vgObj: any,
    channelSemantics: Record<string, ChannelSemantics>,
    collectEncodingTargets: (ch: string) => any[],
    context: InstantiateContext,
): void {
    for (const [ch, cs] of Object.entries(channelSemantics)) {
        const targets = collectEncodingTargets(ch);
        if (targets.length === 0) continue;

        for (const enc of targets) {
            if (!enc.field) continue;

            // Skip encodings whose field differs from the channel's semantic
            // field. Templates (e.g. Radar) may inject private computed fields
            // (e.g. `__x`, `__y` for polar coordinates) on the same VL channel;
            // applying the user field's semantic context (domain, format, etc.)
            // to those synthetic fields produces wrong scales.
            if (cs.field && enc.field !== cs.field) continue;

            // ── 0. Temporal + bin incompatibility guard ──
            // VL's `bin` operates on numeric values. Setting `type: "temporal"`
            // with `bin` causes VL to parse values (e.g., year 2004) as dates
            // and bin in milliseconds, producing nonsensical time-of-day labels.
            // For temporal binning, VL expects `timeUnit` instead.
            // Fix: demote to `quantitative` so bins work on raw numbers.
            if (enc.bin && enc.type === 'temporal') {
                enc.type = 'quantitative';
                // Year/Decade values should show as plain integers, not "2,004"
                if (enc.axis !== null) {
                    if (!enc.axis) enc.axis = {};
                    if (!enc.axis.format) enc.axis.format = 'd';
                }
            }

            // ── 1. Number format (axis.format / axis.labelExpr) ──
            // Only apply to quantitative positional channels.
            // Skip binned encodings — VL formats bin ranges natively and
            // our semantic format (e.g. percent) would misinterpret the
            // bin boundaries.
            // Without this: axes show raw numbers like "1000000" instead of "$1,000,000".
            if ((cs.format?.pattern || cs.format?.abbreviate) && (ch === 'x' || ch === 'y') && enc.type === 'quantitative' && !enc.bin) {
                // Skip if the encoding already has an explicit format
                if (enc.axis === null) { /* preserve axis suppression */ }
                else if (!enc.axis?.format && !enc.axis?.labelExpr) {
                    if (!enc.axis) enc.axis = {};
                    const expr = formatSpecToLabelExpr(cs.format);
                    if (expr) {
                        enc.axis.labelExpr = expr;
                    } else {
                        enc.axis.format = cs.format.pattern;
                    }
                }
            }

            // ── 2. Tooltip format ──
            // Tooltip formatting is handled via VL's tooltip encoding with format.
            // Without this: tooltips show raw floats like "0.4812" instead of "48.12%".
            // NOTE: VL's `config.mark.tooltip: true` uses default formatting;
            // explicit tooltip channels would need encoding-level format.
            // For now, we set formatType on the main encoding when tooltipFormat
            // has a simple pattern (no prefix/suffix).
            // Full tooltip encoding is deferred to template-level implementation.

            // ── 3. Domain constraint (scale.domain + scale.clamp) ──
            // Semantic domain constraints represent *intrinsic* field bounds.
            // Full constraints (both min+max) set scale.domain directly.
            // Partial constraints (only min or max) use VL's domainMin/domainMax
            // for single-ended bounds, letting the other end auto-fit from data.
            // Skip binned encodings — VL handles bin domain automatically.
            //
            // Stacking interaction:
            //   Sum-stacked charts (default / "zero" / "center") show stacked
            //   totals on the axis, not individual values. The field-level snap
            //   heuristic only saw individual values, which may not reflect the
            //   actual axis range.  We recompute: if the max group total still
            //   fits within the intrinsic bound, the snap constraint is safe
            //   (e.g., percentages summing to exactly 100%).  If totals exceed
            //   the bound, we skip the constraint to avoid clipping bars.
            //   Normalize-stacked (stack: "normalize"): VL normalizes to [0,1],
            //   so domain is always [0,1]. Constraint is harmless. → Keep.
            //   Layered / no stack (stack: null/false): each bar is
            //   independent. → Apply domain constraints as normal.
            //
            // VL auto-stacks bar/area marks when a color encoding is present
            // (unless stack: null/false).
            //
            // Without this: Rating gets auto-fitted to data range (e.g., 2-4.5)
            // instead of showing the full 1-5 scale.
            const isExplicitlyStacked = enc.stack !== undefined && enc.stack !== null && enc.stack !== false;
            const markType = typeof vgObj.mark === 'string' ? vgObj.mark : vgObj.mark?.type;
            const isBarLike = ['bar', 'area', 'rect'].includes(markType);
            // Check for color encoding at top level, in layers, or in faceted spec
            const hasColorEncoding = !!(
                vgObj.encoding?.color?.field
                || (Array.isArray(vgObj.layer) && vgObj.layer.some((l: any) => l.encoding?.color?.field))
                || vgObj.spec?.encoding?.color?.field
            );
            const isImplicitlyStacked = isBarLike && hasColorEncoding && enc.stack !== null;
            const isStacked = isExplicitlyStacked || isImplicitlyStacked;
            const isNormalizeStacked = enc.stack === 'normalize';
            const isSumStacked = isStacked && !isNormalizeStacked;

            // For sum-stacked charts, check if stacked totals exceed the
            // intrinsic domain.  If they do, skip the domain constraint.
            //
            // Also, if snap didn't fire on individual values but stacked
            // totals are near the intrinsic bound, re-run snap on the totals.
            // Example: individual percentages range 20–50% (no snap), but
            // they sum to ~100% per group → should snap to 100%.
            let skipDomain = false;
            let effectiveDomainConstraint = cs.domainConstraint;

            if (isSumStacked) {
                // Use explicit intrinsicDomain from annotation, or infer from
                // semantic type for known bounded types (Percentage, Lat/Lon, etc.)
                // Without this: Percentage fields without explicit annotation
                // never get a domain constraint on stacked charts because
                // individual values don't trigger snap, and the stacked re-check
                // can't find the intrinsic bounds to snap totals against.
                const intrinsic = getEffectiveIntrinsicDomain(cs, context.table, enc.field);
                if (intrinsic) {
                    const maxTotal = computeMaxStackedTotal(
                        context.table, enc.field, ch, channelSemantics,
                    );

                    if (maxTotal !== undefined && maxTotal > intrinsic[1]) {
                        // Stacked totals exceed the intrinsic bound →
                        // skip domain constraint to avoid clipping.
                        // Use a small epsilon tolerance for floating-point
                        // imprecision (e.g., shares summing to 1.0000000001
                        // instead of exactly 1.0 should still be treated as
                        // within bounds). Scale epsilon to the domain range.
                        const range = intrinsic[1] - intrinsic[0];
                        const epsilon = range * 1e-6;
                        if (maxTotal > intrinsic[1] + epsilon) {
                            if (cs.domainConstraint) {
                                skipDomain = true;
                            }
                        } else {
                            // Within epsilon — treat as equal to the bound.
                            // Re-run snap so the bound gets applied.
                            const stackedSnap = snapToBoundHeuristic(intrinsic, [intrinsic[1]]);
                            if (stackedSnap) {
                                if (cs.domainConstraint) {
                                    effectiveDomainConstraint = {
                                        min: cs.domainConstraint.min ?? stackedSnap.min,
                                        max: cs.domainConstraint.max ?? stackedSnap.max,
                                        clamp: cs.domainConstraint.clamp || stackedSnap.clamp,
                                    };
                                } else {
                                    effectiveDomainConstraint = stackedSnap;
                                }
                            }
                        }
                    } else if (maxTotal !== undefined) {
                        // Stacked totals are within intrinsic bounds.
                        // Re-run snap on stacked totals to pick up bounds
                        // that individual values missed (e.g., individual
                        // shares of 20–40% don't snap to 100%, but stacked
                        // totals of ~100% should).
                        const stackedSnap = snapToBoundHeuristic(intrinsic, [maxTotal]);
                        if (stackedSnap) {
                            // Merge with existing constraint: keep any bound
                            // already snapped from individual values, add any
                            // new bound from stacked totals.
                            if (cs.domainConstraint) {
                                effectiveDomainConstraint = {
                                    min: cs.domainConstraint.min ?? stackedSnap.min,
                                    max: cs.domainConstraint.max ?? stackedSnap.max,
                                    clamp: cs.domainConstraint.clamp || stackedSnap.clamp,
                                };
                            } else {
                                effectiveDomainConstraint = stackedSnap;
                            }
                        }
                    }
                } else if (cs.domainConstraint) {
                    // No intrinsic domain to compare against → skip to be safe
                    skipDomain = true;
                }
            }

            if (effectiveDomainConstraint && enc.type === 'quantitative' && (ch === 'x' || ch === 'y') && !enc.bin && !skipDomain) {
                if (!enc.scale) enc.scale = {};
                const { min, max, clamp } = effectiveDomainConstraint;
                if (min !== undefined && max !== undefined) {
                    enc.scale.domain = [min, max];
                    // For non-bar marks (scatter, line, etc.), the explicit
                    // semantic domain is authoritative — clear zero so VL
                    // doesn't extend beyond intrinsic bounds (e.g., Rating
                    // scatter [1,5] shouldn't stretch to [0,5]).
                    // For bar/area marks, keep zero:true so bars grow from
                    // zero with correct proportional lengths — VL extends
                    // the domain to include 0, and the upper bound is still
                    // capped by the domain constraint (e.g., [0,5] not [0,6]).
                    if (!isBarLike && enc.scale.zero !== undefined) {
                        delete enc.scale.zero;
                    }
                } else {
                    // Partial constraint — snap one end while auto-fitting the other.
                    // E.g., Percentage data at 97% → domainMax = 100, domainMin auto-fits.
                    if (min !== undefined) enc.scale.domainMin = min;
                    if (max !== undefined) enc.scale.domainMax = max;
                    // VL may suppress nice rounding on the free end when
                    // domainMin/domainMax is set, causing data to touch the
                    // chart border.  Force nice so the unconstrained end
                    // gets proper headroom (e.g., data at +26% rounds to +40%).
                    enc.scale.nice = true;
                }
                if (clamp) {
                    enc.scale.clamp = true;
                }
            }

            // ── 4. Tick constraint (axis.tickMinStep + axis.values) ──
            // Skip binned encodings — VL handles bin ticks natively.
            // Without this: Rating 1-5 and Count axes show fractional ticks
            // like 1.5, 2.5, 3.5 that have no physical meaning.
            if (cs.tickConstraint && (ch === 'x' || ch === 'y') && enc.type === 'quantitative' && !enc.bin) {
                if (enc.axis === null) { /* preserve axis suppression */ }
                else {
                if (!enc.axis) enc.axis = {};
                if (cs.tickConstraint.integersOnly && enc.axis.tickMinStep === undefined) {
                    enc.axis.tickMinStep = cs.tickConstraint.minStep ?? 1;
                }
                if (cs.tickConstraint.exactTicks && !enc.axis.values) {
                    enc.axis.values = cs.tickConstraint.exactTicks;
                }
                // Hide fractional tick labels for integer-only fields.
                // VL may still generate fractional ticks when the domain
                // span is small (e.g., all values = 1 → domain [0,1] →
                // ticks at 0, 0.2, 0.4…). The `,d` format rounds these
                // to duplicate labels. This labelExpr suppresses them.
                if (cs.tickConstraint.integersOnly && !enc.axis.labelExpr && !enc.axis.values) {
                    enc.axis.labelExpr = "datum.value === ceil(datum.value) ? format(datum.value, ',d') : ''";
                }
                // When ticks are integers, axis labels should show integers
                // even if the underlying data has decimals (e.g., Rating
                // data 3.7 with ticks at 1,2,3,4,5 → labels "1,2,3,4,5"
                // not "1.0,2.0,3.0").
                if (cs.tickConstraint.integersOnly && enc.axis.format) {
                    // Replace decimal format with integer format for axis only
                    enc.axis.format = enc.axis.format.replace(/\.\d+f$/, 'd');
                }
                // Same for labelExpr — swap the d3-format pattern inside
                if (cs.tickConstraint.integersOnly && enc.axis.labelExpr) {
                    enc.axis.labelExpr = enc.axis.labelExpr.replace(
                        /format\(datum\.value,\s*'([^']*)\.\d+f'\)/,
                        "format(datum.value, '$1d')",
                    );
                }
                } // close else (axis !== null)
            }

            // ── 5. Reversed axis (scale.reverse) ──
            // Only for quantitative axes. Ordinal y-axes already place the
            // first domain value (rank 1) at the top by default, so adding
            // scale.reverse there would double-reverse, putting 1 back at
            // the bottom.
            // Skip binned encodings — VL handles bin axis direction natively.
            if (cs.reversed && (ch === 'x' || ch === 'y') && enc.type === 'quantitative' && !enc.bin) {
                if (!enc.scale) enc.scale = {};
                if (enc.scale.reverse === undefined) {
                    enc.scale.reverse = true;
                }
            }

            // ── 6. Nice rounding (scale.nice) ──
            // Without this: Domain [1, 5] for ratings gets "nice-rounded"
            // to [0, 6] which wastes space and implies values that don't exist.
            // Skip binned encodings — VL computes bin extents automatically.
            if (cs.nice === false && enc.type === 'quantitative' && !enc.bin) {
                if (!enc.scale) enc.scale = {};
                if (enc.scale.nice === undefined) {
                    enc.scale.nice = false;
                }
            }

            // ── 7. Scale type (scale.type) ──
            // Only applies for specific semantic types (Population, GDP, etc.)
            // when data spans ≥ 4 orders of magnitude. Conservative policy
            // to avoid surprising users on normal datasets.
            // Skip binned encodings — log/sqrt scales conflict with VL's
            // linear bin computation and break when data contains zeros.
            if (cs.scaleType && cs.scaleType !== 'linear' && enc.type === 'quantitative' && !enc.bin) {
                if (!enc.scale) enc.scale = {};
                if (!enc.scale.type) {
                    enc.scale.type = cs.scaleType;

                    // Log/symlog scales don't support zero baseline — clean it up
                    if (cs.scaleType === 'log' || cs.scaleType === 'symlog') {
                        if (enc.scale.zero !== undefined) {
                            delete enc.scale.zero;
                        }
                        // Log axes produce many grid lines (1,2,3…9 per
                        // decade).  Make them very light so they convey the
                        // log-scale structure without competing with data.
                        if (ch === 'x' || ch === 'y') {
                            if (enc.axis === null) { /* preserve axis suppression */ }
                            else {
                                if (!enc.axis) enc.axis = {};
                                enc.axis.gridColor = '#e8e8e8';
                                enc.axis.gridOpacity = 0.5;
                            }
                        }
                    }
                }
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
