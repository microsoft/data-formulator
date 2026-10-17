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

import React, { FC, memo, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollFadeEdge, useScrollFade } from '../components/ScrollFade';

import {
    Box,
    Button,
    ButtonBase,
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
    Tooltip,
    Typography,
    SxProps,
    useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';

import AddIcon from '@mui/icons-material/Add';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import RefreshIcon from '@mui/icons-material/Refresh';

import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { getUrls } from '../app/utils';
import { apiRequest } from '../app/apiClient';
import { buildDictTableFromWorkspace } from '../app/tableThunks';
import { DictTable } from '../components/ComponentType';
import { InlineLoadingStatus } from '../components/FunComponents';
import {
    deleteWorkspace,
    deleteWorkspaceFile,
    externalReferenceTitle,
    type WorkspaceFile,
} from '../app/workspaceService';
import { useDataRefresh } from '../app/useDataRefresh';
import { ViewBorderStyle } from '../app/tokens';
import { StreamIcon, TableIcon } from '../icons';
import { ArtifactMenuButton } from './DataThreadCards';
import { RefreshDataDialog } from './RefreshDataDialog';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { iconVar, textVar } from '../app/layout';

/** Seconds options for stream/database auto-refresh interval (labels in i18n: dataThread.refreshInterval.*). */
const STREAM_REFRESH_INTERVAL_SECONDS = [1, 10, 30, 60, 300, 600, 1800, 3600, 86400] as const;

/** Tables shown before the shelf collapses behind a "show all" toggle. */
/** The workspace list's height cap; a longer list scrolls inside it. */
const SHELF_MAX_HEIGHT = 'min(40vh, 360px)';
// Import groups up to this size start expanded.
const IMPORT_GROUP_OPEN_LIMIT = 3;
// Indent per folder level: one icon plus the row gap, so contents line up under the folder's name.
const ROW_INDENT_PX = 18;
const ICON_COLOR = 'rgba(0,0,0,0.4)';

// Mirror DataThread's timeline geometry so the shelf's rail lines up with the
// thread rails below it.
const GUTTER_WIDTH = 14;          // DataThread's TIMELINE_WIDTH
const GUTTER_GAP = '4px';         // DataThread's TIMELINE_GAP
const RAIL_LINE = '2px solid rgba(0,0,0,0.1)';
// Left offset that puts the 2px rail on the gutter's centre line.
const RAIL_OFFSET = '6px';
// The lead-in the rail draws above the "add data" row.
const ROW_GAP = '6px';

/** A row beside the shelf's timeline rail, which runs unbroken past every row. */
const RailRow: FC<{ children: React.ReactNode; rowProps?: Record<string, string> }> = ({ children, rowProps }) => (
    <Box {...rowProps} sx={{ display: 'flex', flexDirection: 'row', minWidth: 0 }}>
        <Box aria-hidden sx={{ width: GUTTER_WIDTH, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ borderLeft: RAIL_LINE }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, pl: GUTTER_GAP }}>{children}</Box>
    </Box>
);

/**
 * One row of the workspace list, compact like a file explorer: icon (a folder's arrow),
 * name, and actions on hover. `depth` indents folder contents and imported tables.
 */
