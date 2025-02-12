// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
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

export const GroupHeader = styled('div')(({ theme }) => ({
    position: 'sticky',
    padding: '8px 8px',
    marginLeft: '-8px',
    color: "rgba(0, 0, 0, 0.6)",
    fontSize: "12px",
}));

export const GroupItems = styled('ul')({
    padding: 0,
});

export const ModelSelectionButton: React.FC<{}> = ({ }) => {

    const dispatch = useDispatch();
    const models = useSelector((state: DataFormulatorState) => state.models);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const testedModels = useSelector((state: DataFormulatorState) => state.testedModels);

    const [modelDialogOpen, setModelDialogOpen] = useState<boolean>(false);
    const [showKeys, setShowKeys] = useState<boolean>(false);
    const [tempSelectedModelId, setTempSelectedModeId] = useState<string | undefined >(selectedModelId);

    console.log("--------------------------------");
    console.log("models", models);
    console.log("selectedModelId", selectedModelId);
    console.log("tempSelectedModelId", tempSelectedModelId);
    console.log("testedModels", testedModels);

    let updateModelStatus = (model: ModelConfig, status: 'ok' | 'error' | 'testing' | 'unknown', message: string) => {
        dispatch(dfActions.updateModelStatus({id: model.id, status, message}));
    }
    let getStatus = (id: string) => {
        return testedModels.find(t => (t.id == id))?.status || 'unknown';
    }

    const [newEndpoint, setNewEndpoint] = useState<string>(""); // openai, azure_openai, ollama etc
    const [newModel, setNewModel] = useState<string>("");
    const [newApiKey, setNewApiKey] = useState<string | undefined>(undefined);
    const [newApiBase, setNewApiBase] = useState<string | undefined>(undefined);
    const [newApiVersion, setNewApiVersion] = useState<string | undefined>(undefined);

    let disableApiKey = newEndpoint == "default" || newEndpoint == "" || newEndpoint == "ollama";
    let disableModel = newEndpoint == "default" || newEndpoint == "";
    let disableApiBase = newEndpoint != "azure_openai";
    let disableApiVersion = newEndpoint != "azure_openai";

    let modelExists = models.some(m => m.endpoint == newEndpoint && m.model == newModel && m.api_base == newApiBase && m.api_key == newApiKey && m.api_version == newApiVersion);

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

    let readyToTest = false;
    if (newEndpoint != "default") {
        readyToTest = true;
    }
    if (newEndpoint == "openai") {
        readyToTest = newModel != "";
    }
    if (newEndpoint == "azure_openai") {
        readyToTest = newModel != "" && newApiBase != "";
    }
    if (newEndpoint == "ollama") {
        readyToTest = newModel != "";
    }

    let newModelEntry = <TableRow
        key={`new-model-entry`}
        sx={{ '&:last-child td, &:last-child th': { border: 0 }, padding: "6px 6px" }}
        onClick={() => {setTempSelectedModeId(undefined)}}
    >
        <TableCell align="right">
            <Radio checked={tempSelectedModelId == undefined} name="radio-buttons" inputProps={{'aria-label': 'Select this model'}}/>
        </TableCell>
        <TableCell align="left">
            <Autocomplete
                freeSolo
                value={newEndpoint}
                onChange={(event: any, newValue: string | null) => {
                    setNewEndpoint(newValue || "");
                    if (newModel == "" && newValue == "openai") {
                        setNewModel("gpt-4o");
                    }
                    if (!newApiVersion && newValue == "azure_openai") {
                        setNewApiVersion("2024-02-15");
                    }
                }}
                options={['openai', 'azure_openai', 'ollama', 'gemini', 'anthropic']}
                renderOption={(props, option) => (
                    <Typography {...props} onClick={() => setNewEndpoint(option)} sx={{fontSize: "0.875rem"}}>
                        {option}
                    </Typography>
                )}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        placeholder="endpoint"
                        InputProps={{
                            ...params.InputProps,
                            style: { fontSize: "0.875rem" }
                        }}
                        size="small"
                        onChange={(event: any) => setNewEndpoint(event.target.value)}
                    />
                )}
                ListboxProps={{
                    style: { padding: 0 }
                }}
                PaperComponent={({ children }) => (
                    <Paper>
                        <Typography sx={{ p: 1, color: 'gray', fontStyle: 'italic', fontSize: '0.75rem' }}>
                            suggestions
                        </Typography>
                        {children}
                    </Paper>
                )}
            />
        </TableCell>
        <TableCell align="left" >
            <TextField fullWidth size="small" type={showKeys ? "text" : "password"} 
                InputProps={{ style: { fontSize: "0.875rem" } }} 
                placeholder='leave blank if using keyless access'
                value={newApiKey}  onChange={(event: any) => { setNewApiKey(event.target.value); }} 
                autoComplete='off'
                disabled={disableApiKey}
            />
        </TableCell>
        <TableCell align="left">
            <Autocomplete
                freeSolo
                disabled={disableModel}
                onChange={(event: any, newValue: string | null) => { setNewModel(newValue || ""); }}
                value={newModel}
                options={['gpt-35-turbo', 'gpt-4', 'gpt-4o', 'llama3.2']}
                renderOption={(props, option) => {
                    return <Typography {...props} onClick={()=>{ setNewModel(option); }} sx={{fontSize: "small"}}>{option}</Typography>
                }}
                renderInput={(params) => (
                    <TextField
                        error={modelExists}
                        {...params}
                        placeholder="model name"
                        InputProps={{ ...params.InputProps, style: { fontSize: "0.875rem" } }}
                        inputProps={{
                            ...params.inputProps,
                            'aria-label': 'Select or enter a model',
                        }}
                        size="small"
                        onChange={(event: any) => { setNewModel(event.target.value); }}
                    />
                )}
                ListboxProps={{
                    style: { padding: 0 }
                }}
                PaperComponent={({ children }) => (
                    <Paper>
                        <Typography sx={{ p: 1, color: 'gray', fontStyle: 'italic', fontSize: 'small' }}>
                            suggestions
                        </Typography>
                        {children}
                    </Paper>
                )}
            />
        </TableCell>
        <TableCell align="right">
            <TextField size="small" type="text" fullWidth
                placeholder="api_base"
                InputProps={{ style: { fontSize: "0.875rem" } }}
                value={newApiBase}  onChange={(event: any) => { setNewApiBase(event.target.value); }} 
                autoComplete='off'
                disabled={disableApiBase}
                required={newEndpoint == "azure_openai"}
            />
        </TableCell>
        <TableCell align="right">
            <TextField size="small" type="text" fullWidth
                InputProps={{ style: { fontSize: "0.875rem" } }}
                value={newApiVersion}  onChange={(event: any) => { setNewApiVersion(event.target.value); }} 
                autoComplete='off'
                disabled={disableApiVersion}
                placeholder="api_version"
            />
        </TableCell>
        <TableCell align="right">
            <Tooltip title={modelExists ? "endpoint + model already exists" : "add and test model"}>
                <IconButton color={modelExists ? 'error' : 'primary'}
                    disabled={!readyToTest}
                    sx={{cursor: modelExists ? 'help' : 'pointer'}}
                    onClick={(event) => {
                        if (modelExists) {
                            return
                        }
                        let endpoint = newEndpoint;
                        event.stopPropagation()

                        let id = `${endpoint}-${newModel}-${newApiKey}-${newApiBase}-${newApiVersion}`;

                        let model = {endpoint, model: newModel, api_key: newApiKey, api_base: newApiBase, api_version: newApiVersion, id: id};

                        dispatch(dfActions.addModel(model));
                        dispatch(dfActions.selectModel(id));
                        setTempSelectedModeId(id);

                        testModel(model); 
                        
                        setNewEndpoint("");
                        setNewModel("");

                        setNewApiKey(undefined);
                        setNewApiBase(undefined);
                        setNewApiVersion(undefined);
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
                        setNewApiKey(undefined);
                        setNewApiBase(undefined);
                        setNewApiVersion(undefined);
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
                    <TableCell sx={{fontWeight: 'bold', width: '120px'}}>endpoint</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '240px'}}>api_key</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '120px'}} align="left">model</TableCell>
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
                        message = "Status unknown, click the status icon to test again.";
                    } else if (status == "error") {
                        message = testedModels.find(t => t.id == model.id)?.message || "Unknown error";
                    }

                    const borderStyle = ['error', 'unknown'].includes(status) ? '1px dashed text.secondary' : undefined;
                    const noBorderStyle = ['error', 'unknown'].includes(status) ? 'none' : undefined;

                    return (
                        <>
                        <TableRow
                            selected={isItemSelected}
                            key={`${model.id}`}
                            onClick={() => { setTempSelectedModeId(model.id) }}
                            sx={{ cursor: 'pointer'}}
                        >
                            <TableCell align="right" sx={{ borderBottom: noBorderStyle }}>
                                <Radio checked={isItemSelected} name="radio-buttons" inputProps={{'aria-label': 'Select this model'}} />
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: noBorderStyle }}>
                                {model.endpoint}
                            </TableCell>
                            <TableCell component="th" scope="row" sx={{ borderBottom: borderStyle }}>
                                {model.api_key != "" ? 
                                    (showKeys ? (model.api_key || <Typography sx={{color: "text.secondary"}} fontSize='inherit'>N/A</Typography>) : "************") :
                                    <Typography sx={{color: "text.secondary"}} fontSize='inherit'>N/A</Typography> 
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
                                <Tooltip title={message}>
                                    <IconButton
                                        onClick ={() => { testModel(model)  }}
                                    >
                                        {statusIcon}
                                    </IconButton>
                                </Tooltip>
                            </TableCell>
                            <TableCell sx={{ borderBottom: borderStyle }} align="right">
                                <Tooltip title="remove model">
                                    <IconButton 
                                        onClick={()=>{
                                            dispatch(dfActions.removeModel(model.id));
                                            if ((tempSelectedModelId) 
                                                    && tempSelectedModelId == model.id) {
                                                if (models.length == 0) {
                                                    setTempSelectedModeId(undefined);
                                                } else {
                                                    let chosenModel = models[models.length - 1];
                                                    setTempSelectedModeId(chosenModel.id)
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
                                onClick={() => { setTempSelectedModeId(model.id) }}
                                sx={{ 
                                    cursor: 'pointer',
                                    '&:hover': {
                                        backgroundColor: 'rgba(0, 0, 0, 0.04)',
                                    },
                                }}
                            >
                                <TableCell colSpan={2} align="right" ></TableCell>
                                <TableCell colSpan={5}>
                                    <Typography variant="caption" color="#c82c2c">
                                        {message}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        </>
                    )
                })}
                {newModelEntry}
                <TableRow>
                    <TableCell colSpan={8} align="left" sx={{fontSize: "0.625rem"}}>
                        model configuration based on LiteLLM, check out supported endpoint / model configurations <a href="https://docs.litellm.ai/docs/" target="_blank" rel="noopener noreferrer">here.</a>
                    </TableCell>
                </TableRow>
            </TableBody>
        </Table>
    </TableContainer>

    return <>
        <Tooltip title="select model">
            <Button sx={{fontSize: "inherit"}} variant="text" color="primary" onClick={()=>{setModelDialogOpen(true)}} endIcon={selectedModelId ? <SettingsIcon /> : ''}>
                {selectedModelId ? `Model: ${(models.find(m => m.id == selectedModelId) as any)?.model}` : 'Select A Model'}
            </Button>
        </Tooltip>
        <Dialog maxWidth="lg" onClose={()=>{setModelDialogOpen(false)}} open={modelDialogOpen}>
            <DialogTitle sx={{display: "flex",  alignItems: "center"}}>Select Model</DialogTitle>
            <DialogContent >
                {modelTable}
            </DialogContent>
            <DialogActions>
                <Button sx={{marginRight: 'auto'}} endIcon={showKeys ? <VisibilityOffIcon /> : <VisibilityIcon />} onClick={()=>{
                    setShowKeys(!showKeys);}}>
                        {showKeys ? 'hide' : 'show'} keys
                </Button>
                <Button disabled={!(tempSelectedModelId != undefined && getStatus(tempSelectedModelId) == 'ok')} 
                    variant={(selectedModelId == tempSelectedModelId) ? 'text' : 'contained'}
                    onClick={()=>{
                        dispatch(dfActions.selectModel(tempSelectedModelId));
                        setModelDialogOpen(false);}}>apply model</Button>
                <Button onClick={()=>{
                    setTempSelectedModeId(selectedModelId);
                    setModelDialogOpen(false);
                }}>cancel</Button>
            </DialogActions>
        </Dialog>
    </>;
}
