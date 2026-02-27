// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * REUSABLE DECISION LOGIC
 * =============================================================================
 *
 * Pure decision functions that determine chart layout behavior.
 * These functions take data/config inputs and return decision objects —
 * NO Vega-Lite spec mutation happens here.
 *
 * The separation ensures:
 * 1. Decision logic is testable in isolation
 * 2. Same decisions can drive different output formats (VL, SVG, etc.)
 * 3. Templates can call decision functions without coupling to VL
 *
 * Naming conventions:
 *   - `compute*()` — returns a decision/value from inputs
 *   - `resolve*()` — picks from alternatives (type resolution, etc.)
 *   - `classify*()` — categorizes an input
 * =============================================================================
 */

import {
    getVisCategory,
    inferVisCategory,
    type VisCategory,
} from './semantic-types';

// ---------------------------------------------------------------------------
// Encoding Type Resolution
// ---------------------------------------------------------------------------

/**
 * Result of encoding type resolution.
 * Separates the decision from what gets written into VL.
 */
export interface EncodingTypeDecision {
    /** The resolved VL encoding type */
    vlType: 'quantitative' | 'ordinal' | 'nominal' | 'temporal';
    /** The VisCategory that drove the decision */
    visCategory: VisCategory;
    /** Whether the type was overridden by channel rules */
    channelOverride: boolean;
    /** Whether the type was overridden by cardinality/fraction guard */
    cardinalityGuard: boolean;
}

/**
 * Resolve the VL encoding type for a field.
 *
 * Unified pipeline:
 *   1. Determine a VisCategory — from semantic type if available, otherwise
 *      inferred from raw data values.
 *   2. Map VisCategory → VL encoding type, applying channel-specific rules
 *      (e.g. temporal → ordinal for facets).
 *   3. Guard against mis-classified ordinal types with dense float data.
 *
 * This is a pure decision — it does NOT mutate any spec.
 *
 * @param semanticType   Semantic type string (e.g. 'Quantity', 'Country')
 * @param fieldValues    Sampled values from the field
 * @param channel        VL channel name (e.g. 'x', 'y', 'color')
 * @param data           Full data table (for computing unique value counts)
 * @param fieldName      Field name (for data lookups)
 */
export function resolveEncodingType(
    semanticType: string,
    fieldValues: any[],
    channel: string,
    data: any[],
    fieldName: string,
): EncodingTypeDecision {
    // Step 1: Determine vis category
    const mappedCategory = semanticType ? getVisCategory(semanticType) : null;
    const visCategory: VisCategory = mappedCategory ?? inferVisCategory(fieldValues);

    let channelOverride = false;
    let cardinalityGuard = false;

    // Step 2: Map to VL type with channel-specific overrides
    switch (visCategory) {
        case 'temporal': {
            if (['size', 'column', 'row'].includes(channel)) {
                channelOverride = true;
                return { vlType: 'ordinal', visCategory, channelOverride, cardinalityGuard };
            }
            if (channel === 'color') {
                const uniqueColorValues = new Set(data.map(r => r[fieldName])).size;
                if (uniqueColorValues <= 12) {
                    channelOverride = true;
                    return { vlType: 'ordinal', visCategory, channelOverride, cardinalityGuard };
                }
            }
            // Validate temporal parsing
            {
                const sampleValues = data.map(r => r[fieldName]).slice(0, 15).filter((v: any) => v != null);
                const isValidTemporal = sampleValues.length > 0 && sampleValues.some((val: any) => {
                    if (val instanceof Date) return true;
                    if (typeof val === 'number') {
                        if (val >= 1000 && val <= 3000) return true;
                        if (val > 86400000 && val < 4200000000000) return true;
                        return false;
                    }
                    if (typeof val === 'string') {
                        const trimmed = val.trim();
                        if (!trimmed) return false;
                        if (/^\d{4}$/.test(trimmed)) return true;
                        return !Number.isNaN(Date.parse(trimmed));
                    }
                    return false;
                });

                if (!isValidTemporal) {
                    return { vlType: 'ordinal', visCategory, channelOverride: false, cardinalityGuard: false };
                }
                return { vlType: 'temporal', visCategory, channelOverride: false, cardinalityGuard: false };
            }
        }
        case 'ordinal': {
            const numericVals = fieldValues.filter(v => v != null && !isNaN(+v)).map(Number);
            if (numericVals.length > 0) {
                const uniqueCount = new Set(numericVals).size;
                const hasFractions = numericVals.some(v => v % 1 !== 0);

                // Guard 1: fractional + high-cardinality → mis-classified continuous measure
                if (hasFractions && uniqueCount > 20) {
                    cardinalityGuard = true;
                    return { vlType: 'quantitative', visCategory, channelOverride, cardinalityGuard };
                }

                // Guard 2: integer ordinal with high cardinality on color/group →
                // a discrete legend with 12+ entries is unreadable; promote to
                // quantitative so VL renders a continuous gradient instead.
                if (!hasFractions && uniqueCount > 12 && ['color', 'group'].includes(channel)) {
                    cardinalityGuard = true;
                    channelOverride = true;
                    return { vlType: 'quantitative', visCategory, channelOverride, cardinalityGuard };
                }
            }
            return { vlType: 'ordinal', visCategory, channelOverride, cardinalityGuard };
        }
        case 'quantitative':
            return { vlType: 'quantitative', visCategory, channelOverride, cardinalityGuard };
        case 'geographic':
            return { vlType: 'quantitative', visCategory, channelOverride, cardinalityGuard };
        case 'nominal':
        default:
            return { vlType: 'nominal', visCategory, channelOverride, cardinalityGuard };
    }
}

