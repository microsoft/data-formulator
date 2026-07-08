// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';

import _ from 'lodash';

import { Typography, Box, Link, Breadcrumbs, useTheme, Fade, IconButton, Tooltip, TextField, InputAdornment, Chip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';

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
    // Explicit table to render. When omitted the view derives the table from
    // `focusedId` (single-focus behavior). Set by the multi-table canvas to
    // render each highlighted table in a stack.
    tableId?: string;
    // Render the Numbers-style title/metadata + search header inside the grid.
    // Used by the focused-table canvas.
    showHeaderBar?: boolean;
    // Hide the in-grid footer widget; the focused-table canvas surfaces those
    // actions (row count / random / download) in its bottom toolbar instead.
    hideFooter?: boolean;
    // Controlled random-rows trigger + virtual-state report, forwarded to the
    // grid so the external toolbar can drive/observe them.
    randomizeToken?: number;
    onStateReport?: (s: { loadedCount: number; rowCount: number; virtual: boolean; canRandomize: boolean }) => void;
}

export const FreeDataViewFC: FC<FreeDataViewProps> = function DataView({ maximizable, tableId, showHeaderBar, hideFooter, randomizeToken, onStateReport }) {

    const { t } = useTranslation();
    const [maximized, setMaximized] = React.useState(false);
    // Draft holds the live input; query is the committed term the grid/server
    // actually searches. Search runs only when the user submits (Enter or the
    // search icon), never on every keystroke.
    const [searchDraft, setSearchDraft] = React.useState('');
    const [searchQuery, setSearchQuery] = React.useState('');
    const submitSearch = React.useCallback(() => setSearchQuery(searchDraft.trim()), [searchDraft]);
    const clearSearch = React.useCallback(() => { setSearchDraft(''); setSearchQuery(''); }, []);

    const dispatch = useDispatch();

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const allCharts = useSelector(dfSelectors.getAllCharts);

    // Derive the table to display based on focusedId
    const focusedTableId = useMemo(() => {
        if (tableId) return tableId;
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type !== 'chart') return undefined;
        const chartId = focusedId.chartId;
        const chart = allCharts.find(c => c.id === chartId);
        return chart?.tableRef;
    }, [focusedId, allCharts, tableId]);

    // The search term is temporary/per-table: clear it when switching tables.
    React.useEffect(() => {
        setSearchDraft('');
        setSearchQuery('');
    }, [focusedTableId]);

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
                        searchText={searchQuery}
                        hideFooter={hideFooter}
                        randomizeToken={randomizeToken}
                        onStateReport={onStateReport}
                    />
                </Box>
            </Fade>
        </Box>
    );

    // Numbers-style header rendered OUTSIDE the table card: table title +
    // row/column metadata on the left, a quick search box on the right.
    // Sort & filter remain in the column headers/kebab menus.
    const headerRowCount = targetTable?.virtual?.rowCount || targetTable?.rows.length || 0;
    const headerColCount = targetTable?.names.length || 0;
    const headerBar = showHeaderBar ? (
        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1.5, px: 0.5, pt: 1, pb: 1 }}>
            <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                        {targetTable?.displayId || targetTable?.id || 'table'}
                    </Typography>
                    {searchQuery ? (
                        <Chip
                            size="small"
                            icon={<SearchIcon sx={{ fontSize: 14 }} />}
                            label={`"${searchQuery}"`}
                            onDelete={clearSearch}
                            deleteIcon={<ClearIcon sx={{ fontSize: 14 }} />}
                            sx={{
                                height: 22, maxWidth: 220, flexShrink: 0,
                                borderRadius: '6px',
                                backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.08),
                                color: 'primary.main',
                                '& .MuiChip-label': { fontSize: 11.5, px: 0.75, overflow: 'hidden', textOverflow: 'ellipsis' },
                                '& .MuiChip-icon': { color: 'primary.main', ml: 0.5 },
                                '& .MuiChip-deleteIcon': { color: 'primary.main', '&:hover': { color: 'primary.dark' } },
                            }}
                        />
                    ) : null}
                </Box>
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.25 }}>
                    {t('dataGrid.rowCount', { count: headerRowCount })} · {headerColCount} {headerColCount === 1 ? 'column' : 'columns'}
                </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <TextField
                size="small"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                autoComplete="off"
                inputProps={{ autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitSearch(); }
                    else if (e.key === 'Escape' && searchDraft) { e.preventDefault(); clearSearch(); }
                }}
                placeholder={t('dataGrid.searchPlaceholder', { defaultValue: 'Search table…' })}
                InputProps={{
                    startAdornment: (
                        <InputAdornment position="start">
                            <Tooltip title={t('dataGrid.search', { defaultValue: 'Search' })}>
                                <IconButton size="small" onClick={submitSearch} sx={{ p: 0.25 }}>
                                    <SearchIcon sx={{ fontSize: 16, color: searchDraft ? 'primary.main' : 'text.disabled' }} />
                                </IconButton>
                            </Tooltip>
                        </InputAdornment>
                    ),
                    endAdornment: (searchDraft || searchQuery) ? (
                        <InputAdornment position="end">
                            <IconButton size="small" onClick={clearSearch} sx={{ p: 0.25 }}>
                                <ClearIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                        </InputAdornment>
                    ) : undefined,
                }}
                sx={{
                    width: 220,
                    '& .MuiOutlinedInput-root': { borderRadius: '8px', fontSize: 12, backgroundColor: 'background.paper' },
                    '& .MuiOutlinedInput-input': { py: '6px' },
                }}
            />
        </Box>
    ) : null;

    // Wrap any table content with the header above it (when enabled), so the
    // title sits outside the card frame.
    const withHeader = (content: React.ReactNode) => showHeaderBar ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            {headerBar}
            <Box sx={{ flex: 1, minHeight: 0 }}>{content}</Box>
        </Box>
    ) : content;

    // Focused-table canvas: the table already fills the page, so there's no
    // maximize button — just a flat bordered card with the title above it.
    if (showHeaderBar) {
        return withHeader(
            <Box sx={{
                height: '100%', width: '100%', overflow: 'hidden',
                borderRadius: '8px', border: `1px solid ${borderColor.divider}`,
            }}>
                {grid}
            </Box>
        );
    }

    if (!maximizable) {
        return withHeader(grid);
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
    // When the header bar is shown (focused-table canvas) the card stays flat —
    // no hover glow/elevation — since the title lives outside the card.
    const cardSx = maximized ? { overflow: 'hidden' } : {
        overflow: 'hidden',
        borderRadius: '8px',
        border: `1px solid ${borderColor.divider}`,
        ...(showHeaderBar ? {} : {
            transition: 'box-shadow 0.2s ease',
            '&:hover': { boxShadow: '0 0 8px rgba(25, 118, 210, 0.25)' },
        }),
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

    return withHeader(framed);
}