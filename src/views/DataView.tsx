// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo } from 'react';

import _ from 'lodash';

import { Typography, Box, Link, Breadcrumbs } from '@mui/material';

import 'ag-grid-enterprise';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-material.css';
import '../scss/DataView.scss';

import { DictTable } from '../components/ComponentType';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Type } from '../data/types';
import { baseTableToExtTable } from '../app/utils';
import { createTableFromFromObjectArray } from '../data/utils';
import { SelectableGroup } from 'react-selectable-fast';
import { SelectableDataGrid } from './SelectableDataGrid';

import ParkIcon from '@mui/icons-material/Park';
import AnchorIcon from '@mui/icons-material/Anchor';

export interface FreeDataViewProps {
    $tableRef: React.RefObject<SelectableGroup>;
    onSelectionChanged?: (values: any[]) => void;
}

export const FreeDataViewFC: FC<FreeDataViewProps> = function DataView({  $tableRef }) {

    const dispatch = useDispatch();
    const tables = useSelector((state: DataFormulatorState) => state.tables);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);

    let derivedFields =  conceptShelfItems.filter(f => f.source == "derived" && f.name != "");

    // we only change extTable when conceptShelfItems and tables changes
    let extTables = useMemo(()=>{
        if (derivedFields.some(f => f.tableRef == focusedTableId)) {
            return tables.map(table => {
                // try to let table figure out all fields are derivable from the table
                let rows = baseTableToExtTable(table.rows, derivedFields, conceptShelfItems);
                let extTable = createTableFromFromObjectArray(`${table.id}`, rows, table.anchored, table.derive);
                return extTable
            })
        } else {
            return tables;
        }
    }, [tables, derivedFields])

    useEffect(() => {
        if(focusedTableId == undefined && tables.length > 0) {
            dispatch(dfActions.setFocusedTable(tables[0].id))
        }
    }, [tables])

    // given a table render the table
    let renderTableBody = (targetTable: DictTable | undefined) => {

        const rowData = targetTable ? 
            targetTable.virtual ? targetTable.rows : targetTable.rows.map((r: any, i: number) => ({ ...r, "#rowId": i })) 
            : [];

        // Randomly sample up to 29 rows for column width calculation
        const sampleSize = Math.min(29, rowData.length);
        const sampledRows = _.sampleSize(rowData, sampleSize);
        
        // Calculate appropriate column widths based on content
        const calculateColumnWidth = (name: string) => {
            if (name === "#rowId") return { minWidth: 10, width: 40 }; // Default for row ID column
            
            // Get all values for this column from sampled rows
            const values = sampledRows.map(row => String(row[name] || ''));
            
            // Estimate width based on content length (simple approach)
            const avgLength = values.length > 0 
                ? values.reduce((sum, val) => sum + val.length, 0) / values.length 
                : 0;
                
            // Adjust width based on average content length and column name length
            const nameSegments = name.split(/[\s-]+/); // Split by whitespace or hyphen
            const maxNameSegmentLength = nameSegments.length > 0 
                ? nameSegments.reduce((max, segment) => Math.max(max, segment.length), 0)
                : name.length;
            const contentLength = Math.max(maxNameSegmentLength, avgLength);
            const minWidth = Math.max(60, contentLength * 8 > 200 ? 200 : contentLength * 8) + 50; // 8px per character with 50px padding
            const width = minWidth;
            
            return { minWidth, width };
        };

        let colDefs = targetTable ? targetTable.names.map((name, i) => {
            const { minWidth, width } = calculateColumnWidth(name);
            return {
                id: name, 
                label: name, 
                minWidth, 
                width, 
                align: undefined, 
                format: (value: any) => <Typography fontSize="inherit">{`${value}`}</Typography>, 
                dataType: targetTable?.types[i] as Type,
                source: conceptShelfItems.find(f => f.name == name)?.source || "original", 
            };
        }) : [];

        if (colDefs && !targetTable?.virtual) {
            colDefs = [{
                id: "#rowId", label: "#", minWidth: 10, align: undefined, width: 40,
                format: (value: any) => <Typography fontSize="inherit" color="rgba(0,0,0,0.65)">{value}</Typography>, 
                dataType: Type.Number,
                source: "original", 
            }, ...colDefs]
        }

        return <SelectableDataGrid 
                    tableId={targetTable?.id || ""}
                    $tableRef={$tableRef} 
                    tableName={targetTable?.displayId || targetTable?.id || "table"} 
                    rows={rowData} 
                    columnDefs={colDefs}
                    onSelectionFinished={onRangeSelectionChanged} 
                    rowCount={targetTable?.virtual?.rowCount || rowData.length}
                    virtual={targetTable?.virtual ? true : false}
                />
    }

    // handle when selection changes
    const onRangeSelectionChanged = (columns: string[], selected: any[]) => {
        let values = _.uniq(selected);
    };

    let tableToRender = extTables; 

    let coreTables = tableToRender.filter(t => t.derive == undefined || t.anchored);
    let tempTables = tableToRender.filter(t => t.derive && !t.anchored);

    let genTableLink =  (t: DictTable) => 
        <Link underline="hover" key={t.id} sx={{cursor: "pointer"}} 
            color="#1770c7" onClick={()=>{ dispatch(dfActions.setFocusedTable(t.id)) }}>
            <Typography sx={{fontWeight: t.id == focusedTableId? "bold" : "inherit", fontSize: 'inherit'}} component='span'>{t.displayId || t.id}</Typography>
        </Link>;

    return (
        <Box sx={{height: "100%", display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.02)"}}>

            <Box sx={{display: 'flex'}}>
                <Typography sx={{display: 'flex', color: 'rgba(0,0,0,0.5)', ml: 1}} component='span'><AnchorIcon sx={{ fontSize: 14, margin: 'auto'}}/></Typography>
                <Breadcrumbs sx={{fontSize: "12px", margin: "4px 12px"}} separator="·" aria-label="breadcrumb">
                    {coreTables.map(t => genTableLink(t))}
                </Breadcrumbs>
                {/* <Divider variant="inset" orientation="vertical" sx={{margin: '0px 4px'}} /> */}
                <Typography sx={{display: 'flex', color: 'rgba(0,0,0,0.5)', ml: 1}} component='span'><ParkIcon sx={{ fontSize: 14, margin: 'auto'}}/></Typography>
                <Breadcrumbs sx={{fontSize: "12px", margin: "4px 12px"}} separator="·" aria-label="breadcrumb">
                    {tempTables.map(t => genTableLink(t))}
                </Breadcrumbs>
            </Box>
            {renderTableBody(tableToRender.find(t => t.id == focusedTableId))}
        </Box>
    );
}