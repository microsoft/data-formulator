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
import { formatTimestamp } from '../instantiate-spec';
import { DEFAULT_COLORS, groupBy, getCategoryOrder, extractCategories } from './utils';

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
        const sizeField = channelSemantics.size?.field;
        const sizeRange = (ctx.resolvedEncodings as any)?.size?.sizeRange as [number, number] | undefined;
        const sizeType = channelSemantics.size?.type;

        if (!xField || !yField) return;

        // ECharts symbolSize is pixel diameter; buildECEncodings outputs sizeRange in pixels [4, 28]
        const EC_SIZE_MIN = 4;
        const EC_SIZE_MAX = 30;
        let rangeMin = Math.max(EC_SIZE_MIN, Math.min(EC_SIZE_MAX, sizeRange?.[0] ?? 6));
        let rangeMaxClamped = Math.max(EC_SIZE_MIN, Math.min(EC_SIZE_MAX, sizeRange?.[1] ?? 20));
        rangeMaxClamped = Math.max(rangeMin, rangeMaxClamped);
        // Fallback: ensure a visible spread if sizeRange was degenerate
        if (rangeMaxClamped <= rangeMin) {
            rangeMin = EC_SIZE_MIN;
            rangeMaxClamped = EC_SIZE_MAX;
        }

        // VL: ordinal/nominal (Rank, Level, etc.) → ordered domain, map by index. Quantitative/temporal with many unique values → sqrt scale.
        // When resolved type is quantitative but unique count is small (e.g. 4 levels), treat as discrete priority levels → ordinal by index.
        // If type is missing/wrong but data are 2–12 discrete non-numeric levels (e.g. "Low","Medium","High","Critical"), treat as ordinal.
        const sizeUniqueCount = sizeField && table.length > 0
            ? new Set(table.map((r: any) => String(r[sizeField]))).size
            : 0;
        const sizeValuesSample = sizeField && table.length > 0
            ? table.slice(0, 50).map((r: any) => r[sizeField]).filter((v: any) => v != null)
            : [];
        const allSizeValuesNumeric = sizeValuesSample.length > 0 && sizeValuesSample.every((v: any) => !isNaN(Number(v)) && String(v).trim() !== '');
        const useOrdinalSize =
            sizeType === 'ordinal' ||
            sizeType === 'nominal' ||
            (sizeType === 'quantitative' && sizeUniqueCount >= 2 && sizeUniqueCount <= 12) ||
            (sizeField && sizeUniqueCount >= 2 && sizeUniqueCount <= 12 && !allSizeValuesNumeric);

        let scaleSize: (raw: number | string | null | undefined) => number;
        let sizeOrderForLegend: string[] | undefined;
        /** For quantitative size: data domain for size legend (VL-style). */
        let sizeDomainMin: number | undefined;
        let sizeDomainMax: number | undefined;

        if (useOrdinalSize && sizeField) {
            // Discrete levels (Rank, Level, etc.): ordered domain → size by index (VL ordinal scale).
            // VL: sort = ordinalSortOrder when set, else sort = null → domain order = data encounter order.
            // We align: getCategoryOrder(ctx, 'size') when present; otherwise extractCategories(..., undefined)
            // preserves first-occurrence order, matching VL.
            const sizeOrder = extractCategories(table, sizeField, getCategoryOrder(ctx, 'size'));
            sizeOrderForLegend = sizeOrder;
            const orderMap = new Map<string, number>(sizeOrder.map((val, i) => [String(val), i]));
            const n = sizeOrder.length;
            scaleSize = (raw: number | string | null | undefined): number => {
                if (raw == null) return rangeMin;
                const key = String(raw);
                const index = orderMap.get(key);
                if (index === undefined) return rangeMin;
                const t = n > 1 ? index / (n - 1) : 0;
                return Math.round(rangeMin + t * (rangeMaxClamped - rangeMin));
            };
        } else if (sizeField) {
            // Continuous quantitative/temporal: sqrt scale over numeric domain (VL size scale type: sqrt, zero: true).
            const vals = table
                .map((r: any) => r[sizeField])
                .map((v: any) => (v != null ? Number(v) : NaN))
                .filter((v: number) => !isNaN(v));
            const sizeMin = vals.length ? Math.min(...vals) : 0;
            const sizeMax = vals.length ? Math.max(...vals) : 1;
            sizeDomainMin = sizeMin;
            sizeDomainMax = sizeMax;
            scaleSize = (raw: number | string | null | undefined): number => {
                const v = raw != null ? Number(raw) : NaN;
                if (isNaN(v)) return rangeMin;
                let t: number;
                if (sizeMax === sizeMin) t = 0.5;
                else {
                    const sqrtMin = Math.sqrt(Math.max(0, sizeMin));
                    const sqrtMax = Math.sqrt(Math.max(0, sizeMax));
                    const sqrtV = Math.sqrt(Math.max(0, v));
                    t = (sqrtV - sqrtMin) / (sqrtMax - sqrtMin);
                }
                t = Math.max(0, Math.min(1, t));
                return Math.round(rangeMin + t * (rangeMaxClamped - rangeMin));
            };
        } else {
            scaleSize = () => rangeMin;
        }

        // When ordinal size has a discrete order, use piecewise visualMap; when quantity, use continuous visualMap (scatter-aqi-color style).
        const usePiecewiseSizeVisualMap = sizeOrderForLegend && sizeOrderForLegend.length > 0 && sizeField;
        const useContinuousSizeVisualMap = sizeField != null && sizeDomainMin !== undefined && sizeDomainMax !== undefined;
        const useVisualMapForSize = usePiecewiseSizeVisualMap || useContinuousSizeVisualMap;

        // X/Y can be value (quantitative/temporal) or category (nominal/ordinal) — align with VL
        const xType = channelSemantics.x?.type;
        const yType = channelSemantics.y?.type;
        const xIsCategorical = xType === 'nominal' || xType === 'ordinal';
        const yIsCategorical = yType === 'nominal' || yType === 'ordinal';
        const xCategories = xIsCategorical ? extractCategories(table, xField, getCategoryOrder(ctx, 'x')) : [];
        const yCategories = yIsCategorical ? extractCategories(table, yField, getCategoryOrder(ctx, 'y')) : [];
        const xCategoryToIndex = new Map<string, number>(xCategories.map((c, i) => [String(c), i]));
        const yCategoryToIndex = new Map<string, number>(yCategories.map((c, i) => [String(c), i]));

        // ECharts scatter uses direct data arrays
        const option: any = {
            tooltip: { trigger: 'item' },
            xAxis: xIsCategorical
                ? {
                    type: 'category',
                    data: xCategories,
                    name: xField,
                    nameLocation: 'middle',
                    nameGap: 30,
                    axisLabel: { interval: 0, rotate: 90 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                }
                : { type: 'value', name: xField, nameLocation: 'middle', nameGap: 30 },
            yAxis: yIsCategorical
                ? {
                    type: 'category',
                    data: yCategories,
                    name: yField,
                    nameLocation: 'middle',
                    nameGap: 40,
                    axisLabel: { interval: 0, rotate: 0 },
                    axisTick: { show: true, alignWithLabel: true },
                    axisLine: { show: true },
                }
                : { type: 'value', name: yField, nameLocation: 'middle', nameGap: 40 },
            series: [],
        };

        if (usePiecewiseSizeVisualMap) {
            // Piecewise visualMap maps dimension 2 to symbolSize; hide default UI and use custom graphic legend (Vega-Lite style: different sized circles, label on the right).
            option.visualMap = [
                {
                    type: 'piecewise',
                    show: false,
                    dimension: 2,
                    pieces: sizeOrderForLegend!.map((name) => ({
                        value: name,
                        symbolSize: scaleSize(name),
                    })),
                    orient: 'vertical',
                    right: 10,
                    top: 'center',
                    itemGap: 8,
                    itemSymbol: 'circle',
                    formatter: (value: string) => value,
                    title: sizeField,
                },
            ];
            option._visualMapWidth = 88;
            // One group for the whole legend; all coordinates use left/top so text aligns left
            const ordLegendRight = 28;
            const ordGap = 8;
            const ordRowGap = 6;
            const ordFontSize = 10;
            const ordTitleHeight = 20;
            const ordLabelWidth = 44;
            const canvasH = ctx.canvasSize?.height ?? 300;
            const maxCircleR = Math.max(...sizeOrderForLegend!.map((name) => scaleSize(name) / 2));
            const legendWidth = ordLabelWidth + ordGap + 2 * maxCircleR;
            const scatterColor = (ctx.resolvedEncodings as any)?.color?.colorPalette?.[0] ?? DEFAULT_COLORS[0];
            const rowHeights = sizeOrderForLegend!.map((name) => Math.max(scaleSize(name), 16) + ordRowGap);
            const totalLegendHeight = ordTitleHeight + rowHeights.reduce((a, b) => a + b, 0);
            const ordLegendTop = Math.max(10, (canvasH - totalLegendHeight) / 2);
            const legendChildren: any[] = [
                {
                    type: 'text' as const,
                    left: 0,
                    top: 0,
                    style: {
                        text: sizeField,
                        fontSize: 11,
                        fontWeight: 'bold',
                        fill: '#333',
                        textAlign: 'left',
                    },
                },
            ];
            let rowTop = ordTitleHeight;
            for (let i = 0; i < sizeOrderForLegend!.length; i++) {
                const name = sizeOrderForLegend![i];
                const r = scaleSize(name) / 2;
                const rowH = rowHeights[i];
                const circleTop = rowTop + (rowH - scaleSize(name)) / 2;
                const textTop = rowTop + (rowH - ordFontSize) / 2;
                legendChildren.push({
                    type: 'circle' as const,
                    left: maxCircleR - r,
                    top: circleTop - r,
                    shape: { cx: r, cy: r, r },
                    style: { fill: scatterColor },
                });
                legendChildren.push({
                    type: 'text' as const,
                    left: 2 * maxCircleR + ordGap,
                    top: textTop,
                    style: {
                        text: name,
                        fontSize: ordFontSize,
                        fill: '#333',
                        textAlign: 'left',
                    },
                });
                rowTop += rowH;
            }
            const ordLegendGraphic = {
                type: 'group' as const,
                right: ordLegendRight,
                top: ordLegendTop,
                width: legendWidth,
                z: 100,
                children: legendChildren,
            };
            const existingGraphic = option.graphic;
            option.graphic = Array.isArray(existingGraphic)
                ? [...existingGraphic, ordLegendGraphic]
                : existingGraphic
                    ? [existingGraphic, ordLegendGraphic]
                    : [ordLegendGraphic];
        } else if (useContinuousSizeVisualMap) {
            // Quantity size: continuous visualMap (scatter-aqi-color style), inRange.symbolSize maps dimension to size.
            // Enforce a minimum spread so circles are visibly different (ECharts maps data linearly to [min, max]).
            const SIZE_SPREAD_MIN = 20;
            const sizeMaxForMap = Math.max(rangeMaxClamped, rangeMin + SIZE_SPREAD_MIN);
            const fmtSize = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
            const sizeVisualMap = {
                type: 'continuous' as const,
                show: true,
                min: sizeDomainMin!,
                max: sizeDomainMax!,
                dimension: 2,
                inRange: { symbolSize: [rangeMin, sizeMaxForMap] as [number, number] },
                orient: 'vertical',
                right: 50,
                top: '10.0%',
                bottom: '10.0%',
                padding: 0,
                itemGap: 0,
                text: [fmtSize(sizeDomainMax!), fmtSize(sizeDomainMin!)] as [string, string],
                textStyle: { fontSize: 10 },
                seriesIndex: 0,
                name: sizeField,
            };
            if (option.visualMap) {
                (option.visualMap as any[]).push(sizeVisualMap);
            } else {
                option.visualMap = [sizeVisualMap];
            }
            option._visualMapWidth = 70;
            option.graphic = option.graphic || [];
            const existingGraphic = Array.isArray(option.graphic) ? option.graphic : [option.graphic];
            option.graphic = [
                ...existingGraphic,
                {
                    type: 'text' as const,
                    right: 50,
                    top: 10,
                    z: 100,
                    style: {
                        text: sizeField,
                        fontSize: 11,
                        fontWeight: 'bold',
                        fill: '#333',
                        textAlign: 'right',
                    },
                },
            ];
        }

        // Apply zero-baseline decisions (only for value axes)
        // ECharts: scale=true means "data-fit, don't force zero"
        //          scale=false (default) means "include zero"
        if (!xIsCategorical && channelSemantics.x?.zero) {
            option.xAxis.scale = !channelSemantics.x.zero.zero;
        }
        if (!yIsCategorical && channelSemantics.y?.zero) {
            option.yAxis.scale = !channelSemantics.y.zero.zero;
        }

        // Opacity from chart properties
        const opacity = chartProperties?.opacity ?? 1;

        const xVal = (row: any) => xIsCategorical ? (xCategoryToIndex.get(String(row[xField] ?? '')) ?? 0) : row[xField];
        const yVal = (row: any) => yIsCategorical ? (yCategoryToIndex.get(String(row[yField] ?? '')) ?? 0) : row[yField];
        const pointData = (row: any) =>
            sizeField != null
                ? [xVal(row), yVal(row), row[sizeField]]
                : [xVal(row), yVal(row)];

        // Palette from resolvedEncodings (scheme) or fallback to DEFAULT_COLORS
        const colorPalette = (ctx.resolvedEncodings as any)?.color?.colorPalette
            ?? (ctx.resolvedEncodings as any)?.group?.colorPalette
            ?? DEFAULT_COLORS;
        const legendOpts = (ctx.resolvedEncodings as any)?.color ?? (ctx.resolvedEncodings as any)?.group;
        const colorType = channelSemantics.color?.type ?? (ctx.resolvedEncodings as any)?.color?.type;
        const isTemporalColor = colorField && colorType === 'temporal';
        const isContinuousColor = colorField && (colorType === 'quantitative' || colorType === 'temporal');

        if (isContinuousColor) {
            // VL: color type quantitative → numeric scale; temporal → timestamp scale (mirror VL type "temporal" + legend format "%b %d, %Y").
            const colorDim = sizeField != null ? 3 : 2; // data: [x, y, size?, colorVal]
            const toColorVal = isTemporalColor
                ? (v: any) => (v != null ? new Date(v).getTime() : NaN)
                : (v: any) => (v != null ? Number(v) : NaN);
            const pointDataWithColor = (row: any) => {
                const x = xVal(row);
                const y = yVal(row);
                const c = toColorVal(row[colorField]);
                if (sizeField != null) return [x, y, row[sizeField], c];
                return [x, y, c];
            };
            const colorVals = table
                .map((r: any) => toColorVal(r[colorField]))
                .filter((v: number) => !isNaN(v));
            const colorMin = colorVals.length ? Math.min(...colorVals) : (isTemporalColor ? Date.now() : 0);
            const colorMax = colorVals.length ? Math.max(...colorVals) : (isTemporalColor ? Date.now() : 1);
            const scheme = (ctx.encodings as any)?.color?.scheme ?? '';
            // Default visualMap color bar: gray gradient (light → dark)
            const defaultGrayRange = ['#f5f5f5', '#e0e0e0', '#9e9e9e', '#616161', '#424242'];
            const greensRange = ['#f7fcf5', '#c7e9c0', '#41ab5d', '#006d2c', '#00441b'];
            // Continuous colormap: default gray; optional scheme override (e.g. green) or palette.
            const inRange = /green/i.test(scheme)
                ? greensRange
                : colorPalette.length >= 2
                    ? [colorPalette[colorPalette.length - 1], colorPalette[0]]  // light → dark
                    : defaultGrayRange;
            // Layout: when both size and color visualMap exist, place them side by side (size right, color left)
            const VM_BAR_RIGHT = 50;
            const VM_BAR_WIDTH = 70;
            const VM_GAP = 16;
            const VM_VAL_RIGHT = 28;
            const VM_TITLE_TOP = 10;
            const VM_FONT_SIZE = 10;
            const REF_H = 400;
            const VM_BAR_TOP_PX = 40;
            const VM_BAR_BOTTOM_PX = 40;
            const VM_TOP_PCT = ((VM_BAR_TOP_PX / REF_H) * 100).toFixed(1) + '%';
            const VM_BOTTOM_PCT = ((VM_BAR_BOTTOM_PX / REF_H) * 100).toFixed(1) + '%';
            const hasSizeVisualMap = option.visualMap && Array.isArray(option.visualMap)
                && option.visualMap.some((vm: any) => vm.inRange?.symbolSize != null);
            const colorBarRight = hasSizeVisualMap ? VM_BAR_RIGHT + VM_BAR_WIDTH + VM_GAP : VM_BAR_RIGHT;
            const temporalFormat = channelSemantics.color?.temporalFormat ?? '%b %d, %Y';
            const formatColorLabel = (val: number) =>
                isTemporalColor ? formatTimestamp(val, temporalFormat) : String(val);
            // Use visualMap's built-in text for max/min so labels are positioned by ECharts and align with the bar.
            // text[0] = high (top), text[1] = low (bottom) per ContinuousView.
            const colorVisualMap = {
                type: 'continuous' as const,
                min: colorMin,
                max: colorMax,
                dimension: colorDim,
                inRange: { color: inRange },
                orient: 'vertical',
                right: colorBarRight,
                top: VM_TOP_PCT,
                bottom: VM_BOTTOM_PCT,
                padding: 0,
                itemGap: 0,
                text: [formatColorLabel(colorMax), formatColorLabel(colorMin)] as [string, string],
                formatter: formatColorLabel,
                textStyle: { fontSize: VM_FONT_SIZE },
                show: true,
                seriesIndex: 0,
                name: colorField,
            };
            if (option.visualMap) {
                (option.visualMap as any[]).push(colorVisualMap);
            } else {
                option.visualMap = colorVisualMap;
            }
            option._visualMapWidth = hasSizeVisualMap ? VM_BAR_WIDTH + VM_GAP + VM_BAR_WIDTH : VM_BAR_WIDTH;
            // Only the title is custom graphic; max/min come from visualMap.text above.
            const vmGraphics: any[] = [
                {
                    type: 'text' as const,
                    right: colorBarRight,
                    top: VM_TITLE_TOP,
                    z: 100,
                    style: {
                        text: colorField,
                        fontSize: 11,
                        fontWeight: 'bold',
                        fill: '#333',
                        textAlign: 'right',
                    },
                },
            ];
            const existingGraphic = option.graphic;
            option.graphic = Array.isArray(existingGraphic)
                ? [...existingGraphic, ...vmGraphics]
                : existingGraphic
                    ? [existingGraphic, ...vmGraphics]
                    : vmGraphics;
            const data = table.map((row: any) => pointDataWithColor(row));
            const seriesOpt: any = {
                type: 'scatter',
                data,
                itemStyle: { opacity },
            };
            if (sizeField != null && !useVisualMapForSize) {
                seriesOpt.symbolSize = (value: number[] | number) => scaleSize(Array.isArray(value) ? value[2] : value);
            }
            option.series.push(seriesOpt);
        } else if (colorField) {
            // Categorical color: one series per category, legend with category names
            const colorOrder = extractCategories(table, colorField, getCategoryOrder(ctx, 'color'));
            const groups = new Map<string, number[][]>();
            for (const row of table) {
                const key = String(row[colorField] ?? '');
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(pointData(row) as number[]);
            }

            const legendNames = colorOrder.length > 0 ? colorOrder : [...groups.keys()];
            const hasSizeBySeries = sizeField != null && !useVisualMapForSize;
            option.legend = {
                data: legendNames.map((name) => {
                    const data = groups.get(name) ?? [];
                    if (!hasSizeBySeries || data.length === 0) return name;
                    const sizes = data.map((d: number[]) => (d.length >= 3 ? scaleSize(d[2]) : rangeMin));
                    sizes.sort((a, b) => a - b);
                    const medianSize = sizes[Math.floor(sizes.length / 2)] ?? rangeMin;
                    return { name, symbolSize: medianSize, itemStyle: { symbolSize: medianSize } };
                }),
                show: true,
            };
            option._legendTitle = colorField;
            if (legendOpts?.legendSymbolSize != null && !hasSizeBySeries) {
                option.legend.itemWidth = legendOpts.legendSymbolSize;
                option.legend.itemHeight = legendOpts.legendSymbolSize;
                option.legend.itemGap = 8;
            }
            if (legendOpts?.legendLabelFontSize != null) {
                option.legend.textStyle = option.legend.textStyle ?? {};
                option.legend.textStyle.fontSize = legendOpts.legendLabelFontSize;
            }

            legendNames.forEach((name) => {
                const data = groups.get(name) ?? [];
                if (data.length === 0) return;
                const colorIdx = colorOrder.indexOf(name);
                const seriesOpt: any = {
                    name,
                    type: 'scatter',
                    data,
                    itemStyle: {
                        color: colorPalette[colorIdx % colorPalette.length],
                        opacity,
                    },
                };
                if (hasSizeBySeries) {
                    seriesOpt.symbolSize = (value: number[] | number) => scaleSize(Array.isArray(value) ? value[2] : value);
                }
                option.series.push(seriesOpt);
            });
        } else {
            const data = table.map((row: any) => pointData(row));
            const seriesOpt: any = {
                type: 'scatter',
                data,
                itemStyle: { opacity },
            };
            if (sizeField != null && !useVisualMapForSize) {
                seriesOpt.symbolSize = (value: number[] | number) => scaleSize(Array.isArray(value) ? value[2] : value);
            } else if (useContinuousSizeVisualMap && sizeDomainMin !== undefined && sizeDomainMax !== undefined) {
                // Apply same linear mapping as visualMap so circles are sized correctly (visualMap may not drive symbolSize in all environments)
                const SIZE_SPREAD_MIN = 20;
                const sizeSpread = Math.max(rangeMaxClamped - rangeMin, SIZE_SPREAD_MIN);
                const sizeMaxMapped = rangeMin + sizeSpread;
                seriesOpt.symbolSize = (value: number[] | number) => {
                    const v = Array.isArray(value) ? value[2] : value;
                    const num = Number(v);
                    if (v == null || isNaN(num)) return rangeMin;
                    const span = sizeDomainMax! - sizeDomainMin!;
                    const t = span <= 0 ? 0.5 : Math.max(0, Math.min(1, (num - sizeDomainMin!) / span));
                    return Math.round(rangeMin + t * (sizeMaxMapped - rangeMin));
                };
            }
            option.series.push(seriesOpt);
        }

        // Tooltip: show all encodings (Vega-Lite style) — x, y, size, color/segment
        const xName = option.xAxis?.name ?? xField ?? 'X';
        const yName = option.yAxis?.name ?? yField ?? 'Y';
        const sizeName = sizeField ?? null;
        const colorName = colorField ?? null;
        const temporalFormat = channelSemantics.color?.temporalFormat ?? '%b %d, %Y';
        const fmtNum = (v: unknown) => {
            if (v == null) return '';
            const n = Number(v);
            return isNaN(n) ? String(v) : (Number.isInteger(n) ? String(n) : n.toFixed(1));
        };
        const fmtColorVal = (v: unknown) => {
            if (v == null) return '';
            if (isTemporalColor) return formatTimestamp(Number(v), temporalFormat);
            return fmtNum(v);
        };
        option.tooltip = option.tooltip ?? {};
        option.tooltip.formatter = (params: any) => {
            if (!params?.data) return '';
            const d = Array.isArray(params.data) ? params.data : [params.data];
            const parts: string[] = [];
            const xDisplay = xIsCategorical ? (xCategories[Number(d[0])] ?? String(d[0])) : fmtNum(d[0]);
            const yDisplay = yIsCategorical ? (yCategories[Number(d[1])] ?? String(d[1])) : fmtNum(d[1]);
            parts.push(`${xName}: ${xDisplay}`);
            parts.push(`${yName}: ${yDisplay}`);
            if (sizeName != null && d[2] !== undefined) parts.push(`${sizeName}: ${fmtNum(d[2])}`);
            if (colorName != null) {
                const colorVal = isContinuousColor ? d[sizeField != null ? 3 : 2] : params.seriesName;
                parts.push(`${colorName}: ${isContinuousColor ? fmtColorVal(colorVal) : (colorVal ?? '')}`);
            }
            return parts.join('<br/>');
        };

        // When there are multiple series (e.g. categorical color), size visualMap must apply to all of them
        const vmList = Array.isArray(option.visualMap) ? option.visualMap : (option.visualMap ? [option.visualMap] : []);
        const seriesCount = option.series?.length ?? 0;
        if (seriesCount > 1) {
            const allIndices = option.series!.map((_: any, i: number) => i);
            for (const vm of vmList) {
                if (vm.type === 'continuous' && vm.inRange?.symbolSize != null) {
                    vm.seriesIndex = allIndices;
                }
            }
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
        // When visualMap controls symbolSize (piecewise ordinal or continuous quantity), do not override series.symbolSize
        const vmList = Array.isArray(option.visualMap) ? option.visualMap : (option.visualMap ? [option.visualMap] : []);
        const visualMapControlsSize = vmList.some(
            (vm: any) =>
                (vm.type === 'piecewise' && Array.isArray(vm.pieces) && vm.pieces.some((p: any) => p.symbolSize != null))
                || (vm.type === 'continuous' && vm.inRange?.symbolSize != null),
        );
        if (visualMapControlsSize) return;
        const w = option._width || ctx.canvasSize.width;
        const h = option._height || ctx.canvasSize.height;
        const pointCount = ctx.table.length;
        const size = computeSymbolSize(w, h, pointCount);
        for (const series of option.series) {
            if (series.type !== 'scatter') continue;
            // Series has size encoding (data is [x, y, size]): keep template-set symbolSize function, do not override
            const hasSizeEncoding = series.data?.length && Array.isArray(series.data[0]) && (series.data[0] as number[]).length >= 3;
            if (hasSizeEncoding) continue;
            if (series.symbolSize == null) {
                series.symbolSize = size;
            }
        }
    },
};

