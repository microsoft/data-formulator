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
import { Box, Chip, Typography, useTheme } from '@mui/material';

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
}) => {
    const theme = useTheme();
    const visibleRows = maxRows != null ? rows.slice(0, maxRows) : rows;
    const hasMore = totalRows == null
        || totalRows > visibleRows.length
        || (maxRows != null && rows.length > maxRows);

    // Abbreviate columns: first half + … + last half
    const half = Math.floor(maxColumns / 2);
    const needsColEllipsis = columns.length > maxColumns;
    const displayCols = needsColEllipsis
        ? [...columns.slice(0, half), '\u2026', ...columns.slice(-half)]
        : columns;

    const getCell = (row: Record<string, any>, col: string): string => {
        if (col === '\u2026') return '\u2026';
        const v = row[col];
        if (v == null) return 'NaN';
        if (v === '') return '';
        const s = String(v);
        return s.length > maxCellLength ? s.slice(0, maxCellLength - 2) + '\u2026' : s;
    };

    return (
        <Box>
            {needsColEllipsis && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, mb: 0.75, alignItems: 'center', maxHeight: 180, overflowY: 'auto' }}>
                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10, mr: 0.25 }}>
                        {columns.length} columns
                    </Typography>
                    {columns.map((col, i) => (
                        <Chip
                            key={i}
                            label={col}
                            size="small"
                            variant="outlined"
                            sx={{
                                height: 18,
                                fontSize: 10,
                                fontFamily: CODE_FONT,
                                borderRadius: 0.5,
                                borderColor: 'divider',
                                color: 'text.secondary',
                                '& .MuiChip-label': { px: 0.75, py: 0 },
                            }}
                        />
                    ))}
                </Box>
            )}
            <Box component="table" sx={{
                borderCollapse: 'collapse',
                fontSize,
                fontFamily: CODE_FONT,
                width: '100%',
                tableLayout: 'fixed',
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
                        {displayCols.map((col, i) => (
                            <Typography component="th" key={i} variant="caption"
                                sx={{ fontWeight: 600, fontSize: headerFontSize }}>
                                {col}
                            </Typography>
                        ))}
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
                                const cellVal = getCell(row, col);
                                const isNull = col !== '\u2026' && row[col] == null;
                                return (
                                    <Typography component="td" key={ci} variant="caption"
                                        sx={{ fontSize, ...(isNull ? { color: 'text.disabled', fontStyle: 'italic' } : {}) }}>
                                        {cellVal}
                                    </Typography>
                                );
                            })}
                        </tr>
                    ))}
                    {hasMore && (
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
        </Box>
    );
};

export default DataFrameTable;
