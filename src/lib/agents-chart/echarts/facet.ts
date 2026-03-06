// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ECharts Facet Support — Multi-grid layout for column/row channels.
 *
 * ECharts has no native faceting like VL's column/row encodings.
 * This module transforms per-panel single-grid options into one
 * combined multi-grid option:
 *
 *   - grid[]     one positioned grid per facet panel
 *   - xAxis[]    per-grid, labels only on bottom-row panels
 *   - yAxis[]    per-grid, labels only on left-column panels
 *   - series[]   assigned to grids via xAxisIndex/yAxisIndex
 *   - graphic[]  column/row facet header text labels
 *
 * Only axis-based charts (bar, scatter, line, area, etc.) are supported.
 * Pie, radar, and themeRiver charts use different positioning and cannot
 * be faceted with multi-grid.
 */

// ============================================================================
// Types
// ============================================================================

export interface FacetConfig {
    colField?: string;
    rowField?: string;
    /** When true, each visual row shows its own column-header row.
     *  Set by the assembler when column-only facets are wrapped. */
    colHeaderPerRow?: boolean;
}

// ============================================================================
// Public API
// ============================================================================

/** True if panels are radar charts (use radar component, not grid/xAxis/yAxis). */
function isRadarFacet(ref: any): boolean {
    return !!(
        ref?.radar &&
        Array.isArray(ref.series) &&
        ref.series.length > 0 &&
        ref.series[0]?.type === 'radar'
    );
}

/** True if panels are polar charts (Rose: polar + angleAxis + radiusAxis, series coordinateSystem 'polar'). */
function isPolarFacet(ref: any): boolean {
    return !!(
        ref?.polar &&
        ref?.angleAxis &&
        Array.isArray(ref.series) &&
        ref.series.length > 0 &&
        ref.series[0]?.coordinateSystem === 'polar'
    );
}

/**
 * Combine faceted radar panels: one radar component per cell, series use radarIndex.
 */
function combineRadarFacetPanels(panels: any[][], config: FacetConfig): any {
    const nRows = panels.length;
    const nCols = Math.max(1, ...panels.map(r => r.length));
    const ref = panels[0]?.[0];
    if (!ref?.radar) return {};

    const plotW = ref._plotWidth || ref._width || 400;
    const plotH = ref._plotHeight || ref._height || 300;
    const GAP = 6;
    const COL_HEADER_H = config.colField ? 18 : 0;
    const ROW_HEADER_W = config.rowField ? 18 : 0;
    const colHeaderPerRow = config.colHeaderPerRow ?? false;
    const PAD = 4;
    const baseLeft = ROW_HEADER_W;
    const col0W = PAD + plotW + PAD;
    const colInnerW = PAD + plotW + PAD;
    const rowInnerH = PAD + plotH + PAD;
    const totalW = baseLeft + col0W + (nCols > 1 ? (nCols - 1) * (colInnerW + GAP) : 0);
    const totalH = (colHeaderPerRow ? 0 : COL_HEADER_H)
        + (nRows > 1 ? (nRows - 1) * (rowInnerH + GAP) : 0)
        + rowInnerH;

    const combined: any = {
        radar: [],
        series: [],
        _width: totalW,
        _height: totalH,
    };
    if (ref.tooltip) combined.tooltip = { ...ref.tooltip };
    if (ref.color) combined.color = ref.color;
    if (ref.legend) combined.legend = { ...ref.legend };

    const radarRadiusRatio = 0.38;
    const headerFontSize = 11;
    const hStyle = { fontSize: headerFontSize, fontWeight: 'bold' as const, fill: '#555',
                     textAlign: 'center' as const, textVerticalAlign: 'middle' as const };
    const graphics: any[] = [];

    let radarIdx = 0;
    for (let ri = 0; ri < nRows; ri++) {
        for (let ci = 0; ci < nCols; ci++) {
            const panel = panels[ri]?.[ci];
            if (!panel) continue;

            const cx = baseLeft + (ci === 0 ? 0 : col0W + GAP + (ci - 1) * (colInnerW + GAP));
            const cy = colHeaderPerRow
                ? ri * (rowInnerH + GAP) + COL_HEADER_H
                : COL_HEADER_H + ri * (rowInnerH + GAP);
            const left = cx + PAD;
            const top = cy + PAD;
            const width = plotW;
            const height = plotH;
            const centerX = left + width / 2;
            const centerY = top + height / 2;
            const radius = Math.min(width, height) * radarRadiusRatio;

            combined.radar.push({
                ...ref.radar,
                indicator: ref.radar.indicator,
                shape: ref.radar.shape,
                center: [centerX, centerY],
                radius,
                axisName: ref.radar.axisName ?? { fontSize: 11 },
            });

            if (Array.isArray(panel.series)) {
                for (const s of panel.series) {
                    combined.series.push({ ...s, radarIndex: radarIdx });
                }
            }

            if (config.colField && panel._colHeader && (colHeaderPerRow || ri === 0)) {
                graphics.push({
                    type: 'text',
                    left: centerX,
                    top: top - COL_HEADER_H / 2,
                    style: { ...hStyle, text: String(panel._colHeader) },
                });
            }
            if (config.rowField && ci === 0 && panel._rowHeader) {
                graphics.push({
                    type: 'text',
                    left: ROW_HEADER_W / 2,
                    top: centerY,
                    style: { ...hStyle, text: String(panel._rowHeader) },
                    rotation: Math.PI / 2,
                });
            }
            radarIdx++;
        }
    }
    if (graphics.length > 0) combined.graphic = graphics;
    return combined;
}

