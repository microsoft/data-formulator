// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * PHASE 2: INSTANTIATE SPEC — ECharts backend
 * =============================================================================
 *
 * Translates semantic decisions (Phase 0) and layout dimensions (Phase 1)
 * into ECharts-specific option properties.
 *
 * Key differences from Vega-Lite instantiation:
 *   - VL uses declarative encoding width: {step: N} — EC uses explicit pixel widths
 *   - VL color schemes are strings — EC uses explicit color arrays
 *   - VL handles zero-baseline via scale.zero — EC uses axis.min / scale=true
 *   - VL temporal formatting uses timeUnit — EC uses axisLabel.formatter
 *   - VL label rotation is axis.labelAngle — EC uses axisLabel.rotate
 *
 * EC dependency: **Yes — this is where ECharts-specific syntax lives**
 * =============================================================================
 */

import type {
    ChannelSemantics,
    LayoutResult,
    InstantiateContext,
    ChartWarning,
} from '../core/types';
import { computePaddedDomain } from '../core/semantic-types';
import { getVisCategory } from '../core/semantic-types';
import { toTypeString } from '../core/field-semantics';
import {
    looksLikeDateString,
    analyzeTemporalField,
    computeDataVotes,
    pickBestLevel,
    levelToFormat,
    SEMANTIC_LEVEL,
} from '../core/resolve-semantics';
import { ColorDecisionResult, getPaletteForScheme } from '../core/color-decisions';
import { DEFAULT_COLORS } from './templates/utils';

/**
 * 在给定调色板长度和需要的颜色数量时，返回一组「在色带上尽量均匀分布」的索引。
 * 例如 paletteLength=10, count=4 → [0, 3, 6, 9]。
 */
function pickEvenlySpacedColorIndices(paletteLength: number, count: number): number[] {
    if (paletteLength <= 0 || count <= 0) return [];
    if (count === 1) return [0];

    // 当类别数超过调色板长度时，退化为简单循环使用全部颜色。
    if (count >= paletteLength) {
        return Array.from({ length: count }, (_, i) => i % paletteLength);
    }

    const maxIndex = paletteLength - 1;
    const step = maxIndex / (count - 1);
    const indices: number[] = [];
    for (let i = 0; i < count; i += 1) {
        const idx = Math.round(i * step);
        indices.push(idx);
    }
    return indices;
}

/**
 * 简单的 HEX → RGB 转换（仅支持 #rrggbb）。
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const intVal = parseInt(m[1], 16);
    return {
        r: (intVal >> 16) & 255,
        g: (intVal >> 8) & 255,
        b: intVal & 255,
    };
}

function componentToHex(c: number): string {
    const v = Math.max(0, Math.min(255, Math.round(c)));
    const s = v.toString(16);
    return s.length === 1 ? `0${s}` : s;
}

function rgbToHex(r: number, g: number, b: number): string {
    return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

/**
 * 将基础调色板插值为 256 个颜色采样点，用于 Rank / 连续映射。
 * 线性插值 RGB 空间，保证整体趋势与原色带一致。
 */
function samplePaletteTo256(base: string[]): string[] {
    if (base.length === 0) return [];
    if (base.length === 1) return new Array(256).fill(base[0]);

    const stops = base.map(hexToRgb);
    if (stops.some(s => s == null)) {
        // 回退：若存在无法解析的颜色，直接重复基础调色板。
        return Array.from({ length: 256 }, (_, i) => base[i % base.length]);
    }

    const rgbStops = stops as { r: number; g: number; b: number }[];
    const segmentCount = rgbStops.length - 1;
    const result: string[] = [];

    for (let i = 0; i < 256; i += 1) {
        const t = i / 255;
        const pos = t * segmentCount;
        const idx = Math.floor(pos);
        const localT = pos - idx;
        const c0 = rgbStops[idx];
        const c1 = rgbStops[Math.min(idx + 1, segmentCount)];
        const r = c0.r + (c1.r - c0.r) * localT;
        const g = c0.g + (c1.g - c0.g) * localT;
        const b = c0.b + (c1.b - c0.b) * localT;
        result.push(rgbToHex(r, g, b));
    }

    return result;
}

/**
 * 基于 legend 标签的数值（Rank/Index），从顺序色带采样 256 个颜色后，
 * 为每个 rank 值分配对应的颜色。
 */