// ---------------------------------------------------------------------------
// Continuous Axis Gas Pressure Model (docs/design-stretch-model.md §2)
// ---------------------------------------------------------------------------

/**
 * Parameters for the per-axis stretch model (docs/design-stretch-model.md §2).
 *
 * Each axis is stretched independently based on how many distinguishable
 * positions (or series) compete for pixel space along that axis.
 */
export interface GasPressureParams {
    /** Mark cross-section in px² — used as default σ for both axes (default: 30) */
    markCrossSection: number;
    /** Per-axis cross-section overrides. When set, the per-axis stretch
     *  uses these instead of `markCrossSection`.
     *  Useful for line charts where X needs more stretch than Y. */
    markCrossSectionX?: number;
    markCrossSectionY?: number;
    /** Override X item count for stretch.
     *  When set, X stretch uses this count (e.g. number of series)
     *  instead of counting unique X pixel positions. */
    xItemCountOverride?: number;
    /** Override Y item count for stretch.
     *  When set, Y stretch uses this count (e.g. number of series)
     *  instead of counting unique Y pixel positions. */
    yItemCountOverride?: number;
    /** Power-law exponent for continuous stretch (default: 0.3) */
    elasticity: number;
    /** Maximum stretch multiplier cap (default: 1.5) */
    maxStretch: number;
}

/** Default gas pressure parameters (§2 recommendations). */
export const DEFAULT_GAS_PRESSURE_PARAMS: GasPressureParams = {
    markCrossSection: 30,
    elasticity: 0.3,
    maxStretch: 1.5,
};

/**
 * Result of the per-axis stretch decision.
 */
export interface GasPressureDecision {
    /** Per-axis stretch: X axis (1 = no stretch) */
    stretchX: number;
    /** Per-axis stretch: Y axis (1 = no stretch) */
    stretchY: number;
}

/**
 * Compute per-axis stretch for a continuous 2D axis region.
 *
 * Implements docs/design-stretch-model.md §2: each axis is stretched independently based
 * on how many distinguishable positions (or series) compete for pixel
 * space along that axis.
 *
 * Two modes per axis:
 *   - Positional: count unique pixel positions, σ_1d = √σ.
 *   - Series-count: when xItemCountOverride / yItemCountOverride is set,
 *     use that count directly with σ (not sqrt'd) since it's already 1D.
 *
 * @param xValues      Numeric x-coordinates of data points
 * @param yValues      Numeric y-coordinates of data points
 * @param xDomain      Scale domain [min, max] for x-axis
 * @param yDomain      Scale domain [min, max] for y-axis
 * @param canvasWidth  Base canvas width W₀
 * @param canvasHeight Base canvas height H₀
 * @param params       Gas pressure parameters (optional, uses defaults)
 */
