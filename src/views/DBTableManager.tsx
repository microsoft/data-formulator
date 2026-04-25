// TableManager.tsx
import React, { useState, useEffect, useCallback, FC, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Card, 
  Typography, 
  Button, 
  Box,
  IconButton,
  TextField,
  Divider,
  CircularProgress,
  MenuItem,
  Checkbox,
  FormControlLabel,
  useTheme,
  Tooltip,
  Tabs,
  Tab,
} from '@mui/material';

import SearchIcon from '@mui/icons-material/Search';


import { getUrls, CONNECTOR_ACTION_URLS, fetchWithIdentity, SourceTableRef } from '../app/utils';
import { borderColor } from '../app/tokens';
import { CustomReactTable } from './ReactTable';
import { DataFrameTable } from './DataFrameTable';
import { ConnectorTablePreview } from '../components/ConnectorTablePreview';
import { DictTable } from '../components/ComponentType';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { DataFormulatorState } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { loadTable, buildDictTableFromWorkspace } from '../app/tableThunks';
import { AppDispatch } from '../app/store';
import Markdown from 'markdown-to-jsx';

import CheckIcon from '@mui/icons-material/Check';

import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { TableIcon } from '../icons';
import { RowLimitUnderlineSelect } from '../components/RowLimitUnderlineSelect';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';

import {
    CatalogTreeNode,
    collectNamespaceIds,
    findNodeByPath,
    StyledTreeItem,
    countBadgeSx,
    renderCatalogTreeItems,
} from '../components/CatalogTree';


export const handleDBDownload = async (identityId: string) => {
    const response = await fetchWithIdentity(
        getUrls().DOWNLOAD_DB_FILE,
        { method: 'GET' }
    );
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'Failed to download database file');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `df_${identityId?.slice(0, 4) || 'db'}.db`;
    document.body.appendChild(link);    
    
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

interface DBTable {
    name: string;
    columns: {
        name: string;
        type: string;
    }[];
    row_count: number;
    sample_rows: any[];
    view_source: string | null;
    // Source metadata for refreshable tables (from data loaders)
    // Backend stores connection info; frontend manages refresh timing
    source_metadata?: {
        table_name: string;
        data_loader_type: string;
        data_loader_params: Record<string, any>;
        source_table_name?: string;
        source_query?: string;
        last_refreshed?: string;
    } | null;
}



export const DBManagerPane: React.FC<{ 
    onClose?: () => void;
}> = function DBManagerPane({ onClose }) {
    const { t } = useTranslation();
    const theme = useTheme();

    const dispatch = useDispatch<AppDispatch>();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

    // Disabled data sources (missing deps) from app-config
    const disabledSources = serverConfig.DISABLED_SOURCES ?? {};

    // Sources with vault credentials or active in-memory loaders
    const [connectedIds, setConnectedIds] = useState<Set<string>>(
        new Set(serverConfig.CONNECTED_CONNECTORS ?? [])
    );

    // Split sources into connected vs available
    const allSources = serverConfig.CONNECTORS ?? [];
    const connectedSources = allSources.filter(s => connectedIds.has(s.source_id));
    const availableSources = allSources.filter(s => !connectedIds.has(s.source_id));

    const [dbTables, setDbTables] = useState<DBTable[]>([]);
    const [selectedTabKey, setSelectedTabKey] = useState("");
    const [selectedDataLoader, setSelectedDataLoader] = useState<string>("");

    const [isUploading, setIsUploading] = useState<boolean>(false);

    let setSystemMessage = (content: string, severity: "error" | "warning" | "info" | "success") => {
        dispatch(dfActions.addMessages({
            "timestamp": Date.now(),
            "component": "DB manager",
            "type": severity,
            "value": content
        }));
    }

    useEffect(() => {
        if (selectedDataLoader === "") {
            if (dbTables.length == 0) {
                setSelectedTabKey("");
            } else if (dbTables.find(t => t.name === selectedTabKey) == undefined) {
                setSelectedTabKey(dbTables[0]?.name || "");
            }
        }
    }, [dbTables, selectedDataLoader]);

    // Fetch list of tables
    const fetchTables = async (): Promise<DBTable[] | undefined> => {
        // In ephemeral mode, tables live in Redux, not on the server
        if (serverConfig.WORKSPACE_BACKEND === 'ephemeral') {
            const localTables: DBTable[] = tables.map(t => ({
                name: t.id,
                columns: t.names.map(n => ({ name: n, type: String(t.metadata?.[n]?.type || 'unknown') })),
                row_count: t.rows.length,
                sample_rows: t.rows.slice(0, 100),
                view_source: null,
            }));
            setDbTables(localTables);
            return localTables;
        }
        try {
            const response = await fetchWithIdentity(getUrls().LIST_TABLES, { method: 'GET' });
            const data = await response.json();
            if (data.status === 'success') {
                setDbTables(data.tables);
                return data.tables;
            }
        } catch (error) {
            setSystemMessage(t('db.failedFetchTables'), "error");
        }
        return undefined;
    };

    useEffect(() => {
        fetchTables();
    }, []);

    const sourceButtonSx = (sourceId: string) => ({
        fontSize: 12,
        textTransform: "none" as const,
        width: '100%',
        justifyContent: 'flex-start',
        textAlign: 'left' as const,
        borderRadius: 0,
        py: 1,
        px: 2,
        color: selectedDataLoader === sourceId ? 'primary.main' : 'text.secondary',
        borderRight: selectedDataLoader === sourceId ? 2 : 0,
        borderColor: 'primary.main',
    });

    let tableSelectionPanel = <Box sx={{ 
        pt: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        width: '100%',
    }}>
        {/* Connected sources — user has stored or active credentials */}
        {connectedSources.length > 0 && (
            <Typography variant="caption" sx={{ px: 2, pt: 0.5, pb: 0.5, color: 'text.disabled', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('db.connectedSection')}
            </Typography>
        )}
        {connectedSources.map((source) => (
            <Button
                key={`source-${source.source_id}`}
                variant="text"
                size="small"
                color="primary"
                onClick={() => setSelectedDataLoader(source.source_id)}
                sx={sourceButtonSx(source.source_id)}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%' }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.name}</span>
                </Box>
            </Button>
        ))}

        {/* Available sources — registered but no credentials */}
        {availableSources.length > 0 && (
            <Typography variant="caption" sx={{ px: 2, pt: 1, pb: 0.5, color: 'text.disabled', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('db.availableSection')}
            </Typography>
        )}
        {availableSources.map((source) => (
            <Button
                key={`source-${source.source_id}`}
                variant="text"
                size="small"
                color="primary"
                onClick={() => setSelectedDataLoader(source.source_id)}
                sx={sourceButtonSx(source.source_id)}
            >
                {source.name}
            </Button>
        ))}

        {/* Disabled sources (missing deps) — greyed out with install hint */}
        {Object.keys(disabledSources).length > 0 && (
            <Divider sx={{ my: 0.5 }} />
        )}
        {Object.entries(disabledSources).map(([sourceName, { install_hint }]) => (
            <Tooltip
                key={`disabled-${sourceName}`}
                title={t('db.notInstalledHint', { hint: install_hint })}
                placement="right"
                arrow
            >
                <span style={{ width: '100%' }}>
                <Button
                    variant="text"
                    size="small"
                    disabled
                    sx={{
                        fontSize: 12,
                        textTransform: "none",
                        width: '100%',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        borderRadius: 0,
                        py: 1,
                        px: 2,
                        color: 'text.disabled !important',
                        cursor: 'default',
                        userSelect: 'none',
                        minWidth: 0,
                        '&.Mui-disabled': {
                            color: 'text.disabled',
                        },
                    }}
                >
                    {sourceName}
                </Button>
                </span>
            </Tooltip>
        ))}
    </Box>

    let dataConnectorView = <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', overflowX: 'hidden', p: 2, pb: 4, display: 'flex', flexDirection: 'column', minWidth: 0, overscrollBehavior: 'contain' }}>

        {/* Empty state when no source selected */}
        {selectedDataLoader === '' && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'text.disabled' }}>
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                    {t('db.selectDataLoader')}
                </Typography>
            </Box>
        )}

        {/* Data source forms (connected + available) */}
        {allSources.map((source) => (
            selectedDataLoader === source.source_id && (
                <Box key={`source:${source.source_id}`} sx={{ position: "relative", maxWidth: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <DataLoaderForm 
                        key={`source-form-${source.source_id}`}
                        dataLoaderType={source.source_id}
                        loaderType={source.icon}
                        paramDefs={source.params_form}
                        authInstructions={source.auth_instructions}
                        connectorId={source.source_id}
                        autoConnect={connectedIds.has(source.source_id)}
                        delegatedLogin={source.delegated_login}
                        authMode={source.auth_mode}
                        onImport={() => {
                            setIsUploading(true);
                        }} 
                        onFinish={(status, message, importedTables) => {
                            setIsUploading(false);
                            if (status === "success") {
                                setSystemMessage(message, "success");
                            } else {
                                setSystemMessage(message, "error");
                            }
                        }}
                        onConnected={() => {
                            setConnectedIds(prev => new Set([...prev, source.source_id]));
                        }}
                    />
                </Box>
            )
        ))}
    </Box>;

    let mainContent =  
        <Box sx={{ display: 'flex', flexDirection: 'column', bgcolor: 'white', flex: 1, overflow: 'hidden', height: '100%' }}>
            <Box sx={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden', minHeight: 0, height: '100%' }}>
                {/* Button navigation - similar to TableSelectionView */}
                <Box sx={{ display: 'flex', flexDirection: 'column', px: 0, width: 150, minWidth: 150, maxWidth: 150, overflow: 'hidden', height: '100%' }}>
                    <Box sx={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        flex: 1,
                        minHeight: 0,
                        height: '100%',
                        position: 'relative',
                        borderRight: `1px solid ${borderColor.view}`,
                        overscrollBehavior: 'contain'
                    }}>
                        {/* Available Tables Section - always visible */}
                        {tableSelectionPanel}
                    </Box>
                </Box>
                {/* Content area - show selected data loader form */}
                <Box sx={{ flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0, height: '100%', position: 'relative' }}>
                    {dataConnectorView}
                </Box>
            </Box>
        </Box>  

    return (
        <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            {mainContent}
            {isUploading && (
                <Box sx={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    width: '100%', 
                    height: '100%', 
                    display: 'flex', 
                    flexDirection: 'column',
                    alignItems: 'center', 
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.85)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 1000,
                    gap: 2,
                }}>
                    <CircularProgress size={60} thickness={5} />
                    <Typography variant="body2" color="text.secondary">
                        {t('db.uploadingData')}
                    </Typography>
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => setIsUploading(false)}
                        sx={{ mt: 1, textTransform: 'none', color: 'text.secondary' }}
                    >
                        {t('app.cancel')}
                    </Button>
                </Box>
            )}
            
        </Box>
    );
  
}