const WorkspaceRow: FC<{
    icon: React.ReactNode;
    label: string;
    title?: string;
    note?: React.ReactNode;
    selected?: boolean;
    depth?: number;
    dimmed?: boolean;
    expanded?: boolean;
    onClick?: () => void;
    actions?: React.ReactNode;
    rowProps?: Record<string, string>;
}> = ({ icon, label, title, note, selected = false, depth = 0, dimmed = false, expanded, onClick, actions, rowProps }) => {
    const theme = useTheme();
    const content = <>
        <Box component="span" sx={{ display: 'flex', flexShrink: 0 }}>{icon}</Box>
        <Typography component="span" title={title || label}
            sx={{ fontSize: textVar.sm, minWidth: '3em', flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
        {/* The note gives way first, so the name keeps the room. */}
        {note && <Box component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', flexShrink: 100, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note}</Box>}
    </>;
    // The row and its button clip, so a long name ends in an ellipsis before the row's actions.
    const innerSx = { flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 0.5,
        pl: `${depth * ROW_INDENT_PX + 4}px`, pr: 0.5, py: '2px',
        color: selected ? 'primary.main' : 'text.primary', textAlign: 'left' } as const;
    return <RailRow rowProps={rowProps}>
        <Box sx={{
            display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden', borderRadius: '4px', opacity: dimmed ? 0.55 : 1,
            bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : undefined,
            '&:hover': { bgcolor: selected ? alpha(theme.palette.primary.main, 0.12) : 'action.hover' },
            '& .artifact-actions': { opacity: 0 },
            '&:hover .artifact-actions, &:focus-within .artifact-actions': { opacity: 1 },
            '@media (hover: none)': { '& .artifact-actions': { opacity: 1 } },
        }}>
            {/* A row with nothing to open (e.g. a table still loading) is not a button. */}
            {onClick
                ? <ButtonBase aria-label={label} aria-current={selected ? 'true' : undefined} aria-expanded={expanded} onClick={onClick}
                    sx={{ ...innerSx, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}>
                    {content}
                </ButtonBase>
                : <Box sx={innerSx}>{content}</Box>}
            {actions && <Box className="artifact-actions" sx={{ flexShrink: 0, display: 'flex', pr: 0.25 }}>{actions}</Box>}
        </Box>
    </RailRow>;
};

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
    /** The workspace input tables, in display order, materialized for the cards. */
    inputTables: DictTable[];
    /** Persisted uploads that were not converted into tables. */
    workspaceFiles: WorkspaceFile[];
    /** Tables highlighted by the current focus (computed once in DataThread). */
    highlightedTableIds: string[];
    focusedTableId?: string;
    sx?: SxProps;
}> = function ({ inputTables, workspaceFiles, highlightedTableIds, focusedTableId, sx }) {

    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const { manualRefresh } = useDataRefresh();

    const tables = useSelector(dfSelectors.getAllTables);
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const canvasTarget = useSelector(dfSelectors.selectCanvasTarget);
    const externalReferences = useSelector((state: DataFormulatorState) => state.externalTableReferences);
    const pendingTableLoads = useSelector((state: DataFormulatorState) => state.pendingTableLoads);
    const workspaceItemOrder = useSelector((state: DataFormulatorState) => state.workspaceItemOrder);

    const [sectionExpanded, setSectionExpanded] = useState(true);
    const [importGroupExpansion, setImportGroupExpansion] = useState<Record<string, boolean>>({});
    const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
    const importGroupSizesRef = useRef<Record<string, number>>({});
    const [importProvenanceChecked, setImportProvenanceChecked] = useState<string>();
    const [addDataDialogOpen, setAddDataDialogOpen] = useState(false);

    // Metadata popup state
    const [metadataPopupOpen, setMetadataPopupOpen] = useState(false);
    const [selectedTableForMetadata, setSelectedTableForMetadata] = useState<DictTable | null>(null);
    const [metadataAnchorEl, setMetadataAnchorEl] = useState<HTMLElement | null>(null);

    // Table menu state
    const [tableMenuAnchorEl, setTableMenuAnchorEl] = useState<HTMLElement | null>(null);
    const [selectedTableForMenu, setSelectedTableForMenu] = useState<DictTable | null>(null);
    const [fileMenuAnchorEl, setFileMenuAnchorEl] = useState<HTMLElement | null>(null);
    const [selectedArtifactForMenu, setSelectedArtifactForMenu] = useState<{
        remove: () => void;
        removeLabel: string;
    } | null>(null);
    const [deletingFileName, setDeletingFileName] = useState<string | null>(null);

    useEffect(() => {
        const workspaceId = activeWorkspace?.id;
        if (!workspaceId || !externalReferences?.length || importProvenanceChecked === workspaceId) return;
        const candidates = inputTables.filter(table => table.source?.type === 'database' && !table.source.importedFrom);
        if (!candidates.length) return;
        let cancelled = false;
        void apiRequest(getUrls().LIST_TABLES, { method: 'GET', headers: { 'X-Workspace-Id': workspaceId } }).then(({ data }) => {
            if (cancelled) return;
            setImportProvenanceChecked(workspaceId);
            for (const table of candidates) {
                const listing = (data.tables || []).find((item: any) => item.name === table.id);
                if (!listing) continue;
                const source = buildDictTableFromWorkspace(listing, table.source).source;
                if (source?.importedFrom) dispatch(dfActions.updateTableSource({ tableId: table.id, source }));
            }
        }).catch(() => { if (!cancelled) setImportProvenanceChecked(workspaceId); });
        return () => { cancelled = true; };
    }, [activeWorkspace?.id, externalReferences, inputTables, importProvenanceChecked, dispatch]);

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

    const handleCloseFileMenu = () => {
        setFileMenuAnchorEl(null);
        setSelectedArtifactForMenu(null);
    };

    const handleDeleteFile = async (workspaceFile: WorkspaceFile) => {
        setDeletingFileName(workspaceFile.name);
        try {
            await deleteWorkspaceFile(workspaceFile.name);
            dispatch(dfActions.removeFileNodes(workspaceFile.name));
        } catch (error) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: t('dataThread.workspace', { defaultValue: 'Workspace' }),
                value: t('dataThread.failedDeleteFile', {
                    name: workspaceFile.name,
                    defaultValue: `Failed to delete ${workspaceFile.name}`,
                }),
            }));
        } finally {
            setDeletingFileName(null);
        }
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
    const importsByReference = new Map<string, DictTable[]>();
    const nestedTableIds = new Set<string>();
    const importParent = (table: DictTable, visited = new Set<string>()): string | undefined => {
        if (visited.has(table.id)) return undefined;
        visited.add(table.id);
        if ((table.dataProvenance?.inputSources.length || 0) > 1
            || (table.derive?.source.length || 0) > 1 || (table.derive?.inputSources?.length || 0) > 1) return undefined;
        const origin = table.source?.importedFrom;
        if (origin) {
            const matches = (externalReferences || []).filter(reference => reference.connectorId === origin.connectorId && reference.tableKey === origin.tableKey);
            return matches.length === 1 ? matches[0].id : undefined;
        }
        const inputs = table.dataProvenance?.inputSources || table.derive?.inputSources;
        if (!inputs?.length || inputs[0].kind !== 'data' || table.dataProvenance?.stale) return undefined;
        const manifestId = /^data:(?:([a-f0-9]{64}):)?([^:]+)$/.exec(inputs[0].id);
        if (!manifestId) return undefined;
        const sourceHash = inputs[0].contentHash || manifestId[1];
        if (!sourceHash || (manifestId[1] && manifestId[1] !== sourceHash)) return undefined;
        let sourceId: string;
        try { sourceId = decodeURIComponent(manifestId[2]); } catch { return undefined; }
        const sources = tables.filter(candidate => candidate.id === sourceId || candidate.virtual?.tableId === sourceId);
        return sources.length === 1 && sources[0].contentHash === sourceHash && !sources[0].dataProvenance?.stale
            ? importParent(sources[0], visited) : undefined;
    };
    for (const table of inputTables) {
        const parentId = importParent(table);
        if (!parentId) continue;
        const siblings = importsByReference.get(parentId) || [];
        siblings.push(table);
        importsByReference.set(parentId, siblings);
        nestedTableIds.add(table.id);
    }
    for (const children of importsByReference.values()) {
        children.sort((first, second) => {
            const firstIndex = workspaceItemOrder.indexOf(`shelf-card-${first.id}`);
            const secondIndex = workspaceItemOrder.indexOf(`shelf-card-${second.id}`);
            return (firstIndex < 0 ? Infinity : firstIndex) - (secondIndex < 0 ? Infinity : secondIndex);
        });
    }
    const topLevelTables = inputTables.filter(table => !nestedTableIds.has(table.id));
    const listRef = useRef<HTMLDivElement | null>(null);
    const { moreAbove: listMoreAbove, moreBelow: listMoreBelow, update: updateListFade } = useScrollFade(listRef);
    // The open item scrolls into view inside the list (only the list scrolls, not the page).
    useEffect(() => {
        const list = listRef.current;
        const selected = list?.querySelector<HTMLElement>('[aria-current="true"]');
        if (!list || !selected || list.scrollHeight <= list.clientHeight) return;
        const top = selected.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
        if (top < list.scrollTop || top + selected.offsetHeight > list.scrollTop + list.clientHeight) {
            list.scrollTop = Math.max(0, top - (list.clientHeight - selected.offsetHeight) / 2);
        }
    }, [focusedTableId, focusedId]);
    const visibleTables = topLevelTables;

    useEffect(() => {
        const selectedTableId = focusedTableId || (focusedId?.type === 'table' ? focusedId.tableId : undefined);
        const parent = [...importsByReference].find(([, children]) => children.some(table => table.id === selectedTableId))?.[0];
        if (parent) setImportGroupExpansion(previous => previous[parent] ? previous : { ...previous, [parent]: true });
    }, [focusedTableId, focusedId, inputTables, externalReferences, tables]);

    useEffect(() => {
        const grown = [...importsByReference].filter(([parent, children]) =>
            parent in importGroupSizesRef.current && children.length > importGroupSizesRef.current[parent]);
        importGroupSizesRef.current = Object.fromEntries([...importsByReference].map(([parent, children]) => [parent, children.length]));
        if (grown.length) setImportGroupExpansion(previous => ({ ...previous, ...Object.fromEntries(grown.map(([parent]) => [parent, true])) }));
    }, [inputTables, externalReferences, tables]);

    // One file-explorer row per table; its menu holds the source-table actions.
    const cards = useMemo(() => visibleTables.map(tbl => {
        const isStreaming = (tbl.source?.type === 'stream' || tbl.source?.type === 'database') && tbl.source?.autoRefresh;
        const selected = focusedTableId === tbl.id || (focusedId?.type === 'table' && focusedId.tableId === tbl.id);
        const highlighted = selected || highlightedTableIds.includes(tbl.id);
        const name = tbl.displayId || tbl.id;
        const originalName = tbl.source?.originalTableName || tbl.virtual?.tableId;
        const iconSx = { width: 14, height: 14, color: highlighted ? theme.palette.primary.main : ICON_COLOR };
        return <WorkspaceRow key={`shelf-card-${tbl.id}`} rowProps={{ 'data-table-id': tbl.id }}
            icon={isStreaming
                ? <StreamIcon sx={{ ...iconSx, color: highlighted ? theme.palette.success.main : ICON_COLOR,
                    animation: 'pulse 2s infinite',
                    '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.4 }, '100%': { opacity: 1 } } }} />
                : <TableIcon sx={iconSx} />}
            label={name} title={originalName && originalName !== name ? `${name} (${originalName})` : name}
            selected={selected}
            onClick={() => dispatch(dfActions.setFocused({ type: 'table', tableId: tbl.id }))}
            actions={<ArtifactMenuButton tooltip={t('dataThread.moreOptions')}
                label={t('dataThread.fileActions', { name, defaultValue: `Actions for ${name}` })}
                onClick={anchorEl => handleOpenTableMenu(tbl, anchorEl)} />} />;
    }), [visibleTables, highlightedTableIds, focusedTableId, focusedId, theme, t]);

    // Files in folders are grouped under their top-level folder.
    const fileFolder = (workspaceFile: WorkspaceFile) => !workspaceFile.temporary && workspaceFile.name.includes('/')
        ? workspaceFile.name.split('/')[0] : undefined;
    const workspaceArtifacts = [...workspaceFiles.map(workspaceFile => {
        const folder = fileFolder(workspaceFile);
        const fileName = workspaceFile.temporary ? workspaceFile.name.replace(/^scratch\//, '')
            : folder ? workspaceFile.name.slice(folder.length + 1) : workspaceFile.name;
        return {
            key: `workspace-file-${workspaceFile.name}`,
            folder,
            artifactType: 'file' as const,
            title: workspaceFile.display_name || fileName,
            notes: workspaceFile.display_name && workspaceFile.display_name !== fileName ? fileName : undefined,
            selected: focusedId?.type === 'file' && focusedId.fileName === workspaceFile.name,
            deleting: deletingFileName === workspaceFile.name,
            open: () => dispatch(dfActions.setFocused({ type: 'file', fileName: workspaceFile.name })),
            remove: () => { void handleDeleteFile(workspaceFile); },
            removeLabel: t('dataThread.deleteFile', { defaultValue: 'Delete file' }),
        };
    }), ...(externalReferences || []).map(reference => {
        const title = externalReferenceTitle(reference);
        return {
            key: reference.id,
            folder: undefined as string | undefined,
            artifactType: 'table' as const,
            title,
            notes: reference.sourceTable.name !== title ? reference.sourceTable.name : undefined,
            selected: canvasTarget?.type === 'external-table' && canvasTarget.referenceId === reference.id,
            deleting: false,
            open: () => dispatch(dfActions.setFocused({ type: 'external-table', referenceId: reference.id })),
            remove: () => { dispatch(dfActions.removeExternalTableReference(reference.id)); },
            removeLabel: t('externalReference.remove', { defaultValue: 'Remove reference' }),
        };
    })];

    const renderArtifactCard = (artifact: typeof workspaceArtifacts[number], depth = 0) => {
        const importedTables = importsByReference.get(artifact.key) || [];
        const importsCollapsible = importedTables.length > IMPORT_GROUP_OPEN_LIMIT;
        const importsExpanded = !importsCollapsible || (importGroupExpansion[artifact.key] ?? false);
        const toggleImports = () => setImportGroupExpansion(previous => ({ ...previous, [artifact.key]: !importsExpanded }));
        const importToggleSx = { display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 0.5, py: '2px',
            pl: `${(depth + 1) * ROW_INDENT_PX + 4}px`, color: 'text.secondary', fontSize: textVar.xs,
            '&:hover': { color: 'text.primary' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } };
        const iconColor = artifact.selected ? theme.palette.primary.main : ICON_COLOR;
        return (
        <Box key={artifact.key}>
            <WorkspaceRow rowProps={{ 'data-workspace-item': artifact.key }} depth={depth}
                icon={artifact.artifactType === 'table'
                    ? <TableIcon sx={{ width: 14, height: 14, color: iconColor }} />
                    : <InsertDriveFileOutlinedIcon sx={{ width: 14, height: 14, color: iconColor }} />}
                label={artifact.title}
                title={artifact.notes ? `${artifact.title} (${artifact.notes})` : artifact.title}
                // A file's name, when it has a display name, is in the row's tooltip rather than beside it.
                note={artifact.artifactType === 'table'
                    ? <Tooltip title={artifact.notes || artifact.title}>
                        <span>{t('externalReference.virtualNote', { defaultValue: '(virtual)' })}</span>
                    </Tooltip>
                    : undefined}
                selected={artifact.selected} dimmed={artifact.deleting} onClick={artifact.open}
                actions={artifact.deleting
                    ? <Box sx={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CircularProgress size={14} />
                    </Box>
                    : <ArtifactMenuButton tooltip={t('dataThread.moreOptions')}
                        label={t('dataThread.fileActions', { name: artifact.title, defaultValue: `Actions for ${artifact.title}` })}
                        onClick={anchorEl => {
                            setSelectedArtifactForMenu(artifact);
                            setFileMenuAnchorEl(anchorEl);
                        }} />} />
            {importedTables.length > 0 && <>
                {!importsExpanded && <RailRow><ButtonBase aria-expanded={false} aria-controls={`source-imports-${artifact.key}`} onClick={toggleImports} sx={importToggleSx}>
                    <KeyboardArrowDownIcon sx={{ fontSize: iconVar.sm }} />
                    {t('dataThread.importedTables', { count: importedTables.length, defaultValue: '{{count}} imported tables' })}
                </ButtonBase></RailRow>}
                <Collapse in={importsExpanded} unmountOnExit>
                    <Box component="ul" id={`source-imports-${artifact.key}`} aria-label={t('dataThread.importsFrom', { name: artifact.title, defaultValue: 'Imports from {{name}}' })} sx={{ listStyle: 'none', p: 0, m: 0 }}>
                        {importedTables.map(table => {
                            const selected = focusedTableId === table.id || (focusedId?.type === 'table' && focusedId.tableId === table.id);
                            const name = table.displayId || table.id;
                            return <Box component="li" key={table.id}>
                                <WorkspaceRow rowProps={{ 'data-workspace-import': table.id }} depth={depth + 1}
                                    icon={<TableIcon sx={{ width: 14, height: 14, color: selected ? theme.palette.primary.main : ICON_COLOR }} />}
                                    label={name} title={`${name}${table.displayId !== table.id ? ` (${table.id})` : ''}`}
                                    selected={selected}
                                    onClick={() => dispatch(dfActions.setFocused({ type: 'table', tableId: table.id }))}
                                    actions={<ArtifactMenuButton label={t('dataThread.fileActions', { name, defaultValue: 'Actions for {{name}}' })}
                                        tooltip={t('dataThread.moreOptions')} onClick={anchor => handleOpenTableMenu(table, anchor)} />} />
                            </Box>;
                        })}
                    </Box>
                    {importsCollapsible && <RailRow><ButtonBase aria-expanded aria-controls={`source-imports-${artifact.key}`} onClick={toggleImports}
                        sx={{ ...importToggleSx, color: 'text.disabled' }}>
                        <KeyboardArrowUpIcon sx={{ fontSize: iconVar.sm }} />
                        {t('dataThread.showFewerTables', { defaultValue: 'Show fewer' })}
                    </ButtonBase></RailRow>}
                </Collapse>
            </>}
        </Box>
    );
    };
    const folders = [...new Set(workspaceArtifacts.map(artifact => artifact.folder).filter((folder): folder is string => !!folder))];
    const artifactCards = [
        ...workspaceArtifacts.filter(artifact => !artifact.folder).map(artifact => renderArtifactCard(artifact)),
        ...folders.map(folder => {
            const members = workspaceArtifacts.filter(artifact => artifact.folder === folder)
                .sort((first, second) => first.key.localeCompare(second.key));
            // A folder holding the open file stays open.
            const expanded = !collapsedFolders[folder] || members.some(member => member.selected);
            const Chevron = expanded ? KeyboardArrowDownIcon : KeyboardArrowRightIcon;
            return <Box key={`workspace-folder-${folder}`} data-workspace-folder={folder}>
                <WorkspaceRow label={folder} expanded={expanded}
                    icon={<Chevron sx={{ width: 14, height: 14, color: 'text.secondary' }} />}
                    note={members.length}
                    onClick={() => setCollapsedFolders(previous => ({ ...previous, [folder]: expanded }))} />
                <Collapse in={expanded} unmountOnExit>
                    <Box role="group" aria-label={folder}>{members.map(member => renderArtifactCard(member, 1))}</Box>
                </Collapse>
            </Box>;
        }),
    ];

    const currentItemKeys = [
        ...(externalReferences || []).map(reference => reference.id),
        ...workspaceFiles.filter(file => !fileFolder(file)).map(file => `workspace-file-${file.name}`),
        ...[...new Set(workspaceFiles.map(fileFolder).filter(Boolean))].map(folder => `workspace-folder-${folder}`),
        ...inputTables.map(table => `shelf-card-${table.id}`),
    ];
    const itemOrder = [...new Set([...workspaceItemOrder, ...currentItemKeys])];
    // Folders first, as in a file explorer; then tables and files in the order they were added.
    const isFolder = (card: React.ReactElement) => String(card.key).startsWith('workspace-folder-');
    const orderedCards = [...cards, ...artifactCards].sort((first, second) =>
        Number(isFolder(second)) - Number(isFolder(first))
        || itemOrder.indexOf(String(first.key)) - itemOrder.indexOf(String(second.key)));

    useEffect(() => {
        if (currentItemKeys.some(key => !workspaceItemOrder.includes(key))) {
            dispatch(dfActions.appendWorkspaceItems(currentItemKeys));
        }
    }, [currentItemKeys, workspaceItemOrder, dispatch]);

    return <Box data-thread-shelf sx={{
        ...sx,
        '& .selected-card': {
            boxShadow: `0 0 0 2px ${theme.palette.primary.light}`,
            borderColor: 'transparent',
            margin: '1px 0',
        },
        '& .selected-artifact-card': {
            boxShadow: '0 0 0 2px var(--artifact-selection-color)',
            borderColor: 'transparent',
        },
        padding: '6px',
    }}>
        {/* Match DataThread's inner padding so the shelf shares its grid. */}
        <Box sx={{ padding: '2px 4px 2px 4px', display: 'flex', flexDirection: 'column' }}>
            {/* Section label, in the same type as a thread's "THREAD - N" header.
                Left-aligned: unlike a thread header there's no dot to sit beside. */}
            <Box sx={{ pr: 0.5, display: 'flex', alignItems: 'center', minHeight: 16, mb: 0.5 }}>
                <Typography sx={{
                    flex: 1,
                    fontSize: textVar.xs, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.02em',
                    color: 'rgba(0,0,0,0.55)',
                }}>
                    {t('dataThread.workspace', { defaultValue: 'Workspace' })}
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
                    {/* Just enough rail to link the label to the first row. */}
                    <Box aria-hidden sx={{ ml: RAIL_OFFSET, height: '2px', borderLeft: RAIL_LINE }} />
                    <Box sx={{ position: 'relative' }}>
                    {/* A long list scrolls inside a capped box; the cap is plain CSS, nothing is measured. */}
                    <Box ref={listRef} data-shelf-list onScroll={updateListFade}
                        sx={{ maxHeight: SHELF_MAX_HEIGHT, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin' }}>
                    {orderedCards}
                    {pendingTableLoads.flatMap(load => load.names.map((name, index) => (
                        <Box key={`${load.id}-${index}`} role="status" aria-label={t('dataThread.loadingTable', { name, defaultValue: 'Loading {{name}}' })}>
                            <WorkspaceRow dimmed label={name}
                                icon={<TableIcon sx={{ width: 14, height: 14, color: ICON_COLOR }} />}
                                note={<InlineLoadingStatus label={t('common.loading', { defaultValue: 'Loading...' })}
                                    sx={{ fontSize: textVar.xs, gap: 0.5 }} />} />
                        </Box>
                    )))}
                    </Box>
                    {/* The fades cover the rows, not the rail, which runs on unbroken. */}
                    <Box aria-hidden sx={{ position: 'absolute', top: 0, bottom: 0, right: 0, pointerEvents: 'none',
                        left: `calc(${GUTTER_WIDTH}px + ${GUTTER_GAP})` }}>
                        <ScrollFadeEdge visible={listMoreAbove} edge="top" />
                        <ScrollFadeEdge visible={listMoreBelow} />
                    </Box>
                    </Box>
                </Box>
            </Collapse>

            {!sectionExpanded && (
                <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                    <Box sx={{ width: `calc(${GUTTER_WIDTH}px + ${GUTTER_GAP})`, flexShrink: 0, display: 'flex' }}>
                        <Box aria-hidden sx={{ ml: RAIL_OFFSET, borderLeft: RAIL_LINE }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, pt: 0.5, pr: 0.5 }}>
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
                                count: inputTables.length,
                                defaultValue: `${inputTables.length} tables available to the agent`,
                            })}
                        </Button>
                    </Box>
                </Box>
            )}

            {/* Grow the workspace right where its tables are read, instead of hunting for the sidebar.
                The rail turns right to meet the button's left edge at its mid-height. */}
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
                <Box sx={{ flex: 1, minWidth: 0, pt: ROW_GAP, pr: 0.5 }}>
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
            anchorEl={fileMenuAnchorEl}
            open={Boolean(fileMenuAnchorEl)}
            onClose={handleCloseFileMenu}
            onClick={(event) => event.stopPropagation()}
        >
            <MenuItem
                disabled={activeWorkspace?.readOnly}
                onClick={() => {
                    selectedArtifactForMenu?.remove();
                    handleCloseFileMenu();
                }}
                sx={{ fontSize: textVar.sm, display: 'flex', alignItems: 'center', gap: 1, color: 'warning.main' }}
            >
                <DeleteIcon sx={{ fontSize: iconVar.md }} color="warning" />
                {selectedArtifactForMenu?.removeLabel}
            </MenuItem>
        </Menu>

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
                    <InsertDriveFileOutlinedIcon sx={{
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
                        const remainingSources = inputTables.filter(t => t.id !== selectedTableForMenu.id);
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
