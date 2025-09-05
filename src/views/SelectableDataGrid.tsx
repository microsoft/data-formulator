// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { Box } from '@mui/system';

import { useTheme } from '@mui/material/styles';
import { alpha, Collapse, Divider, Paper, ToggleButton, Tooltip, CircularProgress } from "@mui/material";

import { TSelectableItemProps, createSelectable } from 'react-selectable-fast';
import { SelectableGroup } from 'react-selectable-fast';
import { Type } from '../data/types';
import { getIconFromType } from './ViewUtils';

import { IconButton, InputAdornment, OutlinedInput, TableSortLabel, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ArrowBack from '@mui/icons-material/ArrowBack';
import AutoFixNormalIcon from '@mui/icons-material/AutoFixNormal';

import _ from 'lodash';
import { FieldSource } from '../components/ComponentType';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import CasinoIcon from '@mui/icons-material/Casino';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import Button from '@mui/material/Button';
import { getUrls } from '../app/utils';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';

interface SelectableCellProps {
    align: any;
    value: any;
    column: ColumnDef;
    sx?: any;
    // source: FieldSource;
    indices: number[];
    selectedBounds: number[];
    match: string;
    onClick: (event: any) => void;
    selected?: boolean;
}

const SelectableCell = createSelectable<SelectableCellProps>((props: TSelectableItemProps & SelectableCellProps) => {
    let { selectableRef, selected, isSelected, column, isSelecting, value, align, indices, selectedBounds, onClick, match } = props;
    let theme = useTheme();
    

    // Kind of a hack to change selected bounds but didn't want to redraw every cell
    const classNames = [
        'item',
        isSelecting && 'selecting',
        (selected || isSelected) && 'selected',
        //column.source,
    ]
    .filter(Boolean)
    .join(' ');

    let backgroundColor = "white";
    if (column.source == "derived") {
        backgroundColor = alpha(theme.palette.derived.main, 0.05);
    } else if (column.source == "custom") {
        backgroundColor = alpha(theme.palette.custom.main, 0.05);
    } else {
        backgroundColor = "rgba(255,255,255,0.05)";
    }

    const matchIndex = `${value}`.indexOf(match);

    return (

        <TableCell
            key={`row-${indices[0]}-col-${indices[1]}`}
            ref={selectableRef}
            sx={{backgroundColor}}
            className={classNames}
            align={align || 'left'}
            onClick={onClick}
        >
            {
                match.length > 0 && matchIndex > -1 ? (
                    [
                        `${value}`.substring(0, matchIndex),
                        <span 
                            key={`match-${indices[0]}-${indices[1]}`}
                            className="bold">{match}</span>,
                        `${value}`.substring(matchIndex + match.length)
                    ]
                ) : (value)
            }
        </TableCell>
    )
});

export interface ColumnDef {
    id: string;
    label: string;
    dataType: Type;
    minWidth?: number;
    width?: number;
    align?: 'right';
    format?: (value: number) => string | JSX.Element;
    source: FieldSource;
}

interface SelectableDataGridProps {
    tableId: string;
    tableName: string;
    rows: any[];
    rowCount: number;
    virtual: boolean;
    columnDefs: ColumnDef[];
    onSelectionFinished: (columns: string[], values: any[]) => void;
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

export const SelectableDataGrid: React.FC<SelectableDataGridProps> = ({ tableId, rows, tableName, columnDefs, $tableRef, onSelectionFinished, rowCount, virtual }) => {

    const [orderBy, setOrderBy] = React.useState<string | undefined>(undefined);
    const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');
    const [searchText, setSearchText] = React.useState<string>('');
    const [searchValue, setSearchValue] = React.useState<string>('');

    const [selectedCells, setSelectedCells] = React.useState<[number, number][]>([]);

    let theme = useTheme();

    const [rowsToDisplay, setRowsToDisplay] = React.useState<any[]>(rows);
    
    const [isLoading, setIsLoading] = React.useState<boolean>(false);
    
    React.useEffect(() => {
        // use this to handle cases when the table add new columns/remove new columns etc
        $tableRef.current?.clearSelection();
    }, [columnDefs.length])

    React.useEffect(() => {
        setRowsToDisplay(rows.slice()
            .sort(getComparator(order, orderBy || columnDefs[0].id))
            .filter((row: any) => {
                if (searchValue === '') return true;
                return columnDefs.map((columnDef: ColumnDef) => (row[columnDef.id] + '').toLowerCase()).join(' ').includes(searchValue.toLowerCase());
            })
        )
    }, [rows, order, orderBy, searchValue])

    const onClickCell = (event: any, rowIndex: number, colIndex: number) => {
        for (let i = 0; i < selectedCells.length; i++) {
            const [r, c] = selectedCells[i];
            if (r === rowIndex && c === colIndex) {
                selectedCells.splice(i, 1)
                setSelectedCells([...selectedCells]);
                return;
            }
        }
        selectedCells.splice(_.sortedIndex(selectedCells, [rowIndex, colIndex]), 0, [rowIndex, colIndex]);
        setSelectedCells([...selectedCells]);
    }

    const TableComponents = {
        Scroller: TableContainer,
        Table: Table,
        TableHead: React.forwardRef<HTMLTableSectionElement, any>((props, ref) => <TableHead {...props} ref={ref} className='table-header-container' />) as any,
        TableRow: (props: any) => {
            const index = props['data-index'];
            return <TableRow {...props} style={{backgroundColor: index % 2 == 0 ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.02)"}}/>
        },
        TableBody: TableBody,
    }

    const handleSelectionClear = () => {
        setSelectedCells([]);
    }

    const debouncedSearchHandler = React.useCallback(_.debounce((value: string) => {
        setSearchValue(value);
    }, 300), [searchText]);

    React.useEffect(() => {
        debouncedSearchHandler(searchText);
    }, [searchText, debouncedSearchHandler]);

    const handleSelectionFinish = (selected: any[]) => {
        let newSelectedCells = _.uniq(selected.map(x => x.props.indices));
        setSelectedCells(newSelectedCells);
        let values = selected.map(x => x.props.value);
        let columns = _.uniq(selected.map(x => x.props.column.id));

        onSelectionFinished(columns, values);
    }

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const menuEl = document.getElementById('sampling-menu');
            if (menuEl && menuEl.style.display === 'block') {
                const isClickInsideMenu = menuEl.contains(event.target as Node);
                const isClickOnButton = (event.target as Element).closest('[data-sampling-button]') !== null;
                
                if (!isClickInsideMenu && !isClickOnButton) {
                    menuEl.style.display = 'none';
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const fetchSortedVirtualData = (columnIds: string[], sortOrder: 'asc' | 'desc') => {
        // Set loading to true when starting the fetch
        setIsLoading(true);
        
        // Use the SAMPLE_TABLE endpoint with appropriate ordering
        fetch(getUrls().SAMPLE_TABLE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                table: tableId,
                size: 1000,
                method: sortOrder === 'asc' ? 'head' : 'bottom',
                order_by_fields: columnIds
            }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                setRowsToDisplay(data.rows);
            }
            // Set loading to false when done
            setIsLoading(false);
        })
        .catch(error => {
            console.error('Error fetching sorted table data:', error);
            // Ensure loading is set to false even on error
            setIsLoading(false);
        });
    };

    return (
        <Box className="table-container table-container-small"
            sx={{
                width: '100%',
                height: '100%',
                position: 'relative',
                "& .MuiTableCell-root": {
                    fontSize: 12, maxWidth: "120px", py: '2px', cursor: "default",
                    overflow: "clip", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }
            }}>
            {/* Loading Overlay */}
            {isLoading && (
                <Box sx={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    right: 0,
                    zIndex: 10, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    padding: '8px',
                    height: '100%',
                    borderTopLeftRadius: '4px',
                    borderTopRightRadius: '4px'
                }}>
                    <CircularProgress size={24} sx={{ mr: 1 }} />
                    <Typography variant="body2" color="darkgray">Fetching data...</Typography>
                </Box>
            )}
            {/* @ts-expect-error */}
            <SelectableGroup
                ref={$tableRef}
                className={'custom-row-selector'}
                tolerance={0}
                allowAltClick={true}
                allowCtrlClick={true}
                allowMetaClick={true}
                allowShiftClick={true}
                enableDeselect={true}
                selectOnClick={false}
                deselectOnEsc={true}
                resetOnStart={true}
                style={{ flex: '1 1 300px' }}
                onSelectionClear={handleSelectionClear}
                onSelectionFinish={handleSelectionFinish}
                ignoreList={[".MuiTableCell-head"]}
            >
                <TableVirtuoso
                    style={{ flex: '1 1 300px' }}
                    data={rowsToDisplay}
                    components={TableComponents}
                    fixedHeaderContent={() => {
                        return (
                            <TableRow key='header-fixed' style={{ paddingRight: 0, marginRight: '17px', height: '24px'}}>
                                {columnDefs.map((columnDef, index) => {
                                    let backgroundColor = "white";
                                    let borderBottomColor = theme.palette.primary.main;
                                    if (columnDef.source == "derived") {
                                        backgroundColor = alpha(theme.palette.derived.main, 0.05);
                                        borderBottomColor = theme.palette.derived.main;
                                    } else if (columnDef.source == "custom") {
                                        backgroundColor = alpha(theme.palette.custom.main, 0.05);
                                        borderBottomColor = theme.palette.custom.main;
                                    } else {
                                        backgroundColor = "white";
                                        borderBottomColor = theme.palette.primary.main;
                                    }

                                    return (
                                        <TableCell
                                            className='data-view-header-cell'
                                            key={columnDef.id}
                                            align={columnDef.align}
                                            sx={{p: 0, minWidth: columnDef.minWidth, width: columnDef.width,}}
                                        >
                                            <Tooltip title={`${columnDef.label}`} >
                                                <Box className="data-view-header-container" 
                                                     sx={{ backgroundColor, borderBottomColor, borderBottomWidth: '2px', borderBottomStyle: 'solid'}}>
                                                    <TableSortLabel
                                                    className="data-view-header-title"
                                                    sx={{ display: "flex", flexDirection: "row", width: "100%" }}
                                                    active={orderBy === columnDef.id}
                                                    direction={orderBy === columnDef.id ? order : 'asc'}
                                                    onClick={() => {
                                                        let newOrder: 'asc' | 'desc' = 'asc';
                                                        let newOrderBy : string | undefined = columnDef.id;
                                                        if (orderBy === columnDef.id && order === 'asc') {
                                                            newOrder = 'desc';
                                                        } else if (orderBy === columnDef.id && order === 'desc') {
                                                            newOrder = 'asc';
                                                            newOrderBy = undefined;
                                                        } else {
                                                            newOrder = 'asc';
                                                        }

                                                        setOrder(newOrder);
                                                        setOrderBy(newOrderBy);
                                                        
                                                        if (virtual) {
                                                            fetchSortedVirtualData(newOrderBy ? [newOrderBy] : [], newOrder);
                                                        }
                                                    }}
                                                >
                                                    <span role="img" style={{ fontSize: "inherit", padding: "2px", display: "inline-flex", alignItems: "center" }}>
                                                        {getIconFromType(columnDef.dataType)}
                                                    </span>
                                                    <Typography className="data-view-header-name">
                                                        {columnDef.label}
                                                    </Typography>
                                                </TableSortLabel>
                                            </Box>
                                            </Tooltip>
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        )
                    }}
                    itemContent={(rowIndex, data) => {
                        return (
                            <>
                                {columnDefs.map((column, colIndex) => {
                                    return (
                                        <SelectableCell
                                            key={`col-${colIndex}-row-${rowIndex}`}
                                            selected={selectedCells.some(([r, c]) => r === rowIndex && c === colIndex)}
                                            align={column.align}
                                            column={column}
                                            indices={[rowIndex, colIndex]}
                                            match={searchValue}
                                            onClick={(event) => onClickCell(event, rowIndex, colIndex)}
                                            value={column.format ? column.format(data[column.id]) : data[column.id]}
                                            selectedBounds={[]} />
                                    )
                                })}
                            </>
                        )
                    }}
                />
            </SelectableGroup>
            <Paper className="table-footer-container" variant="outlined"
                sx={{ display: 'flex', flexDirection: 'row',  position: 'absolute', bottom: 6, right: 6 }}>
                <Box sx={{display: 'flex', alignItems: 'center', ml: 1}}>
                    <Typography  className="table-footer-number" sx={{display: 'flex', alignItems: 'center'}}>
                        {virtual && <CloudQueueIcon sx={{fontSize: 16, mr: 1}}/> }
                        {virtual ? `${rowCount} rows` : `${rowsToDisplay.length} rows`}
                    </Typography>
                    {virtual && (
                        <>
                            <Tooltip title="view 1000 random rows from this table">
                                <IconButton 
                                    size="small" 
                                    color="primary" 
                                    sx={{marginRight: 1}}
                                    onClick={() => {
                                        fetch(getUrls().SAMPLE_TABLE, {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                            },
                                            body: JSON.stringify({
                                                table: tableId,
                                                size: 1000,
                                                method: 'random'
                                            }),
                                        })
                                        .then(response => response.json())
                                        .then(data => {
                                            if (data.status === 'success') {
                                                setRowsToDisplay(data.rows);
                                            }
                                        })
                                        .catch(error => {
                                            console.error('Error sampling table:', error);
                                        });
                                    }}
                                >
                                    <CasinoIcon sx={{
                                        fontSize: 18, 
                                        transition: 'transform 0.5s ease-in-out',
                                        '&:hover': {
                                            transform: 'rotate(180deg)'
                                        }
                                    }} />
                                </IconButton>
                            </Tooltip>
                        </>
                    )}
                    {!virtual && <Tooltip title={`Download ${tableName} as CSV`}>
                        <IconButton size="small" color="primary" 
                            onClick={() => {
                                // Create CSV content
                                const csvContent = [
                                    Object.keys(rows[0]).join(','), // Header row
                                    ...rows.map(row => Object.values(row).map(value => 
                                        // Handle values that need quotes (contain commas or quotes)
                                        typeof value === 'string' && (value.includes(',') || value.includes('"')) 
                                            ? `"${value.replace(/"/g, '""')}"` 
                                            : value
                                    ).join(','))
                                ].join('\n');

                                // Create and trigger download
                                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                                const link = document.createElement('a');
                                const url = URL.createObjectURL(blob);
                                link.setAttribute('href', url);
                                link.setAttribute('download', `${tableName}.csv`);
                                link.style.visibility = 'hidden';
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                            }}
                        >
                            <FileDownloadIcon sx={{fontSize: 18}} />
                        </IconButton>
                    </Tooltip>}
                </Box>
            </Paper>
        </Box >
    );
}
