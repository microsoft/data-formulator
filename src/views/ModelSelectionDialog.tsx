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

import { getUrls, fetchWithIdentity } from '../app/utils';
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

    // Fetch available models from the API
    useEffect(() => {
        const fetchModelOptions = async () => {
            try {
                const response = await fetchWithIdentity(getUrls().CHECK_AVAILABLE_MODELS);
                const data = await response.json();
                
                // Group models by provider
                const modelsByProvider: {[key: string]: string[]} = {
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
        fetchWithIdentity(getUrls().TEST_MODEL, {...message })
            .then((response) => response.json())
            .then((data) => {
                let status = data["status"] || 'error';
                updateModelStatus(model, status, data["message"] || "");
                // Auto-select the first good model if none is currently selected
                if (status === 'ok' && !tempSelectedModelId) {
                    setTempSelectedModelId(model.id);
                }
            }).catch((error) => {
                updateModelStatus(model, 'error', error.message)
            });
    }

    let readyToTest = newModel && (newApiKey || newApiBase);

    let newModelEntry = <TableRow
        key={`new-model-entry`}
        sx={{ '&:last-child td, &:last-child th': { border: 0 }, 
        padding: "6px 6px"}}
    >
        <TableCell align="left" sx={{ width: '120px' }}>
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
                    <Typography {...props} onClick={() => setNewEndpoint(option)} sx={{fontSize: "0.875rem"}}>
                        {option}
                    </Typography>
                )}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        placeholder={t('model.providerPlaceholder')}
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
                                {t('model.example')}
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
                placeholder={t('model.optionalKeylessEndpoint')}
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
                placeholder={t('model.modelPlaceholder')}
                error={newEndpoint != "" && !newModel}
                slotProps={{
                    input: {
                        style: { fontSize: "0.75rem" },
                        'aria-label': t('model.enterModelName'),
                    }
                }}
            />
        </TableCell>
        <TableCell align="right">
            <TextField size="small" type="text" fullWidth
                placeholder={t('model.optional')}
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
                value={newApiVersion}  onChange={(event: any) => { setNewApiVersion(event.target.value); }} 
                autoComplete='off'
                placeholder={t('model.optional')}
            />
        </TableCell>
        <TableCell align="right">
            <Tooltip title={modelExists ? t('model.providerModelExists') : t('model.addAndTestModel')}>
                <span>  
                    <IconButton color={modelExists ? 'error' : 'primary'}
                        disabled={!readyToTest}
                        sx={{cursor: modelExists ? 'help' : 'pointer'}}
                        onClick={(event) => {
                            event.stopPropagation()

                            let endpoint = newEndpoint;

                            // Hash the ID to prevent API key exposure
                            const idString = `${endpoint}-${newModel}-${newApiKey}-${newApiBase}-${newApiVersion}`;
                            let id = simpleHash(idString);

                            let model = {endpoint, model: newModel, api_key: newApiKey, api_base: newApiBase, api_version: newApiVersion, id: id};

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
                                fetch(getUrls().TEST_MODEL, {...message })
                                    .then((response) => response.json())
                                    .then((data) => {
                                        let status = data["status"] || 'error';
                                        updateModelStatus(model, status, data["message"] || "");
                                        // Only assign to slot if test is successful
                                        if (status === 'ok') {
                                            setTempSelectedModelId(id);
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
            <Tooltip title={t('model.clear')}>
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
            <TableHead>
                <TableRow>
                    <TableCell sx={{fontWeight: 'bold', width: '120px'}}>{t('model.provider')}</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '160px'}}>{t('model.apiKey')}</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '160px'}} align="left">{t('model.model')}</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '200px'}} align="left">{t('model.apiBase')}</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '120px'}} align="left">{t('model.apiVersion')}</TableCell>
                    <TableCell sx={{fontWeight: 'bold'}} align="left">{t('model.status')}</TableCell>
                    <TableCell sx={{fontWeight: 'bold'}} align="right"></TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {models.map((model) => {
                    let status =  getStatus(model.id);  
                    
                    let statusIcon = status  == "unknown" ? <HelpOutlineIcon color="warning" fontSize="small" /> : ( status == 'testing' ? <CircularProgress size={20} />:
                            (status == "ok" ? <CheckCircleOutlineIcon color="success" fontSize="small"/> : <ErrorOutlineIcon color="error" fontSize="small"/> ))
                    
                    let message = t('model.modelReadyMessage');
                    if (status == "unknown") {
                        message = t('model.clickToTestModel');
                    } else if (status == "error") {
                        const rawMessage = testedModels.find(tm => tm.id == model.id)?.message || t('model.unknownError');
                        message = t('model.errorMessage', { message: decodeHtmlEntities(rawMessage) });
                    }

                    const borderStyle = ['error'].includes(status) ? '1px dashed lightgray' : undefined;
                    const noBorderStyle = ['error'].includes(status) ? 'none' : undefined;
                    const disabledStyle = status != 'ok' ? { cursor: 'default', opacity: 0.5 } : undefined;
                    
                    return (
                        <React.Fragment key={`${model.id}`}>
                        <TableRow
                            key={`${model.id}`}
                            sx={{ 
                                '& .MuiTableCell-root': { fontSize: '0.75rem' },
                                '&:hover': { backgroundColor: '#f8f9fa' },
                                border: tempSelectedModelId == model.id ? `2px solid ${theme.palette.primary.main}` : 'none',
                                cursor: status == 'ok' ? 'pointer' : 'default',
                            }}
                            onClick={() => status == 'ok' && setTempSelectedModelId(tempSelectedModelId == model.id ? undefined : model.id)}
                        >
                            <TableCell align="left" sx={{ borderBottom: noBorderStyle, ...disabledStyle }}>
                                <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 'inherit' }}>
                                    {model.endpoint}
                                </Typography>
                            </TableCell>
                            <TableCell component="th" scope="row" sx={{ borderBottom: borderStyle, ...disabledStyle }}>
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
                                     : <Typography sx={{color: "text.secondary", fontSize: 'inherit', fontStyle: 'italic'}}>{t('model.none')}</Typography>
                                }
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: borderStyle, ...disabledStyle }}>
                                <Typography variant="body2" sx={{ fontSize: 'inherit', fontWeight: 500 }}>
                                    {model.model}
                                </Typography>
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: borderStyle, ...disabledStyle }}>
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
                                        {t('model.default')}
                                    </Typography>
                                )}
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: borderStyle, ...disabledStyle }}>
                                {model.api_version ? (
                                    <Typography variant="body2" sx={{ fontSize: 'inherit' }}>
                                        {model.api_version}
                                    </Typography>
                                ) : (
                                    <Typography sx={{ color: "text.secondary", fontSize: 'inherit', fontStyle: 'italic' }}>
                                        {t('model.default')}
                                    </Typography>
                                )}
                            </TableCell>
                            <TableCell sx={{borderBottom: borderStyle}} align="left">
                                <Tooltip title={message}>
                                    <Button
                                        size="small"
                                        color={status == 'ok' ?  'success' : status == 'error' ? 'error' : 'warning'}
                                        onClick ={() => { testModel(model)  }}
                                        sx={{ p: 0.75, fontSize: "0.75rem", textTransform: "none" }}
                                        startIcon={statusIcon}
                                    >
                                        {status == 'ok' ? t('model.ready') : status == 'error' ? t('model.retest') : t('model.test')}
                                    </Button>
                                </Tooltip>
                            </TableCell>
                            <TableCell sx={{ borderBottom: borderStyle }} align="right">
                                <Tooltip title={t('model.removeModel')}>
                                    <IconButton 
                                        size="small"
                                        onClick={()=>{
                                            dispatch(dfActions.removeModel(model.id));
                                            // Remove from all slots if assigned
                                            if (tempSelectedModelId == model.id) {
                                                setTempSelectedModelId(undefined);
                                            }
                                        }}
                                        sx={{ p: 0.75 }}
                                    >
                                        <ClearIcon fontSize="small"/>
                                    </IconButton>
                                </Tooltip>
                            </TableCell>
                        </TableRow>
                        {['error'].includes(status) && (
                            <TableRow>
                                <TableCell colSpan={1} align="right" ></TableCell>
                                <TableCell colSpan={7}>
                                    <Typography variant="caption" color="#c82c2c" sx={{fontSize: "0.625rem"}}>
                                        {message} 
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        </React.Fragment>
                    )
                })}
                {newModelEntry}
                </TableBody>
            </Table>
    </TableContainer>

    let modelNotReady = tempSelectedModelId == undefined || getStatus(tempSelectedModelId) !== 'ok';

    let tempModel = models.find(m => m.id == tempSelectedModelId);
    let tempModelName = tempModel ? `${tempModel.endpoint}/${tempModel.model}` : t('model.pleaseSelectModel');
    let selectedModelName = models.find(m => m.id == selectedModelId)?.model || t('model.unselected');

    return <>
        <Tooltip title={t('model.selectModel')}>
            <Button sx={{fontSize: "inherit", textTransform: "none"}} variant="text" color={modelNotReady ? 'warning' : "primary"} onClick={()=>{setModelDialogOpen(true)}}>
                {modelNotReady ? t('model.selectModels') : selectedModelName}
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
                    <Button sx={{marginRight: 'auto'}} endIcon={showKeys ? <VisibilityOffIcon /> : <VisibilityIcon />} onClick={()=>{
                        setShowKeys(!showKeys);}}>
                            {showKeys ? t('model.hideKeys') : t('model.showKeys')}
                    </Button>
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
