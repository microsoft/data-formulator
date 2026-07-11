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
  IconButton,
  Tooltip,
    Autocomplete,
    Radio,
    RadioGroup,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { apiRequest, type ApiError } from '../app/apiClient';
import { getErrorMessage } from '../app/errorCodes';
import Markdown from 'markdown-to-jsx';

import { useDispatch, useSelector } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { DataFormulatorState } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { ConnectorAuthPath } from '../components/ComponentType';

const KUSTO_HELP_CLUSTER = 'https://help.kusto.windows.net';

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

type DraftTextFieldProps = Omit<React.ComponentProps<typeof TextField>, 'value' | 'onChange'> & {
    value: string;
    onDraftChange: (value: string) => void;
    onCommit: (value: string) => void;
};

// Keep keystroke state inside the active field. Connector-wide state is
// committed on blur, avoiding a Redux update and full form render per key.
const DraftTextField = React.memo(function DraftTextField({
    value,
    onDraftChange,
    onCommit,
    ...props
}: DraftTextFieldProps) {
    const [draft, setDraft] = useState(value);

    useEffect(() => setDraft(value), [value]);

    return (
        <TextField
            {...props}
            value={draft}
            onChange={(event) => {
                const nextValue = event.target.value;
                setDraft(nextValue);
                onDraftChange(nextValue);
            }}
            onBlur={() => onCommit(draft)}
        />
    );
});

// ---------------------------------------------------------------------------

