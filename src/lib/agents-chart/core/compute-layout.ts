// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * PHASE 1: COMPUTE LAYOUT
 * =============================================================================
 *
 * Determine how big things should be — axis lengths, step sizes,
 * subplot dimensions, label sizing, and overflow truncation — from data
 * density, axis classification, and template-provided tuning knobs.
 *
 * VL dependency: **None**
 *
 * This module reads abstract axis descriptors (AxisLayoutInput) and
 * produces abstract layout numbers (LayoutResult). The same layout
 * engine works regardless of output format.
 *
 * ── Backend Responsibility ──────────────────────────────────────────
 * The LayoutResult is a target-agnostic description of "how big things
 * should be".  Each rendering backend (Vega-Lite, ECharts, etc.) MUST:
 *
 *   1. Call computeLayout() once per chart (facet-aware — it already
 *      divides subplot sizes for the facet grid).
 *
 *   2. Translate the LayoutResult into its own rendering format:
 *      - subplotWidth / subplotHeight → plot area size (before margins)
 *      - xStep / yStep → bar widths, band sizes, category spacing
 *      - stepPadding → inter-category gap (barCategoryGap, paddingInner)
 *      - label sizing → font size, rotation, truncation
 *
 *   3. Add its own margins, padding, and chrome (axis labels, titles,
 *      legends, CANVAS_BUFFER) around the subplot area.
 *
 *   4. Handle facet-specific concerns itself:
 *      - Column wrapping (when user specifies column-only, the backend
 *        decides how many columns per visual row and restructures the
 *        panel grid accordingly).
 *      - Per-panel vs shared axis titles.
 *      - Panel positioning and header labels.
 *
 * The layout engine does NOT know about VL encodings, ECharts grid
 * objects, or any rendering-specific structure.
 * =============================================================================
 */

import type {
    ChannelSemantics,
    LayoutDeclaration,
    LayoutResult,
    AssembleOptions,
    ChannelBudgets,
} from './types';
import {
    computeElasticBudget,
    computeAxisStep,
    computeGasPressure,
    computeLabelSizing,
    DEFAULT_GAS_PRESSURE_PARAMS,
    type ElasticStretchParams,
    type GasPressureParams,
    type GasPressureDecision,
} from './decisions';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AxisLayoutInput {
    /** Spring model (banded) or gas pressure (non-banded) */
    mode: 'banded' | 'non-banded';
    /** Number of discrete positions (for banded) */
    itemCount: number;
    /** Number of sub-items per group (for grouped bars) */
    subItemsPerGroup?: number;
    /** Numeric values along this axis (for gas pressure) */
    values?: number[];
    /** Data extent [min, max] */
    domain?: [number, number];
    /** Number of distinct series (for series-based pressure) */
    seriesCount?: number;
}

// ---------------------------------------------------------------------------
// Public API: computeLayout
// ---------------------------------------------------------------------------

/**
 * Phase 1: Compute layout decisions.
 *
 * Takes channel semantics, template layout declaration, data, canvas size,
 * and assembly options to produce a LayoutResult with step sizes, subplot
 * dimensions, label sizing, and truncation warnings.
 *
 * VL dependency: **None**
 *
 * @param channelSemantics   Phase 0 output
 * @param declaration        Template's layout declaration (axisFlags, resolvedTypes,
 *                           grouping, binnedAxes)
 * @param table              Data rows (post-overflow filtered)
 * @param canvasSize         Target canvas dimensions
 * @param options            Assembly options (merged with template overrides)
 * @param facetGrid          Optional pre-decided facet grid from computeFacetGrid.
 *                           When provided, computeLayout uses these column/row
 *                           counts instead of counting from data — this
 *                           eliminates the circularity between wrapping and
 *                           banded axis sizing.
 */