export function computeGasPressure(
    xValues: number[],
    yValues: number[],
    xDomain: [number, number],
    yDomain: [number, number],
    canvasWidth: number,
    canvasHeight: number,
    params: GasPressureParams = DEFAULT_GAS_PRESSURE_PARAMS,
): GasPressureDecision {
    const N = xValues.length;

    if (N <= 1 || canvasWidth <= 0 || canvasHeight <= 0) {
        return { stretchX: 1, stretchY: 1 };
    }

    // Per-axis stretch via unique-position linear packing.
    // The question for each axis is: "how many distinguishable positions
    // compete for pixel space along this axis?"
    //
    // Count unique positions (bucketed to ~1px resolution) along each
    // axis. Each unique position needs σ_1d ≈ √σ pixels of space.
    // 1D pressure = uniquePositions × σ_1d / axisDimension.
    const sigma1dDefault = Math.sqrt(params.markCrossSection); // ~5 px

    const computeAxisStretch = (values: number[], domain: [number, number], baseDim: number, sigma1d: number): number => {
        if (baseDim <= 0 || values.length <= 1) return 1;

        const range = domain[1] - domain[0];
        if (range <= 0) return 1;

        // Bucket values to ~1px resolution in pixel space
        const pxPerUnit = baseDim / range;
        const seen = new Set<number>();
        for (const v of values) {
            seen.add(Math.round((v - domain[0]) * pxPerUnit));
        }
        const uniquePositions = seen.size;

        // 1D pressure: how many sigma-sized marks fight for baseDim pixels
        const pressure = (uniquePositions * sigma1d) / baseDim;
        if (pressure <= 1) return 1;
        return Math.min(params.maxStretch, Math.pow(pressure, params.elasticity));
    };

    const sigma1dX = params.markCrossSectionX != null ? Math.sqrt(params.markCrossSectionX) : sigma1dDefault;
    const sigma1dY = params.markCrossSectionY != null ? Math.sqrt(params.markCrossSectionY) : sigma1dDefault;

    // Helper: compute stretch for one axis, using series-count override if set.
    // When a series override is provided, σ is used directly (not sqrt'd)
    // because series count is already a 1D concept.
    const computeStretchForAxis = (
        values: number[], domain: [number, number], baseDim: number,
        sigma1d: number, sigmaRaw: number, itemCountOverride?: number,
    ): number => {
        if (itemCountOverride != null && sigmaRaw > 0) {
            const pressure = (itemCountOverride * sigmaRaw) / baseDim;
            return pressure <= 1 ? 1 : Math.min(params.maxStretch, Math.pow(pressure, params.elasticity));
        }
        return sigma1d > 0 ? computeAxisStretch(values, domain, baseDim, sigma1d) : 1;
    };

    const sigmaRawX = params.markCrossSectionX ?? params.markCrossSection;
    const sigmaRawY = params.markCrossSectionY ?? params.markCrossSection;
    const stretchX = computeStretchForAxis(xValues, xDomain, canvasWidth, sigma1dX, sigmaRawX, params.xItemCountOverride);
    const stretchY = computeStretchForAxis(yValues, yDomain, canvasHeight, sigma1dY, sigmaRawY, params.yItemCountOverride);

    return { stretchX, stretchY };
}

// ---------------------------------------------------------------------------
// Elastic Stretch Computation
// ---------------------------------------------------------------------------

/**
 * Parameters for elastic axis stretch computation.
 * These control the spring-model behavior from docs/design-stretch-model.md §1.
 */
export interface ElasticStretchParams {
    /** Power-law exponent for stretch (default: 0.5) */
    elasticity: number;
    /** Maximum stretch multiplier cap (default: 2) */
    maxStretch: number;
    /** Default step size in px per discrete item */
    defaultStepSize: number;
    /** Minimum pixels per discrete item (default: 6) */
    minStep: number;
}

/**
 * Result of elastic budget computation for a single axis.
 */
export interface ElasticBudget {
    /** Elastic-stretched canvas budget in px */
    budget: number;
    /** Stretch multiplier applied (1 = no stretch) */
    stretchFactor: number;
}

/**
 * Compute the elastic canvas budget for an axis with N discrete items.
 *
 * When N items at defaultStepSize exceed the base dimension, the axis
 * stretches using a power-law: stretch = min(maxStretch, pressure^elasticity).
 *
 * @param itemCount       Number of discrete items on the axis
 * @param baseDimension   Base canvas size (width or height) in px
 * @param params          Elastic stretch parameters
 */
