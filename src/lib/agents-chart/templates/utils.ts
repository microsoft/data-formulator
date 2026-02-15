// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared helper functions for chart template post-processors.
 * Pure logic — no UI dependencies.
 */

import type { BuildEncodingContext } from '../types';

// ---------------------------------------------------------------------------
// Discrete-dimension helpers
// ---------------------------------------------------------------------------

const isDiscrete = (type: string | undefined) => type === "nominal" || type === "ordinal";

/**
 * Check whether a numeric field's values are equally strided (uniform spacing).
 * E.g. [1, 2, 3, 4] or [2020, 2022, 2024] → true.
 *      [10.325, 11.005, 12.687] → false.
 *
 * Returns true if the field is non-numeric, has ≤ 1 unique value, or all
 * consecutive differences are within 1% relative tolerance of each other.
 */
export function isEquallyStrided(field: string, table: any[]): boolean {
    const vals = [...new Set(table.map(r => r[field]).filter((v: any) => v != null && typeof v === 'number'))];
    if (vals.length <= 1) return true;
    vals.sort((a, b) => a - b);

    const diffs = [];
    for (let i = 1; i < vals.length; i++) {
        diffs.push(vals[i] - vals[i - 1]);
    }
    const medianDiff = diffs.slice().sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    if (medianDiff === 0) return false;

    const tolerance = 0.01 * Math.abs(medianDiff);
    return diffs.every(d => Math.abs(d - medianDiff) <= tolerance);
}

/**
 * Get the number of unique non-null values for a field in the data table.
 */
export function getFieldCardinality(field: string, table: any[]): number {
    return new Set(table.map((r: any) => r[field]).filter((v: any) => v != null)).size;
}

/**
 * Convert a single encoding to a discrete VL type in-place.
 *
 * Chooses `ordinal` when the data has natural ordering (temporal, numeric)
 * and `nominal` for purely categorical data.
 *
 * @param encodingObj  The resolved encoding object (must have `.type`)
 * @param table        The data table (for cardinality checks)
 * @returns            The discrete type that was set ('nominal' | 'ordinal')
 */
export function resolveAsDiscrete(
    encodingObj: any,
    table: any[],
): 'nominal' | 'ordinal' {
    if (!encodingObj) return 'nominal';
    const currentType = encodingObj.type;
    if (currentType === 'nominal' || currentType === 'ordinal') {
        return currentType;
    }
    // Temporal → ordinal (preserves chronological ordering)
    if (currentType === 'temporal') {
        encodingObj.type = 'ordinal';
        return 'ordinal';
    }
    // Quantitative → ordinal if cardinality is low (looks like discrete levels),
    // nominal otherwise (forcibly treated as categories)
    if (currentType === 'quantitative' && encodingObj.field && table.length > 0) {
        const cardinality = getFieldCardinality(encodingObj.field, table);
        encodingObj.type = cardinality <= 20 ? 'ordinal' : 'nominal';
        return encodingObj.type;
    }
    encodingObj.type = 'nominal';
    return 'nominal';
}

/**
 * Detect which positional axis (x or y) should be the banded/category axis.
 *
 * Decision logic:
 *   1. If one axis is already discrete, return it (no conversion needed).
 *   2. If both are continuous (Q×Q, T×Q, T×T), return `preferAxis` without
 *      converting — the banded flag handles mark sizing on continuous scales.
 *   3. If only one axis exists, convert it to discrete.
 *
 * Templates that **must** have a truly discrete axis (grouped bar, boxplot)
 * should check `result.converted` and call `resolveAsDiscrete` explicitly
 * when it's false.
 *
 * @returns  `{ axis, converted }` — which axis is banded, and whether
 *           the encoding type was actually changed to discrete.
 */