// ---------------------------------------------------------------------------
// GroupLoadPanel — right panel for table_group nodes (BI dashboards)
// ---------------------------------------------------------------------------

const GroupLoadPanel: React.FC<{
    groupName: string;
    tables: { name: string; dataset_id: number; row_count?: number; columns?: string[] }[];
    rowLimitPresets: number[];
    connectorId: string;
    loadedKey?: string;
    onLoaded: (label: string) => void;
    onImport: () => void;
    onFinish: (severity: "error" | "success", msg: string, tableIds?: string[]) => void;
}> = ({ groupName, tables, rowLimitPresets, connectorId, loadedKey, onLoaded, onImport, onFinish }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(tables.map(t => t.dataset_id)));
    const allSelected = selectedIds.size === tables.length;
    const toggleAll = () => {
        if (allSelected) setSelectedIds(new Set());
        else setSelectedIds(new Set(tables.map(t => t.dataset_id)));
    };
    const toggleOne = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const [rowLimit, setRowLimit] = useState<number>(50_000);
    const [isLoading, setIsLoading] = useState(false);

    const selectedTables = tables.filter(t => selectedIds.has(t.dataset_id));
    const totalRows = selectedTables.reduce((sum, t) => sum + (t.row_count ?? 0), 0);

    const handleLoadGroup = async () => {
        if (selectedTables.length === 0) return;
        setIsLoading(true);
        onImport();
        try {
            const resp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.IMPORT_GROUP, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connector_id: connectorId,
                    tables: selectedTables.map(t => ({ dataset_id: t.dataset_id, name: t.name })),
                    row_limit: rowLimit,
                    group_name: groupName,
                }),
            });
            const data = await resp.json();

            if (data.status === 'success') {
                const results: any[] = data.results || [];
                const succeeded = results.filter(r => r.status === 'success');
                const failed = results.filter(r => r.status === 'error');

                const listResp = await fetchWithIdentity(getUrls().LIST_TABLES, { method: 'GET' });
                const listData = await listResp.json();
                if (listData.status === 'success') {
                    for (const r of succeeded) {
                        const wsTable = (listData.tables || []).find((t: any) => t.name === r.table_name);
                        if (wsTable) {
                            const source = {
                                type: 'database' as const,
                                databaseTable: r.table_name,
                                canRefresh: true,
                                lastRefreshed: Date.now(),
                                connectorId,
                            };
                            const tableObj = buildDictTableFromWorkspace(wsTable, source);
                            dispatch(dfActions.addTableToStore(tableObj));
                            dispatch(fetchFieldSemanticType(tableObj));
                        }
                    }
                }

                onLoaded('loaded');
                if (failed.length > 0) {
                    onFinish("error", `Loaded ${succeeded.length} tables, ${failed.length} failed`);
                } else {
                    onFinish("success", `Loaded ${succeeded.length} tables from "${groupName}"`,
                        succeeded.map(r => r.table_name));
                }
            } else {
                throw new Error(data.message || 'Failed to load group');
            }
        } catch (err: any) {
            onFinish("error", err.message || 'Failed to load dashboard');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexShrink: 0 }}>
                <DashboardOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>{groupName}</Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled', flexShrink: 0 }}>
                    {selectedTables.length}/{tables.length}
                    {totalRows > 0 && ` · ~${totalRows.toLocaleString()}`}
                </Typography>
            </Box>

            {/* Scrollable content — tables list with checkboxes */}
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Checkbox
                        size="small" checked={allSelected}
                        indeterminate={selectedIds.size > 0 && !allSelected}
                        onChange={toggleAll}
                        sx={{ p: 0.25, '& .MuiSvgIcon-root': { fontSize: 16 } }}
                    />
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Tables
                    </Typography>
                </Box>
                <Box sx={{ mt: 0.5 }}>
                    {tables.map((tbl, idx) => (
                        <Box key={idx} sx={{
                            display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25, px: 0.5,
                            borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' },
                            cursor: 'pointer',
                        }} onClick={() => toggleOne(tbl.dataset_id)}>
                            <Checkbox
                                size="small" checked={selectedIds.has(tbl.dataset_id)}
                                sx={{ p: 0.25, '& .MuiSvgIcon-root': { fontSize: 14 } }}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleOne(tbl.dataset_id)}
                            />
                            <TableIcon sx={{ fontSize: 14, color: 'text.secondary', opacity: 0.7 }} />
                            <Typography sx={{ fontSize: 12, flex: 1 }} noWrap>{tbl.name}</Typography>
                            {tbl.row_count != null && (
                                <Typography sx={{ fontSize: 11, color: 'text.disabled', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                                    {Number(tbl.row_count).toLocaleString()}
                                </Typography>
                            )}
                        </Box>
                    ))}
                </Box>
            </Box>

            {/* Load controls — pinned at bottom */}
            <Box sx={{
                mt: 1, pt: 1, flexShrink: 0,
                borderTop: '1px solid', borderColor: 'divider',
                display: 'flex', alignItems: 'center', gap: 1,
            }}>
                {loadedKey ? (
                    <Button
                        variant="outlined" size="small" disabled
                        startIcon={<CheckIcon sx={{ fontSize: 14 }} />}
                        sx={{
                            textTransform: 'none', fontSize: 12, px: 2, height: 30,
                            color: 'success.main', borderColor: 'success.main',
                            '&.Mui-disabled': { color: 'success.main', borderColor: 'success.main', opacity: 0.8 },
                        }}
                    >
                        {t('db.loaded')}
                    </Button>
                ) : (
                    <>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
                            <Typography sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                                {t('db.maxRows', { defaultValue: 'Max rows' })}/table
                            </Typography>
                            <RowLimitUnderlineSelect
                                value={rowLimit}
                                presets={rowLimitPresets}
                                onChange={setRowLimit}
                                fontSize={11}
                            />
                        </Box>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="contained" size="small"
                            disabled={isLoading || selectedTables.length === 0}
                            onClick={handleLoadGroup}
                            startIcon={isLoading ? <CircularProgress size={14} /> : <DashboardOutlinedIcon sx={{ fontSize: 14 }} />}
                            sx={{ textTransform: 'none', fontSize: 12, px: 2, height: 30, flexShrink: 0 }}
                        >
                            {isLoading ? 'Loading...' : `Import Selected (${selectedTables.length})`}
                        </Button>
                    </>
                )}
            </Box>
        </Box>
    );
};

