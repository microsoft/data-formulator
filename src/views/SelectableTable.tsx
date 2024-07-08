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
import { Box } from '@mui/system';


import { TSelectableItemProps, createSelectable } from 'react-selectable-fast';
import { SelectableGroup } from 'react-selectable-fast';
import { Type } from '../data/types';
import { getIconFromType } from './ViewUtils';
import { IconButton, TableSortLabel, Tooltip, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';

import _ from 'lodash';
import { FieldSource } from '../components/ComponentType';

import { useTheme } from '@mui/material/styles';
import { alpha } from "@mui/material";


interface SelectableCellProps {
    align: any;
    value: any;
    column: any;
    source: FieldSource;
    indices: number[];
    selectedBounds: number[];
    onClick: (event: any) => void;
}

const SelectableCell = createSelectable<SelectableCellProps>((props: TSelectableItemProps & SelectableCellProps) => {
    let { selectableRef, isSelected, isSelecting, value, align, indices, selectedBounds, source, onClick } = props;

    let theme = useTheme();

    // Kind of a hack to change selected bounds but didn't want to redraw every cell
    const classNames = [
        'item',
        isSelecting && 'selecting',
        isSelected && 'selected',
        //source,
        // indices[0] === selectedBounds[0] && 'selected-left',
        // indices[0] === selectedBounds[2] && 'selected-right',
        // indices[1] === selectedBounds[1] && 'selected-top',
        // indices[1] === selectedBounds[3] && 'selected-bottom',
    ]
        .filter(Boolean)
        .join(' ');

    let backgroundColor = "white";
    if (source == "derived") {
        backgroundColor = alpha(theme.palette.derived.main, 0.05);
    } else if (source == "custom") {
        backgroundColor = alpha(theme.palette.custom.main, 0.05);
    } else {
        backgroundColor = "white"
    }

    return (
        <TableCell align={align} sx={{backgroundColor}}
            ref={selectableRef} className={classNames} onClick={onClick}
        >
            {typeof value == "boolean" ? `${value}` : value}
        </TableCell>
    )
});

interface SelectableTableBodyProps {
    rows: any[];
    columnDefs: ColumnDef[];
    selectedBounds: [number, number, number, number];
    onSelect: (columns: string[], values: any[]) => void;
    onClickCell: (event: any) => void;
}

export const SelectableTableBody: React.FC<SelectableTableBodyProps> = ({ rows, columnDefs, onSelect, selectedBounds, onClickCell }) => {

    return (
        <TableBody>
            {rows.map((row, i) => {
                return (
                    <TableRow hover role="checkbox" tabIndex={-1} key={i}>
                        {columnDefs.map((column, j) => {
                            const value = row[column.id];
                            return (
                                <SelectableCell align={column.align} key={`${i}-${j}`} column={column.id} source={column.source} indices={[j, i]}
                                    selectedBounds={selectedBounds} onClick={onClickCell}
                                    value={column.format && typeof value === 'number' ? column.format(value) : value} />
                            );
                        })}
                    </TableRow>
                );
            })}
        </TableBody>
    );
}

interface SelectableTableHeaderProps {
    selectedColumnNames: string[],
    columnDefs: ColumnDef[];
    order: 'asc' | 'desc';
    orderBy: string | undefined;
    onChangeOrder: (orderBy: string | undefined, order: 'asc' | 'desc') => void;
}

export const SelectableTableHeader: React.FC<SelectableTableHeaderProps> = ({ columnDefs, orderBy, order, selectedColumnNames, onChangeOrder }) => {
    let theme = useTheme();

    return (
        <TableHead sx={{ zIndex: 19999, position: "relative" }}>
            <TableRow>
                {columnDefs.map((column, index) => {
                    const classNames = [
                        'data-view-header-cell',
                        selectedColumnNames.includes(column.id) && 'selected',
                        //column.source
                    ]
                        .filter(Boolean)
                        .join(' ');

                    let backgroundColor = "white";
                    let borderBottomColor = theme.palette.primary.main;
                    if (column.source == "derived") {
                        backgroundColor = alpha(theme.palette.derived.main, 0.05);
                        borderBottomColor = theme.palette.derived.main;
                    } else if (column.source == "custom") {
                        backgroundColor = alpha(theme.palette.custom.main, 0.05);
                        borderBottomColor = theme.palette.custom.main;
                    } else {
                        backgroundColor = "white";
                        borderBottomColor = theme.palette.primary.main;
                    }

                    return (
                        <TableCell
                            key={column.id}
                            align={column.align}
                            sortDirection={orderBy === column.id ? order : false}
                            className={classNames}
                            sx={{backgroundColor: 'white', borderBottomColor, 
                                "& .MuiTableCell-root": {
                                    padding: "2px 4px",
                                }
                            }}
                            style={{ minWidth: column.minWidth }}
                        >
                            <Box className="data-view-header-container" sx={{backgroundColor}} >
                                <TableSortLabel
                                    sx={{ display: "flex", flexDirection: "row", width: "100%" }}
                                    active={orderBy === column.id}
                                    direction={orderBy === column.id ? order : 'asc'}
                                    onClick={() => {
                                        const newOrder = (orderBy === column.id && order === 'asc') ? 'desc' : 'asc';
                                        onChangeOrder(column.id, newOrder);
                                    }}
                                >
                                    <Box component="span" className="data-view-header-title">
                                        <Tooltip title={`${column.dataType} type`} >
                                            <IconButton size="small" sx={{ fontSize: "inherit", padding: "2px" }} component="span"
                                            >
                                                {getIconFromType(column.dataType)}
                                            </IconButton>
                                        </Tooltip>
                                        <Typography className="data-view-header-name">{column.label}</Typography>
                                    </Box>
                                    {orderBy === column.id ? (
                                        <Box component="span" sx={visuallyHidden}>
                                            {order === 'desc' ? 'sorted descending' : 'sorted ascending'}
                                        </Box>
                                    ) : null}
                                </TableSortLabel>
                            </Box>

                        </TableCell>
                    )
                })}
            </TableRow>
        </TableHead>
    );
}


export interface ColumnDef {
    id: string;
    label: string;
    dataType: Type;
    minWidth?: number;
    align?: 'right';
    format?: (value: number) => string;
    source: FieldSource;
}

interface SelectableTableProps {
    rows: any[];
    columnDefs: ColumnDef[];
    rowsPerPageNum: number;
    onSelect: (columns: string[], values: any[]) => void;
    $tableRef: React.RefObject<SelectableGroup>;
}

function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
    if (b[orderBy] < a[orderBy]) {
        return -1;
    }
    if (b[orderBy] > a[orderBy]) {
        return 1;
    }
    return 0;
}

