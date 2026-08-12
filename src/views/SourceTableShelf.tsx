// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Source table shelf — the pinned list of loaded (non-derived) tables.
//
// The shelf is deliberately NOT part of the thread system: it owns no timeline,
// no thread index, and no artifacts. It is the single home of every source
// table's full card and of the source-table actions (rename / metadata /
// refresh / streaming / delete). Threads reference a source table with a plain
// reference card instead of repeating its actions, so "which column owns this
// table" never has to be arbitrated.

import React, { FC, memo, useEffect, useMemo, useState } from 'react';

import {
    Box,
    Button,
    ClickAwayListener,
    Collapse,
    CircularProgress,
    FormControlLabel,
    IconButton,
    Menu,
    MenuItem,
    Paper,
    Popper,
    Switch,
    TextField,
    Typography,
    SxProps,
    useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';

import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import RefreshIcon from '@mui/icons-material/Refresh';

import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { getUrls } from '../app/utils';
import { apiRequest } from '../app/apiClient';
import { DictTable } from '../components/ComponentType';
import { deleteWorkspace } from '../app/workspaceService';
import { useDataRefresh } from '../app/useDataRefresh';
import { ViewBorderStyle } from '../app/tokens';
import { StreamIcon, TableIcon } from '../icons';
import { buildTableCard } from './DataThreadCards';
import { RefreshDataDialog } from './RefreshDataDialog';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { iconVar, textVar } from '../app/layout';

/** Seconds options for stream/database auto-refresh interval (labels in i18n: dataThread.refreshInterval.*). */
const STREAM_REFRESH_INTERVAL_SECONDS = [1, 10, 30, 60, 300, 600, 1800, 3600, 86400] as const;

/** Tables shown before the shelf collapses behind a "show all" toggle. */
export const SHELF_VISIBLE_LIMIT = 6;

// Mirror DataThread's timeline geometry so shelf cards land on exactly the same
// grid as thread cards instead of running wider than everything below them.
const GUTTER_WIDTH = 14;          // DataThread's TIMELINE_WIDTH
const GUTTER_GAP = '4px';         // DataThread's TIMELINE_GAP
const CARD_INSET_RIGHT = '14px';  // DataThread's CARD_CONTENT_PR
const RAIL_LINE = '2px solid rgba(0,0,0,0.1)';
// Left offset that puts the 2px rail on the gutter's centre line, matching a
// width-0 centred line in DataThread's timeline column.
const RAIL_OFFSET = '6px';
// DataThread pads every timeline row by CARD_PY; the shelf's rows do the same,
// so its cards sit on the same rhythm.  ROW_GAP is the lead-in the rail draws
// above the "add data" row, which is not a card row and has no gutter icon.
const CARD_PY = '6px';
const ROW_GAP = '6px';

// Streaming Settings Popup Component
const StreamingSettingsPopup = memo<{
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    table: DictTable;
    onUpdateSettings: (autoRefresh: boolean, refreshIntervalSeconds?: number) => void;
    onRefreshNow?: () => void;
}>(({ open, anchorEl, onClose, table, onUpdateSettings, onRefreshNow }) => {
    const [refreshInterval, setRefreshInterval] = useState<number>(
        table.source?.refreshIntervalSeconds || 60
    );
    const [autoRefresh, setAutoRefresh] = useState<boolean>(
        table.source?.autoRefresh || false
    );
    const [selectMenuOpen, setSelectMenuOpen] = useState<boolean>(false);
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
    const { t } = useTranslation();

    useEffect(() => {
        if (open) {
            setRefreshInterval(table.source?.refreshIntervalSeconds || 60);
            setAutoRefresh(table.source?.autoRefresh || false);
        }
    }, [open, table.source]);

    const handleAutoRefreshChange = (enabled: boolean) => {
        setAutoRefresh(enabled);
        onUpdateSettings(enabled, enabled ? refreshInterval : undefined);
        if (!enabled) {
            onClose();
        }
    };

    const handleIntervalChange = (interval: number) => {
        setRefreshInterval(interval);
        if (autoRefresh) {
            onUpdateSettings(true, interval);
        }
    };

    const handleRefreshNow = async () => {
        if (onRefreshNow && !isRefreshing) {
            setIsRefreshing(true);
            try {
                await onRefreshNow();
            } finally {
                setIsRefreshing(false);
            }
        }
    };

    const handleClickAway = (event: MouseEvent | TouchEvent) => {
        // Don't close if the select menu is open
        if (selectMenuOpen) {
            return;
        }
        // Don't close if clicking on the select menu or menu items
        const target = event.target as HTMLElement;
        if (
            target.closest('.MuiMenu-root') ||
            target.closest('.MuiPaper-root')?.classList.contains('MuiMenu-paper') ||
            target.closest('[role="menuitem"]') ||
            target.closest('[role="listbox"]')
        ) {
            return;
        }
        onClose();
    };

    return (
        <Popper
            open={open}
            anchorEl={anchorEl}
            placement="bottom-start"
            style={{ zIndex: 1300 }}
        >
            <ClickAwayListener onClickAway={handleClickAway} mouseEvent="onMouseDown">
                <Paper
                    elevation={8}
                    sx={{
                        fontSize: textVar.sm,
                        p: 1.5,
                        mt: 1,
                        ...ViewBorderStyle,
                    }}
                >
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap' }}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={autoRefresh}
                                        onChange={(e) => handleAutoRefreshChange(e.target.checked)}
                                        size="small"
                                    />
                                }
                                label={
                                    <Typography variant="body2" sx={{ fontSize: textVar.xs }}>
                                        {t('dataThread.watchForUpdates')}
                                    </Typography>
                                }
                                sx={{ mr: 0 }}
                            />
                            {autoRefresh && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 100 }}>
                                    <Typography variant="body2" sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                                        {t('dataThread.every')}
                                    </Typography>
                                    <TextField
                                        select
                                        size="small"
                                        value={refreshInterval}
                                        onChange={(e) => handleIntervalChange(Number(e.target.value))}
                                        slotProps={{
                                            select: {
                                                open: selectMenuOpen,
                                                onOpen: () => setSelectMenuOpen(true),
                                                onClose: () => setSelectMenuOpen(false)
                                            }
                                        }}
                                        sx={{
                                            minWidth: 70,
                                            '& .MuiInputBase-root': { fontSize: textVar.xs, height: 28 },
                                            '& .MuiSelect-select': { py: 0.5 }
                                        }}
                                    >
                                        {STREAM_REFRESH_INTERVAL_SECONDS.map((sec) => (
                                            <MenuItem key={sec} value={sec}>
                                                {t(`dataThread.refreshInterval.${sec}`)}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                </Box>
                            )}
                            {onRefreshNow && (
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={handleRefreshNow}
                                    disabled={isRefreshing}
                                    startIcon={isRefreshing ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: iconVar.sm }} />}
                                    sx={{
                                        fontSize: textVar.xs,
                                        textTransform: 'none',
                                        height: 28,
                                        alignSelf: 'flex-start'
                                    }}
                                >
                                    {t('dataThread.refreshNow')}
                                </Button>
                            )}
                        </Box>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    );
});

