// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useRef, useState } from 'react';
import Portal from '@mui/material/Portal';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux";
import { 
    DataFormulatorState,
    dfActions,
    ModelConfig,
    dfSelectors,
} from '../app/dfSlice'
import _ from 'lodash';

import {
    Alert,
    Button,
    Tooltip,
    Typography,
    IconButton,
    DialogTitle,
    Dialog,
    DialogContent,
    DialogActions,
    TextField,
    Menu,
    CircularProgress,
    FormControl,
    Select,
    SelectChangeEvent,
    MenuItem,
    ListSubheader,
    OutlinedInput,
    Paper,
    Box,
    Divider,
    Checkbox,
    Switch,
    FormControlLabel,
    ToggleButton,
    ToggleButtonGroup,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    InputAdornment,
    Autocomplete,
} from '@mui/material';


import { styled } from '@mui/material/styles';

import AddCircleIcon from '@mui/icons-material/AddCircle';
import ClearIcon from '@mui/icons-material/Clear';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { getUrls } from '../app/utils';
import { apiRequest, ApiError, ApiRequestError } from '../app/apiClient';
import { useTranslation } from 'react-i18next';
import { LogViewerDialog } from './LogViewerDialog';
import { iconVar, textVar } from '../app/layout';


// Add this helper function at the top of the file, after the imports
const simpleHash = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
};

const CONFIGURED_SECRET_MASK = '******';

const PROVIDERS: Record<string, { label: string; model: string; base: string; connectionMethod: 'account' | 'api' }> = {
    openai: { label: 'OpenAI', model: 'gpt-5.6-terra', base: 'https://api.openai.com/v1', connectionMethod: 'api' },
    azure: { label: 'Azure', model: 'team-assistant', base: 'https://my-resource.openai.azure.com', connectionMethod: 'api' },
    anthropic: { label: 'Anthropic', model: 'claude-sonnet-5', base: 'https://api.anthropic.com', connectionMethod: 'api' },
    gemini: { label: 'Google Gemini', model: 'gemini-3.8-flash', base: 'https://generativelanguage.googleapis.com', connectionMethod: 'api' },
    ollama: { label: 'Ollama', model: 'qwen3.8:27b', base: 'http://localhost:11434', connectionMethod: 'api' },
    openrouter: { label: 'OpenRouter', model: '', base: 'https://openrouter.ai/api/v1', connectionMethod: 'account' },
    github_copilot: { label: 'GitHub Copilot', model: '', base: 'https://api.githubcopilot.com', connectionMethod: 'account' },
    chatgpt: { label: 'ChatGPT', model: '', base: '', connectionMethod: 'account' },
    orcarouter: { label: 'OrcaRouter', model: 'auto', base: 'https://api.orcarouter.ai/v1', connectionMethod: 'api' },
    cheaperinference: { label: 'Cheaper Inference', model: 'gpt-5.4-mini', base: 'https://api.cheaperinference.com/v1', connectionMethod: 'api' },
};

