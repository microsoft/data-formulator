// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * =============================================================================
 * PHASE 2: INSTANTIATE SPEC — Chart.js backend
 * =============================================================================
 *
 * Translates semantic decisions (Phase 0) and layout dimensions (Phase 1)
 * into Chart.js-specific config properties.
 *
 * Key differences from ECharts/Vega-Lite instantiation:
 *   - CJS uses { type, data: { labels, datasets[] }, options: { scales } }
 *   - CJS scales use 'x'/'y' keys (not xAxis/yAxis)
 *   - CJS sizing via canvas element dimensions + responsive: false
 *   - CJS label rotation via scales[axis].ticks.maxRotation
 *   - CJS stacking via stacked property on scales
 *   - CJS bar sizing via barPercentage and categoryPercentage
 *
 * CJS dependency: **Yes — this is where Chart.js-specific syntax lives**
 * =============================================================================
 */

import type {
    ChannelSemantics,
    LayoutResult,
    InstantiateContext,
    ChartWarning,
} from '../core/types';

/**
 * Phase 2: Apply layout and semantic decisions to the Chart.js config object.
 *
 * Handles common Chart.js plumbing across all templates:
 *   - Canvas sizing (_width, _height)
 *   - Axis label rotation and font sizing
 *   - Bar sizing (barPercentage, categoryPercentage)
 *   - Overflow truncation warnings
 */
export function cjsApplyLayoutToSpec(
    config: any,
    context: InstantiateContext,
    warnings: ChartWarning[],
): void {
    const { channelSemantics, layout, canvasSize } = context;

    // ── Axis-less chart types (pie, radar, doughnut) ─────────────────────
    const hasAxes = !!(config.options?.scales?.x || config.options?.scales?.y);
    const isRadar = config.type === 'radar';

    // ── Canvas dimensions ────────────────────────────────────────────────
    // Chart.js uses the canvas element dimensions.
    // For non-axis charts (pie, radar), templates set their own _width/_height.
    if (hasAxes && !config._width) {
        const PADDING = 80; // approximate space for axes, labels, legend

        const xIsDiscrete = layout.xNominalCount > 0 || layout.xContinuousAsDiscrete > 0;
        const yIsDiscrete = layout.yNominalCount > 0 || layout.yContinuousAsDiscrete > 0;

        let plotWidth: number;
        let plotHeight: number;

        if (xIsDiscrete && layout.xStepUnit !== 'group') {
            const xItemCount = layout.xNominalCount || layout.xContinuousAsDiscrete || 0;
            plotWidth = xItemCount > 0 ? layout.xStep * xItemCount : (layout.subplotWidth || canvasSize.width);
        } else {
            plotWidth = layout.subplotWidth || canvasSize.width;
        }

        if (yIsDiscrete && layout.yStepUnit !== 'group') {
            const yItemCount = layout.yNominalCount || layout.yContinuousAsDiscrete || 0;
            plotHeight = yItemCount > 0 ? layout.yStep * yItemCount : (layout.subplotHeight || canvasSize.height);
        } else {
            plotHeight = layout.subplotHeight || canvasSize.height;
        }

        config._width = plotWidth + PADDING;
        config._height = plotHeight + PADDING;
    }

    // ── Bar sizing ───────────────────────────────────────────────────────
    if (config.data?.datasets) {
        const barDatasets = config.data.datasets.filter(
            (ds: any) => config.type === 'bar' || ds.type === 'bar'
        );
        if (barDatasets.length > 0 && hasAxes) {
            const bandPadding = layout.stepPadding;
            // Chart.js uses:
            //   categoryPercentage: fraction of available space per category (default 0.8)
            //   barPercentage: fraction of category space per bar (default 0.9)
            // Total bar space = categoryPercentage × barPercentage
            const categoryPct = 1 - bandPadding;
            for (const ds of barDatasets) {
                if (ds.categoryPercentage == null) {
                    ds.categoryPercentage = categoryPct;
                }
            }
        }
    }

    // ── X-axis label sizing ──────────────────────────────────────────────
    if (hasAxes && config.options?.scales?.x && layout.xLabel) {
        if (!config.options.scales.x.ticks) config.options.scales.x.ticks = {};

        if (layout.xLabel.labelAngle && layout.xLabel.labelAngle !== 0) {
            config.options.scales.x.ticks.maxRotation = Math.abs(layout.xLabel.labelAngle);
            config.options.scales.x.ticks.minRotation = Math.abs(layout.xLabel.labelAngle);
        }

        if (layout.xLabel.fontSize) {
            config.options.scales.x.ticks.font = {
                ...(config.options.scales.x.ticks.font || {}),
                size: layout.xLabel.fontSize,
            };
        }
    }

    // ── Y-axis label sizing ──────────────────────────────────────────────
    if (hasAxes && config.options?.scales?.y && layout.yLabel) {
        if (!config.options.scales.y.ticks) config.options.scales.y.ticks = {};

        if (layout.yLabel.fontSize) {
            config.options.scales.y.ticks.font = {
                ...(config.options.scales.y.ticks.font || {}),
                size: layout.yLabel.fontSize,
            };
        }
    }

    // ── Overflow truncation warnings ─────────────────────────────────────
    if (layout.truncations && layout.truncations.length > 0) {
        for (const trunc of layout.truncations) {
            warnings.push({
                severity: 'warning',
                code: 'overflow',
                message: trunc.message,
                channel: trunc.channel,
                field: trunc.field,
            });
            // Chart.js: append placeholder to labels
            if (config.data?.labels && Array.isArray(config.data.labels)) {
                config.data.labels.push(trunc.placeholder);
            }
        }
    }
}

/**
 * Apply tooltips to a Chart.js config.
 * Chart.js tooltips are configured under options.plugins.tooltip.
 */
export function cjsApplyTooltips(config: any): void {
    if (!config.options) config.options = {};
    if (!config.options.plugins) config.options.plugins = {};
    if (!config.options.plugins.tooltip) {
        config.options.plugins.tooltip = { enabled: true };
    }
}
