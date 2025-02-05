// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useState, useRef } from 'react';

import _ from 'lodash';

import { Typography, Box, Button } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SouthIcon from '@mui/icons-material/South';
import NorthIcon from '@mui/icons-material/North';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';

import { AgGridReact } from 'ag-grid-react';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-material.css';
import '../scss/DataView.scss';

import { DictTable } from '../components/ComponentType';
import { ColDef, Column } from 'ag-grid-community';

import { useDispatch } from 'react-redux';

const DEFAULT_COL_DEF: ColDef = {
    editable: false,
    sortable: false,
    flex: 1,
    minWidth: 80,
    menuTabs: ['filterMenuTab', 'generalMenuTab'],
    filter: false,
    resizable: true,
};

interface SimpleDataHeaderProps {
    column: Column;
    displayName: string;
    eGridHeader: HTMLElement;
    menuIcon: string;
    showColumnMenu: (source: HTMLElement) => void;
    setSort: (
        sort: 'asc' | 'desc' | null,
        multiSort?: boolean
    ) => void;
    progressSort: (multiSort?: boolean) => void;
}

const SimpleDataHeaderFC: FC<SimpleDataHeaderProps> = (props: SimpleDataHeaderProps) => {
    const [ascSort, setAscSort] = useState('inactive');
    const [descSort, setDescSort] = useState('inactive');
    const [noSort, setNoSort] = useState('inactive');
    const refButton = useRef(null);

    const onMenuClicked = () => {
        if (refButton.current) {
            props.showColumnMenu(refButton.current);
        }
    }

    const onSortChanged = () => {
        setAscSort(props.column.isSortAscending() ? 'active' : 'inactive');
        setDescSort(props.column.isSortDescending() ? 'active' : 'inactive');
        setNoSort(!props.column.isSortAscending() && !props.column.isSortDescending() ? 'active' : 'inactive');
    }

    const onSortRequested = (order: 'asc' | 'desc' | null, event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => {
        props.setSort(order, event.shiftKey);
    }

    useEffect(() => {
        props.column.addEventListener('sortChanged', onSortChanged);
        onSortChanged()
    }, []);

    let menu = (
        <div ref={refButton}
            className="data-view-header-expand"
            onClick={() => onMenuClicked()}>
            <Typography><ExpandMoreIcon fontSize="inherit" /></Typography>
        </div>
    );
    //console.log(props)

    let sortIcon = null;
    switch (props.column.getSort()) {
        case 'asc':
            sortIcon = (<NorthIcon fontSize="inherit" />);
            break;
        case 'desc':
            sortIcon = (<SouthIcon fontSize="inherit" />);
            break;
    }

    let sort = (
        <div className="data-view-header-sort">
            <Typography>{sortIcon}</Typography>
        </div>
    );

    return (
        <Box className="data-view-header-container">
            <Box className="data-view-header-content" >
                <Typography align="center" className="data-view-header-label" sx={{fontSize: 10}}>{props.displayName}</Typography>
                {sort}
            </Box>
        </Box>
    );
};

export interface SimpleDataViewProps {
    table: DictTable;
    highlightedFields: string[];
    height? : number;
}

export interface SimpleDataViewState { }

export const SimpleDataViewFC: FC<SimpleDataViewProps> = function SimpleDataView({ table, highlightedFields, height=300 }) {

    let $gridApi = undefined;

    const dispatch = useDispatch();

    const rowData = table ? table.rows.map((r: any, i: number) => ({ ...r })) : [];
    const columns = table
        ? table.names.map((name: string, index: number) => {
            return {
                field: name,
                headerName: name,
                // type: table?.types[index],
                headerClass: highlightedFields.includes(name) ? "highlighted-column-header" : "",
                cellStyle: function(params: any) {
                    if (highlightedFields.includes(params.colDef.field)) {
                        return { backgroundColor: "rgba(88,24,69,0.05)" };
                    } else {
                        return null;
                    }
                }
            };
        }) : [];

    // set background colour on every row, this is probably bad, should be using CSS classes
    const getRowStyle = (params: any) => {
        if (params.node.rowIndex % 2 === 0) {
            return { background: '#F0F0F0' };
        }
    };

    const onGridReady = (params: any) => {
        $gridApi = params.api;
        params.api.sizeColumnsToFit();
        window.addEventListener('resize', function () {
            setTimeout(function () {
                params.api.sizeColumnsToFit();
            })
        })
    };

    return (
        <>
            <Box sx={{display: "flex"}}>
                <Button size="small" variant='text' sx={{"textTransform": "none", marginRight: "auto"}} 
                        onClick={(event: React.MouseEvent<HTMLElement>) => {
                            // will I ever visit this again?
                        }}>
                    <SubdirectoryArrowRightIcon fontSize="inherit" sx={{marginRight: "4px"}}/>continue analysis from this table
                </Button>
            </Box>
            <Box className="table-container table-container-small ag-theme-material" sx={{fontSize: "10px", height: height}}>
                <AgGridReact
                    getRowStyle={getRowStyle}
                    // pagination={true}
                    // paginationAutoPageSize={true}
                    onGridReady={onGridReady}
                    defaultColDef={DEFAULT_COL_DEF}
                    rowData={rowData}
                    components={{ agColumnHeader: SimpleDataHeaderFC }}
                    columnDefs={columns}
                />
            </Box>
        </>
    );
}

