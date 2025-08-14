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
import { alpha, Box, useTheme } from '@mui/system';
import Typography from '@mui/material/Typography';


export interface ColumnDef {
    id: string;
    label: string;
    minWidth?: number;
    align?: 'right';
    source?: 'derived' | 'original' | 'custom' ;
    format?: (value: number) => string;
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

    const handleChangePage = (event: unknown, newPage: number) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
        setRowsPerPage(+event.target.value);
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
                                if (column.source == "derived") {
                                    backgroundColor = alpha(theme.palette.derived.main, 0.05);
                                    borderBottomColor = theme.palette.derived.main;
                                } else if (column.source == "custom") {
                                    backgroundColor = alpha(theme.palette.custom.main, 0.05);
                                    borderBottomColor = theme.palette.custom.main;
                                } 
                                return <TableCell
                                        key={column.id}
                                        align={column.align}
                                        sx={{
                                            minWidth: column.minWidth, fontSize: 12, color: "#333",
                                            backgroundColor: backgroundColor,
                                            borderBottomColor, borderBottomWidth: '1px', borderBottomStyle: 'solid'
                                        }}
                                    >
                                        {column.label}
                                    </TableCell>
                                })
                            }
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                            .map((row, i) => {
                                return (
                                    <TableRow hover tabIndex={-1} key={i} sx={{ background: i % 2 == 0 ? '#F0F0F0' : "none" }}>
                                        {columnDefs.map((column, j) => {
                                            const value = row[column.id];
                                            let backgroundColor = "none";
                                            if (column.source == "derived") {
                                                backgroundColor = alpha(theme.palette.derived.main, 0.05);
                                            } else if (column.source == "custom") {
                                                backgroundColor = alpha(theme.palette.custom.main, 0.05);
                                            } 
                                            return (
                                                <TableCell key={column.id} align={column.align}
                                                    sx={{ backgroundColor }}>
                                                    {column.format
                                                        ? column.format(value)
                                                        : (typeof value === "boolean" ? `${value}` : value)}
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
            
            {rowsPerPage < rows.length ? <TablePagination
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
                count={rows.length}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                showFirstButton
                showLastButton
                //onRowsPerPageChange={handleChangeRowsPerPage}
            /> : ""}
        </Box>
    );
}