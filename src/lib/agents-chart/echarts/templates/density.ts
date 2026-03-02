// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Density Plot — area from binned distribution (mirror vegalite/templates/density.ts).
 * Single channel x; optional color. Uses histogram bins then area chart as approximation.
 */

import { ChartTemplateDef } from '../../core/types';
import { groupBy, DEFAULT_COLORS } from './utils';

function binData(values: number[], numBins: number): { x: number[]; y: number[] } {
    if (values.length === 0) return { x: [], y: [] };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = (max - min) / numBins || 1;
    const bins = new Array(numBins + 1).fill(0);
    const edges = new Array(numBins + 1).fill(0).map((_, i) => min + i * step);

    for (const v of values) {
        const i = Math.min(Math.floor((v - min) / step), numBins - 1);
        bins[i]++;
    }

    const total = values.length;
    const x = edges.slice(0, -1).map((e, i) => (e + edges[i + 1]) / 2);
    const y = bins.slice(0, -1).map(c => c / total);
    return { x, y };
}

export const ecDensityPlotDef: ChartTemplateDef = {
    chart: 'Density Plot',
    template: { mark: 'area', encoding: {} },
    channels: ['x', 'color', 'column', 'row'],
    markCognitiveChannel: 'area',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xField = channelSemantics.x?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField) return;

        const numBins = Math.min(40, Math.max(10, Math.ceil(Math.sqrt(table.length))));
        const bandwidth = chartProperties?.bandwidth ?? 0.4;
        const bins = Math.max(10, Math.round(numBins / (1 + bandwidth)));

        const option: any = {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'value', name: xField, nameLocation: 'middle', nameGap: 30 },
            yAxis: { type: 'value', name: 'Density', nameLocation: 'middle', nameGap: 40 },
            series: [],
        };
        option._encodingTooltip = { trigger: 'axis', categoryLabel: xField, valueLabel: 'Density' };

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const values = rows.map((r: any) => Number(r[xField])).filter((v: number) => !isNaN(v));
                const { x, y } = binData(values, bins);
                const data = x.map((xi, i) => [xi, y[i]]);
                option.series.push({
                    name,
                    type: 'line',
                    data,
                    areaStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length], opacity: 0.5 },
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length] },
                });
                colorIdx++;
            }
        } else {
            const values = table.map((r: any) => Number(r[xField])).filter((v: number) => !isNaN(v));
            const { x, y } = binData(values, bins);
            const data = x.map((xi, i) => [xi, y[i]]);
            option.series.push({
                type: 'line',
                data,
                areaStyle: { opacity: 0.5 },
            });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
