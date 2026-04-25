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
    TextField,
    InputAdornment,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import { generateUUID } from '../app/identity';
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
import LinkOffIcon from '@mui/icons-material/LinkOff';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';

import HistoryIcon from '@mui/icons-material/History';

import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { fetchWithIdentity, CONNECTOR_URLS, CONNECTOR_ACTION_URLS, SourceTableRef } from '../app/utils';
import { getConnectorIcon, connectorSortOrder, DatabaseIcon } from '../icons';
import { loadTable, buildDictTableFromWorkspace } from '../app/tableThunks';
import { listWorkspaces, loadWorkspace, deleteWorkspace } from '../app/workspaceService';
import { borderColor } from '../app/tokens';

import type { ConnectorInstance, DictTable } from '../components/ComponentType';
import { ConnectorTablePreview } from '../components/ConnectorTablePreview';
import type { ColumnMeta } from '../components/ConnectorTablePreview';
import {
    appendChildrenAtPath,
    CatalogTreeNode,
    collectNamespaceIds,
    findNodeByPath,
    mergeChildrenAtPath,
    renderCatalogTreeItems,
} from '../components/CatalogTree';
import { CATALOG_TABLE_ITEM } from '../components/DndTypes';
import type { CatalogTableDragItem } from '../components/DndTypes';

// ─── Constants ───────────────────────────────────────────────────────────────

const RAIL_WIDTH = 40;
const PANEL_WIDTH = 260;
const CATALOG_PAGE_SIZE = 200;