export function computeElasticBudget(
    itemCount: number,
    baseDimension: number,
    params: ElasticStretchParams,
): ElasticBudget {
    if (itemCount <= 0) {
        return { budget: baseDimension, stretchFactor: 1 };
    }
    const pressure = (itemCount * params.defaultStepSize) / baseDimension;
    if (pressure <= 1) {
        return { budget: baseDimension, stretchFactor: 1 };
    }
    const stretchFactor = Math.min(params.maxStretch, Math.pow(pressure, params.elasticity));
    return {
        budget: baseDimension * stretchFactor,
        stretchFactor,
    };
}

/**
 * Result of per-axis step computation.
 */
export interface AxisStepDecision {
    /** Computed step size in px per item */
    step: number;
    /** Total canvas budget in px */
    budget: number;
    /** Number of items this step was computed for */
    itemCount: number;
}

/**
 * Compute the step size for a single axis, covering both discrete
 * and continuous-as-discrete (banded) cases.
 *
 * @param nominalCount       Number of discrete (nominal/ordinal) items
 * @param continuousCount    Number of continuous-as-discrete items (banded Q/T)
 * @param baseDimension      Base canvas size (width or height) in px
 * @param params             Elastic stretch parameters
 */
export function computeAxisStep(
    nominalCount: number,
    continuousCount: number,
    baseDimension: number,
    params: ElasticStretchParams,
): AxisStepDecision {
    if (nominalCount > 0) {
        const { budget } = computeElasticBudget(nominalCount, baseDimension, params);
        return { step: Math.floor(budget / nominalCount), budget, itemCount: nominalCount };
    }
    if (continuousCount > 0) {
        const { budget } = computeElasticBudget(continuousCount, baseDimension, params);
        return { step: Math.floor(budget / continuousCount), budget, itemCount: continuousCount };
    }
    return { step: params.defaultStepSize, budget: baseDimension, itemCount: 0 };
}

// ---------------------------------------------------------------------------
// Facet Layout Decisions
// ---------------------------------------------------------------------------

/**
 * Result of facet layout computation.
 */
export interface FacetLayoutDecision {
    /** Number of facet columns */
    columns: number;
    /** Number of facet rows */
    rows: number;
    /** Per-subplot width in px */
    subplotWidth: number;
    /** Per-subplot height in px */
    subplotHeight: number;
}

/**
 * Parameters for facet layout computation.
 */
export interface FacetLayoutParams {
    /** Power-law exponent for facet stretch (default: 0.3) */
    facetElasticity: number;
    /** Maximum total stretch multiplier cap (default: 2) */
    maxStretch: number;
    /** Minimum subplot size in px (default: 60) */
    minSubplotSize: number;
}

/**
 * Compute facet subplot dimensions.
 *
 * @param facetCols       Number of facet columns
 * @param facetRows       Number of facet rows
 * @param baseWidth       Base canvas width in px
 * @param baseHeight      Base canvas height in px
 * @param params          Facet layout parameters
 */
export function computeFacetLayout(
    facetCols: number,
    facetRows: number,
    baseWidth: number,
    baseHeight: number,
    params: FacetLayoutParams,
): FacetLayoutDecision {
    const minContinuousSize = Math.max(10, 6);

    let subplotWidth: number;
    if (facetCols > 1) {
        const stretch = Math.min(params.maxStretch, Math.pow(facetCols, params.facetElasticity));
        subplotWidth = Math.round(Math.max(minContinuousSize, baseWidth * stretch / facetCols));
    } else {
        subplotWidth = baseWidth;
    }

    let subplotHeight: number;
    if (facetRows > 1) {
        const stretch = Math.min(params.maxStretch, Math.pow(facetRows, params.facetElasticity));
        subplotHeight = Math.round(Math.max(minContinuousSize, baseHeight * stretch / facetRows));
    } else {
        subplotHeight = baseHeight;
    }

    return { columns: facetCols, rows: facetRows, subplotWidth, subplotHeight };
}

// ---------------------------------------------------------------------------
// Label Sizing Decisions
// ---------------------------------------------------------------------------

/**
 * Result of label sizing computation for a discrete axis.
 */