/** Polar (Rose) radius as fraction of cell min dimension. */
const POLAR_RADIUS_RATIO = 0.42;

/**
 * Combine faceted polar (Rose) panels: one polar + angleAxis + radiusAxis per cell, series use polarIndex.
 */
function combinePolarFacetPanels(panels: any[][], config: FacetConfig): any {
    const nRows = panels.length;
    const nCols = Math.max(1, ...panels.map(r => r.length));
    const ref = panels[0]?.[0];
    if (!ref?.polar || !ref?.angleAxis) return {};

    const plotW = ref._plotWidth || ref._width || 400;
    const plotH = ref._plotHeight || ref._height || 300;
    const GAP = 6;
    const COL_HEADER_H = config.colField ? 18 : 0;
    const ROW_HEADER_W = config.rowField ? 18 : 0;
    const colHeaderPerRow = config.colHeaderPerRow ?? false;
    const PAD = 4;
    const baseLeft = ROW_HEADER_W;
    const col0W = PAD + plotW + PAD;
    const colInnerW = PAD + plotW + PAD;
    const rowInnerH = PAD + plotH + PAD;
    const totalW = baseLeft + col0W + (nCols > 1 ? (nCols - 1) * (colInnerW + GAP) : 0);
    const totalH = (colHeaderPerRow ? 0 : COL_HEADER_H)
        + (nRows > 1 ? (nRows - 1) * (rowInnerH + GAP) : 0)
        + rowInnerH;

    const combined: any = {
        polar: [],
        angleAxis: [],
        radiusAxis: [],
        series: [],
        _width: totalW,
        _height: totalH,
    };
    if (ref.tooltip) combined.tooltip = { ...ref.tooltip };
    if (ref.color) combined.color = ref.color;
    if (ref.legend) combined.legend = { ...ref.legend };

    const headerFontSize = 11;
    const hStyle = { fontSize: headerFontSize, fontWeight: 'bold' as const, fill: '#555',
                     textAlign: 'center' as const, textVerticalAlign: 'middle' as const };
    const graphics: any[] = [];

    let polarIdx = 0;
    for (let ri = 0; ri < nRows; ri++) {
        for (let ci = 0; ci < nCols; ci++) {
            const panel = panels[ri]?.[ci];
            if (!panel) continue;

            const cx = baseLeft + (ci === 0 ? 0 : col0W + GAP + (ci - 1) * (colInnerW + GAP));
            const cy = colHeaderPerRow
                ? ri * (rowInnerH + GAP) + COL_HEADER_H
                : COL_HEADER_H + ri * (rowInnerH + GAP);
            const left = cx + PAD;
            const top = cy + PAD;
            const width = plotW;
            const height = plotH;
            const centerX = left + width / 2;
            const centerY = top + height / 2;
            const radius = Math.min(width, height) * POLAR_RADIUS_RATIO;

            combined.polar.push({
                center: [centerX, centerY],
                radius,
            });

            combined.angleAxis.push({
                ...ref.angleAxis,
                polarIndex: polarIdx,
            });
            combined.radiusAxis.push({
                ...(ref.radiusAxis || {}),
                polarIndex: polarIdx,
            });

            if (Array.isArray(panel.series)) {
                for (const s of panel.series) {
                    combined.series.push({ ...s, polarIndex: polarIdx });
                }
            }

            if (config.colField && panel._colHeader && (colHeaderPerRow || ri === 0)) {
                graphics.push({
                    type: 'text',
                    left: centerX,
                    top: top - COL_HEADER_H / 2,
                    style: { ...hStyle, text: String(panel._colHeader) },
                });
            }
            if (config.rowField && ci === 0 && panel._rowHeader) {
                graphics.push({
                    type: 'text',
                    left: ROW_HEADER_W / 2,
                    top: centerY,
                    style: { ...hStyle, text: String(panel._rowHeader) },
                    rotation: Math.PI / 2,
                });
            }
            polarIdx++;
        }
    }
    if (graphics.length > 0) combined.graphic = graphics;
    return combined;
}

