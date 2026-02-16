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

/**
 * Combine per-panel single-grid ECharts options into a multi-grid faceted layout.
 *
 * The assembler is responsible for wrapping column-only facets into a proper
 * 2D panels array before calling this function.  Each panel may carry
 * `_colHeader` / `_rowHeader` strings for facet header labels.
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

    // ── Plot-area dimensions (extracted by assembler) ─────────────────────
    const plotW = ref._plotWidth || ref._width || 200;
    const plotH = ref._plotHeight || ref._height || 150;

    // Font scale relative to a "comfortable" 200px plot area
    const scale = Math.min(1, plotW / 200);

    // ── Compact facet margins ────────────────────────────────────────────
    const GAP_X = 6;
    const GAP_Y = 6;
    const COL_HEADER_H = config.colField ? 18 : 0;
    const ROW_HEADER_W = config.rowField ? 16 : 0;
    const colHeaderPerRow = config.colHeaderPerRow ?? false;

    const refX = ref.xAxis || {};
    const refY = ref.yAxis || {};
    const hasYTitle = !!(refY.name);

    const M_EDGE_L = Math.max(hasYTitle ? 60 : 40, Math.round((hasYTitle ? 70 : 50) * scale));
    const M_INNER_L = 4;
    const M_EDGE_B = Math.max(16, Math.round(22 * scale));
    const M_INNER_B = 4;
    const M_T = 4;
    const M_R = 4;

    // X-axis title is rendered as a shared centered element below all panels
    const sharedXTitle = refX.name || '';
    const SHARED_X_TITLE_H = sharedXTitle ? 18 : 0;

    // Panel outer dimensions — first column is wider (y-axis labels + title)
    const col0W = plotW + M_EDGE_L + M_R;
    const colInnerW = plotW + M_INNER_L + M_R;
    const panelH = plotH + M_T + M_EDGE_B;

    /** X-offset of the left edge of column `ci`. */
    const colOx = (ci: number): number => {
        if (ci === 0) return ROW_HEADER_W;
        return ROW_HEADER_W + col0W + GAP_X + (ci - 1) * (colInnerW + GAP_X);
    };
    /** Width of column `ci`. */
    const colW = (ci: number): number => ci === 0 ? col0W : colInnerW;

    // ── Overall dimensions ───────────────────────────────────────────────
    const totalW = ROW_HEADER_W + col0W + (nCols > 1 ? (nCols - 1) * (colInnerW + GAP_X) : 0);
    // When colHeaderPerRow, each row has its own column-header area
    const rowBlockH = colHeaderPerRow
        ? COL_HEADER_H + panelH
        : panelH;
    const totalH = (colHeaderPerRow ? 0 : COL_HEADER_H)
        + nRows * rowBlockH + (nRows - 1) * GAP_Y
        + SHARED_X_TITLE_H;

    // ── Combined option ──────────────────────────────────────────────────
    const combined: any = {
        grid: [],
        xAxis: [],
        yAxis: [],
        series: [],
        _width: totalW,
        _height: totalH,
    };

    if (ref.tooltip) combined.tooltip = { ...ref.tooltip };
    if (ref.color) combined.color = ref.color;

    const labelFontSize = Math.max(8, Math.round(10 * scale));

    let gridIdx = 0;

    for (let ri = 0; ri < nRows; ri++) {
        for (let ci = 0; ci < nCols; ci++) {
            const panel = panels[ri]?.[ci];
            if (!panel) continue;

            const isLeftCol = ci === 0;
            const isBottomRow = ri === nRows - 1;

            // Margins for this panel (edge vs inner)
            const mL = isLeftCol ? M_EDGE_L : M_INNER_L;
            const mT = M_T;

            const ox = colOx(ci);
            let oy: number;
            if (colHeaderPerRow) {
                // Each row has its own COL_HEADER_H band
                oy = ri * (rowBlockH + GAP_Y) + COL_HEADER_H;
            } else {
                oy = COL_HEADER_H + ri * (panelH + GAP_Y);
            }

            // Grid: EXACT plot-area dimensions.
            combined.grid.push({
                left: ox + mL,
                top: oy + mT,
                width: plotW,
                height: plotH,
            });

            // ── xAxis ────────────────────────────────────────────────────
            // X-axis title is rendered as a shared graphic element.
            const srcX = panel.xAxis ? { ...panel.xAxis } : { type: 'category' };
            combined.xAxis.push({
                ...srcX,
                gridIndex: gridIdx,
                name: undefined,
                nameGap: 0,
                axisLabel: {
                    ...(srcX.axisLabel || {}),
                    show: isBottomRow,
                    fontSize: labelFontSize,
                },
                axisTick: { ...(srcX.axisTick || {}), show: isBottomRow },
                axisLine: { show: true },
            });

            // ── yAxis ────────────────────────────────────────────────────
            // Y-axis title shown only on left-column panels.
            const srcY = panel.yAxis ? { ...panel.yAxis } : { type: 'value' };
            combined.yAxis.push({
                ...srcY,
                gridIndex: gridIdx,
                name: isLeftCol ? srcY.name : undefined,
                nameGap: isLeftCol ? (srcY.nameGap ?? 4) : 0,
                axisLabel: {
                    ...(srcY.axisLabel || {}),
                    show: isLeftCol,
                    fontSize: labelFontSize,
                },
                axisTick: { ...(srcY.axisTick || {}), show: isLeftCol },
                axisLine: { show: true },
            });

            // ── Series ───────────────────────────────────────────────────
            if (panel.series && Array.isArray(panel.series)) {
                for (const s of panel.series) {
                    combined.series.push({
                        ...s,
                        xAxisIndex: gridIdx,
                        yAxisIndex: gridIdx,
                    });
                }
            }

            gridIdx++;
        }
    }

    // ── Facet header labels (graphic elements) ───────────────────────────
    const graphics: any[] = [];

    // Column headers — read text from each panel's _colHeader
    if (config.colField) {
        if (colHeaderPerRow) {
            // Wrapped layout: each row has its own header band
            for (let ri = 0; ri < nRows; ri++) {
                for (let ci = 0; ci < nCols; ci++) {
                    const panel = panels[ri]?.[ci];
                    if (!panel?._colHeader) continue;
                    const cx = colOx(ci) + colW(ci) / 2;
                    const headerY = ri * (rowBlockH + GAP_Y) + 2;
                    graphics.push({
                        type: 'text',
                        left: cx,
                        top: headerY,
                        style: {
                            text: String(panel._colHeader),
                            fontSize: Math.max(9, Math.round(11 * scale)),
                            fontWeight: 'bold',
                            fill: '#555',
                            textAlign: 'center',
                        },
                    });
                }
            }
        } else {
            // Single header row at top
            for (let ci = 0; ci < nCols; ci++) {
                const panel = panels[0]?.[ci];
                if (!panel?._colHeader) continue;
                const cx = colOx(ci) + colW(ci) / 2;
                graphics.push({
                    type: 'text',
                    left: cx,
                    top: 2,
                    style: {
                        text: String(panel._colHeader),
                        fontSize: Math.max(9, Math.round(11 * scale)),
                        fontWeight: 'bold',
                        fill: '#555',
                        textAlign: 'center',
                    },
                });
            }
        }
    }

    // Row headers — read text from each row's first panel _rowHeader
    if (config.rowField) {
        for (let ri = 0; ri < nRows; ri++) {
            const panel = panels[ri]?.[0];
            if (!panel?._rowHeader) continue;
            let cy: number;
            if (colHeaderPerRow) {
                cy = ri * (rowBlockH + GAP_Y) + COL_HEADER_H + panelH / 2;
            } else {
                cy = COL_HEADER_H + ri * (panelH + GAP_Y) + panelH / 2;
            }
            graphics.push({
                type: 'text',
                left: ROW_HEADER_W / 2,
                top: cy,
                style: {
                    text: String(panel._rowHeader),
                    fontSize: Math.max(8, Math.round(10 * scale)),
                    fontWeight: 'bold',
                    fill: '#555',
                    textAlign: 'center',
                    textVerticalAlign: 'middle',
                },
                rotation: Math.PI / 2,
            });
        }
    }

    // ── Shared X-axis title (centered below all panels) ─────────────────
    if (sharedXTitle) {
        const cx = totalW / 2;
        graphics.push({
            type: 'text',
            left: cx,
            top: totalH - SHARED_X_TITLE_H + 4,
            style: {
                text: sharedXTitle,
                fontSize: Math.max(9, Math.round(11 * scale)),
                fill: '#333',
                textAlign: 'center',
            },
        });
    }

    if (graphics.length > 0) {
        combined.graphic = graphics;
    }

    return combined;
}