export interface LabelSizingDecision {
    /** Font size in px */
    fontSize: number;
    /** Max label width in px */
    labelLimit: number;
    /** Label rotation angle (undefined = no rotation) */
    labelAngle?: number;
    /** Label alignment (for rotated labels) */
    labelAlign?: string;
    /** Label baseline (for rotated labels) */
    labelBaseline?: string;
}

/**
 * Compute label sizing for a discrete axis based on the effective step size.
 * Pure decision — returns sizing params without modifying any spec.
 *
 * @param effectiveStep      Pixels per discrete item
 * @param hasDiscreteItems   Whether the axis has discrete items
 */
export function computeLabelSizing(
    effectiveStep: number,
    hasDiscreteItems: boolean,
): LabelSizingDecision {
    const defaultFontSize = 10;
    const defaultLimit = 100;

    if (!hasDiscreteItems) {
        return { fontSize: defaultFontSize, labelLimit: defaultLimit };
    }

    let fontSize = Math.max(6, Math.min(10, effectiveStep - 1));
    let labelLimit = Math.max(30, Math.min(100, effectiveStep * 8));
    let labelAngle: number | undefined;
    let labelAlign: string | undefined;
    let labelBaseline: string | undefined;

    if (effectiveStep < 10) {
        labelAngle = -90;
        fontSize = Math.max(6, Math.min(8, effectiveStep));
        labelLimit = 40;
        labelAlign = 'right';
        labelBaseline = 'middle';
    } else if (effectiveStep < 16) {
        labelAngle = -45;
        fontSize = Math.max(7, Math.min(9, effectiveStep));
        labelLimit = 60;
        labelAlign = 'right';
        labelBaseline = 'top';
    }

    return { fontSize, labelLimit, labelAngle, labelAlign, labelBaseline };
}

// ---------------------------------------------------------------------------
// Overflow Decision
// ---------------------------------------------------------------------------

/**
 * Result of overflow analysis for a discrete axis.
 */
export interface OverflowDecision {
    /** Whether overflow occurred (more items than can fit) */
    overflowed: boolean;
    /** Maximum items to keep */
    maxToKeep: number;
    /** Number of items omitted */
    omittedCount: number;
}

/**
 * Compute whether a discrete axis overflows and how many items to keep.
 *
 * @param uniqueCount    Number of unique values on the axis
 * @param maxDimension   Maximum canvas dimension (with stretch) in px
 * @param minStepSize    Minimum px per item
 */
export function computeOverflow(
    uniqueCount: number,
    maxDimension: number,
    minStepSize: number,
): OverflowDecision {
    const maxToKeep = Math.floor(maxDimension / minStepSize);
    const overflowed = uniqueCount > maxToKeep;
    return {
        overflowed,
        maxToKeep,
        omittedCount: overflowed ? uniqueCount - maxToKeep : 0,
    };
}

// ---------------------------------------------------------------------------
// Circumference-pressure model for radial charts (§3)
// ---------------------------------------------------------------------------

/**
 * Parameters for circumference-pressure scaling (spring model on polar axis).
 */
export interface CircumferencePressureParams {
    /** Minimum arc-length (px) each "effective bar" needs on the
     *  circumference — analogous to defaultStepSize in the spring model.
     *  Default: 45 */
    minArcPx?: number;
    /** Minimum chart radius in px. Default: 60 */
    minRadius?: number;
    /** Maximum chart radius in px. Caps runaway growth. Default: 400 */
    maxRadius?: number;
    /** Power-law exponent for pressure → stretch (same as spring model).
     *  0.5 = square-root growth. Default: 0.5 */
    elasticity?: number;
    /** Per-dimension maximum stretch multiplier cap (matches bar-chart
     *  default of 2.0).  The effective max stretch on the radius is
     *  derived from min(baseW, baseH) × maxStretch so that the chart
     *  never exceeds the cap in either dimension.  Default: 2.0 */
    maxStretch?: number;
    /** Extra margin outside the chart circle (px) for labels, legend, etc.
     *  Added to each side when computing canvas dimensions. Default: 20 */
    margin?: number;
}

/**
 * Result of circumference pressure computation.
 */