/**
 * Combine per-panel single-grid ECharts options into a multi-grid faceted layout.
 *
 * The assembler is responsible for wrapping column-only facets into a proper
 * 2D panels array before calling this function.  Each panel may carry
 * `_colHeader` / `_rowHeader` strings for facet header labels.
 *
 * For radar charts, uses multiple radar components (one per panel) and radarIndex
 * instead of grid/xAxis/yAxis.
 *
 * @param panels  2D array `panels[rowIdx][colIdx]` of single-panel ECharts options.
 *                Each panel is a complete option with xAxis, yAxis, grid, series, etc.
 * @param config  Facet field names and layout hints.
 * @returns       Combined ECharts option with multi-grid layout.
 */
export function ecCombineFacetPanels(
    panels: any[][],
    config: FacetConfig,
): any {
    const nRows = panels.length;
    const nCols = Math.max(1, ...panels.map(r => r.length));
    const ref = panels[0]?.[0];
    if (!ref) return {};

    if (isRadarFacet(ref)) {
        return combineRadarFacetPanels(panels, config);
    }
    if (isPolarFacet(ref)) {
        return combinePolarFacetPanels(panels, config);
    }

    // ── Plot-area dimensions (extracted by assembler) ─────────────────────
    const plotW = ref._plotWidth || ref._width || 200;
    const plotH = ref._plotHeight || ref._height || 150;

    // ── Simple spacing constants ─────────────────────────────────────────
    const GAP = 6;                                        // between panels
    const COL_HEADER_H = config.colField ? 18 : 0;       // facet column headers
    const ROW_HEADER_W = config.rowField ? 18 : 0;       // facet row headers
    const colHeaderPerRow = config.colHeaderPerRow ?? false;

    const refX = ref.xAxis || {};
    const refY = ref.yAxis || {};
    const hasYTitle = !!(refY.name);

    // Shared axis titles — rendered once as graphic elements
    const sharedXTitle = refX.name || '';
    const sharedYTitle = (config.rowField && hasYTitle) ? (refY.name || '') : '';
    const SHARED_X_H = sharedXTitle ? 18 : 0;
    const SHARED_Y_W = sharedYTitle ? 18 : 0;

    // ── Uniform cell size ────────────────────────────────────────────────
    // ── Facet-specific margins ─────────────────────────────────────────
    // The assembler's refGrid margins include CANVAS_BUFFER (16px) meant
    // for standalone charts.  In a faceted layout the grids are internal
    // elements — no buffer needed. Use tighter margins based on content.
    const mLeft   = hasYTitle && !sharedYTitle ? 55 : 35;  // y-axis labels (+ title if not shared)
    const mBottom = 22;                                     // x-axis labels
    const PAD = 4;                                          // minimal padding for inner panels

    // Cell widths differ: first column includes y-axis label margin,
    // inner columns use minimal padding.  Row heights differ: only the
    // bottom row reserves mBottom for x-axis labels.
    const col0W     = mLeft + plotW + PAD;
    const colInnerW = PAD + plotW + PAD;
    const rowInnerH = PAD + plotH + PAD;       // non-bottom rows: compact
    const rowBottomH = PAD + plotH + mBottom;  // bottom row: x-axis labels

    // ── Overall dimensions ───────────────────────────────────────────────
    const baseLeft = SHARED_Y_W + ROW_HEADER_W;
    const innerRowBlock = colHeaderPerRow ? COL_HEADER_H + rowInnerH : rowInnerH;
    const bottomRowBlock = colHeaderPerRow ? COL_HEADER_H + rowBottomH : rowBottomH;
    const totalW = baseLeft + col0W + (nCols > 1 ? (nCols - 1) * (colInnerW + GAP) : 0);
    const totalH = (colHeaderPerRow ? 0 : COL_HEADER_H)
        + (nRows > 1 ? (nRows - 1) * (innerRowBlock + GAP) : 0)
        + bottomRowBlock
        + SHARED_X_H;

    // ── Combined option ──────────────────────────────────────────────────
    const combined: any = {
        grid: [], xAxis: [], yAxis: [], series: [],
        _width: totalW, _height: totalH,
    };
    if (ref.tooltip) combined.tooltip = { ...ref.tooltip };
    if (ref.color) combined.color = ref.color;
    if (ref.legend) combined.legend = { ...ref.legend };

    const fontSize = Math.max(8, Math.round(10 * Math.min(1, plotW / 200)));
    const headerFontSize = Math.max(9, Math.round(11 * Math.min(1, plotW / 200)));

    // ── Place grids & axes ───────────────────────────────────────────────
    const gridMap: number[][] = [];
    let gridIdx = 0;

    for (let ri = 0; ri < nRows; ri++) {
        gridMap[ri] = [];
        for (let ci = 0; ci < nCols; ci++) {
            const panel = panels[ri]?.[ci];
            if (!panel) { gridMap[ri][ci] = -1; continue; }
            gridMap[ri][ci] = gridIdx;

            const isLeft = ci === 0;
            const isBottom = ri === nRows - 1;

            // Cell position — row height depends on whether it's the bottom row
            const cx = baseLeft + (ci === 0
                ? 0
                : col0W + GAP + (ci - 1) * (colInnerW + GAP));
            let cy: number;
            if (colHeaderPerRow) {
                const rowOff = ri * (innerRowBlock + GAP);
                cy = rowOff + COL_HEADER_H;
            } else {
                const rowOff = COL_HEADER_H + ri * (innerRowBlock + GAP);
                cy = rowOff;
            }

            // Grid — position the plot area inside the cell.
            const pLeft = ci === 0 ? mLeft : PAD;
            combined.grid.push({
                left: cx + pLeft,
                top: cy + PAD,
                width: plotW,
                height: plotH,
            });

            // xAxis
            const srcX = panel.xAxis ? { ...panel.xAxis } : { type: 'category' };
            combined.xAxis.push({
                ...srcX,
                gridIndex: gridIdx,
                name: undefined, nameGap: 0,
                axisLabel: { ...(srcX.axisLabel || {}), show: isBottom, fontSize },
                axisTick: { ...(srcX.axisTick || {}), show: isBottom },
                axisLine: { show: true },
            });

            // yAxis — per-panel name only when row facet is absent
            const srcY = panel.yAxis ? { ...panel.yAxis } : { type: 'value' };
            const showYName = isLeft && !sharedYTitle;
            combined.yAxis.push({
                ...srcY,
                gridIndex: gridIdx,
                name: showYName ? srcY.name : undefined,
                nameGap: showYName ? (srcY.nameGap ?? 4) : 0,
                axisLabel: { ...(srcY.axisLabel || {}), show: isLeft, fontSize },
                axisTick: { ...(srcY.axisTick || {}), show: isLeft },
                axisLine: { show: true },
            });

            // Series
            if (Array.isArray(panel.series)) {
                for (const s of panel.series) {
                    combined.series.push({ ...s, xAxisIndex: gridIdx, yAxisIndex: gridIdx });
                }
            }
            gridIdx++;
        }
    }

    // ── Helpers: grid center from placed grids ───────────────────────────
    const gridOf = (ri: number, ci: number) => {
        const gi = gridMap[ri]?.[ci];
        return gi != null && gi >= 0 ? combined.grid[gi] : null;
    };
    const gCX = (g: any) => g.left + g.width / 2;
    const gCY = (g: any) => g.top + g.height / 2;

    // ── Facet headers — positioned from actual grids ─────────────────────
    const graphics: any[] = [];
    const hStyle = { fontSize: headerFontSize, fontWeight: 'bold' as const, fill: '#555',
                     textAlign: 'center' as const, textVerticalAlign: 'middle' as const };

    // Column headers
    if (config.colField) {
        const hRows = colHeaderPerRow ? nRows : 1;
        for (let ri = 0; ri < hRows; ri++) {
            for (let ci = 0; ci < nCols; ci++) {
                const p = panels[ri]?.[ci], g = gridOf(ri, ci);
                if (!p?._colHeader || !g) continue;
                graphics.push({
                    type: 'text', left: gCX(g), top: g.top - COL_HEADER_H / 2,
                    style: { ...hStyle, text: String(p._colHeader) },
                });
            }
        }
    }

    // Row headers
    if (config.rowField) {
        for (let ri = 0; ri < nRows; ri++) {
            const p = panels[ri]?.[0], g = gridOf(ri, 0);
            if (!p?._rowHeader || !g) continue;
            graphics.push({
                type: 'text', left: SHARED_Y_W + ROW_HEADER_W / 2, top: gCY(g),
                style: { ...hStyle, text: String(p._rowHeader) },
                rotation: Math.PI / 2,
            });
        }
    }

    // Shared Y-axis title
    if (sharedYTitle) {
        const first = gridOf(0, 0), last = gridOf(nRows - 1, 0);
        if (first && last) {
            graphics.push({
                type: 'text', left: SHARED_Y_W / 2, top: (gCY(first) + gCY(last)) / 2,
                style: { text: sharedYTitle, fontSize: headerFontSize, fill: '#333',
                         textAlign: 'center', textVerticalAlign: 'middle' },
                rotation: Math.PI / 2,
            });
        }
    }

    // Shared X-axis title
    if (sharedXTitle) {
        graphics.push({
            type: 'text', left: totalW / 2, top: totalH - SHARED_X_H + 4,
            style: { text: sharedXTitle, fontSize: headerFontSize, fill: '#333', textAlign: 'center' },
        });
    }

    if (graphics.length > 0) combined.graphic = graphics;
    return combined;
}
