// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import { alpha, Box, useTheme } from '@mui/system';
import Typography from '@mui/material/Typography';
import { formatCellValue } from './ViewUtils';


export interface ColumnDef {
    id: string;
    label: string;
    minWidth?: number;
    align?: 'right';
    source?: 'original' | 'custom' ;
    format?: (value: number) => string;
}

function descendingComparator(a: any, b: any, orderBy: string) {
    const va = a[orderBy];
    const vb = b[orderBy];
    if (vb == null && va == null) return 0;
    if (vb == null) return -1;
    if (va == null) return 1;
    if (vb < va) return -1;
    if (vb > va) return 1;
    return 0;
}

function getComparator(order: 'asc' | 'desc', orderBy: string) {
    return order === 'desc'
        ? (a: any, b: any) => descendingComparator(a, b, orderBy)
        : (a: any, b: any) => -descendingComparator(a, b, orderBy);
}

interface CustomReactTableProps {
    rows: any[];
    columnDefs: ColumnDef[];
    rowsPerPageNum: number;
    compact: boolean;
    maxCellWidth? : number;
    isIncompleteTable?: boolean;
    maxHeight?: number;
}

export const CustomReactTable: React.FC<CustomReactTableProps> = ({ 
    rows, columnDefs, rowsPerPageNum, compact, maxCellWidth, isIncompleteTable, maxHeight = 340 }) => {

    let theme = useTheme();

    const [page, setPage] = React.useState(0);
    const [rowsPerPage, setRowsPerPage] = React.useState(rowsPerPageNum == -1 ? (rows.length > 500 ? 100 : rows.length) : rowsPerPageNum);
    const [orderBy, setOrderBy] = React.useState<string | undefined>(undefined);
    const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');

    React.useEffect(() => {
        if (rowsPerPageNum === -1) {
            setRowsPerPage(rows.length > 500 ? 100 : rows.length);
            setPage(0);
        }
    }, [rows.length, rowsPerPageNum]);

    const sortedRows = React.useMemo(() => {
        if (!orderBy) return rows;
        return rows.slice().sort(getComparator(order, orderBy));
    }, [rows, order, orderBy]);

    const handleChangePage = (event: unknown, newPage: number) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
        setRowsPerPage(+event.target.value);
        setPage(0);
    };

    const handleSortClick = (columnId: string) => {
        if (orderBy === columnId && order === 'asc') {
            setOrder('desc');
        } else if (orderBy === columnId && order === 'desc') {
            setOrderBy(undefined);
            setOrder('asc');
        } else {
            setOrderBy(columnId);
            setOrder('asc');
        }
        setPage(0);
    };

    return (
        <Box className="table-container table-container-small"
            sx={{
                width: '100%',
                "& .MuiTableCell-root": {
                    fontSize: 10, maxWidth: maxCellWidth || "60px", padding: compact ? "2px 4px" : "6px",
                    overflow: "clip", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }
            }}>
            <TableContainer sx={{ maxHeight: maxHeight }}>
                <Table stickyHeader aria-label="sticky table">
                    <TableHead>
                        <TableRow>
                            {columnDefs.map((column, i) => {
                                let backgroundColor = "none";
                                let borderBottomColor = theme.palette.primary.main;
                                if (column.source == "custom") {
                                    backgroundColor = alpha(theme.palette.custom.main, 0.05);
                                    borderBottomColor = theme.palette.custom.main;
                                } 
                                return <TableCell
                                        key={column.id}
                                        align={column.align}
                                        sx={{
                                            minWidth: column.minWidth, fontSize: 12, color: "#333",
                                            backgroundColor: backgroundColor,
                                            borderBottomColor, borderBottomWidth: '1px', borderBottomStyle: 'solid',
                                            cursor: 'pointer',
                                            '&:hover': { backgroundColor: alpha(borderBottomColor, 0.08) },
                                        }}
                                        onClick={() => handleSortClick(column.id)}
                                    >
                                        <TableSortLabel
                                            active={orderBy === column.id}
                                            direction={orderBy === column.id ? order : 'asc'}
                                            sx={{
                                                '& .MuiTableSortLabel-icon': { fontSize: 14 },
                                            }}
                                        >
                                            {column.label}
                                        </TableSortLabel>
                                    </TableCell>
                                })
                            }
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                            .map((row, i) => {
                                return (
                                    <TableRow hover tabIndex={-1} key={i} sx={{ background: i % 2 == 0 ? '#F0F0F0' : "none" }}>
                                        {columnDefs.map((column, j) => {
                                            const value = row[column.id];
                                            let backgroundColor = "none";
                                            if (column.source == "custom") {
                                                backgroundColor = alpha(theme.palette.custom.main, 0.05);
                                            } 
                                            return (
                                                <TableCell key={column.id} align={column.align}
                                                    sx={{ backgroundColor }}>
                                                    {column.format
                                                        ? column.format(value)
                                                        : formatCellValue(value)}
                                                </TableCell>
                                            );
                                        })}
                                    </TableRow>
                                );
                            })}
                            {isIncompleteTable && (
                                <TableRow>
                                    {columnDefs.map((column, i) => (
                                        <TableCell key={i} sx={{padding: 0}} align="left">
                                            ......
                                        </TableCell>
                                    ))}
                                </TableRow> 
                            )}
                    </TableBody>
                </Table>
            </TableContainer>
            
            {rowsPerPage < sortedRows.length ? <TablePagination
                sx={{
                    "color": "gray",
                    "& .MuiInputBase-root": { fontSize: 10 },
                    "& .MuiTablePagination-selectLabel": { fontSize: 10 },
                    "& .MuiTablePagination-displayedRows": { fontSize: 10 },
                    "& .MuiButtonBase-root": { padding: 0 },
                    "& .MuiToolbar-root": { minHeight: 12, height: 18},
                    "& .MuiTablePagination-toolbar": { paddingRight: 0 },
                    "& .MuiSvgIcon-root": { fontSize: '1rem' }
                }}
                SelectProps={{
                    MenuProps: {
                        sx: {
                            '.MuiPaper-root': {},
                            '.MuiTablePagination-menuItem': { fontSize: 12 },
                        },
                    }
                }}
                rowsPerPageOptions={[10]}
                component="div"
                count={sortedRows.length}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                showFirstButton
                showLastButton
            /> : ""}
        </Box>
    );
}
