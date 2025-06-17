// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux";
import { 
    DataFormulatorState,
    dfActions,
    ModelConfig,
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
} from '@mui/material';


import { styled } from '@mui/material/styles';

import SettingsIcon from '@mui/icons-material/Settings';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import ClearIcon from '@mui/icons-material/Clear';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import { getUrls } from '../app/utils';

// Add interface for app configuration
interface AppConfig {
    DISABLE_DISPLAY_KEYS: boolean;
}

const decodeHtmlEntities = (text: string): string => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
};

export const ModelSelectionButton: React.FC<{}> = ({ }) => {

    const dispatch = useDispatch();
    const models = useSelector((state: DataFormulatorState) => state.models);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const testedModels = useSelector((state: DataFormulatorState) => state.testedModels);

    const [modelDialogOpen, setModelDialogOpen] = useState<boolean>(false);
    const [showKeys, setShowKeys] = useState<boolean>(false);
    const [tempSelectedModelId, setTempSelectedModelId] = useState<string | undefined >(selectedModelId);
    const [providerModelOptions, setProviderModelOptions] = useState<{[key: string]: string[]}>({
        'openai': [],
        'azure': [],
        'anthropic': [],
        'gemini': [],
        'ollama': []
    });
    const [isLoadingModelOptions, setIsLoadingModelOptions] = useState<boolean>(false);
    const [appConfig, setAppConfig] = useState<AppConfig>({ DISABLE_DISPLAY_KEYS: false });

    // Fetch app configuration
    useEffect(() => {
        fetch(getUrls().APP_CONFIG)
            .then(response => response.json())
            .then(data => {
                setAppConfig(data);
            })
            .catch(error => {
                console.error("Failed to fetch app configuration:", error);
            });
    }, []);

    useEffect(() => {
        const findWorkingModel = async () => {
            for (let i = 0; i < models.length; i++) {
                if (testedModels.find(t => t.id == models[i].id)) {
                    continue;
                }
                const model = models[i];
                const message = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({
                        model: model,
                    }),
                };
                try {
                    const response = await fetch(getUrls().TEST_MODEL, {...message });
                    const data = await response.json();
                    const status = data["status"] || 'error';
                    updateModelStatus(model, status, data["message"] || "");
                    if (status === 'ok') {
                        break;
                    }
                } catch (error) {
                    updateModelStatus(model, 'error', (error as Error).message || 'Failed to test model');
                }
            }
        };

        if (models.length > 0 && testedModels.filter(t => t.status == 'ok').length == 0) {
            findWorkingModel();
        }
    }, []);

    let updateModelStatus = (model: ModelConfig, status: 'ok' | 'error' | 'testing' | 'unknown', message: string) => {
        dispatch(dfActions.updateModelStatus({id: model.id, status, message}));
    }
    let getStatus = (id: string | undefined) => {
        return id != undefined ? (testedModels.find(t => (t.id == id))?.status || 'unknown') : 'unknown';
    }

    const [newEndpoint, setNewEndpoint] = useState<string>(""); // openai, azure, ollama etc
    const [newModel, setNewModel] = useState<string>("");
    const [newApiKey, setNewApiKey] = useState<string>("");
    const [newApiBase, setNewApiBase] = useState<string>("");
    const [newApiVersion, setNewApiVersion] = useState<string>("");

    // Fetch available models from the API
    useEffect(() => {
        const fetchModelOptions = async () => {
            setIsLoadingModelOptions(true);
            try {
                const response = await fetch(getUrls().CHECK_AVAILABLE_MODELS);
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
            setIsLoadingModelOptions(false);
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
        fetch(getUrls().TEST_MODEL, {...message })
            .then((response) => response.json())
            .then((data) => {
                let status = data["status"] || 'error';
                updateModelStatus(model, status, data["message"] || "");
            }).catch((error) => {
                updateModelStatus(model, 'error', error.message)
            });
    }

    let readyToTest = newModel && (newApiKey || newApiBase);

    let newModelEntry = <TableRow
        key={`new-model-entry`}
        sx={{ '&:last-child td, &:last-child th': { border: 0 }, padding: "6px 6px" }}
        onClick={(event) => {
            event.stopPropagation();
            setTempSelectedModelId(undefined);
        }}
    >
        <TableCell align="right">
            <Radio size="small" checked={tempSelectedModelId == undefined} name="radio-buttons" slotProps={{input: {'aria-label': 'Select this model'}}}/>
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
                    <Typography {...props} onClick={() => setNewEndpoint(option)} sx={{fontSize: "0.875rem"}}>
                        {option}
                    </Typography>
                )}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        placeholder="provider"
                        slotProps={{
                            input: {
                                ...params.InputProps,
                                style: { fontSize: "0.875rem" }
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
                                examples
                            </Typography>
                            {props.children}
                        </Paper>
                    }
                }}
            />
        </TableCell>
        <TableCell align="left" >
            <TextField fullWidth size="small" type={showKeys ? "text" : "password"} 
                slotProps={{
                    input: {
                        style: { fontSize: "0.875rem" }
                    }
                }}
                placeholder='leave blank if using keyless access'
                value={newApiKey}  
                onChange={(event: any) => { setNewApiKey(event.target.value); }} 
                autoComplete='off'
            />
        </TableCell>
        <TableCell align="left">
            <Autocomplete
                freeSolo
                onChange={(event: any, newValue: string | null) => { setNewModel(newValue || ""); }}
                value={newModel}
                options={newEndpoint && providerModelOptions[newEndpoint] ? providerModelOptions[newEndpoint] : []}
                loading={isLoadingModelOptions}
                loadingText={<Typography sx={{fontSize: "0.875rem"}}>loading...</Typography>}
                renderOption={(props, option) => {
                    return <Typography {...props} onClick={()=>{ setNewModel(option); }} sx={{fontSize: "small"}}>{option}</Typography>
                }}
                renderInput={(params) => (
                    <TextField
                        error={newEndpoint != "" && !newModel}
                        {...params}
                        placeholder="model name"
                        slotProps={{
                            input: {
                                ...params.InputProps,
                                style: { fontSize: "0.875rem" },
                                endAdornment: (
                                    <>
                                        {isLoadingModelOptions ? <CircularProgress color="primary" size={20} /> : null}
                                        {params.InputProps.endAdornment}
                                    </>
                                ),
                            },
                            htmlInput: {
                                ...params.inputProps,
                                'aria-label': 'Select or enter a model',
                            }
                        }}
                        size="small"
                        onChange={(event: any) => { setNewModel(event.target.value); }}
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
                            <Typography sx={{ p: 1, color: 'gray', fontStyle: 'italic', fontSize: 'small' }}>
                                examples
                            </Typography>
                            {props.children}    
                        </Paper>
                    }
                }}
            />
        </TableCell>
        <TableCell align="right">
            <TextField size="small" type="text" fullWidth
                placeholder="api_base"
                slotProps={{
                    input: {
                        style: { fontSize: "0.875rem" }
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
                        style: { fontSize: "0.875rem" }
                    }
                }}
                value={newApiVersion}  onChange={(event: any) => { setNewApiVersion(event.target.value); }} 
                autoComplete='off'
                placeholder="api_version"
            />
        </TableCell>
        <TableCell align="right">
            <Tooltip title={modelExists ? "provider + model already exists" : "add and test model"}>
                <IconButton color={modelExists ? 'error' : 'primary'}
                    disabled={!readyToTest}
                    sx={{cursor: modelExists ? 'help' : 'pointer'}}
                    onClick={(event) => {
                        event.stopPropagation()

                        let endpoint = newEndpoint;

                        let id = `${endpoint}-${newModel}-${newApiKey}-${newApiBase}-${newApiVersion}`;

                        let model = {endpoint, model: newModel, api_key: newApiKey, api_base: newApiBase, api_version: newApiVersion, id: id};

                        dispatch(dfActions.addModel(model));
                        dispatch(dfActions.selectModel(id));
                        setTempSelectedModelId(id);

                        testModel(model); 
                        
                        setNewEndpoint("");
                        setNewModel("");
                        setNewApiKey("");
                        setNewApiBase("");
                        setNewApiVersion("");
                    }}>
                    <AddCircleIcon />
                </IconButton>
            </Tooltip>
        </TableCell>
        <TableCell align="right">
            <Tooltip title={"clear"}>
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
        <Table sx={{ minWidth: 600, "& .MuiTableCell-root": { padding: "6px 6px" } }} size="small" >
            <TableHead >
                <TableRow>
                    <TableCell align="right"></TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '120px'}}>provider</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '240px'}}>api_key</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '160px'}} align="left">model</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '240px'}} align="left">api_base</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '120px'}} align="left">api_version</TableCell>
                    <TableCell sx={{fontWeight: 'bold'}} align="right">Status</TableCell>
                    <TableCell sx={{fontWeight: 'bold'}} align="right">Action</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {models.map((model) => {
                    let isItemSelected = tempSelectedModelId != undefined && tempSelectedModelId == model.id;
                    let status =  getStatus(model.id);  
                    
                    let statusIcon = status  == "unknown" ? <HelpOutlineIcon color="warning" /> : ( status == 'testing' ? <CircularProgress size={24} />:
                            (status == "ok" ? <CheckCircleOutlineIcon color="success"/> : <ErrorOutlineIcon color="error"/> ))
                    
                    let message = "the model is ready to use";
                    if (status == "unknown") {
                        message = "click the status icon to test the model availability.";
                    } else if (status == "error") {
                        const rawMessage = testedModels.find(t => t.id == model.id)?.message || "Unknown error";
                        message = decodeHtmlEntities(rawMessage);
                    }

                    const borderStyle = ['error', 'unknown'].includes(status) ? '1px dashed lightgray' : undefined;
                    const noBorderStyle = ['error', 'unknown'].includes(status) ? 'none' : undefined;

                    return (
                        <React.Fragment key={`${model.id}`}>
                        <TableRow
                            selected={isItemSelected}
                            key={`${model.id}`}
                            onClick={() => { setTempSelectedModelId(model.id) }}
                            sx={{ cursor: 'pointer', '& .MuiTableCell-root': { p: 0.5, fontSize: 14 }}}
                        >
                            <TableCell align="right" sx={{ borderBottom: noBorderStyle,}}>
                                <Radio size="small" checked={isItemSelected} name="radio-buttons" slotProps={{input: {'aria-label': 'Select this model'}}} />
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: noBorderStyle, p: 0 }}>
                                {model.endpoint}
                            </TableCell>
                            <TableCell component="th" scope="row" sx={{ borderBottom: borderStyle }}>
                                {model.api_key  ? (showKeys ? 
                                    <Typography
                                        sx={{
                                            maxWidth: '240px',
                                            wordBreak: 'break-all',
                                            whiteSpace: 'normal'
                                        }} 
                                        fontSize={10}
                                    >
                                        {model.api_key}
                                    </Typography> 
                                    : "************")
                                     : <Typography sx={{color: "text.secondary"}} fontSize='inherit'>N/A</Typography>
                                }
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: borderStyle }}>
                                {model.model}
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: borderStyle }}>
                                {model.api_base}
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: borderStyle }}>
                                {model.api_version} 
                            </TableCell>
                            <TableCell sx={{fontWeight: 'bold', borderBottom: borderStyle}} align="right">
                                <Tooltip title={
                                    status == 'ok' ? message :  'test model availability'}>
                                    <IconButton
                                        size="small"
                                        onClick ={() => { testModel(model)  }}
                                    >
                                        {statusIcon}
                                    </IconButton>
                                </Tooltip>
                            </TableCell>
                            <TableCell sx={{ borderBottom: borderStyle }} align="right">
                                <Tooltip title="remove model">
                                    <IconButton 
                                        size="small"
                                        onClick={()=>{
                                            dispatch(dfActions.removeModel(model.id));
                                            if ((tempSelectedModelId) 
                                                    && tempSelectedModelId == model.id) {
                                                if (models.length == 0) {
                                                    setTempSelectedModelId(undefined);
                                                } else {
                                                    let chosenModel = models[models.length - 1];
                                                    setTempSelectedModelId(chosenModel.id)
                                                }
                                            }
                                        }}>
                                        <ClearIcon/>
                                    </IconButton>
                                </Tooltip>
                            </TableCell>
                        </TableRow>
                        {['error', 'unknown'].includes(status) && (
                            <TableRow 
                                selected={isItemSelected}
                                onClick={() => { setTempSelectedModelId(model.id) }}
                                sx={{ 
                                    cursor: 'pointer',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                    },
                                }}
                            >
                                <TableCell colSpan={2} align="right" ></TableCell>
                                <TableCell colSpan={6}>
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
                <TableRow>
                    <TableCell colSpan={8} align="left" sx={{ '& .MuiTypography-root': { fontSize: "0.625rem" } }}>
                        <Typography>
                            Model configuration based on LiteLLM,  <a href="https://docs.litellm.ai/docs/" target="_blank" rel="noopener noreferrer">check out supported endpoint / models here</a>. 
                            If using custom providers that are compatible with the OpenAI API, choose 'openai' as the provider.
                        </Typography>
                        <Typography>
                            Models with limited code generation capabilities (e.g., llama3.2) may fail frequently to derive new data.
                        </Typography>
                    </TableCell>
                </TableRow>
                </TableBody>
            </Table>
    </TableContainer>

    return <>
        <Tooltip title="select model">
            <Button sx={{fontSize: "inherit", textTransform: "none"}} variant="text" color="primary" onClick={()=>{setModelDialogOpen(true)}}>
                {selectedModelId ? `Model: ${(models.find(m => m.id == selectedModelId) as any)?.model}` : 'Select A Model'}
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
            <DialogTitle sx={{display: "flex",  alignItems: "center"}}>Select Model</DialogTitle>
            <DialogContent >
                {modelTable}
            </DialogContent>
            <DialogActions>
                {!appConfig.DISABLE_DISPLAY_KEYS && (
                    <Button sx={{marginRight: 'auto'}} endIcon={showKeys ? <VisibilityOffIcon /> : <VisibilityIcon />} onClick={()=>{
                        setShowKeys(!showKeys);}}>
                            {showKeys ? 'hide' : 'show'} keys
                    </Button>
                )}
                <Button disabled={getStatus(tempSelectedModelId) !== 'ok'} 
                    variant={(selectedModelId == tempSelectedModelId) ? 'text' : 'contained'}
                    onClick={()=>{
                        dispatch(dfActions.selectModel(tempSelectedModelId));
                        setModelDialogOpen(false);}}>apply model</Button>
                <Button onClick={()=>{
                    setTempSelectedModelId(selectedModelId);
                    setModelDialogOpen(false);
                }}>cancel</Button>
            </DialogActions>
        </Dialog>
    </>;
}
