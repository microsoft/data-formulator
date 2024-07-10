// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';

import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Input, Paper, TextField } from '@mui/material';
import { CustomReactTable } from './ReactTable';
import { DictTable } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import { getUrls } from '../app/utils';
import { createTableFromFromObjectArray, createTableFromText, loadDataWrapper } from '../data/utils';

import CloseIcon from '@mui/icons-material/Close';
import { dfActions, fetchFieldSemanticType } from '../app/dfSlice';
import { useDispatch } from 'react-redux';
import { useState } from 'react';
import { AppDispatch } from '../app/store';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

    return (
	    <div
            role="tabpanel"
            hidden={value !== index}
            id={`vertical-tabpanel-${index}`}
            aria-labelledby={`vertical-tab-${index}`}
            style={{maxWidth: 'calc(100% - 120px)'}}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 2 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

function a11yProps(index: number) {
  return {
	id: `vertical-tab-${index}`,
	'aria-controls': `vertical-tabpanel-${index}`,
  };
}

export interface TableSelectionViewProps {
    tables: DictTable[];
    handleDeleteTable?: (index: number) => void;
    handleSelectTable: (table: DictTable) => void;
    hideRowNum?: boolean;
}


export const TableSelectionView: React.FC<TableSelectionViewProps> = function TableSelectionView({ tables, handleDeleteTable, handleSelectTable, hideRowNum  }) {

    const [value, setValue] = React.useState(0);

    const handleChange = (event: React.SyntheticEvent, newValue: number) => {
        setValue(newValue);
    };

    let tabTitiles : string[] = [];
    for (let i = 0; i < tables.length; i ++) {
        let k = 0;
        let title = tables[i].id;
        while (tabTitiles.includes(title)) {
            k = k + 1;
            title = `${title}_${k}`;
        }
        tabTitiles.push(title);
    }

    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', display: 'flex', maxHeight: 400 }} >
        <Tabs
            orientation="vertical"
            variant="scrollable"
            value={value}
            onChange={handleChange}
            aria-label="Vertical tabs example"
            sx={{ borderRight: 1, borderColor: 'divider', minWidth: 120 }}
        >
            {tabTitiles.map((title, i) => <Tab wrapped key={i} label={title} sx={{textTransform: "none", width: 120}} {...a11yProps(0)} />)}
        </Tabs>
        {tables.map((t, i) => {
            let sampleRows = [...t.rows.slice(0,9), Object.fromEntries(t.names.map(n => [n, "..."]))];
            let colDefs = t.names.map(name => { return {
                id: name, label: name, minWidth: 60, align: undefined, format: (v: any) => v,
            }})
            let content = <Paper variant="outlined" key={t.names.join("-")} sx={{width: 800, maxWidth: '100%', padding: "0px", marginBottom: "8px"}}>
                <CustomReactTable rows={sampleRows} columnDefs={colDefs} rowsPerPageNum={-1} compact={false} />
            </Paper>
            return  <TabPanel value={value} index={i} >
                        {content}
                        <Box width="100%" sx={{display: "flex"}}>
                            <Typography sx={{fontSize: 10, color: "gray"}}>{Object.keys(t.rows[0]).length} columns{hideRowNum ? "" : ` ⨉ ${t.rows.length} rows`}</Typography>
                            <Box sx={{marginLeft: "auto"}} >
                                {handleDeleteTable == undefined ? "" : 
                                    <IconButton size="small" color="primary" sx={{marginRight: "12px"}}
                                        onClick={(event: React.MouseEvent<HTMLElement>) => { 
                                            handleDeleteTable(i);
                                            setValue(i - 1 < 0 ? 0 : i - 1);
                                        }}
                                    >
                                        <DeleteIcon fontSize="inherit"/>
                                    </IconButton>}
                                <Button size="small" variant="contained" 
                                        onClick={(event: React.MouseEvent<HTMLElement>) => {
                                            handleSelectTable(t);
                                        }}>
                                    load table
                                </Button>
                            </Box>
                        </Box>
                    </TabPanel>
        })}
        </Box>
    );
}