const connectionRequest = (provider: string, action: string, body: object = {}) => apiRequest(
    `/api/model-endpoints/connections/${provider}/${action}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Model-Connection': '1' }, body: JSON.stringify(body) },
);

interface AccountConnectionStatus {
    id: string;
    connected: boolean;
    connection?: OpenRouterConnectionDetails | null;
    flow: { id: string; status: 'pending' | 'exchanging' | 'connected' | 'error' } | null;
}

interface OpenRouterConnectionDetails {
    creator_user_id?: string | null;
    login?: string | null;
    account_label?: string | null;
    settings_url: string;
}

export function parseAzureTargetUri(value: string): {
    apiBase: string;
    model: string;
    apiVersion: string | null;
} | null {
    try {
        const url = new URL(value.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
        const deployment = url.pathname.match(
            /^\/openai\/deployments\/([^/]+)\/(?:chat\/completions|completions|responses|embeddings)\/?$/,
        );
        if (!deployment) return null;
        return {
            apiBase: url.origin,
            model: decodeURIComponent(deployment[1]),
            apiVersion: url.searchParams.get('api-version'),
        };
    } catch {
        return null;
    }
}

interface ModelSelectionButtonProps {
    appearance?: 'toolbar' | 'inline';
    actionContainer?: HTMLElement | null;
    hideStageAction?: boolean;
    onStageConnection?: (definition: Record<string, string>) => Promise<void>;
    initialDefinition?: Record<string, string>;
    hasStoredCredentials?: boolean;
}

interface RememberedModelEndpoint {
    endpoint: string;
    model: string;
    api_base: string;
    api_version: string;
    auth_mode: string;
}

interface AzureDeploymentOption {
    id: string;
    deployment: string;
    model: string;
    resource: string;
    resource_group: string;
    api_base: string;
    region: string;
}

export const ModelSelectionButton: React.FC<ModelSelectionButtonProps> = ({ appearance = 'toolbar', onStageConnection, initialDefinition, hasStoredCredentials = false, actionContainer, hideStageAction = false }) => {
    const { t } = useTranslation();

    const dispatch = useDispatch();
    const globalModels = useSelector((state: DataFormulatorState) => state.globalModels ?? []);
    const models = useSelector((state: DataFormulatorState) => state.models);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const testedModels = useSelector((state: DataFormulatorState) => state.testedModels);
    const config = useSelector((state: DataFormulatorState) => state.config);

    const [modelDialogOpen, setModelDialogOpen] = useState<boolean>(!!onStageConnection);
    const [detailModelId, setDetailModelId] = useState<string | undefined>(selectedModelId);
    const [isEditingDetails, setIsEditingDetails] = useState(!!onStageConnection);
    const [showKeys, setShowKeys] = useState<boolean>(false);
    const [providerModelOptions, setProviderModelOptions] = useState<{[key: string]: string[]}>({
        'openai': [],
        'azure': [],
        'anthropic': [],
        'gemini': [],
        'ollama': [],
        'orcarouter': [],
        'cheaperinference': []
    });
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

    let updateModelStatus = (model: ModelConfig, status: 'ok' | 'error' | 'testing' | 'unknown', message: string) => {
        dispatch(dfActions.updateModelStatus({id: model.id, status, message}));
    }
    let getStatus = (id: string | undefined) => {
        return id != undefined ? (testedModels.find(t => (t.id == id))?.status || 'unknown') : 'unknown';
    }

    // Helper functions for slot management
    const [tempSelectedModelId, setTempSelectedModelId] = useState<string | undefined>(selectedModelId);
    const [newEndpoint, setNewEndpoint] = useState<string>(initialDefinition?.endpoint || ""); // openai, azure, ollama etc
    const isAccountProvider = PROVIDERS[newEndpoint]?.connectionMethod === 'account';
    const isCopilot = newEndpoint === 'github_copilot';
    const isChatGPT = newEndpoint === 'chatgpt';
    const usesDeviceCode = isCopilot || isChatGPT;
    const accountProvider = isAccountProvider ? newEndpoint : 'openrouter';
    const accountConnectionUrl = `/api/model-endpoints/connections/${accountProvider}`;
    const [newModel, setNewModel] = useState<string>(initialDefinition?.model || "");
    const [newApiKey, setNewApiKey] = useState<string>("");
    const [newApiBase, setNewApiBase] = useState<string>(initialDefinition?.api_base || "");
    const [newApiVersion, setNewApiVersion] = useState<string>(initialDefinition?.api_version || "");
    const [managedIdentityClientId, setManagedIdentityClientId] = useState(initialDefinition?.managed_identity_client_id || '');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [azureAuthMethod, setAzureAuthMethod] = useState<'azure_cli' | 'managed_identity' | 'api_key'>(
        initialDefinition?.auth_mode === 'managed_identity' ? 'managed_identity' : initialDefinition?.auth_mode === 'key' ? 'api_key' : 'azure_cli');
    const [isAddingModel, setIsAddingModel] = useState(false);
    const [newModelError, setNewModelError] = useState("");
    const [newModelDiagnostic, setNewModelDiagnostic] = useState<ApiError | null>(null);
    const [modelLogsOpen, setModelLogsOpen] = useState(false);
    const [rememberedEndpoints, setRememberedEndpoints] = useState<RememberedModelEndpoint[]>([]);
    const [recentMenuAnchor, setRecentMenuAnchor] = useState<HTMLElement | null>(null);
    const [azureCliStatus, setAzureCliStatus] = useState<{
        installed: boolean;
        signed_in: boolean;
        account: { user?: string; tenant_id?: string } | null;
    } | null>(null);
    const [azureCliLoginPending, setAzureCliLoginPending] = useState(false);
    const [azureManualEntry, setAzureManualEntry] = useState(false);
    const [azureSubscriptions, setAzureSubscriptions] = useState<{ id: string; name: string }[]>([]);
    const [azureSubscription, setAzureSubscription] = useState('');
    const [azureDeployments, setAzureDeployments] = useState<AzureDeploymentOption[]>([]);
    const [azureSubscriptionsLoading, setAzureSubscriptionsLoading] = useState(false);
    const [azureDeploymentsLoading, setAzureDeploymentsLoading] = useState(false);
    const [azureDiscoveryError, setAzureDiscoveryError] = useState('');
    const [azureDiscoveryWarnings, setAzureDiscoveryWarnings] = useState<string[]>([]);
    const [azureDiscoveryRefresh, setAzureDiscoveryRefresh] = useState(0);
    const canBrowseAzure = !onStageConnection && serverConfig.IS_LOCAL_MODE && newEndpoint === 'azure' && azureAuthMethod === 'azure_cli';
    const browseAzure = canBrowseAzure && !azureManualEntry;
    const azureDiscoveryActive = modelDialogOpen && isEditingDetails && browseAzure && !!azureCliStatus?.signed_in;
    const [openRouterConnected, setOpenRouterConnected] = useState(false);
    const [openRouterModels, setOpenRouterModels] = useState<{ id: string; name: string }[]>([]);
    const [openRouterLoading, setOpenRouterLoading] = useState(false);
    const [openRouterError, setOpenRouterError] = useState('');
    const [openRouterAuthExpired, setOpenRouterAuthExpired] = useState(false);
    const [openRouterDetails, setOpenRouterDetails] = useState<OpenRouterConnectionDetails | null>(null);
    const [openRouterFlow, setOpenRouterFlow] = useState<string>();
    const [openRouterAuthUrl, setOpenRouterAuthUrl] = useState('');
    const [deviceCode, setDeviceCode] = useState('');
    const [disconnectOpen, setDisconnectOpen] = useState(false);
    const [disconnectPending, setDisconnectPending] = useState(false);
    const openRouterAttempt = useRef<{ cancelled: boolean; provider: string; flowId?: string; popup: Window | null } | null>(null);
    const openRouterRefresh = useRef(0);

    const cancelOpenRouterLogin = () => {
        const attempt = openRouterAttempt.current;
        if (attempt) {
            attempt.cancelled = true;
            attempt.popup?.close();
            if (attempt.flowId) void connectionRequest(attempt.provider, 'cancel', { flow_id: attempt.flowId }).catch(() => undefined);
        }
        openRouterAttempt.current = null;
        setOpenRouterFlow(undefined);
        setOpenRouterAuthUrl('');
        setDeviceCode('');
    };

    const refreshOpenRouter = async () => {
        const generation = ++openRouterRefresh.current;
        setOpenRouterLoading(true);
        setOpenRouterError('');
        try {
            const { data } = await apiRequest<AccountConnectionStatus>(accountConnectionUrl);
            if (generation !== openRouterRefresh.current) return;
            setOpenRouterConnected(data.connected);
            setOpenRouterDetails(data.connection ?? null);
            if (data.connected) {
                const catalog = await apiRequest<{ models: { id: string; name: string }[]; connection: OpenRouterConnectionDetails }>(`${accountConnectionUrl}/models`);
                if (generation === openRouterRefresh.current) {
                    setOpenRouterModels(catalog.data.models);
                    setOpenRouterDetails(catalog.data.connection);
                    setOpenRouterAuthExpired(false);
                }
            } else {
                setOpenRouterModels([]);
                setOpenRouterDetails(null);
                setOpenRouterAuthExpired(false);
            }
        } catch (error) {
            if (generation === openRouterRefresh.current) {
                setOpenRouterModels([]);
                setOpenRouterAuthExpired(error instanceof ApiRequestError && error.isAuthError);
                setOpenRouterError(error instanceof Error ? error.message : t('model.connectionFailed'));
            }
        } finally {
            if (generation === openRouterRefresh.current) setOpenRouterLoading(false);
        }
    };

    useEffect(() => {
        setOpenRouterConnected(false);
        setOpenRouterModels([]);
        setOpenRouterDetails(null);
        setOpenRouterAuthExpired(false);
        setOpenRouterError('');
        if (!modelDialogOpen || !isAccountProvider) return;
        void refreshOpenRouter();
        return () => {
            ++openRouterRefresh.current;
            cancelOpenRouterLogin();
        };
    }, [modelDialogOpen, newEndpoint]);

    useEffect(() => {
        if (!openRouterFlow) return;
        let stopped = false;
        let polling = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            if (stopped || polling) return;
            clearTimeout(timer);
            polling = true;
            try {
                const { data } = usesDeviceCode
                    ? await connectionRequest(accountProvider, 'poll', { flow_id: openRouterFlow })
                    : await apiRequest<AccountConnectionStatus>(accountConnectionUrl);
                if (stopped) return;
                if (data.flow?.id !== openRouterFlow || data.flow.status === 'error') {
                    stopped = true;
                    cancelOpenRouterLogin();
                    setOpenRouterError(t('model.accountAuthorizationFailed'));
                } else if (data.flow.status === 'connected') {
                    stopped = true;
                    cancelOpenRouterLogin();
                    window.focus();
                    await refreshOpenRouter();
                } else {
                    timer = setTimeout(poll, usesDeviceCode ? 5000 : 1200);
                }
            } catch (error) {
                if (stopped) return;
                stopped = true;
                cancelOpenRouterLogin();
                setOpenRouterError(error instanceof Error ? error.message : t('model.connectionFailed'));
            } finally {
                polling = false;
            }
        };
        const channel = typeof BroadcastChannel !== 'undefined'
            ? new BroadcastChannel(`df-model-auth:${openRouterFlow}`) : null;
        if (channel) channel.onmessage = () => { void poll(); };
        const onVisible = () => {
            if (document.visibilityState === 'visible') void poll();
        };
        window.addEventListener('focus', poll);
        document.addEventListener('visibilitychange', onVisible);
        void poll();
        return () => {
            stopped = true;
            clearTimeout(timer);
            channel?.close();
            window.removeEventListener('focus', poll);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [openRouterFlow, newEndpoint]);

    const resumeOpenRouterLogin = (event: React.MouseEvent<HTMLAnchorElement>) => {
        const attempt = openRouterAttempt.current;
        if (!attempt || attempt.cancelled) return;
        try {
            if (attempt.popup && !attempt.popup.closed) {
                attempt.popup.location.href = openRouterAuthUrl;
                attempt.popup.focus();
                event.preventDefault();
                return;
            }
        } catch {
            attempt.popup = null;
        }
        const popup = window.open(openRouterAuthUrl, '_blank', 'popup,width=650,height=760');
        if (popup) {
            popup.opener = null;
            attempt.popup = popup;
            event.preventDefault();
        }
    };

    const startOpenRouterLogin = async () => {
        cancelOpenRouterLogin();
        setOpenRouterError('');
        const popup = window.open('', '_blank', 'popup,width=650,height=760');
        if (popup) popup.opener = null;
        const attempt = { cancelled: false, provider: accountProvider, popup, flowId: undefined as string | undefined };
        openRouterAttempt.current = attempt;
        setOpenRouterAuthUrl('pending');
        try {
            const { data } = await connectionRequest(attempt.provider, 'start', { origin: window.location.origin });
            attempt.flowId = data.flow_id;
            if (attempt.cancelled) {
                void connectionRequest(attempt.provider, 'cancel', { flow_id: data.flow_id }).catch(() => undefined);
                return;
            }
            setOpenRouterFlow(data.flow_id);
            setOpenRouterAuthUrl(data.authorization_url);
            setDeviceCode(data.user_code || '');
            if (popup) popup.location.href = data.authorization_url;
        } catch (error) {
            if (attempt.cancelled) return;
            cancelOpenRouterLogin();
            setOpenRouterError(error instanceof Error ? error.message : t('model.connectionFailed'));
        }
    };

    const disconnectOpenRouter = async () => {
        setDisconnectPending(true);
        try {
            cancelOpenRouterLogin();
            ++openRouterRefresh.current;
            await connectionRequest(accountProvider, 'disconnect');
            setOpenRouterConnected(false);
            setOpenRouterModels([]);
            setOpenRouterDetails(null);
            setOpenRouterAuthExpired(false);
            setDisconnectOpen(false);
            models.filter(model => model.connection_id === accountProvider).forEach(model => {
                updateModelStatus(model, 'unknown', '');
            });
        } catch (error) {
            setOpenRouterError(error instanceof Error ? error.message : t('model.connectionFailed'));
            setDisconnectOpen(false);
        } finally {
            setDisconnectPending(false);
        }
    };

    const usesAzureCli = !onStageConnection && serverConfig.IS_LOCAL_MODE && (
        (newEndpoint === 'azure' && azureAuthMethod === 'azure_cli')
        || globalModels.some(model => model.auth_mode === 'azure_identity')
        || models.some(model => model.endpoint === 'azure' && !model.api_key)
    );

    useEffect(() => {
        if (!modelDialogOpen || !usesAzureCli) {
            setAzureCliStatus(null);
            return;
        }
        let cancelled = false;
        apiRequest('/api/local/azure-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        }).then(({ data }) => {
            if (!cancelled) setAzureCliStatus(data);
        }).catch(() => {
            if (!cancelled) setAzureCliStatus(null);
        });
        return () => { cancelled = true; };
    }, [modelDialogOpen, usesAzureCli]);

    useEffect(() => {
        if (!azureDiscoveryActive) return;
        let cancelled = false;
        const controller = new AbortController();
        setAzureSubscriptionsLoading(true);
        setAzureDiscoveryError('');
        setAzureSubscriptions([]);
        setAzureSubscription('');
        apiRequest<{ subscriptions: { id: string; name: string }[]; default_subscription: string }>(
            '/api/model-endpoints/azure/subscriptions', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Model-Connection': '1' },
                body: JSON.stringify({}), signal: controller.signal,
            },
        ).then(({ data }) => {
            if (cancelled) return;
            setAzureSubscriptions(data.subscriptions);
            setAzureSubscription(data.subscriptions.some(subscription => subscription.id === data.default_subscription)
                ? data.default_subscription : data.subscriptions[0]?.id || '');
        }).catch(error => {
            if (!cancelled) setAzureDiscoveryError(error instanceof Error ? error.message : String(error));
        }).finally(() => { if (!cancelled) setAzureSubscriptionsLoading(false); });
        return () => { cancelled = true; controller.abort(); };
    }, [azureDiscoveryActive, azureDiscoveryRefresh, azureCliStatus?.account?.tenant_id, azureCliStatus?.account?.user]);

    useEffect(() => {
        setAzureDeployments([]);
        setAzureDiscoveryWarnings([]);
        setAzureDeploymentsLoading(false);
        if (!azureDiscoveryActive || !azureSubscription || azureSubscriptionsLoading) return;
        let cancelled = false;
        const controller = new AbortController();
        setAzureDeploymentsLoading(true);
        setAzureDiscoveryError('');
        apiRequest<{ models: AzureDeploymentOption[]; warnings: string[] }>('/api/model-endpoints/azure/deployments', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Model-Connection': '1' },
            body: JSON.stringify({ subscription_id: azureSubscription }), signal: controller.signal,
        }).then(({ data }) => {
            if (cancelled) return;
            setAzureDeployments(data.models);
            setAzureDiscoveryWarnings(data.warnings);
        }).catch(error => {
            if (!cancelled) setAzureDiscoveryError(error instanceof Error ? error.message : String(error));
        }).finally(() => { if (!cancelled) setAzureDeploymentsLoading(false); });
        return () => { cancelled = true; controller.abort(); };
    }, [azureDiscoveryActive, azureSubscription, azureSubscriptionsLoading, azureCliStatus?.account?.tenant_id, azureCliStatus?.account?.user]);

    useEffect(() => {
        if (!modelDialogOpen || onStageConnection) return;
        apiRequest<RememberedModelEndpoint[]>(getUrls().MODEL_ENDPOINTS)
            .then(({ data }) => setRememberedEndpoints(data))
            .catch(() => setRememberedEndpoints([]));
    }, [modelDialogOpen]);

    const rememberModelEndpoint = (model: ModelConfig) => {
        if (model.connection_id) return;
        const entry = {
            endpoint: model.endpoint,
            model: model.model,
            api_base: model.api_base || '',
            api_version: model.api_version || '',
            auth_mode: model.auth_mode || '',
        };
        apiRequest<RememberedModelEndpoint>(getUrls().MODEL_ENDPOINTS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        }).then(() => {
            setRememberedEndpoints(current => [
                entry,
                ...current.filter(existing => JSON.stringify(existing) !== JSON.stringify(entry)),
            ].slice(0, 20));
        }).catch(() => undefined);
    };

    const handleAzureCliLogin = async () => {
        setAzureCliLoginPending(true);
        try {
            const { data } = await apiRequest('/api/local/azure-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            setAzureCliStatus({ installed: true, ...data });
        } catch (error) {
            const message = error instanceof ApiRequestError
                ? error.apiError.message
                : error instanceof Error ? error.message : String(error);
            setNewModelDiagnostic(error instanceof ApiRequestError ? error.apiError : {
                code: 'CLIENT_ERROR',
                message,
                retry: false,
            });
            setNewModelError(message);
        } finally {
            setAzureCliLoginPending(false);
        }
    };

    // Build provider→model dropdown options from globalModels (already in Redux).
    // This runs whenever globalModels updates (phase 1 instant list → phase 2 with statuses).
    useEffect(() => {
        const modelsByProvider: {[key: string]: string[]} = {
            'openai': [],
            'azure': [],
            'anthropic': [],
            'gemini': [],
            'ollama': [],
            'orcarouter': [],
            'cheaperinference': []
        };

        globalModels.forEach((modelConfig: any) => {
            const provider = modelConfig.endpoint;
            const model = modelConfig.model;

            if (provider && model && !modelsByProvider[provider]) {
                modelsByProvider[provider] = [];
            }
            if (provider && model && !modelsByProvider[provider].includes(model)) {
                modelsByProvider[provider].push(model);
            }
        });

        setProviderModelOptions(modelsByProvider);
    }, [globalModels]);


    const allModels = serverConfig.DISABLE_CUSTOM_MODELS ? globalModels : [...globalModels, ...models];
    const detailModel = allModels.find(model => model.id === detailModelId);
    const detailIsGlobal = globalModels.some(model => model.id === detailModelId);
    const detailModelStatus = getStatus(detailModelId);
    const detailHasConfiguredApiKey = detailModel
        ? detailIsGlobal
            ? detailModel.auth_mode === 'key'
            : Boolean(detailModel.api_key)
        : false;

    let modelExists = allModels.some(m => m.id !== detailModelId &&
        m.endpoint == newEndpoint && m.model == newModel.trim() && (isAccountProvider
            ? m.connection_id === accountProvider
            : m.api_base == newApiBase && (m.api_key || '') == newApiKey && (m.api_version || '') == newApiVersion));

    let testModel = (model: ModelConfig) => {
        updateModelStatus(model, 'testing', "");
        apiRequest(getUrls().TEST_MODEL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
        })
            .then(({ data }) => {
                rememberModelEndpoint(model);
                updateModelStatus(model, 'ok', data.message || "");
                if (!tempSelectedModelId) {
                    setTempSelectedModelId(model.id);
                }
            }).catch((error) => {
                const msg = error instanceof ApiRequestError
                    ? error.apiError.message
                    : error.message;
                updateModelStatus(model, 'error', msg);
            });
    }

    const baseIsPrimary = newEndpoint === 'azure' || newEndpoint === 'ollama';
    const hasConnection = isAccountProvider
        ? openRouterConnected && !openRouterLoading && !openRouterAuthUrl && openRouterModels.some(model => model.id === newModel)
        : newEndpoint === 'azure'
        ? Boolean(newApiBase.trim()) && (azureAuthMethod !== 'api_key' || Boolean(newApiKey.trim()) || hasStoredCredentials)
            && (!browseAzure || (!!azureCliStatus?.signed_in && !azureSubscriptionsLoading && !azureDeploymentsLoading
                && azureDeployments.some(model => model.deployment === newModel
                    && model.api_base.replace(/\/$/, '') === newApiBase.replace(/\/$/, ''))))
        : newEndpoint === 'ollama' || Boolean(newApiKey.trim()) || Boolean(newApiBase.trim()) || hasStoredCredentials;
    const readyToTest = Boolean(newEndpoint && newModel.trim() && hasConnection) && !isAddingModel;

    const resetNewModelForm = () => {
        cancelOpenRouterLogin();
        setRecentMenuAnchor(null);
        setNewEndpoint("");
        setNewModel("");
        setNewApiKey("");
        setNewApiBase("");
        setNewApiVersion("");
        setManagedIdentityClientId('');
        setAdvancedOpen(false);
        setShowKeys(false);
        setAzureAuthMethod('azure_cli');
        setAzureManualEntry(false);
        setNewModelError("");
        setNewModelDiagnostic(null);
    };

    const handleSaveModel = async () => {
        if (onStageConnection) {
            if (!readyToTest || isAccountProvider) return;
            setIsAddingModel(true);
            setNewModelError('');
            try {
                await onStageConnection({ endpoint: newEndpoint, model: newModel.trim(), api_key: newApiKey,
                    api_base: newApiBase.trim(), api_version: newApiVersion.trim(),
                    auth_mode: newEndpoint === 'azure' && azureAuthMethod !== 'api_key'
                        ? (azureAuthMethod === 'managed_identity' ? 'managed_identity' : 'azure_identity') : 'key',
                    managed_identity_client_id: azureAuthMethod === 'managed_identity' ? managedIdentityClientId.trim() : '' });
                resetNewModelForm();
            } catch (error) { setNewModelError(error instanceof Error ? error.message : String(error)); }
            finally { setIsAddingModel(false); }
            return;
        }
        if (serverConfig.DISABLE_CUSTOM_MODELS || !readyToTest || modelExists) return;
        const updatingUserModel = detailModelId && !detailIsGlobal;
        const id = updatingUserModel
            ? detailModelId
            : simpleHash(`${newEndpoint}-${newModel}-${newApiKey}-${newApiBase}-${newApiVersion}${isAccountProvider ? '-account' : ''}`);
        const model: ModelConfig = {
            endpoint: newEndpoint,
            model: newModel.trim(),
            api_key: isAccountProvider ? undefined : newApiKey,
            api_base: isAccountProvider ? undefined : newApiBase.trim(),
            api_version: isAccountProvider ? undefined : newApiVersion.trim(),
            connection_id: isAccountProvider ? accountProvider : undefined,
            auth_mode: isAccountProvider ? 'account' : newEndpoint === 'azure'
                ? (azureAuthMethod === 'azure_cli' ? 'azure_identity' : 'key')
                : undefined,
            id,
        };

        setIsAddingModel(true);
        setNewModelError("");
        setNewModelDiagnostic(null);
        updateModelStatus(model, 'testing', "");
        try {
            const { data } = await apiRequest(getUrls().TEST_MODEL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model }),
            });
            rememberModelEndpoint(model);
            dispatch(updatingUserModel ? dfActions.updateModel(model) : dfActions.addModel(model));
            updateModelStatus(model, 'ok', data.message || "");
            setTempSelectedModelId(id);
            setDetailModelId(id);
            setIsEditingDetails(false);
        } catch (error) {
            const message = error instanceof ApiRequestError
                ? error.apiError.message
                : error instanceof Error ? error.message : String(error);
            setNewModelDiagnostic(error instanceof ApiRequestError ? error.apiError : {
                code: 'CLIENT_ERROR',
                message,
                retry: false,
            });
            updateModelStatus(model, 'error', message);
            setNewModelError(message);
        } finally {
            setIsAddingModel(false);
        }
    };

    const loadModelDetails = (model: ModelConfig) => {
        cancelOpenRouterLogin();
        setRecentMenuAnchor(null);
        setDetailModelId(model.id);
        setTempSelectedModelId(model.id);
        setNewEndpoint(model.endpoint);
        setNewModel(model.model);
        setNewApiBase(model.api_base || '');
        setNewApiVersion(model.api_version || '');
        setNewApiKey(model.is_global ? '' : model.api_key || '');
        setShowKeys(false);
        setAdvancedOpen(Boolean(model.api_version || (
            model.endpoint === 'ollama' ? model.api_key
                : model.endpoint !== 'azure' && model.api_base
        )));
        setAzureAuthMethod(
            model.endpoint === 'azure' && model.auth_mode !== 'key' && !model.api_key
                ? 'azure_cli'
                : 'api_key'
        );
        setAzureManualEntry(model.endpoint === 'azure');
        setNewModelError('');
        setNewModelDiagnostic(null);
        setIsEditingDetails(false);
    };

    const startNewModel = () => {
        if (serverConfig.DISABLE_CUSTOM_MODELS) return;
        setDetailModelId(undefined);
        resetNewModelForm();
        setIsEditingDetails(true);
    };

    const editModelDetails = () => {
        if (serverConfig.DISABLE_CUSTOM_MODELS) return;
        setIsEditingDetails(true);
    };

    const copyModelDetails = () => {
        if (serverConfig.DISABLE_CUSTOM_MODELS) return;
        setDetailModelId(undefined);
        setNewModelError('');
        setNewModelDiagnostic(null);
        setShowKeys(false);
        setIsEditingDetails(true);
    };

    const inputSx = {
        '& .MuiOutlinedInput-root': {
            fontSize: '0.75rem',
            borderRadius: 0.5,
            backgroundColor: 'rgba(0,0,0,0.02)',
            height: 28,
            '& fieldset': { borderColor: 'divider' },
            '&:hover fieldset': { borderColor: 'text.disabled' },
            '&.Mui-focused fieldset': { borderColor: 'primary.main' },
        },
        '& .MuiOutlinedInput-input': { px: 1, py: 0 },
    };

    const applyApiBase = (value: string) => {
        const target = newEndpoint === 'azure' ? parseAzureTargetUri(value) : null;
        setNewApiBase(target?.apiBase ?? value.trim());
        if (target) {
            setNewModel(target.model);
            if (target.apiVersion !== null) {
                setNewApiVersion(target.apiVersion);
                setAdvancedOpen(true);
            }
        }
    };

    const baseUrlField = (
        <TextField
            fullWidth
            size="small"
            disabled={!isEditingDetails}
            required={newEndpoint === 'azure'}
            label={newEndpoint === 'azure' ? t('model.endpoint') : t('model.apiBase')}
            value={newApiBase}
            onChange={event => setNewApiBase(event.target.value)}
            onBlur={event => applyApiBase(event.target.value)}
            onPaste={event => {
                const value = event.clipboardData.getData('text');
                if (newEndpoint === 'azure' && parseAzureTargetUri(value)) {
                    event.preventDefault();
                    applyApiBase(value);
                }
            }}
            placeholder={PROVIDERS[newEndpoint]?.base}
            autoComplete="off"
            inputProps={{ inputMode: 'url', spellCheck: false }}
        />
    );

    const apiKeyField = (isEditingDetails || detailHasConfiguredApiKey) && (
        <TextField
            fullWidth
            size="small"
            disabled={!isEditingDetails}
            type={isEditingDetails && showKeys ? 'text' : 'password'}
            label={newEndpoint === 'ollama' ? t('model.optionalApiKey') : t('model.apiKey')}
            value={isEditingDetails ? newApiKey : CONFIGURED_SECRET_MASK}
            onChange={event => setNewApiKey(event.target.value)}
            autoComplete="off"
            InputProps={{
                endAdornment: isEditingDetails && !serverConfig.DISABLE_DISPLAY_KEYS ? (
                    <InputAdornment position="end">
                        <Tooltip title={showKeys ? t('model.hideKeys') : t('model.showKeys')}>
                            <IconButton
                                size="small"
                                aria-label={showKeys ? t('model.hideKeys') : t('model.showKeys')}
                                onClick={() => setShowKeys(!showKeys)}
                            >
                                {showKeys ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                            </IconButton>
                        </Tooltip>
                    </InputAdornment>
                ) : undefined,
            }}
        />
    );

    const openRouterAccount = (
        <Box sx={{ display: 'grid', gap: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1 }}>
                {openRouterAuthUrl ? <>
                    <CircularProgress size={16} />
                    <Typography variant="body2">{t('model.waitingForAuthorization')}</Typography>
                    <Button size="small" onClick={cancelOpenRouterLogin}>{t('model.cancel')}</Button>
                    {deviceCode && <Alert severity="info" role="status" sx={{
                        width: '100%', minWidth: 0, boxSizing: 'border-box', px: 1.25, py: 0.5,
                        '& .MuiAlert-icon': { fontSize: iconVar.sm, mr: 0.75, py: 0.5 },
                        '& .MuiAlert-message': { minWidth: 0, py: 0.25 },
                    }}>
                        <Typography variant="caption" sx={{ display: 'block', fontSize: textVar.sm }}>
                            {t('model.deviceCodeInstructions', { provider: isChatGPT ? 'ChatGPT' : 'GitHub' })}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mt: 0.25 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                <Typography component="code" variant="body2" aria-label={t('model.deviceCode')}
                                    sx={{ fontFamily: 'monospace', fontSize: textVar.sm, fontWeight: 600, overflowWrap: 'anywhere', userSelect: 'all' }}>{deviceCode}</Typography>
                                <Tooltip title={t('model.copyDeviceCode')}><IconButton size="small" aria-label={t('model.copyDeviceCode')}
                                    onClick={() => void navigator.clipboard.writeText(deviceCode).catch(() => setOpenRouterError(t('model.copyDeviceCodeFailed')))}>
                                    <ContentCopyOutlinedIcon sx={{ fontSize: iconVar.sm }} />
                                </IconButton></Tooltip>
                            </Box>
                            {openRouterAuthUrl !== 'pending' && <Button
                                size="small" component="a" href={openRouterAuthUrl} target="_blank" rel="noopener noreferrer"
                                sx={{ fontSize: textVar.sm, py: 0.25, minHeight: 0 }}
                                onClick={resumeOpenRouterLogin} endIcon={<OpenInNewIcon />}
                            >{t(isChatGPT ? 'model.openChatGPTAuthorization' : 'model.openGitHubAuthorization')}</Button>}
                        </Box>
                    </Alert>}
                    {!deviceCode && openRouterAuthUrl !== 'pending' && <Button
                        size="small" component="a" href={openRouterAuthUrl} target="_blank" rel="noopener noreferrer"
                        onClick={resumeOpenRouterLogin}
                        endIcon={<OpenInNewIcon />}
                    >{t(isChatGPT ? 'model.openChatGPTAuthorization' : isCopilot ? 'model.openGitHubAuthorization' : 'model.openAuthorization')}</Button>}
                </> : <>
                    {openRouterConnected ? <>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1, width: '100%', minWidth: 0 }}>
                            {isCopilot && openRouterDetails?.login && <Typography variant="body2" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                                @{openRouterDetails.login}
                            </Typography>}
                            {isChatGPT && openRouterDetails?.account_label && <Typography variant="body2" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                                {openRouterDetails.account_label}
                            </Typography>}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                {!openRouterLoading && (openRouterError || openRouterAuthExpired) && <ErrorOutlineIcon sx={{ fontSize: 18 }} color="warning" />}
                                <Typography variant="body2" color={openRouterLoading || openRouterError || openRouterAuthExpired ? 'text.secondary' : 'success.main'}
                                    aria-live="polite"
                                    sx={openRouterLoading ? {
                                        maskImage: 'linear-gradient(110deg, #000 35%, #0004 50%, #000 65%)',
                                        maskSize: '250% 100%',
                                        animation: 'connectionCheckSweep 1.6s ease-in-out infinite alternate',
                                        '@keyframes connectionCheckSweep': {
                                            from: { maskPosition: '0% 0' },
                                            to: { maskPosition: '100% 0' },
                                        },
                                        '@media (prefers-reduced-motion: reduce)': {
                                            animation: 'none', maskImage: 'none',
                                        },
                                    } : undefined}>
                                    {t(openRouterLoading ? 'model.checkingConnection' : openRouterAuthExpired
                                        ? 'model.authorizationExpired' : openRouterError ? 'model.connectionUnavailable' : 'model.openRouterConnected')}
                                </Typography>
                            </Box>
                        </Box>
                        <Box role="group" aria-label={t('model.connectionActions')} sx={{
                            display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, maxWidth: '100%',
                            '& .MuiButton-root': {
                                minWidth: 0, p: 0,
                                fontSize: textVar.sm, fontWeight: 400, lineHeight: 1.5,
                                textTransform: 'none', color: 'text.secondary',
                                '&:hover, &.Mui-focusVisible': { color: 'text.primary', bgcolor: 'transparent', textDecoration: 'underline' },
                                '&.Mui-disabled': { color: 'text.disabled' },
                            },
                        }}>
                            {openRouterDetails && <Tooltip title={t(isChatGPT ? 'model.manageChatGPTConnection' : isCopilot ? 'model.manageCopilotConnection' : 'model.manageOpenRouterConnection')}>
                                <Button size="small" variant="text" disableRipple component="a" href={openRouterDetails.settings_url}
                                    sx={{ '& .MuiButton-endIcon': { ml: 0.5, mr: 0 }, '& .MuiButton-endIcon > *': { fontSize: iconVar.sm } }}
                                    endIcon={<OpenInNewIcon />}
                                    target="_blank" rel="noopener noreferrer" aria-label={t(isChatGPT ? 'model.manageChatGPTConnection' : isCopilot ? 'model.manageCopilotConnection' : 'model.manageOpenRouterConnection')}>
                                    {t('model.manageConnection', { provider: isChatGPT ? 'ChatGPT' : isCopilot ? 'GitHub Copilot' : 'OpenRouter' })}
                                </Button>
                            </Tooltip>}
                            {isEditingDetails && <Tooltip title={t('model.disconnectAccount')}><Box component="span" sx={{ minWidth: 0 }}>
                                <Button size="small" variant="text" disableRipple aria-label={t('model.disconnectAccount')}
                                    disabled={disconnectPending} onClick={() => setDisconnectOpen(true)}>
                                    {t('model.disconnectAccount')}
                                </Button>
                            </Box></Tooltip>}
                        </Box>
                    </> : <Button size="small" startIcon={<LoginIcon />} disabled={openRouterLoading || disconnectPending}
                        onClick={startOpenRouterLogin}>{t(isChatGPT ? 'model.connectChatGPT' : isCopilot ? 'model.connectCopilot' : 'model.connectOpenRouter')}</Button>}
                </>}
            </Box>
            {openRouterError && <Box>
                <Typography variant="body2" color="error" role="alert" sx={{ overflowWrap: 'anywhere' }}>{openRouterError}</Typography>
                <Button size="small" startIcon={openRouterAuthExpired ? <LoginIcon /> : <RefreshIcon />}
                    disabled={openRouterLoading || Boolean(openRouterAuthUrl) || disconnectPending}
                    onClick={openRouterAuthExpired ? startOpenRouterLogin : () => void refreshOpenRouter()}>
                    {t(openRouterAuthExpired ? 'model.reconnectAccount' : 'model.retryConnection')}
                </Button>
            </Box>}
        </Box>
    );

    const addModelForm = (
        <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField
                select
                fullWidth
                size="small"
                disabled={!isEditingDetails || (!!onStageConnection && !!initialDefinition)}
                label={t('model.provider')}
                value={newEndpoint}
                onChange={(event) => {
                    const provider = event.target.value;
                    resetNewModelForm();
                    setNewEndpoint(provider);
                }}
            >
                {(onStageConnection ? ['api'] as const : ['account', 'api'] as const).flatMap(connectionMethod => [
                    <ListSubheader key={connectionMethod} disableSticky aria-hidden="true" sx={{
                        fontSize: textVar.sm, lineHeight: '28px', color: 'text.secondary',
                        ...(connectionMethod === 'api' && { borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 0.5 }),
                    }}>
                        {t(connectionMethod === 'account' ? 'model.signInCategory' : 'model.apiCategory')}
                    </ListSubheader>,
                    ...Object.entries(PROVIDERS)
                        .filter(([, details]) => details.connectionMethod === connectionMethod)
                        .map(([provider, details]) => (
                            <MenuItem key={provider} value={provider}>{details.label}</MenuItem>
                        )),
                ])}
            </TextField>

            {baseIsPrimary && newEndpoint !== 'azure' && baseUrlField}

            {isAccountProvider && <>
                {openRouterAccount}
                {openRouterConnected && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Autocomplete
                    fullWidth size="small" options={openRouterModels} sx={{ minWidth: 0, flex: 1 }}
                    loading={openRouterLoading} disabled={openRouterLoading || Boolean(openRouterAuthUrl) || openRouterAuthExpired}
                    value={openRouterModels.find(model => model.id === newModel) || null}
                    getOptionLabel={model => model.name}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    onChange={(_event, model) => setNewModel(model?.id || '')}
                    noOptionsText={t('model.noCompatibleModels')}
                    renderOption={(props, model) => <Box component="li" {...props} key={model.id}
                        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important', overflowWrap: 'anywhere' }}>
                        <Typography variant="body2">{model.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{model.id}</Typography>
                    </Box>}
                    renderInput={params => <TextField {...params} label={t('model.model')} required />}
                />
                <Tooltip title={t('model.refreshAccount')}><span><IconButton size="small"
                    aria-label={t('model.refreshAccount')} disabled={openRouterLoading || Boolean(openRouterAuthUrl) || disconnectPending || openRouterAuthExpired}
                    onClick={() => void refreshOpenRouter()}>
                    {openRouterLoading ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
                </IconButton></span></Tooltip>
                </Box>}
                <Typography variant="caption" color="text.secondary">{t(isChatGPT ? 'model.chatgptBilling' : isCopilot ? 'model.copilotBilling' : 'model.openRouterBilling')}</Typography>
            </>}

            {newEndpoint === 'azure' && (
                <ToggleButtonGroup
                    exclusive
                    size="small"
                    sx={{
                        justifySelf: 'start', maxWidth: '100%',
                        '& .MuiToggleButton-root': {
                            textTransform: 'none', fontSize: textVar.sm, px: 2, py: 0.5,
                        },
                    }}
                    disabled={!isEditingDetails}
                    value={azureAuthMethod}
                    onChange={(_event, value) => {
                        if (!value) return;
                        setAzureAuthMethod(value);
                        if (value !== 'api_key') setNewApiKey('');
                    }}
                    aria-label={t('model.authentication')}
                >
                    <ToggleButton value="azure_cli">{onStageConnection ? 'Microsoft Entra ID' : 'Azure CLI'}</ToggleButton>
                    {onStageConnection && <ToggleButton value="managed_identity">Managed identity</ToggleButton>}
                    <ToggleButton value="api_key">{t('model.apiKey')}</ToggleButton>
                </ToggleButtonGroup>
            )}

            {onStageConnection && newEndpoint === 'azure' && azureAuthMethod === 'managed_identity' && <TextField size="small"
                label="Managed identity client ID (optional)" value={managedIdentityClientId} onChange={event => setManagedIdentityClientId(event.target.value)} />}
            {!onStageConnection && newEndpoint === 'azure' && azureAuthMethod === 'azure_cli' && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                    {azureCliStatus?.signed_in ? (
                        <Typography variant="caption" color="success.main" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                            {t('model.azureAccount', {
                                user: azureCliStatus.account?.user || t('db.cliLoginCurrentAccount'),
                            })}
                        </Typography>
                    ) : (
                        <Button
                            variant="outlined"
                            size="small"
                            disabled={!isEditingDetails || azureCliLoginPending || azureCliStatus?.installed === false}
                            onClick={handleAzureCliLogin}
                            startIcon={azureCliLoginPending ? <CircularProgress size={iconVar.sm} /> : undefined}
                        >
                            {azureCliStatus?.installed === false
                                ? t('db.cliNotInstalled')
                                : t('db.cliLogin')}
                        </Button>
                    )}
                </Box>
            )}

            {baseIsPrimary && newEndpoint === 'azure' && !browseAzure && baseUrlField}

            {newEndpoint && !isAccountProvider && !browseAzure && <TextField
                fullWidth
                size="small"
                required
                disabled={!isEditingDetails}
                label={newEndpoint === 'azure' ? t('model.deploymentName') : t('model.model')}
                value={newModel}
                onChange={(event) => setNewModel(event.target.value)}
                placeholder={PROVIDERS[newEndpoint]?.model}
                autoComplete="off"
            />}

            {browseAzure && azureCliStatus?.signed_in && <Box
                aria-busy={azureSubscriptionsLoading || azureDeploymentsLoading}
                sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                    <Autocomplete
                        fullWidth size="small" options={azureSubscriptions} sx={{ minWidth: 0, flex: 1 }}
                        loading={azureSubscriptionsLoading}
                        disabled={azureSubscriptionsLoading || !isEditingDetails || !azureSubscriptions.length}
                        value={azureSubscriptions.find(subscription => subscription.id === azureSubscription) || null}
                        getOptionLabel={subscription => subscription.name}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        onChange={(_event, subscription) => {
                            setAzureSubscription(subscription?.id || '');
                            setNewModel('');
                            setNewApiBase('');
                        }}
                        noOptionsText={t('model.noAzureSubscriptions')}
                        renderOption={(props, subscription) => <Box component="li" {...props} key={subscription.id}
                            sx={{ overflowWrap: 'anywhere' }}>
                            <Typography variant="body2">{subscription.name}</Typography>
                        </Box>}
                        renderInput={params => <TextField {...params} label={t('model.azureSubscription')} />}
                    />
                    <Tooltip title={t('model.refreshAzureDeployments')}><span><IconButton size="small"
                        aria-label={t('model.refreshAzureDeployments')}
                        disabled={azureSubscriptionsLoading || azureDeploymentsLoading || !isEditingDetails}
                        onClick={() => setAzureDiscoveryRefresh(current => current + 1)}>
                        <RefreshIcon fontSize="small" />
                    </IconButton></span></Tooltip>
                </Box>
                {(azureSubscriptionsLoading || azureDeploymentsLoading) ? <TextField
                    fullWidth size="small" disabled required
                    label={t('model.deploymentName')}
                    value={t('model.loadingModels')}
                    InputProps={{
                        endAdornment: <InputAdornment position="end">
                            <CircularProgress size={16} thickness={4}
                                aria-label={t('model.loadingModels')}
                                sx={{
                                    color: 'text.disabled',
                                    '@media (prefers-reduced-motion: reduce)': {
                                        animation: 'none',
                                        '& .MuiCircularProgress-circle': { animation: 'none' },
                                    },
                                }} />
                        </InputAdornment>,
                    }}
                /> : <Autocomplete<AzureDeploymentOption>
                    fullWidth size="small" options={azureDeployments}
                    loading={azureSubscriptionsLoading || azureDeploymentsLoading}
                    disabled={!azureSubscription || azureSubscriptionsLoading || azureDeploymentsLoading || !isEditingDetails}
                    value={azureDeployments.find(model => model.deployment === newModel && model.api_base.replace(/\/$/, '') === newApiBase.replace(/\/$/, '')) || null}
                    getOptionLabel={model => `${model.deployment} (${model.model}) - ${model.resource}`}
                    groupBy={model => model.resource}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    onChange={(_event, model) => {
                        setNewModel(model?.deployment || '');
                        setNewApiBase(model?.api_base || '');
                        setNewApiKey('');
                        setNewApiVersion('');
                    }}
                    noOptionsText={t('model.noAzureDeployments')}
                    renderOption={(props, model) => <Box component="li" {...props} key={model.id}
                        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important', overflowWrap: 'anywhere' }}>
                        <Typography variant="body2">{model.deployment}</Typography>
                        <Typography variant="caption" color="text.secondary">{model.model} · {model.resource_group} · {model.region}</Typography>
                    </Box>}
                    renderInput={params => <TextField {...params} label={t('model.deploymentName')} required />}
                />}
                {!azureSubscriptionsLoading && !azureDiscoveryError && !azureSubscriptions.length && <Typography variant="caption" color="text.secondary">{t('model.noAzureSubscriptions')}</Typography>}
                {azureDiscoveryError && <Typography variant="caption" color="error" role="alert" sx={{ overflowWrap: 'anywhere' }}>{azureDiscoveryError}</Typography>}
                {azureDiscoveryWarnings.length > 0 && <Box sx={{ maxHeight: 100, overflowY: 'auto' }}>
                    {azureDiscoveryWarnings.map((warning, index) => <Typography key={index} variant="caption" color="warning.main" component="div" sx={{ overflowWrap: 'anywhere' }}>{warning}</Typography>)}
                </Box>}
            </Box>}

            {newEndpoint && newEndpoint !== 'ollama' && !isAccountProvider
                && (newEndpoint !== 'azure' || azureAuthMethod === 'api_key') && apiKeyField}

            {canBrowseAzure && <Button
                variant="text" size="small" disabled={!isEditingDetails}
                onClick={() => setAzureManualEntry(current => !current)}
                sx={{
                    justifySelf: 'start', p: 0, minWidth: 0, textTransform: 'none',
                    typography: 'caption', mt: -0.5,
                }}>
                {t(azureManualEntry ? 'model.browseDeployments' : 'model.enterManually')}
            </Button>}

            {newEndpoint && !isAccountProvider && (isEditingDetails || newApiVersion || (!baseIsPrimary && newApiBase)
                || (newEndpoint === 'ollama' && detailHasConfiguredApiKey)) && (
                <Accordion
                    disableGutters
                    elevation={0}
                    expanded={advancedOpen}
                    onChange={(_event, expanded) => setAdvancedOpen(expanded)}
                    sx={{ '&:before': { display: 'none' }, background: 'transparent' }}
                >
                    <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}
                        sx={{
                            px: 0, minHeight: 32, width: 'fit-content', maxWidth: '100%',
                            flexDirection: 'row-reverse', gap: 0.5, color: 'text.secondary',
                            '& .MuiAccordionSummary-content': { my: 0 },
                        }}>
                        <Typography variant="caption">{t('model.advancedSettings')}</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ display: 'grid', gap: 2, px: 0, pt: 1.5, pb: 0 }}>
                        {!baseIsPrimary && baseUrlField}
                        {newEndpoint === 'ollama' && apiKeyField}
                        {newEndpoint === 'azure' && <TextField
                            fullWidth
                            size="small"
                            disabled={!isEditingDetails}
                            label={t('model.apiVersion')}
                            value={newApiVersion}
                            onChange={(event) => setNewApiVersion(event.target.value)}
                            autoComplete="off"
                        />}
                    </AccordionDetails>
                </Accordion>
            )}

            {!onStageConnection && isEditingDetails && modelExists && <Typography variant="caption" color="error">{t('model.providerModelExists')}</Typography>}
            {newModelDiagnostic && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="error" sx={{ flex: 1 }}>
                        {newModelError}
                    </Typography>
                    <Tooltip title={t('model.copyDiagnostic')}>
                        <IconButton
                            size="small"
                            aria-label={t('model.copyDiagnostic')}
                            onClick={() => navigator.clipboard.writeText([
                                newModelDiagnostic.message,
                                newModelDiagnostic.request_id || '',
                            ].filter(Boolean).join('\n'))}
                        >
                            <ContentCopyOutlinedIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    {serverConfig.IS_LOCAL_MODE && (
                        <Button
                            size="small"
                            variant="text"
                            startIcon={<TerminalOutlinedIcon />}
                            onClick={() => setModelLogsOpen(true)}
                            sx={{ whiteSpace: 'nowrap' }}
                        >
                            {t('model.viewRecentLog')}
                        </Button>
                    )}
                </Box>
            )}
            <LogViewerDialog
                open={modelLogsOpen}
                onOpenChange={setModelLogsOpen}
                hideTrigger
                tailLines={100}
                title={t('model.recentLog')}
            />
        </Box>
    );

    const detailUsesAccount = isAccountProvider && detailModel?.connection_id === accountProvider;

    const modelDetails = (
        <Box>
            <Box component="dl" sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'max-content minmax(0, 1fr)' },
                columnGap: 2.5,
                rowGap: { xs: 0.5, sm: 1.5 },
                m: 0,
                alignItems: 'baseline',
                '& dt': { color: 'text.secondary' },
                '& dd': { m: 0, mb: { xs: 1.25, sm: 0 }, minWidth: 0, overflowWrap: 'anywhere' },
            }}>
                <Typography component="dt" variant="body2">{t('model.provider')}</Typography>
                <Typography component="dd" variant="body2">{PROVIDERS[newEndpoint]?.label || newEndpoint}</Typography>
                {!detailUsesAccount && (newApiBase || PROVIDERS[newEndpoint]?.base) && <>
                    <Typography component="dt" variant="body2">
                        {newEndpoint === 'azure' ? t('model.endpoint') : t('model.apiBase')}
                    </Typography>
                    <Typography component="dd" variant="body2">{newApiBase || PROVIDERS[newEndpoint]?.base}</Typography>
                </>}
                <Typography component="dt" variant="body2">
                    {newEndpoint === 'azure' ? t('model.deploymentName') : t('model.model')}
                </Typography>
                <Typography component="dd" variant="body2">{newModel}</Typography>
                <Typography component="dt" variant="body2">{t(detailUsesAccount ? 'model.account' : 'model.authentication')}</Typography>
                <Box component="dd">
                    {!detailUsesAccount && <Typography variant="body2">
                        {detailModel?.connection_id === 'chatgpt' ? t('model.chatgptAccount')
                            : detailModel?.connection_id === 'github_copilot' ? t('model.copilotAccount')
                            : detailModel?.connection_id === 'openrouter' ? t('model.openRouterAccount')
                            : newEndpoint === 'azure' && azureAuthMethod === 'azure_cli'
                            ? 'Azure CLI'
                            : detailHasConfiguredApiKey ? t('model.apiKey') : t('model.none')}
                    </Typography>}
                    {detailUsesAccount && openRouterAccount}
                    {newEndpoint === 'azure' && azureAuthMethod === 'azure_cli' && serverConfig.IS_LOCAL_MODE && (
                        azureCliStatus?.signed_in ? (
                            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                                {t('model.azureAccount', {
                                    user: azureCliStatus.account?.user || t('db.cliLoginCurrentAccount'),
                                })}
                            </Typography>
                        ) : (
                            <Button
                                size="small"
                                variant="text"
                                sx={{ mt: 0.5 }}
                                disabled={azureCliLoginPending || !azureCliStatus || !azureCliStatus.installed}
                                onClick={handleAzureCliLogin}
                                startIcon={azureCliLoginPending ? <CircularProgress size={iconVar.sm} /> : undefined}
                            >
                                {azureCliStatus?.installed === false ? t('db.cliNotInstalled') : t('db.cliLogin')}
                            </Button>
                        )
                    )}
                </Box>
                {!detailUsesAccount && newApiVersion && <>
                    <Typography component="dt" variant="body2">{t('model.apiVersion')}</Typography>
                    <Typography component="dd" variant="body2">{newApiVersion}</Typography>
                </>}
            </Box>
            {newModelError && <Typography variant="body2" color="error" role="alert" sx={{ mt: 1.5 }}>
                {newModelError}
            </Typography>}
        </Box>
    );

    const modelManagerView = (
        <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 0.75fr) minmax(380px, 1.4fr)' },
            gap: 3,
            py: 1,
        }}>
            <Box sx={{ pr: { md: 2.5 }, borderRight: { md: '1px solid' }, borderColor: { md: 'divider' } }}>
                <Box sx={{ display: 'grid' }}>
                    {allModels.map(model => (
                            <Box
                                key={model.id}
                                onClick={() => loadModelDetails(model)}
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                                    alignItems: 'center',
                                    gap: 1,
                                    px: 1,
                                    py: 1.25,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    bgcolor: detailModelId === model.id ? 'action.selected' : 'transparent',
                                    cursor: 'pointer',
                                    '&:hover': { bgcolor: 'action.hover' },
                                }}
                            >
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{model.display_name || model.model}</Typography>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                                        {PROVIDERS[model.endpoint]?.label || model.endpoint}
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {selectedModelId === model.id && (
                                        <Typography variant="caption" color="text.secondary">
                                            {t('model.current')}
                                        </Typography>
                                    )}
                                    {!globalModels.some(globalModel => globalModel.id === model.id) && (
                                        <Tooltip title={t('model.removeModel')}>
                                            <IconButton
                                                size="small"
                                                aria-label={t('model.removeModel')}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    dispatch(dfActions.removeModel(model.id));
                                                    if (detailModelId === model.id) {
                                                        const fallback = allModels.find(candidate => candidate.id !== model.id);
                                                        if (fallback) loadModelDetails(fallback);
                                                        else startNewModel();
                                                    }
                                                }}
                                            >
                                                <ClearIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </Box>
                            </Box>
                    ))}
                    {!serverConfig.DISABLE_CUSTOM_MODELS && <Button
                        size="small"
                        startIcon={<AddCircleIcon />}
                        onClick={startNewModel}
                        variant={detailModelId === undefined && isEditingDetails ? 'soft' : 'text'}
                        sx={{
                            justifyContent: 'flex-start',
                            mt: 1,
                        }}
                    >
                        {t('model.addModel')}
                    </Button>}
                </Box>
            </Box>
            <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {detailModel ? detailModel.display_name || detailModel.model : t(serverConfig.DISABLE_CUSTOM_MODELS ? 'model.pleaseSelectModel' : 'model.newModel')}
                        </Typography>
                        {detailIsGlobal && (
                            <Typography variant="caption" color="text.secondary">{t('model.serverManaged')}</Typography>
                        )}
                    </Box>
                    {!serverConfig.DISABLE_CUSTOM_MODELS && isEditingDetails && !detailModelId && rememberedEndpoints.length > 0 && <>
                        <Button
                            size="small"
                            variant="text"
                            sx={{ color: 'text.secondary' }}
                            endIcon={<ExpandMoreIcon />}
                            aria-haspopup="menu"
                            aria-expanded={Boolean(recentMenuAnchor)}
                            aria-controls={recentMenuAnchor ? 'recent-model-menu' : undefined}
                            onClick={event => setRecentMenuAnchor(event.currentTarget)}
                        >
                            {t('model.useRecent')}
                        </Button>
                        <Menu
                            id="recent-model-menu"
                            anchorEl={recentMenuAnchor}
                            open={Boolean(recentMenuAnchor)}
                            onClose={() => setRecentMenuAnchor(null)}
                            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            slotProps={{ paper: { sx: { maxWidth: 'calc(100vw - 32px)', maxHeight: 360 } } }}
                            MenuListProps={{ 'aria-label': t('model.recentConfigurations') }}
                        >
                            {rememberedEndpoints.map(option => (
                                <MenuItem
                                    key={JSON.stringify(option)}
                                    sx={{ whiteSpace: 'normal', maxWidth: 420 }}
                                    onClick={() => {
                                        setNewEndpoint(option.endpoint);
                                        setNewModel(option.model);
                                        setNewApiBase(option.api_base);
                                        setNewApiVersion(option.api_version);
                                        setNewApiKey('');
                                        setShowKeys(false);
                                        setAdvancedOpen(Boolean(option.api_version || (
                                            !['azure', 'ollama'].includes(option.endpoint) && option.api_base
                                        )));
                                        setAzureAuthMethod(option.auth_mode === 'azure_identity' ? 'azure_cli' : 'api_key');
                                        setNewModelError('');
                                        setNewModelDiagnostic(null);
                                        setRecentMenuAnchor(null);
                                    }}
                                >
                                    <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                                        <Typography variant="body2">
                                            {PROVIDERS[option.endpoint]?.label || option.endpoint} / {option.model}
                                        </Typography>
                                        {option.api_base && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                            {option.api_base}
                                        </Typography>}
                                    </Box>
                                </MenuItem>
                            ))}
                        </Menu>
                    </>}
                    {!isEditingDetails && detailModel && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                            {detailModelStatus === 'error' ? (
                                <Tooltip title={t('model.testFailedRetry')}>
                                    <Button
                                        size="small"
                                        variant="text"
                                        color="error"
                                        startIcon={<PlayCircleOutlineIcon />}
                                        onClick={() => testModel(detailModel)}
                                    >
                                        {t('model.test')}
                                    </Button>
                                </Tooltip>
                            ) : (
                                <Tooltip title={detailModelStatus === 'testing'
                                    ? t('model.testing')
                                    : detailModelStatus === 'ok' ? t('model.testPassed') : t('model.testModel')}>
                                    <span>
                                        <IconButton
                                            size="small"
                                            sx={{ width: 32, height: 32 }}
                                            color={detailModelStatus === 'ok' ? 'success' : 'primary'}
                                            disabled={detailModelStatus === 'testing'}
                                            aria-label={detailModelStatus === 'testing'
                                                ? t('model.testing')
                                                : detailModelStatus === 'ok' ? t('model.testPassed') : t('model.testModel')}
                                            onClick={() => testModel(detailModel)}
                                        >
                                            {detailModelStatus === 'testing'
                                                ? <CircularProgress size={iconVar.sm} color="inherit" />
                                                : detailModelStatus === 'ok'
                                                    ? <CheckCircleOutlineIcon fontSize="small" />
                                                    : <PlayCircleOutlineIcon fontSize="small" />}
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            )}
                            {!serverConfig.DISABLE_CUSTOM_MODELS && <Box sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                '& .MuiButton-root': {
                                    color: 'text.primary',
                                    minWidth: 0,
                                    px: 0.75,
                                    fontWeight: 500,
                                    '&:hover': { color: 'primary.main' },
                                },
                            }}>
                                {!detailIsGlobal && <>
                                    <Button size="small" variant="text" onClick={editModelDetails}>
                                        {t('model.edit')}
                                    </Button>
                                    <Divider orientation="vertical" aria-hidden="true" sx={{ height: 14 }} />
                                </>}
                                <Button
                                    size="small"
                                    variant="text"
                                    aria-label={t('model.copyDetails')}
                                    onClick={copyModelDetails}
                                >
                                    {t('app.copy')}
                                </Button>
                            </Box>}
                        </Box>
                    )}
                </Box>
                {isEditingDetails && !serverConfig.DISABLE_CUSTOM_MODELS ? addModelForm : modelDetails}
            </Box>
        </Box>
    );

    // A model is "ready" to use when it's been verified ('ok') or when it's a
    // server-configured model in 'unknown' state (trusted by default).
    const isModelReady = (id: string | undefined): boolean => {
        if (!id || !allModels.some(model => model.id === id)) return false;
        const status = getStatus(id);
        if (status === 'ok') return true;
        const isGlobal = globalModels.some(m => m.id === id);
        return isGlobal && status === 'unknown';
    };

    let modelNotReady = !isModelReady(tempSelectedModelId);

    let tempModel = allModels.find(m => m.id == tempSelectedModelId);
    let tempModelName = tempModel ? tempModel.display_name || `${tempModel.endpoint}/${tempModel.model}` : t('model.pleaseSelectModel');
    let selectedModelName = allModels.find(m => m.id == selectedModelId)?.model || t('model.unselected');

    const selectedReady = isModelReady(selectedModelId);
    const isInlineAction = appearance === 'inline';

    if (onStageConnection) return <Box sx={{ maxWidth: 700 }}>
        {addModelForm}
        {!hideStageAction && <Portal container={actionContainer} disablePortal={!actionContainer}>
            <Button sx={actionContainer ? undefined : { mt: 2 }} size="small" variant="contained" disabled={!readyToTest} onClick={handleSaveModel}
                startIcon={isAddingModel ? <CircularProgress size={16} /> : undefined}>Test and save</Button>
        </Portal>}
    </Box>;

    return <>
        <Tooltip title={t('model.selectModel')}>
            <Button
                sx={{
                    fontSize: isInlineAction ? 'inherit' : '13px',
                    fontWeight: 400,
                    textTransform: 'none',
                    px: 1.5,
                    py: 0.5,
                    minWidth: 'auto',
                    lineHeight: 1.5,
                    color: selectedReady ? 'text.secondary' : undefined,
                    '&:hover': {
                        color: selectedReady ? 'text.primary' : undefined,
                        backgroundColor: 'rgba(0, 0, 0, 0.04)',
                    },
                }}
                variant="text"
                color={selectedReady ? 'inherit' : 'warning'}
                onClick={() => {
                    const initialModel = allModels.find(model => model.id === selectedModelId) || allModels[0];
                    if (initialModel) loadModelDetails(initialModel);
                    else startNewModel();
                    setModelDialogOpen(true);
                }}
            >
                {selectedReady ? selectedModelName : t('model.selectModels')}
            </Button>
        </Tooltip>
        <Dialog 
            maxWidth="lg" 
            open={modelDialogOpen}
            onClose={() => {
                if (!isAddingModel) setModelDialogOpen(false);
            }}
        >
            <DialogTitle>{t('model.models')}</DialogTitle>
            <Dialog open={disconnectOpen} onClose={() => !disconnectPending && setDisconnectOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>{t(isChatGPT ? 'model.disconnectChatGPTTitle' : isCopilot ? 'model.disconnectCopilotTitle' : 'model.disconnectOpenRouterTitle')}</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">{t(isChatGPT ? 'model.disconnectChatGPTMessage' : isCopilot ? 'model.disconnectCopilotMessage' : 'model.disconnectOpenRouterMessage')}</Typography>
                    <Button component="a" href={isChatGPT ? 'https://chatgpt.com/#settings' : isCopilot ? 'https://github.com/settings/applications' : 'https://openrouter.ai/settings/keys'} target="_blank" rel="noopener noreferrer"
                        size="small" endIcon={<OpenInNewIcon />} sx={{ mt: 1 }}>
                        {t(isChatGPT ? 'model.manageChatGPTConnection' : isCopilot ? 'model.manageGitHubAuthorizations' : 'model.manageOpenRouterKeys')}
                    </Button>
                </DialogContent>
                <DialogActions>
                    <Button disabled={disconnectPending} onClick={() => setDisconnectOpen(false)}>{t('model.cancel')}</Button>
                    <Button disabled={disconnectPending} color="error" startIcon={<LogoutIcon />} onClick={disconnectOpenRouter}>
                        {t('model.disconnectAccount')}
                    </Button>
                </DialogActions>
            </Dialog>
            <DialogContent sx={{ width: { xs: '100%', sm: 720 }, maxWidth: '100%', boxSizing: 'border-box' }}>{modelManagerView}</DialogContent>
            <DialogActions sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                {isEditingDetails && !serverConfig.DISABLE_CUSTOM_MODELS ? (
                    <>
                        <Button variant="text" disabled={isAddingModel} onClick={() => {
                            if (detailModel) loadModelDetails(detailModel);
                            else {
                                const initialModel = allModels.find(model => model.id === selectedModelId) || allModels[0];
                                if (initialModel) loadModelDetails(initialModel);
                            }
                        }}>{t('model.cancel')}</Button>
                        <Button
                            variant="contained"
                            disabled={!readyToTest || modelExists}
                            onClick={handleSaveModel}
                            startIcon={isAddingModel ? <CircularProgress size={iconVar.md} color="inherit" /> : undefined}
                        >
                            {isAddingModel ? t('model.testing') : t('model.testAndSave')}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="text" onClick={() => setModelDialogOpen(false)}>{t('model.cancel')}</Button>
                        <Button
                            variant="contained"
                            disabled={modelNotReady}
                            onClick={() => {
                                dispatch(dfActions.selectModel(tempSelectedModelId));
                                setModelDialogOpen(false);
                            }}
                        >
                            {t('model.useModel', { modelName: tempModelName })}
                        </Button>
                    </>
                )}
            </DialogActions>
        </Dialog>
    </>;
}