// Table Metadata Viewer (read-only)
// Renders the source-supplied table description for connector/upload
// tables, or the agent-produced code explanation for derived tables.
// Per-column metadata is exposed elsewhere as header tooltips on the
// data preview, not here. Strictly read-only and strictly textual.
// See design-docs/23-table-description-unification.md.
const MetadataPopup = memo<{
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    table: DictTable | null;
}>(({ open, anchorEl, onClose, table }) => {
    const { t } = useTranslation();

    const tableName = table?.displayId || table?.id || '';
    const description = (table?.description || '').trim();
    const codeExplanation = (table?.derive?.explanation?.code || '').trim();

    return (
        <Popper
            open={open}
            anchorEl={anchorEl}
            placement="bottom-start"
            style={{ zIndex: 1300 }}
        >
            <ClickAwayListener onClickAway={onClose}>
                <Paper
                    elevation={8}
                    sx={{
                        width: 480,
                        maxHeight: '70vh',
                        overflow: 'auto',
                        fontSize: textVar.sm,
                        p: 2,
                        mt: 1,
                        ...ViewBorderStyle,
                    }}
                >
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        {t('dataThread.metadataFor', { table: tableName, defaultValue: `Metadata for ${tableName}` })}
                    </Typography>

                    {description && (
                        <Typography sx={{ fontSize: textVar.xs, color: 'text.primary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {description}
                        </Typography>
                    )}

                    {!description && codeExplanation && (
                        <Box>
                            <Typography sx={{ fontSize: textVar.xs, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                {t('dataThread.derivationSummary', { defaultValue: 'Derivation summary' })}
                            </Typography>
                            <Typography sx={{ fontSize: textVar.xs, color: 'text.primary', whiteSpace: 'pre-wrap' }}>
                                {codeExplanation}
                            </Typography>
                        </Box>
                    )}

                    {!description && !codeExplanation && (
                        <Typography sx={{ fontSize: textVar.xs, color: 'text.disabled', fontStyle: 'italic' }}>
                            {t('dataThread.noMetadata', { defaultValue: 'No description available for this table.' })}
                        </Typography>
                    )}

                    <Box sx={{ mt: 1.5, display: 'flex' }}>
                        <Button size="small" sx={{ ml: 'auto' }} onClick={onClose} color="primary">{t('app.close', { defaultValue: 'Close' })}</Button>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    );
});

// Rename table popup - opens as a small popper with a text field
const RenameTablePopup = memo<{
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    onSave: (newName: string) => void;
    initialValue: string;
    tableName: string;
}>(({ open, anchorEl, onClose, onSave, initialValue, tableName }) => {
    const [name, setName] = useState(initialValue);
    const { t } = useTranslation();

    useEffect(() => {
        setName(initialValue);
    }, [initialValue, open]);

    const handleSave = () => {
        if (name.trim() !== '') {
            onSave(name.trim());
            onClose();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    return (
        <Popper
            open={open}
            anchorEl={anchorEl}
            placement="bottom-start"
            style={{ zIndex: 1300 }}
        >
            <ClickAwayListener onClickAway={onClose}>
                <Paper
                    elevation={8}
                    sx={{ width: 240, fontSize: textVar.sm, p: 1.5, mt: 1, ...ViewBorderStyle }}
                >
                    <Typography variant="subtitle2" sx={{ mb: 0.5, fontSize: textVar.sm }}>
                        {t('dataThread.renameTable')}
                    </Typography>
                    <TextField
                        autoFocus
                        fullWidth
                        variant="outlined"
                        size="small"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        sx={{ my: 0.5, '& .MuiInputBase-input': { fontSize: textVar.sm } }}
                    />
                    <Box sx={{ mt: 0.5, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                        <Button size="small" onClick={onClose}>{t('app.cancel')}</Button>
                        <Button size="small" onClick={handleSave} color="primary" disabled={name.trim() === '' || name.trim() === initialValue}>{t('app.save')}</Button>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    );
});

export const SourceTableShelf: FC<{
    /** Source (non-derived) tables, in display order. */
    sourceTables: DictTable[];
    /** Tables highlighted by the current focus (computed once in DataThread). */
    highlightedTableIds: string[];
    focusedTableId?: string;
    sx?: SxProps;
}> = function ({ sourceTables, highlightedTableIds, focusedTableId, sx }) {

    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const { manualRefresh } = useDataRefresh();

    const tables = useSelector(dfSelectors.getAllTables);
    const inferredTableNames = useSelector((state: DataFormulatorState) => state.tableSemantics);
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);

    const [sectionExpanded, setSectionExpanded] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const [addDataDialogOpen, setAddDataDialogOpen] = useState(false);

    // Metadata popup state
    const [metadataPopupOpen, setMetadataPopupOpen] = useState(false);
    const [selectedTableForMetadata, setSelectedTableForMetadata] = useState<DictTable | null>(null);
    const [metadataAnchorEl, setMetadataAnchorEl] = useState<HTMLElement | null>(null);

    // Table menu state
    const [tableMenuAnchorEl, setTableMenuAnchorEl] = useState<HTMLElement | null>(null);
    const [selectedTableForMenu, setSelectedTableForMenu] = useState<DictTable | null>(null);

    // Refresh data dialog state
    const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
    const [selectedTableForRefresh, setSelectedTableForRefresh] = useState<DictTable | null>(null);
    const [, setIsRefreshing] = useState(false);

    // Streaming settings popup state
    const [streamingSettingsPopupOpen, setStreamingSettingsPopupOpen] = useState(false);
    const [selectedTableForStreamingSettings, setSelectedTableForStreamingSettings] = useState<DictTable | null>(null);
    const [streamingSettingsAnchorEl, setStreamingSettingsAnchorEl] = useState<HTMLElement | null>(null);

    // Rename popup state
    const [renamePopupOpen, setRenamePopupOpen] = useState(false);
    const [selectedTableForRename, setSelectedTableForRename] = useState<DictTable | null>(null);
    const [renameAnchorEl, setRenameAnchorEl] = useState<HTMLElement | null>(null);

    const handleOpenRenamePopup = (table: DictTable, anchorEl: HTMLElement) => {
        setSelectedTableForRename(table);
        setRenameAnchorEl(anchorEl);
        setRenamePopupOpen(true);
    };

    const handleCloseRenamePopup = () => {
        setRenamePopupOpen(false);
        setSelectedTableForRename(null);
        setRenameAnchorEl(null);
    };

    const handleSaveRename = (newName: string) => {
        if (selectedTableForRename) {
            dispatch(dfActions.updateTableDisplayId({
                tableId: selectedTableForRename.id,
                displayId: newName,
            }));
        }
    };

    const handleOpenMetadataPopup = (table: DictTable, anchorEl: HTMLElement) => {
        setSelectedTableForMetadata(table);
        setMetadataAnchorEl(anchorEl);
        setMetadataPopupOpen(true);
    };

    const handleCloseMetadataPopup = () => {
        setMetadataPopupOpen(false);
        setSelectedTableForMetadata(null);
        setMetadataAnchorEl(null);
    };

    const handleOpenTableMenu = (table: DictTable, anchorEl: HTMLElement) => {
        setSelectedTableForMenu(table);
        setTableMenuAnchorEl(anchorEl);
    };

    const handleCloseTableMenu = () => {
        setTableMenuAnchorEl(null);
        setSelectedTableForMenu(null);
    };

    const handleOpenRefreshDialog = (table: DictTable) => {
        setSelectedTableForRefresh(table);
        setRefreshDialogOpen(true);
        handleCloseTableMenu();
    };

    const handleCloseRefreshDialog = () => {
        setRefreshDialogOpen(false);
        setSelectedTableForRefresh(null);
    };

    const handleOpenStreamingSettingsPopup = (table: DictTable, anchorEl: HTMLElement) => {
        setSelectedTableForStreamingSettings(table);
        setStreamingSettingsAnchorEl(anchorEl);
        setStreamingSettingsPopupOpen(true);
    };

    const handleCloseStreamingSettingsPopup = () => {
        setStreamingSettingsPopupOpen(false);
        setSelectedTableForStreamingSettings(null);
        setStreamingSettingsAnchorEl(null);
    };

    const handleUpdateStreamingSettings = (autoRefresh: boolean, refreshIntervalSeconds?: number) => {
        if (selectedTableForStreamingSettings) {
            dispatch(dfActions.updateTableSourceRefreshSettings({
                tableId: selectedTableForStreamingSettings.id,
                autoRefresh,
                refreshIntervalSeconds
            }));
        }
    };

    // Re-run every table derived from `sourceTableId` against the new rows.
    // Collects all results first, then dispatches a single batch update.
    const refreshDerivedTables = async (sourceTableId: string, newRows: any[]) => {
        const derivedTables = tables.filter(t => t.derive?.source?.includes(sourceTableId));
        if (derivedTables.length === 0) return;

        const refreshPromises = derivedTables
            .filter(dt => dt.derive && dt.derive.code && dt.derive.codeSignature)
            .map(async (derivedTable) => {
                const parentTableData = derivedTable.derive!.source.map(sourceId => {
                    const sourceTable = tables.find(t => t.id === sourceId);
                    if (sourceTable) {
                        const rows = sourceId === sourceTableId ? newRows : sourceTable.rows;
                        const tableName = sourceTable.virtual?.tableId || sourceTable.id.replace(/\.[^/.]+$/, "");
                        return { name: tableName, rows };
                    }
                    return null;
                }).filter(t => t !== null);

                if (parentTableData.length === 0) return null;

                try {
                    const requestBody: any = {
                        input_tables: parentTableData,
                        code: derivedTable.derive!.code,
                        code_signature: derivedTable.derive!.codeSignature, // HMAC proof
                        output_variable: derivedTable.derive!.outputVariable || 'result_df',
                        virtual: !!derivedTable.virtual?.tableId,
                        output_table_name: derivedTable.virtual?.tableId
                    };

                    const { data: result } = await apiRequest<any>(getUrls().REFRESH_DERIVED_DATA, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });

                    if (result.rows) {
                        return { tableId: derivedTable.id, rows: result.rows } as { tableId: string, rows: any[] };
                    } else {
                        console.error(`Failed to refresh derived table ${derivedTable.id}:`, result.message);
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(),
                            type: 'error',
                            component: t('messages.dataRefresh.component'),
                            value: t('messages.dataRefresh.failedDerivedTable', {
                                table: derivedTable.displayId || derivedTable.id,
                                detail: result.message || t('messages.dataRefresh.unknownError'),
                            }),
                        }));
                        return null;
                    }
                } catch (error) {
                    console.error(`Error refreshing derived table ${derivedTable.id}:`, error);
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'error',
                        component: t('messages.dataRefresh.component'),
                        value: t('messages.dataRefresh.errorRefreshingDerivedTable', {
                            table: derivedTable.displayId || derivedTable.id,
                        }),
                    }));
                    return null;
                }
            });

        const results = await Promise.all(refreshPromises);
        const successfulUpdates = results.filter((r): r is { tableId: string, rows: any[] } => r !== null);

        if (successfulUpdates.length > 0) {
            dispatch(dfActions.updateMultipleTableRows(successfulUpdates));
        }
    };

    const handleRefreshComplete = async (newRows: any[]) => {
        if (!selectedTableForRefresh) return;

        setIsRefreshing(true);
        try {
            dispatch(dfActions.updateTableRows({
                tableId: selectedTableForRefresh.id,
                rows: newRows
            }));

            await refreshDerivedTables(selectedTableForRefresh.id, newRows);

            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: t('messages.dataRefresh.component'),
                value: t('messages.dataRefresh.successRefreshedWithDerived', {
                    table: selectedTableForRefresh.displayId || selectedTableForRefresh.id,
                }),
            }));
        } catch (error) {
            console.error('Error during refresh:', error);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: t('messages.dataRefresh.component'),
                value: t('messages.dataRefresh.errorRefreshingData', { error: String(error) }),
            }));
        } finally {
            setIsRefreshing(false);
        }
    };

    // A long list drowns the threads beside it, so show only the first few by
    // default — the focused table always stays visible, even below the cut.
    const collapsible = sourceTables.length > SHELF_VISIBLE_LIMIT;
    const visibleTables = !collapsible || expanded
        ? sourceTables
        : sourceTables.filter((tbl, index) => index < SHELF_VISIBLE_LIMIT || tbl.id === focusedTableId);

    // One row per table, laid out exactly like a DataThread timeline row: a
    // gutter carrying the table's icon with rail segments above and below it,
    // then the card.  The icons are what keep the rail from reading as one
    // long, heavy stroke.
    const cards = useMemo(() => visibleTables.map((tbl, index) => {
        const isStreaming = (tbl.source?.type === 'stream' || tbl.source?.type === 'database') && tbl.source?.autoRefresh;
        const highlighted = highlightedTableIds.includes(tbl.id);
        const iconColor = highlighted ? theme.palette.primary.main : 'rgba(0,0,0,0.15)';
        return <Box key={`shelf-card-${tbl.id}`} sx={{ display: 'flex', flexDirection: 'row' }}>
            <Box sx={{
                width: GUTTER_WIDTH, flexShrink: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
                {/* The first row's lead-in is drawn by the header connector. */}
                <Box aria-hidden sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: RAIL_LINE }} />
                <Box sx={{ flexShrink: 0, zIndex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isStreaming
                        ? <StreamIcon sx={{
                            width: 14, height: 14,
                            color: highlighted ? theme.palette.success.main : 'rgba(0,0,0,0.15)',
                            animation: 'pulse 2s infinite',
                            '@keyframes pulse': {
                                '0%': { opacity: 1 },
                                '50%': { opacity: 0.4 },
                                '100%': { opacity: 1 },
                            },
                        }} />
                        : <TableIcon sx={{ width: 14, height: 14, color: iconColor }} />}
                </Box>
                <Box aria-hidden sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: RAIL_LINE }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, py: CARD_PY, pl: GUTTER_GAP, pr: CARD_INSET_RIGHT }}>
                {buildTableCard({
                    tableId: tbl.id,
                    tables,
                    inferredDisplayName: inferredTableNames.find(info => info.tableId === tbl.id)?.displayName,
                    // The shelf never shows artifacts — charts live in the thread
                    // started from the table.
                    chartElements: [],
                    usedIntermediateTableIds: [],
                    highlightedTableIds,
                    focusedTableId,
                    focusedChartId: undefined,
                    parentTable: undefined,
                    tableIdList: [],
                    collapsed: false,
                    dispatch,
                    handleOpenTableMenu,
                    primaryBgColor: theme.palette.primary.bgcolor,
                    t,
                    showOriginalName: true,
                })}
            </Box>
        </Box>;
    }), [visibleTables, tables, inferredTableNames, highlightedTableIds, focusedTableId, theme, t]);

    return <Box sx={{
        ...sx,
        '& .selected-card': {
            boxShadow: `0 0 0 2px ${theme.palette.primary.light}`,
            borderColor: 'transparent',
            margin: '1px 0',
        },
        padding: '6px',
    }}>
        {/* Match DataThread's inner padding so the shelf shares its grid. */}
        <Box sx={{ padding: '2px 4px 2px 4px', display: 'flex', flexDirection: 'column' }}>
            {/* Section label, in the same type as a thread's "THREAD - N" header.
                Left-aligned: unlike a thread header there's no dot to sit beside. */}
            <Box sx={{ pr: CARD_INSET_RIGHT, display: 'flex', alignItems: 'center', minHeight: 16 }}>
                <Typography sx={{
                    flex: 1,
                    fontSize: textVar.xs, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.02em',
                    color: 'rgba(0,0,0,0.55)',
                }}>
                    {t('dataThread.dataSources', { defaultValue: 'Data sources' })}
                </Typography>
                <IconButton
                    size="small"
                    aria-label={t(`dataThread.${sectionExpanded ? 'collapse' : 'expand'}`)}
                    aria-expanded={sectionExpanded}
                    aria-controls="data-source-shelf-content"
                    onClick={() => setSectionExpanded(current => !current)}
                    sx={{ p: 0.25, color: 'text.secondary' }}
                >
                    {sectionExpanded
                        ? <KeyboardArrowUpIcon sx={{ fontSize: iconVar.sm }} />
                        : <KeyboardArrowDownIcon sx={{ fontSize: iconVar.sm }} />}
                </IconButton>
            </Box>

            <Collapse in={sectionExpanded} timeout="auto">
                <Box id="data-source-shelf-content">
                    {/* Just enough rail to link the label to the first card. The card
                        row draws its own lead-in above the icon, so anything longer
                        here reads as a gap between the label and the list. */}
                    <Box aria-hidden sx={{ ml: RAIL_OFFSET, height: '2px', borderLeft: RAIL_LINE }} />

                    {/* Each card carries its own gutter icon and rail segments (see the
                        `cards` memo), so the rail is punctuated exactly like a thread's
                        timeline rather than running as one long stroke. */}
                    {cards}

                    {collapsible && (
                        <Box sx={{ pl: `calc(${GUTTER_WIDTH}px + ${GUTTER_GAP})`, pr: CARD_INSET_RIGHT }}>
                            <Button
                                size="small"
                                onClick={() => setExpanded(!expanded)}
                                endIcon={expanded
                                    ? <KeyboardArrowUpIcon sx={{ fontSize: iconVar.sm }} />
                                    : <KeyboardArrowDownIcon sx={{ fontSize: iconVar.sm }} />}
                                sx={{
                                    textTransform: 'none', fontSize: textVar.xs, fontWeight: 500,
                                    minHeight: 0, py: 0.25, px: 0.5,
                                    color: 'text.secondary',
                                    '& .MuiButton-endIcon': { ml: 0.25 },
                                }}
                            >
                                {expanded
                                    ? t('dataThread.showFewerTables', { defaultValue: 'Show fewer' })
                                    : t('dataThread.showAllTables', { count: sourceTables.length, defaultValue: `Show all ${sourceTables.length}` })}
                            </Button>
                        </Box>
                    )}
                </Box>
            </Collapse>

            {!sectionExpanded && (
                <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                    <Box sx={{
                        width: `calc(${GUTTER_WIDTH}px + ${GUTTER_GAP})`,
                        flexShrink: 0,
                        display: 'flex',
                    }}>
                        <Box aria-hidden sx={{ ml: RAIL_OFFSET, borderLeft: RAIL_LINE }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, pt: 0.5, pr: CARD_INSET_RIGHT }}>
                        <Button
                            fullWidth
                            size="small"
                            startIcon={<TableIcon sx={{ width: 14, height: 14, color: 'rgba(0,0,0,0.35)' }} />}
                            aria-label={t('dataThread.expand')}
                            aria-controls="data-source-shelf-content"
                            onClick={() => setSectionExpanded(true)}
                            sx={{
                                justifyContent: 'flex-start',
                                px: 1, py: 0.75,
                                borderRadius: '6px',
                                backgroundColor: 'rgba(0,0,0,0.045)',
                                color: 'text.secondary',
                                textTransform: 'none',
                                fontSize: textVar.xs,
                                fontWeight: 400,
                                '& .MuiButton-startIcon': { mr: 0.75 },
                                '&:hover': { backgroundColor: 'rgba(0,0,0,0.08)' },
                            }}
                        >
                            {t('dataThread.tablesAvailableToAgent', {
                                count: sourceTables.length,
                                defaultValue: `${sourceTables.length} tables available to the agent`,
                            })}
                        </Button>
                    </Box>
                </Box>
            )}

            {/* Grow the workspace right where its tables are read, instead of
                hunting for the sidebar.  The gutter is widened by the card gap
                so the rail can turn right and meet the button's left edge at
                its mid-height, rather than dead-ending in empty space. */}
            <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                <Box sx={{ width: `calc(${GUTTER_WIDTH}px + ${GUTTER_GAP})`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                    <Box aria-hidden sx={{ ml: RAIL_OFFSET, height: ROW_GAP, borderLeft: RAIL_LINE }} />
                    <Box aria-hidden sx={{
                        ml: RAIL_OFFSET, flex: '1 1 0',
                        borderLeft: RAIL_LINE, borderBottom: RAIL_LINE,
                        borderBottomLeftRadius: '4px',
                    }} />
                    <Box sx={{ flex: '1 1 0' }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, pt: ROW_GAP, pr: CARD_INSET_RIGHT }}>
                    <Button
                        fullWidth
                        size="small"
                        startIcon={<AddIcon sx={{ fontSize: iconVar.sm }} />}
                        onClick={() => setAddDataDialogOpen(true)}
                        sx={{
                            justifyContent: 'flex-start',
                            textTransform: 'none',
                            fontSize: textVar.xs,
                            fontWeight: 500,
                            py: 0.5,
                            borderRadius: '6px',
                            border: '1px dashed',
                            borderColor: 'rgba(0,0,0,0.15)',
                            color: 'text.secondary',
                            '& .MuiButton-startIcon': { mr: 0.5 },
                            '&:hover': {
                                borderColor: 'primary.main',
                                color: 'primary.main',
                                backgroundColor: alpha(theme.palette.primary.main, 0.04),
                            },
                        }}
                    >
                        {t('dataThread.addMoreData', { defaultValue: 'Add more data' })}
                    </Button>
                </Box>
            </Box>
        </Box>

        {addDataDialogOpen && (
            <UnifiedDataUploadDialog
                open={addDataDialogOpen}
                onClose={() => setAddDataDialogOpen(false)}
                initialTab="menu"
            />
        )}

        <MetadataPopup
            open={metadataPopupOpen}
            anchorEl={metadataAnchorEl}
            onClose={handleCloseMetadataPopup}
            table={selectedTableForMetadata}
        />
        <RenameTablePopup
            open={renamePopupOpen}
            anchorEl={renameAnchorEl}
            onClose={handleCloseRenamePopup}
            onSave={handleSaveRename}
            initialValue={selectedTableForRename?.displayId || selectedTableForRename?.id || ''}
            tableName={selectedTableForRename?.displayId || selectedTableForRename?.id || ''}
        />

        {/* Source table actions menu */}
        <Menu
            anchorEl={tableMenuAnchorEl}
            open={Boolean(tableMenuAnchorEl)}
            onClose={handleCloseTableMenu}
            onClick={(e) => e.stopPropagation()}
        >
            <MenuItem
                onClick={(e) => {
                    e.stopPropagation();
                    if (selectedTableForMenu) {
                        handleOpenRenamePopup(selectedTableForMenu, tableMenuAnchorEl!);
                    }
                    handleCloseTableMenu();
                }}
                sx={{ fontSize: textVar.sm, display: 'flex', alignItems: 'center', gap: 1 }}
            >
                <EditIcon sx={{ fontSize: iconVar.md, color: 'text.secondary' }} />
                {t('dataThread.rename')}
            </MenuItem>
            {/* View metadata — read-only viewer of the source description */}
            {selectedTableForMenu && (
                <MenuItem
                    onClick={(e) => {
                        e.stopPropagation();
                        if (selectedTableForMenu) {
                            handleOpenMetadataPopup(selectedTableForMenu, tableMenuAnchorEl!);
                        }
                        handleCloseTableMenu();
                    }}
                    sx={{ fontSize: textVar.sm, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                    <AttachFileIcon sx={{
                        fontSize: textVar.xl,
                        color: selectedTableForMenu?.description ? 'secondary.main' : 'text.secondary',
                    }} />
                    {t('dataThread.viewMetadata', { defaultValue: 'View metadata' })}
                </MenuItem>
            )}
            {/* Refresh settings - stream/database sources only */}
            {selectedTableForMenu &&
                (selectedTableForMenu.source?.type === 'stream' || selectedTableForMenu.source?.type === 'database') && (
                    <MenuItem
                        onClick={(e) => {
                            e.stopPropagation();
                            if (selectedTableForMenu) {
                                handleOpenStreamingSettingsPopup(selectedTableForMenu, tableMenuAnchorEl!);
                            }
                            handleCloseTableMenu();
                        }}
                        sx={{ fontSize: textVar.sm, display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        <StreamIcon sx={{ fontSize: iconVar.md, color: selectedTableForMenu.source?.autoRefresh ? 'success.main' : 'text.secondary' }} />
                        {selectedTableForMenu.source?.autoRefresh ? t('dataThread.refreshSettings') : t('dataThread.watchForUpdates')}
                    </MenuItem>
                )}
            {/* Replace data - hidden for database tables */}
            {selectedTableForMenu?.source?.type !== 'database' && (
                <MenuItem
                    onClick={(e) => {
                        e.stopPropagation();
                        if (selectedTableForMenu) {
                            handleOpenRefreshDialog(selectedTableForMenu);
                        }
                    }}
                    sx={{ fontSize: textVar.sm, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                    <RefreshIcon sx={{ fontSize: iconVar.md, color: 'primary.main' }} />
                    {t('dataThread.replaceData')}
                </MenuItem>
            )}
            <MenuItem
                onClick={(e) => {
                    e.stopPropagation();
                    if (selectedTableForMenu) {
                        // If this is the last source table, also wipe the
                        // session itself — a workspace with no source
                        // table is effectively empty and the user would
                        // otherwise be left staring at a blank thread.
                        const remainingSources = tables.filter(t => !t.derive && t.id !== selectedTableForMenu.id);
                        const shouldDeleteSession = remainingSources.length === 0;
                        const wsToDelete = shouldDeleteSession ? activeWorkspace?.id : undefined;
                        dispatch(dfActions.deleteTable(selectedTableForMenu.id));
                        if (shouldDeleteSession && wsToDelete) {
                            (async () => {
                                try {
                                    await deleteWorkspace(wsToDelete);
                                } catch {
                                    // best effort — user can still manually delete from the sidebar
                                }
                                // Drop into the unsessioned landing state instead of
                                // auto-creating a new "Untitled Session" workspace.
                                dispatch(dfActions.resetState());
                            })();
                        }
                    }
                    handleCloseTableMenu();
                }}
                disabled={selectedTableForMenu
                    ? tables.some(t => t.derive?.trigger.tableId === selectedTableForMenu.id)
                    : true}
                sx={{ fontSize: textVar.sm, display: 'flex', alignItems: 'center', gap: 1, color: 'warning.main' }}
            >
                <DeleteIcon sx={{ fontSize: iconVar.md }} color='warning' />
                {t('dataThread.deleteTable')}
            </MenuItem>
        </Menu>

        {/* Refresh data dialog */}
        {selectedTableForRefresh && (
            <RefreshDataDialog
                open={refreshDialogOpen}
                onClose={handleCloseRefreshDialog}
                table={selectedTableForRefresh}
                onRefreshComplete={handleRefreshComplete}
            />
        )}

        {/* Streaming settings popup */}
        {selectedTableForStreamingSettings && (
            <StreamingSettingsPopup
                open={streamingSettingsPopupOpen}
                anchorEl={streamingSettingsAnchorEl}
                onClose={handleCloseStreamingSettingsPopup}
                table={selectedTableForStreamingSettings}
                onUpdateSettings={handleUpdateStreamingSettings}
                onRefreshNow={() => manualRefresh(selectedTableForStreamingSettings.id)}
            />
        )}
    </Box>;
};