export const TableSelectionDialog: React.FC<{ buttonElement: any }> = function TableSelectionDialog({ buttonElement }) {

    const [datasetPreviews, setDatasetPreviews] = React.useState<DictTable[]>([]);
    const [tableDialogOpen, setTableDialogOpen] = useState<boolean>(false);

    React.useEffect(() => {
        // Show a loading animation/message while loading
        fetch(`${getUrls().VEGA_DATASET_LIST}`)
            .then((response) => response.json())
            .then((result) => {
                let tables : DictTable[] = result.map((info: any) => {
                    let table = createTableFromFromObjectArray(info["name"], JSON.parse(info["snapshot"]))
                    return table
                }).filter((t : DictTable | undefined) => t != undefined);
                setDatasetPreviews(tables);
            });
      // No variable dependencies means this would run only once after the first render
      }, []);

    let dispatch = useDispatch<AppDispatch>();

    return <>
        <Button sx={{fontSize: "inherit"}} component="label" onClick={() => {
            setTableDialogOpen(true);
        }}>
            {buttonElement}
        </Button>
        <Dialog key="sample-dataset-selection-dialog" onClose={() => {setTableDialogOpen(false)}} 
                open={tableDialogOpen}
                sx={{ '& .MuiDialog-paper': { maxWidth: '100%', maxHeight: 840, minWidth: 800 } }}
            >
                <DialogTitle sx={{display: "flex"}}>Explore Sample Datasets
                    <IconButton
                        sx={{marginLeft: "auto"}}
                        edge="start"
                        size="small"
                        color="inherit"
                        onClick={() => {setTableDialogOpen(false)}}
                        aria-label="close"
                    >
                        <CloseIcon fontSize="inherit"/>
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{overflowX: "hidden", padding: 0}} dividers>
                    <TableSelectionView tables={datasetPreviews} hideRowNum
                        handleDeleteTable={undefined}
                        handleSelectTable={(tableInfo) => {
                            // request public datasets from the server
                        console.log(tableInfo);
                        console.log(`${getUrls().VEGA_DATASET_REQUEST_PREFIX}${tableInfo.id}`)
                        fetch(`${getUrls().VEGA_DATASET_REQUEST_PREFIX}${tableInfo.id}`)
                            .then((response) => {
                                return response.text()
                            })
                            .then((text) => {         
                                let fullTable = createTableFromFromObjectArray(tableInfo.id, JSON.parse(text));
                                if (fullTable) {
                                    dispatch(dfActions.addTable(fullTable));
                                    dispatch(fetchFieldSemanticType(fullTable));
                                } else {
                                    throw "";
                                }
                                setTableDialogOpen(false); 
                            })
                            .catch((error) => {
                                console.log(error)
                                dispatch(dfActions.addMessages({
                                    "timestamp": Date.now(),
                                    "type": "error",
                                    "value": `Unable to load the sample dataset ${tableInfo.id}, please try again later or upload your data.`
                                }));
                            })
                        }}/>
                </ DialogContent>
            </Dialog>
    </>
}


export interface TableUploadDialogProps {
    buttonElement: any;
    disabled: boolean;
}

export const TableUploadDialog: React.FC<TableUploadDialogProps> = ({ buttonElement, disabled }) => {

    const dispatch = useDispatch<AppDispatch>();

    let $uploadInputFile = React.createRef<HTMLInputElement>();

    let handleFileUpload = (event: React.FormEvent<HTMLElement>): void => {
        const target: any = event.target;
        if (target && target.files) {
            for (let file of target.files) {
                //const file: File = target.files[0];
                (file as File).text().then((text) => {
                    let table = loadDataWrapper(file.name, text, file.type);
                    if (table) {
                        dispatch(dfActions.addTable(table));
                        dispatch(fetchFieldSemanticType(table));
                    }
                });
            }
        }
    };

    return <Button sx={{fontSize: "inherit"}} variant="text" color="primary" component="label" 
                   disabled={disabled}>
                <Input inputProps={{ accept: '.csv,.tsv,.json', multiple: true  }} id="upload-data-file"
                    type="file"  sx={{ display: 'none' }} aria-hidden={true} 
                    ref={$uploadInputFile} onChange={handleFileUpload}
                />
                {buttonElement}
            </Button>;
}


export interface TableCopyDialogProps {
    buttonElement: any;
    disabled: boolean;
}