function buildRankColorLookupFromLegend(
    legendData: any[],
    palette: string[],
): Map<string, string> {
    const labels: string[] = legendData.map((d: any) =>
        typeof d === 'string' ? d : (d?.name ?? String(d ?? '')),
    );

    const numericEntries = labels
        .map((name) => {
            const v = Number(name);
            return Number.isFinite(v) ? { name, value: v } : null;
        })
        .filter((x): x is { name: string; value: number } => x != null);

    if (numericEntries.length === 0) return new Map();

    const values = numericEntries.map(e => e.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const span = maxVal - minVal;

    const sampled = samplePaletteTo256(palette);
    if (sampled.length === 0) return new Map();

    const colorMap = new Map<string, string>();
    for (const { name, value } of numericEntries) {
        let t: number;
        if (!Number.isFinite(span) || span === 0) {
            t = 0.5;
        } else {
            t = (value - minVal) / span;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
        }
        const idx = Math.round(t * (sampled.length - 1));
        colorMap.set(name, sampled[idx]);
    }

    return colorMap;
}

/**
 * Phase 2: Apply layout and semantic decisions to the ECharts option object.
 *
 * Handles common ECharts plumbing across all templates:
 *   - Grid/canvas sizing
 *   - Axis label rotation and sizing
 *   - Overflow truncation markers
 *   - Color scheme application
 *   - Temporal format application
 */
function roundAxisNumber(v: number): number {
    if (!Number.isFinite(v)) return v;
    // Reduce floating point noise like 8.899999999999999 → 8.9
    return Number(v.toFixed(10));
}

function cleanAxisNumericFields(axis: any): void {
    if (!axis || typeof axis !== 'object') return;
    for (const key of ['min', 'max', 'interval']) {
        if (typeof axis[key] === 'number') {
            axis[key] = roundAxisNumber(axis[key]);
        }
    }
}

export function ecApplyLayoutToSpec(
    option: any,
    context: InstantiateContext,
    warnings: ChartWarning[],
): void {
    const { channelSemantics, layout, canvasSize } = context;

    // ── Axis-less chart types (pie, radar) ────────────────────────────────
    // These set their own _width/_height and need no grid/axis processing.
    const hasAxes = !!(option.xAxis || option.yAxis);

    // ── Zero-baseline and domain padding (value axes) ───────────────────────
    // Unify zero-baseline and domainPadFraction for all axis-based charts
    // (including bar); VL does this in vlApplyLayoutToSpec.
    for (const axis of ['x', 'y'] as const) {
        const axisObj = option[`${axis}Axis`];
        if (!axisObj || axisObj.type !== 'value') continue;
        const cs = channelSemantics[axis];
        if (!cs?.zero) continue;
        const decision = cs.zero;
        if (axisObj.scale === undefined) {
            axisObj.scale = !decision.zero; // false = include zero, true = data-fit
        }
        if (!decision.zero && decision.domainPadFraction > 0 && cs.field) {
            const numericValues = context.table
                .map((r: any) => r[cs.field])
                .filter((v: any) => v != null && typeof v === 'number' && !isNaN(v));
            const padded = computePaddedDomain(numericValues, decision.domainPadFraction);
            if (padded) {
                axisObj.min = padded[0];
                axisObj.max = padded[1];
            }
        }
    }

    // ── Banded continuous axis domain (e.g. heatmap) ──────────────────────
    // Half-step padding so edge cells are not clipped.
    // Only apply to value axes — category/time axes (e.g. bar with temporal
    // categories) should not receive numeric min/max, otherwise ECharts will
    // window the category index range and hide all bars.
    for (const axis of ['x', 'y'] as const) {
        const bandedCount = axis === 'x' ? layout.xContinuousAsDiscrete : layout.yContinuousAsDiscrete;
        if (bandedCount <= 1) continue;
        const axisObj = option[`${axis}Axis`];
        if (!axisObj || axisObj.type !== 'value' || axisObj.min != null) continue;
        const cs = channelSemantics[axis];
        if (!cs?.field || (cs.type !== 'quantitative' && cs.type !== 'temporal')) continue;
        const isTemporal = cs.type === 'temporal';
        const numericVals = context.table
            .map((r: any) => {
                const raw = r[cs.field];
                if (raw == null) return NaN;
                return isTemporal ? +new Date(raw) : +raw;
            })
            .filter((v: number) => !isNaN(v));
        if (numericVals.length <= 1) continue;
        const minVal = Math.min(...numericVals);
        const maxVal = Math.max(...numericVals);
        const dataRange = maxVal - minVal;
        if (dataRange === 0) continue;
        const pad = dataRange / (bandedCount - 1) / 2;
        axisObj.min = minVal - pad;
        axisObj.max = maxVal + pad;
    }

    // ── Axis title positioning ───────────────────────────────────────────
    // Ensure axis names are centered (VL default), not at the endpoint.
    if (option.xAxis) {
        if (option.xAxis.name) {
            option.xAxis.nameLocation = option.xAxis.nameLocation || 'middle';
            option.xAxis.nameGap = option.xAxis.nameGap || 25;
            option.xAxis.nameTextStyle = { fontSize: 12, ...(option.xAxis.nameTextStyle || {}) };
        }
    }
    if (option.yAxis) {
        if (option.yAxis.name) {
            option.yAxis.nameLocation = option.yAxis.nameLocation || 'middle';
            option.yAxis.nameGap = option.yAxis.nameGap || 45;
            option.yAxis.nameTextStyle = { fontSize: 12, ...(option.yAxis.nameTextStyle || {}) };
        }
    }

    // ── singleAxis title styling (themeRiver / streamgraph) ──────────────
    if (option.singleAxis) {
        if (option.singleAxis.name) {
            option.singleAxis.nameLocation = option.singleAxis.nameLocation || 'middle';
            option.singleAxis.nameGap = option.singleAxis.nameGap || 25;
            option.singleAxis.nameTextStyle = { fontSize: 12, ...(option.singleAxis.nameTextStyle || {}) };
        }
        if (!option.singleAxis.axisLabel) option.singleAxis.axisLabel = {};
        option.singleAxis.axisLabel.fontSize = option.singleAxis.axisLabel.fontSize || 11;
    }

    // ── Legend positioning ────────────────────────────────────────────────
    const hasLegend = !!option.legend;
    const hasVisualMap = !!option.visualMap;
    // Dual legend: when both a categorical legend and a visualMap (continuous
    // size/color legend) coexist, move the categorical legend to the bottom
    // to avoid crowding the right side of the chart.
    const isDualLegend = hasLegend && hasVisualMap;
    if (hasLegend) {
        // If the template already fully positioned the legend (e.g. pie),
        // skip repositioning — detect by checking if orient was already set.
        const alreadyPositioned = option.legend.orient && (option.legend.right !== undefined || option.legend.left !== undefined);
        // Derive a default legend title from semantics when templates don't set one explicitly.
        let legendTitle = option._legendTitle as string | undefined;
        if (legendTitle == null) {
            const colorField = (channelSemantics as any)?.color?.field;
            const groupField = (channelSemantics as any)?.group?.field;
            legendTitle = colorField || groupField;
        }
        if (legendTitle != null) delete option._legendTitle;
        if (!alreadyPositioned) {
            const rawLegendData = option.legend.data || [];
            const legendLabels: string[] = rawLegendData.map((d: any) => typeof d === 'string' ? d : (d?.name ?? ''));

            if (isDualLegend) {
                const highCardinality = legendLabels.length >= 16;
                option._legendWidth = 0; // no right-side space needed for the legend
                option.legend = {
                    ...option.legend,
                    bottom: 0,
                    left: 'center',
                    orient: 'horizontal',
                    textStyle: {
                        fontSize: highCardinality ? 8 : 11,
                        ...(option.legend.textStyle || {}),
                    },
                    ...(legendLabels.length > 10 ? { type: 'scroll' } : {}),
                    ...(highCardinality ? { itemWidth: 12, itemHeight: 12 } : {}),
                };
                if (legendTitle != null) {
                    const titleGraphic = {
                        type: 'text' as const,
                        bottom: 22,
                        left: 'center',
                        z: 100,
                        style: {
                            text: legendTitle,
                            fontSize: 11,
                            fontWeight: 'bold',
                            fill: '#333',
                            textAlign: 'center',
                        },
                    };
                    const existing = option.graphic;
                    option.graphic = Array.isArray(existing) ? [...existing, titleGraphic] : (existing ? [existing, titleGraphic] : [titleGraphic]);
                }
            } else {
                // Single legend: use left positioning so title and legend circles share the same left edge
                const maxLabelLen = Math.max(...legendLabels.map((l: string) => l.length), 3);
                const highCardinality = legendLabels.length >= 16;
                const legendSymbolWidth = highCardinality ? 12 : 14;
                const legendItemGap = 5;
                const estimatedTextWidth = Math.min(120, maxLabelLen * 7 + 30);
                option._legendWidth = legendSymbolWidth + legendItemGap + estimatedTextWidth;
                const LEGEND_GAP = 12;
                const CANVAS_BUFFER = 16;
                const rightMarginPx = option._legendWidth + LEGEND_GAP + CANVAS_BUFFER;
                const hasYTitle = !!option.yAxis?.name;
                const gridLeft = (hasYTitle ? 70 : 50) + CANVAS_BUFFER;
                // Use same effective plot width as canvas block (grouped bar/boxplot widen the plot) so legend does not overlap chart
                let plotW = layout?.subplotWidth ?? canvasSize?.width ?? 400;
                const xIsDiscreteForLegend = layout.xNominalCount > 0 || layout.xContinuousAsDiscrete > 0;
                if (xIsDiscreteForLegend) {
                    let xItemCount = layout.xNominalCount || layout.xContinuousAsDiscrete || 0;
                    if (layout.xStepUnit === 'group' && option.series && Array.isArray(option.series) && layout.xNominalCount > 0) {
                        const barSeriesCount = option.series.filter((s: any) => s.type === 'bar').length || option.series.length;
                        if (barSeriesCount > 0) {
                            xItemCount = Math.max(1, Math.round(layout.xNominalCount / barSeriesCount));
                        }
                    }
                    plotW = xItemCount > 0 ? layout.xStep * xItemCount : plotW;
                    const boxplotSeriesCount = option.series?.filter((s: any) => s.type === 'boxplot').length || 0;
                    if (boxplotSeriesCount > 1) {
                        plotW = plotW * boxplotSeriesCount;
                    }
                }
                const effectiveChartWidth = plotW + gridLeft + rightMarginPx;
                const legendLeftPx = Math.max(0, effectiveChartWidth - rightMarginPx);
                option.legend = {
                    ...option.legend,
                    top: legendTitle != null ? 20 : 0,
                    left: legendLeftPx,
                    orient: option.legend.orient || 'vertical',
                    align: 'left', // icon on left, text on right
                    textStyle: {
                        fontSize: highCardinality ? 8 : 11,
                        ...(option.legend.textStyle || {}),
                    },
                    ...(legendLabels.length > 10 ? { type: 'scroll' } : {}),
                    ...(highCardinality ? { itemWidth: 12, itemHeight: 12 } : {}),
                };
                if (legendTitle != null) {
                    const titleGraphic = {
                        type: 'text' as const,
                        left: legendLeftPx,
                        top: 4,
                        z: 100,
                        style: {
                            text: legendTitle,
                            fontSize: 11,
                            fontWeight: 'bold',
                            fill: '#333',
                            textAlign: 'left',
                        },
                    };
                    const existing = option.graphic;
                    option.graphic = Array.isArray(existing) ? [...existing, titleGraphic] : (existing ? [existing, titleGraphic] : [titleGraphic]);
                }
            }
        } else {
            // Already positioned — estimate width for grid margin
            const rawData = option.legend.data || [];
            const legendLabels = rawData.map((d: any) => typeof d === 'string' ? d : (d?.name ?? ''));
            const maxLabelLen = Math.max(...legendLabels.map((l: string) => l.length), 3);
            option._legendWidth = Math.min(150, maxLabelLen * 7 + 30);
        }
    }

    // ── Grid sizing ──────────────────────────────────────────────────────
    // ECharts uses an explicit grid with left/right/top/bottom margins.
    // Unlike VL where width/height set the *plot area* and the SVG wraps
    // around it, ECharts' width/height set the *total canvas* and the grid
    // sits inside.  We define explicit grid margins and inflate the canvas
    // so that the inner plot area matches the intended subplot dimensions.
    //
    // Skip grid processing for axis-less charts (pie, radar) which handle
    // their own sizing in their template instantiate() methods.
    const hasXTitle = !!option.xAxis?.name;
    const hasYTitle = !!option.yAxis?.name;
    // ECharts init() creates an internal div with overflow:hidden at the
    // exact _width × _height pixel dimensions.  Adding a small buffer to
    // each grid margin keeps the plot area unchanged but gives breathing
    // room for axis labels / legends / ticks that extend to the canvas edge.
    const CANVAS_BUFFER = 16;
    const LEGEND_GAP = 12; // gap between plot and legend/visualMap so they don't overlap
    const VISUALMAP_GAP = 18; // extra gap between plot and visualMap bar when only visualMap (no legend)
    const VISUALMAP_RIGHT_OFFSET = 10; // must match scatter (and other templates) visualMap right position
    const legendWidth = (hasLegend ? (option._legendWidth || 120) : 20);
    const visualMapWidth = (option._visualMapWidth as number) || 0;
    if (visualMapWidth) delete option._visualMapWidth;
    // When dual legend (segment at bottom + size/color bar on right), reserve right space so plot does not overlap visualMap
    const rightMargin =
        isDualLegend
            ? (hasVisualMap ? VISUALMAP_RIGHT_OFFSET + visualMapWidth + VISUALMAP_GAP : 10)
            : (hasLegend ? legendWidth : (hasVisualMap ? visualMapWidth + VISUALMAP_GAP : 10)) + LEGEND_GAP;
    const bottomLegendExtra = isDualLegend ? 30 : 0;
    const gridMargin = {
        left: (hasYTitle ? 70 : 50) + CANVAS_BUFFER,
        right: rightMargin + CANVAS_BUFFER,
        top: 20 + CANVAS_BUFFER,
        bottom: (hasXTitle ? 45 : 30) + CANVAS_BUFFER + bottomLegendExtra,
    };
    if (hasAxes) {
        if (!option.grid) option.grid = {};
        option.grid.left = gridMargin.left;
        option.grid.right = gridMargin.right;
        option.grid.top = gridMargin.top;
        option.grid.bottom = gridMargin.bottom;
    }

    // ── Canvas dimensions ────────────────────────────────────────────────
    // For axis-less charts (pie, radar), _width/_height are set by the
    // template itself.  Only compute for axis-based charts.
    if ((hasAxes || option.singleAxis) && !option._width) {
        // For discrete axes, VL uses width:{step:N} which auto-sizes the plot.
        // ECharts has no such feature — we derive the plot size from layout.
        //
        // For non-grouped discrete axes: plotWidth = xStep × categoryCount
        // For grouped discrete axes (stepUnit='group'): the step already
        //   accounts for multiple bars per category, but xNominalCount includes
        //   the group multiplier.  Use subplotWidth which is already correct.
        // For continuous axes: use subplotWidth directly.
        const xIsDiscrete = layout.xNominalCount > 0 || layout.xContinuousAsDiscrete > 0;
        const yIsDiscrete = layout.yNominalCount > 0 || layout.yContinuousAsDiscrete > 0;

        let plotWidth: number;
        let plotHeight: number;

        if (xIsDiscrete) {
            // For grouped discrete axes (stepUnit='group'), layout.xNominalCount
            // typically includes the group multiplier (categories × seriesCount).
            // To mimic Vega-Lite's width:{step} behaviour (canvas grows with the
            // number of *categories*), derive an approximate category count
            // from the series when possible.
            let xItemCount = layout.xNominalCount || layout.xContinuousAsDiscrete || 0;
            if (layout.xStepUnit === 'group' && option.series && Array.isArray(option.series) && layout.xNominalCount > 0) {
                const barSeriesCount = option.series.filter((s: any) => s.type === 'bar').length || option.series.length;
                if (barSeriesCount > 0) {
                    xItemCount = Math.max(1, Math.round(layout.xNominalCount / barSeriesCount));
                }
            }
            plotWidth = xItemCount > 0 ? layout.xStep * xItemCount : (layout.subplotWidth || canvasSize.width);
            // Grouped boxplot: multiple boxplot series (e.g. by color) need more horizontal space so boxes don't overlap (same idea as grouped bar).
            const boxplotSeriesCount = option.series?.filter((s: any) => s.type === 'boxplot').length || 0;
            if (boxplotSeriesCount > 1) {
                plotWidth = plotWidth * boxplotSeriesCount;
            }
        } else {
            // Continuous axis — subplotWidth is already correct
            plotWidth = layout.subplotWidth || canvasSize.width;
        }

        if (yIsDiscrete && layout.yStepUnit !== 'group') {
            const yItemCount = layout.yNominalCount || layout.yContinuousAsDiscrete || 0;
            plotHeight = yItemCount > 0 ? layout.yStep * yItemCount : (layout.subplotHeight || canvasSize.height);
        } else {
            plotHeight = layout.subplotHeight || canvasSize.height;
        }

        option._width = plotWidth + gridMargin.left + gridMargin.right;
        option._height = plotHeight + gridMargin.top + gridMargin.bottom;
    }

    // ── Bar sizing ───────────────────────────────────────────────────────
    // ECharts needs barCategoryGap / barWidth to match the step layout.
    // VL pads *inside* the step (bandwidth = step × (1 − paddingInner)),
    // while ECharts uses barCategoryGap as a percentage of the category
    // slot.  For single/stacked bars we use barCategoryGap only —
    // letting ECharts auto-size bars proportionally to the grid width.
    // For grouped bars we need explicit barWidth per series.
    if (option.series && Array.isArray(option.series)) {
        const barSeries = option.series.filter((s: any) => s.type === 'bar');
        if (barSeries.length > 0) {
            const catAxis = option.xAxis?.type === 'category' ? 'x' : 'y';
            const step = catAxis === 'x' ? layout.xStep : layout.yStep;
            const stepUnit = catAxis === 'x' ? layout.xStepUnit : layout.yStepUnit;
            const isStacked = barSeries.some((s: any) => s.stack != null);

            if (step > 0) {
                const bandPadding = layout.stepPadding;
                const catGapPct = `${Math.round(bandPadding * 100)}%`;

                if (!isStacked && (stepUnit === 'group' || barSeries.length > 1)) {
                    // Grouped: each bar gets an equal share of the usable band.
                    // Use (seriesCount + 1) so total bar width stays strictly inside the slot and bars不会互相挤压重叠.
                    const usableStep = step * (1 - bandPadding);
                    const barW = Math.max(1, Math.floor(usableStep / (barSeries.length + 1)));
                    for (const s of barSeries) {
                        s.barWidth = barW;
                        s.barGap = '0%';
                    }
                    barSeries[0].barCategoryGap = catGapPct;
                } else {
                    // Single series or stacked: let ECharts auto-size bars.
                    // barCategoryGap controls the fraction of each slot
                    // reserved for inter-category gap.
                    for (const s of barSeries) {
                        s.barCategoryGap = catGapPct;
                    }
                }
            }
        }
    }

    // ── X-axis label sizing ──────────────────────────────────────────────
    if (option.xAxis && layout.xLabel) {
        if (!option.xAxis.axisLabel) option.xAxis.axisLabel = {};

        // Category axis: templates (line, heatmap, bar) set rotate by label type (numeric vs non-numeric). Preserve it.
        // Time axis: line chart sets rotate 90 for date labels; preserve that too.
        const templateRotate = option.xAxis.axisLabel.rotate;
        const isCategoryX = option.xAxis.type === 'category';
        const isTimeX = option.xAxis.type === 'time';
        const preserveTemplateRotate =
            (isCategoryX && (templateRotate === 0 || templateRotate === 90)) ||
            (isTimeX && templateRotate === 90);
        if (layout.xLabel.labelAngle != null && layout.xLabel.labelAngle !== 0 && !preserveTemplateRotate) {
            option.xAxis.axisLabel.rotate = -layout.xLabel.labelAngle;  // VL convention → EC convention
        }

        if (layout.xLabel.fontSize) {
            option.xAxis.axisLabel.fontSize = layout.xLabel.fontSize;
        }

        if (layout.xLabel.labelLimit && layout.xLabel.labelLimit < 100) {
            const maxLen = layout.xLabel.labelLimit;
            option.xAxis.axisLabel.formatter = (value: string) => {
                if (typeof value === 'string' && value.length > maxLen) {
                    return value.substring(0, maxLen) + '…';
                }
                return value;
            };
        }
    }

    // ── Y-axis label sizing ──────────────────────────────────────────────
    if (option.yAxis && layout.yLabel) {
        if (!option.yAxis.axisLabel) option.yAxis.axisLabel = {};

        // Don't override category axis rotate — scatter keeps y labels horizontal (0) to avoid overlap.
        if (layout.yLabel.labelAngle && layout.yLabel.labelAngle !== 0 && option.yAxis.type !== 'category') {
            option.yAxis.axisLabel.rotate = -layout.yLabel.labelAngle;
        }
        if (layout.yLabel.fontSize) {
            option.yAxis.axisLabel.fontSize = layout.yLabel.fontSize;
        }
    }

    // ── Ordinal temporal: category axes with date-like labels ──────────────
    // VL applyOrdinalTemporalFormat: format nominal/ordinal axis as dates when data looks like dates.
    for (const axis of ['x', 'y'] as const) {
        const axisObj = option[`${axis}Axis`];
        if (!axisObj || axisObj.type !== 'category') continue;
        const cs = channelSemantics[axis];
        if (!cs?.field || (cs.type !== 'nominal' && cs.type !== 'ordinal')) continue;
        const semanticType = toTypeString(context.semanticTypes[cs.field]);
        if (getVisCategory(semanticType) !== 'temporal') continue;
        const fieldVals = context.table.map((r: any) => r[cs.field]).filter((v: any) => v != null);
        const datelikeCnt = fieldVals.filter((v: any) =>
            typeof v !== 'string' || looksLikeDateString(String(v))
        ).length;
        if (datelikeCnt < fieldVals.length * 0.5) continue;
        const analysis = analyzeTemporalField(fieldVals);
        if (!analysis) continue;
        const votes = computeDataVotes(analysis.same);
        const semLevel = SEMANTIC_LEVEL[semanticType];
        if (semLevel !== undefined) votes[semLevel] += 3;
        const { level, score } = pickBestLevel(votes);
        if (score < 5) continue;
        const fmt = levelToFormat(level, analysis);
        if (!fmt) continue;
        if (!axisObj.axisLabel) axisObj.axisLabel = {};
        const existingFormatter = axisObj.axisLabel.formatter;
        axisObj.axisLabel.formatter = (value: string) => {
            const formatted = formatCategoryTemporal(value, fmt);
            return typeof existingFormatter === 'function' ? existingFormatter(formatted) : formatted;
        };
    }

    // ── Temporal format (time / value axes) ──────────────────────────────
    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (cs?.temporalFormat && option[`${axis}Axis`]) {
            const axisObj = option[`${axis}Axis`];
            if (axisObj.type === 'time') {
                if (!axisObj.axisLabel) axisObj.axisLabel = {};
                axisObj.axisLabel.formatter = convertTemporalFormat(cs.temporalFormat);
            }
            if (axisObj.type === 'value' && cs.type === 'temporal') {
                // Bar (and similar) repurpose temporal channel as count → axis shows numbers, not dates
                if (axisObj.name === 'Count') continue;
                if (!axisObj.axisLabel) axisObj.axisLabel = {};
                const fmt = cs.temporalFormat;
                axisObj.axisLabel.formatter = (val: number) => formatTimestamp(val, fmt);
            }
        }
    }

    // ── Clean axis numeric fields (min/max/interval) to avoid long floats ─
    for (const axisKey of ['xAxis', 'yAxis'] as const) {
        const axisVal = (option as any)[axisKey];
        if (Array.isArray(axisVal)) {
            axisVal.forEach(cleanAxisNumericFields);
        } else {
            cleanAxisNumericFields(axisVal);
        }
    }

    // ── Tooltip category as temporal (line/area/bar axis tooltip) ─────────
    const enc = option._encodingTooltip;
    if (enc?.trigger === 'axis' && enc.categoryLabel != null && option.xAxis?.type === 'time') {
        const xFmt = channelSemantics?.x?.temporalFormat;
        if (xFmt) {
            option._encodingTooltip = { ...enc, categoryFormat: 'temporal', temporalFormat: xFmt };
        }
    }

    // ── Color scheme ─────────────────────────────────────────────────────
    // Use palette derived from backend-agnostic colorDecisions when present.
    const decisions: ColorDecisionResult | undefined = context.colorDecisions;
    let colorDecision = decisions ? (decisions.color ?? decisions.group) : undefined;
    let effectivePalette: string[] | undefined;
    if (decisions && colorDecision && colorDecision.schemeId) {
        const fromResolved =
            context.resolvedEncodings?.color?.colorPalette
            ?? context.resolvedEncodings?.group?.colorPalette;

        let palette: string[] | undefined;
        const isCategoricalScheme = colorDecision.schemeType === 'categorical';

        if (isCategoricalScheme) {
            // 对于分类色盘，优先使用统一注册表中的 cat10/cat20 等，
            // 避免后端各自的默认调色板导致视觉风格不一致。
            const fromRegistry = getPaletteForScheme(colorDecision.schemeId);
            if (fromRegistry && fromRegistry.length > 0) {
                palette = fromRegistry;
            } else {
                const targetId =
                    (colorDecision.categoryCount ?? 0) > 10
                        ? 'cat20'
                        : 'cat10';
                palette = getPaletteForScheme(targetId)
                    ?? (fromResolved && fromResolved.length > 0 ? fromResolved : DEFAULT_COLORS);
            }
        } else {
            // 顺序 / 发散色带：优先使用统一注册表中的连续色带（例如 viridis），
            // 这样 Rank / 连续映射在所有后端保持一致；只有当注册表缺失时，
            // 才退回到上游解析好的 palette 或默认颜色。
            const fromRegistry = getPaletteForScheme(colorDecision.schemeId);
            if (fromRegistry && fromRegistry.length > 0) {
                palette = fromRegistry;
            } else if (fromResolved && fromResolved.length > 0) {
                palette = fromResolved;
            } else {
                palette = DEFAULT_COLORS;
            }
        }

        if (palette && palette.length) {
            option.color = [...palette];
            effectivePalette = palette;
        }
    } else {
        // Back-compat: keep existing behavior when colorDecisions are absent.
        const colorPalette = context.resolvedEncodings?.color?.colorPalette
            ?? context.resolvedEncodings?.group?.colorPalette;
        if (colorPalette?.length) {
            option.color = [...colorPalette];
            effectivePalette = colorPalette;
        }
    }

    // 若上述两步都没有得到有效 palette，则回退到统一默认：cat10。
    // 这覆盖「没有显式 color/group 通道」的情况：此时也会有一个稳定的默认调色板，
    // 从而保证单系列用 cat10[0]，多系列则依次使用 cat10[i]。
    if (!effectivePalette || effectivePalette.length === 0) {
        const cat10 = getPaletteForScheme('cat10');
        if (cat10 && cat10.length > 0) {
            effectivePalette = cat10;
            if (!option.color) {
                option.color = [...cat10];
            }
        }
    }

    // 当存在调色板时，覆盖模板中的硬编码 itemStyle.color，
    // 让最终颜色真正由 colorDecisions / colormap 注册表驱动。
    if (effectivePalette && effectivePalette.length > 0 && Array.isArray(option.series)) {
        const n = effectivePalette.length;
        const schemeType = colorDecision?.schemeType;

        // 由 colorDecisions 实际使用的通道（color 或 group）来驱动语义判断，
        // 这样 Grouped Bar 等只用 group 通道的图表也能正确应用 Rank 等语义。
        let drivingColorChannel: ChannelSemantics | undefined;
        if (decisions?.color && channelSemantics.color) {
            drivingColorChannel = channelSemantics.color;
        } else if (decisions?.group && channelSemantics.group) {
            drivingColorChannel = channelSemantics.group;
        }
        const colorSemanticType = drivingColorChannel?.semanticAnnotation?.semanticType;
        const isRankLikeColor = !!colorSemanticType
            && (colorSemanticType === 'Rank' || colorSemanticType === 'Index');
        const useEvenSpacing = !isRankLikeColor && (schemeType === 'sequential' || schemeType === 'diverging');

        // 特例：Regression 图表有「散点 + 趋势线」成对系列。
        // 颜色应该按「类别（legend 项）」而不是「series 索引」消费 palette，
        // 否则当类别很多时，series 数翻倍会导致 palette 提前回绕，最后一个类别复用第一个颜色。
        if (context.chartType === 'Regression' && option.legend && Array.isArray(option.legend.data)) {
            // 1) 建立 legend 类别 → 调色板颜色 的映射
            const legendLabels: string[] = option.legend.data.map((d: any) =>
                typeof d === 'string' ? d : (d?.name ?? ''),
            );
            const categoryToColor = new Map<string, string>();
            if (useEvenSpacing) {
                const spacedLegendIndices = pickEvenlySpacedColorIndices(n, legendLabels.length);
                legendLabels.forEach((name, i) => {
                    if (!name) return;
                    const paletteIndex = spacedLegendIndices[i] ?? (i % n);
                    categoryToColor.set(name, effectivePalette[paletteIndex]);
                });
            } else {
                let colorIdx = 0;
                for (const name of legendLabels) {
                    if (!name) continue;
                    categoryToColor.set(name, effectivePalette[colorIdx % n]);
                    colorIdx += 1;
                }
            }

            // 2) 为每个 series 赋色：
            //    - series.name 为 "Math" / "Science" 等 → 直接查映射；
            //    - 趋势线系列名为 "Math (trend)" → 去掉 " (trend)" 后再查映射；
            //    - 找不到映射时兜底按 series 索引循环 palette。
            option.series.forEach((s: any, idx: number) => {
                if (!s) return;
                const rawName: string = typeof s.name === 'string' ? s.name : '';
                const baseName = rawName.endsWith(' (trend)')
                    ? rawName.slice(0, -' (trend)'.length)
                    : rawName;

                const mappedColor = baseName && categoryToColor.has(baseName)
                    ? categoryToColor.get(baseName)
                    : effectivePalette[idx % n];

                s.itemStyle = s.itemStyle || {};
                s.itemStyle.color = mappedColor!;
            });
        } else if (context.chartType === 'Boxplot' && option.legend && Array.isArray(option.legend.data)) {
            // Boxplot：每个类别有 boxplot + 可选 scatter(outliers)，需按 legend 类别赋同一颜色
            const legendLabels: string[] = option.legend.data.map((d: any) =>
                typeof d === 'string' ? d : (d?.name ?? ''),
            );
            const categoryToColor = new Map<string, string>();
            legendLabels.forEach((name, i) => {
                if (!name) return;
                categoryToColor.set(name, effectivePalette[i % n]);
            });
            option.series.forEach((s: any, idx: number) => {
                if (!s) return;
                const rawName: string = typeof s.name === 'string' ? s.name : (s.name != null ? String(s.name) : '');
                const baseName = rawName.endsWith(' (outliers)')
                    ? rawName.slice(0, -' (outliers)'.length)
                    : rawName;
                const mappedColor = baseName && categoryToColor.has(baseName)
                    ? categoryToColor.get(baseName)
                    : effectivePalette[idx % n];
                s.itemStyle = s.itemStyle || {};
                s.itemStyle.color = mappedColor!;
                if (s.type === 'boxplot') {
                    s.itemStyle.borderColor = mappedColor!;
                }
            });
        } else {
            // Pie / Rose / Streamgraph：颜色按 data 项或 stream 由 option.color[i] 分配，不要给 series 设 itemStyle.color，否则整图会变成一种颜色。
            const colorByDataItem = context.chartType === 'Pie Chart' || context.chartType === 'Rose Chart'
                || context.chartType === 'Streamgraph';
            if (colorByDataItem) {
                // option.color 已在上面设为 effectivePalette，ECharts 会按索引给每个扇区上色，无需再处理 series。
            } else if (context.chartType === 'Radar Chart') {
                // Radar：通常是「单个 radar series + 多个 data item(类别)」。
                // 颜色应按类别(data item)分配，而不是按 series 分配，否则所有多边形会共用同色。
                const legendLabels: string[] = option.legend?.data?.map((d: any) =>
                    typeof d === 'string' ? d : (d?.name ?? ''),
                ) ?? [];
                const categoryToColor = new Map<string, string>();
                legendLabels.forEach((name, i) => {
                    if (!name) return;
                    categoryToColor.set(name, effectivePalette[i % n]);
                });

                const radarSeries = Array.isArray(option.series)
                    ? option.series.find((s: any) => s && s.type === 'radar')
                    : null;
                if (radarSeries && Array.isArray(radarSeries.data)) {
                    radarSeries.data.forEach((item: any, i: number) => {
                        if (!item) return;
                        const rawName: string = typeof item.name === 'string' ? item.name : '';
                        const mapped = rawName && categoryToColor.has(rawName)
                            ? categoryToColor.get(rawName)
                            : effectivePalette[i % n];
                        const color = mapped!;
                        item.itemStyle = item.itemStyle || {};
                        if (item.itemStyle.color == null) item.itemStyle.color = color;
                        // Keep fill opacity set by template; only supply fill color if unset.
                        item.areaStyle = item.areaStyle || {};
                        if (item.areaStyle.color == null) item.areaStyle.color = color;
                        item.lineStyle = item.lineStyle || {};
                        if (item.lineStyle.color == null) item.lineStyle.color = color;
                    });
                }
            } else {
                // 默认：按 series 索引循环 palette，但仅在模板未显式指定颜色时填充：
                // - 无 color/group 编码的单系列图表 → 使用 cat10[0] 作为默认颜色
                // - 多系列 → 依次使用 palette[i]，保持跨图表的一致顺序
                // - 若模板已为某些 series 设置特殊颜色（透明底座、参考线等），则尊重模板设置。
                const hasLegend = !!option.legend && Array.isArray(option.legend.data);
                const rankLegendColorMap = (isRankLikeColor && hasLegend)
                    ? buildRankColorLookupFromLegend(option.legend.data, effectivePalette)
                    : new Map<string, string>();

                // 只对「需要上色」的 series 从 palette 取色，已设 color 的（如连接线、参考线）不占下标，使 Min/Max 等得到第 1、2 个颜色
                const colorableCount = option.series.filter((s: any) => s && s.itemStyle?.color == null).length;
                const spacedIndices = useEvenSpacing && colorableCount > 0
                    ? pickEvenlySpacedColorIndices(n, colorableCount)
                    : null;
                let colorIdx = 0;

                option.series.forEach((s: any, idx: number) => {
                    if (!s) return;
                    s.itemStyle = s.itemStyle || {};
                    if (s.itemStyle.color != null) return;

                    // Rank / Index 颜色映射：根据 rank 数值在连续色带上取色
                    if (isRankLikeColor && rankLegendColorMap.size > 0) {
                        const rawName: string = typeof s.name === 'string'
                            ? s.name
                            : (s.name != null ? String(s.name) : '');
                        const mapped = rawName ? rankLegendColorMap.get(rawName) : undefined;
                        if (mapped) {
                            s.itemStyle.color = mapped;
                            if (s.type === 'boxplot') s.itemStyle.borderColor = mapped;
                            colorIdx += 1;
                            return;
                        }
                        // 若找不到映射，则继续走下面的一般逻辑兜底。
                    }

                    const paletteIndex = spacedIndices
                        ? (spacedIndices[colorIdx] ?? colorIdx % n)
                        : (colorIdx % n);
                    const color = effectivePalette[paletteIndex];
                    s.itemStyle.color = color;
                    if (s.type === 'boxplot') {
                        s.itemStyle.borderColor = color;
                    }
                    colorIdx += 1;
                });
            }
        }
    }

    // ── Overflow truncation markers ──────────────────────────────────────
    if (layout.truncations && layout.truncations.length > 0) {
        const axisPlaceholders: Record<string, Set<string>> = { xAxis: new Set(), yAxis: new Set() };
        for (const trunc of layout.truncations) {
            warnings.push({
                severity: 'warning',
                code: 'overflow',
                message: trunc.message,
                channel: trunc.channel,
                field: trunc.field,
            });
            const axisKey = trunc.channel === 'x' ? 'xAxis' : 'yAxis';
            if (trunc.channel === 'x' || trunc.channel === 'y') {
                axisPlaceholders[axisKey].add(trunc.placeholder);
                if (option[axisKey]?.data && Array.isArray(option[axisKey].data)) {
                    option[axisKey].data.push(trunc.placeholder);
                }
            }
        }
        // Grey styling for placeholder labels (VL labelColor equivalent)
        for (const axisKey of ['xAxis', 'yAxis'] as const) {
            const placeholders = axisPlaceholders[axisKey];
            if (placeholders.size === 0 || !option[axisKey]) continue;
            if (!option[axisKey].axisLabel) option[axisKey].axisLabel = {};
            const existingColor = option[axisKey].axisLabel.color;
            option[axisKey].axisLabel.color = (params: string) =>
                placeholders.has(params) ? '#999999' : (typeof existingColor === 'function' ? existingColor(params) : (existingColor ?? '#000'));
        }
    }
}

