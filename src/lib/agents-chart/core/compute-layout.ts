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
 */
export function computeLayout(
    channelSemantics: Record<string, ChannelSemantics>,
    declaration: LayoutDeclaration,
    table: any[],
    canvasSize: { width: number; height: number },
    options: AssembleOptions = {},
): LayoutResult {
    const {
        elasticity: elasticityVal = 0.5,
        maxStretch: maxStretchVal = 2,
        facetElasticity: facetElasticityVal = 0.3,
        facetMaxStretch: facetMaxStretchVal = 1.5,
        minStep: minStepVal = 6,
        minSubplotSize: minSubplotVal = 60,
        defaultStepMultiplier = 1,
        stepPadding: stepPaddingVal = 0.1,
        maintainContinuousAxisRatio = false,
        continuousMarkCrossSection,
    } = options;

    const defaultChartWidth = canvasSize.width;
    const defaultChartHeight = canvasSize.height;

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
    const xMinGroupStep = xGroupMultiplier > 1 ? 2 * xGroupMultiplier : minStepVal;
    const yMinGroupStep = yGroupMultiplier > 1 ? 2 * yGroupMultiplier : minStepVal;

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
            count = typeof binDef === 'object' && binDef.maxbins
                ? binDef.maxbins : 6;
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
    let facetCols = 1;
    let facetRows = 1;
    if (nominalCount.column > 0) facetCols = nominalCount.column;
    if (nominalCount.row > 0) facetRows = nominalCount.row;

    // --- Facet subplot sizing ---
    const minContinuousSize = Math.max(10, minStepVal);

    let subplotWidth: number;
    if (facetCols > 1) {
        const stretch = Math.min(facetMaxStretchVal, Math.pow(facetCols, facetElasticityVal));
        subplotWidth = Math.round(Math.max(minContinuousSize, defaultChartWidth * stretch / facetCols));
    } else {
        subplotWidth = defaultChartWidth;
    }

    let subplotHeight: number;
    if (facetRows > 1) {
        const stretch = Math.min(facetMaxStretchVal, Math.pow(facetRows, facetElasticityVal));
        subplotHeight = Math.round(Math.max(minContinuousSize, defaultChartHeight * stretch / facetRows));
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
        const minGroupStep = 2 * itemsPerGroup;
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
        const minGroupStep = 2 * itemsPerGroup;
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
