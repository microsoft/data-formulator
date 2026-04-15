// TableManager.tsx
import React, { useState, useEffect, useCallback, FC, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Card, 
  CardContent, 
  Typography, 
  Button, 
  Grid,
  Box,
  IconButton,
  Paper,
  TextField,
  Divider,
  SxProps,
  CircularProgress,
  ButtonGroup,
  ToggleButton,
  ToggleButtonGroup,
  MenuItem,
  Menu,
  Chip,
  Checkbox,
  FormControlLabel,
  styled,
  useTheme,
  Link,
  alpha,
  Tooltip,
} from '@mui/material';

import SearchIcon from '@mui/icons-material/Search';

import Autocomplete from '@mui/material/Autocomplete';

import { getUrls, getConnectorUrls, fetchWithIdentity } from '../app/utils';
import { borderColor } from '../app/tokens';
import { CustomReactTable } from './ReactTable';
import { DataSourceConfig, DictTable } from '../components/ComponentType';
import { Type } from '../data/types';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions, dfSelectors } from '../app/dfSlice';
import { DataFormulatorState } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { loadTable } from '../app/tableThunks';
import { AppDispatch } from '../app/store';
import Markdown from 'markdown-to-jsx';

import CheckIcon from '@mui/icons-material/Check';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ClearIcon from '@mui/icons-material/Clear';


export const handleDBDownload = async (identityId: string) => {
    try {
        const response = await fetchWithIdentity(
            getUrls().DOWNLOAD_DB_FILE,
            { method: 'GET' }
        );
        
        // Check if the response is ok
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || errorData.message || 'Failed to download database file');
        }

        // Get the blob directly from response
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        // Create a temporary link element
        const link = document.createElement('a');
        link.href = url;
        link.download = `df_${identityId?.slice(0, 4) || 'db'}.db`;
        document.body.appendChild(link);    
        
        // Trigger download
        link.click();
        
        // Clean up
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        throw error;
    }
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

interface ColumnStatistics {
    column: string;
    type: string;
    statistics: {
        count: number;
        unique_count: number;
        null_count: number;
        min?: number;
        max?: number;
        avg?: number;
    };
}


