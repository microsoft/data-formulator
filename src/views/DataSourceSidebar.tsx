// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DataSourceSidebar — persistent collapsible panel on the left edge.
 * Shows connected data sources with catalog trees.  Users can click
 * to preview, drag-and-drop to import, and see ✓ / refresh on loaded
 * tables.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Box,
    Typography,
    IconButton,
    Tooltip,
    Collapse,
    CircularProgress,
    Divider,
    Popover,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';

import StorageIcon from '@mui/icons-material/Storage';
import AddIcon from '@mui/icons-material/Add';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import ContentPasteOutlinedIcon from '@mui/icons-material/ContentPasteOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import HistoryIcon from '@mui/icons-material/History';

import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { fetchWithIdentity, CONNECTOR_URLS, CONNECTOR_ACTION_URLS } from '../app/utils';
import { getConnectorIcon, connectorSortOrder, DatabaseIcon } from '../icons';
import { loadTable, buildDictTableFromWorkspace } from '../app/tableThunks';
import { listWorkspaces, loadWorkspace, deleteWorkspace } from '../app/workspaceService';
import { borderColor } from '../app/tokens';

import type { ConnectorInstance, DictTable } from '../components/ComponentType';
import { DataFrameTable } from './DataFrameTable';
import {
    CatalogTreeNode,
    collectNamespaceIds,
    findNodeByPath,
    renderCatalogTreeItems,
} from '../components/CatalogTree';
import { CATALOG_TABLE_ITEM } from '../components/DndTypes';
import type { CatalogTableDragItem } from '../components/DndTypes';

// ─── Constants ───────────────────────────────────────────────────────────────

const RAIL_WIDTH = 40;
const PANEL_WIDTH = 260;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CatalogCache {
    tree: CatalogTreeNode[];
    fetchedAt: number;
}

interface PreviewState {
    connectorId: string;
    node: CatalogTreeNode;
    columns: { name: string; type: string }[];
    sampleRows: Record<string, any>[];
    rowCount: number | null;
    loading: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

// ─── Outer wrapper — ultra-lightweight, only reads isOpen ────────────────────

export const DataSourceSidebar: React.FC<{
    onOpenUploadDialog?: (tab?: string) => void;
}> = ({ onOpenUploadDialog }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const isOpen = useSelector((state: DataFormulatorState) => state.dataSourceSidebarOpen);
    const disableConnectors = useSelector((state: DataFormulatorState) => state.serverConfig.DISABLE_DATA_CONNECTORS);

    if (disableConnectors) return null;

    const toggle = () => dispatch(dfActions.setDataSourceSidebarOpen(!isOpen));

    const [initialTab, setInitialTab] = useState<'sources' | 'sessions'>('sources');

    return (
        <Box sx={{
            width: isOpen ? PANEL_WIDTH : RAIL_WIDTH,
            minWidth: isOpen ? PANEL_WIDTH : RAIL_WIDTH,
            transition: 'width 0.2s ease, min-width 0.2s ease',
            display: 'flex',
            flexDirection: 'row',
            borderRight: `1px solid ${borderColor.view}`,
            backgroundColor: 'background.paper',
            overflow: 'visible',
            position: 'relative',
        }}>
            {/* Rail — always visible */}
            <Box sx={{
                width: RAIL_WIDTH,
                minWidth: RAIL_WIDTH,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                pt: 1,
                gap: 0.5,
            }}>
                <Tooltip title={t('sidebar.openDataSources', { defaultValue: 'Data Sources' })} placement="right">
                    <IconButton size="small" onClick={() => { setInitialTab('sources'); if (!isOpen) toggle(); else if (initialTab !== 'sources') setInitialTab('sources'); else toggle(); }} sx={{
                        color: isOpen && initialTab === 'sources' ? 'primary.main' : 'text.secondary',
                        bgcolor: isOpen && initialTab === 'sources' ? 'action.selected' : 'transparent',
                        borderRadius: 1,
                    }}>
                        <DatabaseIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title={t('sidebar.sessions', { defaultValue: 'Sessions' })} placement="right">
                    <IconButton size="small" onClick={() => { setInitialTab('sessions'); if (!isOpen) toggle(); else if (initialTab !== 'sessions') setInitialTab('sessions'); else toggle(); }} sx={{
                        color: isOpen && initialTab === 'sessions' ? 'primary.main' : 'text.secondary',
                        bgcolor: isOpen && initialTab === 'sessions' ? 'action.selected' : 'transparent',
                        borderRadius: 1,
                    }}>
                        <HistoryIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>

            {/* Panel — rendered when open, slides in/out */}
            {isOpen && (
                <DataSourceSidebarPanel onOpenUploadDialog={onOpenUploadDialog} onCollapse={toggle} initialTab={initialTab} />
            )}

            {/* Edge collapse handle — sits on the border line */}
            {isOpen && (
                <Tooltip title={t('sidebar.collapse', { defaultValue: 'Collapse' })} placement="right">
                    <Box
                        onClick={toggle}
                        sx={{
                            position: 'absolute',
                            right: -6,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 12,
                            height: 28,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            borderRadius: 4,
                            border: `1px solid ${borderColor.view}`,
                            bgcolor: 'background.paper',
                            zIndex: 1,
                            color: 'text.disabled',
                            '&:hover': { color: 'text.secondary' },
                        }}
                    >
                        <ChevronLeftIcon sx={{ fontSize: 12 }} />
                    </Box>
                </Tooltip>
            )}
        </Box>
    );
};

// ─── Inner panel — only mounted when open, subscribes to heavier state ───────

const DataSourceSidebarPanel: React.FC<{
    onOpenUploadDialog?: (tab?: string) => void;
    onCollapse: () => void;
    initialTab?: 'sources' | 'sessions';
}> = ({ onOpenUploadDialog, onCollapse, initialTab = 'sources' }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);

