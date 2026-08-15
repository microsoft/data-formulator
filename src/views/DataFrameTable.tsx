// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DataFrameTable — compact notebook-style table for data previews.
 *
 * Features:
 *  - Monospace font, tight rows — feels like a Jupyter/pandas DataFrame
 *  - Auto-abbreviates wide tables: first N + "…" + last N columns
 *  - Truncates long cell values with ellipsis
 *  - Shows "…" footer row when totalRows > displayed rows
 *  - Zero-dependency on MUI DataGrid — just plain `<table>`
 */

import React from 'react';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { textVar } from '../app/layout';

const CODE_FONT = 'var(--df-font-mono)';

export interface DataFrameTableProps {
    /** Column names */
    columns: string[];
    /** Row data — array of record objects keyed by column name */
    rows: Record<string, any>[];
    /** Total row count (if known). When > rows.length, a "…" row is shown. */
    totalRows?: number;
    /** Max columns before abbreviating with "…" (default 8) */
    maxColumns?: number;
    /** Max visible cell length before truncation (default 24) */
    maxCellLength?: number;
    /** Max rows to display (default: all provided rows) */
    maxRows?: number;
    /** Font size for cells (default 11) */
    fontSize?: number;
    /** Header font size (default 10) */
    headerFontSize?: number;
    /** Whether to show a row index column (default false) */
    showIndex?: boolean;
    /** Optional column descriptions keyed by column name, shown as header tooltips. */
    columnDescriptions?: Record<string, string>;
    /** How to indicate that the preview omits additional rows. Defaults to the
     *  historical ellipsis row; `caption` renders an explicit count below. */
    truncationIndicator?: 'row' | 'caption' | 'none';
    /**
     * When true, columns size to content (CSS `tableLayout: auto`,
     * `width: max-content`) instead of stretching to fill the container.
     * Use for previews inside containers that should adapt to the table's
     * natural width rather than dictate it. The table still stretches to
     * `min-width: 100%` of its container, so a narrow table doesn't leave
     * empty space when the container has a minimum width of its own.
     */
    autoWidth?: boolean;
    /**
     * Narrowest a column may get before the table drops columns instead of
     * squeezing them. With `tableLayout: fixed` every column shares the width
     * equally, so a tight container otherwise ellipsises *every* cell; fitting
     * the column count keeps the ones that remain readable.
     */
    minColumnWidth?: number;
    /** Use flatter, quieter styling for dense draft previews. */
    simple?: boolean;
}