export const DBManagerPane: React.FC<{ 
    onClose?: () => void;
}> = function DBManagerPane({ onClose }) {
    const { t } = useTranslation();
    const theme = useTheme();

    const dispatch = useDispatch<AppDispatch>();
    const identity = useSelector((state: DataFormulatorState) => state.identity);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const dataLoaderConnectParams = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams);

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
                <Box key={`source:${source.source_id}`} sx={{ position: "relative", maxWidth: '100%', flexShrink: 0 }}>
                    <DataLoaderForm 
                        key={`source-form-${source.source_id}`}
                        dataLoaderType={source.source_id}
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
                        onDisconnected={() => {
                            setConnectedIds(prev => {
                                const next = new Set(prev);
                                next.delete(source.source_id);
                                return next;
                            });
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

export const DataLoaderForm: React.FC<{
    dataLoaderType: string, 
    paramDefs: {name: string, default?: string, type: string, required: boolean, description?: string, sensitive?: boolean, tier?: 'connection' | 'auth' | 'filter'}[],
    authInstructions: string,
    connectorId?: string,
    autoConnect?: boolean,
    delegatedLogin?: { login_url: string; label?: string } | null,
    authMode?: string,
    onImport: () => void,
    onFinish: (status: "success" | "error", message: string, importedTables?: string[]) => void,
    onConnected?: () => void,
    onDisconnected?: () => void,
}> = ({dataLoaderType, paramDefs, authInstructions, connectorId, autoConnect, delegatedLogin, authMode, onImport, onFinish, onConnected, onDisconnected}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();
    const params = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[dataLoaderType] ?? {});
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 50000);
    const workspaceTables = useSelector((state: DataFormulatorState) => state.tables);

    const [tableMetadata, setTableMetadata] = useState<Record<string, any>>({});
    const [selectedPreviewTable, setSelectedPreviewTable] = useState<string | null>(null);
    // Import mode for the currently selected table
    const [importMode, setImportMode] = useState<'full' | 'subset'>('full');
    const [subsetConfig, setSubsetConfig] = useState<{ rowLimit: number; sortColumns: string[]; sortOrder: 'asc' | 'desc' }>({ rowLimit: 1000, sortColumns: [], sortOrder: 'asc' });
    // Track which tables have been loaded and how (persists across table selections)
    const [loadedTables, setLoadedTables] = useState<Record<string, 'full' | 'subset'>>({});

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

    // Helper: connect and list tables via data connector
    const connectAndListTables = useCallback(async (filter?: string) => {
        setIsConnecting(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
        try {
            const sourceId = connectorId!;
            const urls = getConnectorUrls(sourceId);
            // Strip table_filter from params sent to connect (it's for catalog browsing, not connection)
            const { table_filter: _tf, ...connectParams } = mergedParams as Record<string, any>;
            const connectResp = await fetchWithIdentity(urls.AUTH_CONNECT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ params: connectParams, persist: persistCredentials }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const connectData = await connectResp.json();
            if (connectData.status !== 'connected') {
                throw new Error(connectData.message || 'Connection failed');
            }
            // List tables before promoting to "connected" state
            const tableFilterValue = filter ?? (mergedParams as Record<string, any>).table_filter ?? '';
            const listResp = await fetchWithIdentity(urls.CATALOG_LIST_TABLES, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filter: tableFilterValue?.trim() || null }),
            });
            const listData = await listResp.json();
            if (listData.tables) {
                setTableMetadata(Object.fromEntries(
                    listData.tables.map((t: any) => [t.name, t.metadata])
                ));
            } else if (listData.status === 'error') {
                throw new Error(listData.message || 'Failed to list tables');
            }
            // Only promote to "connected" after tables are loaded
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
    }, [connectorId, mergedParams, persistCredentials, onFinish, onConnected, t]);

    // Delegated (popup-based) login flow for token-based connectors
    const popupRef = useRef<Window | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleDelegatedLogin = useCallback(() => {
        if (!delegatedLogin?.login_url || !connectorId) return;
        setIsConnecting(true);

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
        popupRef.current = popup;

        const handler = async (event: MessageEvent) => {
            if (event.data?.type !== 'df-sso-auth') return;
            window.removeEventListener('message', handler);
            if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
            popup.close();

            const { access_token, refresh_token, user } = event.data;
            if (access_token) {
                try {
                    const urls = getConnectorUrls(connectorId);
                    // Send tokens to backend token-connect endpoint
                    const connectResp = await fetchWithIdentity(urls.AUTH_TOKEN_CONNECT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
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
                    // List tables
                    const listResp = await fetchWithIdentity(urls.CATALOG_LIST_TABLES, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filter: null }),
                    });
                    const listData = await listResp.json();
                    if (listData.tables) {
                        setTableMetadata(Object.fromEntries(
                            listData.tables.map((t: any) => [t.name, t.metadata])
                        ));
                    }
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
    }, [delegatedLogin, connectorId, params, persistCredentials, onFinish, onConnected, t]);

    // Auto-connect on mount if this source has stored vault credentials.
    // Uses auth/status which auto-reconnects from vault, then lists tables.
    const autoConnectTriggered = useRef(false);
    useEffect(() => {
        if (autoConnect && connectorId && !autoConnectTriggered.current && Object.keys(tableMetadata).length === 0) {
            autoConnectTriggered.current = true;
            (async () => {
                setIsConnecting(true);
                try {
                    const urls = getConnectorUrls(connectorId);
                    // auth/status triggers auto-reconnect from vault
                    const statusResp = await fetchWithIdentity(urls.AUTH_STATUS, { method: 'GET' });
                    const statusData = await statusResp.json();
                    if (statusData.connected) {
                        // Already connected / reconnected from vault — list tables
                        const listResp = await fetchWithIdentity(urls.CATALOG_LIST_TABLES, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filter: null }),
                        });
                        const listData = await listResp.json();
                        if (listData.tables) {
                            setTableMetadata(Object.fromEntries(
                                listData.tables.map((t: any) => [t.name, t.metadata])
                            ));
                        }
                    }
                } catch (err) {
                    console.warn('Auto-connect failed for', connectorId, err);
                } finally {
                    setIsConnecting(false);
                }
            })();
        }
    }, [autoConnect, connectorId]);

    // Auto-select first table for preview when metadata loads
    useEffect(() => {
        const tableNames = Object.keys(tableMetadata);
        if (tableNames.length > 0 && (!selectedPreviewTable || !tableMetadata[selectedPreviewTable])) {
            setSelectedPreviewTable(tableNames[0]);
        }
    }, [tableMetadata]);

    // Reset import mode when switching tables
    useEffect(() => {
        if (selectedPreviewTable && tableMetadata[selectedPreviewTable]) {
            setImportMode('full');
            const metadata = tableMetadata[selectedPreviewTable];
            setSubsetConfig({ rowLimit: Math.min(1000, metadata.row_count || 1000), sortColumns: [], sortOrder: 'asc' });
        }
    }, [selectedPreviewTable]);

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

    let tableMetadataBox = [
        // Tables as chips + preview below
        tableNames.length > 0 && (
            <Box key="table-chips-preview" sx={{ mt: 1 }}>
                {/* Table chips */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
                    {tableNames.map((tableName) => {
                        const metadata = tableMetadata[tableName];
                        const isSelected = tableName === selectedPreviewTable;
                        const loaded = effectiveLoadedTables[tableName];
                        return (
                            <Chip
                                key={tableName}
                                label={tableName}
                                size="small"
                                onClick={() => setSelectedPreviewTable(tableName)}
                                icon={loaded ? <CheckIcon sx={{ fontSize: 14 }} /> : undefined}
                                sx={{
                                    cursor: 'pointer',
                                    fontSize: 11,
                                    height: 26,
                                    borderRadius: 1,
                                    ...(loaded === 'full' ? {
                                        backgroundColor: alpha(theme.palette.success.main, 0.12),
                                        borderColor: alpha(theme.palette.success.main, 0.5),
                                        color: theme.palette.success.dark,
                                        '& .MuiChip-icon': { color: theme.palette.success.main },
                                    } : loaded === 'subset' ? {
                                        backgroundColor: alpha('#f9a825', 0.15),
                                        borderColor: alpha('#f9a825', 0.5),
                                        color: '#e65100',
                                        '& .MuiChip-icon': { color: '#f9a825' },
                                    } : isSelected ? {
                                        backgroundColor: alpha(theme.palette.primary.main, 0.12),
                                        borderColor: alpha(theme.palette.primary.main, 0.5),
                                        color: theme.palette.primary.main,
                                    } : {}),
                                    border: '1px solid',
                                    borderColor: loaded === 'full' 
                                        ? alpha(theme.palette.success.main, 0.5)
                                        : loaded === 'subset' 
                                            ? alpha('#f9a825', 0.5) 
                                            : isSelected 
                                                ? alpha(theme.palette.primary.main, 0.5)
                                                : 'rgba(0,0,0,0.15)',
                                    '&:hover': {
                                        backgroundColor: loaded === 'full'
                                            ? alpha(theme.palette.success.main, 0.18)
                                            : loaded === 'subset'
                                                ? alpha('#f9a825', 0.22)
                                                : alpha(theme.palette.primary.main, 0.08),
                                    },
                                }}
                            />
                        );
                    })}
                </Box>

                {/* Preview + load controls */}
                {previewTable && selectedPreviewTable && (
                    <Box>
                        <Card variant="outlined" sx={{ pb: 0.5 }}>
                            <CustomReactTable
                                rows={previewTable.rows.slice(0, 12)}
                                columnDefs={previewTable.names.map(name => ({
                                    id: name,
                                    label: name,
                                    minWidth: 60,
                                }))}
                                rowsPerPageNum={-1}
                                compact={false}
                                isIncompleteTable={previewTable.rows.length > 12}
                                maxHeight={240}
                            />
                        </Card>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            {tableMetadata[selectedPreviewTable]?.row_count > 0 
                                ? t('db.rowsCount', { count: tableMetadata[selectedPreviewTable].row_count.toLocaleString() })
                                : t('db.sampleRowsCount', { count: previewTable.rows.length })
                            } × {previewTable.names.length} {t('db.columns')}
                        </Typography>

                        {/* Load controls */}
                        <Box sx={{ mt: 1.5, pt: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, flexWrap: 'nowrap' }}>
                            {/* Subset option - hidden when already loaded */}
                            {!effectiveLoadedTables[selectedPreviewTable] && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap' }}>
                                <Checkbox
                                    checked={importMode === 'subset'}
                                    onChange={(e) => setImportMode(e.target.checked ? 'subset' : 'full')}
                                    size="small"
                                    sx={{ p: 0.25 }}
                                />
                                <Typography variant="body2" sx={{ fontSize: 12, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                                    onClick={() => setImportMode(importMode === 'subset' ? 'full' : 'subset')}
                                >
                                    {t('db.loadSubset')}
                                </Typography>
                                {importMode === 'subset' && selectedPreviewTable && tableMetadata[selectedPreviewTable] && (() => {
                                    const metadata = tableMetadata[selectedPreviewTable];
                                    return (
                                        <>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                                                <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>{t('db.rowsLabel')}</Typography>
                                                <TextField
                                                    size="small"
                                                    type="number"
                                                    value={subsetConfig.rowLimit}
                                                    onChange={(e) => {
                                                        const value = parseInt(e.target.value) || 1;
                                                        const maxRows = metadata.row_count || 100000;
                                                        setSubsetConfig(prev => ({ ...prev, rowLimit: Math.min(Math.max(1, value), maxRows) }));
                                                    }}
                                                    slotProps={{ input: { inputProps: { min: 1, max: metadata.row_count || 100000, step: 100 } } }}
                                                    sx={{ width: 90, '& .MuiInputBase-root': { fontSize: 11, height: 26 }, '& .MuiInputBase-input': { py: 0.25, px: 0.75 } }}
                                                />
                                                <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', whiteSpace: 'nowrap' }}>/ {(metadata.row_count || '?').toLocaleString()}</Typography>
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: 400 }}>
                                                <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>{t('app.sort')}:</Typography>
                                                <Autocomplete
                                                    multiple
                                                    size="small"
                                                    options={metadata.columns.map((col: any) => col.name)}
                                                    value={subsetConfig.sortColumns}
                                                    onChange={(_, newValue) => setSubsetConfig(prev => ({ ...prev, sortColumns: newValue }))}
                                                    renderInput={(params) => (
                                                        <TextField {...params} placeholder={t('db.selectColumns')} size="small" sx={{ minWidth: 120, '& .MuiInputBase-root': { fontSize: 11, minHeight: 26, py: 0 } }} />
                                                    )}
                                                    renderTags={(value, getTagProps) =>
                                                        value.map((option, index) => (
                                                            <Chip {...getTagProps({ index })} key={option} label={option} size="small" sx={{ height: 18, fontSize: 10 }} />
                                                        ))
                                                    }
                                                    slotProps={{ paper: { sx: { fontSize: 12, '& .MuiAutocomplete-option': { fontSize: 12, py: 0.5, minHeight: 28 } } } }}
                                                    sx={{ flex: 1, minWidth: 0 }}
                                                />
                                                {subsetConfig.sortColumns.length > 0 && (
                                                    <ToggleButtonGroup
                                                        value={subsetConfig.sortOrder}
                                                        exclusive
                                                        onChange={(_, v) => { if (v) setSubsetConfig(prev => ({ ...prev, sortOrder: v })); }}
                                                        size="small"
                                                        sx={{ height: 24 }}
                                                    >
                                                        <ToggleButton value="asc" sx={{ px: 1, py: 0, fontSize: 10, textTransform: 'none' }}>↑</ToggleButton>
                                                        <ToggleButton value="desc" sx={{ px: 1, py: 0, fontSize: 10, textTransform: 'none' }}>↓</ToggleButton>
                                                    </ToggleButtonGroup>
                                                )}
                                            </Box>
                                        </>
                                    );
                                })()}
                            </Box>}
                            {/* Load Table button */}
                            {effectiveLoadedTables[selectedPreviewTable] ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                                <Button
                                    variant="outlined"
                                    size="medium"
                                    disabled
                                    startIcon={<CheckIcon sx={{ fontSize: 16 }} />}
                                    sx={{ textTransform: 'none', fontSize: 13, px: 3, height: 34,
                                        color: 'success.main', borderColor: 'success.main',
                                        '&.Mui-disabled': { color: 'success.main', borderColor: 'success.main', opacity: 0.8 },
                                    }}
                                >
                                    {effectiveLoadedTables[selectedPreviewTable] === 'subset' ? t('db.subsetLoaded') : t('db.loaded')}
                                </Button>
                                <Button
                                    variant="text"
                                    size="small"
                                    onClick={() => {
                                        const tableName = selectedPreviewTable;
                                        // Find and remove the workspace table that matches this database table
                                        const wt = workspaceTables.find(t => t.source?.databaseTable === tableName && t.source?.type === 'database');
                                        if (wt) {
                                            dispatch(dfActions.deleteTable(wt.id));
                                        }
                                        setLoadedTables(prev => {
                                            const next = { ...prev };
                                            delete next[tableName];
                                            return next;
                                        });
                                    }}
                                    sx={{ textTransform: 'none', fontSize: 11, px: 1, minWidth: 0, height: 28, color: 'text.secondary',
                                        '&:hover': { color: 'error.main', backgroundColor: 'rgba(211,47,47,0.04)' },
                                    }}
                                >
                                    {t('db.unload')}
                                </Button>
                            </Box>
                            ) : (
                            <Button
                                variant="contained"
                                size="medium"
                                sx={{ textTransform: 'none', fontSize: 13, px: 4, height: 34, flexShrink: 0 }}
                                onClick={() => {
                                    const tableName = selectedPreviewTable;
                                    const metadata = tableMetadata[tableName];
                                    if (!metadata) return;

                                    const importOptions: any = {};
                                    if (importMode === 'subset') {
                                        importOptions.rowLimit = subsetConfig.rowLimit;
                                        if (subsetConfig.sortColumns.length > 0) {
                                            importOptions.sortColumns = subsetConfig.sortColumns;
                                            importOptions.sortOrder = subsetConfig.sortOrder;
                                        }
                                    }

                                    const sampleRows = metadata.sample_rows || [];
                                    const columns = metadata.columns || [];
                                    const tableObj: DictTable = {
                                        kind: 'table' as const,
                                        id: tableName.split('.').pop() || tableName,
                                        displayId: tableName,
                                        names: columns.map((c: any) => c.name),
                                        metadata: columns.reduce((acc: Record<string, any>, col: any) => ({
                                            ...acc,
                                            [col.name]: { type: 'string' as any, semanticType: '', levels: [] }
                                        }), {}),
                                        rows: sampleRows,
                                        virtual: { tableId: tableName.split('.').pop() || tableName, rowCount: metadata.row_count || sampleRows.length },
                                        anchored: true,
                                        attachedMetadata: '',
                                        source: {
                                            type: 'database' as const,
                                            databaseTable: tableName,
                                            canRefresh: true,
                                            lastRefreshed: Date.now(),
                                            connectorId: connectorId,
                                        },
                                    };

                                    onImport();
                                    dispatch(loadTable({
                                        table: tableObj,
                                        connectorId,
                                        sourceTableName: tableName,
                                        importOptions: Object.keys(importOptions).length > 0 ? importOptions : undefined,
                                    })).unwrap()
                                        .then((result) => {
                                            setLoadedTables(prev => ({ ...prev, [tableName]: importMode }));
                                            onFinish("success", `Loaded table "${tableName}"`, [result.table.id]);
                                        })
                                        .catch((error) => {
                                            console.error('Failed to load data:', error);
                                            onFinish("error", `Failed to load "${tableName}": ${error}`);
                                        });
                                }}
                            >
                                {importMode === 'subset' ? t('db.loadTableSubset') : t('db.loadTableBtn')}
                            </Button>
                            )}
                        </Box>
                    </Box>
                )}
            </Box>
        ),
    ]

    const isConnected = Object.keys(tableMetadata).length > 0;

    return (
        <Box sx={{p: 0, pb: 2}}>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.7)"
            }}>
                <CircularProgress size={20} />
            </Box>}
            {isConnected ? (
                // Connected state: show connection info + table browser
                <Box>
                    {/* Header: source name · connection params · disconnect */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
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
                            variant="outlined" size="small" color="inherit"
                            sx={{ textTransform: "none", fontSize: 11, height: 26, minWidth: 0, color: 'text.secondary', borderColor: 'rgba(0,0,0,0.2)' }}
                            onClick={() => {
                                fetchWithIdentity(getConnectorUrls(connectorId!).AUTH_DISCONNECT, {
                                    method: 'POST',
                                }).catch(() => {});
                                setTableMetadata({});
                                dispatch(dfActions.updateDataLoaderConnectParam({dataLoaderType, paramName: 'table_filter', paramValue: ''}));
                                onDisconnected?.();
                            }}
                        >
                            {t('db.disconnect')}
                        </Button>
                    </Box>
                    {/* Search bar: filter + refresh in a pill-shaped container */}
                    <Box sx={{
                        display: 'flex', alignItems: 'center', gap: 0.5,
                        mb: 1.5, px: 1.5, py: 0.5,
                        borderRadius: 2,
                        border: '1px solid', borderColor: 'divider',
                        backgroundColor: 'rgba(0,0,0,0.02)',
                        maxWidth: 420,
                    }}>
                        <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
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
                        <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
                        <Button
                            variant="text" size="small"
                            sx={{ textTransform: "none", fontSize: 11, minWidth: 0, px: 1, color: 'primary.main', fontWeight: 600, whiteSpace: 'nowrap' }}
                            onClick={() => {
                                const val = filterInputRef.current?.value ?? params.table_filter ?? '';
                                dispatch(dfActions.updateDataLoaderConnectParam({dataLoaderType, paramName: 'table_filter', paramValue: val}));
                                connectAndListTables(val);
                            }}
                        >
                            {t('db.refresh')}
                        </Button>
                    </Box>
                    
                    {tableMetadataBox}
                </Box>
            ) : (
                // Not connected: show connection forms
                <>
                    <Typography variant="body2" sx={{fontSize: 12, color: 'secondary.main', fontWeight: 600, mt: 1}}>
                        {dataLoaderType}
                    </Typography>
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
                        const shrinkProps = { shrink: true };
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
                                <Box sx={{ ...sectionSx, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2 }}>
                                    {paramDefs.map((paramDef) => (
                                        <TextField
                                            key={paramDef.name}
                                            sx={inputSx}
                                            variant="standard" size="small" fullWidth
                                            InputLabelProps={shrinkProps}
                                            label={paramDef.name}
                                            type={paramDef.type === 'password' ? 'password' : 'text'}
                                            required={paramDef.required}
                                            value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                            placeholder={paramDef.description || (paramDef.default ? `${paramDef.default}` : '')}
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
                            <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2 }}>
                                {tierParams.map((paramDef) => (
                                    <TextField
                                        key={paramDef.name}
                                        sx={inputSx}
                                        variant="standard" size="small" fullWidth
                                        InputLabelProps={shrinkProps}
                                        label={paramDef.name}
                                        type={paramDef.type === 'password' ? 'password' : 'text'}
                                        required={paramDef.required}
                                        value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                        placeholder={paramDef.description || (paramDef.default ? `${paramDef.default}` : '')}
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
                                                <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${authParams.length}, 1fr)`, gap: 2 }}>
                                                    {authParams.map((paramDef) => (
                                                        <TextField
                                                            key={paramDef.name}
                                                            sx={inputSx}
                                                            variant="standard" size="small" fullWidth
                                                            InputLabelProps={shrinkProps}
                                                            label={paramDef.name}
                                                            type={paramDef.type === 'password' ? 'password' : 'text'}
                                                            value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                                            placeholder={paramDef.description || (paramDef.default ? `${paramDef.default}` : '')}
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
                                                    {t('db.connect', { suffix: (params.table_filter || '').trim() ? t('db.withFilter') : '' })}
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
                                                {t('db.connect', { suffix: (params.table_filter || '').trim() ? t('db.withFilter') : '' })}
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
                    {authInstructions.trim() && (
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
                            <Markdown>{authInstructions.trim()}</Markdown>
                        </Box>
                    )}</>
            )}
        </Box>
    );
}