function getComparator<Key extends keyof any>(
    order: "asc" | "desc",
    orderBy: Key,
): (
    a: { [key in Key]: number | string },
    b: { [key in Key]: number | string },
) => number {
    return order === 'desc'
        ? (a, b) => descendingComparator(a, b, orderBy)
        : (a, b) => -descendingComparator(a, b, orderBy);
}

export const SelectableTable: React.FC<SelectableTableProps> = ({ rows, columnDefs, rowsPerPageNum, $tableRef, onSelect }) => {

    const [page, setPage] = React.useState(0);
    const [rowsPerPage, setRowsPerPage] = React.useState(rowsPerPageNum === -1 ? (rows.length > 500 ? 20 : rows.length) : rowsPerPageNum);
    const [orderBy, setOrderBy] = React.useState<string | undefined>(undefined);
    const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');

    const [selectedBounds, setSelectedBounds] = React.useState<[number, number, number, number]>([0, 0, 0, 0]);
    const [selectedColumnNames, setSelectedColumnNames] = React.useState<string[]>([]);

    React.useEffect(() => {
        // use this to handle cases when the table add new columns/remove new columns etc
        $tableRef.current?.clearSelection();
    }, [columnDefs.length])

    const handleChangePage = (event: unknown, newPage: number) => {
        $tableRef.current?.clearSelection();
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
        $tableRef.current?.clearSelection();
        setRowsPerPage(+event.target.value);
        setPage(0);
    };

    const rowsToDisplay = rows.slice()
        .sort(getComparator(order, orderBy || "#rowId"))
        .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const onClickCell = (event: any) => {
        console.log('click cell');
        console.log(event);
        let item = undefined;
        for (const r of $tableRef.current ? $tableRef.current.registry : []) {
            if (r.node === event.target) {
                item = r;
            }
        }
        if (item) {
            if (item.state.isSelected) {
                $tableRef.current?.selectedItems.delete(item);
            } else {
                $tableRef.current?.selectedItems.add(item);
            }
            item.setState({ isSelected: !item.state.isSelected });
            $tableRef.current?.props.onSelectionFinish!([...$tableRef.current?.selectedItems])
        }
    }

    // @ts-ignore
    return (
        <Box className="table-container table-container-small"
            sx={{
                width: '100%',
                "& .MuiTableCell-root": {
                    fontSize: 12, maxWidth: "120px", padding: "2px 4px", cursor: "default",
                    overflow: "clip", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }
            }}>
            <TableContainer sx={{ height: "100%" }}>
                {/* @ts-expect-error */}
                <SelectableGroup
                    ref={$tableRef}
                    className={'custom-row-selector '}
                    tolerance={0}
                    enableDeselect={true}
                    selectOnClick={false}
                    deselectOnEsc={true}
                    resetOnStart={true}
                    onSelectionClear={() => {
                        setSelectedBounds([0, 0, 0, 0]);
                        setSelectedColumnNames([]);
                        onSelect([], []);
                    }}
                    onSelectionFinish={(selected: any[]) => {
                        // console.log($tableRef.current);
                        // Get bounds based on indices
                        let left = _.min(selected.map(x => x.props.indices[0])),
                            right = _.max(selected.map(x => x.props.indices[0])),
                            bottom = _.max(selected.map(x => x.props.indices[1])),
                            top = _.min(selected.map(x => x.props.indices[1]));

                        let columns = _.uniq(selected.map(x => x.props.column));

                        setSelectedBounds([left, top, right, bottom]);
                        setSelectedColumnNames(columns as string[]);

                        let values = selected.map(x => x.props.value);
                        // setSelectedColumns(columns);
                        onSelect(columns, values);
                        // setHighlightCols(columns);
                    }}
                    ignoreList={[".MuiTableCell-head"]}>
                    <Table
                        stickyHeader
                        aria-label="sticky table">
                        <SelectableTableHeader
                            columnDefs={columnDefs}
                            order={order}
                            orderBy={orderBy}
                            selectedColumnNames={selectedColumnNames}
                            onChangeOrder={(orderBy: string | undefined, order: "asc" | "desc") => {
                                setOrderBy(orderBy);
                                setOrder(order);
                            }} />
                        <SelectableTableBody
                            rows={rowsToDisplay}
                            selectedBounds={selectedBounds}
                            columnDefs={columnDefs}
                            onSelect={onSelect}
                            onClickCell={onClickCell} />
                    </Table>
                </SelectableGroup>
            </TableContainer>
            <TablePagination
                sx={{
                    "color": "gray",
                    "& .MuiInputBase-root": { fontSize: 12 },
                    "& .MuiTablePagination-selectLabel": { fontSize: 12 },
                    "& .MuiTablePagination-displayedRows": { fontSize: 12 },
                    "& .MuiButtonBase-root": { padding: 0 },
                    "& .MuiToolbar-root": { minHeight: 12 },
                    overflow: "hidden",
                }}
                SelectProps={{
                    MenuProps: {
                        sx: {
                            '.MuiPaper-root': {},
                            '.MuiTablePagination-menuItem': { fontSize: 12 },
                        },
                    }
                }}
                rowsPerPageOptions={[50, 100, 500]}
                component="div"
                count={rows.length}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
            />
        </Box>
    );
}
