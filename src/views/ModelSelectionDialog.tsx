// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
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
    Button,
    Tooltip,
    Typography,
    IconButton,
    DialogTitle,
    Dialog,
    DialogContent,
    DialogActions,
    TextField,
    Autocomplete,
    CircularProgress,
    FormControl,
    Select,
    SelectChangeEvent,
    MenuItem,
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

import { getUrls } from '../app/utils';
import { apiRequest, ApiError, ApiRequestError } from '../app/apiClient';
import { useTranslation } from 'react-i18next';
import { LogViewerDialog } from './LogViewerDialog';
import { iconVar } from '../app/layout';


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

interface ModelSelectionButtonProps {
    appearance?: 'toolbar' | 'inline';
}

interface RememberedModelEndpoint {
    endpoint: string;
    model: string;
    api_base: string;
    api_version: string;
    auth_mode: string;
}

export const ModelSelectionButton: React.FC<ModelSelectionButtonProps> = ({ appearance = 'toolbar' }) => {
    const { t } = useTranslation();

    const dispatch = useDispatch();
    const globalModels = useSelector((state: DataFormulatorState) => state.globalModels ?? []);
    const models = useSelector((state: DataFormulatorState) => state.models);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const testedModels = useSelector((state: DataFormulatorState) => state.testedModels);
    const config = useSelector((state: DataFormulatorState) => state.config);

    const [modelDialogOpen, setModelDialogOpen] = useState<boolean>(false);
    const [detailModelId, setDetailModelId] = useState<string | undefined>(selectedModelId);
    const [isEditingDetails, setIsEditingDetails] = useState(false);
    const [showKeys, setShowKeys] = useState<boolean>(false);
    const [providerModelOptions, setProviderModelOptions] = useState<{[key: string]: string[]}>({
        'openai': [],
        'azure': [],
        'anthropic': [],
        'gemini': [],
        'ollama': []
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
    const [newEndpoint, setNewEndpoint] = useState<string>(""); // openai, azure, ollama etc
    const [newModel, setNewModel] = useState<string>("");
    const [newApiKey, setNewApiKey] = useState<string>("");
    const [newApiBase, setNewApiBase] = useState<string>("");
    const [newApiVersion, setNewApiVersion] = useState<string>("");
    const [azureAuthMethod, setAzureAuthMethod] = useState<'azure_cli' | 'api_key'>('azure_cli');
    const [isAddingModel, setIsAddingModel] = useState(false);
    const [newModelError, setNewModelError] = useState("");
    const [newModelDiagnostic, setNewModelDiagnostic] = useState<ApiError | null>(null);
    const [modelLogsOpen, setModelLogsOpen] = useState(false);
    const [rememberedEndpoints, setRememberedEndpoints] = useState<RememberedModelEndpoint[]>([]);
    const [azureCliStatus, setAzureCliStatus] = useState<{
        installed: boolean;
        signed_in: boolean;
        account: { user?: string; tenant_id?: string } | null;
    } | null>(null);
    const [azureCliLoginPending, setAzureCliLoginPending] = useState(false);

    const usesAzureCli = serverConfig.IS_LOCAL_MODE && (
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
        if (!modelDialogOpen) return;
        apiRequest<RememberedModelEndpoint[]>(getUrls().MODEL_ENDPOINTS)
            .then(({ data }) => setRememberedEndpoints(data))
            .catch(() => setRememberedEndpoints([]));
    }, [modelDialogOpen]);

    const rememberModelEndpoint = (model: ModelConfig) => {
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
            'ollama': []
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


    const allModels = [...globalModels, ...models];
    const detailModel = allModels.find(model => model.id === detailModelId);
    const detailIsGlobal = globalModels.some(model => model.id === detailModelId);
    const detailModelStatus = getStatus(detailModelId);
    const detailHasConfiguredApiKey = detailModel
        ? detailIsGlobal
            ? detailModel.auth_mode === 'key'
            : Boolean(detailModel.api_key)
        : false;

    let modelExists = allModels.some(m => m.id !== detailModelId &&
        m.endpoint == newEndpoint && m.model == newModel && m.api_base == newApiBase 
        && (m.api_key || '') == newApiKey && (m.api_version || '') == newApiVersion);

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

    let readyToTest = newModel && (newApiKey || newApiBase) && !isAddingModel;

    const resetNewModelForm = () => {
        setNewEndpoint("");
        setNewModel("");
        setNewApiKey("");
        setNewApiBase("");
        setNewApiVersion("");
        setAzureAuthMethod('azure_cli');
        setNewModelError("");
        setNewModelDiagnostic(null);
    };

    const handleSaveModel = async () => {
        const updatingUserModel = detailModelId && !detailIsGlobal;
        const id = updatingUserModel
            ? detailModelId
            : simpleHash(`${newEndpoint}-${newModel}-${newApiKey}-${newApiBase}-${newApiVersion}`);
        const model: ModelConfig = {
            endpoint: newEndpoint,
            model: newModel,
            api_key: newApiKey,
            api_base: newApiBase,
            api_version: newApiVersion,
            auth_mode: newEndpoint === 'azure'
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
        setDetailModelId(model.id);
        setTempSelectedModelId(model.id);
        setNewEndpoint(model.endpoint);
        setNewModel(model.model);
        setNewApiBase(model.api_base || '');
        setNewApiVersion(model.api_version || '');
        setNewApiKey(model.is_global ? '' : model.api_key || '');
        setAzureAuthMethod(
            model.endpoint === 'azure' && model.auth_mode !== 'key' && !model.api_key
                ? 'azure_cli'
                : 'api_key'
        );
        setNewModelError('');
        setNewModelDiagnostic(null);
        setIsEditingDetails(false);
    };

    const startNewModel = () => {
        setDetailModelId(undefined);
        resetNewModelForm();
        setIsEditingDetails(true);
    };

    const editModelDetails = () => {
        setIsEditingDetails(true);
    };

    const copyModelDetails = () => {
        setDetailModelId(undefined);
        setNewModelError('');
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

    const addModelForm = (
        <Box sx={{ display: 'grid', gap: 2 }}>
            {isEditingDetails && rememberedEndpoints.length > 0 && (
                <Autocomplete
                    size="small"
                    options={rememberedEndpoints}
                    value={null}
                    getOptionLabel={(option) => `${option.endpoint} / ${option.model}`}
                    renderOption={(props, option) => (
                        <li {...props} key={`${option.endpoint}-${option.model}-${option.api_base}-${option.api_version}`}>
                            <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2">{option.endpoint} / {option.model}</Typography>
                                {option.api_base && (
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                                        {option.api_base}
                                    </Typography>
                                )}
                            </Box>
                        </li>
                    )}
                    onChange={(_event, option) => {
                        if (!option) return;
                        setNewEndpoint(option.endpoint);
                        setNewModel(option.model);
                        setNewApiBase(option.api_base);
                        setNewApiVersion(option.api_version);
                        setNewApiKey('');
                        setAzureAuthMethod(option.auth_mode === 'azure_identity' ? 'azure_cli' : 'api_key');
                        setNewModelError('');
                        setNewModelDiagnostic(null);
                    }}
                    renderInput={(params) => (
                        <TextField {...params} label={t('model.recentConfigurations')} />
                    )}
                />
            )}
            <TextField
                select
                fullWidth
                size="small"
                disabled={!isEditingDetails}
                label={t('model.provider')}
                value={newEndpoint}
                onChange={(event) => {
                    const provider = event.target.value;
                    setNewEndpoint(provider);
                    setNewModelError("");
                    setNewModelDiagnostic(null);
                }}
            >
                {['openai', 'azure', 'ollama', 'anthropic', 'gemini'].map(provider => (
                    <MenuItem key={provider} value={provider}>{provider}</MenuItem>
                ))}
            </TextField>

            <TextField
                fullWidth
                size="small"
                disabled={!isEditingDetails}
                label={newEndpoint === 'azure' ? t('model.deploymentName') : t('model.model')}
                value={newModel}
                onChange={(event) => setNewModel(event.target.value)}
                placeholder={t('model.modelPlaceholder')}
                autoComplete="off"
            />

            {newEndpoint === 'azure' && (
                <ToggleButtonGroup
                    exclusive
                    fullWidth
                    size="small"
                    disabled={!isEditingDetails}
                    value={azureAuthMethod}
                    onChange={(_event, value) => {
                        if (!value) return;
                        setAzureAuthMethod(value);
                        if (value === 'azure_cli') setNewApiKey('');
                    }}
                    aria-label={t('model.authentication')}
                >
                    <ToggleButton value="azure_cli">Azure CLI</ToggleButton>
                    <ToggleButton value="api_key">{t('model.apiKey')}</ToggleButton>
                </ToggleButtonGroup>
            )}

            {newEndpoint === 'azure' && azureAuthMethod === 'azure_cli' && (
                <Box sx={{ px: 1.5, py: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                        {t('model.authentication')}
                    </Typography>
                    {azureCliStatus?.signed_in ? (
                        <Typography variant="body2" color="success.main">
                            {t('model.azureCliAccess', {
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

            {newEndpoint && (newEndpoint !== 'azure' || azureAuthMethod === 'api_key')
                && (isEditingDetails || detailHasConfiguredApiKey) && (
                <TextField
                    fullWidth
                    size="small"
                    disabled={!isEditingDetails}
                    type={isEditingDetails && !showKeys ? 'password' : 'text'}
                    label={t('model.apiKey')}
                    value={isEditingDetails ? newApiKey : CONFIGURED_SECRET_MASK}
                    onChange={(event) => setNewApiKey(event.target.value)}
                    autoComplete="off"
                />
            )}

            {newEndpoint && (isEditingDetails || Boolean(newApiBase)) && (
                <TextField
                    fullWidth
                    size="small"
                    disabled={!isEditingDetails}
                    label={newEndpoint === 'azure' ? t('model.endpoint') : t('model.apiBase')}
                    value={newApiBase}
                    onChange={(event) => setNewApiBase(event.target.value)}
                    placeholder={newEndpoint === 'ollama' ? 'http://localhost:11434' : undefined}
                    autoComplete="off"
                />
            )}

            {newEndpoint === 'azure' && (isEditingDetails || Boolean(newApiVersion)) && (
                <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="body2">{t('model.advancedSettings')}</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                        <TextField
                            fullWidth
                            size="small"
                            disabled={!isEditingDetails}
                            label={t('model.apiVersion')}
                            value={newApiVersion}
                            onChange={(event) => setNewApiVersion(event.target.value)}
                            autoComplete="off"
                        />
                    </AccordionDetails>
                </Accordion>
            )}

            {isEditingDetails && modelExists && <Typography variant="caption" color="error">{t('model.providerModelExists')}</Typography>}
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
                                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{model.model}</Typography>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                                        {model.endpoint}
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
                    <Button
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
                    </Button>
                </Box>
            </Box>
            <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {detailModel ? detailModel.model : t('model.newModel')}
                        </Typography>
                        {detailIsGlobal && (
                            <Typography variant="caption" color="text.secondary">{t('model.serverManaged')}</Typography>
                        )}
                    </Box>
                    {!isEditingDetails && detailModel && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Button
                                size="small"
                                variant="outlined"
                                color={detailModelStatus === 'ok' ? 'success' : detailModelStatus === 'error' ? 'error' : 'primary'}
                                disabled={detailModelStatus === 'testing'}
                                startIcon={detailModelStatus === 'testing'
                                    ? <CircularProgress size={iconVar.sm} color="inherit" />
                                    : detailModelStatus === 'ok'
                                        ? <CheckCircleOutlineIcon />
                                        : detailModelStatus === 'error'
                                            ? <ErrorOutlineIcon />
                                            : <PlayCircleOutlineIcon />}
                                onClick={() => testModel(detailModel)}
                            >
                                {detailModelStatus === 'testing'
                                    ? t('model.testing')
                                    : detailModelStatus === 'ok'
                                        ? t('model.testPassed')
                                        : detailModelStatus === 'error'
                                            ? t('model.testFailedRetry')
                                            : t('model.testModel')}
                            </Button>
                            {detailIsGlobal ? (
                                <Button
                                    size="small"
                                    variant="text"
                                    startIcon={<ContentCopyOutlinedIcon />}
                                    onClick={copyModelDetails}
                                >
                                    {t('model.copyDetails')}
                                </Button>
                            ) : (
                                <Button size="small" variant="text" onClick={editModelDetails}>
                                    {t('model.edit')}
                                </Button>
                            )}
                        </Box>
                    )}
                </Box>
                {addModelForm}
            </Box>
        </Box>
    );

    // A model is "ready" to use when it's been verified ('ok') or when it's a
    // server-configured model in 'unknown' state (trusted by default).
    const isModelReady = (id: string | undefined): boolean => {
        if (!id) return false;
        const status = getStatus(id);
        if (status === 'ok') return true;
        const isGlobal = globalModels.some(m => m.id === id);
        return isGlobal && status === 'unknown';
    };

    let modelNotReady = !isModelReady(tempSelectedModelId);

    let tempModel = allModels.find(m => m.id == tempSelectedModelId);
    let tempModelName = tempModel ? `${tempModel.endpoint}/${tempModel.model}` : t('model.pleaseSelectModel');
    let selectedModelName = allModels.find(m => m.id == selectedModelId)?.model || t('model.unselected');

    const selectedReady = isModelReady(selectedModelId);
    const isInlineAction = appearance === 'inline';

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
            <DialogContent sx={{ minWidth: { sm: 720 } }}>{modelManagerView}</DialogContent>
            <DialogActions>
                {isEditingDetails ? (
                    <>
                        {!serverConfig.DISABLE_DISPLAY_KEYS && newEndpoint
                            && (newEndpoint !== 'azure' || azureAuthMethod === 'api_key') && (
                            <FormControlLabel
                                control={<Switch size="small" checked={showKeys} onChange={() => setShowKeys(!showKeys)} />}
                                label={<Typography variant="body2">{t('model.showKeys')}</Typography>}
                            />
                        )}
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