export const DataLoaderForm: React.FC<{
    dataLoaderType: string,
    /** Loader registry key (e.g. "mysql") for i18n lookups. Falls back to dataLoaderType. */
    loaderType?: string,
    paramDefs: {name: string, default?: string, type: string, required: boolean, description?: string, sensitive?: boolean, tier?: 'connection' | 'auth' | 'filter'}[],
    authInstructions: string,
    connectorId?: string,
    autoConnect?: boolean,
    /** When true, attempt SSO token passthrough on mount (no popup). */
    ssoAutoConnect?: boolean,
    delegatedLogin?: { login_url: string; label?: string } | null,
    authMode?: string,
    onImport: () => void,
    onFinish: (status: "success" | "error", message: string, importedTables?: string[]) => void,
    onConnected?: () => void,
    /** Called when the user clicks Delete. Receives the connectorId. */
    onDelete?: (connectorId: string) => void,
    /** Called before the connect step. Returns the effective connectorId to use.
     *  Used by AddConnectionPanel to create the connector before connecting. */
    onBeforeConnect?: (params: Record<string, any>) => Promise<string>,
}> = ({dataLoaderType, loaderType, paramDefs, authInstructions, connectorId, autoConnect, ssoAutoConnect, delegatedLogin, authMode, onImport, onFinish, onConnected, onDelete, onBeforeConnect}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();
    const loaderTypeKey = loaderType || dataLoaderType;
    const getParamPlaceholder = (paramDef: {name: string; default?: string; description?: string}) => {
        const fallback = paramDef.description || (paramDef.default ? `${paramDef.default}` : '');
        return t(`loader.${loaderTypeKey}.${paramDef.name}`, {
            defaultValue: t(`loader._common.${paramDef.name}`, { defaultValue: fallback }),
        });
    };
    const localizedAuthInstructions = t(`loader.${loaderTypeKey}.authInstructions`, {
        defaultValue: authInstructions.trim(),
    });
    // Effective connectorId — may be updated by onBeforeConnect (e.g. AddConnectionPanel)
    const connectorIdRef = useRef(connectorId);
    useEffect(() => { connectorIdRef.current = connectorId; }, [connectorId]);
    const params = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[dataLoaderType] ?? {});
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 2_000_000);
    const workspaceTables = useSelector((state: DataFormulatorState) => state.tables);

    const [tableMetadata, setTableMetadata] = useState<Record<string, any>>({});
    const [selectedPreviewTable, setSelectedPreviewTable] = useState<string | null>(null);
    // Catalog tree state (hierarchical browsing)
    const [catalogTree, setCatalogTree] = useState<CatalogTreeNode[]>([]);
    const [selectedTreeNode, setSelectedTreeNode] = useState<CatalogTreeNode | null>(null);
    const [expandedItems, setExpandedItems] = useState<string[]>([]);
    // Import options for the currently selected table
    // Standard row-limit presets, capped by the system frontendRowLimit setting
    const rowLimitPresets = useMemo(
        () => [20_000, 50_000, 100_000, 200_000, 300_000, 500_000].filter(n => n <= frontendRowLimit),
        [frontendRowLimit],
    );
    // Track which tables have been loaded and how (persists across table selections)
    const [loadedTables, setLoadedTables] = useState<Record<string, string>>({});

    // Cross-reference workspace tables with database tables to detect already-loaded ones
    const workspaceLoadedTables = useMemo(() => {
        const result: Record<string, 'full' | 'subset'> = {};
        for (const wt of workspaceTables) {
            const dbTableName = wt.source?.databaseTable;
            if (dbTableName && wt.source?.type === 'database') {
                // Determine if subset: if virtual exists and rowCount > loaded rows, it's a subset
                const isSubset = wt.virtual ? wt.rows.length < wt.virtual.rowCount : false;
                result[dbTableName] = isSubset ? 'subset' : 'full';
            }
        }
        return result;
    }, [workspaceTables]);

    // Merge: local session loads take priority over workspace-detected loads
    const effectiveLoadedTables = useMemo(() => {
        return { ...workspaceLoadedTables, ...loadedTables };
    }, [workspaceLoadedTables, loadedTables]);

    let [isConnecting, setIsConnecting] = useState(false);
    const [persistCredentials, setPersistCredentials] = useState(true);

    // Sensitive params (passwords, tokens, secrets) live in component state only —
    // never persisted to Redux / localStorage.
    // Sensitivity is declared by the loader via `sensitive: true` or `type: "password"`.
    const sensitiveParamNames = useMemo(
        () => new Set(paramDefs.filter(p => p.sensitive || p.type === 'password').map(p => p.name)),
        [paramDefs]
    );
    const [sensitiveParams, setSensitiveParams] = useState<Record<string, string>>({});

    // Merged params: Redux (non-sensitive) + component state (sensitive)
    const mergedParams = useMemo(
        () => ({ ...params, ...sensitiveParams }),
        [params, sensitiveParams]
    );

    // Ref for the connected-state table filter input (uncontrolled for performance)
    const filterInputRef = useRef<HTMLInputElement>(null);

    // Connection timeout in milliseconds (30 seconds)
    const CONNECTION_TIMEOUT_MS = 30_000;

    // Helper: extract flat table metadata from the tree for preview/load logic
    const extractTableMetadata = useCallback((tree: CatalogTreeNode[]) => {
        const result: Record<string, any> = {};
        const walk = (nodes: CatalogTreeNode[]) => {
            for (const n of nodes) {
                if (n.node_type === 'table') {
                    // Use the path-based key so duplicate table names under different namespaces stay distinct
                    const key = n.path.join('/');
                    result[key] = { ...n.metadata, _catalogName: n.name, _catalogPath: n.path };
                } else if (n.node_type === 'table_group') {
                    const key = n.path.join('/');
                    result[key] = { ...n.metadata, _catalogName: n.name, _catalogPath: n.path, _isGroup: true };
                }
                if (n.children) walk(n.children);
            }
        };
        walk(tree);
        return result;
    }, []);

    // Helper: fetch catalog tree and update state
    const fetchCatalogTree = useCallback(async (filter?: string) => {
        const treeResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.GET_CATALOG_TREE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connector_id: connectorIdRef.current, filter: filter?.trim() || null }),
        });
        const treeData = await treeResp.json();
        if (treeData.tree) {
            setCatalogTree(treeData.tree);
            setExpandedItems(collectNamespaceIds(treeData.tree));
            const flatMeta = extractTableMetadata(treeData.tree);
            setTableMetadata(flatMeta);
            return treeData;
        } else if (treeData.status === 'error') {
            throw new Error(treeData.message || 'Failed to load catalog tree');
        }
        return treeData;
    }, [extractTableMetadata]);

    // Helper: connect and list tables via data connector
    const connectAndListTables = useCallback(async (filter?: string) => {
        setIsConnecting(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
        try {
            // Strip table_filter from params sent to connect (it's for catalog browsing, not connection)
            const { table_filter: _tf, ...connectParams } = mergedParams as Record<string, any>;
            // If onBeforeConnect is provided (e.g. AddConnectionPanel), create the connector first
            if (onBeforeConnect) {
                connectorIdRef.current = await onBeforeConnect(connectParams);
            }
            const connectResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.CONNECT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: connectorIdRef.current, params: connectParams, persist: persistCredentials }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const connectData = await connectResp.json();
            if (connectData.status !== 'connected') {
                throw new Error(connectData.message || 'Connection failed');
            }
            // Fetch catalog tree before promoting to "connected" state
            const tableFilterValue = filter ?? (mergedParams as Record<string, any>).table_filter ?? '';
            await fetchCatalogTree(tableFilterValue);
            // Only promote to "connected" after tree is loaded
            onConnected?.();
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                onFinish("error", t('db.connectionTimeout'));
            } else {
                onFinish("error", error.message || 'Failed to connect');
            }
        } finally {
            setIsConnecting(false);
        }
    }, [mergedParams, persistCredentials, onFinish, onConnected, onBeforeConnect, fetchCatalogTree, t]);

    // Delegated (popup-based) login flow for token-based connectors
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleDelegatedLogin = useCallback(async () => {
        if (!delegatedLogin?.login_url) return;
        setIsConnecting(true);
        try {
            // If onBeforeConnect is provided (e.g. AddConnectionPanel), create the connector first
            if (onBeforeConnect) {
                const { table_filter: _tf, ...connectParams } = mergedParams as Record<string, any>;
                connectorIdRef.current = await onBeforeConnect(connectParams);
            }
            if (!connectorIdRef.current) return;
        } catch (err: any) {
            onFinish('error', err.message || 'Failed to create connector');
            setIsConnecting(false);
            return;
        }

        const url = new URL(delegatedLogin.login_url, window.location.origin);
        url.searchParams.set('df_origin', window.location.origin);
        // Pass auth-tier form params (e.g. client_id, tenant_id) to the login endpoint
        for (const p of paramDefs) {
            if (p.tier === 'auth' && !p.sensitive && p.type !== 'password' && mergedParams[p.name]) {
                url.searchParams.set(p.name, mergedParams[p.name]);
            }
        }

        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        const popup = window.open(
            url.toString(),
            'df-sso-login',
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
        );

        if (!popup) {
            onFinish("error", t('db.popupBlocked') || 'Popup was blocked. Please allow popups and try again.');
            setIsConnecting(false);
            return;
        }

        const handler = async (event: MessageEvent) => {
            if (event.data?.type !== 'df-sso-auth') return;
            window.removeEventListener('message', handler);
            if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
            popup.close();

            const { access_token, refresh_token, user } = event.data;
            if (access_token) {
                try {
                    // Persist token in TokenStore for Agent and future requests
                    await fetchWithIdentity('/api/auth/tokens/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            system_id: connectorIdRef.current,
                            access_token,
                            refresh_token,
                            user,
                        }),
                    }).catch(() => {});

                    // Send tokens to backend token-connect endpoint
                    const connectResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.CONNECT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            connector_id: connectorIdRef.current,
                            mode: 'token',
                            access_token,
                            refresh_token,
                            user,
                            params: mergedParams,  // include any filled-in params (e.g. url)
                            persist: persistCredentials,
                        }),
                    });
                    const connectData = await connectResp.json();
                    if (connectData.status !== 'connected') {
                        throw new Error(connectData.message || 'Token connection failed');
                    }
                    // Fetch catalog tree
                    await fetchCatalogTree(null as any);
                    onConnected?.();
                } catch (err: any) {
                    onFinish("error", err.message || 'Login failed');
                }
            }
            setIsConnecting(false);
        };

        window.addEventListener('message', handler);

        pollTimerRef.current = setInterval(() => {
            if (popup.closed) {
                if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
                window.removeEventListener('message', handler);
                setIsConnecting(false);
            }
        }, 1000);
    }, [delegatedLogin, mergedParams, persistCredentials, onFinish, onConnected, onBeforeConnect, t]);

    // Auto-connect on mount from vault credentials or SSO token passthrough.
    const autoConnectTriggered = useRef(false);
    useEffect(() => {
        const shouldAutoConnect = (autoConnect || ssoAutoConnect) && connectorIdRef.current && !autoConnectTriggered.current && Object.keys(tableMetadata).length === 0;
        if (!shouldAutoConnect) return;
        autoConnectTriggered.current = true;
        (async () => {
            setIsConnecting(true);
            try {
                const statusResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.GET_STATUS, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connector_id: connectorIdRef.current }),
                });
                const statusData = await statusResp.json();
                if (statusData.connected) {
                    await fetchCatalogTree();
                } else if (statusData.has_stored_credentials || statusData.sso_available) {
                    // Vault creds or SSO token available — attempt auto-connect.
                    // Backend _inject_sso_token handles SSO token passthrough transparently.
                    const connectResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.CONNECT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ connector_id: connectorIdRef.current, params: {}, persist: !statusData.sso_available }),
                    });
                    const connectData = await connectResp.json();
                    if (connectData.status === 'connected') {
                        await fetchCatalogTree();
                        onConnected?.();
                    }
                }
            } catch (err) {
                console.warn('Auto-connect failed for', connectorIdRef.current, err);
            } finally {
                setIsConnecting(false);
            }
        })();
    }, [autoConnect, ssoAutoConnect, connectorId]);

    // Auto-select first table for preview when metadata loads
    useEffect(() => {
        const tableNames = Object.keys(tableMetadata);
        if (tableNames.length > 0 && (!selectedPreviewTable || !tableMetadata[selectedPreviewTable])) {
            setSelectedPreviewTable(tableNames[0]);
        }
    }, [tableMetadata]);

    // Reset load config when switching tables — always use a safe default
    // (sort/limit config is now managed inside ConnectorTablePreview)

    const getSourceTableRef = useCallback((pathKey: string): SourceTableRef => {
        const meta = tableMetadata[pathKey];
        const name = meta?._source_name || meta?._catalogName || pathKey.split('/').pop() || pathKey;
        const id = meta?.dataset_id != null ? String(meta.dataset_id) : name;
        return { id, name };
    }, [tableMetadata]);

    // Fetch sample rows on demand when a table is selected but has no sample_rows.
    // Debounced to avoid rapid-fire requests when clicking through many files.
    useEffect(() => {
        if (!selectedPreviewTable || !connectorIdRef.current) return;
        const meta = tableMetadata[selectedPreviewTable];
        if (!meta || meta.sample_rows) return; // already has sample rows

        const controller = new AbortController();
        const timerId = setTimeout(() => {
            const ref = getSourceTableRef(selectedPreviewTable);
            fetchWithIdentity(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connector_id: connectorIdRef.current,
                    source_table: ref,
                    limit: 10,
                }),
                signal: controller.signal,
            })
                .then(r => r.json())
                .then(data => {
                    if (data.rows && data.columns) {
                        setTableMetadata(prev => ({
                            ...prev,
                            [selectedPreviewTable]: {
                                ...prev[selectedPreviewTable],
                                sample_rows: data.rows,
                                columns: data.columns,
                                row_count: data.total_row_count ?? prev[selectedPreviewTable]?.row_count,
                            },
                        }));
                    }
                })
                .catch(() => { /* preview fetch is best-effort; debounced and abortable */ });
        }, 300); // 300ms debounce

        return () => { clearTimeout(timerId); controller.abort(); };
    }, [selectedPreviewTable, getSourceTableRef]);

    // Build preview DictTable for the selected table
    const previewTable: DictTable | null = useMemo(() => {
        if (!selectedPreviewTable || !tableMetadata[selectedPreviewTable]) return null;
        const metadata = tableMetadata[selectedPreviewTable];
        const sampleRows = metadata.sample_rows || [];
        const columns = metadata.columns || [];
        const names = columns.map((c: any) => c.name);
        return {
            kind: 'table' as const,
            id: selectedPreviewTable,
            displayId: selectedPreviewTable,
            names,
            rows: sampleRows,
            metadata: names.reduce((acc: Record<string, any>, name: string) => ({
                ...acc,
                [name]: { type: 'string' as any, semanticType: '', levels: [] }
            }), {}),
            virtual: { tableId: selectedPreviewTable, rowCount: metadata.row_count || sampleRows.length },
            anchored: true,
            attachedMetadata: '',
        };
    }, [selectedPreviewTable, tableMetadata]);

    const tableNames = Object.keys(tableMetadata);

    // Handler for selecting a table node from the catalog tree
    const handleTreeTableSelect = useCallback((node: CatalogTreeNode) => {
        setSelectedTreeNode(node);
        const pathKey = node.path.join('/');
        setSelectedPreviewTable(pathKey);
    }, []);

    /** Shared helper: build DictTable + dispatch loadTable */
    const doLoadTable = useCallback((importOptions: Record<string, any>, label?: string) => {
        const pathKey = selectedPreviewTable;
        if (!pathKey) return;
        const meta = tableMetadata[pathKey];
        if (!meta) return;

        const ref = getSourceTableRef(pathKey);
        const sampleRows = meta.sample_rows || [];
        const columns = meta.columns || [];
        const tableObj: DictTable = {
            kind: 'table' as const,
            id: ref.name.split('.').pop() || ref.name,
            displayId: ref.name,
            names: columns.map((c: any) => c.name),
            metadata: columns.reduce((acc: Record<string, any>, col: any) => ({
                ...acc,
                [col.name]: { type: 'string' as any, semanticType: '', levels: [] }
            }), {}),
            rows: sampleRows,
            virtual: { tableId: ref.name.split('.').pop() || ref.name, rowCount: meta.row_count || sampleRows.length },
            anchored: true,
            attachedMetadata: '',
            source: {
                type: 'database' as const,
                databaseTable: pathKey,
                canRefresh: true,
                lastRefreshed: Date.now(),
                connectorId: connectorIdRef.current,
            },
        };

        onImport();
        dispatch(loadTable({
            table: tableObj,
            connectorId: connectorIdRef.current,
            sourceTableRef: ref,
            importOptions,
        })).unwrap()
            .then((result) => {
                setLoadedTables(prev => ({ ...prev, [pathKey]: label || 'loaded' }));
                onFinish("success", `Loaded table "${ref.name}"`, [result.table.id]);
            })
            .catch((error) => {
                console.error('Failed to load data:', error);
                onFinish("error", `Failed to load "${ref.name}": ${error}`);
            });
    }, [selectedPreviewTable, tableMetadata, getSourceTableRef, onImport, onFinish, dispatch]);


    const isConnected = catalogTree.length > 0 || Object.keys(tableMetadata).length > 0;

    const handleDisconnect = useCallback(async () => {
        const cid = connectorIdRef.current;
        if (cid) {
            await fetchWithIdentity(`/api/auth/tokens/${encodeURIComponent(cid)}`, {
                method: 'DELETE',
            }).catch(() => {});
        }
        setCatalogTree([]);
        setTableMetadata({});
        setSelectedPreviewTable(null);
        setSelectedTreeNode(null);
        setExpandedItems([]);
    }, []);

    // Split catalog tree into dataset vs dashboard subsets for tabbed view
    const datasetNodes = useMemo(() => catalogTree.filter(n => n.node_type !== 'table_group'), [catalogTree]);
    const dashboardNodes = useMemo(() => catalogTree.filter(n => n.node_type === 'table_group'), [catalogTree]);
    const hasBothTabs = datasetNodes.length > 0 && dashboardNodes.length > 0;
    const [catalogTab, setCatalogTab] = useState(0);
    const [localTableFilter, setLocalTableFilter] = useState('');

    const filterTreeByName = useCallback((nodes: CatalogTreeNode[], keyword: string): CatalogTreeNode[] => {
        if (!keyword) return nodes;
        const lc = keyword.toLowerCase();
        return nodes.reduce<CatalogTreeNode[]>((acc, node) => {
            if (node.node_type === 'namespace') {
                const filteredChildren = filterTreeByName(node.children || [], keyword);
                if (filteredChildren.length > 0) {
                    acc.push({ ...node, children: filteredChildren });
                }
            } else {
                if (node.name.toLowerCase().includes(lc)) {
                    acc.push(node);
                }
            }
            return acc;
        }, []);
    }, []);

    return (
        <Box sx={{p: 0, pb: 2, display: 'flex', flexDirection: 'column', height: isConnected ? '100%' : 'auto' }}>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.7)"
            }}>
                <CircularProgress size={20} />
            </Box>}
            {isConnected ? (
                // Connected state: tree browser (left) + table detail (right)
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Header: source name · connection params · delete */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap', flexShrink: 0 }}>
                        <Typography variant="body2" component="span" sx={{ fontSize: 12, color: 'secondary.main', fontWeight: 600 }}>
                            {dataLoaderType}
                        </Typography>
                        {paramDefs.filter(p => params[p.name] && !sensitiveParamNames.has(p.name) && p.tier !== 'auth').map((paramDef) => (
                            <Typography key={paramDef.name} variant="body2" component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>
                                {paramDef.name}: <Box component="span" sx={{ fontWeight: 500, color: 'text.primary' }}>{params[paramDef.name]}</Box>
                            </Typography>
                        ))}
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="outlined" size="small"
                            sx={{ textTransform: "none", fontSize: 11, height: 26, minWidth: 0 }}
                            onClick={handleDisconnect}
                        >
                            {t('db.disconnect', { defaultValue: 'Disconnect' })}
                        </Button>
                        {onDelete && connectorIdRef.current && (
                            <Button
                                variant="outlined" size="small" color="error"
                                sx={{ textTransform: "none", fontSize: 11, height: 26, minWidth: 0 }}
                                onClick={() => onDelete(connectorIdRef.current!)}
                            >
                                {t('db.deleteConnector', { defaultValue: 'Delete' })}
                            </Button>
                        )}
                    </Box>
                    {/* Main content: tree (left) + detail (right) */}
                    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, gap: 1 }}>
                        {/* Left: catalog tree */}
                        <Box sx={{
                            width: '40%', minWidth: 180, maxWidth: 340,
                            overflowY: 'auto', overflowX: 'hidden',
                            py: 0,
                            overscrollBehavior: 'contain',
                            display: 'flex', flexDirection: 'column',
                        }}>
                            {/* Inline search */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, pb: 0.5, flexShrink: 0 }}>
                                <SearchIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                <TextField
                                    sx={{
                                        flex: 1,
                                        '& .MuiInputBase-root': { fontSize: 12 },
                                        '& .MuiInputBase-input': { fontSize: 12, py: 0.25, px: 0.5 },
                                        '& .MuiInputBase-input::placeholder': { fontSize: 11, opacity: 0.5 },
                                        '& .MuiInput-underline:before, & .MuiInput-underline:after': { display: 'none' },
                                    }}
                                    variant="standard" size="small"
                                    placeholder={t('db.tableFilterPlaceholder')}
                                    autoComplete="off"
                                    defaultValue={params.table_filter || ''}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const val = (e.target as HTMLInputElement).value;
                                            dispatch(dfActions.updateDataLoaderConnectParam({dataLoaderType, paramName: 'table_filter', paramValue: val}));
                                            connectAndListTables(val);
                                        }
                                    }}
                                    inputRef={filterInputRef}
                                />
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.25 }}
                                    onClick={() => {
                                        const val = filterInputRef.current?.value ?? params.table_filter ?? '';
                                        dispatch(dfActions.updateDataLoaderConnectParam({dataLoaderType, paramName: 'table_filter', paramValue: val}));
                                        connectAndListTables(val);
                                    }}
                                >
                                    <RefreshIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                </IconButton>
                            </Box>
                            <Divider sx={{ mb: 0 }} />
                            {hasBothTabs && (
                                <Tabs
                                    value={catalogTab}
                                    onChange={(_e, v) => setCatalogTab(v)}
                                    variant="fullWidth"
                                    sx={{
                                        minHeight: 0, flexShrink: 0,
                                        '& .MuiTab-root': { minHeight: 28, py: 0.25, fontSize: 11, textTransform: 'none', fontWeight: 600, letterSpacing: 0.3 },
                                        '& .MuiTabs-indicator': { height: 2 },
                                    }}
                                >
                                    <Tab label={`${t('db.datasets', { defaultValue: 'Datasets' })} (${datasetNodes.reduce((s, n) => s + (n.children?.length ?? 0), 0)})`} />
                                    <Tab label={`${t('db.dashboards', { defaultValue: 'Dashboards' })} (${dashboardNodes.length})`} />
                                </Tabs>
                            )}
                            {/* Local instant filter by table name */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, py: 0.5, flexShrink: 0 }}>
                                <SearchIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                <TextField
                                    sx={{
                                        flex: 1,
                                        '& .MuiInputBase-root': { fontSize: 12 },
                                        '& .MuiInputBase-input': { fontSize: 12, py: 0.25, px: 0.5 },
                                        '& .MuiInputBase-input::placeholder': { fontSize: 11, opacity: 0.5 },
                                        '& .MuiInput-underline:before, & .MuiInput-underline:after': { display: 'none' },
                                    }}
                                    variant="standard" size="small"
                                    placeholder={t('db.localFilterPlaceholder', { defaultValue: 'Filter by name...' })}
                                    autoComplete="off"
                                    value={localTableFilter}
                                    onChange={(e) => setLocalTableFilter(e.target.value)}
                                />
                                {localTableFilter && (
                                    <IconButton size="small" sx={{ p: 0.25 }} onClick={() => setLocalTableFilter('')}>
                                        <Typography sx={{ fontSize: 12, lineHeight: 1, color: 'text.disabled' }}>✕</Typography>
                                    </IconButton>
                                )}
                            </Box>
                            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                            {(() => {
                                const baseNodes = hasBothTabs ? (catalogTab === 0 ? datasetNodes : dashboardNodes) : catalogTree;
                                const visibleNodes = filterTreeByName(baseNodes, localTableFilter);
                                if (visibleNodes.length === 0) return (
                                    <Typography sx={{ fontSize: 11, color: 'text.disabled', p: 1.5, fontStyle: 'italic' }}>
                                        {t('db.noTablesFound')}
                                    </Typography>
                                );
                                return (
                                    <SimpleTreeView
                                        expandedItems={expandedItems}
                                        onExpandedItemsChange={(_event, itemIds) => setExpandedItems(itemIds)}
                                        selectedItems={selectedPreviewTable}
                                        onSelectedItemsChange={(_event, itemId) => {
                                            if (itemId == null) return;
                                            const node = findNodeByPath(visibleNodes, itemId);
                                            if (node && (node.node_type === 'table' || node.node_type === 'table_group')) {
                                                handleTreeTableSelect(node);
                                            }
                                        }}
                                        itemChildrenIndentation={0}
                                        sx={{ px: 0.5 }}
                                    >
                                        {renderCatalogTreeItems(visibleNodes, { loadedMap: effectiveLoadedTables, expandedSet: new Set(expandedItems) })}
                                    </SimpleTreeView>
                                );
                            })()}
                            </Box>
                        </Box>

                        {/* Right: table detail + preview + load controls */}
                        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', px: 1 }}>
                            {/* Group load panel for table_group nodes */}
                            {selectedPreviewTable && tableMetadata[selectedPreviewTable]?._isGroup ? (() => {
                                const metadata = tableMetadata[selectedPreviewTable];
                                const groupName = metadata._catalogName || selectedPreviewTable;
                                const tables: any[] = metadata.tables || [];
                                return (
                                    <GroupLoadPanel
                                        groupName={groupName}
                                        tables={tables}
                                        rowLimitPresets={rowLimitPresets}
                                        connectorId={connectorIdRef.current!}
                                        loadedKey={effectiveLoadedTables[selectedPreviewTable]}
                                        onLoaded={(label) => setLoadedTables(prev => ({ ...prev, [selectedPreviewTable!]: label }))}
                                        onImport={onImport}
                                        onFinish={onFinish}
                                    />
                                );
                            })() : previewTable && selectedPreviewTable && tableMetadata[selectedPreviewTable] ? (() => {
                                const metadata = tableMetadata[selectedPreviewTable];
                                const displayName = metadata?._catalogName || selectedPreviewTable.split('/').pop() || selectedPreviewTable;
                                const ref = getSourceTableRef(selectedPreviewTable);
                                return (
                                    <ConnectorTablePreview
                                        connectorId={connectorIdRef.current!}
                                        sourceTable={ref}
                                        displayName={displayName}
                                        pathBreadcrumb={selectedTreeNode && selectedTreeNode.path.length > 1 ? selectedTreeNode.path.slice(0, -1).join(' / ') : undefined}
                                        columns={(metadata.columns || []).map((c: any) => ({ name: c.name, type: c.type || 'unknown', source_type: c.source_type }))}
                                        sampleRows={previewTable.rows}
                                        rowCount={metadata?.row_count ?? null}
                                        loading={false}
                                        rowLimitPresets={rowLimitPresets}
                                        defaultRowLimit={50_000}
                                        alreadyLoaded={!!effectiveLoadedTables[selectedPreviewTable]}
                                        enableFilters
                                        enableSort
                                        onLoad={(opts) => doLoadTable(opts, opts.source_filters ? 'subset' : 'loaded')}
                                        onUnload={() => {
                                            const tableName = selectedPreviewTable;
                                            const wt = workspaceTables.find(t => t.source?.databaseTable === tableName && t.source?.type === 'database');
                                            if (wt) dispatch(dfActions.deleteTable(wt.id));
                                            setLoadedTables(prev => { const next = { ...prev }; delete next[tableName]; return next; });
                                        }}
                                        onRefreshPreview={(rows, cols, rc) => {
                                            setTableMetadata(prev => ({
                                                ...prev,
                                                [selectedPreviewTable]: {
                                                    ...prev[selectedPreviewTable],
                                                    sample_rows: rows,
                                                    columns: cols.length > 0 ? cols : prev[selectedPreviewTable]?.columns,
                                                    row_count: rc ?? prev[selectedPreviewTable]?.row_count,
                                                },
                                            }));
                                        }}
                                    />
                                );
                            })() : (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.disabled' }}>
                                    <Typography variant="body2" sx={{ fontStyle: 'italic', fontSize: 12 }}>
                                        {tableNames.length > 0 ? t('db.selectTableFromTree') : t('db.noTablesFound')}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Box>
            ) : (
                // Not connected: show connection forms
                <>
                    {!onBeforeConnect && (
                        <Typography variant="body2" sx={{fontSize: 12, color: 'secondary.main', fontWeight: 600, mt: 1}}>
                            {dataLoaderType}
                        </Typography>
                    )}
                    {(() => {
                        const hasTiers = paramDefs.some(p => p.tier);
                        // Section wrapper: subtle background, rounded, with label
                        const sectionSx = { mt: 1, px: 1.5, pt: 0.75, pb: 1.5, borderRadius: 1, backgroundColor: 'rgba(0,0,0,0.025)' };
                        // Shared input style: standard variant (underline), label always shrunk so placeholder is visible
                        const inputSx = {
                            '& .MuiInput-underline:before': { borderBottomColor: 'rgba(0,0,0,0.15)' },
                            '& .MuiInputBase-root': { fontSize: 12, mt: 1.5 },
                            '& .MuiInputBase-input': { fontSize: 12, py: 0.5, px: 0 },
                            '& .MuiInputBase-input::placeholder': { fontSize: 11, opacity: 0.45 },
                            '& .MuiInputLabel-root': { fontSize: 11, color: 'text.secondary', fontWeight: 500 },
                            '& .MuiInputLabel-root.Mui-focused': { color: 'primary.main' },
                        };
                        const labelShrinkSlotProps = { inputLabel: { shrink: true } };
                        // Pick 2 or 3 columns to minimise orphan fields on the last row
                        const balancedCols = (n: number) => {
                            if (n <= 2) return 2;
                            if (n % 3 === 0) return 3;  // 3,6,9 → perfect 3-col rows
                            if (n % 2 === 0) return 2;  // 4,8 → perfect 2-col rows
                            return 3;                    // 5,7 → 3 cols (3+2, 3+3+1) is acceptable
                        };
                        if (!hasTiers) {
                            // Legacy: no tier field, render flat grid
                            const cols = balancedCols(paramDefs.length);
                            return (
                                <Box sx={{ ...sectionSx, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 350px))`, gap: 2 }}>
                                    {paramDefs.map((paramDef) => (
                                        <TextField
                                            key={paramDef.name}
                                            sx={inputSx}
                                            variant="standard" size="small" fullWidth
                                            slotProps={labelShrinkSlotProps}
                                            label={paramDef.name}
                                            type={paramDef.type === 'password' ? 'password' : 'text'}
                                            required={paramDef.required}
                                            value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                            placeholder={getParamPlaceholder(paramDef)}
                                            onChange={(event: any) => {
                                                if (sensitiveParamNames.has(paramDef.name)) {
                                                    setSensitiveParams(prev => ({ ...prev, [paramDef.name]: event.target.value }));
                                                } else {
                                                    dispatch(dfActions.updateDataLoaderConnectParam({ dataLoaderType, paramName: paramDef.name, paramValue: event.target.value }));
                                                }
                                            }}
                                        />
                                    ))}
                                </Box>
                            );
                        }

                        const renderParamGrid = (tierParams: typeof paramDefs) => {
                            const cols = balancedCols(tierParams.length);
                            return (
                            <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 350px))`, gap: 2 }}>
                                {tierParams.map((paramDef) => (
                                    <TextField
                                        key={paramDef.name}
                                        sx={inputSx}
                                        variant="standard" size="small" fullWidth
                                        slotProps={labelShrinkSlotProps}
                                        label={paramDef.name}
                                        type={paramDef.type === 'password' ? 'password' : 'text'}
                                        required={paramDef.required}
                                        value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                        placeholder={getParamPlaceholder(paramDef)}
                                        onChange={(event: any) => {
                                            if (sensitiveParamNames.has(paramDef.name)) {
                                                setSensitiveParams(prev => ({ ...prev, [paramDef.name]: event.target.value }));
                                            } else {
                                                dispatch(dfActions.updateDataLoaderConnectParam({ dataLoaderType, paramName: paramDef.name, paramValue: event.target.value }));
                                            }
                                        }}
                                    />
                                ))}
                            </Box>
                            );
                        };

                        const connectionParams = paramDefs.filter(p => p.tier === 'connection');
                        const filterParams = paramDefs.filter(p => p.tier === 'filter');
                        const authParams = paramDefs.filter(p => p.tier === 'auth');
                        const hasDelegated = !!delegatedLogin?.login_url;
                        const connectLabel = onBeforeConnect
                            ? t('db.createConnector', { defaultValue: 'Create Connector' })
                            : t('db.connect', { suffix: (params.table_filter || '').trim() ? t('db.withFilter') : '' });

                        return (
                            <>
                                {/* Tier 1: Connection */}
                                {connectionParams.length > 0 && (
                                    <Box sx={sectionSx}>
                                        <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                            {t('db.tierConnection')}
                                        </Typography>
                                        {renderParamGrid(connectionParams)}
                                    </Box>
                                )}

                                {/* Tier 2: Scope */}
                                {filterParams.length > 0 && (
                                    <Box sx={sectionSx}>
                                        <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                            {t('db.tierFilter')}
                                        </Typography>
                                        {renderParamGrid(filterParams)}
                                    </Box>
                                )}

                                {/* Tier 3: Sign in — Connect lives here */}
                                <Box sx={sectionSx}>
                                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                        {t('db.tierAuth')}
                                    </Typography>

                                    {hasDelegated && authParams.length > 0 ? (
                                        /* Left/right split: delegated | or | credentials + connect */
                                        <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'stretch' }}>
                                            {/* Left: delegated login */}
                                            <Box sx={{ display: 'flex', alignItems: 'center', pr: 2.5, borderRight: '1px solid', borderColor: 'divider' }}>
                                                <Button
                                                    variant="outlined"
                                                    color="primary"
                                                    size="small"
                                                    sx={{ textTransform: "none", minWidth: 80, height: 30, fontSize: 12, whiteSpace: 'nowrap' }}
                                                    disabled={isConnecting}
                                                    onClick={handleDelegatedLogin}
                                                >
                                                    {delegatedLogin!.label || t('db.delegatedLogin')}
                                                </Button>
                                            </Box>
                                            {/* Right: credential fields + connect */}
                                            <Box sx={{ flex: 1 }}>
                                                <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${authParams.length}, minmax(0, 350px))`, gap: 2 }}>
                                                    {authParams.map((paramDef) => (
                                                        <TextField
                                                            key={paramDef.name}
                                                            sx={inputSx}
                                                            variant="standard" size="small" fullWidth
                                                            slotProps={labelShrinkSlotProps}
                                                            label={paramDef.name}
                                                            type={paramDef.type === 'password' ? 'password' : 'text'}
                                                            value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                                            placeholder={getParamPlaceholder(paramDef)}
                                                            onChange={(event: any) => {
                                                                if (sensitiveParamNames.has(paramDef.name)) {
                                                                    setSensitiveParams(prev => ({ ...prev, [paramDef.name]: event.target.value }));
                                                                } else {
                                                                    dispatch(dfActions.updateDataLoaderConnectParam({ dataLoaderType, paramName: paramDef.name, paramValue: event.target.value }));
                                                                }
                                                            }}
                                                        />
                                                    ))}
                                                </Box>
                                                <Button
                                                    variant="contained" color="primary" size="small"
                                                    sx={{ textTransform: "none", minWidth: 80, height: 30, mt: 1.5, fontSize: 12 }}
                                                    onClick={() => connectAndListTables()}>
                                                    {connectLabel}
                                                </Button>
                                            </Box>
                                        </Box>
                                    ) : hasDelegated ? (
                                        /* Delegated only */
                                        <Button
                                            variant="contained" color="primary" size="small"
                                            sx={{ textTransform: "none", minWidth: 80, height: 30, fontSize: 12 }}
                                            disabled={isConnecting}
                                            onClick={handleDelegatedLogin}
                                        >
                                            {delegatedLogin!.label || t('db.delegatedLogin')}
                                        </Button>
                                    ) : (
                                        /* Manual credentials only + connect */
                                        <>
                                            {renderParamGrid(authParams)}
                                            <Button
                                                variant="contained" color="primary" size="small"
                                                sx={{ textTransform: "none", minWidth: 80, height: 30, mt: 1.5, fontSize: 12 }}
                                                onClick={() => connectAndListTables()}>
                                                {connectLabel}
                                            </Button>
                                        </>
                                    )}
                                </Box>
                            </>
                        );
                    })()}
                    {paramDefs.length > 0 && (
                        <FormControlLabel
                            sx={{ mt: 0.5, ml: 0 }}
                            control={
                                <Checkbox
                                    size="small"
                                    checked={persistCredentials}
                                    onChange={(e) => setPersistCredentials(e.target.checked)}
                                    sx={{ p: 0.5 }}
                                />
                            }
                            label={
                                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                                    {t('db.rememberCredentials')}
                                </Typography>
                            }
                        />
                    )}
                    {localizedAuthInstructions && (
                        <Box sx={(theme) => ({
                            mt: 2, px: 1.5, py: 1, 
                            backgroundColor: 'rgba(0,0,0,0.02)',
                            borderRadius: 1,
                            border: '1px solid rgba(0,0,0,0.06)',
                            fontFamily: theme.typography.fontFamily,
                            fontSize: '11px',
                            color: 'text.secondary',
                            lineHeight: 1.6,
                            '& *': { fontFamily: theme.typography.fontFamily, fontSize: 'inherit', lineHeight: 'inherit', color: 'inherit' },
                            '& p': { margin: '0 0 4px 0', '&:last-child': { marginBottom: 0 } },
                            '& code': { fontSize: '10px', fontFamily: 'monospace !important', backgroundColor: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: '3px' },
                            '& pre': { fontSize: '10px', fontFamily: 'monospace !important', backgroundColor: 'rgba(0,0,0,0.04)', padding: '8px', borderRadius: '4px', overflow: 'auto', margin: '4px 0', '& code': { backgroundColor: 'transparent', padding: 0 } },
                            '& a': { color: 'primary.main' },
                            '& ul, & ol': { paddingLeft: '20px', margin: '4px 0' },
                            '& li': { marginBottom: '2px' },
                            '& strong': { fontWeight: 600, color: 'text.primary' },
                            '& h1, & h2, & h3, & h4': { fontSize: '12px', fontWeight: 600, color: 'text.primary', margin: '4px 0' },
                        })}>
                            <Markdown>{localizedAuthInstructions}</Markdown>
                        </Box>
                    )}
                    {onDelete && connectorIdRef.current && (
                        <Box sx={{ mt: 2 }}>
                            <Button
                                variant="outlined" size="small" color="error"
                                sx={{ textTransform: "none", fontSize: 11, height: 26, minWidth: 0 }}
                                onClick={() => onDelete(connectorIdRef.current!)}
                            >
                                {t('db.deleteConnector', { defaultValue: 'Delete' })}
                            </Button>
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
}