    // Lightweight selector: only extract the fields we need from tables to avoid
    // re-rendering the entire sidebar when table row data changes.
    const tableIdentities = useSelector(
        (state: DataFormulatorState) => state.tables.map(t => ({
            id: t.id,
            connectorId: t.source?.connectorId,
            databaseTable: t.source?.databaseTable,
            originalTableName: t.source?.originalTableName,
            virtualTableId: t.virtual?.tableId,
        })),
        // Shallow-compare the mapped array by serializing — cheap because it's just IDs/strings
        (a, b) => a.length === b.length && a.every((item, i) => item.id === b[i].id),
    );

    // Connector instances fetched from backend
    const [connectors, setConnectors] = useState<ConnectorInstance[]>([]);
    const [loadingConnectors, setLoadingConnectors] = useState(false);

    // Catalog tree cache per connector ID
    const [catalogCache, setCatalogCache] = useState<Record<string, CatalogCache>>({});
    const [loadingCatalog, setLoadingCatalog] = useState<Record<string, boolean>>({});

    // Which source sections are expanded (by connector ID)
    const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

    // Tree expanded items per connector
    const [treeExpanded, setTreeExpanded] = useState<Record<string, string[]>>({});

    // Preview popover state
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [previewAnchor, setPreviewAnchor] = useState<HTMLElement | null>(null);
    const [importing, setImporting] = useState(false);

    // Delete connector confirmation
    const [deleteTarget, setDeleteTarget] = useState<ConnectorInstance | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Session hover tooltip cache: sessionId → summary string
    const [sessionTooltips, setSessionTooltips] = useState<Record<string, string>>({});
    const sessionTooltipFetching = useRef<Set<string>>(new Set());

    // Sidebar tab: 'sources' or 'sessions'
    const [activeTab, setActiveTab] = useState<'sources' | 'sessions'>(initialTab);

    // Sync tab when rail icon switches it
    useEffect(() => {
        setActiveTab(initialTab);
    }, [initialTab]);

    // ── Sessions ─────────────────────────────────────────────────────────────

    const [sessions, setSessions] = useState<{id: string, display_name: string, saved_at: string | null}[]>([]);

    useEffect(() => {
        listWorkspaces()
            .then(list => setSessions(list))    
            .catch(() => {});
    }, []);

    const handleHoverSession = useCallback((sessionId: string) => {
        if (sessionTooltips[sessionId] || sessionTooltipFetching.current.has(sessionId)) return;
        sessionTooltipFetching.current.add(sessionId);
        loadWorkspace(sessionId)
            .then(result => {
                if (result && result.state) {
                    const tables = (result.state.tables || []) as any[];
                    const charts = (result.state.charts || []) as any[];
                    const parts: string[] = [];
                    parts.push(t('sidebar.tableCount', { count: tables.length }));
                    if (charts.length > 0) parts.push(t('sidebar.chartCount', { count: charts.length }));
                    if (tables.length > 0) {
                        const names = tables.slice(0, 3).map((t: any) => t.displayId || t.id || 'unknown');
                        if (tables.length > 3) names.push(t('sidebar.andMore', { count: tables.length - 3 }));
                        parts.push(names.join(', '));
                    }
                    setSessionTooltips(prev => ({ ...prev, [sessionId]: parts.join(' · ') }));
                } else {
                    setSessionTooltips(prev => ({ ...prev, [sessionId]: t('sidebar.emptyWorkspace') }));
                }
            })
            .catch(() => {
                setSessionTooltips(prev => ({ ...prev, [sessionId]: t('sidebar.unableToLoadInfo') }));
            })
            .finally(() => sessionTooltipFetching.current.delete(sessionId));
    }, [sessionTooltips]);

