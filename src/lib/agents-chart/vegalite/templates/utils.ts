// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared helper functions for chart template hooks (v2 pipeline).
 * Pure logic — no UI dependencies.
 */

import type { ChannelSemantics, InstantiateContext } from '../../core/types';

// ---------------------------------------------------------------------------
// Discrete-dimension helpers
// ---------------------------------------------------------------------------

const isDiscrete = (type: string | undefined) => type === "nominal" || type === "ordinal";

/**
 * Check whether a numeric field's values are equally strided (uniform spacing).
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
 * Determine the discrete type for a given encoding type.
 * Returns the appropriate discrete type without mutating anything.
 */
export function resolveDiscreteType(
    currentType: string,
    field: string | undefined,
    table: any[],
): 'nominal' | 'ordinal' {
    if (currentType === 'nominal') return 'nominal';
    if (currentType === 'ordinal') return 'ordinal';
    if (currentType === 'temporal') return 'ordinal';
    if (currentType === 'quantitative' && field && table.length > 0) {
        const cardinality = getFieldCardinality(field, table);
        return cardinality <= 20 ? 'ordinal' : 'nominal';
    }
    return 'nominal';
}

/**
 * Convert a single encoding to a discrete VL type in-place.
 */
export function resolveAsDiscrete(
    encodingObj: any,
    table: any[],
): 'nominal' | 'ordinal' {
    if (!encodingObj) return 'nominal';
    const result = resolveDiscreteType(encodingObj.type, encodingObj.field, table);
    encodingObj.type = result;
    return result;
}

/**
 * Detect which positional axis should be the banded/category axis,
 * working from ChannelSemantics (v2 pipeline).
 *
 * Used by declareLayoutMode to set axisFlags and resolvedTypes.
 *
 * @returns  axis: which axis is banded
 *           resolvedTypes: type overrides if conversion was needed
 */
export function detectBandedAxisFromSemantics(
    channelSemantics: Record<string, ChannelSemantics>,
    table: any[],
    options: { preferAxis?: 'x' | 'y' } = {},
): { axis: 'x' | 'y'; resolvedTypes?: Record<string, 'nominal' | 'ordinal' | 'quantitative' | 'temporal'> } | null {
    const xType = channelSemantics.x?.type;
    const yType = channelSemantics.y?.type;

    // Already discrete?
    if (xType && isDiscrete(xType)) return { axis: 'x' };
    if (yType && isDiscrete(yType)) return { axis: 'y' };

    // Both continuous — don't convert, the banded flag handles sizing
    if (xType && yType) {
        if (xType === 'quantitative' && yType !== 'quantitative') {
            return { axis: 'y' };
        }
        if (yType === 'quantitative' && xType !== 'quantitative') {
            return { axis: 'x' };
        }
        return { axis: options.preferAxis || 'x' };
    }

    // Only one axis — convert to discrete
    if (xType) {
        const newType = resolveDiscreteType(xType, channelSemantics.x?.field, table);
        return { axis: 'x', resolvedTypes: { x: newType } };
    }
    if (yType) {
        const newType = resolveDiscreteType(yType, channelSemantics.y?.field, table);
        return { axis: 'y', resolvedTypes: { y: newType } };
    }

    return null;
}

/**
 * Detect which axis is banded, and also force discrete conversion
 * when needed (grouped bar, boxplot must have a truly discrete axis).
 *
 * Returns resolvedTypes with the forced conversion.
 */
export function detectBandedAxisForceDiscrete(
    channelSemantics: Record<string, ChannelSemantics>,
    table: any[],
    options: { preferAxis?: 'x' | 'y' } = {},
): { axis: 'x' | 'y'; resolvedTypes?: Record<string, 'nominal' | 'ordinal' | 'quantitative' | 'temporal'> } | null {
    const result = detectBandedAxisFromSemantics(channelSemantics, table, options);
    if (!result) return null;

    const axis = result.axis;
    const cs = channelSemantics[axis];
    if (!cs) return result;

    // If the axis is NOT already discrete, force conversion
    if (!isDiscrete(cs.type)) {
        const newType = resolveDiscreteType(cs.type, cs.field, table);
        return {
            axis,
            resolvedTypes: { ...result.resolvedTypes, [axis]: newType },
        };
    }

    return result;
}

/**
 * Default instantiate implementation for simple templates.
 * Maps each resolved encoding channel directly to spec.encoding[channel].
 */