export const DataFrameTable: React.FC<DataFrameTableProps> = ({
    columns,
    rows,
    totalRows,
    maxColumns = 8,
    maxCellLength = 24,
    maxRows,
    fontSize = 11,
    headerFontSize = 10,
    showIndex = false,
    columnDescriptions,
    truncationIndicator = 'row',
    autoWidth = false,
    minColumnWidth,
    simple = false,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [availableWidth, setAvailableWidth] = React.useState(0);

    React.useEffect(() => {
        const el = containerRef.current;
        if (!minColumnWidth || !el) return;
        setAvailableWidth(el.clientWidth);
        const observer = new ResizeObserver(entries => {
            setAvailableWidth(entries[0].contentRect.width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [minColumnWidth]);

    const visibleRows = maxRows != null ? rows.slice(0, maxRows) : rows;
    // The preview displays at most `maxRows` data rows, followed by one `…`
    // row only when we know additional rows exist. Unknown total alone is not
    // evidence of truncation: a three-row result should render three rows, not
    // a misleading ellipsis. Callers that reserve a fixed preview height keep
    // short tables layout-stable via whitespace instead of fake rows.
    const hasMore = (totalRows != null && totalRows > visibleRows.length)
        || (maxRows != null && rows.length > maxRows);

    // Abbreviate columns: leading columns + a narrow trailing … marker
    const fittedMaxColumns = minColumnWidth && availableWidth > 0
        ? Math.max(2, Math.min(maxColumns, Math.floor(availableWidth / minColumnWidth)))
        : maxColumns;
    const needsColEllipsis = columns.length > fittedMaxColumns;
    const displayCols = needsColEllipsis
        ? [...columns.slice(0, fittedMaxColumns), '\u2026']
        : columns;
    // The marker only needs room for one glyph, so it doesn't take a full
    // column's share of the fixed layout.
    const ellipsisColSx = { width: 20, minWidth: 20, color: 'text.disabled' } as const;

    const getCell = (row: Record<string, any>, col: string): { display: string; full: string; truncated: boolean } => {
        if (col === '\u2026') return { display: '\u2026', full: '\u2026', truncated: false };
        const v = row[col];
        if (v == null) return { display: 'NaN', full: 'NaN', truncated: false };
        if (v === '') return { display: '', full: '', truncated: false };
        const s = String(v);
        const truncated = s.length > maxCellLength;
        return { display: truncated ? s.slice(0, maxCellLength - 2) + '\u2026' : s, full: s, truncated };
    };

    return (
        <Box ref={containerRef}>
            {/* Column list removed — the abbreviated table header is sufficient */}
            <Box component="table" sx={{
                borderCollapse: 'separate',
                borderSpacing: 0,
                fontSize,
                fontFamily: CODE_FONT,
                width: autoWidth ? 'max-content' : '100%',
                minWidth: autoWidth ? '100%' : undefined,
                tableLayout: autoWidth ? 'auto' : 'fixed',
                '& th, & td': {
                    px: simple ? 0.6 : 0.75, py: 0.3, textAlign: 'left',
                    borderBottom: '1px solid', borderColor: 'divider',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                },
                '& th': {
                    fontWeight: 600,
                    color: 'text.secondary',
                    fontSize: headerFontSize,
                    position: 'sticky',
                    top: 0,
                    // Matches .table-header-container / .data-view-header-cell
                    // so a scrolled row passes cleanly beneath the header.
                    bgcolor: simple
                        ? 'background.paper'
                        : theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#fafafa',
                    borderBottom: simple ? '1px solid' : '2px solid',
                    borderColor: 'divider',
                    zIndex: 2,
                },
                '& td': { color: 'text.primary' },
                '& tr:last-child td': { borderBottom: 'none' },
                '& tbody tr:nth-of-type(even)': {
                    bgcolor: simple
                        ? 'transparent'
                        : theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.02)'
                        : 'rgba(0,0,0,0.02)',
                },
            }}>
                <thead>
                    <tr>
                        {showIndex && (
                            <Typography component="th" variant="caption"
                                sx={{
                                    fontWeight: 600, fontSize: headerFontSize, color: 'text.disabled', textAlign: 'right',
                                    width: simple ? 24 : undefined, minWidth: simple ? 24 : 28, maxWidth: simple ? 24 : undefined,
                                    px: simple ? 0.5 : undefined,
                                }}>
                            </Typography>
                        )}
                        {displayCols.map((col, i) => {
                            const desc = col !== '\u2026' ? columnDescriptions?.[col] : undefined;
                            if (desc) {
                                return (
                                    <Tooltip key={i} title={desc} placement="top" enterDelay={400}>
                                        <Typography component="th" variant="caption"
                                            sx={{ fontWeight: 600, fontSize: headerFontSize,
                                                cursor: 'help', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2,
                                            }}>
                                            {col}
                                        </Typography>
                                    </Tooltip>
                                );
                            }
                            return (
                                <Typography component="th" key={i} variant="caption"
                                    title={col}
                                    sx={{ fontWeight: 600, fontSize: headerFontSize, ...(col === '\u2026' ? ellipsisColSx : {}) }}>
                                    {col}
                                </Typography>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {visibleRows.map((row, ri) => (
                        <tr key={ri}>
                            {showIndex && (
                                <Typography component="td" variant="caption"
                                    sx={{
                                        fontSize, color: 'text.disabled', textAlign: 'right', pr: simple ? 0.5 : 1,
                                        pl: simple ? 0.25 : undefined, width: simple ? 24 : undefined,
                                        minWidth: simple ? 24 : undefined, maxWidth: simple ? 24 : undefined,
                                    }}>
                                    {ri}
                                </Typography>
                            )}
                            {displayCols.map((col, ci) => {
                                const cell = getCell(row, col);
                                const isNull = col !== '\u2026' && row[col] == null;
                                return (
                                    <Typography component="td" key={ci} variant="caption"
                                        title={col !== '\u2026' ? cell.full : undefined}
                                        sx={{ fontSize, ...(isNull ? { color: 'text.disabled', fontStyle: 'italic' } : {}), ...(col === '\u2026' ? ellipsisColSx : {}), cursor: cell.truncated ? 'help' : undefined }}>
                                        {cell.display}
                                    </Typography>
                                );
                            })}
                        </tr>
                    ))}
                    {hasMore && truncationIndicator === 'row' && (
                        <tr>
                            {showIndex && (
                                <Typography component="td" variant="caption"
                                    sx={{ fontSize, color: 'text.disabled', textAlign: 'center' }}>
                                    ⋯
                                </Typography>
                            )}
                            {displayCols.map((col, ci) => (
                                <Typography component="td" key={ci} variant="caption"
                                    sx={{ fontSize, color: 'text.disabled', ...(col === '\u2026' ? ellipsisColSx : {}) }}>
                                    ⋯
                                </Typography>
                            ))}
                        </tr>
                    )}
                </tbody>
            </Box>
            {hasMore && truncationIndicator === 'caption' && (
                <Typography sx={{
                    mt: 0.4,
                    px: 0.25,
                    fontSize: textVar.xxs,
                    lineHeight: 1.4,
                    color: 'text.disabled',
                    textAlign: 'right',
                }}>
                    {totalRows != null
                        ? t('dataLoading.previewShowingRows', {
                            shown: visibleRows.length,
                            total: totalRows.toLocaleString(),
                        })
                        : t('dataLoading.previewShowingFirstRows', {
                            shown: visibleRows.length,
                        })}
                </Typography>
            )}
        </Box>
    );
};

export default DataFrameTable;