export function computeLayout(
    channelSemantics: Record<string, ChannelSemantics>,
    declaration: LayoutDeclaration,
    table: any[],
    canvasSize: { width: number; height: number },
    options: AssembleOptions = {},
    facetGrid?: { columns: number; rows: number },
): LayoutResult {
    const {
        elasticity: elasticityVal = 0.5,
        maxStretch: maxStretchVal = 2,
        facetElasticity: facetElasticityVal = 0.3,
        minStep: minStepVal = 6,
        minSubplotSize: minSubplotVal = 60,
        defaultStepMultiplier = 1,
        stepPadding: stepPaddingVal = 0.1,
        maintainContinuousAxisRatio = false,
        continuousMarkCrossSection,
    } = options;

    const defaultChartWidth = canvasSize.width;
    const defaultChartHeight = canvasSize.height;

    // Facet overhead: fixed (axis labels, titles) + per-panel gap (spacing).
    const fixW = options.facetFixedPadding?.width ?? 0;
    const fixH = options.facetFixedPadding?.height ?? 0;
    const gap  = options.facetGap ?? 0;

    const baseRefSize = 300;
    const sizeRatio = Math.max(defaultChartWidth, defaultChartHeight) / baseRefSize;
    const defaultStepSize = Math.round(20 * Math.max(1, sizeRatio) * defaultStepMultiplier);

    const isDiscreteType = (t: string | undefined) => t === 'nominal' || t === 'ordinal';

    // Apply resolved types from template declaration
    const effectiveTypes: Record<string, string> = {};
    for (const [ch, cs] of Object.entries(channelSemantics)) {
        effectiveTypes[ch] = declaration.resolvedTypes?.[ch] || cs.type;
    }

    // --- Classify axes and count items ---
    const axisFlags = declaration.axisFlags || {};
    const xBanded = axisFlags.x?.banded ?? false;
    const yBanded = axisFlags.y?.banded ?? false;

    const nominalCount: Record<string, number> = {
        x: 0, y: 0, column: 0, row: 0, group: 0,
    };

    // Count discrete values per channel
    for (const channel of ['x', 'y', 'column', 'row', 'color'] as const) {
        const cs = channelSemantics[channel];
        if (!cs?.field) continue;
        const effectiveType = effectiveTypes[channel] || cs.type;
        if (!isDiscreteType(effectiveType)) continue;
        const uniqueValues = [...new Set(table.map((r: any) => r[cs.field]))];
        nominalCount[channel] = uniqueValues.length;
    }

    // Detect grouping from 'group' channel + discrete axis
    const groupField = channelSemantics.group?.field;
    let groupAxis: 'x' | 'y' | undefined;
    if (groupField) {
        nominalCount.group = new Set(table.map((r: any) => r[groupField])).size;
        if (isDiscreteType(effectiveTypes.x ?? channelSemantics.x?.type)) groupAxis = 'x';
        else if (isDiscreteType(effectiveTypes.y ?? channelSemantics.y?.type)) groupAxis = 'y';
    }

    // Total discrete items per axis (grouping multiplies the grouped axis)
    const xGroupMultiplier = (groupAxis === 'x' && nominalCount.group > 1) ? nominalCount.group : 1;
    const yGroupMultiplier = (groupAxis === 'y' && nominalCount.group > 1) ? nominalCount.group : 1;
    let xTotalNominalCount = nominalCount.x * xGroupMultiplier;
    let yTotalNominalCount = nominalCount.y * yGroupMultiplier;

    // --- Step size hints ---
    // Minimum group step: the inter-group gap (stepPadding × step) must be
    // at least MIN_GROUP_GAP_PX pixels so groups are visually separated.
    const MIN_GROUP_GAP_PX = 3;
    const xMinGroupStep = xGroupMultiplier > 1 ? Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * xGroupMultiplier) : minStepVal;
    const yMinGroupStep = yGroupMultiplier > 1 ? Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * yGroupMultiplier) : minStepVal;

    // (Overflow filtering is now handled by filterOverflow() before
    //  computeLayout is called. The data passed here is already filtered.)

    // --- Count banded continuous axes ---
    let xContinuousAsDiscrete = 0;
    let yContinuousAsDiscrete = 0;
    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (!cs?.field) continue;
        const effectiveType = effectiveTypes[axis] || cs.type;
        if (isDiscreteType(effectiveType)) continue;

        const isBanded = (axis === 'x' ? xBanded : yBanded);
        // Check for binned from declaration
        const isBinned = declaration.binnedAxes?.[axis];
        if (!isBanded && !isBinned) continue;

        let count: number;
        if (isBinned) {
            const binDef = declaration.binnedAxes![axis];
            // Default to 10 bins (Vega-Lite's default maxbins)
            count = typeof binDef === 'object' && binDef.maxbins
                ? binDef.maxbins : 10;
        } else {
            count = new Set(table.map((r: any) => r[cs.field])).size;
        }
        if (count <= 1) continue;

        if (axis === 'x') {
            xContinuousAsDiscrete = count;
        } else {
            yContinuousAsDiscrete = count;
        }
    }

    // --- Facet layout ---
    // Use pre-decided grid from filterOverflow when available.
    // This avoids the circularity where wrapping depends on subplot
    // width which depends on facet count which depends on wrapping.
    let facetCols = 1;
    let facetRows = 1;
    if (facetGrid) {
        facetCols = facetGrid.columns;
        facetRows = facetGrid.rows;
    } else {
        if (nominalCount.column > 0) facetCols = nominalCount.column;
        if (nominalCount.row > 0) facetRows = nominalCount.row;
    }

    // --- Facet subplot sizing ---
    // Log-scale axes need more room so the minor grid lines (1,2,3…9 per
    // decade) remain legible and act as the visual cue that it's log scale.
    // Compute the number of orders of magnitude each axis spans; each
    // decade needs ~40px minimum to avoid a dense wall of grid lines.
    const LOG_PX_PER_DECADE = 40;
    let logBoostX = 0;
    let logBoostY = 0;
    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (!cs?.field || !cs.scaleType) continue;
        if (cs.scaleType !== 'log' && cs.scaleType !== 'symlog') continue;
        const vals = table
            .map((r: any) => r[cs.field])
            .filter((v: any) => typeof v === 'number' && v > 0 && isFinite(v));
        if (vals.length < 2) continue;
        const decades = Math.log10(Math.max(...vals)) - Math.log10(Math.min(...vals));
        const needed = Math.ceil(Math.max(1, decades)) * LOG_PX_PER_DECADE;
        if (axis === 'x') logBoostX = needed;
        else logBoostY = needed;
    }
    const minContinuousSize = Math.max(10, minStepVal);
    const minContinuousSizeX = Math.max(minContinuousSize, logBoostX);
    const minContinuousSizeY = Math.max(minContinuousSize, logBoostY);

    let subplotWidth: number;
    if (facetCols > 1) {
        const stretch = Math.min(maxStretchVal, Math.pow(facetCols, facetElasticityVal));
        subplotWidth = Math.round(Math.max(minContinuousSizeX,
            (defaultChartWidth * stretch - fixW) / facetCols - gap));
    } else {
        subplotWidth = defaultChartWidth;
    }

    let subplotHeight: number;
    if (facetRows > 1) {
        const stretch = Math.min(maxStretchVal, Math.pow(facetRows, facetElasticityVal));
        subplotHeight = Math.round(Math.max(minContinuousSizeY,
            (defaultChartHeight * stretch - fixH) / facetRows - gap));
    } else {
        subplotHeight = defaultChartHeight;
    }

    // --- Gas pressure stretch for continuous non-banded axes ---
    const xIsContinuousNonBanded = xTotalNominalCount === 0 && xContinuousAsDiscrete === 0;
    const yIsContinuousNonBanded = yTotalNominalCount === 0 && yContinuousAsDiscrete === 0;

    if (xIsContinuousNonBanded && yIsContinuousNonBanded) {
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;

        if (xCS?.field && yCS?.field) {
            const isTempX = (effectiveTypes.x || xCS.type) === 'temporal';
            const isTempY = (effectiveTypes.y || yCS.type) === 'temporal';

            const xNumeric: number[] = [];
            const yNumeric: number[] = [];
            for (const row of table) {
                let xv = row[xCS.field];
                let yv = row[yCS.field];
                if (xv == null || yv == null) continue;
                if (isTempX) xv = +new Date(xv);
                else xv = +xv;
                if (isTempY) yv = +new Date(yv);
                else yv = +yv;
                if (isNaN(xv) || isNaN(yv)) continue;
                xNumeric.push(xv);
                yNumeric.push(yv);
            }

            if (xNumeric.length > 1) {
                const xMin = Math.min(...xNumeric);
                const xMax = Math.max(...xNumeric);
                const yMin = Math.min(...yNumeric);
                const yMax = Math.max(...yNumeric);

                const xDomain: [number, number] = [xMin, xMax];
                const yDomain: [number, number] = [yMin, yMax];

                let gasPressureParams: GasPressureParams = DEFAULT_GAS_PRESSURE_PARAMS;
                if (continuousMarkCrossSection != null) {
                    if (typeof continuousMarkCrossSection === 'number') {
                        gasPressureParams = { ...DEFAULT_GAS_PRESSURE_PARAMS, markCrossSection: continuousMarkCrossSection };
                    } else {
                        const maxCS = Math.max(continuousMarkCrossSection.x, continuousMarkCrossSection.y);
                        gasPressureParams = {
                            ...DEFAULT_GAS_PRESSURE_PARAMS,
                            markCrossSection: maxCS,
                            markCrossSectionX: continuousMarkCrossSection.x,
                            markCrossSectionY: continuousMarkCrossSection.y,
                            ...(continuousMarkCrossSection.elasticity != null && { elasticity: continuousMarkCrossSection.elasticity }),
                            ...(continuousMarkCrossSection.maxStretch != null && { maxStretch: continuousMarkCrossSection.maxStretch }),
                        };

                        // Series-count-based pressure
                        if (continuousMarkCrossSection.seriesCountAxis) {
                            const resolvedAxis = continuousMarkCrossSection.seriesCountAxis === 'auto'
                                ? 'y' : continuousMarkCrossSection.seriesCountAxis;

                            const nSeries = countDistinctSeries(channelSemantics, table);
                            if (resolvedAxis === 'y') {
                                gasPressureParams.yItemCountOverride = nSeries;
                            } else {
                                gasPressureParams.xItemCountOverride = nSeries;
                            }
                        }
                    }
                }

                const gasPressureResult = computeGasPressure(
                    xNumeric, yNumeric, xDomain, yDomain,
                    subplotWidth, subplotHeight, gasPressureParams,
                );

                if (gasPressureResult.stretchX > 1 || gasPressureResult.stretchY > 1) {
                    let sx = gasPressureResult.stretchX;
                    let sy = gasPressureResult.stretchY;
                    if (maintainContinuousAxisRatio) {
                        const maxStretch = Math.max(sx, sy);
                        sx = maxStretch;
                        sy = maxStretch;
                    }
                    if (typeof continuousMarkCrossSection === 'object' &&
                        continuousMarkCrossSection.seriesCountAxis) {
                        const sAxis = continuousMarkCrossSection.seriesCountAxis === 'auto'
                            ? 'y' : continuousMarkCrossSection.seriesCountAxis;
                        if (sAxis === 'y' && sy > 1 && sx < sy) sx = sy;
                        if (sAxis === 'x' && sx > 1 && sy < sx) sy = sx;
                    }
                    subplotWidth = Math.round(subplotWidth * sx);
                    subplotHeight = Math.round(subplotHeight * sy);
                }
            }
        }
    } else if (xIsContinuousNonBanded || yIsContinuousNonBanded) {
        const contAxis = xIsContinuousNonBanded ? 'x' : 'y';
        const otherAxisHasDiscreteItems = contAxis === 'x'
            ? (yTotalNominalCount > 0 || yContinuousAsDiscrete > 0)
            : (xTotalNominalCount > 0 || xContinuousAsDiscrete > 0);

        let seriesStretchApplied = false;
        if (typeof continuousMarkCrossSection === 'object' && continuousMarkCrossSection.seriesCountAxis) {
            const resolvedAxis = continuousMarkCrossSection.seriesCountAxis === 'auto'
                ? contAxis : continuousMarkCrossSection.seriesCountAxis;

            if (resolvedAxis === contAxis) {
                const sigmaPerSeries = contAxis === 'x'
                    ? continuousMarkCrossSection.x
                    : continuousMarkCrossSection.y;
                const baseDim = contAxis === 'x' ? subplotWidth : subplotHeight;
                const nSeries = countDistinctSeries(channelSemantics, table);
                const pressure = (nSeries * sigmaPerSeries) / baseDim;

                const elast = continuousMarkCrossSection.elasticity ?? DEFAULT_GAS_PRESSURE_PARAMS.elasticity;
                const maxS = continuousMarkCrossSection.maxStretch ?? DEFAULT_GAS_PRESSURE_PARAMS.maxStretch;

                if (pressure > 1) {
                    const stretch = Math.min(maxS, Math.pow(pressure, elast));
                    if (contAxis === 'x') {
                        subplotWidth = Math.round(subplotWidth * stretch);
                    } else {
                        subplotHeight = Math.round(subplotHeight * stretch);
                    }
                }
                seriesStretchApplied = true;
            }
        }

        if (!seriesStretchApplied && !otherAxisHasDiscreteItems) {
            const contCS = channelSemantics[contAxis];
            if (contCS?.field) {
                const isTemporal = (effectiveTypes[contAxis] || contCS.type) === 'temporal';
                const contValues: number[] = [];
                for (const row of table) {
                    let v = row[contCS.field];
                    if (v == null) continue;
                    if (isTemporal) v = +new Date(v);
                    else v = +v;
                    if (!isNaN(v)) contValues.push(v);
                }
                const sigma1d = Math.sqrt(DEFAULT_GAS_PRESSURE_PARAMS.markCrossSection);
                const baseDim = contAxis === 'x' ? subplotWidth : subplotHeight;
                const pressure1d = (contValues.length * sigma1d) / baseDim;
                if (pressure1d > 1) {
                    const stretch1d = Math.min(
                        DEFAULT_GAS_PRESSURE_PARAMS.maxStretch,
                        Math.pow(pressure1d, DEFAULT_GAS_PRESSURE_PARAMS.elasticity),
                    );
                    if (contAxis === 'x') {
                        subplotWidth = Math.round(subplotWidth * stretch1d);
                    } else {
                        subplotHeight = Math.round(subplotHeight * stretch1d);
                    }
                }
            }
        }
    }

    // --- Elastic stretch for discrete axes ---
    const elasticParams: ElasticStretchParams = {
        elasticity: elasticityVal,
        maxStretch: maxStretchVal,
        defaultStepSize,
        minStep: minStepVal,
    };

    const xAxis = computeAxisStep(xTotalNominalCount, xContinuousAsDiscrete, subplotWidth, elasticParams);
    const yAxis = computeAxisStep(yTotalNominalCount, yContinuousAsDiscrete, subplotHeight, elasticParams);

    const xIsDiscrete = xTotalNominalCount > 0;
    const yIsDiscrete = yTotalNominalCount > 0;

    const xHasGrouping = groupAxis === 'x' && nominalCount.group > 0;
    const yHasGrouping = groupAxis === 'y' && nominalCount.group > 0;

    let xStepSize: number;
    let yStepSize: number;
    let xStepUnit: 'item' | 'group' | undefined;
    let yStepUnit: 'item' | 'group' | undefined;

    if (xIsDiscrete && xHasGrouping) {
        const itemsPerGroup = nominalCount.group;
        const defaultGroupStep = itemsPerGroup * defaultStepSize;
        const minGroupStep = Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * itemsPerGroup);
        const groupAxis = computeAxisStep(nominalCount.x, 0, subplotWidth, elasticParams);
        const groupStep = Math.max(minGroupStep, Math.min(defaultGroupStep, groupAxis.step));
        xStepSize = groupStep;
        xStepUnit = 'group';
    } else if (xIsDiscrete) {
        xStepSize = Math.max(minStepVal, Math.min(defaultStepSize, xAxis.step));
    } else if (xContinuousAsDiscrete > 0) {
        xStepSize = Math.max(minStepVal, Math.min(defaultStepSize, xAxis.step));
    } else {
        xStepSize = defaultStepSize;
    }

    if (yIsDiscrete && yHasGrouping) {
        const itemsPerGroup = nominalCount.group;
        const defaultGroupStep = itemsPerGroup * defaultStepSize;
        const minGroupStep = Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * itemsPerGroup);
        const groupAxis = computeAxisStep(nominalCount.y, 0, subplotHeight, elasticParams);
        const groupStep = Math.max(minGroupStep, Math.min(defaultGroupStep, groupAxis.step));
        yStepSize = groupStep;
        yStepUnit = 'group';
    } else if (yIsDiscrete) {
        yStepSize = Math.max(minStepVal, Math.min(defaultStepSize, yAxis.step));
    } else if (yContinuousAsDiscrete > 0) {
        yStepSize = Math.max(minStepVal, Math.min(defaultStepSize, yAxis.step));
    } else {
        yStepSize = defaultStepSize;
    }

    // --- Banded continuous canvas size ---
    for (const axis of ['x', 'y'] as const) {
        const count = axis === 'x' ? xContinuousAsDiscrete : yContinuousAsDiscrete;
        if (count <= 0) continue;
        const stepSize = axis === 'x' ? xStepSize : yStepSize;
        const continuousSize = Math.round(stepSize * (count + 1));
        if (axis === 'x') {
            subplotWidth = continuousSize;
        } else {
            subplotHeight = continuousSize;
        }
    }

    // --- Unified stretch budget ------------------------------------------------
    // Cap the per-subplot dimensions so total canvas never exceeds
    // canvasWidth × maxStretch (and canvasHeight × maxStretch).
    // Formula: effectiveW = W × maxStretch − fixedPad; each panel costs subplot + gap.
    const maxSubplotW = (defaultChartWidth * maxStretchVal - fixW) / facetCols - gap;
    const maxSubplotH = (defaultChartHeight * maxStretchVal - fixH) / facetRows - gap;

    // Clamp step sizes for discrete/banded axes so VL step-based
    // sizing respects the same budget.
    // When step unit is 'group', divide by the number of groups (nominalCount)
    // rather than the total item count (groups × items-per-group).
    if (xTotalNominalCount > 0) {
        const divisor = xStepUnit === 'group' ? nominalCount.x : xTotalNominalCount;
        const cap = Math.max(minStepVal, Math.floor(maxSubplotW / divisor));
        if (xStepSize > cap) xStepSize = cap;
    }
    if (xContinuousAsDiscrete > 0) {
        const cap = Math.max(minStepVal, Math.floor(maxSubplotW / (xContinuousAsDiscrete + 1)));
        if (xStepSize > cap) xStepSize = cap;
    }
    if (yTotalNominalCount > 0) {
        const divisor = yStepUnit === 'group' ? nominalCount.y : yTotalNominalCount;
        const cap = Math.max(minStepVal, Math.floor(maxSubplotH / divisor));
        if (yStepSize > cap) yStepSize = cap;
    }
    if (yContinuousAsDiscrete > 0) {
        const cap = Math.max(minStepVal, Math.floor(maxSubplotH / (yContinuousAsDiscrete + 1)));
        if (yStepSize > cap) yStepSize = cap;
    }

    // Recompute banded subplot size after step clamping.
    for (const axis of ['x', 'y'] as const) {
        const count = axis === 'x' ? xContinuousAsDiscrete : yContinuousAsDiscrete;
        if (count <= 0) continue;
        const stepSize = axis === 'x' ? xStepSize : yStepSize;
        if (axis === 'x') subplotWidth = Math.round(stepSize * (count + 1));
        else subplotHeight = Math.round(stepSize * (count + 1));
    }

    // Clamp continuous subplot dimensions.
    subplotWidth = Math.min(subplotWidth, Math.round(maxSubplotW));
    subplotHeight = Math.min(subplotHeight, Math.round(maxSubplotH));

    // --- Label sizing ---
    const xHasDiscreteItems = xTotalNominalCount > 0;
    const yHasDiscreteItems = yTotalNominalCount > 0;
    const xLabel = computeLabelSizing(xStepSize, xHasDiscreteItems);
    const yLabel = computeLabelSizing(yStepSize, yHasDiscreteItems);

    return {
        subplotWidth,
        subplotHeight,
        xStep: xStepSize,
        yStep: yStepSize,
        xStepUnit,
        yStepUnit,
        xContinuousAsDiscrete,
        yContinuousAsDiscrete,
        xNominalCount: xTotalNominalCount,
        yNominalCount: yTotalNominalCount,
        xLabel,
        yLabel,
        stepPadding: stepPaddingVal,
        facet: (facetCols > 1 || facetRows > 1) ? {
            columns: facetCols,
            rows: facetRows,
            subplotWidth,
            subplotHeight,
        } : undefined,
        effectiveFacetGap: gap,
        truncations: [],  // Overflow truncations are handled by filterOverflow
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count distinct series (color/detail categories) from channel semantics.
 */
function countDistinctSeries(
    channelSemantics: Record<string, ChannelSemantics>,
    data: any[],
): number {
    const seriesFields: string[] = [];
    const colorField = channelSemantics.color?.field;
    const detailField = channelSemantics.detail?.field;
    if (colorField) seriesFields.push(colorField);
    if (detailField && detailField !== colorField) seriesFields.push(detailField);

    if (seriesFields.length === 0) return 1;

    const seriesKeys = new Set<string>();
    for (const row of data) {
        const key = seriesFields.map(f => String(row[f] ?? '')).join('\x00');
        seriesKeys.add(key);
    }
    return seriesKeys.size;
}

// ---------------------------------------------------------------------------
// Public: computeChannelBudgets
// ---------------------------------------------------------------------------

/**
 * Compute per-channel maximum values that can fit on the canvas.
 *
 * Uses the **most conservative** assumptions:
 *   - minStep  (smallest px per discrete item)
 *   - minSubplotSize (smallest subplot for continuous axes)
 *   - maxStretch (maximum canvas stretching)
 *
 * This is Step 0c-a in the pipeline — it runs before filterOverflow
 * and produces the budgets that filterOverflow consumes.
 *
 * Pipeline:  computeChannelBudgets → filterOverflow → computeLayout
 *
 * @param channelSemantics  Phase 0 output (field, type per channel)
 * @param declaration       Template layout declaration
 * @param data              Full data table (pre-overflow)
 * @param canvasSize        Target canvas dimensions
 * @param options           Assembly options
 * @returns                 ChannelBudgets with per-channel max-to-keep
 */
export function computeChannelBudgets(
    channelSemantics: Record<string, ChannelSemantics>,
    declaration: LayoutDeclaration,
    data: any[],
    canvasSize: { width: number; height: number },
    options: AssembleOptions,
): ChannelBudgets {
    const {
        maxStretch: maxStretchVal = 2,
        minStep: minStepVal = 6,
        stepPadding: stepPaddingVal = 0.1,
        maxColorValues: maxColorVal = 24,
    } = options;

    const fixW = options.facetFixedPadding?.width ?? 0;
    const fixH = options.facetFixedPadding?.height ?? 0;
    const gap  = options.facetGap ?? 0;

    const isDiscreteType = (t: string | undefined) => t === 'nominal' || t === 'ordinal';
    const effectiveType = (ch: string): string | undefined =>
        declaration.resolvedTypes?.[ch] ?? channelSemantics[ch]?.type;

    // --- 1. Facet grid (delegates to computeFacetGrid) ---
    const facetGrid = computeFacetGrid(
        channelSemantics, declaration, data, canvasSize, options,
    );
    const facetCols = facetGrid?.columns ?? 1;
    const facetRows = facetGrid?.rows ?? 1;

    // --- 2. Per-subplot budget at maximum stretch ---
    const maxSubplotW = Math.max(
        options.minSubplotSize ?? 60,
        (canvasSize.width * maxStretchVal - fixW) / facetCols - gap,
    );
    const maxSubplotH = Math.max(
        options.minSubplotSize ?? 60,
        (canvasSize.height * maxStretchVal - fixH) / facetRows - gap,
    );

    // --- 3. Grouping detection ---
    const groupField = channelSemantics.group?.field;
    let groupCount = 0;
    let groupAxis: 'x' | 'y' | undefined;
    if (groupField) {
        groupCount = new Set(data.map(r => r[groupField])).size;
        if (isDiscreteType(effectiveType('x'))) groupAxis = 'x';
        else if (isDiscreteType(effectiveType('y'))) groupAxis = 'y';
    }

    const xGroupMultiplier = (groupAxis === 'x' && groupCount > 1) ? groupCount : 1;
    const yGroupMultiplier = (groupAxis === 'y' && groupCount > 1) ? groupCount : 1;

    const MIN_GROUP_GAP_PX = 3;
    const xMinGroupStep = xGroupMultiplier > 1
        ? Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * xGroupMultiplier)
        : minStepVal;
    const yMinGroupStep = yGroupMultiplier > 1
        ? Math.max(Math.ceil(MIN_GROUP_GAP_PX / stepPaddingVal), 2 * yGroupMultiplier)
        : minStepVal;

    // --- 4. Per-channel budgets ---
    const maxXToKeep = Math.floor(maxSubplotW / xMinGroupStep);
    const maxYToKeep = Math.floor(maxSubplotH / yMinGroupStep);

    const hasRow = !!channelSemantics.row?.field;
    const maxFacetColumns = facetGrid?.maxColumnValues ?? Infinity;
    const maxFacetRows    = facetGrid?.maxRowValues ?? Infinity;
    const maxFacetTotal   = facetGrid
        ? maxFacetColumns * (facetGrid.maxRowValues ?? 1)
        : Infinity;

    const maxValues: Record<string, number> = {
        x:      maxXToKeep,
        y:      maxYToKeep,
        column: hasRow ? maxFacetColumns : maxFacetTotal,
        row:    maxFacetRows,
        color:  maxColorVal,
    };

    return { maxValues, facetGrid };
}