export const defaultBuildEncodings = (spec: any, encodings: Record<string, any>): void => {
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
// Mark sizing helpers (used by v2 instantiate hooks)
// ---------------------------------------------------------------------------

/**
 * Set a property on a mark object (handles both string and object forms).
 */
export function setMarkProp(mark: any, key: string, value: any): any {
    if (typeof mark === 'string') {
        return { type: mark, [key]: value };
    }
    return { ...mark, [key]: value };
}

/**
 * Coverage-based point sizing.
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

    if (vgSpec.encoding?.size?.field) return vgSpec;
    if (typeof vgSpec.mark === 'object' && vgSpec.mark.size != null) return vgSpec;

    const n = table.length;
    const plotArea = plotWidth * plotHeight;
    const currentCoverage = (n * defaultSize) / plotArea;

    if (currentCoverage <= targetCoverage) return vgSpec;

    const size = Math.round(Math.max(minSize, (targetCoverage * plotArea) / n));
    vgSpec.mark = setMarkProp(vgSpec.mark, 'size', size);
    return vgSpec;
};

/**
 * Compute the maximum non-overlapping mark size (in pixels) for a continuous
 * banded axis.
 */
function maxNonOverlapSize(
    field: string,
    table: any[],
    isTemporal: boolean,
    subplotDim: number,
    count: number,
    minSize: number = 2,
): number {
    const nums = [...new Set(
        table.map((r: any) => {
            const v = r[field];
            if (v == null) return NaN;
            return isTemporal ? +new Date(v) : +v;
        }).filter((v: number) => !isNaN(v)),
    )];
    if (nums.length < 2) return Infinity;

    nums.sort((a, b) => a - b);

    let minGap = Infinity;
    for (let i = 1; i < nums.length; i++) {
        const gap = nums[i] - nums[i - 1];
        if (gap > 0 && gap < minGap) minGap = gap;
    }
    if (!isFinite(minGap)) return Infinity;

    const dataRange = nums[nums.length - 1] - nums[0];
    if (dataRange <= 0) return Infinity;

    const pixelsPerUnit = subplotDim * (count - 1) / (dataRange * count);
    const maxWidth = Math.floor(minGap * pixelsPerUnit);
    return Math.max(minSize, maxWidth);
}

/**
 * Adjust bar/rect marks for continuous-as-discrete axes.
 * v2 version: reads layout info from InstantiateContext.
 */
export function adjustBarMarks(spec: any, ctx: InstantiateContext): void {
    const layout = ctx.layout;
    for (const axis of ['x', 'y'] as const) {
        const count = axis === 'x' ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
        if (count <= 0) continue;
        const enc = spec.encoding?.[axis];
        if (enc?.bin) continue;

        const effStep = axis === 'x' ? layout.xStep : layout.yStep;

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

        const subplotDim = axis === 'x' ? layout.subplotWidth : layout.subplotHeight;
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
 * Adjust rect marks for edge-to-edge tiling on continuous axes.
 * v2 version: reads layout info from InstantiateContext.
 */
export function adjustRectTiling(spec: any, ctx: InstantiateContext): void {
    const layout = ctx.layout;

    for (const axis of ['x', 'y'] as const) {
        const enc = spec.encoding?.[axis];
        if (!enc?.field) continue;
        const t = enc.type;
        if (t === 'nominal' || t === 'ordinal') continue;
        if (enc.aggregate) continue;

        const uniqueVals = [...new Set(ctx.table.map((r: any) => r[enc.field]))];
        const cardinality = uniqueVals.length;
        if (cardinality <= 1) continue;

        const count = axis === 'x' ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
        const effStep = axis === 'x' ? layout.xStep : layout.yStep;
        const pixelSpacing = count > 0 ? effStep * (count + 1) / count : effStep;

        const subplotDim = axis === 'x' ? layout.subplotWidth : layout.subplotHeight;
        const isTemporal = t === 'temporal';
        const maxSize = maxNonOverlapSize(enc.field, ctx.table, isTemporal, subplotDim, count);
        const cellSize = Math.max(1, Math.min(Math.floor(pixelSpacing * 0.98), maxSize));

        const sizeKey = axis === 'x' ? 'width' : 'height';
        spec.mark = setMarkProp(spec.mark, sizeKey, cellSize);
    }
}

/**
 * Convert both positional axes to discrete types if they aren't already.
 * Returns resolvedTypes for layout declaration.
 */
export function ensureDiscreteTypes(
    channelSemantics: Record<string, ChannelSemantics>,
    table: any[],
): Record<string, 'nominal' | 'ordinal' | 'quantitative' | 'temporal'> {
    const resolvedTypes: Record<string, 'nominal' | 'ordinal' | 'quantitative' | 'temporal'> = {};
    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (!cs?.field || isDiscrete(cs.type)) continue;
        resolvedTypes[axis] = resolveDiscreteType(cs.type, cs.field, table);
    }
    return resolvedTypes;
}
