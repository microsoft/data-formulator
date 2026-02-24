// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Streamgraph template — uses native ThemeRiver series.
 *
 * Contrast with VL:
 *   VL: area mark with y.stack = "center" and y.axis = null
 *   EC: themeRiver series — purpose-built for streamgraphs
 *
 * ThemeRiver is ECharts' native streamgraph implementation:
 *   - Automatic center-aligned stacking (wiggle / silhouette baseline)
 *   - Built-in legend integration
 *   - Smooth transitions between series
 *
 * Channels: x (temporal/ordinal), y (quantitative), color (series groups)
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { groupBy, DEFAULT_COLORS } from './utils';

export const ecStreamgraphDef: ChartTemplateDef = {
    chart: 'Streamgraph',
    template: { mark: 'area', encoding: {} },
    channels: ['x', 'y', 'color', 'column', 'row'],
    markCognitiveChannel: 'area',

    declareLayoutMode: () => ({
        paramOverrides: { continuousMarkCrossSection: { x: 100, y: 20, seriesCountAxis: 'auto' } },
    }),

    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const colorField = channelSemantics.color?.field;

        if (!xCS?.field || !yCS?.field) return;
        const xField = xCS.field;
        const yField = yCS.field;

        // ── Build ThemeRiver data ────────────────────────────────────────
        // ThemeRiver data format: [[date, value, seriesName], ...]
        // All series must have entries for every x-value (fill with 0 if missing)

        if (!colorField) {
            // Without a color/series field, fall back to a simple area chart
            const option: any = {
                tooltip: { trigger: 'axis' },
                xAxis: {
                    type: xCS.type === 'temporal' ? 'time' : 'value',
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 30,
                },
                yAxis: { type: 'value', show: false },
                series: [{
                    type: 'line',
                    data: table.map(r => [r[xField], r[yField]]),
                    areaStyle: { opacity: 0.85 },
                    lineStyle: { width: 0.5 },
                    symbol: 'none',
                }],
            };
            Object.assign(spec, option);
            delete spec.mark;
            delete spec.encoding;
            return;
        }

        // Collect unique x-values in order (preserving data order)
        const xValSet = new Set<string>();
        const xVals: string[] = [];
        for (const row of table) {
            const xv = String(row[xField]);
            if (!xValSet.has(xv)) {
                xValSet.add(xv);
                xVals.push(xv);
            }
        }

        // Collect series names
        const groups = groupBy(table, colorField);
        const seriesNames = [...groups.keys()];

        // Build a lookup: (xVal, seriesName) → value
        const valMap = new Map<string, number>();
        for (const row of table) {
            const key = `${row[xField]}|||${row[colorField]}`;
            valMap.set(key, row[yField] ?? 0);
        }

        // Build themeRiver data array — every series must appear at every x-value
        const riverData: [string, number, string][] = [];
        for (const xv of xVals) {
            for (const sn of seriesNames) {
                const key = `${xv}|||${sn}`;
                riverData.push([xv, valMap.get(key) ?? 0, sn]);
            }
        }

        // ── Build option ─────────────────────────────────────────────────
        const option: any = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(0,0,0,0.2)', width: 1, type: 'solid' } },
            },
            legend: {
                data: seriesNames,
            },
            singleAxis: {
                type: xCS.type === 'temporal' ? 'time' : 'category',
                ...(xCS.type !== 'temporal' ? { data: xVals } : {}),
                bottom: 45,         // enough room for tick labels + axis name below
                name: xField,
                nameLocation: 'middle',
                nameGap: 25,
                nameTextStyle: { fontSize: 12 },
                axisLabel: { fontSize: 11 },
            },
            series: [{
                type: 'themeRiver',
                data: riverData,
                label: { show: false },
                emphasis: { focus: 'series' },
                itemStyle: {
                    borderWidth: 0.5,
                    borderColor: 'rgba(255,255,255,0.3)',
                },
            }],
        };

        // Apply color palette
        option.color = seriesNames.map((_, i) => DEFAULT_COLORS[i % DEFAULT_COLORS.length]);

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },

    postProcess: (option) => {
        // ThemeRiver uses singleAxis (not xAxis/yAxis).  The layout engine
        // now computes _width/_height for singleAxis charts too, but it uses
        // the grid-based margins (which assume xAxis/yAxis).  We adjust the
        // singleAxis margins and canvas to match consistently.
        if (option.singleAxis) {
            const BUFFER = 15;
            const hasLegend = !!option.legend;
            const rightMargin = hasLegend ? 130 : 20;

            // singleAxis positions: left/right control horizontal extent,
            // top/bottom control vertical extent
            option.singleAxis.left = option.singleAxis.left || 50;
            option.singleAxis.right = option.singleAxis.right || rightMargin;

            // Ensure canvas is large enough
            const minW = 600 + BUFFER;
            const minH = 350 + BUFFER;
            if (typeof option._width === 'number' && option._width < minW) {
                option._width = minW;
            }
            if (typeof option._height === 'number' && option._height < minH) {
                option._height = minH;
            }
            if (!option._width) option._width = minW;
            if (!option._height) option._height = minH;

            // Push the axis up from the canvas bottom to avoid clipping
            if (typeof option.singleAxis.bottom === 'number') {
                option.singleAxis.bottom += BUFFER;
            }
        }
    },

    properties: [
    ],
};
