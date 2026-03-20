// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo } from 'react';

import _ from 'lodash';

import { Typography, Box, Link, Breadcrumbs, useTheme, Fade } from '@mui/material';
import { alpha } from '@mui/material/styles';

import '../scss/DataView.scss';

import { DictTable } from '../components/ComponentType';
import { DataFormulatorState, dfActions, dfSelectors, FocusedId } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Type } from '../data/types';
import { SelectableDataGrid } from './SelectableDataGrid';

export interface FreeDataViewProps {
}

export const FreeDataViewFC: FC<FreeDataViewProps> = function DataView() {

    const dispatch = useDispatch();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const allCharts = useSelector(dfSelectors.getAllCharts);

    // Derive the table to display based on focusedId
    const focusedTableId = React.useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        // Chart focused: show the chart's backing table
        const chartId = focusedId.chartId;
        const chart = allCharts.find(c => c.id === chartId);
        return chart?.tableRef;
    }, [focusedId, allCharts]);

    useEffect(() => {
        if(focusedId == undefined && tables.length > 0) {
            dispatch(dfActions.setFocused({ type: 'table', tableId: tables[0].id }))
        }
    }, [tables])

    // given a table render the table
    let renderTableBody = (targetTable: DictTable | undefined) => {

        let rowData = [];
        if (targetTable) {
            rowData = targetTable.rows.map((r: any, i: number) => ({ ...r, "#rowId": i + 1 }));
        }

        // Deterministic sample: take evenly spaced rows so column widths stay stable across re-renders
        const sampleSize = Math.min(29, rowData.length);
        const step = rowData.length > sampleSize ? rowData.length / sampleSize : 1;
        const sampledRows = Array.from({ length: sampleSize }, (_, i) => rowData[Math.floor(i * step)]);
        
        // Calculate appropriate column widths based on content
        const calculateColumnWidth = (name: string) => {
            if (name === "#rowId") return { minWidth: 56, width: 56 };
            
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

        if (colDefs) {
            colDefs = [{
                id: "#rowId", label: "#", minWidth: 56, align: undefined, width: 56,
                format: (value: any) => <Typography fontSize="inherit" color="rgba(0,0,0,0.65)">{value}</Typography>, 
                dataType: Type.Number,
                source: "original", 
            }, ...colDefs]
        }

        return  <Fade in={true} timeout={600} key={targetTable?.id}>
            <Box sx={{height: '100%'}}>
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

    return (
        <Box sx={{height: "100%", display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.02)"}}>
            {renderTableBody(tables.find(t => t.id == focusedTableId))}
        </Box>
    );
}