/**
 * Convert a d3-style temporal format string to an ECharts template string.
 * Only suitable for ECharts 'time' type axes which support {yyyy}, {MM}, etc.
 *
 * d3: %Y → 2024, %b → Jan, %d → 01, %H → 14, %M → 30
 * EC uses {yyyy}, {MM}, {dd}, {HH}, {mm} in templates
 */
function convertTemporalFormat(d3Format: string): string {
    return d3Format
        .replace(/%Y/g, '{yyyy}')
        .replace(/%y/g, '{yy}')
        .replace(/%b/g, '{MMM}')
        .replace(/%B/g, '{MMMM}')
        .replace(/%m/g, '{MM}')
        .replace(/%d/g, '{dd}')
        .replace(/%H/g, '{HH}')
        .replace(/%M/g, '{mm}')
        .replace(/%S/g, '{ss}');
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Format a category-axis label as date when it parses as valid date.
 * Used for ordinal temporal (nominal/ordinal channel with date-like strings).
 */
function formatCategoryTemporal(value: string, d3Format: string): string {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return formatTimestamp(d.getTime(), d3Format);
}

/**
 * Format a numeric timestamp using a d3-style format string.
 * Used for 'value' axes that hold temporal data (timestamps).
 * Exported for scatter (temporal color visualMap labels).
 */
export function formatTimestamp(val: number, d3Format: string): string {
    const d = new Date(val);
    const pad = (n: number) => n < 10 ? '0' + n : String(n);
    return d3Format
        .replace(/%Y/g, String(d.getFullYear()))
        .replace(/%y/g, String(d.getFullYear()).slice(-2))
        .replace(/%B/g, MONTH_FULL[d.getMonth()])
        .replace(/%b/g, MONTH_ABBR[d.getMonth()])
        .replace(/%m/g, pad(d.getMonth() + 1))
        .replace(/%d/g, pad(d.getDate()))
        .replace(/%H/g, pad(d.getHours()))
        .replace(/%M/g, pad(d.getMinutes()))
        .replace(/%S/g, pad(d.getSeconds()));
}

function fmtNumForTooltip(v: unknown): string {
    if (v == null) return '';
    const n = Number(v);
    return isNaN(n) ? String(v) : (Number.isInteger(n) ? String(n) : n.toFixed(1));
}

/**
 * Build a single encoding-style tooltip formatter from _encodingTooltip.
 * Supports item trigger (parts from data/series) and axis trigger (category + series values).
 */
function buildEncodingTooltipFormatter(option: any): ((params: any) => string) | null {
    const enc = option._encodingTooltip as any;
    if (!enc) return null;

    if (enc.trigger === 'axis' && enc.categoryLabel != null) {
        const categoryLabel = enc.categoryLabel;
        const valueLabel = enc.valueLabel ?? 'Value';
        const categoryFormat = enc.categoryFormat;
        const temporalFormat = enc.temporalFormat ?? '%b %d, %Y';
        const filterScatterOnly = !!enc.filterScatterOnly;
        return (params: any) => {
            const rawList = Array.isArray(params) ? params : [params];
            const list = filterScatterOnly
                ? rawList.filter((item: any) => item && item.seriesType === 'scatter')
                : rawList;
            if (list.length === 0) return '';
            const p = list[0];
            let cat: string;
            const rawCat = p.axisValue ?? p.name ?? '';
            if (categoryFormat === 'temporal' && (rawCat !== '' && rawCat != null)) {
                const ts = typeof rawCat === 'number' ? rawCat : new Date(rawCat as string).getTime();
                cat = Number.isFinite(ts) ? formatTimestamp(ts, temporalFormat) : String(rawCat);
            } else {
                cat = String(rawCat);
            }
            const parts = [`${categoryLabel}: ${cat}`];
            for (const item of list) {
                const name = item.seriesName ?? valueLabel;
                let val = item.value != null ? item.value : (Array.isArray(item.data) ? item.data[item.dataIndex] : item.data);
                // Line/area series data is [x, y]; ECharts may pass the full point — use y (index 1) for value.
                if (Array.isArray(val) && val.length >= 2) val = val[1];
                parts.push(`${name}: ${fmtNumForTooltip(val)}`);
            }
            return parts.join('<br/>');
        };
    }

    const parts = enc.parts as Array<{ from: string; index?: number; label: string; format?: string; temporalFormat?: string; categoryNames?: string[] }>;
    if (!parts || !Array.isArray(parts) || parts.length === 0) return null;

    return (params: any) => {
        if (params == null) return '';
        const d = Array.isArray(params.data) ? params.data : (params.data != null ? [params.data] : []);
        const out: string[] = [];
        for (const p of parts) {
            let val: unknown;
            if (p.from === 'series') {
                val = params.seriesName ?? params.name;
            } else if (p.from === 'name') {
                val = params.name;
            } else if (p.from === 'value') {
                val = params.value;
            } else {
                const idx = p.index ?? 0;
                val = d[idx];
                if (val != null && typeof val === 'object' && 'value' in val) val = (val as any).value;
            }
            if (val == null && p.from !== 'series' && p.from !== 'name') continue;
            let str: string;
            if (p.format === 'temporal') {
                const ts = typeof val === 'number' ? val : new Date(val as string).getTime();
                str = Number.isFinite(ts) ? formatTimestamp(ts, p.temporalFormat ?? '%b %d, %Y') : String(val ?? '');
            } else if (p.format === 'category' && p.categoryNames) {
                const i = Number(val);
                str = Number.isInteger(i) && p.categoryNames[i] != null ? p.categoryNames[i] : String(val ?? '');
            } else if (p.format === 'number' || (p.from === 'data' && p.format !== 'category')) {
                str = fmtNumForTooltip(val);
            } else {
                str = String(val ?? '');
            }
            out.push(`${p.label}: ${str}`);
        }
        return out.join('<br/>');
    };
}

/**
 * Apply tooltips to an ECharts option.
 * ECharts tooltip is typically configured at the top level.
 * When option._encodingTooltip is set, a Vega-Lite–style formatter (label: value per encoding) is applied.
 */
export function ecApplyTooltips(option: any): void {
    if (!option.tooltip) {
        option.tooltip = {};
    }

    const encodingFormatter = buildEncodingTooltipFormatter(option);
    if (encodingFormatter) {
        delete option._encodingTooltip;
        option.tooltip.formatter = encodingFormatter;
    }

    // Ensure trigger is set
    if (!option.tooltip.trigger) {
        const hasScatter = option.series?.some((s: any) => s.type === 'scatter');
        const hasPie = option.series?.some((s: any) => s.type === 'pie');
        const hasRadar = option.series?.some((s: any) => s.type === 'radar');
        const hasHeatmap = option.series?.some((s: any) => s.type === 'heatmap');
        const hasCandlestick = option.series?.some((s: any) => s.type === 'candlestick');
        const hasThemeRiver = option.series?.some((s: any) => s.type === 'themeRiver');
        option.tooltip.trigger = (hasScatter || hasPie || hasRadar || hasHeatmap || hasThemeRiver)
            ? 'item'
            : 'axis';
        // Candlestick charts benefit from crosshair pointer
        if (hasCandlestick && !option.tooltip.axisPointer) {
            option.tooltip.axisPointer = { type: 'cross' };
        }

        // ThemeRiver default tooltip shows raw template tokens — provide a
        // custom formatter.  ThemeRiver params: { data: [date, value, name], color }
        if (hasThemeRiver && !option.tooltip.formatter) {
            option.tooltip.formatter = (params: any) => {
                if (!params || !params.data) return '';
                const [date, value, name] = params.data;
                const color = params.color || '#333';
                const dateStr = date instanceof Date ? date.toLocaleDateString() : String(date);
                return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;"></span>`
                    + `<b>${name}</b><br/>${dateStr}: ${value}`;
            };
        }
    }
}
