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
import Chip from '@mui/material/Chip';

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
    Checkbox,
    Switch,
    FormControlLabel,
} from '@mui/material';


import { alpha, styled, useTheme } from '@mui/material/styles';

import AddCircleIcon from '@mui/icons-material/AddCircle';
import ClearIcon from '@mui/icons-material/Clear';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';

import { getUrls } from '../app/utils';
import { apiRequest, ApiRequestError } from '../app/apiClient';
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
    const theme = useTheme();
    const { t } = useTranslation();

    const dispatch = useDispatch();
    const globalModels = useSelector((state: DataFormulatorState) => state.globalModels ?? []);
    const models = useSelector((state: DataFormulatorState) => state.models);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const testedModels = useSelector((state: DataFormulatorState) => state.testedModels);

    const [modelDialogOpen, setModelDialogOpen] = useState<boolean>(false);
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


    let modelExists = models.some(m => 
        m.endpoint == newEndpoint && m.model == newModel && m.api_base == newApiBase 
        && m.api_key == newApiKey && m.api_version == newApiVersion);

    let testModel = (model: ModelConfig) => {
        updateModelStatus(model, 'testing', "");
        apiRequest(getUrls().TEST_MODEL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model }),
        })
            .then(({ data }) => {
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

    let readyToTest = newModel && (newApiKey || newApiBase);

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

    let newModelEntry = <TableRow
        key={`new-model-entry`}
        sx={{ '&:last-child td, &:last-child th': { border: 0 }, '& td': { py: 1 } }}
    >
        <TableCell align="left">
            <TextField
                size="small"
                fullWidth
                variant="outlined"
                value={newModel}
                onChange={(event) => { setNewModel(event.target.value); }}
                placeholder={t('model.modelPlaceholder')}
                error={newEndpoint != "" && !newModel}
                sx={inputSx}
                slotProps={{ input: { 'aria-label': t('model.enterModelName') } }}
                autoComplete='off'
                inputProps={{ 'data-form-type': 'other' }}
            />
        </TableCell>
        <TableCell align="left">
            <TextField fullWidth size="small" type={showKeys ? "text" : "password"} 
                variant="outlined"
                sx={inputSx}
                placeholder={t('model.optionalKeylessEndpoint')}
                value={newApiKey}  
                onChange={(event: any) => { setNewApiKey(event.target.value); }} 
                autoComplete='off'
                inputProps={{ autoComplete: 'off', 'data-form-type': 'other' }}
            />
        </TableCell>
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
                    <Typography {...props} onClick={() => setNewEndpoint(option)} sx={{ fontSize: "0.75rem" }}>
                        {option}
                    </Typography>
                )}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        placeholder={t('model.providerPlaceholder')}
                        size="small"
                        autoComplete="off"
                        sx={inputSx}
                        onChange={(event: any) => setNewEndpoint(event.target.value)}
                    />
                )}
                slotProps={{ listbox: { style: { padding: 0 } } }}
            />
        </TableCell>
        <TableCell align="left">
            <TextField size="small" type="text" fullWidth
                variant="outlined"
                placeholder={t('model.optional')}
                sx={inputSx}
                value={newApiBase}  
                onChange={(event: any) => { setNewApiBase(event.target.value); }} 
                autoComplete='off'
            />
        </TableCell>
        <TableCell align="left">
            <TextField size="small" type="text" fullWidth
                variant="outlined"
                sx={inputSx}
                value={newApiVersion}  onChange={(event: any) => { setNewApiVersion(event.target.value); }} 
                autoComplete='off'
                placeholder={t('model.optional')}
            />
        </TableCell>
        <TableCell align="left">
            <Tooltip title={modelExists ? t('model.providerModelExists') : t('model.addAndTestModel')}>
                <span>  
                    <IconButton color={modelExists ? 'error' : 'primary'}
                        disabled={!readyToTest}
                        size="small"
                        sx={{ cursor: modelExists ? 'help' : 'pointer', p: 0.25 }}
                        onClick={(event) => {
                            event.stopPropagation()

                            let endpoint = newEndpoint;

                            const idString = `${endpoint}-${newModel}-${newApiKey}-${newApiBase}-${newApiVersion}`;
                            let id = simpleHash(idString);

                            let model = {endpoint, model: newModel, api_key: newApiKey, api_base: newApiBase, api_version: newApiVersion, id: id};

                            dispatch(dfActions.addModel(model));

                            const testAndAssignModel = (model: ModelConfig) => {
                                updateModelStatus(model, 'testing', "");
                                apiRequest(getUrls().TEST_MODEL, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ model }),
                                })
                                    .then(({ data }) => {
                                        updateModelStatus(model, 'ok', data.message || "");
                                        setTempSelectedModelId(id);
                                    }).catch((error) => {
                                        const msg = error instanceof ApiRequestError
                                            ? error.apiError.message
                                            : error.message;
                                        updateModelStatus(model, 'error', msg);
                                    });
                            };

                            testAndAssignModel(model); 
                            
                            setNewEndpoint("");
                            setNewModel("");
                            setNewApiKey("");
                            setNewApiBase("");
                            setNewApiVersion("");
                        }}>
                        <AddCircleIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                </span>
            </Tooltip>
        </TableCell>
        <TableCell align="right">
            <Tooltip title={t('model.clear')}>
                <IconButton size="small" sx={{ p: 0.25 }}
                    onClick={(event) => {
                        event.stopPropagation()
                        setNewEndpoint("");
                        setNewModel("");
                        setNewApiKey("");
                        setNewApiBase("");
                        setNewApiVersion("");
                    }}>
                    <ClearIcon sx={{ fontSize: 14 }} />
                </IconButton>
            </Tooltip>
        </TableCell>

    </TableRow>

    /** Render a single model row. isGlobal controls delete button and key display. */
    const renderModelRow = (model: ModelConfig, isGlobal: boolean) => {
        const status = getStatus(model.id);

        const statusIcon =
            status === 'configured' ? <SettingsOutlinedIcon color="info" sx={{ fontSize: 16 }} /> :
            status === 'unknown'    ? <HelpOutlineIcon color="warning" sx={{ fontSize: 16 }} /> :
            status === 'testing'    ? <CircularProgress size={14} /> :
            status === 'ok'         ? <CheckCircleOutlineIcon color="success" sx={{ fontSize: 16 }} /> :
                                      <ErrorOutlineIcon color="error" sx={{ fontSize: 16 }} />;

        let message = t('model.modelReadyMessage');
        if (status === 'configured') {
            message = t('model.configuredMessage', 'Server configured, click to verify connectivity');
        } else if (status === 'unknown') {
            message = t('model.clickToTestModel');
        } else if (status === 'error') {
            const rawMessage = testedModels.find(tm => tm.id === model.id)?.message || t('model.unknownError');
            message = t('model.errorMessage', { message: decodeHtmlEntities(rawMessage) });
        }

        const selectable = status === 'ok' || status === 'configured' || (isGlobal && status !== 'error');
        const isSelected = tempSelectedModelId === model.id;

        return (
            <React.Fragment key={model.id}>
                <TableRow
                    sx={{
                        cursor: selectable ? 'pointer' : 'default',
                        // Don't dim error rows so the Retest button and error message remain clearly clickable.
                        opacity: selectable || status === 'error' ? 1 : 0.5,
                        backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
                        outline: isSelected ? `2px solid ${theme.palette.primary.main}` : 'none',
                        outlineOffset: -2,
                        '&:hover': selectable ? { backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.06) : 'rgba(0,0,0,0.02)' } : {},
                    }}
                    onClick={() => selectable && setTempSelectedModelId(
                        isSelected ? undefined : model.id
                    )}
                >
                    <TableCell align="left">
                        {model.model}
                    </TableCell>
                    <TableCell>
                        {isGlobal
                            ? <Box component="span" sx={{ color: 'text.disabled' }}>{t('model.serverManaged', 'Server managed')}</Box>
                            : model.api_key
                                ? (showKeys
                                    ? <Box component="span" sx={{ fontSize: '0.5rem', fontFamily: 'monospace', wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: 1.3 }}>{model.api_key}</Box>
                                    : <Box component="span" sx={{ color: 'text.disabled' }}>••••••••••</Box>)
                                : <Box component="span" sx={{ color: 'text.disabled' }}>{t('model.none')}</Box>
                        }
                    </TableCell>
                    <TableCell align="left">
                        {model.endpoint}
                    </TableCell>
                    <TableCell align="left">
                        {model.api_base
                            ? <Box component="span" sx={{ wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: 1.3 }}>{model.api_base}</Box>
                            : <Box component="span" sx={{ color: 'text.disabled' }}>{t('model.default')}</Box>
                        }
                    </TableCell>
                    <TableCell align="left">
                        {model.api_version
                            ? model.api_version
                            : <Box component="span" sx={{ color: 'text.disabled' }}>{t('model.default')}</Box>
                        }
                    </TableCell>
                    <TableCell align="left">
                        <Tooltip title={message}>
                            <Button
                                size="small"
                                color={status === 'ok' ? 'success' : status === 'configured' ? 'info' : status === 'error' ? 'error' : 'warning'}
                                onClick={(e) => { e.stopPropagation(); testModel(model); }}
                                sx={{ p: 0.5, minWidth: 0, textTransform: 'none', fontSize: 'inherit' }}
                                startIcon={statusIcon}
                            >
                                {status === 'ok' ? t('model.ready') :
                                 status === 'configured' ? t('model.configured', 'Configured') :
                                 status === 'error' ? t('model.retest') : t('model.test')}
                            </Button>
                        </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                        {!isGlobal && (
                            <Tooltip title={t('model.removeModel')}>
                                <IconButton
                                    size="small"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        dispatch(dfActions.removeModel(model.id));
                                        if (tempSelectedModelId === model.id) setTempSelectedModelId(undefined);
                                    }}
                                    sx={{ p: 0.25 }}
                                >
                                    <ClearIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                            </Tooltip>
                        )}
                    </TableCell>
                </TableRow>
                {status === 'error' && (
                    <TableRow>
                        <TableCell colSpan={1} />
                        <TableCell colSpan={6} sx={{ borderBottom: 'none' }}>
                            <Box component="span" sx={{ color: 'error.main' }}>
                                {message}
                            </Box>
                        </TableCell>
                    </TableRow>
                )}
            </React.Fragment>
        );
    };

    const sectionHeader = (label: string) => (
        <TableRow>
            <TableCell colSpan={7} sx={{ pt: 1, pb: 0, borderBottom: 'none' }}>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 500, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label}
                </Typography>
            </TableCell>
        </TableRow>
    );

    let modelTable = <TableContainer>
        <Table sx={{
            minWidth: 600,
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            fontSize: '0.75rem',
            '& th, & td': {
                px: 1, py: 0.75,
                textAlign: 'left',
                borderBottom: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 'inherit',
            },
            '& th': {
                fontWeight: 600,
                color: 'text.secondary',
                fontSize: '0.7rem',
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'divider',
            },
        }} size="small">
            <TableHead>
                <TableRow>
                    <TableCell sx={{ width: '15%' }}>{t('model.model')}</TableCell>
                    <TableCell sx={{ width: '18%' }}>{t('model.apiKey')}</TableCell>
                    <TableCell sx={{ width: '10%' }}>{t('model.provider')}</TableCell>
                    <TableCell sx={{ width: '25%' }}>{t('model.apiBase')}</TableCell>
                    <TableCell sx={{ width: '10%' }}>{t('model.apiVersion')}</TableCell>
                    <TableCell sx={{ width: '12%' }}>{t('model.status')}</TableCell>
                    <TableCell sx={{ width: '5%' }} />
                </TableRow>
            </TableHead>
            <TableBody>
                {/* Global / server-managed models */}
                {globalModels.length > 0 && sectionHeader(
                    t('model.serverManagedSection', 'Server configured models'),
                )}
                {globalModels.map(model => renderModelRow(model, true))}

                {/* User-added models */}
                {sectionHeader(t('model.userManagedSection', 'My models'))}
                {models.map(model => renderModelRow(model, false))}
                {newModelEntry}
            </TableBody>
        </Table>
    </TableContainer>

    const allModels = [...globalModels, ...models];

    // A model is "ready" if tested ok, or if it's a server-configured model
    // (status "configured") that the admin has set up and is trusted to work.
    const isModelReady = (id: string | undefined): boolean => {
        if (!id) return false;
        const status = getStatus(id);
        return status === 'ok' || status === 'configured';
    };

    let modelNotReady = !isModelReady(tempSelectedModelId);

    let tempModel = allModels.find(m => m.id == tempSelectedModelId);
    let tempModelName = tempModel ? `${tempModel.endpoint}/${tempModel.model}` : t('model.pleaseSelectModel');
    let selectedModelName = allModels.find(m => m.id == selectedModelId)?.model || t('model.unselected');

    const selectedReady = isModelReady(selectedModelId);

    return <>
        <Tooltip title={t('model.selectModel')}>
            <Button sx={{fontSize: "inherit", textTransform: "none"}} variant="text" color={selectedReady ? "primary" : 'warning'} onClick={()=>{setModelDialogOpen(true)}}>
                {selectedReady ? selectedModelName : t('model.selectModels')}
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
            <DialogTitle sx={{display: "flex",  alignItems: "center"}}>{t('model.selectModel')}</DialogTitle>
            <DialogContent >
            <Box sx={{
                    display: 'flex', 
                    color: 'text.secondary',
                    alignItems: 'flex-start', 
                    mb: 2,
                    p: 1.5,
                    backgroundColor: alpha(theme.palette.info.main, 0.08),
                }}>
                    <Box>
                        <Typography variant="caption" component="div" sx={{ lineHeight: 1.6 }}>
                            • {t('model.recommendedModelTip')}
                        </Typography>
                        <Typography variant="caption" component="div" sx={{ lineHeight: 1.6, mt: 0.5 }}>
                            • {t('model.litellmNote').split('.')[0]}. <a href="https://docs.litellm.ai/docs/" target="_blank" rel="noopener noreferrer">{t('model.seeDocs')}</a>.
                            {t('model.openaiProviderTip')}
                        </Typography>
                        
                    </Box>
                </Box>
                {modelTable}
                
            </DialogContent>
            <DialogActions>
                {!serverConfig.DISABLE_DISPLAY_KEYS && (
                    <FormControlLabel
                        sx={{ marginRight: 'auto', ml: 1 }}
                        control={
                            <Switch
                                size="small"
                                checked={showKeys}
                                onChange={() => setShowKeys(!showKeys)}
                            />
                        }
                        label={
                            <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                {showKeys ? t('model.hideKeys') : t('model.showKeys')}
                            </Typography>
                        }
                    />
                )}
                <Button disabled={modelNotReady} sx={{textTransform: 'none'}}
                    variant={modelNotReady ? 'text' : 'contained'}
                    onClick={()=>{
                        dispatch(dfActions.selectModel(tempSelectedModelId));
                        setModelDialogOpen(false);}}>{t('model.useModel', { modelName: tempModelName })}</Button>
                <Button onClick={()=>{
                    setTempSelectedModelId(selectedModelId);
                    setModelDialogOpen(false);
                }}>{t('model.cancel')}</Button>
            </DialogActions>
        </Dialog>
    </>;
}