export function detectBandedAxis(
    spec: any,
    encodings: Record<string, any>,
    table: any[],
    options: { preferAxis?: 'x' | 'y' } = {},
): { axis: 'x' | 'y'; converted: boolean } | null {
    const xEnc = encodings.x;
    const yEnc = encodings.y;

    // Already discrete?
    if (xEnc && isDiscrete(xEnc.type)) {
        return { axis: 'x', converted: false };
    }
    if (yEnc && isDiscrete(yEnc.type)) {
        return { axis: 'y', converted: false };
    }

    // Neither discrete — when both axes are continuous (Q×Q, T×Q, T×T),
    // don't convert either one.  The banded flag on the template will
    // drive elastic stretch and mark sizing for the chosen axis without
    // needing to change the VL encoding type.
    //
    // When one axis is quantitative (measure) and the other is not
    // (e.g. temporal = dimension), prefer the non-quantitative axis
    // as the banded dimension.  This handles horizontal bars (Q on X,
    // T on Y → banded on Y) without requiring each template to detect
    // orientation explicitly.
    if (xEnc && yEnc) {
        if (xEnc.type === 'quantitative' && yEnc.type !== 'quantitative') {
            return { axis: 'y', converted: false };
        }
        if (yEnc.type === 'quantitative' && xEnc.type !== 'quantitative') {
            return { axis: 'x', converted: false };
        }
        return { axis: options.preferAxis || 'x', converted: false };
    }

    // Only one axis exists — make it discrete
    if (xEnc) {
        resolveAsDiscrete(xEnc, table);
        return { axis: 'x', converted: true };
    }
    if (yEnc) {
        resolveAsDiscrete(yEnc, table);
        return { axis: 'y', converted: true };
    }

    return null;
}

/**
 * Convert both positional axes to discrete types if they aren't already.
 * Used by heatmap and similar charts that need a grid layout.
 *
 * @param nominalThreshold  Convert non-discrete axes only if their cardinality
 *                          is ≤ this value (0 = always convert).
 */
export function ensureDiscreteAxes(
    encodings: Record<string, any>,
    table: any[],
    nominalThreshold: number = 0,
): void {
    for (const axis of ['x', 'y'] as const) {
        const enc = encodings[axis];
        if (!enc || !enc.field || isDiscrete(enc.type)) continue;
        if (enc.aggregate || enc.bin) continue;

        if (nominalThreshold > 0) {
            const cardinality = getFieldCardinality(enc.field, table);
            if (cardinality > nominalThreshold) continue;
        }
        resolveAsDiscrete(enc, table);
    }
}

/**
 * Coverage-based point sizing — mimics natural density like cloud coverage.
 *
 * Instead of counting rows, computes the fraction of plot area the points
 * would cover and shrinks marks only when coverage exceeds a target.
 *
 *   coverage = n × pointArea / plotArea
 *
 * If coverage > targetCoverage, the point size is reduced so that the
 * target is met (with a floor at `minSize`).
 *
 * Skipped when:
 *  - mark is not circle/point/square
 *  - a `size` encoding is mapped
 *  - mark.size is already explicitly set
 *
 * @param plotWidth       Plot width in px (from canvasSize)
 * @param plotHeight      Plot height in px (from canvasSize)
 * @param targetCoverage  Desired max fraction of plot area covered (default: 0.15 = 15 %)
 * @param defaultSize     VL default mark size in px² (default: 30)
 * @param minSize         Floor mark size in px² (default: 4)
 */
export const applyPointSizeScaling = (
    vgSpec: any,
    table: any[],
    plotWidth: number = 400,
    plotHeight: number = 300,
    targetCoverage: number = 0.15,
    defaultSize: number = 30,
    minSize: number = 4,
): any => {
    if (!table || table.length === 0) return vgSpec;

    const markType = typeof vgSpec.mark === 'string' ? vgSpec.mark : vgSpec.mark?.type;
    if (!['circle', 'point', 'square'].includes(markType)) return vgSpec;

    // Don't override if size is already controlled (encoding or mark property)
    if (vgSpec.encoding?.size?.field) return vgSpec;
    if (typeof vgSpec.mark === 'object' && vgSpec.mark.size != null) return vgSpec;

    const n = table.length;
    const plotArea = plotWidth * plotHeight;
    const currentCoverage = (n * defaultSize) / plotArea;

    // Coverage is acceptable — leave VL default alone
    if (currentCoverage <= targetCoverage) return vgSpec;

    // Solve: n × size / plotArea = targetCoverage  →  size = targetCoverage × plotArea / n
    const size = Math.round(Math.max(minSize, (targetCoverage * plotArea) / n));

    if (typeof vgSpec.mark === 'string') {
        vgSpec.mark = { type: vgSpec.mark, size };
    } else {
        vgSpec.mark = { ...vgSpec.mark, size };
    }
    return vgSpec;
};

