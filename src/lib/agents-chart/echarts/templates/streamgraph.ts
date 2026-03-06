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
import { groupBy } from './utils';

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
                    axisTick: { show: true },
                },
                yAxis: { type: 'value', show: false, axisTick: { show: true } },
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

        // Build a lookup: (xVal, seriesName) → numeric value
        const valMap = new Map<string, number>();
        for (const row of table) {
            const key = `${row[xField]}|||${row[colorField]}`;
            const v = row[yField];
            valMap.set(key, v != null && v !== '' ? Number(v) : 0);
        }

        // ThemeRiver expects first element to be date or number; category labels as string often don't render.
        // For category x: use numeric index (0,1,2,...) and axisLabel.formatter to show category names.
        const xIsTemporal = xCS.type === 'temporal';
        const riverData: [string | number, number, string][] = [];
        for (let i = 0; i < xVals.length; i++) {
            const xv = xVals[i];
            for (const sn of seriesNames) {
                const key = `${xv}|||${sn}`;
                const numVal = valMap.get(key);
                const value = numVal != null && Number.isFinite(numVal) ? numVal : 0;
                // Use index for category so ThemeRiver renders; use string for temporal (date string)
                riverData.push([xIsTemporal ? xv : i, value, sn]);
            }
        }

        // ── Build option ─────────────────────────────────────────────────
        const option: any = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'line', lineStyle: { color: 'rgba(0,0,0,0.2)', width: 1, type: 'solid' } },
                formatter: (params: any) => {
                    if (!params || params.length === 0) return '';
                    const xVal = params[0].value[0];
                    const displayX = xIsTemporal ? xVal : (xVals[xVal] ?? xVal);
                    let html = `<b>${displayX}</b><br/>`;
                    // Sort by value descending
                    const sortedParams = [...params].sort((a, b) => (b.value[1] || 0) - (a.value[1] || 0));
                    sortedParams.forEach((p: any) => {
                        html += `${p.marker} ${p.value[2]}: <b>${p.value[1]}</b><br/>`;
                    });
                    return html;
                },
            },
            legend: {
                data: seriesNames,
            },
            singleAxis: {
                ...(xIsTemporal
                    ? { type: 'time' as const }
                    : {
                        type: 'value' as const,
                        min: 0,
                        max: Math.max(1, xVals.length - 1),
                        axisLabel: {
                            fontSize: 11,
                            formatter: (value: number) => {
                                const idx = Math.round(Number(value));
                                return xVals[idx] ?? value;
                            },
                        },
                    }),
                axisTick: { show: true },
                bottom: 45,         // enough room for tick labels + axis name below
                name: xField,
                nameLocation: 'middle',
                nameGap: 25,
                nameTextStyle: { fontSize: 12 },
                ...(xIsTemporal ? { axisLabel: { fontSize: 11 } } : {}),
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

        // 颜色由 ecApplyLayoutToSpec 根据 colorDecisions 设置 option.color，ThemeRiver 会按 stream 顺序使用

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
            const LEGEND_GAP = 12;
            const hasLegend = !!option.legend;
            // Reserve enough right margin for legend so it doesn't overlap the chart
            const legendWidth = (option._legendWidth as number) || 140;
            const rightMargin = hasLegend ? legendWidth + LEGEND_GAP + BUFFER : 20;

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

            // singleAxis positions: left/right control horizontal extent,
            // top/bottom control vertical extent
            option.singleAxis.left = option.singleAxis.left || 50;
            option.singleAxis.right = Math.max(option.singleAxis.right || 0, rightMargin);

            // Position legend in the right margin so it doesn't overlap the stream
            if (hasLegend && option.legend) {
                const legendLeft = option._width - rightMargin + BUFFER;
                option.legend.left = legendLeft;
                delete option.legend.right; // Use left to align with graphic titles
                option.legend.top = 20;
                option.legend.orient = option.legend.orient || 'vertical';
                option.legend.align = 'left';

                // Also update any custom graphic legend titles
                if (Array.isArray(option.graphic)) {
                    for (const g of option.graphic) {
                        // The legend title added in instantiate-spec.ts typically has top: 4 and type: 'text'
                        if (g.type === 'text' && (g.top === 4 || g.top === 20) && g.style && g.style.fontWeight === 'bold') {
                            g.left = legendLeft;
                            delete g.right;
                        }
                    }
                }
            }

            // Push the axis up from the canvas bottom to avoid clipping
            if (typeof option.singleAxis.bottom === 'number') {
                option.singleAxis.bottom += BUFFER;
            }
        }
    },

    properties: [
    ],
};
