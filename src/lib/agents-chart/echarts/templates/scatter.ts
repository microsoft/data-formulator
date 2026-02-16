// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Scatter Plot template.
 *
 * Maps scatter semantics to ECharts series-based config:
 *   VL: encoding.x.field + encoding.y.field → positional channels
 *   EC: series[].data = [[x, y], [x, y], ...] with type: 'scatter'
 */

import { ChartTemplateDef } from '../../core/types';
import { DEFAULT_COLORS } from './utils';

/** Compute a reasonable scatter symbolSize based on canvas area and point count. */
function computeSymbolSize(width: number, height: number, pointCount: number): number {
    // Target: each point occupies ~0.05% of canvas area (in px²), take sqrt for diameter.
    // 50pts @ 400×300 → areaPerPt=2400, 2400*0.05=120, √120≈11 → 11
    // 500pts @ 600×450 → areaPerPt=540,  540*0.05=27,  √27≈5   → 5
    // 1000pts @ 400×300 → areaPerPt=120, 120*0.05=6,   √6≈2.4  → 3 (min)
    const canvasArea = width * height;
    const areaPerPoint = canvasArea / Math.max(1, pointCount);
    const idealDiameter = Math.sqrt(areaPerPoint * 0.05);
    return Math.max(3, Math.min(12, Math.round(idealDiameter)));
}

export const ecScatterPlotDef: ChartTemplateDef = {
    chart: 'Scatter Plot',
    template: { mark: 'circle', encoding: {} },  // skeleton for compatibility
    channels: ['x', 'y', 'color', 'size', 'opacity', 'column', 'row'],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xField = channelSemantics.x?.field;
        const yField = channelSemantics.y?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField || !yField) return;

        // ECharts scatter uses direct data arrays
        const option: any = {
            tooltip: { trigger: 'item' },
            xAxis: {
                type: 'value',
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
            },
            yAxis: {
                type: 'value',
                name: yField,
                nameLocation: 'middle',
                nameGap: 40,
            },
            series: [],
        };

        // Apply zero-baseline decisions
        if (channelSemantics.x?.zero?.zero === false) {
            option.xAxis.scale = true;  // ECharts: scale=true means "don't force zero"
        }
        if (channelSemantics.y?.zero?.zero === false) {
            option.yAxis.scale = true;
        }

        // Opacity from chart properties
        const opacity = chartProperties?.opacity ?? 1;

        if (colorField) {
            // Multi-series: group by color field
            const groups = new Map<string, number[][]>();
            for (const row of table) {
                const key = String(row[colorField] ?? '');
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push([row[xField], row[yField]]);
            }

            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, data] of groups) {
                option.series.push({
                    name,
                    type: 'scatter',
                    data,
                    itemStyle: {
                        color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length],
                        opacity,
                    },
                });
                colorIdx++;
            }
        } else {
            // Single series
            const data = table.map(row => [row[xField], row[yField]]);
            option.series.push({
                type: 'scatter',
                data,
                itemStyle: { opacity },
            });
        }

        // Write the ECharts option into the spec object
        Object.assign(spec, option);
        // Clear VL skeleton
        delete spec.mark;
        delete spec.encoding;
    },
    properties: [
        { key: 'opacity', label: 'Opacity', type: 'continuous', min: 0.1, max: 1, step: 0.05, defaultValue: 1 },
    ],
    postProcess: (option, ctx) => {
        if (!option.series || !Array.isArray(option.series)) return;
        const w = option._width || ctx.canvasSize.width;
        const h = option._height || ctx.canvasSize.height;
        const pointCount = ctx.table.length;
        const size = computeSymbolSize(w, h, pointCount);
        for (const series of option.series) {
            if (series.type === 'scatter' && series.symbolSize == null) {
                series.symbolSize = size;
            }
        }
    },
};