/** Simple linear regression: slope and intercept (mirror vegalite Linear Regression). */
function linearRegression(data: number[][]): { slope: number; intercept: number; xMin: number; xMax: number } {
    const n = data.length;
    if (n === 0) return { slope: 0, intercept: 0, xMin: 0, xMax: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    let xMin = data[0][0], xMax = data[0][0];
    for (const [x, y] of data) {
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) || 0;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept, xMin, xMax };
}

/**
 * Linear Regression — scatter + trend line (mirror vegalite/templates/scatter.ts linearRegressionDef).
 */
export const ecLinearRegressionDef: ChartTemplateDef = {
    chart: 'Linear Regression',
    template: { mark: 'circle', encoding: {} },
    channels: ['x', 'y', 'size', 'color', 'column', 'row'],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { channelSemantics, table, chartProperties } = ctx;
        const xField = channelSemantics.x?.field;
        const yField = channelSemantics.y?.field;
        const colorField = channelSemantics.color?.field;

        if (!xField || !yField) return;

        const option: any = {
            tooltip: { trigger: 'item' },
            xAxis: { type: 'value', name: xField, nameLocation: 'middle', nameGap: 30 },
            yAxis: { type: 'value', name: yField, nameLocation: 'middle', nameGap: 40 },
            series: [],
        };

        if (channelSemantics.x?.zero) option.xAxis.scale = !channelSemantics.x.zero.zero;
        if (channelSemantics.y?.zero) option.yAxis.scale = !channelSemantics.y.zero.zero;

        const opacity = chartProperties?.opacity ?? 1;

        if (colorField) {
            const groups = groupBy(table, colorField);
            option.legend = { data: [...groups.keys()] };
            let colorIdx = 0;
            for (const [name, rows] of groups) {
                const data = rows.map((r: any) => [r[xField], r[yField]]);
                const reg = linearRegression(data);
                const lineData = [[reg.xMin, reg.slope * reg.xMin + reg.intercept], [reg.xMax, reg.slope * reg.xMax + reg.intercept]];
                option.series.push({
                    name,
                    type: 'scatter',
                    data,
                    itemStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length], opacity },
                });
                option.series.push({
                    name: `${name} (trend)`,
                    type: 'line',
                    data: lineData,
                    showSymbol: false,
                    lineStyle: { color: DEFAULT_COLORS[colorIdx % DEFAULT_COLORS.length], width: 2 },
                });
                colorIdx++;
            }
        } else {
            const data = table.map((r: any) => [r[xField], r[yField]]);
            const reg = linearRegression(data);
            const lineData = [[reg.xMin, reg.slope * reg.xMin + reg.intercept], [reg.xMax, reg.slope * reg.xMax + reg.intercept]];
            option.series.push({ type: 'scatter', data, itemStyle: { opacity } });
            option.series.push({
                name: 'Trend',
                type: 'line',
                data: lineData,
                showSymbol: false,
                lineStyle: { color: '#ee6666', width: 2 },
            });
        }

        Object.assign(spec, option);
        delete spec.mark;
        delete spec.encoding;
    },
};
