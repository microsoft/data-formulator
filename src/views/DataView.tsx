// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo, useCallback } from 'react';

import _ from 'lodash';

import { Typography, Box, Link, Breadcrumbs, useTheme, Fade } from '@mui/material';
import { alpha } from '@mui/material/styles';

import '../scss/DataView.scss';

import { DictTable } from '../components/ComponentType';
import { DataFormulatorState, dfActions, dfSelectors, FocusedId } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Type } from '../data/types';
import { SelectableDataGrid } from './SelectableDataGrid';
import { formatCellValue, getColumnAlign } from './ViewUtils';

export interface FreeDataViewProps {
}

export const FreeDataViewFC: FC<FreeDataViewProps> = function DataView() {

    const dispatch = useDispatch();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const allCharts = useSelector(dfSelectors.getAllCharts);

    // Derive the table to display based on focusedId
    const focusedTableId = useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        const chartId = focusedId.chartId;
        const chart = allCharts.find(c => c.id === chartId);
        return chart?.tableRef;
    }, [focusedId, allCharts]);

    // Only subscribe to the focused table and table count — NOT the full tables array.
    // This prevents re-rendering the entire data grid when the agent adds unrelated tables.
    const targetTable = useSelector(
        (state: DataFormulatorState) => state.tables.find(t => t.id === focusedTableId),
    );
    const tableCount = useSelector((state: DataFormulatorState) => state.tables.length);
    const firstTableId = useSelector((state: DataFormulatorState) => state.tables[0]?.id);

    useEffect(() => {
        if (focusedId == undefined && tableCount > 0 && firstTableId) {
            dispatch(dfActions.setFocused({ type: 'table', tableId: firstTableId }));
        }
    }, [tableCount, firstTableId]);

    // Memoize row data — only recompute when the table object itself changes
    const rowData = useMemo(() => {
        if (!targetTable) return [];
        return targetTable.rows.map((r: any, i: number) => ({ ...r, "#rowId": i + 1 }));
    }, [targetTable]);

    // Memoize column definitions
    const colDefs = useMemo(() => {
        if (!targetTable) return [];

        const sampleSize = Math.min(29, rowData.length);
        const step = rowData.length > sampleSize ? rowData.length / sampleSize : 1;
        const sampledRows = Array.from({ length: sampleSize }, (_, i) => rowData[Math.floor(i * step)]);

        const calculateColumnWidth = (name: string) => {
            if (name === "#rowId") return { minWidth: 56, width: 56 };
            const values = sampledRows.map(row => String(row[name] || ''));
            const avgLength = values.length > 0
                ? values.reduce((sum, val) => sum + val.length, 0) / values.length
                : 0;
            const nameSegments = name.split(/[\s-]+/);
            const maxNameSegmentLength = nameSegments.length > 0
                ? nameSegments.reduce((max, segment) => Math.max(max, segment.length), 0)
                : name.length;
            const contentLength = Math.max(maxNameSegmentLength, avgLength);
            const minWidth = Math.max(60, contentLength * 8 > 240 ? 240 : contentLength * 8) + 50;
            return { minWidth, width: minWidth };
        };

        const cols = targetTable.names.map((name) => {
            const { minWidth, width } = calculateColumnWidth(name);
            const dataType = targetTable.metadata[name].type as Type;
            const semanticType = targetTable.metadata[name].semanticType;
            return {
                id: name,
                label: targetTable.metadata[name]?.displayName || name,
                description: targetTable.metadata[name]?.description,
                minWidth,
                width,
                align: getColumnAlign(dataType),
                format: (value: any) => <Typography fontSize="inherit">{formatCellValue(value, dataType, semanticType)}</Typography>,
                dataType,
                source: conceptShelfItems.find(f => f.name == name)?.source || "original",
            };
        });

        return [
            {
                id: "#rowId", label: "#", minWidth: 56, align: undefined as any, width: 56,
                format: (value: any) => <Typography fontSize="inherit" color="rgba(0,0,0,0.65)">{value}</Typography>,
                dataType: Type.Number,
                source: "original" as const,
            },
            ...cols,
        ];
    }, [targetTable, rowData, conceptShelfItems]);

    return (
        <Box sx={{height: "100%", display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.02)"}}>
            <Fade in={true} timeout={600} key={targetTable?.id}>
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
        </Box>
    );
}