
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState } from 'react';
import '../scss/App.scss';

import { useDispatch, useSelector } from "react-redux";
import { 
    DataFormulatorState,
    dfActions,
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
    padding: '8px 16px',
    marginLeft: '-8px',
    color: "rgba(0, 0, 0, 0.6)",
    fontSize: "12px",
}));

export const GroupItems = styled('ul')({
    padding: 0,
});

export const ModelSelectionButton: React.FC<{}> = ({ }) => {

    const dispatch = useDispatch();
    const oaiModels = useSelector((state: DataFormulatorState) => state.oaiModels);
    const selectedModel = useSelector((state: DataFormulatorState) => state.selectedModel);
    const testedModels = useSelector((state: DataFormulatorState) => state.testedModels);

    const [modelDialogOpen, setModelDialogOpen] = useState<boolean>(false);
    const [showKeys, setShowKeys] = useState<boolean>(false);
    const [tempSelectedModel, setTempSelectedMode] = useState<{model: string, endpoint: string} | undefined >(selectedModel);

    let updateModelStatus = (model: string, endpoint: string, status: 'ok' | 'error' | 'testing' | 'unknown', message: string) => {
        dispatch(dfActions.updateModelStatus({endpoint, model, status, message}));
    }
    let getStatus = (model: string, endpoint: string) => {
        return testedModels.find(t => t.model == model && t.endpoint == endpoint)?.status || 'unknown';
    }

    const [newKeyType, setNewKeyType] = useState<string>("openai");
    const [newEndpoint, setNewEndpoint] = useState<string>("");
    const [newKey, setNewKey] = useState<string>("");
    const [newModel, setNewModel] = useState<string>("");


    let modelExists = oaiModels.some(m => m.endpoint == newEndpoint && m.model == newModel);

    let testModel = (endpoint: string, key: string, model: string) => {
        updateModelStatus(model, endpoint, 'testing', "");
        let message = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({
                model: model,
                key: key,
                endpoint: endpoint
            }),
        };
        fetch(getUrls().TEST_MODEL, {...message })
            .then((response) => response.json())
            .then((data) => {
                let status = data["status"] || 'error';
                updateModelStatus(model, endpoint, status, data["message"] || "");
            }).catch((error) => {
                updateModelStatus(model, endpoint, 'error', error.message)
            });
    }

    let newModelEntry = <TableRow
        key={`new-model-entry`}
        sx={{ '&:last-child td, &:last-child th': { border: 0 }, padding: "6px 6px" }}
        onClick={() => {setTempSelectedMode(undefined)}}
    >
        <TableCell align="right">
            <Radio checked={tempSelectedModel == undefined} name="radio-buttons" inputProps={{'aria-label': 'Select this model'}}/>
        </TableCell>
        <TableCell align="left">
            <FormControl sx={{width: 100 }} size="small">
                <Select
                    title='key type'
                    value={newKeyType}
                    input={<OutlinedInput sx={{fontSize: '0.875rem'}}/>}
                    onChange={(event: SelectChangeEvent) => {
                        setNewKeyType(event.target.value);
                    }}
                >
                    <MenuItem sx={{fontSize: '0.875rem' }} value="openai">openai</MenuItem>
                    <MenuItem sx={{fontSize: '0.875rem' }} value="azureopenai">azure openai</MenuItem>
                </Select>
            </FormControl>
        </TableCell>
        <TableCell component="th" scope="row">
            {newKeyType == "openai" ? <Typography sx={{color: "text.secondary"}} fontSize='inherit'>N/A</Typography> : <TextField size="small" type="text" fullWidth
                disabled={newKeyType == "openai"}
                InputProps={{ style: { fontSize: "0.875rem" } }}
                value={newEndpoint}  onChange={(event: any) => { setNewEndpoint(event.target.value); }} 
                autoComplete='off'/>}
        </TableCell>
        <TableCell align="left" >
            <TextField fullWidth size="small" type={showKeys ? "text" : "password"} 
                InputProps={{ style: { fontSize: "0.875rem" } }} 
                placeholder='leave blank if using keyless access'
                value={newKey}  onChange={(event: any) => { setNewKey(event.target.value); }} 
                autoComplete='off'/>
        </TableCell>
        <TableCell align="left">
            <Autocomplete
                freeSolo
                onChange={(event: any, newValue: string | null) => { setNewModel(newValue || ""); }}
                value={newModel}
                options={['gpt-35-turbo', 'gpt-4', 'gpt-4o']}
                renderOption={(props, option) => {
                    return <Typography {...props} onClick={()=>{ setNewModel(option); }} sx={{fontSize: "small"}}>{option}</Typography>
                }}
                renderInput={(params) => (
                    <TextField
                        error={modelExists}
                        //label={modelExists ? "endpoint and model exists" : ""}
                        {...params}
                        InputProps={{ ...params.InputProps, style: { fontSize: "0.875rem" } }}
                        inputProps={{
                            ...params.inputProps, // Spread params.inputProps to preserve existing functionality
                            'aria-label': 'Select or enter a model', // Apply aria-label directly to inputProps
                        }}
                        size="small"
                        onChange={(event: any) => { setNewModel(event.target.value); }}
                    />
                )}/>
        </TableCell>
        <TableCell align="right">
            <Tooltip title={modelExists ? "endpoint + model already exists" : "add and test model"}>
                <IconButton color={modelExists ? 'error' : 'primary'}
                    sx={{cursor: modelExists ? 'help' : 'pointer'}}
                    onClick={(event) => {
                        if (modelExists) {
                            return
                        }
                        let endpoint = newKeyType == 'openai' ? 'openai' : newEndpoint;
                        event.stopPropagation()

                        dispatch(dfActions.addModel({model: newModel, key: newKey, endpoint}));
                        dispatch(dfActions.selectModel({model: newModel, endpoint}));
                        setTempSelectedMode({endpoint, model: newModel});

                        testModel(endpoint, newKey, newModel); 
                        
                        setNewKeyType('openai');
                        setNewEndpoint("");
                        setNewKey("");
                        setNewModel("");
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
                        setNewKey("");
                        setNewModel("");
                    }}>
                    <ClearIcon />
                </IconButton>
            </Tooltip>
        </TableCell>
    </TableRow>

    let modelTable = <TableContainer>
        <Table sx={{ minWidth: 600 }} size="small" >
            <TableHead >
                <TableRow>
                    <TableCell align="right"></TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '120px'}}>Key Type</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '240px'}}>Endpoint</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '270px'}} align="left">Key</TableCell>
                    <TableCell sx={{fontWeight: 'bold', width: '120px'}} align="left">Model</TableCell>
                    <TableCell sx={{fontWeight: 'bold'}} align="right">Status</TableCell>
                    <TableCell sx={{fontWeight: 'bold'}} align="right">Action</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {oaiModels.map((oaiModel) => {
                    let isItemSelected = tempSelectedModel && 
                                            tempSelectedModel.endpoint == oaiModel.endpoint && 
                                            tempSelectedModel.model == oaiModel.model;
                    let status =  getStatus(oaiModel.model, oaiModel.endpoint);
                    let statusIcon = status  == "unknown" ? <HelpOutlineIcon color="warning" /> : ( status == 'testing' ? <CircularProgress size={24} />:
                            (status == "ok" ? <CheckCircleOutlineIcon color="success"/> : <ErrorOutlineIcon color="error"/> ))
                    
                    let message = status == "unknown" ? "Status unknown, click the status icon to test again." : 
                        (testedModels.find(m => m.model === oaiModel.model && m.endpoint === oaiModel.endpoint)?.message || "Unknown error");
                    const borderStyle = ['error', 'unknown'].includes(status) ? '1px dashed text.secondary' : undefined;
                    const noBorderStyle = ['error', 'unknown'].includes(status) ? 'none' : undefined;

                    return (
                        <>
                        <TableRow
                            selected={isItemSelected}
                            key={`${oaiModel.endpoint}-${oaiModel.model}`}
                            onClick={() => { setTempSelectedMode({model: oaiModel.model, endpoint: oaiModel.endpoint}) }}
                            sx={{ cursor: 'pointer'}}
                        >
                            <TableCell align="right" sx={{ borderBottom: noBorderStyle }}>
                                <Radio checked={isItemSelected} name="radio-buttons" inputProps={{'aria-label': 'Select this model'}} />
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: noBorderStyle }}>
                                {oaiModel.endpoint == 'openai' ? 'openai' : 'azure openai'}
                            </TableCell>
                            <TableCell component="th" scope="row" sx={{ borderBottom: borderStyle }}>
                                {oaiModel.endpoint}
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: borderStyle }}>
                                {oaiModel.key != "" ? 
                                    (showKeys ? (oaiModel.key || <Typography sx={{color: "text.secondary"}} fontSize='inherit'>N/A</Typography>) : "************") :
                                    <Typography sx={{color: "text.secondary"}} fontSize='inherit'>N/A</Typography> 
                                }
                            </TableCell>
                            <TableCell align="left" sx={{ borderBottom: borderStyle }}>{oaiModel.model}</TableCell>
                            <TableCell sx={{fontWeight: 'bold', borderBottom: borderStyle}} align="right">
                                <Tooltip title={message}>
                                    <IconButton
                                        onClick ={() => { testModel(oaiModel.endpoint, oaiModel.key, oaiModel.model)  }}
                                    >
                                        {statusIcon}
                                    </IconButton>
                                </Tooltip>
                            </TableCell>
                            <TableCell sx={{ borderBottom: borderStyle }} align="right">
                                <Tooltip title="remove model">
                                    <IconButton disabled={oaiModel.endpoint=="default"} 
                                        onClick={()=>{
                                            dispatch(dfActions.removeModel({model: oaiModel.model, endpoint: oaiModel.endpoint}));
                                            if ((tempSelectedModel) 
                                                    && tempSelectedModel.endpoint == oaiModel.endpoint 
                                                    && tempSelectedModel.model == oaiModel.model) {
                                                if (oaiModels.length == 0) {
                                                    setTempSelectedMode(undefined);
                                                } else {
                                                    let chosenModel = oaiModels[oaiModels.length - 1];
                                                    setTempSelectedMode({
                                                        model: chosenModel.model, endpoint: chosenModel.endpoint
                                                    })
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
                                onClick={() => { setTempSelectedMode({model: oaiModel.model, endpoint: oaiModel.endpoint}) }}
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
            </TableBody>
        </Table>
    </TableContainer>

    return <>
        <Tooltip title="select model">
            <Button sx={{fontSize: "inherit"}} variant="text" color="primary" onClick={()=>{setModelDialogOpen(true)}} endIcon={selectedModel ? <SettingsIcon /> : ''}>
                {selectedModel ? `Model: ${(selectedModel as any).model}` : 'Select A Model'}
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
                <Button disabled={!(tempSelectedModel && getStatus(tempSelectedModel.model, tempSelectedModel.endpoint) == 'ok')} 
                    variant={(selectedModel?.endpoint == tempSelectedModel?.endpoint && selectedModel?.model == tempSelectedModel?.model) ? 'text' : 'contained'}
                    onClick={()=>{
                        dispatch(dfActions.selectModel(tempSelectedModel as any));
                        setModelDialogOpen(false);}}>apply model</Button>
                <Button onClick={()=>{
                    setTempSelectedMode(selectedModel);
                    setModelDialogOpen(false);
                }}>cancel</Button>
            </DialogActions>
        </Dialog>
    </>;
}