    const handleOpenSession = useCallback(async (sessionId: string) => {
        dispatch(dfActions.setSessionLoading({ loading: true, label: t('sidebar.openingWorkspace') }));
        try {
            const result = await loadWorkspace(sessionId);
            if (result && Object.keys(result.state).length > 0) {
                dispatch(dfActions.loadState({ ...result.state, activeWorkspace: { id: sessionId, displayName: result.displayName } }));
            } else {
                dispatch(dfActions.setActiveWorkspace({ id: sessionId, displayName: 'default' }));
            }
        } catch {
            dispatch(dfActions.setActiveWorkspace({ id: sessionId, displayName: 'default' }));
        }
        dispatch(dfActions.setSessionLoading({ loading: false }));
    }, [dispatch]);

    const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await deleteWorkspace(sessionId);
            setSessions(prev => {
                const updated = prev.filter(s => s.id !== sessionId);
                // If we deleted the active session, switch to the next one up the list
                if (activeWorkspace?.id === sessionId) {
                    const deletedIndex = prev.findIndex(s => s.id === sessionId);
                    const nextSession = updated[Math.min(deletedIndex, updated.length - 1)];
                    if (nextSession) {
                        handleOpenSession(nextSession.id);
                    } else {
                        // No sessions left — start fresh
                        const now = new Date();
                        const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
                        const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
                        const short = crypto.randomUUID().slice(0, 4);
                        const wsId = `session_${date}_${time}_${short}`;
                        dispatch(dfActions.loadState({ tables: [], charts: [], draftNodes: [], conceptShelfItems: [], activeWorkspace: { id: wsId, displayName: 'default' } }));
                    }
                }
                return updated;
            });
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: 'data source sidebar',
                value: t('sidebar.sessionDeleted'),
            }));
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'data source sidebar',
                value: t('sidebar.failedDeleteSession'),
            }));
        }
    }, [dispatch, activeWorkspace, handleOpenSession]);

    // ── Connector list ───────────────────────────────────────────────────────

    const fetchConnectors = useCallback(() => {
        setLoadingConnectors(true);
        fetchWithIdentity(CONNECTOR_URLS.LIST, { method: 'GET' })
            .then(r => r.json())
            .then(data => {
                const list: ConnectorInstance[] = data.connectors || [];
                setConnectors(list);
            })
            .catch(() => {})
            .finally(() => setLoadingConnectors(false));
    }, []);

    // Fetch on mount (panel is only mounted when sidebar is open)
    useEffect(() => {
        fetchConnectors();
    }, [fetchConnectors]);

    // Sort connectors by category
    const sortedConnectors = useMemo(
        () => [...connectors].sort((a, b) => connectorSortOrder(a.source_type, b.source_type)),
        [connectors],
    );

    // ── Catalog fetching ─────────────────────────────────────────────────────

    // Guard against concurrent fetches for the same connector
    const fetchingRef = useRef<Set<string>>(new Set());

    const fetchCatalogTree = useCallback(async (connectorId: string) => {
        // Skip if already fetching this connector (prevents race with DBTableManager)
        if (fetchingRef.current.has(connectorId)) return;
        fetchingRef.current.add(connectorId);

        setLoadingCatalog(prev => ({ ...prev, [connectorId]: true }));
        try {
            const resp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.GET_CATALOG_TREE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: connectorId }),
            });
            const data = await resp.json();
            if (data.tree) {
                const tree: CatalogTreeNode[] = data.tree;
                setCatalogCache(prev => ({
                    ...prev,
                    [connectorId]: { tree, fetchedAt: Date.now() },
                }));
                setTreeExpanded(prev => ({
                    ...prev,
                    [connectorId]: collectNamespaceIds(tree),
                }));
            } else if (data.status === 'error') {
                // Connection may have expired — flip to not-connected
                setConnectors(prev => prev.map(c =>
                    c.id === connectorId ? { ...c, connected: false } : c
                ));
            }
        } catch { /* ignore */ }
        setLoadingCatalog(prev => ({ ...prev, [connectorId]: false }));
        fetchingRef.current.delete(connectorId);
    }, []);

    // ── Loaded tables map ────────────────────────────────────────────────────

    // Build a map: table name / path → 'loaded' for already-imported tables
    const loadedTablesMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const t of tableIdentities) {
            map[t.id] = 'loaded';
            if (t.databaseTable) {
                map[t.databaseTable] = 'loaded';
            }
            if (t.originalTableName) {
                map[t.originalTableName] = 'loaded';
            }
        }
        return map;
    }, [tableIdentities]);

    // ── Toggle expand source ─────────────────────────────────────────────────

    const catalogCacheRef = useRef(catalogCache);
    catalogCacheRef.current = catalogCache;

    const toggleSource = useCallback((connectorId: string) => {
        setExpandedSources(prev => {
            const next = new Set(prev);
            if (next.has(connectorId)) {
                next.delete(connectorId);
            } else {
                next.add(connectorId);
                // Fetch tree on first expand
                if (!catalogCacheRef.current[connectorId]) {
                    fetchCatalogTree(connectorId);
                }
            }
            return next;
        });
    }, [fetchCatalogTree]);

    // ── Preview a table on click ──────────────────────────────────────────

    const handlePreviewTable = useCallback((connectorId: string, node: CatalogTreeNode, anchorEl: HTMLElement) => {
        if (node.node_type !== 'table') return;

        const sourceName = node.metadata?._source_name || node.metadata?._catalogName || node.name;

        setPreview({
            connectorId,
            node,
            columns: [],
            sampleRows: [],
            rowCount: node.metadata?.row_count ?? null,
            loading: true,
        });
        setPreviewAnchor(anchorEl);

        fetchWithIdentity(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                connector_id: connectorId,
                source_table: sourceName,
                limit: 5,
            }),
        })
            .then(r => r.json())
            .then(data => {
                if (data.columns && data.rows) {
                    setPreview(prev => prev ? {
                        ...prev,
                        columns: data.columns,
                        sampleRows: data.rows,
                        rowCount: data.total_row_count ?? prev.rowCount,
                        loading: false,
                    } : null);
                } else {
                    setPreview(prev => prev ? { ...prev, loading: false } : null);
                }
            })
            .catch(() => {
                setPreview(prev => prev ? { ...prev, loading: false } : null);
            });
    }, []);

    const closePreview = useCallback(() => {
        setPreview(null);
        setPreviewAnchor(null);
    }, []);

    // ── Import table (from preview "Load" button) ────────────────────────────

    const handleImportTable = useCallback((connectorId: string, node: CatalogTreeNode, newWorkspace?: boolean) => {
        if (node.node_type !== 'table') return;

        const sourceName = node.metadata?._source_name || node.metadata?._catalogName || node.name;
        const pathKey = node.path.join('/');

        // Create a new workspace first if requested
        if (newWorkspace) {
            const now = new Date();
            const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
            const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            const short = crypto.randomUUID().slice(0, 4);
            const wsId = `session_${date}_${time}_${short}`;
            dispatch(dfActions.resetForNewWorkspace({ id: wsId, displayName: node.name }));
        }

        const tableObj: DictTable = {
            kind: 'table' as const,
            id: node.name,
            displayId: node.name,
            names: [],
            metadata: {},
            rows: [],
            virtual: { tableId: node.name, rowCount: node.metadata?.row_count || 0 },
            anchored: true,
            attachedMetadata: '',
            source: {
                type: 'database' as const,
                databaseTable: pathKey,
                canRefresh: true,
                lastRefreshed: Date.now(),
                connectorId,
            },
        };

        setImporting(true);
        dispatch(loadTable({
            table: tableObj,
            connectorId,
            sourceTableName: sourceName,
            importOptions: {},
        })).unwrap()
            .then(() => {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'success',
                    component: 'data source sidebar',
                    value: t('sidebar.loadedTable', { name: sourceName }),
                }));
                closePreview();
            })
            .catch((error) => {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data source sidebar',
                    value: t('sidebar.failedLoadTable', { name: sourceName, error: String(error) }),
                }));
            })
            .finally(() => setImporting(false));
    }, [dispatch, closePreview]);

    // ── Refresh table data ───────────────────────────────────────────────────

    const handleRefreshTable = useCallback((connectorId: string, node: CatalogTreeNode, e: React.MouseEvent) => {
        e.stopPropagation();
        const pathKey = node.path.join('/');
        // Find the loaded table identity matching this node
        const loaded = tableIdentities.find(
            t => t.connectorId === connectorId && (t.databaseTable === pathKey || t.id === node.name)
        );
        if (!loaded) return;

        const sourceName = node.metadata?._source_name || node.metadata?._catalogName || node.name;

        fetchWithIdentity(CONNECTOR_ACTION_URLS.REFRESH_DATA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                connector_id: connectorId,
                table_name: loaded.virtualTableId || loaded.id,
                source_table: sourceName,
            }),
        })
            .then(r => r.json())
            .then(data => {
                if (data.status === 'success') {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'success',
                        component: 'data source sidebar',
                        value: t('sidebar.refreshedTable', { name: sourceName }),
                    }));
                }
            })
            .catch(() => {});
    }, [tableIdentities, dispatch]);

    // ── Delete connector ──────────────────────────────────────────────────

    const handleDeleteConnector = useCallback(async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            const resp = await fetchWithIdentity(CONNECTOR_URLS.DELETE(deleteTarget.id), { method: 'DELETE' });
            const data = await resp.json();
            if (resp.ok || data.status === 'success') {
                setConnectors(prev => prev.filter(c => c.id !== deleteTarget.id));
                setCatalogCache(prev => { const next = { ...prev }; delete next[deleteTarget.id]; return next; });
                setExpandedSources(prev => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
                setTreeExpanded(prev => { const next = { ...prev }; delete next[deleteTarget.id]; return next; });
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'success',
                    component: 'data source sidebar',
                    value: t('sidebar.connectorDeleted', { name: deleteTarget.display_name }),
                }));
            } else {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data source sidebar',
                    value: data.message || t('sidebar.failedDeleteConnector'),
                }));
            }
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'data source sidebar',
                value: t('sidebar.failedDeleteConnector'),
            }));
        } finally {
            setDeleting(false);
            setDeleteTarget(null);
        }
    }, [deleteTarget, dispatch, t]);

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <Box sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: `1px solid ${borderColor.view}`,
            overflow: 'hidden',
        }}>

            {/* ── Data Sources tab ── */}
            {activeTab === 'sources' && (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Box
                    sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.75, borderBottom: `1px solid ${borderColor.view}`, flexShrink: 0 }}
                >
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary', flex: 1 }}>
                        {t('sidebar.dataSources', { defaultValue: 'Data Sources' })}
                    </Typography>
                    <Tooltip title={t('sidebar.collapse', { defaultValue: 'Collapse' })} placement="bottom">
                        <IconButton size="small" onClick={onCollapse} sx={{ p: 0.5, color: 'text.disabled', '&:hover': { color: 'text.secondary' } }}>
                            <ChevronLeftIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>

                {/* ── Load Data section ── */}
                <Typography sx={{ px: 1.5, pt: 1, pb: 0.25, fontSize: 10, color: 'text.secondary', letterSpacing: 0.3, textTransform: 'uppercase' }}>
                    {t('sidebar.loadData', { defaultValue: 'Load data' })}
                </Typography>
                {[
                    { icon: <ExploreOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />, label: t('upload.sampleDatasets', { defaultValue: 'Sample datasets' }), tab: 'explore' },
                    { icon: <UploadFileIcon sx={{ fontSize: 16, color: 'text.secondary' }} />, label: t('upload.uploadFile', { defaultValue: 'Upload file' }), tab: 'upload' },
                    { icon: <ContentPasteOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />, label: t('upload.pasteData', { defaultValue: 'Paste data' }), tab: 'paste' },
                    { icon: <SmartToyOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />, label: t('upload.extractData', { defaultValue: 'Extract data' }), tab: 'extract' },
                    { icon: <LinkOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />, label: t('upload.loadFromUrl', { defaultValue: 'Load from URL' }), tab: 'url' },
                ].map((item, i) => (
                    <Box
                        key={i}
                        onClick={() => onOpenUploadDialog?.(item.tab)}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, cursor: 'pointer', color: 'text.primary', '&:hover': { bgcolor: 'action.hover' }, userSelect: 'none' }}
                    >
                        {item.icon}
                        <Typography noWrap sx={{ fontSize: 12, fontWeight: 500 }}>{item.label}</Typography>
                    </Box>
                ))}

                <Divider />

                {/* ── Data Connectors section ── */}
                <Typography sx={{ px: 1.5, pt: 1, pb: 0.25, fontSize: 10, color: 'text.secondary', letterSpacing: 0.3, textTransform: 'uppercase' }}>
                    {t('sidebar.dataConnectors', { defaultValue: 'Data connectors' })}
                </Typography>

                {loadingConnectors && connectors.length === 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress size={20} />
                    </Box>
                )}

                {sortedConnectors.map((connector) => {
                    const isExpanded = expandedSources.has(connector.id);
                    const cache = catalogCache[connector.id];
                    const isLoading = loadingCatalog[connector.id] ?? false;
                    const expanded = treeExpanded[connector.id] || [];

                    return (
                        <Box key={connector.id}>
                            {/* Source header */}
                            <Box
                                onClick={() => {
                                    if (connector.connected) {
                                        toggleSource(connector.id);
                                    } else {
                                        // Not connected — open config dialog for this connector
                                        onOpenUploadDialog?.(`connector:${connector.id}`);
                                    }
                                }}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.75,
                                    px: 1.5,
                                    py: 0.75,
                                    cursor: 'pointer',
                                    '&:hover': { bgcolor: 'action.hover' },
                                    '&:hover .delete-connector-btn': { visibility: 'visible' },
                                    userSelect: 'none',
                                }}
                            >
                                {connector.connected
                                    ? (isExpanded
                                        ? <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                        : <ChevronRightIcon sx={{ fontSize: 14, color: 'text.disabled' }} />)
                                    : <ChevronRightIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                }
                                {getConnectorIcon(connector.icon || connector.source_type, { sx: { fontSize: 16, opacity: 0.7 } })}
                                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: connector.connected ? 'success.main' : 'warning.main', flexShrink: 0 }} />
                                <Typography noWrap sx={{ fontSize: 12, flex: 1, fontWeight: 500, color: connector.connected ? 'text.primary' : 'text.secondary' }}>
                                    {connector.display_name}
                                </Typography>
                                {connector.connected && (
                                    <Tooltip title={t('sidebar.refreshCatalog', { defaultValue: 'Refresh' })}>
                                        <IconButton
                                            size="small"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                fetchCatalogTree(connector.id);
                                            }}
                                            sx={{ color: 'text.disabled', p: 0.25, visibility: isExpanded ? 'visible' : 'hidden' }}
                                        >
                                            <RefreshIcon sx={{ fontSize: 14 }} />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {connector.deletable && (
                                    <Tooltip title={t('sidebar.deleteConnector', { defaultValue: 'Delete connector' })}>
                                        <IconButton
                                            size="small"
                                            className="delete-connector-btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setDeleteTarget(connector);
                                            }}
                                            sx={{ color: 'text.disabled', p: 0.25, visibility: 'hidden', '&:hover': { color: 'error.main' } }}
                                        >
                                            <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </Box>

                            {/* Catalog tree — only for connected sources */}
                            {connector.connected && (
                            <Collapse in={isExpanded}>
                                <Box sx={{ pl: 1, pr: 0.5, pb: 1 }}>
                                    {!cache && (
                                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                                            <CircularProgress size={16} />
                                        </Box>
                                    )}
                                    {cache && cache.tree.length > 0 && (
                                        <SimpleTreeView
                                            expandedItems={expanded}
                                            onExpandedItemsChange={(_e, items) => {
                                                setTreeExpanded(prev => ({ ...prev, [connector.id]: items }));
                                            }}
                                            onItemClick={(e, itemId) => {
                                                const node = findNodeByPath(cache.tree, itemId);
                                                if (node && node.node_type === 'table') {
                                                    handlePreviewTable(connector.id, node, e.currentTarget as HTMLElement);
                                                }
                                            }}
                                            itemChildrenIndentation={0}
                                            sx={{ px: 0.5 }}
                                        >
                                            {renderCatalogTreeItems(cache.tree, {
                                                loadedMap: loadedTablesMap,
                                                expandedSet: new Set(expanded),
                                                onDragStart: (node, event) => {
                                                    const item: CatalogTableDragItem = {
                                                        type: CATALOG_TABLE_ITEM,
                                                        connectorId: connector.id,
                                                        tableName: node.name,
                                                        tablePath: node.path,
                                                        sourceType: connector.source_type,
                                                    };
                                                    event.dataTransfer.setData('application/json', JSON.stringify(item));
                                                    event.dataTransfer.effectAllowed = 'copy';
                                                },
                                                renderTableActions: (node) => {
                                                    const pathKey = node.path.join('/');
                                                    const isLoaded = loadedTablesMap[node.name] || loadedTablesMap[pathKey];
                                                    if (!isLoaded) return null;
                                                    return (
                                                        <Tooltip title={t('sidebar.refresh', { defaultValue: 'Refresh data' })}>
                                                            <IconButton
                                                                size="small"
                                                                onClick={(e) => handleRefreshTable(connector.id, node, e)}
                                                                sx={{ p: 0, ml: 0.25, color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
                                                            >
                                                                <RefreshIcon sx={{ fontSize: 13 }} />
                                                            </IconButton>
                                                        </Tooltip>
                                                    );
                                                },
                                            })}
                                        </SimpleTreeView>
                                    )}
                                    {cache && cache.tree.length === 0 && !isLoading && (
                                        <Typography sx={{ fontSize: 11, color: 'text.disabled', pl: 1, fontStyle: 'italic' }}>
                                            {t('sidebar.emptyTree', { defaultValue: 'No tables found' })}
                                        </Typography>
                                    )}
                                </Box>
                            </Collapse>
                            )}
                        </Box>
                    );
                })}

                {/* Actions below connectors */}
                <Box
                    onClick={() => onOpenUploadDialog?.()}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        px: 1.5,
                        py: 0.75,
                        cursor: 'pointer',
                        color: 'text.secondary',
                        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                        userSelect: 'none',
                    }}
                >
                    <AddIcon sx={{ fontSize: 16, opacity: 0.7 }} />
                    <Typography noWrap sx={{ fontSize: 12, fontWeight: 500 }}>
                        {t('sidebar.addConnector', { defaultValue: 'Add data connector' })}
                    </Typography>
                </Box>
                <Box
                    onClick={() => onOpenUploadDialog?.('local-folder')}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        px: 1.5,
                        py: 0.75,
                        cursor: 'pointer',
                        color: 'text.secondary',
                        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                        userSelect: 'none',
                    }}
                >
                    <AddIcon sx={{ fontSize: 16, opacity: 0.7 }} />
                    <Typography noWrap sx={{ fontSize: 12, fontWeight: 500 }}>
                        {t('sidebar.linkLocalFolder', { defaultValue: 'Link local folder' })}
                    </Typography>
                </Box>
            </Box>
            </Box>
            )}

            {/* ── Sessions tab ── */}
            {activeTab === 'sessions' && (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Box
                    sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.75, borderBottom: `1px solid ${borderColor.view}`, flexShrink: 0 }}
                >
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'text.primary', flex: 1 }}>
                        {t('sidebar.sessions', { defaultValue: 'Sessions' })}
                    </Typography>
                    <Tooltip title={t('sidebar.collapse', { defaultValue: 'Collapse' })} placement="bottom">
                        <IconButton size="small" onClick={onCollapse} sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'text.secondary' } }}>
                            <ChevronLeftIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
            <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>
                {/* New session action */}
                <Box
                    onClick={() => {
                        const now = new Date();
                        const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
                        const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
                        const short = crypto.randomUUID().slice(0, 4);
                        const wsId = `session_${date}_${time}_${short}`;
                        dispatch(dfActions.loadState({ tables: [], charts: [], draftNodes: [], conceptShelfItems: [], activeWorkspace: { id: wsId, displayName: 'default' } }));
                    }}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        px: 1.5,
                        py: 0.75,
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' },
                        userSelect: 'none',
                    }}
                >
                    <AddIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography noWrap sx={{ fontSize: 12, fontWeight: 500, color: 'text.secondary' }}>
                        {t('sidebar.newSession', { defaultValue: 'New session' })}
                    </Typography>
                </Box>
                {sessions.length === 0 ? (
                    <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
                        <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic' }}>
                            {t('sidebar.noSessions', { defaultValue: 'No saved sessions' })}
                        </Typography>
                    </Box>
                ) : (
                    sessions.map((s) => (
                        <Tooltip
                            key={s.id}
                            title={(() => {
                                const info = sessionTooltips[s.id];
                                const date = s.saved_at ? new Date(s.saved_at).toLocaleDateString() : '';
                                if (activeWorkspace?.id === s.id) return date ? t('sidebar.currentSessionWithDate', { date }) : t('sidebar.currentSession');
                                const base = info || t('sidebar.clickToOpen');
                                return date ? `${base} · ${date}` : base;
                            })()}
                            placement="right"
                            enterDelay={400}
                        >
                        <Box
                            onMouseEnter={() => handleHoverSession(s.id)}
                            onClick={() => { if (activeWorkspace?.id !== s.id) handleOpenSession(s.id); }}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                                px: 1.5,
                                py: 0.5,
                                cursor: activeWorkspace?.id === s.id ? 'default' : 'pointer',
                                '&:hover': { bgcolor: 'action.hover' },
                                '&:hover .delete-btn': { visibility: 'visible' },
                                userSelect: 'none',
                            }}
                        >
                            {activeWorkspace?.id === s.id && (
                                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />
                            )}
                            <Typography noWrap sx={{
                                fontSize: 12, flex: 1, fontWeight: 500,
                                color: activeWorkspace?.id === s.id ? 'primary.main' : 'text.primary',
                            }}>
                                {s.display_name}
                            </Typography>
                            <IconButton
                                className="delete-btn"
                                size="small"
                                onClick={(e) => handleDeleteSession(s.id, e)}
                                sx={{ p: 0.25, visibility: 'hidden', color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                            >
                                <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                        </Box>
                        </Tooltip>
                    ))
                )}
            </Box>
            </Box>
            )}

            {/* Preview popover */}
            <Popover
                open={Boolean(previewAnchor && preview)}
                anchorEl={previewAnchor}
                onClose={closePreview}
                anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
                transformOrigin={{ vertical: 'center', horizontal: 'left' }}
                slotProps={{
                    paper: {
                        sx: { width: 480, maxHeight: 520, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
                    },
                }}
            >
                {preview && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                        {/* Header */}
                        <Box sx={{ px: 2, pt: 1.5, pb: 1, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{preview.node.name}</Typography>
                            {preview.rowCount != null && (
                                <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                                    {t('sidebar.previewRowCount', { count: Number(preview.rowCount).toLocaleString() })}
                                </Typography>
                            )}
                        </Box>

                        {/* Content */}
                        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1 }}>
                            {preview.loading ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                                    <CircularProgress size={20} />
                                </Box>
                            ) : (
                                <>
                                    {preview.columns.length > 0 && preview.sampleRows.length > 0 ? (
                                        <DataFrameTable
                                            columns={preview.columns.map(c => c.name)}
                                            rows={preview.sampleRows}
                                            totalRows={preview.rowCount ?? undefined}
                                            maxColumns={6}
                                            maxRows={5}
                                            fontSize={11}
                                            headerFontSize={10}
                                        />
                                    ) : preview.columns.length > 0 ? (
                                        <Box sx={{ mb: 1.5 }}>
                                            <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.5 }}>
                                                {t('sidebar.previewColumnsHeader', { count: preview.columns.length })}
                                            </Typography>
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                {preview.columns.map((col, i) => (
                                                    <Box key={i} sx={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 0.5,
                                                        px: 0.75, py: 0.25, borderRadius: 0.5,
                                                        bgcolor: 'action.hover', fontSize: 11,
                                                    }}>
                                                        <span style={{ fontWeight: 500 }}>{col.name}</span>
                                                        <span style={{ color: 'gray', fontSize: 10 }}>{col.type}</span>
                                                    </Box>
                                                ))}
                                            </Box>
                                        </Box>
                                    ) : (
                                        <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic', py: 2, textAlign: 'center' }}>
                                            {t('sidebar.noPreviewAvailable')}
                                        </Typography>
                                    )}
                                </>
                            )}
                        </Box>

                        {/* Footer — Load button */}
                        {(() => {
                            const pathKey = preview.node.path.join('/');
                            const alreadyLoaded = loadedTablesMap[preview.node.name] || loadedTablesMap[pathKey];
                            return (
                                <Box sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                                    {alreadyLoaded ? (
                                        <Button size="small" disabled variant="outlined"
                                            sx={{ textTransform: 'none', fontSize: 12 }}>
                                            {t('sidebar.alreadyLoaded')}
                                        </Button>
                                    ) : (
                                        <>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            disabled={importing || preview.loading}
                                            onClick={() => handleImportTable(preview.connectorId, preview.node, true)}
                                            sx={{ textTransform: 'none', fontSize: 12 }}
                                        >
                                            {t('sidebar.loadInNewWorkspace')}
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="contained"
                                            disabled={importing || preview.loading}
                                            onClick={() => handleImportTable(preview.connectorId, preview.node)}
                                            sx={{ textTransform: 'none', fontSize: 12 }}
                                        >
                                            {importing ? t('sidebar.loadingEllipsis') : t('sidebar.load')}
                                        </Button>
                                        </>
                                    )}
                                </Box>
                            );
                        })()}
                    </Box>
                )}
            </Popover>

            {/* Delete connector confirmation dialog */}
            <Dialog
                open={!!deleteTarget}
                onClose={() => { if (!deleting) setDeleteTarget(null); }}
            >
                <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>
                    {t('sidebar.deleteConnectorTitle', { defaultValue: 'Delete connector' })}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ fontSize: 13 }}>
                        {t('sidebar.deleteConnectorConfirm', {
                            name: deleteTarget?.display_name,
                            defaultValue: `Are you sure you want to delete "{{name}}"? Imported data will not be affected.`,
                        })}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDeleteTarget(null)}
                        disabled={deleting}
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {t('app.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        onClick={handleDeleteConnector}
                        disabled={deleting}
                        color="error"
                        variant="contained"
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {deleting
                            ? t('sidebar.deletingEllipsis', { defaultValue: 'Deleting...' })
                            : t('sidebar.deleteConfirmBtn', { defaultValue: 'Delete' })}
                    </Button>
                </DialogActions>
            </Dialog>

        </Box>
    );
};
