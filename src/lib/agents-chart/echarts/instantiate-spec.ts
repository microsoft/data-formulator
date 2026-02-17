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
export function ecApplyLayoutToSpec(
    option: any,
    context: InstantiateContext,
    warnings: ChartWarning[],
): void {
    const { channelSemantics, layout, canvasSize } = context;

    // ── Axis-less chart types (pie, radar) ────────────────────────────────
    // These set their own _width/_height and need no grid/axis processing.
    const hasAxes = !!(option.xAxis || option.yAxis);

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
        if (!alreadyPositioned) {
            const legendLabels: string[] = option.legend.data || [];

            if (isDualLegend) {
                // Dual legend: move categorical legend to the bottom
                option._legendWidth = 0; // no right-side space needed for the legend
                option.legend = {
                    ...option.legend,
                    bottom: 0,
                    left: 'center',
                    orient: 'horizontal',
                    textStyle: { fontSize: 11, ...(option.legend.textStyle || {}) },
                    ...(legendLabels.length > 10 ? { type: 'scroll' } : {}),
                };
            } else {
                // Single legend: keep on the right (default)
                const maxLabelLen = Math.max(...legendLabels.map((l: string) => (typeof l === 'string' ? l.length : 5)), 3);
                const estimatedLabelWidth = Math.min(120, maxLabelLen * 7 + 30); // icon + text + padding
                option._legendWidth = estimatedLabelWidth;

                option.legend = {
                    ...option.legend,
                    top: 0,
                    right: 10,
                    orient: option.legend.orient || 'vertical',
                    textStyle: { fontSize: 11, ...(option.legend.textStyle || {}) },
                    ...(legendLabels.length > 10 ? { type: 'scroll' } : {}),
                };
            }
        } else {
            // Already positioned — estimate width for grid margin
            const legendLabels: string[] = option.legend.data || [];
            const maxLabelLen = Math.max(...legendLabels.map((l: string) => (typeof l === 'string' ? l.length : 5)), 3);
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
    const legendWidth = (hasLegend ? (option._legendWidth || 120) : 20);
    // When dual legend moves the categorical legend to the bottom,
    // we need extra bottom margin instead of right margin.
    const bottomLegendExtra = isDualLegend ? 30 : 0;
    const gridMargin = {
        left:   (hasYTitle ? 70 : 50) + CANVAS_BUFFER,
        right:  (isDualLegend ? 20 : legendWidth) + CANVAS_BUFFER,
        top:    20 + CANVAS_BUFFER,
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

        if (xIsDiscrete && layout.xStepUnit !== 'group') {
            const xItemCount = layout.xNominalCount || layout.xContinuousAsDiscrete || 0;
            plotWidth = xItemCount > 0 ? layout.xStep * xItemCount : (layout.subplotWidth || canvasSize.width);
        } else {
            // Continuous axis or group-stepped axis — subplotWidth is already correct
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
                    // Grouped: each bar gets an equal share of the usable band
                    const usableStep = step * (1 - bandPadding);
                    const barW = Math.max(1, Math.floor(usableStep / barSeries.length));
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

        // ECharts uses degrees (positive = counter-clockwise)
        if (layout.xLabel.labelAngle && layout.xLabel.labelAngle !== 0) {
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

        if (layout.yLabel.labelAngle && layout.yLabel.labelAngle !== 0) {
            option.yAxis.axisLabel.rotate = -layout.yLabel.labelAngle;
        }
        if (layout.yLabel.fontSize) {
            option.yAxis.axisLabel.fontSize = layout.yLabel.fontSize;
        }
    }

    // ── Temporal format ──────────────────────────────────────────────────
    for (const axis of ['x', 'y'] as const) {
        const cs = channelSemantics[axis];
        if (cs?.temporalFormat && option[`${axis}Axis`]) {
            const axisObj = option[`${axis}Axis`];
            // Only apply temporal formatting to 'time' type axes.
            // For 'category' axes the values are already display-ready strings
            // (e.g. "2021", "Jan"); applying an ECharts template like {yyyy}
            // to a category axis renders the literal text "{yyyy}".
            if (axisObj.type === 'time') {
                if (!axisObj.axisLabel) axisObj.axisLabel = {};
                axisObj.axisLabel.formatter = convertTemporalFormat(cs.temporalFormat);
            }
            // For 'value' axes displaying timestamps, convert to a JS function
            if (axisObj.type === 'value' && cs.type === 'temporal') {
                if (!axisObj.axisLabel) axisObj.axisLabel = {};
                const fmt = cs.temporalFormat;
                axisObj.axisLabel.formatter = (val: number) => {
                    return formatTimestamp(val, fmt);
                };
            }
        }
    }

    // ── Color scheme ─────────────────────────────────────────────────────
    const colorCS = channelSemantics.color;
    if (colorCS?.colorScheme) {
        // ECharts uses option.color for categorical color arrays
        // For now we rely on the DEFAULT_COLORS set by templates
        // A full implementation would translate VL scheme names → EC palettes
    }

    // ── Overflow truncation markers ──────────────────────────────────────
    if (layout.truncations && layout.truncations.length > 0) {
        for (const trunc of layout.truncations) {
            warnings.push({
                severity: 'warning',
                code: 'overflow',
                message: trunc.message,
                channel: trunc.channel,
                field: trunc.field,
            });
            // ECharts: append placeholder to category data
            const axisKey = trunc.channel === 'x' ? 'xAxis' : 'yAxis';
            if (option[axisKey]?.data && Array.isArray(option[axisKey].data)) {
                option[axisKey].data.push(trunc.placeholder);
            }
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

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/**
 * Format a numeric timestamp using a d3-style format string.
 * Used for 'value' axes that hold temporal data (timestamps).
 */
function formatTimestamp(val: number, d3Format: string): string {
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

/**
 * Apply tooltips to an ECharts option.
 * ECharts tooltip is typically configured at the top level.
 */
export function ecApplyTooltips(option: any): void {
    if (!option.tooltip) {
        option.tooltip = {};
    }
    // Ensure trigger is set
    if (!option.tooltip.trigger) {
        const hasScatter = option.series?.some((s: any) => s.type === 'scatter');
        const hasPie = option.series?.some((s: any) => s.type === 'pie');
        const hasRadar = option.series?.some((s: any) => s.type === 'radar');
        const hasCandlestick = option.series?.some((s: any) => s.type === 'candlestick');
        const hasThemeRiver = option.series?.some((s: any) => s.type === 'themeRiver');
        option.tooltip.trigger = (hasScatter || hasPie || hasRadar || hasThemeRiver)
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
