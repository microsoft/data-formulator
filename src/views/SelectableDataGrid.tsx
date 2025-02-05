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
import { alpha, Collapse, Divider, Paper, ToggleButton, Tooltip } from "@mui/material";

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
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { dfActions, dfSelectors } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { getUrls } from '../app/utils';

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
    tableName: string;
    rows: any[];
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

export const SelectableDataGrid: React.FC<SelectableDataGridProps> = ({ rows, tableName, columnDefs, $tableRef, onSelectionFinished }) => {

    const [footerActionExpand, setFooterActionExpand] = React.useState<boolean>(false);
    let activeModel = useSelector(dfSelectors.getActiveModel);
    
    const [orderBy, setOrderBy] = React.useState<string | undefined>(undefined);
    const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');
    const [searchText, setSearchText] = React.useState<string>('');
    const [searchValue, setSearchValue] = React.useState<string>('');

    const [selectedCells, setSelectedCells] = React.useState<[number, number][]>([]);
    const [selectedColumnNames, setSelectedColumnNames] = React.useState<string[]>([]);

    let theme = useTheme();
    let dispatch = useDispatch();

    React.useEffect(() => {
        // use this to handle cases when the table add new columns/remove new columns etc
        $tableRef.current?.clearSelection();
    }, [columnDefs.length])

    const rowsToDisplay = rows.slice()
        .sort(getComparator(order, orderBy || "#rowId"))
        .filter((row: any) => {
            if (searchValue === '') return true;
            return columnDefs.map((columnDef: ColumnDef) => (row[columnDef.id] + '').toLowerCase()).join(' ').includes(searchValue.toLowerCase());
        })
    //     .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const onClickCell = (event: any, rowIndex: number, colIndex: number) => {
        // console.log('click cell');
        // console.log(_.without(selectedCells, [rowIndex, colIndex]));
        // console.log(event);
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
        TableHead: (props: any) => <TableHead {...props} className='table-header-container' />,
        TableRow: (props: any) => {
            const index = props['data-index'];
            return <TableRow {...props} style={{backgroundColor: index % 2 == 0 ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.02)"}}/>
        }, //
        //TableRow: TableRow,
        TableBody: TableBody,
    }

    const handleSelectionClear = () => {
        setSelectedCells([]);
        setSelectedColumnNames([]);
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

        setSelectedColumnNames(columns);
        onSelectionFinished(columns, values);
    }

    let footerActionsItems = 
        <Box sx={{display: 'flex'}}>
            <Box key="search-box">
                <OutlinedInput
                    className="table-search-input"
                    sx={{paddingLeft: 1, paddingRight: 0}}
                    size="small"
                    value={searchText}
                    placeholder="Search in table"
                    startAdornment={
                        searchText.length > 0 ?
                            (
                                <InputAdornment position="start">
                                    <IconButton
                                        aria-label="toggle search"
                                        size="small"
                                        color="primary"
                                        onClick={() => {
                                            setSearchText('');
                                        }}
                                    >
                                        <ArrowBack fontSize='small' />
                                    </IconButton>
                                </InputAdornment>
                            ) : (
                                <InputAdornment position="start">
                                    <SearchIcon fontSize='small' sx={{ padding: '2px' }} />
                                </InputAdornment>
                            )
                    }
                    endAdornment={
                        searchText.length > 0 ? <InputAdornment position="end">
                                    <SearchIcon fontSize='small'/> 
                        </InputAdornment> : ""
                        // <InputAdornment position="end">
                        //     {
                        //         searchText.length > 0 ?
                        //             <SearchIcon fontSize='small'/> : ""
                        //     }
                        // </InputAdornment>
                    }
                    onChange={(event) => {
                        setSearchText(event.target.value);
                    }}
                />
                {searchText.length > 0 ? <Typography component="span" className="table-footer-number" sx={{ margin: "auto 8px" }}>
                    {`${rowsToDisplay.length} matches`}   
                </Typography>: ''}
            </Box>
            {/* <Tooltip key="delete-action" title={`Delete ${tableName}\n(note: all charts and concepts based on this table will be deleted)`}>
                <IconButton size="small" color="warning" sx={{marginRight: 1}} onClick={() => {
                    dispatch(dfActions.deleteTable(tableName))
                }}>
                    <DeleteIcon/>
                </IconButton>
            </Tooltip> */}
            
            <Tooltip title="Infer Data Type">
            <IconButton size="small" color="primary"
                onClick={() => {
                        console.log(`[fyi] just sent request to process load data`);
    
                        console.log(rows);

                        let message = {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', },
                            body: JSON.stringify({
                                token: Date.now(),
                                input_data: {name: tableName, rows: rows},
                                model: activeModel
                            }),
                        };
        
                         // timeout the request after 20 seconds
                        const controller = new AbortController()
                        const timeoutId = setTimeout(() => controller.abort(), 20000)
    
                        fetch(getUrls().SERVER_PROCESS_DATA_ON_LOAD, {...message, signal: controller.signal })
                            .then((response) => response.json())
                            .then((data) => {
                                console.log("---model output")
                                console.log(data);
    
                                let status = data["status"];
                                let codeList: string[] = [];
    
                                if (data["status"] == "ok") {
                                    codeList = data["result"];
                                    console.log(codeList)
                                }
                            }).catch((error) => {
                            });
                    }
                }
            ><AutoFixNormalIcon /></IconButton></Tooltip>
            <Divider flexItem  orientation="vertical" sx={{marginRight: 1}}/>
        </Box>

    // @ts-ignore
    return (
        <Box className="table-container table-container-small"
            sx={{
                width: '100%',
                height: '100%',
                "& .MuiTableCell-root": {
                    fontSize: 12, maxWidth: "120px", padding: "2px 6px", cursor: "default",
                    overflow: "clip", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }
            }}>
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
                                    const classNames = [
                                        'data-view-header-cell',
                                        //columnDef.source
                                    ]
                                    .filter(Boolean)
                                    .join(' ');

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
                                            className={classNames}
                                            key={columnDef.id}
                                            align={columnDef.align}
                                            style={{ padding: 0, minWidth: columnDef.minWidth, width: columnDef.width, }}
                                            sx={{}}
                                        >
                                            <Box className="data-view-header-container" 
                                                 sx={{ backgroundColor, borderBottomColor, borderBottomWidth: '2px', borderBottomStyle: 'solid'}}>
                                                <TableSortLabel
                                                    sx={{ display: "flex", flexDirection: "row", width: "100%" }}
                                                    active={orderBy === columnDef.id}
                                                    direction={orderBy === columnDef.id ? order : 'asc'}
                                                    onClick={() => {
                                                        const newOrder = (orderBy === columnDef.id && order === 'asc') ? 'desc' : 'asc';
                                                        setOrder(newOrder);
                                                        setOrderBy(columnDef.id);
                                                    }}
                                                >
                                                    <Box component="span" className="data-view-header-title">
                                                        <Tooltip title={`${columnDef.dataType} type`} >
                                                            <span role="img" style={{ fontSize: "inherit", padding: "2px", display: "inline-flex", alignItems: "center" }}>
                                                                {getIconFromType(columnDef.dataType)}
                                                            </span>
                                                        </Tooltip>
                                                        <Typography className="data-view-header-name">{columnDef.label}</Typography>
                                                    </Box>
                                                </TableSortLabel>

                                            </Box>
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
            <Paper className="table-footer-container"
                sx={{ borderTop: '1px solid', borderColor: 'rgba(0, 0, 0, 0.12)', padding: '6px', 
                      display: 'flex', flexDirection: 'row',  position: 'absolute', bottom: 0, right: 15 }}>
                <Tooltip title="Table options">
                    <ToggleButton
                        color="primary"
                        size="small"
                        value="check"
                        sx={{ margin: "0px 6px 0px 0px", padding: "0px 2px", border: 'none', color: theme.palette.primary.main }}
                        selected={footerActionExpand}
                        onChange={() => {
                            if (footerActionExpand) {
                                setSearchText("");
                            }
                            setFooterActionExpand(!footerActionExpand);
                        }}
                        >
                        {footerActionExpand ? <ChevronLeftIcon sx={{transform: footerActionExpand ? 'rotate(180deg)' : 'rotate(0)'}} /> : <ChevronLeftIcon /> }
                    </ToggleButton>
                </Tooltip>
                {/* <Button variant="text" sx={{padding: '0px 4px', margin:'0px 2px', minWidth: 0}} size="small" 
                        onClick={() => { setFooterActionExpand(!footerActionExpand) }}>{"<"}</Button> */}
                <Collapse orientation="horizontal"  in={footerActionExpand}>
                    {footerActionsItems}
                </Collapse>
                <Box sx={{display: 'flex', alignItems: 'center',  marginRight: 1}}>
                    <Tooltip title={`Download ${tableName} as CSV`}>
                        <IconButton size="small" color="primary" sx={{marginRight: 1}}
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
                            <FileDownloadIcon/>
                        </IconButton>
                    </Tooltip>
                    <Typography  className="table-footer-number">
                        {`${rows.length} rows`}
                    </Typography>
                </Box>
            </Paper>
        </Box >
    );
}