// ---------------------------------------------------------------------------
// Public: computeFacetGrid
// ---------------------------------------------------------------------------

/**
 * Decide the facet grid layout (including column-only wrapping).
 *
 * This runs BEFORE filterOverflow and computeLayout.  It:
 *   1. Counts unique column/row values from data.
 *   2. Computes banded-aware minimum subplot dimensions.
 *   3. Computes max columns/rows that fit in the canvas budget.
 *   4. For column-only: wraps into a 2D grid (total panels = cols × rows).
 *   5. For column+row: caps each dimension independently.
 *
 * Returns `undefined` when there are no facet channels.
 *
 * @param channelSemantics  Phase 0 output
 * @param declaration       Template layout declaration
 * @param data              Data rows (pre-overflow — possibly after temporal conversion)
 * @param canvasSize        Target canvas dimensions
 * @param options           Assembly options
 */
export function computeFacetGrid(
    channelSemantics: Record<string, ChannelSemantics>,
    declaration: LayoutDeclaration,
    data: any[],
    canvasSize: { width: number; height: number },
    options: AssembleOptions,
): import('./types').FacetGridResult | undefined {
    const { maxStretch: ms = 2 } = options;
    const fixW = options.facetFixedPadding?.width ?? 0;
    const fixH = options.facetFixedPadding?.height ?? 0;
    const gap  = options.facetGap ?? 0;
    const minStep = options.minStep ?? 6;
    const stepPadding = options.stepPadding ?? 0.1;
    const baseMinSubplot = options.minSubplotSize ?? 60;

    const isDiscreteType = (t: string | undefined) => t === 'nominal' || t === 'ordinal';

    // --- Compute min subplot size per axis ---
    //
    // Continuous:  baseMinSubplot (e.g. 60px).
    //
    // Discrete (not grouped):
    //   min(minStep × valueCount, maxDim)
    //
    // Discrete (grouped):
    //   perCategoryStep = max(minStep × groupCount, minGroupStep)
    //   min(perCategoryStep × valueCount, maxDim)
    //
    //   where minGroupStep accounts for the inter-group gap:
    //     the gap = stepPadding × step, which must be ≥ MIN_GROUP_GAP_PX.
    //
    // Always capped at maxDim (full stretched canvas minus fixed overhead)
    // to guarantee at least 1 facet column/row.

    const maxW = canvasSize.width * ms - fixW;
    const maxH = canvasSize.height * ms - fixH;
    const MIN_GROUP_GAP_PX = 3;

    // Grouping detection
    const groupField = channelSemantics.group?.field;
    let groupCount = 0;
    let groupAxis: 'x' | 'y' | undefined;
    if (groupField) {
        groupCount = new Set(data.map((r: any) => r[groupField])).size;
        const xType = declaration.resolvedTypes?.x ?? channelSemantics.x?.type;
        const yType = declaration.resolvedTypes?.y ?? channelSemantics.y?.type;
        if (isDiscreteType(xType)) groupAxis = 'x';
        else if (isDiscreteType(yType)) groupAxis = 'y';
    }

    let minSubplotWidth = baseMinSubplot;
    let minSubplotHeight = baseMinSubplot;

    // Log-scale axes need more space for minor grid lines to be legible.
    const LOG_PX_PER_DECADE_FACET = 40;
    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (!cs?.field || !cs.scaleType) continue;
        if (cs.scaleType !== 'log' && cs.scaleType !== 'symlog') continue;
        const vals = data
            .map((r: any) => r[cs.field])
            .filter((v: any) => typeof v === 'number' && v > 0 && isFinite(v));
        if (vals.length < 2) continue;
        const decades = Math.log10(Math.max(...vals)) - Math.log10(Math.min(...vals));
        const needed = Math.ceil(Math.max(1, decades)) * LOG_PX_PER_DECADE_FACET;
        if (axis === 'x') minSubplotWidth = Math.max(minSubplotWidth, needed);
        else minSubplotHeight = Math.max(minSubplotHeight, needed);
    }

    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (!cs?.field) continue;

        const effectiveType = declaration.resolvedTypes?.[axis] ?? cs.type;
        const isBanded = declaration.axisFlags?.[axis]?.banded === true;
        if (!isDiscreteType(effectiveType) && !isBanded) continue;

        const valueCount = new Set(data.map((r: any) => r[cs.field])).size;
        const axisGroupCount = (groupAxis === axis && groupCount > 1) ? groupCount : 1;
        const maxDim = axis === 'x' ? maxW : maxH;

        let perCategoryStep: number;
        if (axisGroupCount > 1) {
            // Grouped: each category needs room for groupCount sub-items
            // PLUS enough inter-group gap (stepPadding × step ≥ MIN_GROUP_GAP_PX).
            const minGroupStep = Math.max(
                Math.ceil(MIN_GROUP_GAP_PX / stepPadding),
                2 * axisGroupCount,
            );
            perCategoryStep = Math.max(minStep * axisGroupCount, minGroupStep);
        } else {
            // Ungrouped: one item per category
            perCategoryStep = minStep;
        }

        const dataDrivenMin = Math.min(perCategoryStep * valueCount, maxDim);
        const minDim = Math.max(baseMinSubplot, dataDrivenMin);

        if (axis === 'x') {
            minSubplotWidth = minDim;
        } else {
            minSubplotHeight = minDim;
        }
    }

    // effectiveW = totalBudget - fixedOverhead; each panel costs (subplot + gap).
    const effectiveW = maxW;
    const effectiveH = maxH;
    const maxFacetColumns = Math.max(1, Math.floor(
        effectiveW / (minSubplotWidth + gap),
    ));
    const maxFacetRows = Math.max(1, Math.floor(
        effectiveH / (minSubplotHeight + gap),
    ));

    // Identify column/row fields
    const colField = channelSemantics.column?.field;
    const rowField = channelSemantics.row?.field;
    if (!colField && !rowField) return undefined;

    const colCount = colField
        ? new Set(data.map((r: any) => r[colField])).size : 0;
    const rowCount = rowField
        ? new Set(data.map((r: any) => r[rowField])).size : 0;

    if (colCount === 0 && rowCount === 0) return undefined;

    if (colCount > 0 && rowCount === 0) {
        // Column-only: 2D budget for total panels, wrap visually.
        const maxTotalPanels = maxFacetColumns * maxFacetRows;
        const effectiveCount = Math.min(colCount, maxTotalPanels);
        // Balanced wrapping: compute rows first, then distribute evenly.
        // e.g. 10 items, max 6/row → 2 rows of 5 instead of 6+4.
        const visRows = Math.ceil(effectiveCount / maxFacetColumns);
        const visCols = Math.ceil(effectiveCount / visRows);
        return {
            columns: visCols,
            rows: visRows,
            maxColumnValues: maxTotalPanels,
            maxRowValues: maxFacetRows,
        };
    }

    // Column+row or row-only: cap each dimension independently.
    return {
        columns: Math.max(1, Math.min(colCount, maxFacetColumns)),
        rows: Math.max(1, Math.min(rowCount, maxFacetRows)),
        maxColumnValues: maxFacetColumns,
        maxRowValues: maxFacetRows,
    };
}

