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

const CODE_FONT = '"SF Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, "Liberation Mono", monospace';

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
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const visibleRows = maxRows != null ? rows.slice(0, maxRows) : rows;
    // The preview displays at most `maxRows` data rows, followed by one `…`
    // row only when we know additional rows exist. Unknown total alone is not
    // evidence of truncation: a three-row result should render three rows, not
    // a misleading ellipsis. Callers that reserve a fixed preview height keep
    // short tables layout-stable via whitespace instead of fake rows.
    const hasMore = (totalRows != null && totalRows > visibleRows.length)
        || (maxRows != null && rows.length > maxRows);

    // Abbreviate columns: first half + … + last half
    const half = Math.floor(maxColumns / 2);
    const needsColEllipsis = columns.length > maxColumns;
    const displayCols = needsColEllipsis
        ? [...columns.slice(0, half), '\u2026', ...columns.slice(-half)]
        : columns;

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
        <Box>
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
                    px: 0.75, py: 0.3, textAlign: 'left',
                    borderBottom: '1px solid', borderColor: 'divider',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                },
                '& th': {
                    fontWeight: 600,
                    color: 'text.secondary',
                    fontSize: headerFontSize,
                    position: 'sticky',
                    top: 0,
                    bgcolor: 'background.paper',
                    zIndex: 1,
                },
                '& td': { color: 'text.primary' },
                '& tr:last-child td': { borderBottom: 'none' },
                '& tbody tr:nth-of-type(even)': {
                    bgcolor: theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.02)'
                        : 'rgba(0,0,0,0.02)',
                },
            }}>
                <thead>
                    <tr>
                        {showIndex && (
                            <Typography component="th" variant="caption"
                                sx={{ fontWeight: 600, fontSize: headerFontSize, color: 'text.disabled', minWidth: 28, textAlign: 'right' }}>
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
                                    sx={{ fontWeight: 600, fontSize: headerFontSize }}>
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
                                    sx={{ fontSize, color: 'text.disabled', textAlign: 'right', pr: 1 }}>
                                    {ri}
                                </Typography>
                            )}
                            {displayCols.map((col, ci) => {
                                const cell = getCell(row, col);
                                const isNull = col !== '\u2026' && row[col] == null;
                                return (
                                    <Typography component="td" key={ci} variant="caption"
                                        title={col !== '\u2026' ? cell.full : undefined}
                                        sx={{ fontSize, ...(isNull ? { color: 'text.disabled', fontStyle: 'italic' } : {}), cursor: cell.truncated ? 'help' : undefined }}>
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
                            {displayCols.map((_, ci) => (
                                <Typography component="td" key={ci} variant="caption"
                                    sx={{ fontSize, color: 'text.disabled' }}>
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
                    fontSize: 10,
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
