// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Candlestick Chart template.
 *
 * Contrast with VL:
 *   VL: layered spec with rule (high→low) + bar (open→close) + conditional color
 *   EC: native `candlestick` series type — OHLC data format built-in
 *
 * ECharts candlestick is one of its strongest native chart types:
 *   - Built-in up/down coloring
 *   - Automatic tooltip with OHLC labels
 *   - Integrated with dataZoom for pan/zoom
 *
 * Channels: x (date/category), open, high, low, close
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories } from './utils';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

export const ecCandlestickDef: ChartTemplateDef = {
    chart: 'Candlestick Chart',
    template: { mark: 'candlestick', encoding: {} },
    channels: ['x', 'open', 'high', 'low', 'close', 'column', 'row'],
    markCognitiveChannel: 'position',

    declareLayoutMode: () => ({
        axisFlags: { x: { banded: true } },
    }),

    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xCS = channelSemantics.x;
        const openCS = channelSemantics.open;
        const highCS = channelSemantics.high;
        const lowCS = channelSemantics.low;
        const closeCS = channelSemantics.close;

        if (!xCS?.field) return;
        const xField = xCS.field;
        const openField = openCS?.field;
        const highField = highCS?.field;
        const lowField = lowCS?.field;
        const closeField = closeCS?.field;

        // Need at least open+close for a meaningful candlestick
        if (!openField || !closeField) return;

        const xIsDiscrete = isDiscrete(xCS.type);
        const xIsTemporal = xCS.type === 'temporal';
        const categories = xIsDiscrete
            ? extractCategories(table, xField, xCS.ordinalSortOrder)
            : undefined;

        // ── Build OHLC data ──────────────────────────────────────────────
        // ECharts candlestick data format: [open, close, low, high]
        // (note: EC ordering is open, close, low, high — NOT the typical OHLC)
        const candleData: [number, number, number, number][] = [];
        const xValues: string[] = [];

        for (const row of table) {
            const o = Number(row[openField]);
            const c = Number(row[closeField]);
            const h = highField ? Number(row[highField]) : Math.max(o, c);
            const l = lowField ? Number(row[lowField]) : Math.min(o, c);
            candleData.push([o, c, l, h]);
            xValues.push(String(row[xField]));
        }

        // ── Build option ─────────────────────────────────────────────────
        const option: any = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
            },
            xAxis: {
                type: xIsDiscrete ? 'category' : xIsTemporal ? 'category' : 'category',
                data: categories || xValues,
                name: xField,
                nameLocation: 'middle',
                nameGap: 30,
                boundaryGap: true,
                axisLine: { onZero: false },
                axisTick: { show: true, alignWithLabel: true },
            },
            yAxis: {
                type: 'value',
                scale: true,  // candlestick charts should never start at zero
                name: 'Price',
                nameLocation: 'middle',
                nameGap: 50,
                axisTick: { show: true },
                axisLabel: { rotate: 0 },
            },
            series: [{
                type: 'candlestick',
                data: candleData,
                itemStyle: {
                    color: '#06982d',        // bullish (close > open) — green
                    color0: '#ae1325',        // bearish (close < open) — red
                    borderColor: '#06982d',
                    borderColor0: '#ae1325',
                },
            }],
        };

        // ── Optional MA overlay ──────────────────────────────────────────
        if (chartProperties?.showMA) {
            const maWindow = chartProperties.maWindow ?? 5;
            const closePrices = table.map((r: any) => Number(r[closeField]));
            const maData = computeMA(closePrices, maWindow);
            option.series.push({
                name: `MA${maWindow}`,
                type: 'line',
                data: maData,
                smooth: true,
                lineStyle: { width: 1.5, opacity: 0.7 },
                symbol: 'none',
            });
            option.legend = { data: [`MA${maWindow}`] };
        }

        // ── DataZoom for large datasets ──────────────────────────────────
        if (table.length > 60) {
            const startPercent = Math.max(0, 100 - Math.round(60 / table.length * 100));
            option.dataZoom = [
                { type: 'inside', start: startPercent, end: 100 },
                { type: 'slider', start: startPercent, end: 100, bottom: 5, height: 20 },
            ];
            // Extra grid bottom padding so axis title + slider don't overlap
            option._dataZoomExtra = 35;
        }

        // ── Bar width auto-sizing ────────────────────────────────────────
        const plotWidth = ctx.canvasSize?.width || 400;
        const barWidth = Math.max(2, Math.min(20, Math.round(plotWidth * 0.6 / table.length)));
        option.series[0].barWidth = barWidth;

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },

    postProcess: (option) => {
        // Grow canvas to fit dataZoom slider below the axis title
        const extra = option._dataZoomExtra ?? 0;
        if (extra > 0) {
            if (!option.grid) option.grid = {};
            const curBottom = typeof option.grid.bottom === 'number' ? option.grid.bottom : 45;
            option.grid.bottom = curBottom + extra;
            if (typeof option._height === 'number') {
                option._height += extra;
            }
            delete option._dataZoomExtra;
        }
    },

    properties: [
        {
            key: 'showMA', label: 'Show Moving Avg', type: 'binary', defaultValue: false,
        } as ChartPropertyDef,
        {
            key: 'maWindow', label: 'MA Window', type: 'continuous',
            min: 3, max: 30, step: 1, defaultValue: 5,
        } as ChartPropertyDef,
    ],
};

/**
 * Compute simple moving average.
 * Returns null for the first (window-1) entries.
 */
function computeMA(prices: number[], window: number): (number | null)[] {
    const result: (number | null)[] = [];
    for (let i = 0; i < prices.length; i++) {
        if (i < window - 1) {
            result.push(null);
        } else {
            let sum = 0;
            for (let j = i - window + 1; j <= i; j++) {
                sum += prices[j];
            }
            result.push(Math.round(sum / window * 100) / 100);
        }
    }
    return result;
}