// ---------------------------------------------------------------------------
// Public: computeMinSubplotDimensions
// ---------------------------------------------------------------------------

/**
 * Compute minimum subplot dimensions considering banded and discrete axes.
 *
 * For banded axes (e.g. temporal x on candlestick), each data point needs
 * `minStep` px, so the subplot minimum can be much larger than the generic
 * `minSubplotSize` (60px).  For discrete axes, the count of unique values
 * drives the minimum similarly.
 *
 * This is used by both filterOverflow (pre-layout) and the assemblers
 * (post-layout) to consistently compute facet column/row caps.
 *
 * @param channelSemantics  Phase 0 output (field, type per channel)
 * @param declaration       Template layout declaration (axisFlags, resolvedTypes)
 * @param data              Data rows
 * @param options           Assembly options ({ minStep, minSubplotSize })
 * @returns                 { minSubplotWidth, minSubplotHeight }
 */
export function computeMinSubplotDimensions(
    channelSemantics: Record<string, ChannelSemantics>,
    declaration: LayoutDeclaration,
    data: any[],
    options: { minStep?: number; minSubplotSize?: number },
): { minSubplotWidth: number; minSubplotHeight: number } {
    const minStep = options.minStep ?? 6;
    const minSubplot = options.minSubplotSize ?? 60;

    let minSubplotWidth = minSubplot;
    let minSubplotHeight = minSubplot;

    // Log-scale axes need more space so minor grid lines stay legible.
    const LOG_PX_PER_DECADE_MIN = 40;
    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (!cs?.field || !cs.scaleType) continue;
        if (cs.scaleType !== 'log' && cs.scaleType !== 'symlog') continue;
        const vals = data
            .map((r: any) => r[cs.field])
            .filter((v: any) => typeof v === 'number' && v > 0 && isFinite(v));
        if (vals.length < 2) continue;
        const decades = Math.log10(Math.max(...vals)) - Math.log10(Math.min(...vals));
        const needed = Math.ceil(Math.max(1, decades)) * LOG_PX_PER_DECADE_MIN;
        if (axis === 'x') minSubplotWidth = Math.max(minSubplotWidth, needed);
        else minSubplotHeight = Math.max(minSubplotHeight, needed);
    }

    const isDiscreteType = (t: string | undefined) =>
        t === 'nominal' || t === 'ordinal';

    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (!cs?.field) continue;

        const effectiveType = declaration.resolvedTypes?.[axis] ?? cs.type;
        const isBanded = declaration.axisFlags?.[axis]?.banded === true;
        const isDiscrete = isDiscreteType(effectiveType);

        let itemCount = 0;
        if (isBanded || isDiscrete) {
            itemCount = new Set(data.map((r: any) => r[cs.field])).size;
        }

        if (itemCount > 0) {
            const minDim = Math.max(minSubplot, itemCount * minStep);
            if (axis === 'x') {
                minSubplotWidth = Math.max(minSubplotWidth, minDim);
            } else {
                minSubplotHeight = Math.max(minSubplotHeight, minDim);
            }
        }
    }

    return { minSubplotWidth, minSubplotHeight };
}
