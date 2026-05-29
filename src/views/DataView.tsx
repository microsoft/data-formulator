// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';

import _ from 'lodash';

import { Typography, Box, Link, Breadcrumbs, useTheme, Fade, IconButton, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';

import '../scss/DataView.scss';

import { DictTable } from '../components/ComponentType';
import { DataFormulatorState, dfActions, dfSelectors, FocusedId } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
import { Type } from '../data/types';
import { SelectableDataGrid } from './SelectableDataGrid';
import { formatCellValue, getColumnAlign } from './ViewUtils';
import { borderColor } from '../app/tokens';

export interface FreeDataViewProps {
    // When true, render a maximize/restore toggle that pops the table into a
    // full-canvas overlay. Used wherever the grid is shown inline (under a
    // chart, or as the focused-table preview).
    maximizable?: boolean;
}

export const FreeDataViewFC: FC<FreeDataViewProps> = function DataView({ maximizable }) {

    const { t } = useTranslation();
    const [maximized, setMaximized] = React.useState(false);

    const dispatch = useDispatch();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const allCharts = useSelector(dfSelectors.getAllCharts);

    // Derive the table to display based on focusedId
    const focusedTableId = useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type !== 'chart') return undefined;
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

    const grid = (
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

    if (!maximizable) {
        return grid;
    }

    const toggleButton = (
        <Tooltip title={maximized ? t('chart.restoreTable', { defaultValue: 'Restore' }) : t('chart.maximizeTable', { defaultValue: 'Maximize table' })} placement="left">
            <IconButton
                size="small"
                onClick={() => setMaximized(m => !m)}
                sx={{
                    color: 'text.secondary',
                    '&:hover': { color: 'primary.main', backgroundColor: 'transparent' },
                }}
            >
                {maximized ? <CloseFullscreenIcon sx={{ fontSize: 16 }} /> : <OpenInFullIcon sx={{ fontSize: 16 }} />}
            </IconButton>
        </Tooltip>
    );

    // The toggle button sits just outside the table to the right (a slim panel),
    // so it never overlaps the column headers and the card keeps its original look.
    // In maximized mode the surrounding overlay already provides the card frame.
    const cardSx = maximized ? { overflow: 'hidden' } : {
        overflow: 'hidden',
        borderRadius: '8px',
        border: `1px solid ${borderColor.divider}`,
        transition: 'box-shadow 0.2s ease',
        '&:hover': { boxShadow: '0 0 8px rgba(25, 118, 210, 0.25)' },
    };
    const framed = (
        <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'row' }}>
            <Box sx={{ flex: 1, minWidth: 0, ...cardSx }}>
                {grid}
            </Box>
            <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', pt: 0.25, pl: 0.25 }}>
                {toggleButton}
            </Box>
        </Box>
    );

    if (maximized) {
        const canvas = typeof document !== 'undefined' ? document.getElementById('vis-view-canvas') : null;
        const overlay = (
            <>
                {/* Transparent click-catcher — click outside to restore. Scoped to the visualization view. */}
                <Box
                    onClick={() => setMaximized(false)}
                    sx={{ position: 'absolute', inset: 0, zIndex: 1299 }}
                />
                {/* Table overlay filling the visualization view. */}
                <Box sx={{
                    position: 'absolute', inset: 12, zIndex: 1300,
                    borderRadius: '8px', overflow: 'hidden',
                    border: `1px solid ${borderColor.divider}`,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                    backgroundColor: 'background.paper',
                    p: 0.5,
                }}>
                    {framed}
                </Box>
            </>
        );
        return (
            <>
                {/* Keep the inline slot occupied so surrounding layout doesn't jump. */}
                <Box sx={{ height: '100%', width: '100%' }} />
                {canvas ? ReactDOM.createPortal(overlay, canvas) : overlay}
            </>
        );
    }

    return framed;
}