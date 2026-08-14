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
    Switch,
  IconButton,
  Tooltip,
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Autocomplete,
    ToggleButton,
    ToggleButtonGroup,
    alpha,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { AgentToyIcon } from './AgentToyIcon';

import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { apiRequest, type ApiError } from '../app/apiClient';
import { getErrorMessage } from '../app/errorCodes';
import Markdown from 'markdown-to-jsx';

import { useDispatch, useSelector } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { DataFormulatorState } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { iconVar, textVar } from '../app/layout';
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
    paramDefs: {name: string, default?: string | number | boolean, options?: string[], type: string, required: boolean, advanced?: boolean, description?: string, sensitive?: boolean, tier?: 'connection' | 'auth' | 'filter'}[],
    authInstructions: string,
    connectorId?: string,
    autoConnect?: boolean,
    /** When true, attempt SSO token passthrough on mount (no popup). */
    ssoAutoConnect?: boolean,
    delegatedLogin?: { login_url: string; label?: string; params?: string[] } | null,
    authMode?: string,
    authPaths?: ConnectorAuthPath[],
    formTitle?: React.ReactNode,
    onImport: () => void,
    onFinish: (status: "success" | "error" | "warning", message: string, importedTables?: string[]) => void,
    onConnected?: () => void,
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
    /** Retain compact control sizing while adding canvas-appropriate spacing. */
    comfortableSpacing?: boolean,
    /** When true, keep setup instructions collapsed initially in compact forms. */
    hideInstructions?: boolean,
    /** One-time seed for sensitive fields (passwords/tokens) the user handed to
     *  the agent in chat. Populates the transient sensitive state so the user
     *  needn't retype; never persisted (see the redux-persist transform). */
    initialSensitiveParams?: Record<string, string>,
    /** Hands the user to the data agent chat with a seeded question when they
     *  get stuck on setup. Omitted inside the chat card itself. */
    onAskAgent?: (prompt: string) => void,
}> = ({dataLoaderType, loaderType, paramDefs, authInstructions, connectorId, autoConnect, ssoAutoConnect, delegatedLogin, authMode, authPaths = [], formTitle, onImport, onFinish, onConnected, onBeforeConnect, hasStoredCredentials, compact = false, comfortableSpacing = false, hideInstructions = false, initialSensitiveParams, onAskAgent}) => {
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
    // Field-level help text, without the ••••• masking that getParamPlaceholder
    // applies to stored secrets — used to explain each field in Setup details.
    const getParamHelp = (paramDef: {name: string; default?: string | number | boolean; description?: string}) => {
        const fallback = paramDef.description || '';
        return t(`loader.${loaderTypeKey}.${paramDef.name}`, {
            defaultValue: t(`loader._common.${paramDef.name}`, { defaultValue: fallback }),
        });
    };
    // Setup details always shows something actionable: prefer the connector's
    // authored guidance (concrete steps), otherwise auto-explain the fields the
    // user has to fill in so they know what each one expects.
    const fieldGuide = paramDefs
        .filter((p) => p.tier !== 'auth')
        .map((p) => {
            const help = getParamHelp(p);
            const optional = p.required
                ? ''
                : ` _(${t('db.optional', { defaultValue: 'optional' })})_`;
            return `- **${p.name}**${optional}${help ? ` — ${help}` : ''}`;
        })
        .join('\n');
    const setupDetailsContent = localizedAuthInstructions
        || (fieldGuide
            ? `${t('db.setupFieldsIntro', { defaultValue: 'Provide the following to connect:' })}\n\n${fieldGuide}`
            : '');
    // Effective connectorId — may be updated by onBeforeConnect (e.g. AddConnectionPanel)
    const connectorIdRef = useRef(connectorId);
    useEffect(() => { connectorIdRef.current = connectorId; }, [connectorId]);
    const params = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[dataLoaderType] ?? {});
    const isLocalMode = useSelector((state: DataFormulatorState) => !!state.serverConfig?.IS_LOCAL_MODE);

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
        if (authPaths.length > 0 && !authPaths.some(path => path.id === params._auth_path)) {
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
    const [showAdvancedConnection, setShowAdvancedConnection] = useState(false);
    const [instructionsExpanded, setInstructionsExpanded] = useState(!hideInstructions);

    // CLI sign-in status (local mode only), e.g. `az login` for Entra ID.
    const [cliLoginStatus, setCliLoginStatus] = useState<{ installed: boolean; signed_in: boolean; account: { user?: string } | null } | null>(null);

    // The auth path the user has currently selected (also computed in the
    // render body; duplicated here so effects/handlers can react to it).
    const activeAuthPath = authPaths.find(path => path.id === params._auth_path)
        || authPaths.find(path => path.default)
        || authPaths[0];
    const cliLogin = (isLocalMode && activeAuthPath?.cli_login) ? activeAuthPath.cli_login : undefined;
    const cliStatusUrl = cliLogin?.status_url;

    // Fetch current CLI sign-in status when a CLI-login auth path is selected.
    useEffect(() => {
        if (!cliStatusUrl) { setCliLoginStatus(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const { data } = await apiRequest<any>(cliStatusUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });
                if (!cancelled) setCliLoginStatus(data);
            } catch {
                if (!cancelled) setCliLoginStatus(null);
            }
        })();
        return () => { cancelled = true; };
    }, [cliStatusUrl]);

    // Sensitive params (passwords, tokens, secrets) live in component state only —
    // never persisted to Redux / localStorage.
    // Sensitivity is declared by the loader via `sensitive: true` or `type: "password"`.
    const sensitiveParamNames = useMemo(
        () => new Set(paramDefs.filter(p => p.sensitive || p.type === 'password').map(p => p.name)),
        [paramDefs]
    );
    const [sensitiveParams, setSensitiveParams] = useState<Record<string, string>>({});

    // One-time seed of sensitive fields the user explicitly gave the agent
    // (e.g. a password shared in chat). Lives in component state only — never
    // Redux/localStorage — and only for params the loader actually marks
    // sensitive, so a stray key can't smuggle a value into a non-secret field.
    const seededSensitiveRef = useRef(false);
    useEffect(() => {
        if (seededSensitiveRef.current || !initialSensitiveParams) return;
        const seed: Record<string, string> = {};
        for (const [name, value] of Object.entries(initialSensitiveParams)) {
            if (value === undefined || value === null || value === '') continue;
            if (!sensitiveParamNames.has(name)) continue;
            seed[name] = String(value);
        }
        if (Object.keys(seed).length > 0) {
            seededSensitiveRef.current = true;
            setSensitiveParams(previous => ({ ...seed, ...previous }));
        }
    }, [initialSensitiveParams, sensitiveParamNames]);



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
    const renderBooleanParam = useCallback((paramDef: typeof paramDefs[number]) => {
        const rawValue = params[paramDef.name] ?? paramDef.default ?? false;
        const checked = String(rawValue).toLowerCase() === 'true';
        return (
            <FormControlLabel
                control={(
                    <Switch
                        size="small"
                        checked={checked}
                        onChange={(_event, nextChecked) => {
                            dispatch(dfActions.updateDataLoaderConnectParam({
                                dataLoaderType,
                                paramName: paramDef.name,
                                paramValue: String(nextChecked),
                            }));
                        }}
                        inputProps={{ 'aria-label': paramDef.name }}
                    />
                )}
                label={checked
                    ? t('common.on', { defaultValue: 'On' })
                    : t('common.off', { defaultValue: 'Off' })}
                sx={{
                    m: 0,
                    minHeight: 40,
                    '& .MuiFormControlLabel-label': {
                        fontSize: compact ? '0.75rem' : '0.8125rem',
                        lineHeight: 1.4,
                    },
                }}
            />
        );
    }, [compact, dataLoaderType, dispatch, paramDefs, params, t]);
    const selectAuthPath = useCallback((pathId: string) => {
        const selectedPath = authPaths.find(path => path.id === pathId);
        if (!selectedPath) return;
        const selectedFields = new Set(selectedPath.fields);
        const authFieldNames = paramDefs
            .filter(paramDef => paramDef.tier === 'auth')
            .map(paramDef => paramDef.name);
        const nextParams: Record<string, string> = { ...params, _auth_path: pathId };
        for (const fieldName of authFieldNames) {
            if (!selectedFields.has(fieldName)) delete nextParams[fieldName];
            delete draftParamsRef.current[fieldName];
        }
        setSensitiveParams(previous => Object.fromEntries(
            Object.entries(previous).filter(([fieldName]) => selectedFields.has(fieldName)),
        ));
        dispatch(dfActions.updateDataLoaderConnectParams({ dataLoaderType, params: nextParams }));
    }, [authPaths, dataLoaderType, dispatch, paramDefs, params]);

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
        // Pass only fields explicitly requested by the login config. Legacy
        // delegated connectors default to their non-sensitive auth fields.
        const loginParamNames = new Set(
            delegatedLogin.params
            || paramDefs.filter(p => p.tier === 'auth' && !p.sensitive && p.type !== 'password').map(p => p.name),
        );
        for (const p of paramDefs) {
            if (loginParamNames.has(p.name) && !p.sensitive && p.type !== 'password' && currentParams[p.name]) {
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
            if (event.source !== popup || event.data?.type !== 'df-sso-auth') return;
            window.removeEventListener('message', handler);
            if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
            popup.close();

            const { access_token, refresh_token, expires_in, user, error } = event.data;
            if (error) {
                onFinish("error", error);
                setIsConnecting(false);
                return;
            }
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
                            expires_in,
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
                            expires_in,
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

    // Wide surfaces read the guide beside the form; the chat card keeps it collapsed below.
    const showSideGuide = !compact && !!setupDetailsContent;

    // Type scale — the panel uses exactly two sizes: `titleFontSize` for the
    // two section headings, `bodyFontSize` for everything else (labels, inputs,
    // help text, buttons). Compact hosts step the whole scale down one notch.
    const titleFontSize = compact ? '0.8125rem' : '0.9375rem';
    const bodyFontSize = compact ? '0.75rem' : '0.8125rem';
    const labelSx = {
        fontSize: bodyFontSize,
        fontWeight: 500,
        lineHeight: 1.4,
        mb: compact && !comfortableSpacing ? 0.25 : 0.5,
    };
    const fieldGap = compact ? (comfortableSpacing ? 1.75 : 1) : 1.5;
    const sectionGap = compact ? (comfortableSpacing ? 2.25 : 1.25) : 2;
    // Inputs otherwise keep MUI's 14px, which is the one size that breaks the scale.
    const fieldSx = {
        '& .MuiInputBase-root': { fontSize: bodyFontSize },
        ...(compact ? {
            '& .MuiOutlinedInput-root': { height: 32 },
            '& .MuiOutlinedInput-input': { paddingTop: '5.5px', paddingBottom: '5.5px' },
            '& .MuiAutocomplete-inputRoot': {
                paddingTop: '0 !important',
                paddingBottom: '0 !important',
            },
            '& .MuiAutocomplete-inputRoot .MuiAutocomplete-input': {
                paddingTop: '5.5px !important',
                paddingBottom: '5.5px !important',
            },
            '& .MuiFormHelperText-root': { fontSize: '0.6875rem', marginTop: '2px' },
        } : {}),
    };
    const actionButtonSx = {
        textTransform: 'none' as const,
        fontSize: bodyFontSize,
        ...(compact ? { py: 0.25, minHeight: 0 } : {}),
    };

    const setupGuideBody = setupDetailsContent ? (
        <Box sx={(theme) => ({
            minWidth: 0,
            maxWidth: '100%',
            fontFamily: theme.typography.fontFamily,
            fontSize: bodyFontSize,
            lineHeight: 1.6,
            color: 'text.primary',
            '& *': { fontSize: 'inherit', lineHeight: 'inherit' },
            '& p, & li': { overflowWrap: 'anywhere' },
            '& p': { margin: '0 0 10px 0', '&:last-child': { marginBottom: 0 } },
            '& code': {
                fontFamily: 'monospace',
                backgroundColor: 'action.hover',
                padding: '1px 4px',
                borderRadius: 0.5,
                overflowWrap: 'anywhere',
                boxDecorationBreak: 'clone',
                WebkitBoxDecorationBreak: 'clone',
            },
            '& pre': {
                maxWidth: '100%',
                fontFamily: 'monospace',
                backgroundColor: 'action.hover',
                padding: 1,
                overflowX: 'auto',
                margin: '10px 0',
                '& code': { backgroundColor: 'transparent', padding: 0, overflowWrap: 'normal' },
            },
            '& a': { color: 'primary.main', overflowWrap: 'anywhere' },
            '& ul, & ol': { paddingLeft: 2.5, margin: '10px 0' },
            '& li': { marginBottom: 0.5 },
            '& strong': { fontWeight: 600 },
            '& h1, & h2, & h3, & h4': { fontWeight: 600, margin: '14px 0 6px' },
        })}>
            <Markdown options={{
                overrides: {
                    a: {
                        props: {
                            target: '_blank',
                            rel: 'noopener noreferrer',
                        },
                    },
                },
            }}>
                {setupDetailsContent}
            </Markdown>
        </Box>
    ) : null;

    // Escape hatch when the guide isn't enough: hand the user to the data agent
    // chat, which can inspect local config, run checks and fill the form.
    const askAgentButton = onAskAgent ? (
        <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<AgentToyIcon sx={{ fontSize: `${iconVar.md} !important` }} />}
            onClick={() => {
                onAskAgent(t('db.askAgentPrompt', {
                    connector: loaderTypeKey,
                    defaultValue: 'I need help setting up a {{connector}} connection. Walk me through the available options, explain what each parameter expects, and help me troubleshoot if it fails.',
                }));
            }}
            sx={{
                flexShrink: 0,
                textTransform: 'none',
                fontSize: bodyFontSize,
                lineHeight: 1.5,
                minWidth: 0,
                minHeight: 0,
                py: 0.5,
                px: 1.25,
                borderRadius: 1,
                whiteSpace: 'nowrap',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { bgcolor: 'primary.dark' },
                // MUI's default start-icon margins are sized for a 14px label.
                '& .MuiButton-startIcon': { ml: 0, mr: 0.5 },
            }}
        >
            {t('db.askAgent', { defaultValue: 'Ask agent' })}
        </Button>
    ) : null;

    return (
        <Box sx={{p: 0, pb: compact ? 0.5 : 2, display: 'flex', flexDirection: 'column' }}>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.85)"
            }}>
                <CircularProgress size={20} />
                {connectProgress && (
                    <Typography sx={{
                        fontSize: textVar.sm, fontWeight: 500, color: 'text.primary',
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
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: showSideGuide
                    ? { xs: 'minmax(0, 1fr)', md: 'minmax(440px, 1.55fr) minmax(280px, 1fr)' }
                    : 'minmax(0, 1fr)',
                columnGap: { xs: 0, md: 4 },
                rowGap: compact ? (comfortableSpacing ? 2.5 : 2) : 3,
                alignItems: 'start',
                width: '100%',
                maxWidth: compact ? '100%' : (showSideGuide ? 940 : 520),
                mx: 'auto',
                px: compact ? 0 : { xs: 0, sm: 1 },
                boxSizing: 'border-box',
            }}>
                <Box sx={{ minWidth: 0 }}>
                {formTitle && (
                    <Typography variant="subtitle1" sx={{ fontSize: titleFontSize, fontWeight: 600, lineHeight: 1.5, mb: 1.5 }}>
                        {formTitle}
                    </Typography>
                )}
                    {(() => {
                        const hasTiers = paramDefs.some(p => p.tier);
                        const fieldStackSx = {
                            display: 'grid',
                            gap: fieldGap,
                            width: '100%',
                            minWidth: 0,
                        };
                        if (!hasTiers) {
                            // Legacy connectors expose no tier metadata, so all fields share one stack.
                            return (
                                <Box sx={fieldStackSx}>
                                    {paramDefs.map((paramDef) => (
                                        <Box key={paramDef.name} sx={{ minWidth: 0 }}>
                                            <Typography variant="body2" sx={labelSx}>
                                                {paramDef.name}{paramDef.required ? ' *' : ''}
                                            </Typography>
                                            {paramDef.type === 'boolean' || paramDef.type === 'bool' ? renderBooleanParam(paramDef) : <DraftTextField
                                                size="small" fullWidth
                                                sx={fieldSx}
                                                type={paramDef.type === 'password' ? 'password' : 'text'}
                                                value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                                placeholder={getParamPlaceholder(paramDef)}
                                                onDraftChange={(value) => updateParamDraft(paramDef.name, value)}
                                                onCommit={(value) => commitParamDraft(paramDef.name, value)}
                                            />}
                                        </Box>
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
                            const renderFieldRow = (paramDef: typeof tierParams[number], input: React.ReactNode, action?: React.ReactNode) => (
                                <Box key={paramDef.name} sx={{ minWidth: 0 }}>
                                    <Typography variant="body2" sx={labelSx}>
                                        {paramDef.name}{paramDef.required ? ' *' : ''}
                                    </Typography>
                                    <Box sx={{
                                        display: 'grid',
                                        gridTemplateColumns: action ? 'minmax(0, 1fr) 32px' : 'minmax(0, 1fr)',
                                        columnGap: action ? 0.5 : 0,
                                        alignItems: 'center',
                                        minWidth: 0,
                                    }}>
                                        {input}
                                        {action && (
                                            <Box sx={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {action}
                                            </Box>
                                        )}
                                    </Box>
                                </Box>
                            );
                            return (
                            <Box sx={fieldStackSx}>
                                {tierParams.map((paramDef) => (
                                    isKustoCluster(paramDef.name) ? (
                                        renderFieldRow(paramDef,
                                        <Autocomplete
                                            sx={{ width: '100%', minWidth: 0 }}
                                            freeSolo
                                            options={[KUSTO_HELP_CLUSTER]}
                                            slotProps={{ listbox: { sx: { fontSize: bodyFontSize } } }}
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
                                                    size="small" fullWidth
                                                    sx={fieldSx}
                                                    placeholder={getParamHelp(paramDef) || getParamPlaceholder(paramDef)}
                                                />
                                            )}
                                        />,
                                        <Tooltip title={t('db.findClusterPortal', { defaultValue: 'Find your cluster in the Azure portal' })}>
                                            <IconButton size="small" component="a" href="https://portal.azure.com/#browse/Microsoft.Kusto%2Fclusters" target="_blank" rel="noopener noreferrer">
                                                <OpenInNewIcon sx={{ fontSize: iconVar.md }} />
                                            </IconButton>
                                        </Tooltip>
                                        )
                                    ) : isKustoDatabase(paramDef.name) ? (
                                        renderFieldRow(paramDef,
                                        <Autocomplete
                                            freeSolo
                                            slotProps={{ listbox: { sx: { fontSize: bodyFontSize } } }}
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
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
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
                                                    size="small" fullWidth
                                                    sx={fieldSx}
                                                    placeholder={getParamHelp(paramDef) || getParamPlaceholder(paramDef)}
                                                    error={!!databaseDiscoveryError}
                                                    helperText={databaseDiscoveryError || undefined}
                                                />
                                            )}
                                        />
                                        )
                                    ) : paramDef.type === 'boolean' || paramDef.type === 'bool' ? (
                                        renderFieldRow(paramDef, renderBooleanParam(paramDef))
                                    ) : paramDef.options ? (
                                        renderFieldRow(paramDef,
                                        <Autocomplete
                                            freeSolo
                                            options={paramDef.options}
                                            slotProps={{ listbox: { sx: { fontSize: bodyFontSize } } }}
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
                                                    size="small" fullWidth
                                                    sx={fieldSx}
                                                    placeholder={getParamHelp(paramDef) || getParamPlaceholder(paramDef)}
                                                />
                                            )}
                                        />
                                        )
                                    ) : (
                                    renderFieldRow(paramDef,
                                    <DraftTextField
                                        size="small" fullWidth
                                        sx={fieldSx}
                                        type={paramDef.type === 'password' ? 'password' : 'text'}
                                        value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                        placeholder={getParamHelp(paramDef) || getParamPlaceholder(paramDef)}
                                        onDraftChange={(value) => updateParamDraft(paramDef.name, value)}
                                        onCommit={(value) => commitParamDraft(paramDef.name, value)}
                                    />
                                    )
                                    )
                                ))}
                            </Box>
                            );
                        };

                        const connectionParams = paramDefs.filter(p => p.tier === 'connection' && !p.advanced);
                        const advancedConnectionParams = paramDefs.filter(p => p.tier === 'connection' && p.advanced);
                        const filterParams = paramDefs.filter(p => p.tier === 'filter');
                        const authParams = paramDefs.filter(p => p.tier === 'auth');
                        const selectedAuthPath = authPaths.find(path => path.id === params._auth_path)
                            || authPaths.find(path => path.default)
                            || authPaths[0];
                        const selectedAuthFieldNames = new Set(selectedAuthPath?.fields || authParams.map(p => p.name));
                        const selectedAuthParams = authParams.filter(p => selectedAuthFieldNames.has(p.name));
                        const hasDelegated = !!delegatedLogin?.login_url
                            && (!selectedAuthPath || selectedAuthPath.kind === 'delegated_login');
                        const connectLabel = onBeforeConnect
                            ? t('db.createConnector', { defaultValue: 'Create Connector' })
                            : t('db.connect', { suffix: (params.table_filter || '').trim() ? t('db.withFilter') : '' });
                        const showConnectAction = !hasDelegated || selectedAuthParams.length > 0;

                        return (
                            <Box sx={{ display: 'grid', gap: sectionGap, width: '100%' }}>
                                {connectionParams.length > 0 && (
                                    <Box sx={{ display: 'grid', gap: sectionGap }}>
                                        {renderParamGrid(connectionParams)}
                                        {advancedConnectionParams.length > 0 && (
                                                <Accordion
                                                    disableGutters
                                                    elevation={0}
                                                    expanded={showAdvancedConnection}
                                                    onChange={() => setShowAdvancedConnection(value => !value)}
                                                    sx={(theme) => ({
                                                        // Shaded rather than outlined — an outline would read
                                                        // as another input box.
                                                        backgroundColor: alpha(theme.palette.text.primary, 0.04),
                                                        borderRadius: 1,
                                                        overflow: 'hidden',
                                                        '&:before': { display: 'none' },
                                                        '& .MuiAccordionSummary-root': { minHeight: compact ? 30 : 40, px: compact ? 1 : 1.5 },
                                                        '& .MuiAccordionSummary-content': { my: compact ? 0.5 : 1 },
                                                        '& .MuiAccordionSummary-expandIconWrapper .MuiSvgIcon-root': { fontSize: compact ? 18 : 24 },
                                                        '& .MuiAccordionDetails-root': { px: compact ? 1 : 1.5, pt: 0.5, pb: compact ? 1 : 1.5 },
                                                    })}
                                                >
                                                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                                        <Typography variant="body2" sx={{ fontSize: bodyFontSize }}>
                                                            {t('db.advancedSettings', { defaultValue: 'Advanced settings' })}
                                                        </Typography>
                                                    </AccordionSummary>
                                                    <AccordionDetails>
                                                        {renderParamGrid(advancedConnectionParams)}
                                                    </AccordionDetails>
                                                </Accordion>
                                        )}
                                    </Box>
                                )}

                                {filterParams.length > 0 && renderParamGrid(filterParams)}

                                {/* Auth path selection reveals only the selected path's credential fields. */}
                                <Box sx={{ display: 'grid', gap: sectionGap }}>
                                    {authPaths.length > 1 && (
                                        <ToggleButtonGroup
                                            exclusive
                                            fullWidth
                                            size="small"
                                            value={selectedAuthPath?.id || ''}
                                            onChange={(_event, value) => {
                                                if (!value) return;
                                                selectAuthPath(value);
                                            }}
                                            aria-label={t('db.tierAuth')}
                                            sx={(theme) => ({
                                                '& .MuiToggleButton-root': {
                                                    textTransform: 'none',
                                                    color: 'text.secondary',
                                                    borderColor: 'divider',
                                                    ...(compact ? { fontSize: '0.7rem', py: 0.375, px: 1, lineHeight: 1.3 } : {}),
                                                    '&:hover': { backgroundColor: 'action.hover' },
                                                    '&.Mui-selected': {
                                                        color: 'primary.dark',
                                                        fontWeight: 600,
                                                        backgroundColor: alpha(theme.palette.primary.main, 0.1),
                                                        '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.14) },
                                                    },
                                                },
                                            })}
                                        >
                                            {authPaths.map(path => (
                                                <ToggleButton
                                                    key={path.id}
                                                    value={path.id}
                                                >
                                                    {path.label}
                                                </ToggleButton>
                                            ))}
                                        </ToggleButtonGroup>
                                    )}

                                    {authPaths.length > 1 && selectedAuthPath?.description && (
                                        <Box sx={(theme) => ({
                                            display: 'flex', alignItems: 'flex-start', gap: 1,
                                            px: compact ? 1 : 1.5, py: compact ? 0.75 : 1.25,
                                            backgroundColor: alpha(theme.palette.primary.main, 0.06),
                                        })}>
                                            <InfoOutlinedIcon sx={{ fontSize: compact ? 15 : 17, color: 'primary.main', mt: '2px', flexShrink: 0 }} />
                                            <Typography variant="body2" sx={{ fontSize: bodyFontSize, lineHeight: 1.5 }}>
                                                {selectedAuthPath.description}
                                            </Typography>
                                        </Box>
                                    )}

                                    {isLocalMode && selectedAuthPath?.cli_login && (
                                        <Box sx={{ display: 'grid', gap: 0.75 }}>
                                            {cliLoginStatus?.signed_in ? (
                                                <Box sx={(theme) => ({
                                                    display: 'flex', alignItems: 'center', gap: 1,
                                                    px: compact ? 1 : 1.5, py: compact ? 0.625 : 1,
                                                    color: 'success.dark',
                                                    backgroundColor: alpha(theme.palette.success.main, 0.08),
                                                })}>
                                                    <CheckCircleOutlineIcon sx={{ fontSize: compact ? 15 : 17, flexShrink: 0 }} />
                                                    <Typography variant="body2" sx={{ fontSize: bodyFontSize, color: 'inherit' }}>
                                                        {t('db.cliLoginReady', {
                                                            user: cliLoginStatus.account?.user || t('db.cliLoginCurrentAccount', { defaultValue: 'your current account' }),
                                                            defaultValue: 'Signed in as {{user}}. You are ready to connect.',
                                                        })}
                                                    </Typography>
                                                </Box>
                                            ) : cliLoginStatus?.installed ? (
                                                <Typography variant="body2" sx={{ fontSize: bodyFontSize }}>
                                                    {t('db.cliLoginRequired', { defaultValue: 'Sign in with Azure CLI before connecting. Run `az login` in a terminal, then reopen this form.' })}
                                                </Typography>
                                            ) : cliLoginStatus && !cliLoginStatus.installed ? (
                                                <Typography variant="body2" sx={{ fontSize: bodyFontSize }}>
                                                    {t('db.cliNotInstalled', { defaultValue: 'Azure CLI not found. Install it and run `az login` in a terminal before connecting.' })}
                                                </Typography>
                                            ) : null}
                                        </Box>
                                    )}

                                    {hasDelegated && selectedAuthParams.length > 0 ? (
                                        <Box sx={{ display: 'grid', gap: sectionGap }}>
                                            <Button
                                                variant="outlined"
                                                color="primary"
                                                size="small"
                                                sx={{ ...actionButtonSx, justifySelf: 'start' }}
                                                disabled={isConnecting}
                                                onClick={handleDelegatedLogin}
                                            >
                                                {delegatedLogin!.label || t('db.delegatedLogin')}
                                            </Button>
                                            {renderParamGrid(selectedAuthParams)}
                                        </Box>
                                    ) : hasDelegated ? (
                                        /* Delegated only */
                                        <Button
                                            variant="contained" color="primary" size="small"
                                            sx={{ ...actionButtonSx, justifySelf: 'start' }}
                                            disabled={isConnecting}
                                            onClick={handleDelegatedLogin}
                                        >
                                            {delegatedLogin!.label || t('db.delegatedLogin')}
                                        </Button>
                                    ) : (
                                        /* Manual credentials only */
                                        renderParamGrid(selectedAuthParams)
                                    )}

                                    </Box>

                                {showConnectAction && (
                                    <Box sx={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: compact ? 1 : 1.5,
                                        width: '100%',
                                        mt: compact ? 0 : 1,
                                    }}>
                                        <Button
                                            variant="contained" color="primary" size="small"
                                            disabled={isConnecting}
                                            sx={actionButtonSx}
                                            onClick={() => connectAndListTables()}>
                                            {connectLabel}
                                        </Button>
                                        {paramDefs.length > 0 && (
                                            <FormControlLabel
                                                sx={{ m: 0, ml: 'auto', flexShrink: 0 }}
                                                control={(
                                                    <Checkbox
                                                        size="small"
                                                        sx={compact ? { p: 0.5 } : undefined}
                                                        checked={persistCredentials}
                                                        onChange={(event) => setPersistCredentials(event.target.checked)}
                                                    />
                                                )}
                                                label={(
                                                    <Typography variant="body2" sx={{ fontSize: bodyFontSize }}>
                                                        {t('db.rememberCredentials')}
                                                    </Typography>
                                                )}
                                            />
                                        )}
                                    </Box>
                                )}
                            </Box>
                        );
                    })()}
                    {!showSideGuide && setupDetailsContent && (
                        <Box sx={{ mt: compact ? 1.5 : 3 }}>
                            {askAgentButton && (
                                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
                                    {askAgentButton}
                                </Box>
                            )}
                        <Accordion
                            disableGutters
                            elevation={0}
                            expanded={instructionsExpanded}
                            onChange={() => setInstructionsExpanded(value => !value)}
                            sx={(theme) => ({
                                backgroundColor: alpha(theme.palette.text.primary, 0.04),
                                borderRadius: 1,
                                overflow: 'hidden',
                                '&:before': { display: 'none' },
                                '& .MuiAccordionSummary-root': { minHeight: compact ? 30 : 48, px: compact ? 1 : 2 },
                                '& .MuiAccordionSummary-content': { my: compact ? 0.5 : 1.5 },
                                '& .MuiAccordionSummary-expandIconWrapper .MuiSvgIcon-root': { fontSize: compact ? 18 : 24 },
                                '& .MuiAccordionDetails-root': { px: compact ? 1 : 2, pt: 0.5, pb: compact ? 1 : 2 },
                            })}
                        >
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography variant="body2" sx={{ fontSize: bodyFontSize }}>
                                    {t('db.setupDetails', { defaultValue: 'Setup details' })}
                                </Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                {setupGuideBody}
                            </AccordionDetails>
                        </Accordion>
                        </Box>
                    )}
                </Box>
                {showSideGuide && (
                    <Box sx={(theme) => ({
                        minWidth: 0,
                        maxWidth: '100%',
                        overflow: 'hidden',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        backgroundColor: alpha(theme.palette.text.primary, 0.035),
                    })}>
                        <Box sx={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                            px: 2.25, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', backgroundColor: 'background.paper',
                        }}>
                            <Typography variant="subtitle1" sx={{ fontSize: titleFontSize, fontWeight: 600, lineHeight: 1.5 }}>
                                {t('db.setupDetails', { defaultValue: 'Setup details' })}
                            </Typography>
                            {askAgentButton}
                        </Box>
                        <Box sx={{ minWidth: 0, px: 2.25, py: 2 }}>
                            {setupGuideBody}
                        </Box>
                    </Box>
                )}
                </Box>
        </Box>
    );
}