function makeLoadMoreNode(parentPath: string[], nextOffset: number): CatalogTreeNode {
    return {
        name: 'Load more…',
        node_type: 'load_more',
        path: [...parentPath, `__load_more_${nextOffset}`],
        metadata: { parentPath, nextOffset },
    };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface CatalogCache {
    tree: CatalogTreeNode[];
    fetchedAt: number;
}

interface PreviewState {
    connectorId: string;
    node: CatalogTreeNode;
    columns: ColumnMeta[];
    sampleRows: Record<string, any>[];
    rowCount: number | null;
    loading: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

// ─── Outer wrapper — ultra-lightweight, only reads isOpen ────────────────────

export const DataSourceSidebar: React.FC<{
    onOpenUploadDialog?: (tab?: string) => void;
    connectorRefreshKey?: number;
}> = ({ onOpenUploadDialog, connectorRefreshKey = 0 }) => {
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
                <DataSourceSidebarPanel
                    onOpenUploadDialog={onOpenUploadDialog}
                    onCollapse={toggle}
                    initialTab={initialTab}
                    connectorRefreshKey={connectorRefreshKey}
                />
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
    connectorRefreshKey?: number;
}> = ({ onOpenUploadDialog, onCollapse, initialTab = 'sources', connectorRefreshKey = 0 }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const identityKey = useSelector(
        (state: DataFormulatorState) => `${state.identity.type}:${state.identity.id}`,
    );

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
    const sidebarRowLimitPresets = useMemo(() => [20_000, 50_000, 100_000, 200_000, 300_000, 500_000], []);

    // Delete connector confirmation
    const [deleteTarget, setDeleteTarget] = useState<ConnectorInstance | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [disconnectingConnectorId, setDisconnectingConnectorId] = useState<string | null>(null);

    // Catalog search (pure frontend filtering)
    const [catalogSearch, setCatalogSearch] = useState('');

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
            .catch(() => { /* session list is best-effort */ });
    }, [identityKey]);

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
                dispatch(dfActions.setActiveWorkspace({ id: sessionId, displayName: 'Untitled Session' }));
            }
        } catch {
            dispatch(dfActions.setActiveWorkspace({ id: sessionId, displayName: 'Untitled Session' }));
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
                        const short = generateUUID().slice(0, 4);
                        const wsId = `session_${date}_${time}_${short}`;
                        dispatch(dfActions.loadState({ tables: [], charts: [], draftNodes: [], conceptShelfItems: [], activeWorkspace: { id: wsId, displayName: 'Untitled Session' } }));
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
            .catch(() => { /* connector list is best-effort */ })
            .finally(() => setLoadingConnectors(false));
    }, []);

    // Fetch on mount and whenever identity changes.
    useEffect(() => {
        setConnectors([]);
        setCatalogCache({});
        setLoadingCatalog({});
        setExpandedSources(new Set());
        setTreeExpanded({});
        setPreview(null);
        setPreviewAnchor(null);
        fetchConnectors();
    }, [fetchConnectors, identityKey, connectorRefreshKey]);

    // Sort connectors by category
    const sortedConnectors = useMemo(
        () => [...connectors].sort((a, b) => connectorSortOrder(a.source_type, b.source_type)),
        [connectors],
    );

    // ── Catalog fetching ─────────────────────────────────────────────────────

    // Guard against concurrent fetches for the same connector
    const fetchingRef = useRef<Set<string>>(new Set());

    const fetchCatalogNodes = useCallback(async (
        connectorId: string,
        path: string[] = [],
        options: { append?: boolean; offset?: number; filter?: string } = {},
    ) => {
        const offset = options.offset ?? 0;
        const filter = options.filter?.trim() || null;
        const fetchKey = `${connectorId}:${path.join('/')}:${offset}:${filter || ''}`;
        if (fetchingRef.current.has(fetchKey)) return;
        fetchingRef.current.add(fetchKey);

        setLoadingCatalog(prev => ({ ...prev, [connectorId]: true }));
        try {
            const resp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.GET_CATALOG, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: connectorId, path, filter, limit: CATALOG_PAGE_SIZE, offset }),
            });
            const data = await resp.json();
            if (data.nodes) {
                const nodes: CatalogTreeNode[] = (data.nodes as CatalogTreeNode[]).map(n => ({
                    ...n,
                    children: n.node_type === 'namespace' ? undefined : n.children,
                }));
                const pageNodes = data.has_more && data.next_offset != null
                    ? [...nodes, makeLoadMoreNode(path, Number(data.next_offset))]
                    : nodes;
                setCatalogCache(prev => {
                    const existing = prev[connectorId]?.tree || [];
                    const merged = path.length === 0
                        ? (options.append ? [...existing.filter(n => n.node_type !== 'load_more'), ...pageNodes] : pageNodes)
                        : (options.append
                            ? appendChildrenAtPath(existing, path, pageNodes)
                            : mergeChildrenAtPath(existing, path, pageNodes));
                    return {
                        ...prev,
                        [connectorId]: { tree: merged, fetchedAt: Date.now() },
                    };
                });
                if (path.length === 0) {
                    setTreeExpanded(prev => ({
                        ...prev,
                        [connectorId]: [],
                    }));
                }
            } else if (data.status === 'error') {
                setConnectors(prev => prev.map(c =>
                    c.id === connectorId ? { ...c, connected: false } : c
                ));
            }
        } catch { /* catalog fetch is best-effort; connector remains usable */ }
        setLoadingCatalog(prev => ({ ...prev, [connectorId]: false }));
        fetchingRef.current.delete(fetchKey);
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

    // ── Filtered catalog trees (frontend search) ───────────────────────────
    const filterTree = useCallback((nodes: CatalogTreeNode[], query: string): CatalogTreeNode[] => {
        const q = query.toLowerCase();
        const result: CatalogTreeNode[] = [];
        for (const node of nodes) {
            if (node.node_type === 'load_more') {
                result.push(node);
            } else if (node.node_type === 'table') {
                if (node.name.toLowerCase().includes(q)) {
                    result.push(node);
                }
            } else {
                const filteredChildren = node.children ? filterTree(node.children, query) : [];
                if (filteredChildren.length > 0) {
                    result.push({ ...node, children: filteredChildren });
                }
            }
        }
        return result;
    }, []);

    const filteredCatalogCache = useMemo(() => {
        if (!catalogSearch.trim()) return catalogCache;
        const filtered: Record<string, CatalogCache> = {};
        for (const [connId, cache] of Object.entries(catalogCache)) {
            const tree = filterTree(cache.tree, catalogSearch.trim());
            if (tree.length > 0) {
                filtered[connId] = { ...cache, tree };
            }
        }
        return filtered;
    }, [catalogCache, catalogSearch, filterTree]);

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
                // Fetch root catalog on first expand
                if (!catalogCacheRef.current[connectorId]) {
                    fetchCatalogNodes(connectorId);
                }
            }
            return next;
        });
    }, [fetchCatalogNodes]);

    // ── Preview a table on click ──────────────────────────────────────────

    const buildSourceTableRef = useCallback((node: CatalogTreeNode): SourceTableRef => {
        const name = node.metadata?._source_name || node.metadata?._catalogName || node.name;
        const id = node.metadata?.dataset_id != null ? String(node.metadata.dataset_id) : name;
        return { id, name };
    }, []);

    const handlePreviewTable = useCallback((connectorId: string, node: CatalogTreeNode, anchorEl: HTMLElement) => {
        if (node.node_type !== 'table') return;

        const ref = buildSourceTableRef(node);

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
                source_table: ref,
                limit: 10,
            }),
        })
            .then(r => r.json())
            .then(data => {
                if (data.columns) {
                    setPreview(prev => {
                        if (!prev) return null;
                        const newCols = (data.columns as typeof prev.columns);
                        return {
                            ...prev,
                            columns: newCols.length > 0 ? newCols : prev.columns,
                            sampleRows: data.rows || [],
                            rowCount: data.total_row_count ?? prev.rowCount,
                            loading: false,
                        };
                    });
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

    const handleImportTable = useCallback((connectorId: string, node: CatalogTreeNode, importOptions?: Record<string, any>) => {
        if (node.node_type !== 'table') return;

        const ref = buildSourceTableRef(node);
        const pathKey = node.path.join('/');

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
            sourceTableRef: ref,
            importOptions: importOptions || {},
        })).unwrap()
            .then(() => {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'success',
                    component: 'data source sidebar',
                    value: t('sidebar.loadedTable', { name: ref.name }),
                }));
                closePreview();
            })
            .catch((error) => {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data source sidebar',
                    value: t('sidebar.failedLoadTable', { name: ref.name, error: String(error) }),
                }));
            })
            .finally(() => setImporting(false));
    }, [dispatch, closePreview, buildSourceTableRef]);

    // ── Refresh table data ───────────────────────────────────────────────────

    const handleRefreshTable = useCallback((connectorId: string, node: CatalogTreeNode, e: React.MouseEvent) => {
        e.stopPropagation();
        const pathKey = node.path.join('/');
        const sourceName = node.metadata?._source_name;
        const loaded = tableIdentities.find(
            t => t.connectorId === connectorId && (
                t.databaseTable === pathKey || t.id === node.name ||
                (sourceName && (t.databaseTable === sourceName || t.id === sourceName))
            )
        );
        if (!loaded) return;

        const ref = buildSourceTableRef(node);

        fetchWithIdentity(CONNECTOR_ACTION_URLS.REFRESH_DATA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                connector_id: connectorId,
                table_name: loaded.virtualTableId || loaded.id,
                source_table: ref,
            }),
        })
            .then(r => r.json())
            .then(data => {
                if (data.status === 'success') {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'success',
                        component: 'data source sidebar',
                        value: t('sidebar.refreshedTable', { name: ref.name }),
                    }));
                }
            })
            .catch(() => {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(), type: 'error',
                    component: 'data source sidebar', value: 'Failed to refresh table data',
                }));
            });
    }, [tableIdentities, dispatch, buildSourceTableRef]);

    const clearConnectorUiState = useCallback((connectorId: string) => {
        setCatalogCache(prev => { const next = { ...prev }; delete next[connectorId]; return next; });
        setExpandedSources(prev => { const next = new Set(prev); next.delete(connectorId); return next; });
        setTreeExpanded(prev => { const next = { ...prev }; delete next[connectorId]; return next; });
        if (preview?.connectorId === connectorId) {
            closePreview();
        }
    }, [closePreview, preview?.connectorId]);

    // ── Delete connector ──────────────────────────────────────────────────

    const handleDeleteConnector = useCallback(async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            const resp = await fetchWithIdentity(CONNECTOR_URLS.DELETE(deleteTarget.id), { method: 'DELETE' });
            const data = await resp.json();
            if (resp.ok || data.status === 'success') {
                setConnectors(prev => prev.filter(c => c.id !== deleteTarget.id));
                clearConnectorUiState(deleteTarget.id);
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
    }, [clearConnectorUiState, deleteTarget, dispatch, t]);

    const handleDisconnectConnector = useCallback(async (
        connector: ConnectorInstance,
        e: React.MouseEvent,
    ) => {
        e.stopPropagation();
        setDisconnectingConnectorId(connector.id);
        try {
            const resp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.DISCONNECT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: connector.id }),
            });
            const data = await resp.json();
            if (resp.ok && data.status === 'disconnected') {
                setConnectors(prev => prev.map(c => (
                    c.id === connector.id
                        ? { ...c, connected: false, sso_auto_connect: false }
                        : c
                )));
                clearConnectorUiState(connector.id);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'success',
                    component: 'data source sidebar',
                    value: t('sidebar.connectorDisconnected', { name: connector.display_name }),
                }));
            } else {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'error',
                    component: 'data source sidebar',
                    value: data.message || t('sidebar.failedDisconnectConnector'),
                }));
            }
        } catch {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'data source sidebar',
                value: t('sidebar.failedDisconnectConnector'),
            }));
        } finally {
            setDisconnectingConnectorId(null);
        }
    }, [clearConnectorUiState, dispatch, t]);

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

                {/* Search box for filtering catalog tables */}
                <Box sx={{ px: 1.5, pt: 0.5, pb: 0.5 }}>
                    <TextField
                        size="small"
                        fullWidth
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                        placeholder={t('sidebar.searchTables', { defaultValue: 'Search tables...' })}
                        slotProps={{
                            input: {
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                                    </InputAdornment>
                                ),
                                endAdornment: catalogSearch ? (
                                    <InputAdornment position="end">
                                        <IconButton size="small" onClick={() => setCatalogSearch('')} sx={{ p: 0.25 }}>
                                            <ClearIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                        </IconButton>
                                    </InputAdornment>
                                ) : null,
                            },
                        }}
                        sx={{
                            '& .MuiInputBase-root': { fontSize: 12, height: 30, borderRadius: 1 },
                            '& .MuiInputBase-input': { py: 0.5, px: 0.5 },
                            '& .MuiInputBase-input::placeholder': { fontSize: 11 },
                        }}
                    />
                </Box>

                {loadingConnectors && connectors.length === 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress size={20} />
                    </Box>
                )}

                {sortedConnectors
                    .filter((connector) => {
                        if (!catalogSearch.trim()) return true;
                        const cache = catalogCache[connector.id];
                        if (!cache) return true; // not yet loaded — keep visible
                        const filtered = filteredCatalogCache[connector.id];
                        return filtered && filtered.tree.length > 0;
                    })
                    .map((connector) => {
                    const isSearching = !!catalogSearch.trim();
                    const displayCache = isSearching ? filteredCatalogCache[connector.id] : catalogCache[connector.id];
                    const isExpanded = isSearching
                        ? (!!displayCache && displayCache.tree.length > 0)
                        : expandedSources.has(connector.id);
                    const isLoading = loadingCatalog[connector.id] ?? false;
                    const expanded = isSearching
                        ? collectNamespaceIds(displayCache?.tree || [])
                        : (treeExpanded[connector.id] || []);

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
                                    '&:hover .disconnect-connector-btn': { visibility: 'visible' },
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
                                                fetchCatalogNodes(connector.id);
                                            }}
                                            sx={{ color: 'text.disabled', p: 0.25, visibility: isExpanded ? 'visible' : 'hidden' }}
                                        >
                                            <RefreshIcon sx={{ fontSize: 14 }} />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {connector.connected && (
                                    <Tooltip title={t('sidebar.disconnectConnector', { defaultValue: 'Disconnect connector' })}>
                                        <IconButton
                                            size="small"
                                            className="disconnect-connector-btn"
                                            disabled={disconnectingConnectorId === connector.id}
                                            onClick={(e) => handleDisconnectConnector(connector, e)}
                                            sx={{
                                                color: 'text.disabled',
                                                p: 0.25,
                                                visibility: isExpanded ? 'visible' : 'hidden',
                                                '&:hover': { color: 'warning.main' },
                                            }}
                                        >
                                            {disconnectingConnectorId === connector.id
                                                ? <CircularProgress size={12} />
                                                : <LinkOffIcon sx={{ fontSize: 14 }} />}
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
                                    {!displayCache && (
                                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                                            <CircularProgress size={16} />
                                        </Box>
                                    )}
                                    {displayCache && displayCache.tree.length > 0 && (
                                        <SimpleTreeView
                                            expandedItems={expanded}
                                            onExpandedItemsChange={(_e, items) => {
                                                if (!isSearching) {
                                                    const prevSet = new Set(expanded);
                                                    const newlyExpanded = items.filter(id => !prevSet.has(id));
                                                    setTreeExpanded(prev => ({ ...prev, [connector.id]: items }));
                                                    const fullCache = catalogCache[connector.id];
                                                    for (const itemId of newlyExpanded) {
                                                        const node = fullCache ? findNodeByPath(fullCache.tree, itemId) : null;
                                                        if (node && (node.node_type === 'namespace' || node.node_type === 'table_group') && !node.children) {
                                                            fetchCatalogNodes(connector.id, node.path, { filter: catalogSearch });
                                                        }
                                                    }
                                                }
                                            }}
                                            onItemClick={(e, itemId) => {
                                                const fullCache = catalogCache[connector.id];
                                                const node = fullCache ? findNodeByPath(fullCache.tree, itemId) : null;
                                                if (node && node.node_type === 'table') {
                                                    handlePreviewTable(connector.id, node, e.currentTarget as HTMLElement);
                                                }
                                            }}
                                            itemChildrenIndentation={0}
                                            sx={{ px: 0.5 }}
                                        >
                                            {renderCatalogTreeItems(displayCache.tree, {
                                                loadedMap: loadedTablesMap,
                                                expandedSet: new Set(expanded),
                                                onLoadMore: (node) => {
                                                    const parentPath = (node.metadata?.parentPath || []) as string[];
                                                    const nextOffset = Number(node.metadata?.nextOffset || 0);
                                                    fetchCatalogNodes(connector.id, parentPath, { append: true, offset: nextOffset, filter: catalogSearch });
                                                },
                                                onDragStart: (node, event) => {
                                                    const dsId = node.metadata?.dataset_id;
                                                    const sourceName = node.metadata?._source_name || node.name;
                                                    const item: CatalogTableDragItem = {
                                                        type: CATALOG_TABLE_ITEM,
                                                        connectorId: connector.id,
                                                        tableName: sourceName,
                                                        tableId: dsId != null ? String(dsId) : sourceName,
                                                        tablePath: node.path,
                                                        sourceType: connector.source_type,
                                                    };
                                                    event.dataTransfer.setData('application/json', JSON.stringify(item));
                                                    event.dataTransfer.effectAllowed = 'copy';
                                                },
                                                renderTableActions: (node) => {
                                                    const pathKey = node.path.join('/');
                                                    const sourceName = node.metadata?._source_name;
                                                    const isLoaded = loadedTablesMap[node.name] || loadedTablesMap[pathKey] || (sourceName && loadedTablesMap[sourceName]);
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
                                    {displayCache && displayCache.tree.length === 0 && !isLoading && (
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
                        const short = generateUUID().slice(0, 4);
                        const wsId = `session_${date}_${time}_${short}`;
                        dispatch(dfActions.loadState({ tables: [], charts: [], draftNodes: [], conceptShelfItems: [], activeWorkspace: { id: wsId, displayName: 'Untitled Session' } }));
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
                        sx: {
                            width: '66vw', maxWidth: '92vw', minWidth: 400, minHeight: 300, maxHeight: '85vh',
                            display: 'flex', flexDirection: 'column', overflow: 'hidden',
                            resize: 'both',
                        },
                    },
                }}
            >
                {preview && (() => {
                    const pathKey = preview.node.path.join('/');
                    const alreadyLoaded = !!(loadedTablesMap[preview.node.name] || loadedTablesMap[pathKey]);
                    const sourceTableRef = buildSourceTableRef(preview.node);
                    return (
                        <Box sx={{ p: 2, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
                            <ConnectorTablePreview
                                connectorId={preview.connectorId}
                                sourceTable={sourceTableRef}
                                displayName={preview.node.name}
                                columns={preview.columns}
                                sampleRows={preview.sampleRows}
                                rowCount={preview.rowCount}
                                loading={preview.loading || importing}
                                rowLimitPresets={sidebarRowLimitPresets}
                                defaultRowLimit={50_000}
                                alreadyLoaded={alreadyLoaded}
                                enableFilters
                                enableSort
                                onLoad={(opts) => handleImportTable(preview.connectorId, preview.node, opts)}
                                onRefreshPreview={(rows, cols, rc) => {
                                    setPreview(prev => {
                                        if (!prev) return null;
                                        return {
                                            ...prev,
                                            sampleRows: rows,
                                            columns: cols.length > 0 ? cols : prev.columns,
                                            rowCount: rc ?? prev.rowCount,
                                        };
                                    });
                                }}
                            />
                        </Box>
                    );
                })()}
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
