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
        stepPadding: stepPaddingVal = 0.1,
        maintainContinuousAxisRatio = false,
        continuousMarkCrossSection,
        facetAspectRatioResistance = 0,
    } = options;

    const defaultChartWidth = canvasSize.width;
    const defaultChartHeight = canvasSize.height;

    // Facet overhead: fixed (axis labels, titles) + per-panel gap (spacing).
    const fixW = options.facetFixedPadding?.width ?? 0;
    const fixH = options.facetFixedPadding?.height ?? 0;
    const gap  = options.facetGap ?? 0;

    const baseRefSize = 300;
    const sizeRatio = Math.max(defaultChartWidth, defaultChartHeight) / baseRefSize;
    const baseBandSize = options.defaultBandSize ?? 20;
    const defaultStepSize = Math.round(baseBandSize * Math.max(1, sizeRatio));

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

    // --- Facet aspect-ratio resistance (non-gas-pressure charts) ---
    // When faceting compresses one dimension (e.g. width ÷ columns), the
    // aspect ratio drifts.  Line/area charts are very sensitive to this.
    // For charts entering the 2D gas pressure path, AR resistance is
    // handled inside the ideal-then-squeeze logic below. This block
    // only applies when both axes are NOT continuous-non-banded.
    const xIsContinuousNonBanded = xTotalNominalCount === 0 && xContinuousAsDiscrete === 0;
    const yIsContinuousNonBanded = yTotalNominalCount === 0 && yContinuousAsDiscrete === 0;
    const bothContinuousNonBanded = xIsContinuousNonBanded && yIsContinuousNonBanded;

    if (facetAspectRatioResistance > 0 && !bothContinuousNonBanded
        && (facetCols > 1 || facetRows > 1)) {
        const baseAR = defaultChartWidth / defaultChartHeight;
        const facetAR = subplotWidth / subplotHeight;
        const arDrift = facetAR / baseAR; // <1 when panel got relatively narrower

        if (arDrift < 1) {
            // Panel is narrower than base → shrink height to compensate
            subplotHeight = Math.round(
                Math.max(minContinuousSizeY, subplotHeight * Math.pow(arDrift, facetAspectRatioResistance)),
            );
        } else if (arDrift > 1) {
            // Panel is wider than base → shrink width to compensate
            subplotWidth = Math.round(
                Math.max(minContinuousSizeX, subplotWidth * Math.pow(1 / arDrift, facetAspectRatioResistance)),
            );
        }
    }

    // --- Gas pressure stretch for continuous non-banded axes ---
    //
    // Design: per-subplot baseline → pressure → AR blend → fit.
    //
    //   Baseline: each subplot gets a fair share of the canvas with
    //             facet elasticity applied (cols^e / cols).
    //   Step 1 — Gas pressure measures crowding against the per-subplot
    //            baseline and produces per-axis raw stretches.
    //   Step 2 — Decide AR: blend gas-pressure AR (density asymmetry)
    //            with banking AR (perceptual slope optimization) in
    //            log space.  Distribute gas-pressure area into the
    //            blended AR.
    //   Step 3 — Fit into budget: uniform scale-down so neither axis
    //            exceeds maxStretch, preserving the AR.

    if (bothContinuousNonBanded) {
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

                // Expand to visual domain (include zero when axis starts at zero).
                const xDomain: [number, number] = [xMin, xMax];
                const yDomain: [number, number] = [yMin, yMax];
                if (xCS.zero?.zero) {
                    if (xDomain[0] > 0) xDomain[0] = 0;
                    if (xDomain[1] < 0) xDomain[1] = 0;
                }
                if (yCS.zero?.zero) {
                    if (yDomain[0] > 0) yDomain[0] = 0;
                    if (yDomain[1] < 0) yDomain[1] = 0;
                }

                // Data-coverage guard: skip banking when zero dominates.
                const xDataCoverage = (xDomain[1] - xDomain[0]) > 0
                    ? (xMax - xMin) / (xDomain[1] - xDomain[0]) : 1;
                const yDataCoverage = (yDomain[1] - yDomain[0]) > 0
                    ? (yMax - yMin) / (yDomain[1] - yDomain[0]) : 1;
                const BANKING_COVERAGE_THRESHOLD = 0.2;

                // --- Gas pressure params ---
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

                // --- Per-subplot baseline canvas ---
                // Gas pressure must measure crowding against the actual
                // per-subplot space, not the full canvas.  When faceted,
                // each subplot gets a share of the canvas that includes
                // facet elasticity (the same formula used for discrete
                // axes): `canvas × cols^elasticity / cols`.  This way
                // 2 columns don't naively halve the space — some stretch
                // is assumed before gas pressure even kicks in.
                const perSubplotCanvasW = facetCols > 1
                    ? Math.max(minContinuousSizeX,
                        (defaultChartWidth * Math.min(maxStretchVal, Math.pow(facetCols, facetElasticityVal)) - fixW)
                            / facetCols - gap)
                    : defaultChartWidth;
                const perSubplotCanvasH = facetRows > 1
                    ? Math.max(minContinuousSizeY,
                        (defaultChartHeight * Math.min(maxStretchVal, Math.pow(facetRows, facetElasticityVal)) - fixH)
                            / facetRows - gap)
                    : defaultChartHeight;

                // --- Gas pressure: per-axis raw stretches ---
                const idealResult = computeGasPressure(
                    xNumeric, yNumeric, xDomain, yDomain,
                    perSubplotCanvasW, perSubplotCanvasH, gasPressureParams,
                );

                const isConnected = typeof continuousMarkCrossSection === 'object'
                    && !!continuousMarkCrossSection.seriesCountAxis;
                const useBanking = xDataCoverage >= BANKING_COVERAGE_THRESHOLD
                    && yDataCoverage >= BANKING_COVERAGE_THRESHOLD;

                let idealW: number;
                let idealH: number;

                // Gas pressure's native per-axis dimensions (uncapped).
                const rawW = perSubplotCanvasW * idealResult.rawStretchX;
                const rawH = perSubplotCanvasH * idealResult.rawStretchY;

                if (useBanking) {
                    // ── Step 1: Decide AR ──────────────────────────────
                    // Blend gas-pressure AR (which axis is more crowded)
                    // with banking AR (perceptual slope optimization).
                    const seriesFields: string[] = [];
                    const colorField = channelSemantics.color?.field;
                    const detailField = channelSemantics.detail?.field;
                    if (colorField) seriesFields.push(colorField);
                    if (detailField && detailField !== colorField) seriesFields.push(detailField);

                    const perPointSeriesKeys: string[] = new Array(xNumeric.length);
                    if (seriesFields.length === 0) {
                        perPointSeriesKeys.fill('');
                    } else {
                        let idx = 0;
                        for (const row of table) {
                            const xv = xCS?.field ? row[xCS.field] : undefined;
                            const yv = yCS?.field ? row[yCS.field] : undefined;
                            if (xv == null || yv == null) continue;
                            const xn = isTempX ? +new Date(xv) : +xv;
                            const yn = isTempY ? +new Date(yv) : +yv;
                            if (isNaN(xn) || isNaN(yn)) continue;
                            perPointSeriesKeys[idx++] = seriesFields
                                .map(f => String(row[f] ?? '')).join('\x00');
                        }
                    }

                    const bankingAR = computeBankingAR(
                        xNumeric, yNumeric, xDomain, yDomain,
                        perPointSeriesKeys, isConnected,
                    );

                    // ── Step 2: Blend AR + distribute area ────────────
                    // Gas pressure knows which axis is crowded (per-axis
                    // stretch).  Banking knows the perceptual ideal AR.
                    // Blend in log space so both signals contribute:
                    //   gasAR reflects density asymmetry (X crowded → landscape)
                    //   bankingAR reflects slope perception
                    const BANKING_BLEND = 0.5;
                    const gasAR = rawW / rawH;
                    const blendedAR = gasAR > 0 && bankingAR > 0
                        ? Math.exp((1 - BANKING_BLEND) * Math.log(gasAR)
                            + BANKING_BLEND * Math.log(bankingAR))
                        : bankingAR;

                    // Total area from gas pressure (capped so subplot
                    // doesn't blow past per-subplot budget before fit).
                    const rawArea = rawW * rawH;
                    const maxArea = perSubplotCanvasW * perSubplotCanvasH * maxStretchVal;
                    const area = Math.min(rawArea, maxArea);

                    idealW = Math.sqrt(area * blendedAR);
                    idealH = Math.sqrt(area / blendedAR);
                } else {
                    // Banking skipped (zero dominates): gas pressure shape.
                    idealW = rawW;
                    idealH = rawH;
                }

                // ── Step 3: Fit into budget, preserving AR ───────────
                // Hard ceiling per subplot: canvas × maxStretch shared
                // across facet panels.
                const availW = facetCols > 1
                    ? Math.max(minContinuousSizeX, (defaultChartWidth * maxStretchVal - fixW) / facetCols - gap)
                    : defaultChartWidth * maxStretchVal;
                const availH = facetRows > 1
                    ? Math.max(minContinuousSizeY, (defaultChartHeight * maxStretchVal - fixH) / facetRows - gap)
                    : defaultChartHeight * maxStretchVal;

                // Scale down to fit: if either axis exceeds its budget,
                // shrink both axes by the tighter ratio so neither
                // exceeds AND the AR is preserved.
                const scaleX = idealW > availW ? availW / idealW : 1;
                const scaleY = idealH > availH ? availH / idealH : 1;
                const fitScale = Math.min(scaleX, scaleY);

                let finalW = idealW * fitScale;
                let finalH = idealH * fitScale;

                // Enforce minimums (may slightly distort AR at extremes).
                finalW = Math.max(finalW, minContinuousSizeX);
                finalH = Math.max(finalH, minContinuousSizeY);

                subplotWidth = Math.round(finalW);
                subplotHeight = Math.round(finalH);
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

    // --- Nominal discrete subplot sizing ---
    // For nominal discrete axes, one backend (VL) overrides subplotWidth
    // with step-based sizing (width:{step:N}), so the subplot dimension
    // doesn't matter.  Other backends (Chart.js, ECharts) fill the canvas
    // and divide evenly among categories — for them, the subplot dimension
    // IS the canvas width.
    //
    // Ensure the subplot is at least as wide as canvasSize (the user's
    // requested chart size) so backends that fill the canvas get generous
    // bars when there are few categories.  The subplot only exceeds
    // canvasSize when faceting shrinks it, which is already handled above.

    // Clamp continuous subplot dimensions.
    subplotWidth = Math.min(subplotWidth, Math.round(maxSubplotW));
    subplotHeight = Math.min(subplotHeight, Math.round(maxSubplotH));

    // --- Band AR blending ---
    // When one axis is banded (discrete) and the other is continuous,
    // each band has a natural AR = continuousSize / stepSize.  If the
    // actual band AR exceeds the target, blend the subplot AR toward
    // the target (in log space) to avoid excessively tall/wide bands.
    const targetBandAR = options.targetBandAR;
    if (targetBandAR && targetBandAR > 0) {
        const xIsBanded = xTotalNominalCount > 0 || xContinuousAsDiscrete > 0;
        const yIsBanded = yTotalNominalCount > 0 || yContinuousAsDiscrete > 0;

        if (xIsBanded && !yIsBanded) {
            // X is banded, Y is continuous → band AR = subplotHeight / xStepSize
            const actualBandAR = subplotHeight / xStepSize;
            if (actualBandAR > targetBandAR) {
                const idealH = xStepSize * targetBandAR;
                // Blend: 50/50 between actual and target in log space.
                const blendedH = Math.exp(
                    0.5 * Math.log(subplotHeight) + 0.5 * Math.log(idealH));
                subplotHeight = Math.round(
                    Math.max(minContinuousSizeY, Math.min(blendedH, subplotHeight)));
            }
        } else if (yIsBanded && !xIsBanded) {
            // Y is banded, X is continuous → band AR = subplotWidth / yStepSize
            const actualBandAR = subplotWidth / yStepSize;
            if (actualBandAR > targetBandAR) {
                const idealW = yStepSize * targetBandAR;
                const blendedW = Math.exp(
                    0.5 * Math.log(subplotWidth) + 0.5 * Math.log(idealW));
                subplotWidth = Math.round(
                    Math.max(minContinuousSizeX, Math.min(blendedW, subplotWidth)));
            }
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

/**
 * Compute the ideal aspect ratio for a both-continuous chart.
 *
 * Dispatches to two strategies depending on mark type:
 *
 * - **Scatter / point** (`isConnected = false`): Uses the normalized
 *   standard-deviation ratio of the point cloud — a unit-independent
 *   shape measure.  Dampened 0.3× toward 1.0 so scatter stays near
 *   square.
 *
 * - **Connected marks** (line/area/bump, `isConnected = true`): Uses
 *   multi-scale banking to 45° (Heer & Agrawala 2006).  Slopes are
 *   computed at multiple octave-band smoothing levels and combined via
 *   geometric mean so that trend, periodicity, and noise each
 *   contribute proportionally — avoiding the dense-data failure mode
 *   of Cleveland's single-scale median.
 *
 * @param xValues     Numeric X values
 * @param yValues     Numeric Y values (parallel array)
 * @param xDomain     [min, max] of the visual X axis
 * @param yDomain     [min, max] of the visual Y axis
 * @param seriesKeys  Per-point series key ('' if no series)
 * @param isConnected Whether the mark connects points (line/area vs scatter)
 * @returns Ideal AR (width/height). Clamped to [0.5, 3.0].
 */
function computeBankingAR(
    xValues: number[],
    yValues: number[],
    xDomain: [number, number],
    yDomain: [number, number],
    seriesKeys: string[],
    isConnected: boolean,
): number {
    const MIN_AR = 0.5;
    const MAX_AR = 3.0;

    const xRange = xDomain[1] - xDomain[0];
    const yRange = yDomain[1] - yDomain[0];
    if (xRange <= 0 || yRange <= 0) return 1;

    // ── Scatter: σ-ratio ──────────────────────────────────────────────
    if (!isConnected) {
        const n = xValues.length;
        let sumX = 0, sumY = 0;
        for (let i = 0; i < n; i++) {
            sumX += (xValues[i] - xDomain[0]) / xRange;
            sumY += (yValues[i] - yDomain[0]) / yRange;
        }
        const meanX = sumX / n;
        const meanY = sumY / n;
        let varX = 0, varY = 0;
        for (let i = 0; i < n; i++) {
            const dx = (xValues[i] - xDomain[0]) / xRange - meanX;
            const dy = (yValues[i] - yDomain[0]) / yRange - meanY;
            varX += dx * dx;
            varY += dy * dy;
        }
        const sdX = Math.sqrt(varX / n);
        const sdY = Math.sqrt(varY / n);
        if (sdY <= 0) return MAX_AR;
        if (sdX <= 0) return MIN_AR;

        const sdRatio = sdX / sdY;
        const ar = sdRatio > 1
            ? 1 + (sdRatio - 1) * 0.3
            : 1 - (1 - sdRatio) * 0.3;
        return Math.min(MAX_AR, Math.max(MIN_AR, ar));
    }

    // ── Connected marks: multi-scale banking (Heer & Agrawala 2006) ──

    // Group by series and sort by X.
    const seriesMap = new Map<string, { x: number; y: number }[]>();
    for (let i = 0; i < xValues.length; i++) {
        const key = seriesKeys[i];
        let arr = seriesMap.get(key);
        if (!arr) { arr = []; seriesMap.set(key, arr); }
        arr.push({ x: xValues[i], y: yValues[i] });
    }
    for (const pts of seriesMap.values()) {
        pts.sort((a, b) => a.x - b.x);
    }

    // Collect per-scale median absolute slopes, then combine with
    // geometric mean across scales.  Each scale is a box-filter
    // smoothing at window width 2^k (k = 0, 1, 2, …).
    // Scale 0 = raw data (Cleveland's original).
    const scaleMedians: number[] = [];

    // Determine max scale: largest power of 2 that still leaves ≥ 3
    // points in the longest series after smoothing.
    let maxSeriesLen = 0;
    for (const pts of seriesMap.values()) {
        if (pts.length > maxSeriesLen) maxSeriesLen = pts.length;
    }
    const maxScale = Math.max(0, Math.floor(Math.log2(maxSeriesLen)) - 1);

    for (let scale = 0; scale <= maxScale; scale++) {
        const windowSize = 1 << scale;  // 1, 2, 4, 8, …
        const absSlopes: number[] = [];

        for (const pts of seriesMap.values()) {
            // Smooth: non-overlapping bucket averages of `windowSize` points.
            // The last bucket may be smaller — included as-is.
            const n = pts.length;
            if (n < 2) continue;

            const smoothed: { x: number; y: number }[] = [];
            for (let i = 0; i < n; i += windowSize) {
                const end = Math.min(i + windowSize, n);
                let sx = 0, sy = 0;
                for (let j = i; j < end; j++) {
                    sx += pts[j].x;
                    sy += pts[j].y;
                }
                const cnt = end - i;
                smoothed.push({ x: sx / cnt, y: sy / cnt });
            }

            // Compute slopes between consecutive smoothed points.
            for (let i = 1; i < smoothed.length; i++) {
                const dx = (smoothed[i].x - smoothed[i - 1].x) / xRange;
                const dy = (smoothed[i].y - smoothed[i - 1].y) / yRange;
                if (dx === 0) continue;
                absSlopes.push(Math.abs(dy / dx));
            }
        }

        if (absSlopes.length === 0) continue;

        // Median absolute slope at this scale.
        absSlopes.sort((a, b) => a - b);
        const mid = absSlopes.length >> 1;
        const median = absSlopes.length % 2 === 1
            ? absSlopes[mid]
            : (absSlopes[mid - 1] + absSlopes[mid]) / 2;
        if (median > 0) {
            scaleMedians.push(median);
        }
    }

    if (scaleMedians.length === 0) return 1;

    // Geometric mean of per-scale median slopes.
    // This gives equal weight to each octave band: trend (coarse),
    // periodicity (middle), and noise (fine) all contribute.
    let logSum = 0;
    for (const m of scaleMedians) {
        logSum += Math.log(m);
    }
    const combinedSlope = Math.exp(logSum / scaleMedians.length);

    if (combinedSlope <= 0) return MAX_AR;

    // Banking to 45°: display_slope = s_norm × (H/W).
    // For median |display_slope| = 1:  H/W = 1/median(|s_norm|),
    // so W/H = median(|s_norm|) = combinedSlope.
    //
    // No dampening here — the caller (computeLayout) blends banking AR
    // with gas-pressure AR at 50/50, which already moderates it.
    // Applying dampening on top of the blend would double-moderate.

    // Landscape floor for connected marks: time series, line charts,
    // and area charts are conventionally landscape.  Banking can push
    // wider (when slopes are steep) but never portrait — the gentle-
    // slope majority in typical time series would otherwise dominate
    // the median and produce portrait, compressing the time axis.
    const ar = Math.max(1.0, combinedSlope);
    return Math.min(MAX_AR, Math.max(MIN_AR, ar));
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
    let maxXToKeep = Math.floor(maxSubplotW / xMinGroupStep);
    let maxYToKeep = Math.floor(maxSubplotH / yMinGroupStep);

    // --- 5. Faceted-chart canvas cap ---
    // When a busy discrete axis makes each subplot wider than the
    // un-stretched canvas, cap axis items to fit within one canvas
    // width/height.  This lets subplots be narrower, potentially fitting
    // more facet columns — reducing overall chart height.
    //
    // Example: 70 counties on X × 20 states on column.  Without the cap,
    // minSubplotWidth = 70 × 6 = 420 → only 1 facet column fits → each
    // state stacks vertically → excessively tall chart.  With the cap,
    // X is truncated to floor(400/6) = 66 items, and the facet grid is
    // re-derived with narrower subplots so more columns fit.
    if (facetGrid) {
        const canvasXCap = Math.max(1, Math.floor(canvasSize.width / xMinGroupStep));
        const canvasYCap = Math.max(1, Math.floor(canvasSize.height / yMinGroupStep));

        if (maxXToKeep > canvasXCap || maxYToKeep > canvasYCap) {
            maxXToKeep = Math.min(maxXToKeep, canvasXCap);
            maxYToKeep = Math.min(maxYToKeep, canvasYCap);

            // With tighter axis items, subplots can be narrower, so more
            // facet columns may fit.  Re-derive the grid for column-only
            // wrapping (the most affected case).
            const colField = channelSemantics.column?.field;
            const rowField = channelSemantics.row?.field;
            const colCount = colField
                ? new Set(data.map(r => r[colField])).size : 0;

            if (colCount > 1 && !rowField) {
                const tighterW = Math.max(
                    options.minSubplotSize ?? 60,
                    maxXToKeep * xMinGroupStep,
                );
                const totalW = canvasSize.width * maxStretchVal - fixW;
                const totalH = canvasSize.height * maxStretchVal - fixH;
                const revisedMaxCols = Math.max(1, Math.floor(
                    totalW / (tighterW + gap),
                ));
                const revisedMaxRows = Math.max(1, Math.floor(
                    totalH / ((options.minSubplotSize ?? 60) + gap),
                ));
                const maxTotal = revisedMaxCols * revisedMaxRows;
                const effectiveCount = Math.min(colCount, maxTotal);
                const visRows = Math.ceil(effectiveCount / revisedMaxCols);
                const visCols = Math.ceil(effectiveCount / visRows);

                facetGrid.columns = visCols;
                facetGrid.rows = visRows;
                facetGrid.maxColumnValues = maxTotal;
            }
        }
    }

    // maxColumnValues already carries the correct semantics for both
    // column+row (per-dimension cap) and column-only wrapping (total
    // panel count = grid cols × grid rows).  No multiplication needed.
    const maxValues: Record<string, number> = {
        x:      maxXToKeep,
        y:      maxYToKeep,
        column: facetGrid?.maxColumnValues ?? Infinity,
        row:    facetGrid?.maxRowValues ?? Infinity,
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

    // --- Continuous axes: AR-based min subplot size ---
    // When both axes are continuous (non-banded), the expected aspect
    // ratio tells us which axis needs more room.  The shorter dimension
    // stays at baseMinSubplot; the longer gets up to ms× (maxStretch)
    // of the base.  This ensures line charts (landscape AR) get wider
    // min subplots, so maxFacetColumns is lower → fewer, wider panels.
    const xIsCont = (() => {
        const cs = channelSemantics.x;
        if (!cs?.field) return false;
        const t = declaration.resolvedTypes?.x ?? cs.type;
        return !isDiscreteType(t) && !(declaration.axisFlags?.x?.banded === true);
    })();
    const yIsCont = (() => {
        const cs = channelSemantics.y;
        if (!cs?.field) return false;
        const t = declaration.resolvedTypes?.y ?? cs.type;
        return !isDiscreteType(t) && !(declaration.axisFlags?.y?.banded === true);
    })();

    if (xIsCont && yIsCont) {
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        if (xCS?.field && yCS?.field) {
            const isTempX = (declaration.resolvedTypes?.x ?? xCS.type) === 'temporal';
            const isTempY = (declaration.resolvedTypes?.y ?? yCS.type) === 'temporal';
            const cmcs = options.continuousMarkCrossSection;
            const isConn = typeof cmcs === 'object' && !!cmcs.seriesCountAxis;

            const xNum: number[] = [];
            const yNum: number[] = [];
            const sKeys: string[] = [];
            const sFields: string[] = [];
            // Include facet fields in series keys so banking computes
            // slopes within each panel, not across panel boundaries.
            const colF = channelSemantics.column?.field;
            const rowF = channelSemantics.row?.field;
            if (colF) sFields.push(colF);
            if (rowF) sFields.push(rowF);
            const cf = channelSemantics.color?.field;
            const df = channelSemantics.detail?.field;
            if (cf) sFields.push(cf);
            if (df && df !== cf) sFields.push(df);

            for (const row of data) {
                let xv = row[xCS.field];
                let yv = row[yCS.field];
                if (xv == null || yv == null) continue;
                const xn = isTempX ? +new Date(xv) : +xv;
                const yn = isTempY ? +new Date(yv) : +yv;
                if (isNaN(xn) || isNaN(yn)) continue;
                xNum.push(xn);
                yNum.push(yn);
                sKeys.push(sFields.length > 0
                    ? sFields.map(f => String(row[f] ?? '')).join('\x00')
                    : '');
            }

            if (xNum.length > 1) {
                const xMin = Math.min(...xNum);
                const xMax = Math.max(...xNum);
                const yMin = Math.min(...yNum);
                const yMax = Math.max(...yNum);
                const xDom: [number, number] = [xMin, xMax];
                const yDom: [number, number] = [yMin, yMax];
                if (xCS.zero?.zero) {
                    if (xDom[0] > 0) xDom[0] = 0;
                    if (xDom[1] < 0) xDom[1] = 0;
                }
                if (yCS.zero?.zero) {
                    if (yDom[0] > 0) yDom[0] = 0;
                    if (yDom[1] < 0) yDom[1] = 0;
                }

                const ar = computeBankingAR(xNum, yNum, xDom, yDom, sKeys, isConn);

                // Distribute: shorter side = base, longer side = base × min(ar, ms).
                if (ar >= 1) {
                    minSubplotWidth = Math.max(minSubplotWidth,
                        Math.round(baseMinSubplot * Math.min(ar, ms)));
                    minSubplotHeight = Math.max(minSubplotHeight, baseMinSubplot);
                } else {
                    minSubplotWidth = Math.max(minSubplotWidth, baseMinSubplot);
                    minSubplotHeight = Math.max(minSubplotHeight,
                        Math.round(baseMinSubplot * Math.min(1 / ar, ms)));
                }
            }
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
        // Column-only.  If all panels fit in one row, use a single row.
        // Otherwise wrap into a balanced grid: pick the number of rows
        // that makes the grid as square as possible (cols ≈ rows) while
        // staying within the max budget per dimension.
        if (colCount <= maxFacetColumns) {
            return {
                columns: colCount,
                rows: 1,
                maxColumnValues: colCount,
                maxRowValues: maxFacetRows,
            };
        }

        // Need to wrap.  Use maxFacetColumns as the column count
        // (fill the width), but reduce columns slightly if it would
        // produce a widow row (a single orphan panel on the last row).
        let nCols = maxFacetColumns;
        let nRows = Math.ceil(colCount / nCols);

        // Check for widow: if last row has only 1 panel, try nCols-1
        // to redistribute more evenly.  Keep reducing while widow
        // exists and nCols > 2.
        while (nCols > 2 && (colCount % nCols) === 1) {
            nCols--;
            nRows = Math.ceil(colCount / nCols);
        }

        const visRows = Math.min(nRows, maxFacetRows);
        const maxTotal = nCols * visRows;

        return {
            columns: nCols,
            rows: visRows,
            maxColumnValues: maxTotal,
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
