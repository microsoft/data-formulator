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

    // we only change extTable when conceptShelfItems and extTable changes
    let extTables = useMemo(()=>{
        return tables.map(table => {
            // try to let table figure out all fields are derivable from the table
            let rows = baseTableToExtTable(table.rows, derivedFields, conceptShelfItems);
            let extTable = createTableFromFromObjectArray(`${table.id}`, rows, table.derive);
            return extTable
        })
    }, [tables, conceptShelfItems])

    useEffect(() => {
        if(focusedTableId == undefined && tables.length > 0) {
            dispatch(dfActions.setFocusedTable(tables[0].id))
        }
    }, [tables])

    // let focusedExtTable = useMemo(() => {
    //     if (focusedTable == undefined) 
    //         return focusedTable;

    //     let toDeriveFields = derivedFields
    //                             .filter(f => !Object.keys((focusedTable as DictTable).rows[0]).includes(f.name))
    //                             .filter(f => findBaseFields(f, conceptShelfItems).every(f2 => Object.keys((focusedTable as DictTable).rows[0]).includes(f2.name)))
    //                             .filter(f => f.name != "")
    //     if (toDeriveFields.length == 0) {
    //         return focusedTable;
    //     }
    //     let rows = baseTableToExtTable(JSON.parse(JSON.stringify(focusedTable.rows)), toDeriveFields, conceptShelfItems);
    //     return createTableFromFromObjectArray(`${focusedTable.title}`, rows);
    // }, [conceptShelfItems])
    //console.log(focusedExtTable)

    // given a table render the table
    let renderTableBody = (targetTable: DictTable | undefined) => {
        const rowData = targetTable ? targetTable.rows.map((r: any, i: number) => ({ ...r, "#rowId": i })) : [];
        let colDefs = targetTable ? targetTable.names.map((name, i) => { return {
                id: name, label: name, minWidth: 60, width: 100, align: undefined, 
                format: (value: any) => <Typography fontSize="inherit">{`${value}`}</Typography>, 
                dataType: targetTable?.types[i] as Type,
                source: conceptShelfItems.find(f => f.name == name)?.source || "original", 
            }}) : [];

        if (colDefs) {
            colDefs = [{
                id: "#rowId", label: "#", minWidth: 10, align: undefined, width: 40,
                format: (value: any) => <Typography fontSize="inherit" color="rgba(0,0,0,0.65)">{value}</Typography>, 
                dataType: Type.Number,
                source: "original", 
            }, ...colDefs]
        }

        // return <SelectableTable $tableRef={$tableRef} rows={rowData} columnDefs={colDefs} rowsPerPageNum={100} onSelect={onRangeSelectionChanged} />
        return <SelectableDataGrid $tableRef={$tableRef} tableName={targetTable?.id || "table"} rows={rowData} 
                                   columnDefs={colDefs} onSelectionFinished={onRangeSelectionChanged} />
    }

    // handle when selection changes
    const onRangeSelectionChanged = (columns: string[], selected: any[]) => {
        // no need to sort it
        let values = _.uniq(selected);
        // dispatch(dfActions.setStagedValues({columns, values}));
        // dispatch(dfActions.setStagedValues(_.uniq(valueArray).sort()));
    };

    let tableToRender = extTables; //focusedTable && !focusedTable.names.every(name => !conceptShelfItems.find(f => f.name == name && f.source == "custom")) ? [baseExtTable, focusedTable] : [baseExtTable];
    
    let coreTables = tableToRender.filter(t => t.derive == undefined);
    let tempTables = tableToRender.filter(t => t.derive);

    let genTableLink =  (t: DictTable) => 
        <Link underline="hover" key={t.id} sx={{cursor: "pointer"}} 
            color="#1770c7" onClick={()=>{ dispatch(dfActions.setFocusedTable(t.id)) }}>
            <Typography sx={{fontWeight: t.id == focusedTableId? "bold" : "inherit", fontSize: 'inherit'}} component='span'>{t.id}</Typography>
        </Link>;

    return (
        <Box sx={{height: "100%", display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.02)"}}>
            {/* <Box sx={{fontSize: "12px", margin: "4px 12px", display: 'flex'}}>
                {coreTables.map((t, i) => [i > 0 ? <Divider orientation="vertical" sx={{margin: '0px 4px'}}/> : "", genTableLink(t)])}
            </Box> */}
            <Box sx={{display: 'flex'}}>
                <Breadcrumbs sx={{fontSize: "12px", margin: "4px 12px"}} separator="·" aria-label="breadcrumb">
                    {coreTables.map(t => genTableLink(t))}
                </Breadcrumbs>
                {/* <Divider variant="inset" orientation="vertical" sx={{margin: '0px 4px'}} /> */}
                <Typography sx={{display: 'flex', color: 'darkgray'}} component='span'><ParkIcon sx={{ fontSize: 14, margin: 'auto'}}/></Typography>
                <Breadcrumbs sx={{fontSize: "12px", margin: "4px 12px"}} separator="·" aria-label="breadcrumb">
                    {tempTables.map(t => genTableLink(t))}
                </Breadcrumbs>
            </Box>
            {renderTableBody(tableToRender.find(t => t.id == focusedTableId))}
        </Box>
    );
}