export const TableCopyDialog: React.FC<TableCopyDialogProps> = ({ buttonElement, disabled }) => {

    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const [tableName, setTableName] = useState<string>("");
    const [tableContent, setTableContent] = useState<string>("");

    const dispatch = useDispatch<AppDispatch>();

    let handleSubmitContent = (): void => {

        let table : undefined | DictTable = undefined;
        try {
            let content = JSON.parse(tableContent);
            table = createTableFromFromObjectArray(tableName || 'dataset', content);
        } catch (error) {
            table = createTableFromText(tableName || 'dataset', tableContent);
        }

        if (table) {
            dispatch(dfActions.addTable(table));
            dispatch(fetchFieldSemanticType(table));
        }        
    };

    let dialog = <Dialog key="table-selection-dialog" onClose={()=>{setDialogOpen(false)}} open={dialogOpen}
            sx={{ '& .MuiDialog-paper': { maxWidth: '80%', maxHeight: 800, minWidth: 800 } }}
        >
            <DialogTitle  sx={{display: "flex"}}>Paste & Upload Data
                <IconButton
                    sx={{marginLeft: "auto"}}
                    edge="start"
                    size="small"
                    color="inherit"
                    onClick={()=>{ setDialogOpen(false); }}
                    aria-label="close"
                >
                    <CloseIcon fontSize="inherit"/>
                </IconButton>
            </DialogTitle>
            <DialogContent sx={{overflowX: "hidden", padding: 2, display: "flex", flexDirection: "column"}} dividers>
                <TextField sx={{marginBottom: 1}} size="small" value={tableName} onChange={(event) => { setTableName(event.target.value); }} 
                           autoComplete='off' id="outlined-basic" label="dataset name" variant="outlined" />
                <TextField autoFocus size="small" id="upload content" value={tableContent} maxRows={20}
                            onChange={(event) => { setTableContent(event.target.value); }}
                            autoComplete='off'
                            label="content (csv, tsv, or json format)" variant="outlined" multiline minRows={15} />
            </ DialogContent>
            <DialogActions>
                <Button variant="contained" size="small" onClick={()=>{ setDialogOpen(false); }}>cancel</Button>
                <Button variant="contained" size="small" onClick={()=>{ setDialogOpen(false); handleSubmitContent(); }} >
                    upload
                </Button>
            </DialogActions>
        </Dialog>;

    return <>
        <Button sx={{fontSize: "inherit"}} variant="text" color="primary" component="label" 
                    disabled={disabled} onClick={()=>{setDialogOpen(true)}}>
                {buttonElement}
        </Button>
        {dialog}
    </>;
}



export interface TableURLDialogProps {
    buttonElement: any;
    disabled: boolean;
}

export const TableURLDialog: React.FC<TableURLDialogProps> = ({ buttonElement, disabled }) => {

    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const [tableURL, setTableURL] = useState<string>("");

    const dispatch = useDispatch<AppDispatch>();

    let handleSubmitContent = (): void => {

        let  parts = tableURL.split('/');

        // Get the last part of the URL, which should be the file name with extension
        const tableName = parts[parts.length - 1];

        fetch(tableURL)
        .then(res => res.text())
        .then(content => {
            let table : undefined | DictTable = undefined;
            try {
                let jsonContent = JSON.parse(content);
                table = createTableFromFromObjectArray(tableName || 'dataset', jsonContent);
            } catch (error) {
                table = createTableFromText(tableName || 'dataset', content);
            }

            if (table) {
                dispatch(dfActions.addTable(table));
                dispatch(fetchFieldSemanticType(table));
            }        
        })
    };

    let hasValidSuffix = tableURL.endsWith('.csv') || tableURL.endsWith('.tsv') || tableURL.endsWith(".json");

    let dialog = <Dialog key="table-url-dialog" onClose={()=>{setDialogOpen(false)}} open={dialogOpen}
            sx={{ '& .MuiDialog-paper': { maxWidth: '80%', maxHeight: 800, minWidth: 800 } }} disableRestoreFocus
        >
            <DialogTitle  sx={{display: "flex"}}>Upload data URL
                <IconButton
                    sx={{marginLeft: "auto"}}
                    edge="start"
                    size="small"
                    color="inherit"
                    onClick={()=>{ setDialogOpen(false); }}
                    aria-label="close"
                >
                    <CloseIcon fontSize="inherit"/>
                </IconButton>
            </DialogTitle>
            <DialogContent sx={{overflowX: "hidden", padding: 2, display: "flex", flexDirection: "column"}} dividers>
                <TextField error={tableURL != "" && !hasValidSuffix} autoFocus placeholder='Please enter URL of the dataset' 
                            helperText={hasValidSuffix ? "" : "the url should links to a csv, tsv or json file"}
                            sx={{marginBottom: 1}} size="small" value={tableURL} onChange={(event) => { setTableURL(event.target.value.trim()); }} 
                            id="dataset-url" label="data url" variant="outlined" />
            </ DialogContent>
            <DialogActions>
                <Button variant="contained" size="small" onClick={()=>{ setDialogOpen(false); }}>cancel</Button>
                <Button variant="contained" size="small" onClick={()=>{ setDialogOpen(false); handleSubmitContent(); }} >
                    upload
                </Button>
            </DialogActions>
        </Dialog>;

    return <>
        <Button sx={{fontSize: "inherit"}} variant="text" color="primary" component="label" 
                    disabled={disabled} onClick={()=>{setDialogOpen(true)}}>
                {buttonElement}
        </Button>
        {dialog}
    </>;
}