export const DataLoaderForm: React.FC<{
    dataLoaderType: string,
    /** Loader registry key (e.g. "mysql") for i18n lookups. Falls back to dataLoaderType. */
    loaderType?: string,
    paramDefs: {name: string, default?: string | number | boolean, type: string, required: boolean, description?: string, sensitive?: boolean, tier?: 'connection' | 'auth' | 'filter'}[],
    authInstructions: string,
    connectorId?: string,
    autoConnect?: boolean,
    /** When true, attempt SSO token passthrough on mount (no popup). */
    ssoAutoConnect?: boolean,
    delegatedLogin?: { login_url: string; label?: string } | null,
    authMode?: string,
    authPaths?: ConnectorAuthPath[],
    connectionName?: {
        label: string,
        value: string,
        placeholder: string,
        onChange: (value: string) => void,
    },
    formTitle?: React.ReactNode,
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
    /** When true, lay parameters out in a single column and tighten spacing
     *  so the form fits inside a chat card (design 38). */
    compact?: boolean,
    /** When true, suppress the connector's built-in authInstructions block so
     *  agent-authored setup guidance can replace it (design 38). */
    hideInstructions?: boolean,
}> = ({dataLoaderType, loaderType, paramDefs, authInstructions, connectorId, autoConnect, ssoAutoConnect, delegatedLogin, authMode, authPaths = [], connectionName, formTitle, onImport, onFinish, onConnected, onDelete, onBeforeConnect, hasStoredCredentials, compact = false, hideInstructions = false}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const loaderTypeKey = loaderType || dataLoaderType;
    const getParamPlaceholder = (paramDef: {name: string; default?: string | number | boolean; description?: string}) => {
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

    // Materialize declared defaults and the default authentication path as
    // actual form values rather than placeholders. Existing user-entered or
    // pinned values always win.
    useEffect(() => {
        for (const paramDef of paramDefs) {
            if (params[paramDef.name] === undefined && paramDef.default !== undefined) {
                dispatch(dfActions.updateDataLoaderConnectParam({
                    dataLoaderType,
                    paramName: paramDef.name,
                    paramValue: String(paramDef.default),
                }));
            }
        }
        if (authPaths.length > 0 && !params._auth_path) {
            const defaultPath = authPaths.find(path => path.default) || authPaths[0];
            dispatch(dfActions.updateDataLoaderConnectParam({
                dataLoaderType,
                paramName: '_auth_path',
                paramValue: defaultPath.id,
            }));
        }
    }, [authPaths, dataLoaderType, dispatch, paramDefs, params]);

    let [isConnecting, setIsConnecting] = useState(false);
    const [persistCredentials, setPersistCredentials] = useState(true);

    // High-level progress shown while connecting (e.g. Kusto reporting which
    // database it's currently listing). Polled from the backend during the
    // connect request; cleared when it resolves.
    const [connectProgress, setConnectProgress] = useState('');
    const [databaseOptions, setDatabaseOptions] = useState<string[]>([]);
    const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
    const [databaseDiscoveryError, setDatabaseDiscoveryError] = useState('');
    const [databaseMenuOpen, setDatabaseMenuOpen] = useState(false);

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
    const draftParamsRef = useRef<Record<string, string>>({});
    useEffect(() => { draftParamsRef.current = {}; }, [dataLoaderType]);
    const getCurrentParams = useCallback(
        () => ({ ...mergedParams, ...draftParamsRef.current }),
        [mergedParams],
    );
    const updateParamDraft = useCallback((name: string, value: string) => {
        draftParamsRef.current[name] = value;
    }, []);
    const commitParamDraft = useCallback((name: string, value: string) => {
        if (sensitiveParamNames.has(name)) {
            setSensitiveParams(previous => ({ ...previous, [name]: value }));
        } else {
            dispatch(dfActions.updateDataLoaderConnectParam({
                dataLoaderType,
                paramName: name,
                paramValue: value,
            }));
        }
    }, [dataLoaderType, dispatch, sensitiveParamNames]);

    const loadKustoDatabases = useCallback(async (paramOverrides?: Record<string, any>) => {
        const discoveryParams = { ...getCurrentParams(), ...paramOverrides };
        if (!String(discoveryParams.kusto_cluster || '').trim() || isLoadingDatabases) return;
        setDatabaseMenuOpen(true);
        setIsLoadingDatabases(true);
        setDatabaseDiscoveryError('');
        setDatabaseOptions([]);
        try {
            const { data } = await apiRequest<any>(CONNECTOR_ACTION_URLS.DISCOVER_OPTIONS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    loader_type: loaderTypeKey,
                    connector_id: connectorIdRef.current,
                    param_name: 'kusto_database',
                    params: discoveryParams,
                }),
            });
            setDatabaseOptions(data.options || []);
        } catch (error: any) {
            setDatabaseDiscoveryError(
                error?.apiError?.message
                || error?.message
                || t('db.loadDatabasesFailed', { defaultValue: 'Could not load databases; enter the name manually.' }),
            );
        } finally {
            setIsLoadingDatabases(false);
        }
    }, [getCurrentParams, isLoadingDatabases, loaderTypeKey, t]);

    // Connection timeout in milliseconds (30 seconds)
    const CONNECTION_TIMEOUT_MS = 30_000;

    // Helper: connect via data connector. Catalog browsing happens in the
    // data-source sidebar after the dialog closes; this form only validates
    // the connection and hands off via onConnected.
    const connectAndListTables = useCallback(async () => {
        setIsConnecting(true);
        setConnectProgress('');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
        // Poll for high-level listing progress (e.g. which Kusto database is
        // being queried) so the spinner isn't silent on slow multi-database
        // sources. Best-effort: any failure is ignored.
        let cancelledPoll = false;
        const pollProgress = async () => {
            const cid = connectorIdRef.current;
            if (cancelledPoll || !cid) return;
            try {
                const { data } = await apiRequest<any>(CONNECTOR_ACTION_URLS.GET_CATALOG_PROGRESS, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connector_id: cid }),
                });
                if (!cancelledPoll && data?.message) setConnectProgress(data.message);
            } catch { /* progress is best-effort */ }
        };
        const progressTimer = setInterval(pollProgress, 700);
        try {
            // Strip table_filter from params sent to connect (it's a catalog-side filter)
            const { table_filter: _tf, ...connectParams } = getCurrentParams() as Record<string, any>;
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
            cancelledPoll = true;
            clearInterval(progressTimer);
            setConnectProgress('');
            setIsConnecting(false);
        }
    }, [getCurrentParams, persistCredentials, onFinish, onConnected, onBeforeConnect, t]);

    // Delegated (popup-based) login flow for token-based connectors
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleDelegatedLogin = useCallback(async () => {
        if (!delegatedLogin?.login_url) return;
        setIsConnecting(true);
        const currentParams = getCurrentParams();
        try {
            // If onBeforeConnect is provided (e.g. AddConnectionPanel), create the connector first
            if (onBeforeConnect) {
                const { table_filter: _tf, ...connectParams } = currentParams as Record<string, any>;
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
            if (p.tier === 'auth' && !p.sensitive && p.type !== 'password' && currentParams[p.name]) {
                url.searchParams.set(p.name, currentParams[p.name]);
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
                            params: getCurrentParams(),  // include any filled-in params (e.g. url)
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
    }, [delegatedLogin, getCurrentParams, persistCredentials, onFinish, onConnected, onBeforeConnect, t]);


    // Auto-connect on mount from vault credentials or SSO token passthrough.
    // Catalog browsing happens in the sidebar after onConnected fires.
    const autoConnectTriggered = useRef(false);
    useEffect(() => {
        const shouldAutoConnect = (autoConnect || ssoAutoConnect) && connectorIdRef.current && !autoConnectTriggered.current;
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
                    onConnected?.();
                } else if (statusData.has_stored_credentials || statusData.sso_available) {
                    // Vault creds or SSO token available — attempt auto-connect.
                    // Backend _inject_sso_token handles SSO token passthrough transparently.
                    const { data: connectData } = await apiRequest<any>(CONNECTOR_ACTION_URLS.CONNECT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ connector_id: connectorIdRef.current, params: {}, persist: !statusData.sso_available }),
                    });
                    if (connectData.status === 'connected') {
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

    return (
        <Box sx={{p: 0, pb: 2, display: 'flex', flexDirection: 'column' }}>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.85)"
            }}>
                <CircularProgress size={20} />
                {connectProgress && (
                    <Typography sx={{
                        fontSize: 12.5, fontWeight: 500, color: 'text.primary',
                        textAlign: 'center', px: 1.5, py: 0.5, maxWidth: 380, wordBreak: 'break-word',
                        backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: 1,
                    }}>
                        {connectProgress}
                    </Typography>
                )}
            </Box>}
            {/* Connection form. Catalog browsing + table loading live in
                the data-source sidebar — this dialog is for create / edit /
                re-auth only. */}
            <>
                {formTitle && (
                    <Typography sx={{ fontSize: 14, lineHeight: 1.4, fontWeight: 600, color: 'text.primary', mb: 1 }}>
                        {formTitle}
                    </Typography>
                )}
                {!onBeforeConnect && (
                    <Typography variant="body2" sx={{fontSize: 12, color: 'secondary.main', fontWeight: 600, mt: 1}}>
                        {dataLoaderType}
                    </Typography>
                    )}
                    {(() => {
                        const hasTiers = paramDefs.some(p => p.tier);
                        const renderTimelineStep = (
                            step: number,
                            title: React.ReactNode,
                            content: React.ReactNode,
                            isLast = false,
                        ) => (
                            <Box sx={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', columnGap: 1.25 }}>
                                <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                                    <Box sx={{
                                        mt: 0.1,
                                        width: 18,
                                        height: 18,
                                        borderRadius: '50%',
                                        bgcolor: 'background.paper',
                                        border: '1px solid',
                                        borderColor: 'primary.main',
                                        color: 'primary.main',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        zIndex: 1,
                                    }}>
                                        <Typography
                                            component="span"
                                            variant="caption"
                                            sx={(theme) => ({
                                                fontFamily: theme.typography.fontFamily,
                                                fontSize: 10,
                                                lineHeight: 1,
                                                fontWeight: theme.typography.fontWeightMedium,
                                                fontVariantNumeric: 'tabular-nums',
                                            })}
                                        >
                                            {step}
                                        </Typography>
                                    </Box>
                                    {!isLast && (
                                        <Box sx={{
                                            position: 'absolute',
                                            top: 18,
                                            bottom: -2,
                                            width: '1px',
                                            bgcolor: 'divider',
                                        }} />
                                    )}
                                </Box>
                                <Box sx={{ pb: isLast ? 0 : 2.25, minWidth: 0 }}>
                                    {title && (
                                        <Typography sx={{ fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'text.primary', mb: 0.5 }}>
                                            {title}
                                        </Typography>
                                    )}
                                    {content}
                                </Box>
                            </Box>
                        );
                        // Keep Material UI's native colors, spacing, focus,
                        // label, and placeholder treatments. Only compact the
                        // form copy to the surrounding 12px type scale.
                        const inputSx = {
                            '& .MuiInputBase-root': { fontSize: 12 },
                            '& .MuiInputBase-input': { fontSize: 12 },
                            '& .MuiInputBase-input::placeholder': { fontSize: 12 },
                        };
                        const labelShrinkSlotProps = { inputLabel: { shrink: true } };
                        const paramGridSx = {
                            display: 'grid',
                            // Compact (inline chat) mode packs related fields two-up
                            // (host|port, user|password, database|table_filter) so
                            // the form stays short; the tier headers group each pair.
                            gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(2, minmax(0, 280px))',
                            columnGap: compact ? 1.5 : 2,
                            rowGap: compact ? 1.25 : 2.25,
                            maxWidth: compact ? '100%' : 576,
                        };
                        if (!hasTiers) {
                            // Legacy: no tier field, render flat grid
                            return (
                                <Box sx={{ ...paramGridSx, mt: 1 }}>
                                    {paramDefs.map((paramDef) => (
                                        <DraftTextField
                                            key={paramDef.name}
                                            sx={inputSx}
                                            variant="standard" size="small" fullWidth
                                            slotProps={labelShrinkSlotProps}
                                            label={paramDef.name}
                                            type={paramDef.type === 'password' ? 'password' : 'text'}
                                            required={paramDef.required}
                                            value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                            placeholder={getParamPlaceholder(paramDef)}
                                            onDraftChange={(value) => updateParamDraft(paramDef.name, value)}
                                            onCommit={(value) => commitParamDraft(paramDef.name, value)}
                                        />
                                    ))}
                                </Box>
                            );
                        }

                        const renderParamGrid = (tierParams: typeof paramDefs) => {
                            // Kusto cluster field: manual URL input plus a
                            // public sample-cluster hint. The hint is never
                            // prefilled; selecting it explicitly starts database
                            // discovery and moves the user to the next field.
                            const isKustoCluster = (name: string) =>
                                loaderTypeKey === 'kusto' && name === 'kusto_cluster';
                            const isKustoDatabase = (name: string) =>
                                loaderTypeKey === 'kusto' && name === 'kusto_database';
                            return (
                            <Box sx={paramGridSx}>
                                {tierParams.map((paramDef) => (
                                    isKustoCluster(paramDef.name) ? (
                                        <Autocomplete
                                            key={paramDef.name}
                                            freeSolo
                                            options={[KUSTO_HELP_CLUSTER]}
                                            value={params[paramDef.name] ?? ''}
                                            onChange={(_event, value) => {
                                                dispatch(dfActions.updateDataLoaderConnectParam({
                                                    dataLoaderType,
                                                    paramName: paramDef.name,
                                                    paramValue: value ?? '',
                                                }));
                                                if (value === KUSTO_HELP_CLUSTER) {
                                                    void loadKustoDatabases({ kusto_cluster: value });
                                                }
                                            }}
                                            onInputChange={(_event, value, reason) => {
                                                if (reason === 'input') {
                                                    setDatabaseOptions([]);
                                                    dispatch(dfActions.updateDataLoaderConnectParam({
                                                        dataLoaderType,
                                                        paramName: paramDef.name,
                                                        paramValue: value,
                                                    }));
                                                }
                                            }}
                                            renderInput={(inputParams) => (
                                                <TextField
                                                    {...inputParams}
                                                    sx={inputSx}
                                                    variant="standard" size="small" fullWidth
                                                    slotProps={labelShrinkSlotProps}
                                                    label={paramDef.name}
                                                    required={paramDef.required}
                                                    placeholder={getParamPlaceholder(paramDef)}
                                                    InputProps={{
                                                        ...inputParams.InputProps,
                                                        endAdornment: (
                                                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                                {inputParams.InputProps.endAdornment}
                                                                <Tooltip title={t('db.findClusterPortal', { defaultValue: 'Find your cluster in the Azure portal' })}>
                                                                    <IconButton size="small" component="a" href="https://portal.azure.com/#browse/Microsoft.Kusto%2Fclusters" target="_blank" rel="noopener noreferrer">
                                                                        <OpenInNewIcon sx={{ fontSize: 16 }} />
                                                                    </IconButton>
                                                                </Tooltip>
                                                            </Box>
                                                        ),
                                                    }}
                                                />
                                            )}
                                            slotProps={{
                                                paper: {
                                                    sx: {
                                                        '& .MuiAutocomplete-option': { fontSize: 12, minHeight: 32, py: 0.5 },
                                                    },
                                                },
                                            }}
                                        />
                                    ) : isKustoDatabase(paramDef.name) ? (
                                        <Autocomplete
                                            key={paramDef.name}
                                            freeSolo
                                            open={databaseMenuOpen}
                                            onOpen={() => {
                                                setDatabaseMenuOpen(true);
                                                if (databaseOptions.length === 0 && !isLoadingDatabases) {
                                                    void loadKustoDatabases();
                                                }
                                            }}
                                            onClose={(_event, reason) => {
                                                if (!isLoadingDatabases && reason !== 'blur') {
                                                    setDatabaseMenuOpen(false);
                                                }
                                            }}
                                            options={databaseOptions}
                                            loading={isLoadingDatabases}
                                            loadingText={(
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, fontSize: 12 }}>
                                                    <CircularProgress size={14} />
                                                    {t('db.loadingDatabases', { defaultValue: 'Loading databases…' })}
                                                </Box>
                                            )}
                                            noOptionsText={databaseDiscoveryError || t('db.noDatabasesFound', { defaultValue: 'No databases found; enter a name manually.' })}
                                            value={params[paramDef.name] ?? ''}
                                            onChange={(_event, value) => {
                                                dispatch(dfActions.updateDataLoaderConnectParam({
                                                    dataLoaderType,
                                                    paramName: paramDef.name,
                                                    paramValue: value ?? '',
                                                }));
                                            }}
                                            onInputChange={(_event, value, reason) => {
                                                if (reason === 'input') {
                                                    dispatch(dfActions.updateDataLoaderConnectParam({
                                                        dataLoaderType,
                                                        paramName: paramDef.name,
                                                        paramValue: value,
                                                    }));
                                                }
                                            }}
                                            renderInput={(inputParams) => (
                                                <TextField
                                                    {...inputParams}
                                                    sx={inputSx}
                                                    variant="standard" size="small" fullWidth
                                                    slotProps={labelShrinkSlotProps}
                                                    label={paramDef.name}
                                                    required={paramDef.required}
                                                    placeholder={getParamPlaceholder(paramDef)}
                                                    error={!!databaseDiscoveryError}
                                                    helperText={databaseDiscoveryError}
                                                />
                                            )}
                                            slotProps={{
                                                paper: {
                                                    sx: {
                                                        '& .MuiAutocomplete-option': { fontSize: 12, minHeight: 32, py: 0.5 },
                                                        '& .MuiAutocomplete-noOptions': { fontSize: 12, py: 1 },
                                                        '& .MuiAutocomplete-loading': { fontSize: 12, py: 1 },
                                                    },
                                                },
                                            }}
                                        />
                                    ) : (
                                    <DraftTextField
                                        key={paramDef.name}
                                        sx={inputSx}
                                        variant="standard" size="small" fullWidth
                                        slotProps={labelShrinkSlotProps}
                                        label={paramDef.name}
                                        type={paramDef.type === 'password' ? 'password' : 'text'}
                                        required={paramDef.required}
                                        value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                        placeholder={getParamPlaceholder(paramDef)}
                                        onDraftChange={(value) => updateParamDraft(paramDef.name, value)}
                                        onCommit={(value) => commitParamDraft(paramDef.name, value)}
                                    />
                                    )
                                ))}
                            </Box>
                            );
                        };

                        const connectionParams = paramDefs.filter(p => p.tier === 'connection');
                        const filterParams = paramDefs.filter(p => p.tier === 'filter');
                        const authParams = paramDefs.filter(p => p.tier === 'auth');
                        const selectedAuthPath = authPaths.find(path => path.id === params._auth_path)
                            || authPaths.find(path => path.default)
                            || authPaths[0];
                        const selectedAuthFieldNames = new Set(selectedAuthPath?.fields || authParams.map(p => p.name));
                        const selectedAuthParams = authParams.filter(p => selectedAuthFieldNames.has(p.name));
                        const hasDelegated = !!delegatedLogin?.login_url;
                        const connectLabel = onBeforeConnect
                            ? t('db.createConnector', { defaultValue: 'Create Connector' })
                            : t('db.connect', { suffix: (params.table_filter || '').trim() ? t('db.withFilter') : '' });
                        let stepNumber = 0;
                        const nameStep = connectionName ? ++stepNumber : 0;
                        const connectionStep = connectionParams.length > 0 ? ++stepNumber : 0;
                        const authStep = ++stepNumber;
                        const scopeStep = filterParams.length > 0 ? ++stepNumber : 0;
                        const actionStep = ++stepNumber;

                        return (
                            <Box sx={{ mt: 1.5, maxWidth: 1120 }}>
                                {connectionName && renderTimelineStep(
                                    nameStep,
                                    null,
                                    <Box sx={{ maxWidth: 280 }}>
                                        <DraftTextField
                                            key={`connection-name-${dataLoaderType}`}
                                            sx={inputSx}
                                            variant="standard" size="small" fullWidth
                                            slotProps={labelShrinkSlotProps}
                                            label={connectionName.label}
                                            value={connectionName.value}
                                            placeholder={connectionName.placeholder}
                                            onDraftChange={connectionName.onChange}
                                            onCommit={connectionName.onChange}
                                        />
                                    </Box>,
                                )}

                                {/* Tier 1: Connection */}
                                {connectionParams.length > 0 && (
                                    renderTimelineStep(
                                        connectionStep,
                                        t('db.tierConnection'),
                                        renderParamGrid(connectionParams),
                                    )
                                )}

                                {/* Tier 2: choose an authentication path, then
                                    reveal only that path's credential fields. */}
                                {renderTimelineStep(
                                    authStep,
                                    t('db.tierAuth'),
                                    <>
                                    {authPaths.length > 1 && (
                                        <RadioGroup
                                            row
                                            value={selectedAuthPath?.id || ''}
                                            onChange={(event) => dispatch(dfActions.updateDataLoaderConnectParam({
                                                dataLoaderType,
                                                paramName: '_auth_path',
                                                paramValue: event.target.value,
                                            }))}
                                            sx={{ gap: 1, mb: selectedAuthParams.length > 0 ? 1 : 0 }}
                                        >
                                            {authPaths.map(path => (
                                                <FormControlLabel
                                                    key={path.id}
                                                    value={path.id}
                                                    control={<Radio size="small" />}
                                                    label={(
                                                        <Typography sx={{ fontSize: 11.5, fontWeight: 500 }}>{path.label}</Typography>
                                                    )}
                                                    sx={{ mr: 2 }}
                                                />
                                            ))}
                                        </RadioGroup>
                                    )}

                                    {authPaths.length > 1 && selectedAuthPath?.description && (
                                        <Typography sx={{ fontSize: 11, lineHeight: 1.4, color: 'text.secondary', mb: selectedAuthParams.length > 0 ? 0.5 : 0 }}>
                                            {selectedAuthPath.description}
                                        </Typography>
                                    )}

                                    {hasDelegated && selectedAuthParams.length > 0 ? (
                                        /* Left/right split: delegated | or | credentials */
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
                                                <Box sx={paramGridSx}>
                                                    {selectedAuthParams.map((paramDef) => (
                                                        <DraftTextField
                                                            key={paramDef.name}
                                                            sx={inputSx}
                                                            variant="standard" size="small" fullWidth
                                                            slotProps={labelShrinkSlotProps}
                                                            label={paramDef.name}
                                                            type={paramDef.type === 'password' ? 'password' : 'text'}
                                                            value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                                            placeholder={getParamPlaceholder(paramDef)}
                                                            onDraftChange={(value) => updateParamDraft(paramDef.name, value)}
                                                            onCommit={(value) => commitParamDraft(paramDef.name, value)}
                                                        />
                                                    ))}
                                                </Box>
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
                                        /* Manual credentials only */
                                        renderParamGrid(selectedAuthParams)
                                    )}
                                    </>,
                                )}

                                {/* Tier 3: general scope options remain
                                    available after every authentication path. */}
                                {filterParams.length > 0 && (
                                    renderTimelineStep(
                                        scopeStep,
                                        t('db.tierFilter'),
                                        renderParamGrid(filterParams),
                                    )
                                )}

                                {/* Primary submit action is separate from all
                                    parameter sections. Delegated-only sources
                                    complete through their sign-in button. */}
                                {renderTimelineStep(
                                    actionStep,
                                    null,
                                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                                        {(!hasDelegated || selectedAuthParams.length > 0) && (
                                            <Button
                                                variant="contained" color="primary" size="small"
                                                disabled={isConnecting}
                                                sx={{ textTransform: "none", minWidth: 80, height: 30, fontSize: 12 }}
                                                onClick={() => connectAndListTables()}>
                                                {connectLabel}
                                            </Button>
                                        )}
                                        {paramDefs.length > 0 && (
                                            <FormControlLabel
                                                sx={{ m: 0 }}
                                                control={(
                                                    <Checkbox
                                                        size="small"
                                                        checked={persistCredentials}
                                                        onChange={(event) => setPersistCredentials(event.target.checked)}
                                                        sx={{ p: 0.5 }}
                                                    />
                                                )}
                                                label={(
                                                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                                                        {t('db.rememberCredentials')}
                                                    </Typography>
                                                )}
                                            />
                                        )}
                                    </Box>,
                                    true,
                                )}
                            </Box>
                        );
                    })()}
                    {localizedAuthInstructions && !hideInstructions && (
                        <Box sx={(theme) => ({
                            mt: 3, px: 1.5, py: 1, 
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