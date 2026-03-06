// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Heatmap template.
 *
 * Contrast with VL:
 *   VL: mark = "rect" with x (nominal), y (nominal), color (quantitative)
 *   EC: series type = 'heatmap' with data = [[xIdx, yIdx, value], ...]
 *       and a visualMap component for the color scale.
 */

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';
import { extractCategories, DEFAULT_COLORS } from './utils';
import { getPaletteForScheme } from '../../core/color-decisions';

const isDiscrete = (type: string | undefined) => type === 'nominal' || type === 'ordinal';

/** True if all category labels parse as numbers → use horizontal labels; otherwise vertical. */
function areCategoriesNumeric(cats: string[]): boolean {
    if (cats.length === 0) return true;
    return cats.every((c) => {
        const s = String(c).trim();
        if (s === '') return false;
        const n = Number(s);
        return !isNaN(n) && isFinite(n);
    });
}

/** Map VL-style scheme names to ECharts built-in color ranges. */
const SCHEME_COLORS: Record<string, string[]> = {
    viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
    magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
    plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
    turbo: ['#30123b', '#4662d7', '#35abed', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#f66b19', '#d23105', '#7a0403'],
    blues: ['#f7fbff', '#6baed6', '#08519c'],
    reds: ['#fff5f0', '#fb6a4a', '#a50f15'],
    greens: ['#f7fcf5', '#74c476', '#00441b'],
    oranges: ['#fff5eb', '#fd8d3c', '#7f2704'],
    purples: ['#fcfbfd', '#9e9ac8', '#3f007d'],
    greys: ['#ffffff', '#969696', '#252525'],
    blueorange: ['#08519c', '#f7fbff', '#ff7f00'],
    redblue: ['#a50f15', '#ffffff', '#08519c'],
};

export const ecHeatmapDef: ChartTemplateDef = {
    chart: 'Heatmap',
    template: { mark: 'rect', encoding: {} },
    channels: ['x', 'y', 'color', 'column', 'row'],
    markCognitiveChannel: 'color',
    declareLayoutMode: () => ({
        axisFlags: { x: { banded: true }, y: { banded: true } },
        // 不使用 paramOverrides，与 Vega-Lite heatmap 共用同一套 layout 默认值
        //（minStep=6, defaultStepMultiplier=1），这样 ECharts 与 VL 的图表整体尺寸一致。
    }),
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties, colorDecisions } = ctx;
        const xCS = channelSemantics.x;
        const yCS = channelSemantics.y;
        const colorCS = channelSemantics.color;

        const xField = xCS?.field;
        const yField = yCS?.field;
        const colorField = colorCS?.field;
        if (!xField || !yField) return;

        const xCategories = extractCategories(table, xField, xCS?.ordinalSortOrder);
        const yCategories = extractCategories(table, yField, yCS?.ordinalSortOrder);

        // Build heatmap data: [xIndex, yIndex, value]
        const xIndexMap = new Map(xCategories.map((c, i) => [c, i]));
        const yIndexMap = new Map(yCategories.map((c, i) => [c, i]));

        const heatData: [number, number, number][] = [];
        let minVal = Infinity;
        let maxVal = -Infinity;

        // Aggregate if multiple rows per cell (sum)
        const cellMap = new Map<string, number>();
        for (const row of table) {
            const xKey = String(row[xField]);
            const yKey = String(row[yField]);
            const val = colorField ? (Number(row[colorField]) || 0) : 1;
            const cellKey = `${xKey}|||${yKey}`;
            cellMap.set(cellKey, (cellMap.get(cellKey) ?? 0) + val);
        }

        for (const [cellKey, val] of cellMap) {
            const [xKey, yKey] = cellKey.split('|||');
            const xi = xIndexMap.get(xKey);
            const yi = yIndexMap.get(yKey);
            if (xi !== undefined && yi !== undefined) {
                heatData.push([xi, yi, val]);
                if (val < minVal) minVal = val;
                if (val > maxVal) maxVal = val;
            }
        }

        if (minVal === Infinity) minVal = 0;
        if (maxVal === -Infinity) maxVal = 1;

        // Color scheme
        const schemeName = chartProperties?.colorScheme || 'viridis';
        // 优先使用 colorDecisions 决策出的 colormap；找不到时退回本地 SCHEME_COLORS。
        const decisionSchemeId = colorDecisions?.color?.schemeId ?? schemeName;
        const paletteFromDecision = getPaletteForScheme(decisionSchemeId);
        const schemeColors = paletteFromDecision && paletteFromDecision.length > 0
            ? paletteFromDecision
            : (SCHEME_COLORS[schemeName] || SCHEME_COLORS.viridis);

        const option: any = {
            tooltip: { position: 'top' },
            _encodingTooltip: {
                trigger: 'item',
                parts: [
                    { from: 'data', index: 0, label: xField, format: 'category', categoryNames: xCategories },
                    { from: 'data', index: 1, label: yField, format: 'category', categoryNames: yCategories },
                    { from: 'data', index: 2, label: colorField ?? 'Value', format: 'number' },
                ],
            },
            xAxis: {
                type: 'category',
                data: xCategories,
                name: xField,
                splitArea: { show: true },
                axisTick: { show: true, alignWithLabel: true },
                axisLabel: {
                    rotate: areCategoriesNumeric(xCategories) ? 0 : 90,
                },
            },
            yAxis: {
                type: 'category',
                data: yCategories,
                name: yField,
                splitArea: { show: true },
                axisTick: { show: true, alignWithLabel: true },
                axisLabel: { rotate: 0 },
            },
            visualMap: {
                min: minVal,
                max: maxVal,
                calculable: true,
                orient: 'horizontal',
                left: 'center',
                bottom: 0,
                inRange: {
                    color: schemeColors,
                },
            },
            series: [{
                type: 'heatmap',
                data: heatData,
                label: {
                    show: heatData.length <= 100,  // Show labels for small heatmaps
                },
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowColor: 'rgba(0, 0, 0, 0.5)',
                    },
                },
            }],
        };

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
    postProcess: (option, ctx) => {
        // Scale heatmap label font size based on cell dimensions
        const heatSeries = option.series?.find((s: any) => s.type === 'heatmap');

        const { layout } = ctx;
        const cellW = layout.xStep || 50;
        const cellH = layout.yStep || 50;
        const minDim = Math.min(cellW, cellH);

        if (heatSeries?.label) {
            // Scale font: 12px at 60px cell, down to 8px at 35px, hide below 30px
            if (minDim < 30) {
                heatSeries.label.show = false;
            } else {
                const fontSize = Math.max(8, Math.min(12, Math.round(minDim * 0.2)));
                heatSeries.label.fontSize = fontSize;
                // If cell is narrow, truncate displayed value
                if (cellW < 50) {
                    const maxChars = Math.max(2, Math.floor(cellW / (fontSize * 0.6)));
                    heatSeries.label.formatter = (params: any) => {
                        const val = params.data[2];
                        const s = String(val);
                        return s.length > maxChars ? s.slice(0, maxChars) : s;
                    };
                }
            }
        }

        // Make room for the visualMap bar below the chart
        // The bottom stack is: grid → x-axis labels → x-axis title → visualMap
        if (option.visualMap && option.grid) {
            const vmHeight = 50; // space for visualMap below the x-axis title
            option.grid.bottom = (option.grid.bottom || 30) + vmHeight;
            // Position visualMap at absolute bottom with a small margin
            option.visualMap.bottom = 5;
            if (option._height) {
                option._height += vmHeight;
            }
        }
    },
    properties: [
        {
            key: 'colorScheme', label: 'Scheme', type: 'discrete', options: [
                { value: undefined, label: 'Default (Viridis)' },
                { value: 'viridis', label: 'Viridis' },
                { value: 'inferno', label: 'Inferno' },
                { value: 'magma', label: 'Magma' },
                { value: 'plasma', label: 'Plasma' },
                { value: 'turbo', label: 'Turbo' },
                { value: 'blues', label: 'Blues' },
                { value: 'reds', label: 'Reds' },
                { value: 'greens', label: 'Greens' },
                { value: 'oranges', label: 'Oranges' },
                { value: 'purples', label: 'Purples' },
                { value: 'greys', label: 'Greys' },
                { value: 'blueorange', label: 'Blue-Orange (diverging)' },
                { value: 'redblue', label: 'Red-Blue (diverging)' },
            ],
        } as ChartPropertyDef,
    ],
};
