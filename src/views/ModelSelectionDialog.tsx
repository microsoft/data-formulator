// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux";
import {
    DataFormulatorState,
    dfActions,
    ModelConfig,
    ModelSlots,
    ModelSlotType,
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
    Radio,
    TextField,
    TableContainer,
    TableHead,
    Table,
    TableCell,
    TableRow,
    TableBody,
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
} from '@mui/material';


import { alpha, styled, useTheme } from '@mui/material/styles';

import AddCircleIcon from '@mui/icons-material/AddCircle';
import ClearIcon from '@mui/icons-material/Clear';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import { getUrls } from '../app/utils';
import { useTranslation } from 'react-i18next';


const decodeHtmlEntities = (text: string): string => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
};

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

export const ModelSelectionButton: React.FC<{}> = ({ }) => {
    const { t } = useTranslation();
    const theme = useTheme();

    const dispatch = useDispatch();
    const models = useSelector((state: DataFormulatorState) => state.models);
    const modelSlots = useSelector((state: DataFormulatorState) => state.modelSlots);
    const testedModels = useSelector((state: DataFormulatorState) => state.testedModels);

    const [modelDialogOpen, setModelDialogOpen] = useState<boolean>(false);
    const [showKeys, setShowKeys] = useState<boolean>(false);
    const [tempModelSlots, setTempModelSlots] = useState<ModelSlots>(modelSlots);
    const [providerModelOptions, setProviderModelOptions] = useState<{ [key: string]: string[] }>({
        'openai': [],
        'azure': [],
        'anthropic': [],
        'gemini': [],
        'ollama': []
    });
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

    let updateModelStatus = (model: ModelConfig, status: 'ok' | 'error' | 'testing' | 'unknown', message: string) => {
        dispatch(dfActions.updateModelStatus({ id: model.id, status, message }));
    }
    let getStatus = (id: string | undefined) => {
        return id != undefined ? (testedModels.find(t => (t.id == id))?.status || 'unknown') : 'unknown';
    }

    // Helper functions for slot management
    const updateTempSlot = (slotType: ModelSlotType, modelId: string | undefined) => {
        setTempModelSlots(prev => ({ ...prev, [slotType]: modelId }));
    };

    const isModelAssignedToSlot = (modelId: string, slotType: ModelSlotType) => {
        return tempModelSlots[slotType] === modelId;
    };

    // Ensure tempModelSlots is updated when modelSlots changes
    React.useEffect(() => {
        setTempModelSlots(modelSlots);
    }, [modelSlots]);

    const [newEndpoint, setNewEndpoint] = useState<string>(""); // openai, azure, ollama etc
    const [newModel, setNewModel] = useState<string>("");
    const [newApiKey, setNewApiKey] = useState<string>("");
    const [newApiBase, setNewApiBase] = useState<string>("");
    const [newApiVersion, setNewApiVersion] = useState<string>("");

    // Fetch available models from the API
    useEffect(() => {
        const fetchModelOptions = async () => {
            try {
                const response = await fetch(getUrls().CHECK_AVAILABLE_MODELS);
                const data = await response.json();

                // Group models by provider
                const modelsByProvider: { [key: string]: string[] } = {
                    'openai': [],
                    'azure': [],
                    'anthropic': [],
                    'gemini': [],
                    'ollama': []
                };

                data.forEach((modelConfig: any) => {
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

            } catch (error) {
                console.error("Failed to fetch model options:", error);
            }
        };

        fetchModelOptions();
    }, []);


    let modelExists = models.some(m =>
        m.endpoint == newEndpoint && m.model == newModel && m.api_base == newApiBase
        && m.api_key == newApiKey && m.api_version == newApiVersion);

    let testModel = (model: ModelConfig) => {
        updateModelStatus(model, 'testing', "");
        let message = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({
                model: model,
            }),
        };
        fetch(getUrls().TEST_MODEL, { ...message })
            .then((response) => response.json())
            .then((data) => {
                let status = data["status"] || 'error';
                updateModelStatus(model, status, data["message"] || "");
            }).catch((error) => {
                updateModelStatus(model, 'error', error.message)
            });
    }

    let readyToTest = newModel && (newApiKey || newApiBase);

    // Create enhanced slot assignment summary component
    const SlotAssignmentSummary: React.FC = () => {
        const slotTypes = dfSelectors.getAllSlotTypes();

        return (
            <Box sx={{ mb: 2 }}>
                <Typography variant="body1" sx={{ mb: 2, fontWeight: 'bold' }}>{t('modelSelection.modelAssignments')}</Typography>
                <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
                    {slotTypes.map(slotType => {
                        const assignedModelId = tempModelSlots[slotType];
                        const assignedModel = assignedModelId ? models.find(m => m.id === assignedModelId) : undefined;

                        let modelExplanation = "";
                        if (slotType == 'generation') {
                            modelExplanation = t('modelSelection.generationExplanation');
                        } else if (slotType == 'hint') {
                            modelExplanation = t('modelSelection.hintExplanation');
                        }

                        return (
                            <Box
                                key={slotType}
                                sx={{
                                    flex: '1 1 250px',
                                    minWidth: '250px',
                                    p: 1.5,
                                    border: '1px solid #e0e0e0',
                                    backgroundColor: assignedModel && getStatus(assignedModelId) == 'ok' ? alpha(theme.palette.success.main, 0.05) :
                                        assignedModel && getStatus(assignedModelId) == 'error' ? alpha(theme.palette.error.main, 0.05) : alpha(theme.palette.warning.main, 0.05),
                                    borderRadius: 1,
                                    borderColor: assignedModel && getStatus(assignedModelId) == 'ok' ? theme.palette.success.main :
                                        getStatus(assignedModelId) == 'error' ? theme.palette.error.main : theme.palette.warning.main
                                }}
                            >
                                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                    {t('modelSelection.modelFor')} {t(`modelSelection.${slotType}`)}
                                </Typography>
                                <Typography color="text.secondary" sx={{ fontSize: '0.75rem', mt: 0.5, mb: 1 }}>
                                    - {modelExplanation}
                                </Typography>
                                <FormControl fullWidth size="small">
                                    <Select
                                        required
                                        value={assignedModelId || ''}
                                        onChange={(event: SelectChangeEvent) => {
                                            const modelId = event.target.value || undefined;
                                            updateTempSlot(slotType, modelId);
                                        }}
                                        displayEmpty
                                        sx={{ fontSize: '0.875rem' }}
                                        renderValue={(selected) => {
                                            if (!selected) {
                                                return <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                                    <Box sx={{ flex: 1 }}>
                                                        <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                                                            {t('modelSelection.noModelAssigned')}
                                                        </Typography>
                                                    </Box>
                                                    <ErrorOutlineIcon sx={{ color: 'error.main', ml: 1 }} fontSize="small" />
                                                </Box>;
                                            }
                                            const model = models.find(m => m.id === selected);
                                            return model ? <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                                <Box sx={{ flex: 1 }}>
                                                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                                                        {model.endpoint}/{model.model}
                                                        {model.api_base && (
                                                            <Typography variant="caption" sx={{ ml: 0.5, color: 'text.secondary', fontSize: '0.75rem' }}>
                                                                ({model.api_base})
                                                            </Typography>
                                                        )}
                                                    </Typography>
                                                </Box>
                                                {getStatus(assignedModelId) === 'ok' ? <CheckCircleOutlineIcon sx={{ color: 'success.main', ml: 1 }} fontSize="small" />
                                                    : getStatus(assignedModelId) === 'error' ? <ErrorOutlineIcon sx={{ color: 'error.main', ml: 1 }} fontSize="small" />
                                                        : <HelpOutlineIcon sx={{ color: 'warning.main', ml: 1 }} fontSize="small" />}
                                            </Box> : 'Unknown model';
                                        }}
                                    >
                                        <MenuItem value="">
                                            <Typography sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>{t('modelSelection.noAssignment')}</Typography>
                                        </MenuItem>
                                        {models.map((model) => (
                                            <MenuItem key={model.id} value={model.id} disabled={getStatus(model.id) !== 'ok'}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                                    <Box sx={{ flex: 1 }}>
                                                        <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                                                            {model.endpoint}/{model.model}
                                                        </Typography>
                                                        {model.api_base && (
                                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                                                                {model.api_base}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                    {getStatus(model.id) === 'ok' ? <CheckCircleOutlineIcon sx={{ color: 'success.main', ml: 1 }} fontSize="small" />
                                                        : getStatus(model.id) === 'error' ? <ErrorOutlineIcon sx={{ color: 'error.main', ml: 1 }} fontSize="small" />
                                                            : <HelpOutlineIcon sx={{ color: 'warning.main', ml: 1 }} fontSize="small" />}
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>
                        );
                    })}
                </Box>
                <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    <strong>{t('modelSelection.tip')}</strong> {t('modelSelection.tipText')}
                </Typography>
            </Box>
        );
    };

    let newModelEntry = <TableRow
        key={`new-model-entry`}
        sx={{
            '&:last-child td, &:last-child th': { border: 0 },
            padding: "6px 6px"
        }}
    >
        <TableCell align="left">
            <Autocomplete
                freeSolo
                value={newEndpoint}
                onChange={(event: any, newValue: string | null) => {
                    setNewEndpoint(newValue || "");
                    if (newModel == "" && newValue == "openai" && providerModelOptions.openai.length > 0) {
                        setNewModel(providerModelOptions.openai[0]);
                    }
                    if (!newApiVersion && newValue == "azure") {
                        setNewApiVersion("2024-02-15");
                    }
                }}
                options={['openai', 'azure', 'ollama', 'anthropic', 'gemini']}
                renderOption={(props, option) => (
                    <Typography {...props} onClick={() => setNewEndpoint(option)} sx={{ fontSize: "0.875rem" }}>
                        {option}
                    </Typography>
                )}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        placeholder={t('modelSelection.provider')}
                        slotProps={{
                            input: {
                                ...params.InputProps,
                                style: { fontSize: "0.75rem" }
                            }
                        }}
                        size="small"
                        onChange={(event: any) => setNewEndpoint(event.target.value)}
                    />
                )}
                slotProps={{
                    listbox: {
                        style: { padding: 0 }
                    },
                }}
                slots={{
                    paper: (props) => {
                        return <Paper {...props}>
                            <Typography sx={{ p: 1, color: 'gray', fontStyle: 'italic', fontSize: '0.75rem' }}>
                                {t('modelSelection.examples')}
                            </Typography>
                            {props.children}
                        </Paper>
                    }
                }}
            />
        </TableCell>
        <TableCell align="left" sx={{ minWidth: '180px' }}>
            <TextField fullWidth size="small" type={showKeys ? "text" : "password"}
                slotProps={{
                    input: {
                        style: { fontSize: "0.75rem" }
                    }
                }}
                placeholder={t('modelSelection.optionalForKeyless')}
                value={newApiKey}
                onChange={(event: any) => { setNewApiKey(event.target.value); }}
                autoComplete='off'
            />
        </TableCell>
        <TableCell align="left">
            <TextField
                size="small"
                fullWidth
                value={newModel}
                onChange={(event) => { setNewModel(event.target.value); }}
                placeholder={t('modelSelection.modelName')}
                error={newEndpoint != "" && !newModel}
                slotProps={{
                    input: {
                        style: { fontSize: "0.75rem" },
                        'aria-label': 'Enter a model name',
                    }
                }}
            />
        </TableCell>
        <TableCell align="right">
            <TextField size="small" type="text" fullWidth
                placeholder="api_base"
                slotProps={{
                    input: {
                        style: { fontSize: "0.75rem" }
                    }
                }}
                value={newApiBase}
                onChange={(event: any) => { setNewApiBase(event.target.value); }}
                autoComplete='off'
            />
        </TableCell>
        <TableCell align="right">
            <TextField size="small" type="text" fullWidth
                slotProps={{
                    input: {
                        style: { fontSize: "0.75rem" }
                    }
                }}
                value={newApiVersion} onChange={(event: any) => { setNewApiVersion(event.target.value); }}
                autoComplete='off'
                placeholder="api_version"
            />
        </TableCell>
        <TableCell align="right">
            <Tooltip title={modelExists ? t('modelSelection.providerModelExists') : t('modelSelection.addAndTestModel')}>
                <span>
                    <IconButton color={modelExists ? 'error' : 'primary'}
                        disabled={!readyToTest}
                        sx={{ cursor: modelExists ? 'help' : 'pointer' }}
                        onClick={(event) => {
                            event.stopPropagation()

                            let endpoint = newEndpoint;

                            // Hash the ID to prevent API key exposure
                            const idString = `${endpoint}-${newModel}-${newApiKey}-${newApiBase}-${newApiVersion}`;
                            let id = simpleHash(idString);

                            let model = { endpoint, model: newModel, api_key: newApiKey, api_base: newApiBase, api_version: newApiVersion, id: id };

                            dispatch(dfActions.addModel(model));

                            // Create a custom test function that assigns to slot on success
                            const testAndAssignModel = (model: ModelConfig) => {
                                updateModelStatus(model, 'testing', "");
                                let message = {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', },
                                    body: JSON.stringify({
                                        model: model,
                                    }),
                                };
                                fetch(getUrls().TEST_MODEL, { ...message })
                                    .then((response) => response.json())
                                    .then((data) => {
                                        let status = data["status"] || 'error';
                                        updateModelStatus(model, status, data["message"] || "");
                                        // Only assign to slot if test is successful
                                        if (status === 'ok') {
                                            for (let slotType of dfSelectors.getAllSlotTypes()) {
                                                if (!tempModelSlots[slotType]) {
                                                    updateTempSlot(slotType, id);
                                                }
                                            }
                                        }
                                    }).catch((error) => {
                                        updateModelStatus(model, 'error', error.message)
                                    });
                            };

                            testAndAssignModel(model);

                            setNewEndpoint("");
                            setNewModel("");
                            setNewApiKey("");
                            setNewApiBase("");
                            setNewApiVersion("");
                        }}>
                        <AddCircleIcon />
                    </IconButton>
                </span>
            </Tooltip>
        </TableCell>
        <TableCell align="right">
            <Tooltip title={t('modelSelection.clear')}>
                <IconButton
                    onClick={(event) => {
                        event.stopPropagation()
                        setNewEndpoint("");
                        setNewModel("");
                        setNewApiKey("");
                        setNewApiBase("");
                        setNewApiVersion("");
                    }}>
                    <ClearIcon />
                </IconButton>
            </Tooltip>
        </TableCell>

    </TableRow>

    let modelTable = <TableContainer>
        <Table sx={{ minWidth: 600, "& .MuiTableCell-root": { padding: "4px 8px", borderBottom: "none", fontSize: '0.75rem' } }} size="small" >
            <TableHead >
                <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', width: '120px' }}>{t('modelSelection.provider')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: '160px' }}>{t('modelSelection.apiKey')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: '160px' }} align="left">{t('modelSelection.model')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: '200px' }} align="left">{t('modelSelection.apiBase')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: '120px' }} align="left">{t('modelSelection.apiVersion')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }} align="left">{t('modelSelection.status')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }} align="right"></TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {models.map((model) => {
                    let status = getStatus(model.id);

                    let statusIcon = status == "unknown" ? <HelpOutlineIcon color="warning" fontSize="small" /> : (status == 'testing' ? <CircularProgress size={20} /> :
                        (status == "ok" ? <CheckCircleOutlineIcon color="success" fontSize="small" /> : <ErrorOutlineIcon color="error" fontSize="small" />))

                    let message = t('modelSelection.modelReady');
                    if (status == "unknown") {
                        message = t('modelSelection.clickToTest');
                    } else if (status == "error") {
                        const rawMessage = testedModels.find(t => t.id == model.id)?.message || "Unknown error";
                        message = `${t('modelSelection.error')}: ${decodeHtmlEntities(rawMessage)}. ${t('modelSelection.clickToRetest')}`;
                    }

                    const borderStyle = ['error'].includes(status) ? '1px dashed lightgray' : undefined;
                    const noBorderStyle = ['error'].includes(status) ? 'none' : undefined;

                    // Check if model is assigned to any slot
                    const isAssignedToAnySlot = dfSelectors.getAllSlotTypes().some(slotType => isModelAssignedToSlot(model.id, slotType));

                    return (
                        <React.Fragment key={`${model.id}`}>
                            <TableRow
                                key={`${model.id}`}
                                sx={{
                                    '& .MuiTableCell-root': { fontSize: '0.75rem' },
                                    '&:hover': { backgroundColor: '#f8f9fa' },
                                    backgroundColor: isAssignedToAnySlot ? alpha(theme.palette.success.main, 0.07) : '#fff'
                                }}
                            >
                                <TableCell align="left" sx={{ borderBottom: noBorderStyle }}>
                                    <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 'inherit' }}>
                                        {model.endpoint}
                                    </Typography>
                                </TableCell>
                                <TableCell component="th" scope="row" sx={{ borderBottom: borderStyle }}>
                                    {model.api_key ? (showKeys ?
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                maxWidth: '220px',
                                                wordBreak: 'break-all',
                                                whiteSpace: 'normal',
                                                fontSize: '0.5rem',
                                                fontFamily: 'monospace',
                                                lineHeight: 1.3
                                            }}
                                        >
                                            {model.api_key}
                                        </Typography>
                                        : <Typography variant="body2" sx={{ fontSize: 'inherit', fontFamily: 'monospace', color: 'text.secondary' }}>••••••••••••</Typography>)
                                        : <Typography sx={{ color: "text.secondary", fontSize: 'inherit', fontStyle: 'italic' }}>{t('modelSelection.none')}</Typography>
                                    }
                                </TableCell>
                                <TableCell align="left" sx={{ borderBottom: borderStyle }}>
                                    <Typography variant="body2" sx={{ fontSize: 'inherit', fontWeight: 500 }}>
                                        {model.model}
                                    </Typography>
                                </TableCell>
                                <TableCell align="left" sx={{ borderBottom: borderStyle }}>
                                    {model.api_base ? (
                                        <Typography variant="body2" sx={{
                                            fontSize: 'inherit',
                                            maxWidth: '220px',
                                            wordBreak: 'break-all',
                                            lineHeight: 1.3
                                        }}>
                                            {model.api_base}
                                        </Typography>
                                    ) : (
                                        <Typography sx={{ color: "text.secondary", fontSize: 'inherit', fontStyle: 'italic' }}>
                                            Default
                                        </Typography>
                                    )}
                                </TableCell>
                                <TableCell align="left" sx={{ borderBottom: borderStyle }}>
                                    {model.api_version ? (
                                        <Typography variant="body2" sx={{ fontSize: 'inherit' }}>
                                            {model.api_version}
                                        </Typography>
                                    ) : (
                                        <Typography sx={{ color: "text.secondary", fontSize: 'inherit', fontStyle: 'italic' }}>
                                            Default
                                        </Typography>
                                    )}
                                </TableCell>
                                <TableCell sx={{ borderBottom: borderStyle }} align="left">
                                    <Tooltip title={message}>
                                        <Button
                                            size="small"
                                            color={status == 'ok' ? 'success' : status == 'error' ? 'error' : 'warning'}
                                            onClick={() => { testModel(model) }}
                                            sx={{ p: 0.75, fontSize: "0.75rem", textTransform: "none" }}
                                            startIcon={statusIcon}
                                        >
                                            {status == 'ok' ? t('modelSelection.ready') : status == 'error' ? t('modelSelection.retest') : t('modelSelection.test')}
                                        </Button>
                                    </Tooltip>
                                </TableCell>
                                <TableCell sx={{ borderBottom: borderStyle }} align="right">
                                    <Tooltip title={t('modelSelection.removeModel')}>
                                        <IconButton
                                            size="small"
                                            onClick={() => {
                                                dispatch(dfActions.removeModel(model.id));
                                                // Remove from all slots if assigned
                                                dfSelectors.getAllSlotTypes().forEach(slotType => {
                                                    if (isModelAssignedToSlot(model.id, slotType)) {
                                                        updateTempSlot(slotType, undefined);
                                                    }
                                                });
                                            }}
                                            sx={{ p: 0.75 }}
                                        >
                                            <ClearIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                            {['error'].includes(status) && (
                                <TableRow>
                                    <TableCell colSpan={1} align="right" ></TableCell>
                                    <TableCell colSpan={7}>
                                        <Typography variant="caption" color="#c82c2c" sx={{ fontSize: "0.625rem" }}>
                                            {message}
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                        </React.Fragment>
                    )
                })}
                {newModelEntry}
                <TableRow>
                    <TableCell colSpan={8} sx={{ pt: 2, pb: 1 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.75rem' }}>
                            <strong>{t('modelSelection.configuration')}</strong> {t('modelSelection.basedOnLiteLLM')} <a href="https://docs.litellm.ai/docs/" target="_blank" rel="noopener noreferrer">{t('modelSelection.seeSupportedProviders')}</a>.
                            {t('modelSelection.useOpenAI')}
                        </Typography>

                    </TableCell>
                </TableRow>
            </TableBody>
        </Table>
    </TableContainer>

    let notAllSlotsReady = Object.values(tempModelSlots).filter(id => id).length !== dfSelectors.getAllSlotTypes().length
        || Object.values(tempModelSlots).filter(id => id).some(id => getStatus(id) !== 'ok');

    let genModelName = models.find(m => m.id == modelSlots['generation'])?.model || 'Unknown';
    let hintModelName = models.find(m => m.id == modelSlots['hint'])?.model || 'Unknown';
    let modelNames = (genModelName == hintModelName) ? genModelName : `${genModelName} / ${hintModelName}`;

    return <>
        <Tooltip title={t('modelSelection.configureModels')}>
            <Button sx={{ fontSize: "inherit", textTransform: "none" }} variant="text" color={notAllSlotsReady ? 'warning' : "primary"} onClick={() => { setModelDialogOpen(true) }}>
                {notAllSlotsReady ? t('modelSelection.selectModels') : modelNames}
            </Button>
        </Tooltip>
        <Dialog
            maxWidth="lg"
            open={modelDialogOpen}
            onClose={(event, reason) => {
                if (reason !== 'backdropClick') {
                    setModelDialogOpen(false);
                }
            }}
        >
            <DialogTitle sx={{ display: "flex", alignItems: "center" }}>{t('modelSelection.configureModels')}</DialogTitle>
            <DialogContent >
                <SlotAssignmentSummary />
                <Divider sx={{ my: 2 }} textAlign="left">
                    <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                        {t('modelSelection.availableModels')}
                    </Typography>
                </Divider>
                {modelTable}
            </DialogContent>
            <DialogActions>
                {!serverConfig.DISABLE_DISPLAY_KEYS && (
                    <Button sx={{ marginRight: 'auto' }} endIcon={showKeys ? <VisibilityOffIcon /> : <VisibilityIcon />} onClick={() => {
                        setShowKeys(!showKeys);
                    }}>
                        {showKeys ? t('modelSelection.hideKeys') : t('modelSelection.showKeys')}
                    </Button>
                )}
                <Button disabled={notAllSlotsReady}
                    variant={Object.values(tempModelSlots).filter(id => id).length == 0 ? 'text' : 'contained'}
                    onClick={() => {
                        dispatch(dfActions.setModelSlots(tempModelSlots));
                        setModelDialogOpen(false);
                    }}>{t('modelSelection.applySlotAssignments')}</Button>
                <Button onClick={() => {
                    setTempModelSlots(modelSlots);
                    setModelDialogOpen(false);
                }}>cancel</Button>
            </DialogActions>
        </Dialog>
    </>;
}