/**
 * @deprecated Use `detectBandedAxis` instead. This legacy wrapper operates
 * on `vgSpec.encoding` directly for backward compatibility with buildEncodings
 * that haven't been migrated yet.
 */
export const ensureNominalAxis = (
    vgSpec: any,
    table: any[],
    defaultToX: boolean = true
): "x" | "y" | null => {
    const result = detectBandedAxis(vgSpec, vgSpec.encoding || {}, table, { preferAxis: defaultToX ? 'x' : 'y' });
    return result?.axis ?? null;
};

/**
 * Default buildEncodings implementation for simple templates.
 * Maps each channel directly to spec.encoding[channel].
 * Use this when all channels map to the top-level encoding object.
 *
 * The `context` parameter is accepted but unused — it's there so the
 * signature matches ChartTemplateDef.buildEncodings for templates that
 * don't need data-driven dtype decisions.
 */
export const defaultBuildEncodings = (spec: any, encodings: Record<string, any>, _context?: BuildEncodingContext): void => {
    if (!spec.encoding) spec.encoding = {};
    for (const [channel, encodingObj] of Object.entries(encodings)) {
        if (Object.keys(encodingObj).length > 0) {
            const existing = spec.encoding[channel];
            if (existing && typeof existing === 'object') {
                spec.encoding[channel] = { ...existing, ...encodingObj };
            } else {
                spec.encoding[channel] = encodingObj;
            }
        }
    }
};

// ---------------------------------------------------------------------------
// Mark sizing helpers (used by postProcessing hooks)
// ---------------------------------------------------------------------------

/**
 * Set a property on a mark object (handles both string and object forms).
 */
export function setMarkProp(mark: any, key: string, value: number): any {
    if (typeof mark === 'string') {
        return { type: mark, [key]: value };
    }
    return { ...mark, [key]: value };
}

/**
 * Compute the maximum non-overlapping mark size (in pixels) for a continuous
 * banded axis.  Works by finding the minimum gap between the two closest
 * sorted data values and converting that to pixel space.
 *
 * @returns  The pixel width that fits the tightest pair, floored to `minSize`.
 *           Returns `Infinity` when there aren't enough values to compare.
 */
function maxNonOverlapSize(
    field: string,
    table: any[],
    isTemporal: boolean,
    subplotDim: number,
    count: number,
    minSize: number = 2,
): number {
    // Parse values to numbers (handles dates)
    const nums = [...new Set(
        table.map((r: any) => {
            const v = r[field];
            if (v == null) return NaN;
            return isTemporal ? +new Date(v) : +v;
        }).filter((v: number) => !isNaN(v)),
    )];
    if (nums.length < 2) return Infinity;

    nums.sort((a, b) => a - b);

    // Find smallest gap between consecutive sorted values
    let minGap = Infinity;
    for (let i = 1; i < nums.length; i++) {
        const gap = nums[i] - nums[i - 1];
        if (gap > 0 && gap < minGap) minGap = gap;
    }
    if (!isFinite(minGap)) return Infinity;

    const dataRange = nums[nums.length - 1] - nums[0];
    if (dataRange <= 0) return Infinity;

    // Convert data-space gap to pixels.
    // subplotDim = stepSize × (count + 1), domain spans dataRange + one data-step
    // on each side, so pixelsPerUnit = subplotDim / (dataRange + dataRange/(count-1))
    // = subplotDim × (count-1) / (dataRange × count)
    const pixelsPerUnit = subplotDim * (count - 1) / (dataRange * count);
    const maxWidth = Math.floor(minGap * pixelsPerUnit);
    return Math.max(minSize, maxWidth);
}

/**
 * Adjust bar/rect marks for continuous-as-discrete axes so bars fill
 * each discrete position. Skips binned axes (VL auto-sizes from bins).
 */
