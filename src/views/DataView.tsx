// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo } from 'react';

import _ from 'lodash';

import { Typography, Box, Link, Breadcrumbs, useTheme, Fade } from '@mui/material';
import { alpha } from '@mui/material/styles';

import '../scss/DataView.scss';

import { DictTable } from '../components/ComponentType';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Type } from '../data/types';
import { createTableFromFromObjectArray } from '../data/utils';
import { SelectableDataGrid } from './SelectableDataGrid';

import ParkIcon from '@mui/icons-material/Park';
import { AnchorIcon } from '../icons';

export interface FreeDataViewProps {
}

export const FreeDataViewFC: FC<FreeDataViewProps> = function DataView() {

    const dispatch = useDispatch();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const theme = useTheme();
    
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    const focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);
    const allCharts = useSelector(dfSelectors.getAllCharts);

    useEffect(() => {
        if(focusedTableId == undefined && tables.length > 0) {
            dispatch(dfActions.setFocusedTable(tables[0].id))
        }
    }, [tables])

    // given a table render the table
    let renderTableBody = (targetTable: DictTable | undefined) => {

        let rowData = [];
        if (targetTable) {
            if (targetTable.virtual) {
                rowData = targetTable.rows;
            } else {
                rowData = targetTable.rows;
                rowData = rowData.map((r: any, i: number) => ({ ...r, "#rowId": i }));
            }
        }

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
            const minWidth = Math.max(60, contentLength * 8 > 240 ? 240 : contentLength * 8) + 50; // 8px per character with 50px padding
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
                dataType: targetTable?.metadata[name].type as Type,
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

        return  <Fade in={true} timeout={600} key={targetTable?.id}>
            <Box sx={{height: 'calc(100% - 28px)'}}>
                <SelectableDataGrid
                    tableId={targetTable?.id || ""}
                    tableName={targetTable?.displayId || targetTable?.id || "table"} 
                    rows={rowData} 
                    columnDefs={colDefs}
                    rowCount={targetTable?.virtual?.rowCount || targetTable?.rows.length || 0}
                    virtual={targetTable?.virtual ? true : false}
                />
            </Box>
        </Fade>
    }


    // Get all predecessors of the focused table (including the focused table itself)
    const getPredecessors = (tableId: string | undefined): DictTable[] => {
        if (!tableId) return [];
        const table = tables.find(t => t.id === tableId);
        if (!table) return [];
        
        const predecessors: DictTable[] = [];
        const visited = new Set<string>();
        
        const traverse = (id: string) => {
            if (visited.has(id)) return;
            visited.add(id);
            
            const t = tables.find(tbl => tbl.id === id);
            if (!t) return;
            
            // First traverse sources (to get them in order)
            if (t.derive?.source) {
                t.derive.source.forEach(sourceId => traverse(sourceId));
            }
            
            predecessors.push(t);
        };
        
        traverse(tableId);
        return predecessors;
    };

    // Get the table ID from the focused chart
    const focusedChart = allCharts.find(c => c.id === focusedChartId);
    const chartTableId = focusedChart?.tableRef || focusedTableId;
    
    const predecessorTables = getPredecessors(chartTableId);

    let genTableLink =  (t: DictTable) => 
        <Link underline="hover" key={t.id} sx={{cursor: "pointer"}} 
            color={theme.palette.primary.textColor || theme.palette.primary.main} onClick={()=>{ dispatch(dfActions.setFocusedTable(t.id)) }}>
            <Typography sx={{fontWeight: t.id === focusedTableId ? "bold" : "inherit", fontSize: 'inherit'}} component='span'>{t.displayId || t.id}</Typography>
        </Link>;

    return (
        <Box sx={{height: "100%", display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.02)"}}>

            <Box sx={{display: 'flex', alignItems: 'center'}}>
                <Breadcrumbs sx={{fontSize: "12px", margin: "4px 12px"}} separator="›" aria-label="breadcrumb">
                    {predecessorTables.map(t => genTableLink(t))}
                </Breadcrumbs>
            </Box>
            {renderTableBody(tables.find(t => t.id == focusedTableId))}
        </Box>
    );
}