export interface CircumferencePressureResult {
    /** Computed chart radius in px */
    radius: number;
    /** Recommended canvas width (px) */
    canvasW: number;
    /** Recommended canvas height (px) */
    canvasH: number;
}

/**
 * Compute radial chart sizing using the spring model mapped to a polar axis.
 *
 * Treats the circumference as a linear "bar axis":
 *   baseCircumference = 2π × baseRadius
 *   pressure = effectiveItemCount × minArcPx / baseCircumference
 *   if pressure > 1:  stretch = min(maxStretch, pressure ^ elasticity)
 *   radius = baseRadius × stretch
 *
 * **effectiveItemCount** varies by chart type:
 *   - Rose / Radar: N categories (uniform slices/spokes)
 *   - Pie: total / minValue — how many of the smallest slice fit in the
 *     full circle.  This captures the worst-case thin slice that needs
 *     minimum arc width.
 *   - Sunburst: same as pie but computed on the outer ring leaves only.
 *
 * Both canvas dimensions grow equally (maintains 1:1 circular aspect).
 *
 * @param effectiveItemCount  Effective number of uniform "bars" around
 *                            the circle (see above)
 * @param canvasSize          Base canvas dimensions (from context)
 * @param params              Optional tuning parameters
 */
export function computeCircumferencePressure(
    effectiveItemCount: number,
    canvasSize: { width: number; height: number },
    params: CircumferencePressureParams = {},
): CircumferencePressureResult {
    const {
        minArcPx = 45,
        minRadius = 60,
        maxRadius = 400,
        elasticity = 0.5,
        maxStretch = 2.0,
        margin = 20,
    } = params;

    const baseW = canvasSize.width;
    const baseH = canvasSize.height;

    // Base radius: largest circle that fits in the base canvas
    const baseRadius = Math.max(minRadius,
        (Math.min(baseW, baseH) / 2) - margin);

    // ── Effective max-stretch on the radius ──────────────────────────
    // The radius stretch expands the canvas in BOTH x and y equally.
    // Cap so that neither dimension exceeds maxStretch × baseDim.
    const maxCanvasW = baseW * maxStretch;
    const maxCanvasH = baseH * maxStretch;
    const maxDiameter = Math.min(maxCanvasW, maxCanvasH);
    const effectiveMaxRadius = Math.min(maxRadius,
        (maxDiameter - 2 * margin) / 2);
    const effectiveMaxStretch = Math.max(1, effectiveMaxRadius / baseRadius);

    // Spring model: pressure = items × step / baseDimension
    const baseCircumference = 2 * Math.PI * baseRadius;
    const pressure = (effectiveItemCount * minArcPx) / baseCircumference;

    let radius: number;
    if (pressure <= 1) {
        // No pressure — base radius is sufficient
        radius = baseRadius;
    } else {
        // Elastic stretch (same power law as bar-chart spring model)
        const stretch = Math.min(effectiveMaxStretch, Math.pow(pressure, elasticity));
        radius = Math.round(baseRadius * stretch);
    }

    // Clamp
    radius = Math.min(maxRadius, Math.max(minRadius, radius));

    // Canvas = diameter + margins
    const diameter = 2 * radius + 2 * margin;
    const canvasW = Math.max(baseW, diameter);
    const canvasH = Math.max(baseH, diameter);

    return { radius, canvasW, canvasH };
}

/**
 * Compute effective bar count for variable-width slices (pie / sunburst).
 *
 * If all slices are equal, this returns N (number of slices).
 * If slices vary, this returns `total / minValue` — i.e., how many of the
 * thinnest slice would fill the whole circle.  This is the worst-case
 * pressure that determines whether the chart needs to grow.
 *
 * Capped at 100 to prevent degenerate cases (near-zero slices) from
 * blowing up the radius.
 *
 * @param values  Array of slice values (must be > 0)
 */
export function computeEffectiveBarCount(values: number[]): number {
    if (values.length === 0) return 0;
    const positiveValues = values.filter(v => v > 0);
    if (positiveValues.length === 0) return values.length;

    const total = positiveValues.reduce((s, v) => s + v, 0);
    const minVal = Math.min(...positiveValues);

    // effectiveCount = total / minVal → how many of the smallest slice fill the circle
    const effective = total / minVal;

    // Cap at 100 to prevent degenerate cases
    return Math.min(100, effective);
}
