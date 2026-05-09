// TableManager.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Button,
  Box,
  TextField,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  useTheme,
} from '@mui/material';

import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { apiRequest, type ApiError } from '../app/apiClient';
import { getErrorMessage } from '../app/errorCodes';
import { extractErrorMessage } from '../app/errorHandler';
import { borderColor } from '../app/tokens';
import { CustomReactTable } from './ReactTable';
import { DataFrameTable } from './DataFrameTable';
import { ConnectorTablePreview } from '../components/ConnectorTablePreview';
import { DictTable } from '../components/ComponentType';
import Markdown from 'markdown-to-jsx';

import { useDispatch, useSelector } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { DataFormulatorState } from '../app/dfSlice';
import { AppDispatch } from '../app/store';

/** Extract a user-visible error message from a connector data payload. */
function extractConnectError(body: any, fallback: string): string {
    if (body.connection_error && typeof body.connection_error === 'object' && body.connection_error.code) {
        return getErrorMessage(body.connection_error as ApiError);
    }
    if (body.error && typeof body.error === 'object' && body.error.message) {
        return getErrorMessage(body.error as ApiError);
    }
    return body.message ?? fallback;
}


// ---------------------------------------------------------------------------

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
    onFinish: (status: "success" | "error" | "warning", message: string, importedTables?: string[]) => void,
    onConnected?: () => void,
    /** Called when the user clicks Delete. Receives the connectorId. */
    onDelete?: (connectorId: string) => void,
    /** Called before the connect step. Returns the effective connectorId to use.
     *  Used by AddConnectionPanel to create the connector before connecting. */
    onBeforeConnect?: (params: Record<string, any>) => Promise<string>,
    /** When true, sensitive fields render with a ••••• placeholder so the
     *  user knows credentials are stored on the server (and sees the field
     *  is intentionally empty for security, not a missing config). */
    hasStoredCredentials?: boolean,
}> = ({dataLoaderType, loaderType, paramDefs, authInstructions, connectorId, autoConnect, ssoAutoConnect, delegatedLogin, authMode, onImport, onFinish, onConnected, onDelete, onBeforeConnect, hasStoredCredentials}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();
    const loaderTypeKey = loaderType || dataLoaderType;
    const getParamPlaceholder = (paramDef: {name: string; default?: string; description?: string}) => {
        // Sensitive fields whose stored credentials we have on the server
        // get a masked dot placeholder — signals "a value is set, leave
        // blank to keep, type to replace."
        if (
            hasStoredCredentials
            && paramDefs.find(p => p.name === paramDef.name)?.tier === 'auth'
            && (paramDefs.find(p => p.name === paramDef.name)?.sensitive
                || paramDefs.find(p => p.name === paramDef.name)?.type === 'password')
        ) {
            return '••••••••';
        }
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

    // Connection timeout in milliseconds (30 seconds)
    const CONNECTION_TIMEOUT_MS = 30_000;

    // Helper: connect via data connector. Catalog browsing happens in the
    // data-source sidebar after the dialog closes; this form only validates
    // the connection and hands off via onConnected.
    const connectAndListTables = useCallback(async () => {
        setIsConnecting(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
        try {
            // Strip table_filter from params sent to connect (it's a catalog-side filter)
            const { table_filter: _tf, ...connectParams } = mergedParams as Record<string, any>;
            // If onBeforeConnect is provided (e.g. AddConnectionPanel), create the connector first
            if (onBeforeConnect) {
                connectorIdRef.current = await onBeforeConnect(connectParams);
            }
            const { data: connectData } = await apiRequest<any>(CONNECTOR_ACTION_URLS.CONNECT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: connectorIdRef.current, params: connectParams, persist: persistCredentials }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (connectData.status !== 'connected') {
                throw new Error(extractConnectError(connectData, 'Connection failed'));
            }
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
    }, [mergedParams, persistCredentials, onFinish, onConnected, onBeforeConnect, t]);

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
                    await apiRequest('/api/auth/tokens/save', {
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
                    const { data: connectData } = await apiRequest<any>(CONNECTOR_ACTION_URLS.CONNECT, {
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
                    if (connectData.status !== 'connected') {
                        throw new Error(extractConnectError(connectData, 'Token connection failed'));
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
                const { data: statusData } = await apiRequest<any>(CONNECTOR_ACTION_URLS.GET_STATUS, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connector_id: connectorIdRef.current }),
                });
                if (statusData.connected) {
                    await fetchCatalogNodes();
                } else if (statusData.has_stored_credentials || statusData.sso_available) {
                    // Vault creds or SSO token available — attempt auto-connect.
                    // Backend _inject_sso_token handles SSO token passthrough transparently.
                    const { data: connectData } = await apiRequest<any>(CONNECTOR_ACTION_URLS.CONNECT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ connector_id: connectorIdRef.current, params: {}, persist: !statusData.sso_available }),
                    });
                    if (connectData.status === 'connected') {
                        await fetchCatalogNodes();
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
            apiRequest<any>(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connector_id: connectorIdRef.current,
                    source_table: ref,
                    limit: 10,
                }),
                signal: controller.signal,
            })
                .then(({ data }) => {
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
                if (result.truncated) {
                    const count = (result.originalRowCount ?? 0).toLocaleString();
                    onFinish("warning", t('sidebar.loadedTableTruncated', { name: ref.name, count }), [result.table.id]);
                } else {
                    onFinish("success", `Loaded table "${ref.name}"`, [result.table.id]);
                }
            })
            .catch((error) => {
                console.error('Failed to load data:', error);
                onFinish("error", `Failed to load "${ref.name}": ${extractErrorMessage(error)}`);
            });
    }, [selectedPreviewTable, tableMetadata, getSourceTableRef, onImport, onFinish, dispatch]);


    const isConnected = catalogTree.length > 0 || Object.keys(tableMetadata).length > 0;

    const handleCatalogSearchChange = useCallback((filterValue: string) => {
        setCatalogSearch(filterValue);
        if (serverSearchActive) {
            setServerSearchActive(false);
            setSearchCatalogTree([]);
            setExpandedItems([]);
        }
    }, [serverSearchActive]);

    const clearCatalogSearch = useCallback(() => {
        setCatalogSearch('');
        setServerSearchActive(false);
        setSearchCatalogTree([]);
        setExpandedItems([]);
    }, []);

    const runCatalogSearch = useCallback(async (filterValue: string) => {
        const query = filterValue.trim();
        setCatalogSearch(filterValue);
        dispatch(dfActions.updateDataLoaderConnectParam({
            dataLoaderType,
            paramName: 'table_filter',
            paramValue: filterValue,
        }));
        if (!query) {
            clearCatalogSearch();
            return;
        }
        setIsCatalogSearching(true);
        setServerSearchActive(true);
        setSearchCatalogTree([]);
        setSelectedPreviewTable(null);
        setSelectedTreeNode(null);
        try {
            const { data } = await apiRequest<any>(CONNECTOR_ACTION_URLS.SEARCH_CATALOG, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: connectorIdRef.current, query, limit: 100 }),
            });
            const tree = (data.tree || []) as CatalogTreeNode[];
            setSearchCatalogTree(tree);
            setTableMetadata(prev => ({ ...prev, ...collectTreeMetadata(tree) }));
            setExpandedItems(collectNamespaceIds(tree));
        } catch (error: any) {
            onFinish("error", error.message || 'Failed to load catalog');
        } finally {
            setIsCatalogSearching(false);
        }
    }, [clearCatalogSearch, collectTreeMetadata, dataLoaderType, dispatch, onFinish]);

    const handleDisconnect = useCallback(async () => {
        const cid = connectorIdRef.current;
        if (cid) {
            await apiRequest(CONNECTOR_ACTION_URLS.DISCONNECT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: cid }),
            }).catch(() => {});
        }
        setCatalogTree([]);
        setSearchCatalogTree([]);
        setCatalogSearch('');
        setServerSearchActive(false);
        setIsCatalogSearching(false);
        setTableMetadata({});
        setSelectedPreviewTable(null);
        setSelectedTreeNode(null);
        setExpandedItems([]);
    }, []);

    // Split catalog tree into dataset vs dashboard subsets for tabbed view
    const displayedCatalogTree = serverSearchActive ? searchCatalogTree : catalogTree;
    const datasetNodes = useMemo(() => displayedCatalogTree.filter(n => n.node_type !== 'table_group'), [displayedCatalogTree]);
    const dashboardNodes = useMemo(() => displayedCatalogTree.filter(n => n.node_type === 'table_group'), [displayedCatalogTree]);
    const hasBothTabs = datasetNodes.length > 0 && dashboardNodes.length > 0;
    const [catalogTab, setCatalogTab] = useState(0);

    const filterTreeByName = useCallback((nodes: CatalogTreeNode[], keyword: string): CatalogTreeNode[] => {
        if (!keyword) return nodes;
        const lc = keyword.toLowerCase();
        return nodes.reduce<CatalogTreeNode[]>((acc, node) => {
            if (node.node_type === 'namespace') {
                const filteredChildren = filterTreeByName(node.children || [], keyword);
                if (filteredChildren.length > 0) {
                    acc.push({ ...node, children: filteredChildren });
                }
            } else if (node.node_type === 'load_more') {
                acc.push(node);
            } else {
                if (node.name.toLowerCase().includes(lc)) {
                    acc.push(node);
                }
            }
            return acc;
        }, []);
    }, []);

    return (
        <Box sx={{p: 0, pb: 2, display: 'flex', flexDirection: 'column' }}>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.7)"
            }}>
                <CircularProgress size={20} />
            </Box>}
            {/* Connection form. Catalog browsing + table loading live in
                the data-source sidebar — this dialog is for create / edit /
                re-auth only. */}
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
        </Box>
    );
}