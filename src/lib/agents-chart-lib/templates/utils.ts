// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared helper functions for chart template post-processors.
 * Pure logic — no UI dependencies.
 */

/**
 * Dynamic mark resizing for bar, rect, and similar marks.
 * For each non-discrete (temporal/quantitative) axis without an aggregate:
 *   - If cardinality ≤ nominalThreshold → convert to nominal (clean discrete layout)
 *   - Otherwise → leave to assembler (elastic stretch + proportional sizing)
 * Discrete (nominal/ordinal) axes are skipped — step-based layout handles them.
 * Aggregate axes are skipped — they are measure axes, not positional.
 *
 * @param sizeProps  Maps axis → mark property to set.
 *                   Bar: {x:'size', y:'size'},  Rect: {x:'width', y:'height'}
 * @param nominalThreshold  Convert to nominal if cardinality ≤ this (0 = never convert)
 */
export const applyDynamicMarkResizing = (
    vgSpec: any,
    table: any[],
    sizeProps: { x: string; y: string },
    nominalThreshold: number = 0
): any => {
    if (!table || table.length === 0) return vgSpec;

    const isDiscrete = (type: string | undefined) => type === "nominal" || type === "ordinal";

    for (const axis of ['x', 'y'] as const) {
        const enc = vgSpec.encoding?.[axis];
        if (!enc || !enc.field || isDiscrete(enc.type)) continue;
        // Skip aggregate/measure axes — they don't determine mark positioning
        if (enc.aggregate) continue;
        // Skip binned axes — VL handles bin bar sizing natively
        if (enc.bin) continue;

        const cardinality = new Set(table.map((r: any) => r[enc.field])).size;

        if (nominalThreshold > 0 && cardinality <= nominalThreshold) {
            // Small cardinality → convert to nominal for clean discrete layout
            enc.type = "nominal";
        }
        // Mark sizing for continuous-as-discrete axes is handled by the
        // assembler's elastic stretch logic, just like step-based layout
        // handles discrete axes.  No mark.size override needed here.
    }
    return vgSpec;
};

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
 * Ensures one axis (x or y) is discrete (nominal or ordinal) based on the spec and data cardinality.
 * If neither axis is discrete, converts the one with lower cardinality to nominal.
 * Returns "x" or "y" indicating which channel is discrete, or null if undetermined.
 */
export const ensureNominalAxis = (
    vgSpec: any,
    table: any[],
    defaultToX: boolean = true
): "x" | "y" | null => {
    const isDiscrete = (type: string | undefined) => type === "nominal" || type === "ordinal";

    if (isDiscrete(vgSpec.encoding.x?.type)) {
        return "x";
    } else if (isDiscrete(vgSpec.encoding.y?.type)) {
        return "y";
    } else if (vgSpec.encoding.x && vgSpec.encoding.y) {
        // Neither are nominal, determine based on cardinality
        if (table && table.length > 0) {
            const xField = vgSpec.encoding.x?.field;
            const yField = vgSpec.encoding.y?.field;

            let xCardinality = Infinity;
            let yCardinality = Infinity;

            if (xField) {
                const xValues = [...new Set(table.map(r => r[xField]))];
                xCardinality = xValues.length;
            }

            if (yField) {
                const yValues = [...new Set(table.map(r => r[yField]))];
                yCardinality = yValues.length;
            }

            // The axis with lower cardinality should be nominal (categories)
            if (xCardinality <= yCardinality) {
                vgSpec.encoding.x.type = "nominal";
                return "x";
            } else {
                vgSpec.encoding.y.type = "nominal";
                return "y";
            }
        } else {
            if (defaultToX) {
                vgSpec.encoding.x.type = "nominal";
                return "x";
            } else {
                vgSpec.encoding.y.type = "nominal";
                return "y";
            }
        }
    } else if (vgSpec.encoding.x) {
        if (vgSpec.encoding.x.type !== "nominal") {
            vgSpec.encoding.x.type = "nominal";
        }
        return "x";
    } else if (vgSpec.encoding.y) {
        if (vgSpec.encoding.y.type !== "nominal") {
            vgSpec.encoding.y.type = "nominal";
        }
        return "y";
    }
    return null;
};

/**
 * Default buildEncodings implementation for simple templates.
 * Maps each channel directly to spec.encoding[channel].
 * Use this when all channels map to the top-level encoding object.
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
