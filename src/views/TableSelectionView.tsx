// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import validator from 'validator';
import DOMPurify from 'dompurify';

import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { alpha, Button, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider, 
         IconButton, Input, CircularProgress, LinearProgress, Paper, TextField, useTheme, 
         Card} from '@mui/material';
import { CustomReactTable } from './ReactTable';
import { DictTable } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import { getUrls } from '../app/utils';
import { createTableFromFromObjectArray, createTableFromText, loadTextDataWrapper, loadBinaryDataWrapper } from '../data/utils';

import CloseIcon from '@mui/icons-material/Close';
import KeyboardReturnIcon from '@mui/icons-material/KeyboardReturn';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AutoFixNormalIcon from '@mui/icons-material/AutoFixNormal';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CancelIcon from '@mui/icons-material/Cancel';

import ReactDiffViewer from 'react-diff-viewer'

import { DataFormulatorState, dfActions, dfSelectors, fetchFieldSemanticType } from '../app/dfSlice';
import { useDispatch, useSelector } from 'react-redux';
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

export interface TableMetadata {
    name: string;
    description: string;
    challenges: { text: string; goal: string; difficulty: 'easy' | 'hard'; }[];
    table: DictTable;
}


export interface TableSelectionViewProps {
    tableMetadata: TableMetadata[];
    handleDeleteTable?: (index: number) => void;
    handleSelectTable: (tableMetadata: TableMetadata) => void;
    hideRowNum?: boolean;
}


