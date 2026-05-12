// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chart.js Scatter Plot template.
 *
 * Maps scatter semantics to Chart.js config:
 *   VL: encoding.x.field + encoding.y.field → positional channels
 *   CJS: datasets[].data = [{x, y}, ...] with type: 'scatter'
 */

import { ChartTemplateDef } from '../../core/types';
import {
    DEFAULT_COLORS,
    DEFAULT_BG_COLORS,
    getChartJsPalette,
    getSeriesBorderColor,
    getSeriesBackgroundColor,
} from './utils';

/** Compute a reasonable point radius based on canvas area and point count. */
function computePointRadius(width: number, height: number, pointCount: number): number {
    const canvasArea = width * height;
    const areaPerPoint = canvasArea / Math.max(1, pointCount);
    const idealRadius = Math.sqrt(areaPerPoint * 0.05) / 2;
    return Math.max(2, Math.min(6, Math.round(idealRadius)));
}

export const cjsScatterPlotDef: ChartTemplateDef = {
    chart: 'Scatter Plot',
    template: { mark: 'circle', encoding: {} },
    channels: ['x', 'y', 'color', 'size', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xField = channelSemantics.x?.field;
        const yField = channelSemantics.y?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField || !yField) return;

        const opacity = chartProperties?.opacity ?? 1;

        const palette = getChartJsPalette(ctx, 'color');

        const config: any = {
            type: 'scatter',
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: xField },
                    },
                    y: {
                        type: 'linear',
                        title: { display: true, text: yField },
                    },
                },
                plugins: {
                    tooltip: { enabled: true },
                },
            },
        };

        // Apply zero-baseline decisions
        // Chart.js linear scales default beginAtZero to false, so we must
        // explicitly set true when the semantic decision includes zero.
        if (channelSemantics.x?.zero) {
            config.options.scales.x.beginAtZero = channelSemantics.x.zero.zero !== false;
        }
        if (channelSemantics.y?.zero) {
            config.options.scales.y.beginAtZero = channelSemantics.y.zero.zero !== false;
        }

        if (colorField) {
            // Multi-series: group by color field
            const groups = new Map<string, { x: number; y: number }[]>();
            for (const row of table) {
                const key = String(row[colorField] ?? '');
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push({ x: row[xField], y: row[yField] });
            }

            let colorIdx = 0;
            for (const [name, data] of groups) {
                config.data.datasets.push({
                    label: name,
                    data,
                    backgroundColor: getSeriesBackgroundColor(palette, colorIdx, opacity),
                    borderColor: getSeriesBorderColor(palette, colorIdx),
                    borderWidth: 1,
                    pointRadius: 4,
                });
                colorIdx++;
            }
            config.options.plugins.legend = { display: true };
        } else {
            const data = table.map(row => ({ x: row[xField], y: row[yField] }));
            config.data.datasets.push({
                data,
                backgroundColor: getSeriesBackgroundColor(palette, 0, opacity),
                borderColor: getSeriesBorderColor(palette, 0),
                borderWidth: 1,
                pointRadius: 4,
            });
            config.options.plugins.legend = { display: false };
        }

        // Write Chart.js config into spec
        Object.assign(spec, config);
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'opacity', label: 'Opacity', type: 'continuous', min: 0.1, max: 1, step: 0.05, defaultValue: 1 },
    ],
    postProcess: (option, ctx) => {
        if (!option.data?.datasets) return;
        const w = option._width || ctx.canvasSize.width;
        const h = option._height || ctx.canvasSize.height;
        const pointCount = ctx.table.length;
        const radius = computePointRadius(w, h, pointCount);
        for (const ds of option.data.datasets) {
            if (ds.pointRadius == null || ds.pointRadius === 4) {
                ds.pointRadius = radius;
            }
        }
    },
};