export function adjustBarMarks(spec: any, ctx: BuildEncodingContext): void {
    const ip = ctx.inferredProperties;
    if (!ip) return;
    for (const axis of ['x', 'y'] as const) {
        const count = axis === 'x' ? ip.xContinuousAsDiscrete : ip.yContinuousAsDiscrete;
        if (count <= 0) continue;
        const enc = spec.encoding?.[axis];
        if (enc?.bin) continue;

        const effStep = axis === 'x' ? ip.xStepSize : ip.yStepSize;
        // Detect whether we have a rect mark (use width/height) or bar (use size)
        const allMarkTypes = new Set<string>();
        const mt = typeof spec.mark === 'string' ? spec.mark : spec.mark?.type;
        if (mt) allMarkTypes.add(mt);
        if (Array.isArray(spec.layer)) {
            for (const layer of spec.layer) {
                const lm = typeof layer.mark === 'string' ? layer.mark : layer.mark?.type;
                if (lm) allMarkTypes.add(lm);
            }
        }
        const sizeKey = allMarkTypes.has('rect')
            ? (axis === 'x' ? 'width' : 'height')
            : 'size';

        // Cap cell size to avoid overlap at the tightest pair of values.
        // Use 0.9 fill ratio — tighter than discrete bands (~0.8) since
        // continuous axes already have half-step edge padding.
        const subplotDim = axis === 'x' ? ip.subplotWidth : ip.subplotHeight;
        const isTemporal = enc?.type === 'temporal';
        const maxSize = enc?.field
            ? maxNonOverlapSize(enc.field, ctx.table, isTemporal, subplotDim, count)
            : Infinity;
        const cellSize = Math.max(2, Math.min(Math.round(effStep * 0.9), maxSize));

        if (Array.isArray(spec.layer)) {
            for (const layer of spec.layer) {
                const lm = typeof layer.mark === 'string' ? layer.mark : layer.mark?.type;
                if (lm === 'bar' || lm === 'rect') {
                    layer.mark = setMarkProp(layer.mark, sizeKey, cellSize);
                }
            }
        } else if (spec.mark) {
            const markType = typeof spec.mark === 'string' ? spec.mark : spec.mark?.type;
            if (markType === 'bar' || markType === 'rect') {
                spec.mark = setMarkProp(spec.mark, sizeKey, cellSize);
            }
        }
    }
}

/**
 * Adjust rect marks for edge-to-edge tiling on continuous axes
 * (e.g. heatmaps with temporal/quantitative axes).
 */
export function adjustRectTiling(spec: any, ctx: BuildEncodingContext): void {
    const ip = ctx.inferredProperties;
    if (!ip) return;

    for (const axis of ['x', 'y'] as const) {
        const enc = spec.encoding?.[axis];
        if (!enc?.field) continue;
        const t = enc.type;
        if (t === 'nominal' || t === 'ordinal') continue;
        if (enc.aggregate) continue;

        const uniqueVals = [...new Set(ctx.table.map((r: any) => r[enc.field]))];
        const cardinality = uniqueVals.length;
        if (cardinality <= 1) continue;

        // Pixel spacing between items = stepSize × (count+1) / count
        // due to the half-step domain padding on each side from Phase 1.
        const count = axis === 'x' ? ip.xContinuousAsDiscrete : ip.yContinuousAsDiscrete;
        const effStep = axis === 'x' ? ip.xStepSize : ip.yStepSize;
        const pixelSpacing = count > 0 ? effStep * (count + 1) / count : effStep;

        // Cap to avoid overlap at the tightest pair of values.
        // Use 0.98 fill — nearly edge-to-edge, tighter than discrete bands.
        const subplotDim = axis === 'x' ? ip.subplotWidth : ip.subplotHeight;
        const isTemporal = t === 'temporal';
        const maxSize = maxNonOverlapSize(enc.field, ctx.table, isTemporal, subplotDim, count);
        const cellSize = Math.max(1, Math.min(Math.floor(pixelSpacing * 0.98), maxSize));

        const sizeKey = axis === 'x' ? 'width' : 'height';
        spec.mark = setMarkProp(spec.mark, sizeKey, cellSize);
    }
}