export const TableSelectionView: React.FC<TableSelectionViewProps> = function TableSelectionView({ tableMetadata, handleDeleteTable, handleSelectTable, hideRowNum  }) {

    const [selectedTableName, setSelectedTableName] = React.useState(tableMetadata[0].name);

    const handleTableSelect = (index: number) => {
        setSelectedTableName(tableMetadata[index].name);
    };

    let tableTitles : string[] = [];
    for (let i = 0; i < tableMetadata.length; i ++) {
        let k = 0;
        let title = tableMetadata[i].name;
        while (tableTitles.includes(title)) {
            k = k + 1;
            title = `${title}_${k}`;
        }
        tableTitles.push(title);
    }

    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', display: 'flex', maxHeight: 600, borderRadius: 2 }} >
            {/* Button navigation */}
            <Box sx={{ 
                minWidth: 120, 
                display: 'flex',
                flexDirection: 'column',
                borderRight: 1,
                borderColor: 'divider'
            }}>
                {tableTitles.map((title, i) => (
                    <Button
                        key={i}
                        variant="text"
                        size="small"
                        color='primary'
                        onClick={() => handleTableSelect(i)}
                        sx={{
                            fontSize: 12,
                            textTransform: "none",
                            width: 120,
                            justifyContent: 'flex-start',
                            textAlign: 'left',
                            borderRadius: 0,
                            py: 1,
                            px: 2,
                            color: selectedTableName === title ? 'primary.main' : 'text.secondary',
                            borderRight: selectedTableName === title ? 2 : 0,
                            borderColor: 'primary.main',
                        }}
                    >
                        {title}
                    </Button>
                ))}
            </Box>

            {/* Content area */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                {tableMetadata.map((tm, i) => {
                    if (tm.name !== selectedTableName) return null;
                    
                    let t = tm.table;
                    let sampleRows = [...t.rows.slice(0,9), Object.fromEntries(t.names.map(n => [n, "..."]))];
                    let colDefs = t.names.map(name => { return {
                        id: name, label: name, minWidth: 60, align: undefined, format: (v: any) => v,
                    }})
                    
                    // let challengeView = <Box sx={{margin: "6px 0px"}}>
                    //     <Typography variant="subtitle2" sx={{marginLeft: "6px", fontSize: 12}}>Try these data visualization challenges with this dataset:</Typography>
                    //     {tc.challenges.map((c, j) => <Box key={j} sx={{display: 'flex', alignItems: 'flex-start', pl: 1}}>
                    //         <Typography sx={{fontSize: 11, color: c.difficulty === 'easy' ? 'success.main' : 'warning.main'}}>[{c.difficulty}] {c.text}</Typography>
                    //     </Box>)}
                    // </Box>  

                    let content = <Paper variant="outlined" key={t.names.join("-")} sx={{width: 800, maxWidth: '100%', padding: "0px", marginBottom: "8px"}}>
                        <CustomReactTable rows={sampleRows} columnDefs={colDefs} rowsPerPageNum={-1} compact={false} />
                    </Paper>

                    return (
                        <Box key={i}>
                            <Typography variant="subtitle2" sx={{ mb: 1, fontSize: 12}} color="text.secondary">
                                {tm.name} ‣ {tm.description}
                            </Typography>
                            {content}
                            <Box width="100%" sx={{display: "flex"}}>
                                <Typography sx={{fontSize: 10, color: "text.secondary"}}>
                                    {Object.keys(t.rows[0]).length} columns{hideRowNum ? "" : ` ⨉ ${t.rows.length} rows`}
                                </Typography>
                                <Box sx={{marginLeft: "auto"}} >
                                    {handleDeleteTable == undefined ? "" : 
                                        <IconButton size="small" color="primary" sx={{marginRight: "12px"}}
                                            onClick={(event: React.MouseEvent<HTMLElement>) => { 
                                                handleDeleteTable(i);
                                                setSelectedTableName(tableMetadata[i - 1 < 0 ? 0 : i - 1].name);
                                            }}
                                        >
                                            <DeleteIcon fontSize="inherit"/>
                                        </IconButton>}
                                    <Button size="small" variant="contained" 
                                            onClick={(event: React.MouseEvent<HTMLElement>) => {
                                                handleSelectTable(tm);
                                            }}>
                                        load table
                                    </Button>
                                </Box>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}

export const TableSelectionDialog: React.FC<{ buttonElement: any }> = function TableSelectionDialog({ buttonElement }) {

    const [datasetPreviews, setDatasetPreviews] = React.useState<TableMetadata[]>([]);
    const [tableDialogOpen, setTableDialogOpen] = useState<boolean>(false);

    React.useEffect(() => {
        // Show a loading animation/message while loading
        fetch(`${getUrls().VEGA_DATASET_LIST}`)
            .then((response) => response.json())
            .then((result) => {
                let tableMetadata : TableMetadata[] = result.map((info: any) => {
                    let table = createTableFromFromObjectArray(info["name"], JSON.parse(info["snapshot"]), true)
                    return {table: table, challenges: info["challenges"], name: info["name"], description: info["description"]}
                }).filter((t : TableMetadata | undefined) => t != undefined);
                setDatasetPreviews(tableMetadata);
            });
      }, []);

    let dispatch = useDispatch<AppDispatch>();

    return <>
        <Button sx={{fontSize: "inherit"}} onClick={() => {
            setTableDialogOpen(true);
        }}>
            {buttonElement}
        </Button>
        <Dialog key="sample-dataset-selection-dialog" onClose={() => {setTableDialogOpen(false)}} 
                open={tableDialogOpen}
                sx={{ '& .MuiDialog-paper': { maxWidth: '100%', maxHeight: 840, minWidth: 800 } }}
            >
                <DialogTitle sx={{display: "flex"}}>Examples
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
                <DialogContent sx={{overflowX: "hidden", padding: 1}}>
                    <TableSelectionView tableMetadata={datasetPreviews} hideRowNum
                        handleDeleteTable={undefined}
                        handleSelectTable={(tableMetadata) => {
                            fetch(`${getUrls().VEGA_DATASET_REQUEST_PREFIX}${tableMetadata.table.id}`)
                                .then((response) => {
                                    return response.text()
                                })
                                .then((text) => {         
                                    let fullTable = createTableFromFromObjectArray(tableMetadata.table.id, JSON.parse(text), true);
                                    if (fullTable) {
                                        dispatch(dfActions.loadTable(fullTable));
                                        dispatch(fetchFieldSemanticType(fullTable));
                                        dispatch(dfActions.addChallenges({
                                            tableId: tableMetadata.table.id,
                                            challenges: tableMetadata.challenges
                                        }));
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
                                        "component": "data loader",
                                        "value": `Unable to load the sample dataset ${tableMetadata.table.id}, please try again later or upload your data.`
                                    }));
                                })
                        }}/>
                </DialogContent>
            </Dialog>
    </>
}


export interface TableUploadDialogProps {
    buttonElement: any;
    disabled: boolean;
}

const getUniqueTableName = (baseName: string, existingNames: Set<string>): string => {
    let uniqueName = baseName;
    let counter = 1;
    while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName}_${counter}`;
        counter++;
    }
    return uniqueName;
};

export const TableUploadDialog: React.FC<TableUploadDialogProps> = ({ buttonElement, disabled }) => {
    const dispatch = useDispatch<AppDispatch>();
    const inputRef = React.useRef<HTMLInputElement>(null);
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const existingNames = new Set(existingTables.map(t => t.id));

    let handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const files = event.target.files;

        if (files) {
            for (let file of files) {
                const uniqueName = getUniqueTableName(file.name, existingNames);
                
                // Check if file is a text type (csv, tsv, json)
                if (file.type === 'text/csv' || 
                    file.type === 'text/tab-separated-values' || 
                    file.type === 'application/json' ||
                    file.name.endsWith('.csv') || 
                    file.name.endsWith('.tsv') || 
                    file.name.endsWith('.json')) {

                    // Check if file is larger than 5MB
                    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes
                    if (file.size > MAX_FILE_SIZE) {
                        dispatch(dfActions.addMessages({
                            "timestamp": Date.now(),
                            "type": "error",
                            "component": "data loader",
                            "value": `File ${file.name} is too large (${(file.size / (1024 * 1024)).toFixed(2)}MB), upload it via DATABASE option instead.`
                        }));
                        continue; // Skip this file and process the next one
                    }
                    
                    // Handle text files
                    file.text().then((text) => {
                        let table = loadTextDataWrapper(uniqueName, text, file.type);
                        if (table) {
                            dispatch(dfActions.loadTable(table));
                            dispatch(fetchFieldSemanticType(table));
                        }
                    });
                } else if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                           file.type === 'application/vnd.ms-excel' ||
                           file.name.endsWith('.xlsx') || 
                           file.name.endsWith('.xls')) {
                    // Handle Excel files
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const arrayBuffer = e.target?.result as ArrayBuffer;
                        if (arrayBuffer) {
                            let tables = loadBinaryDataWrapper(uniqueName, arrayBuffer);
                            for (let table of tables) {
                                dispatch(dfActions.loadTable(table));
                                dispatch(fetchFieldSemanticType(table));
                            }
                            if (tables.length == 0) {
                                dispatch(dfActions.addMessages({
                                    "timestamp": Date.now(),
                                    "type": "error",
                                    "component": "data loader",
                                    "value": `Failed to parse Excel file ${file.name}. Please check the file format.`
                                }));
                            }
                        }
                    };
                    reader.readAsArrayBuffer(file);
                } else {
                    // Unsupported file type
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "type": "error",
                        "component": "data loader",
                        "value": `Unsupported file format: ${file.name}. Please use CSV, TSV, JSON, or Excel files.`
                    }));
                }
            }
        }
        if (inputRef.current) {
            inputRef.current.value = '';
        }
    };

    return (
        <>
            <Input
                inputProps={{ 
                    accept: '.csv,.tsv,.json,.xlsx,.xls',
                    multiple: true,
                }}
                id="upload-data-file"
                type="file"
                sx={{ display: 'none' }}
                inputRef={inputRef}
                onChange={handleFileUpload}
            />
            <Button 
                sx={{fontSize: "inherit"}} 
                variant="text" 
                color="primary" 
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
            >
                {buttonElement}
            </Button>
        </>
    );
}


export interface TableCopyDialogProps {
    buttonElement: any;
    disabled: boolean;
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
                table = createTableFromFromObjectArray(tableName || 'dataset', jsonContent, true);
            } catch (error) {
                table = createTableFromText(tableName || 'dataset', content);
            }

            if (table) {
                dispatch(dfActions.loadTable(table));
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
        <Button sx={{fontSize: "inherit"}} variant="text" color="primary" 
                    disabled={disabled} onClick={()=>{setDialogOpen(true)}}>
            {buttonElement}
        </Button>
        {dialog}
    </>;
}


export const TableCopyDialogV2: React.FC<TableCopyDialogProps> = ({ buttonElement, disabled }) => {

    let activeModel = useSelector(dfSelectors.getActiveModel);
    
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const [tableName, setTableName] = useState<string>("");
    
    const [tableContent, setTableContent] = useState<string>("");
    const [imageCleaningInstr, setImageCleaningInstr] = useState<string>("");
    const [tableContentType, setTableContentType] = useState<'text' | 'image'>('text');

    const [cleaningInProgress, setCleaningInProgress] = useState<boolean>(false);
    const [cleanTableContent, setCleanTableContent] = useState<{content: string, reason: string, mode: string} | undefined>(undefined);

    let viewTable = cleanTableContent == undefined ?  undefined : createTableFromText(tableName || "clean-table", cleanTableContent.content)

    const [loadFromURL, setLoadFromURL] = useState<boolean>(false);
    const [url, setURL] = useState<string>("");

    const dispatch = useDispatch<AppDispatch>();
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const existingNames = new Set(existingTables.map(t => t.id));

    let handleSubmitContent = (tableStr: string): void => {
        let table: undefined | DictTable = undefined;
        
        // Generate a short unique name based on content and time if no name provided
        const defaultName = (() => {
            const hashStr = tableStr.substring(0, 100) + Date.now();
            const hashCode = hashStr.split('').reduce((acc, char) => {
                return ((acc << 5) - acc) + char.charCodeAt(0) | 0;
            }, 0);
            const shortHash = Math.abs(hashCode).toString(36).substring(0, 4);
            return `data-${shortHash}`;
        })();

        const baseName = tableName || defaultName;
        const uniqueName = getUniqueTableName(baseName, existingNames);

        try {
            let content = JSON.parse(tableStr);
            table = createTableFromFromObjectArray(uniqueName, content, true);
        } catch (error) {
            table = createTableFromText(uniqueName, tableStr);
        }
        if (table) {
            dispatch(dfActions.loadTable(table));
            dispatch(fetchFieldSemanticType(table));
        }        
    };

    let handleLoadURL = () => {
        console.log("hello hello")
        setLoadFromURL(!loadFromURL);

        let  parts = url.split('/');

        // Get the last part of the URL, which should be the file name with extension
        const tableName = parts[parts.length - 1];

        fetch(url)
        .then(res => res.text())
        .then(content => {
            setTableName(tableName);
            setTableContent(content); 
            setTableContentType("text");
        })
    }

    let handleCleanData = () => {
        //setCleanTableContent("hehehao\n\n" + tableContent);
        let token = String(Date.now());
        setCleaningInProgress(true);
        setCleanTableContent(undefined);
        let message = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({
                token: token,
                content_type: tableContentType,
                raw_data: tableContent,
                image_cleaning_instruction: imageCleaningInstr,
                model: activeModel
            }),
        };

        fetch(getUrls().CLEAN_DATA_URL, message)
            .then((response) => response.json())
            .then((data) => {
                setCleaningInProgress(false);
                console.log(data);
                console.log(token);

                if (data["status"] == "ok") {
                    if (data["token"] == token) {
                        let candidate = data["result"][0];
                        console.log(candidate)

                        let cleanContent = candidate['content'];
                        let info = candidate['info'];

                        setCleanTableContent({content: cleanContent.trim(), reason: info['reason'], mode: info['mode']});
                        console.log(`data cleaning reason:`)
                        console.log(info);
                    }
                } else {
                    // TODO: add warnings to show the user
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "type": "error",
                        "component": "data loader",
                        "value": "unable to perform auto-sort."
                    }));
                    setCleanTableContent(undefined);
                }
            }).catch((error) => {
                setCleaningInProgress(false);
                setCleanTableContent(undefined);
               
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "error",
                    "component": "data loader",
                    "value": "unable to perform clean data due to server issue."
                }));
            });
    }

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
            <DialogContent sx={{overflowX: "hidden", padding: 2, display: "flex", 
                                flexDirection: "column", 
                                "& .MuiOutlinedInput-root.Mui-disabled": {backgroundColor: 'rgba(0,0,0,0.05)'}}} dividers>
                <Box sx={{width: '100%', marginBottom: 1, display:'flex'}}>
                    <TextField sx={{flex: 1}} disabled={loadFromURL} size="small" 
                            value={tableName} onChange={(event) => { setTableName(event.target.value); }} 
                           autoComplete='off' id="outlined-basic" label="dataset name" variant="outlined" />
                    <Divider sx={{margin: 1}} flexItem orientation='vertical'/>
                    <Button sx={{marginLeft: 0, textTransform: 'none'}} onClick={() => {setLoadFromURL(!loadFromURL)}} 
                            endIcon={!loadFromURL ? <ChevronLeftIcon/> : <ChevronRightIcon />} >{"load from URL"}</Button>
                    <Collapse orientation='horizontal' in={loadFromURL}>
                        <Box component="form" sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', width: 400 }} >
                            <TextField sx={{width: 420}} size="small" value={url} 
                                onChange={(event) => { setURL(event.target.value); }} 
                                onKeyDown={(event)=> { 
                                    if(event.key == 'Enter'){
                                        handleLoadURL();
                                        event.preventDefault();
                                     }
                                }}
                                autoComplete='off' id="outlined-basic" label="url" variant="outlined" />
                            <Button variant="contained" disabled={url == ""}  sx={{ p: '6px 0px', minWidth: '36px', marginLeft: 1, borderRadius: '32px' }}onClick={handleLoadURL} >
                                <KeyboardReturnIcon />
                            </Button>
                        </Box>
                    </Collapse>
                </Box>
                <Box sx={{width: '100%',  display:'flex', position: 'relative', overflow: 'auto'}}>
                    {cleaningInProgress && tableContentType == "text" ? <LinearProgress sx={{ width: '100%', height: "calc(100% - 8px)", marginTop: 1, minHeight: 200, opacity: 0.1, position: 'absolute', zIndex: 1 }} /> : ""}
                    {viewTable  ? 
                    <>
                        <CustomReactTable
                            rows={viewTable.rows} 
                            rowsPerPageNum={-1} compact={false}
                            columnDefs={viewTable.names.map(name => { 
                                return { id: name, label: name, minWidth: 60, align: undefined, format: (v: any) => v}
                            })}  
                        />
                        {/* <Typography>{cleanTableContent.reason}</Typography> */}
                    </>
                    : ( tableContentType == "text" ?
                        <TextField disabled={loadFromURL || cleaningInProgress} autoFocus 
                            size="small" sx={{ marginTop: 1, flex: 1, "& .MuiInputBase-input" : {fontSize: tableContent.length > 1000 ? 12 : 14, lineHeight: 1.2 }}} 
                            id="upload content" value={tableContent} maxRows={30}
                            onChange={(event) => { 
                                setTableContent(event.target.value); 
                            }}
                            slotProps={{
                                inputLabel: {
                                    shrink: true
                                }
                            }}
                            placeholder="Paste data (in csv, tsv, or json format), or a text snippet / an image that contains data to get started."
                            onPasteCapture={(e) => {
                                console.log(e.clipboardData.files);
                                if (e.clipboardData.files.length > 0) {
                                    let file = e.clipboardData.files[0];
                                    let read = new FileReader();

                                    read.readAsDataURL(file);

                                    read.onloadend = function(){
                                        let res = read.result;
                                        console.log(res);
                                        if (res) { 
                                            setTableContent(res as string); 
                                            setTableContentType("image");
                                        }
                                    }
                                }
                            }}
                            autoComplete='off'
                            label="data content" variant="outlined" multiline minRows={15} 
                        />
                        :
                        <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                            <Box sx={{marginTop: 1, position: 'relative'}}>
                                {cleaningInProgress ? <LinearProgress sx={{ width: '100%', height: "calc(100% - 4px)", opacity: 0.1, position: 'absolute', zIndex: 1 }} /> : ""}
                                <IconButton size="small" color="primary"
                                            sx={{  backgroundColor: 'white', 
                                                width: 16, height: 16, boxShadow: 3, 
                                                position: 'absolute', right: 4, top: 4,
                                                "&:hover": { backgroundColor: "white", boxShadow: 8, transform: "translate(0.5px, -0.5px)"  }
                                                }}
                                    onClick={() => {
                                        setTableContent("");
                                        setTableContentType("text");
                                        setImageCleaningInstr("");
                                    }}
                                >
                                    <CancelIcon sx={{fontSize: 16}} />
                                </IconButton>
                                {validator.isURL(tableContent) || validator.isDataURI(tableContent) ? (
                                    <img style={{border: '1px lightgray solid', borderRadius: 4, maxWidth: 640, maxHeight: 360}} 
                                        src={DOMPurify.sanitize(tableContent)} alt="the image is corrupted, please try again." />
                                ) : (
                                    <Typography color="error">Invalid image data</Typography>
                                )}
                            </Box>
                            <TextField fullWidth size="small" sx={{ marginTop: 1, "& .MuiInputBase-input" : {fontSize: 14, lineHeight: 1.2 }}} 
                                value={imageCleaningInstr} onChange={(event) => { setImageCleaningInstr(event.target.value); }} 
                                variant="standard" placeholder='additional cleaning instructions' />
                        </Box>)
                    }
                    </Box>
            </ DialogContent>
            <DialogActions>
                { cleanTableContent != undefined ? 
                    <Box sx={{display: 'flex', marginRight: 'auto'}}>
                        <Button sx={{}} variant="contained" color="warning" size="small" onClick={()=>{ setCleanTableContent(undefined); }} >
                            Revert
                        </Button>
                        <Button sx={{marginLeft: 1}} variant="contained" size="small" 
                                onClick={()=>{ 
                                    setTableContent(cleanTableContent?.content || ""); 
                                    setTableContentType("text");
                                    setCleanTableContent(undefined); 
                                }} >
                            Edit Data
                        </Button>
                    </Box> : <Button disabled={tableContent.trim() == "" || loadFromURL} 
                    variant={cleaningInProgress ? "outlined" : "contained"} color="primary" size="small" sx={{marginRight: 'auto', textTransform: 'none'}} 
                        onClick={handleCleanData} endIcon={cleaningInProgress ? <CircularProgress size={24} /> : <AutoFixNormalIcon/> }>
                    {tableContentType == "text" ? "Clean / Generate Data" : "Extract Data from Image"} {cleanTableContent ? "(again)" : ""}
                </Button>}
                {/* <Collapse orientation='horizontal' in={cleanTableContent != undefined}>
                    <Divider sx={{marginLeft: 1}} flexItem orientation='vertical'/>
                </Collapse> */}
                <Button disabled={cleanTableContent != undefined} variant="contained" size="small" onClick={()=>{ setDialogOpen(false); }}>cancel</Button>
                <Button disabled={cleanTableContent?.content == undefined && (tableContentType != "text" || tableContent.trim() == "")} variant="contained" size="small" 
                    onClick={()=>{ 
                        setDialogOpen(false); 
                        handleSubmitContent(cleanTableContent?.content || tableContent); 
                    }} >
                    {"upload"}
                </Button>
            </DialogActions>
            
        </Dialog>;

    return <>
        <Button sx={{fontSize: "inherit"}} variant="text" color="primary" 
                    disabled={disabled} onClick={()=>{setDialogOpen(true)}}>
                {buttonElement}
        </Button>
        {dialog}
    </>;
}

