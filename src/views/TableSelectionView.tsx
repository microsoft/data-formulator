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
import { useEffect, useState, useCallback } from 'react';
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

// Update the interface to support multiple tables per dataset
export interface DatasetMetadata {
    name: string;
    description: string;
    source: string;
    tables: {
        table_name: string;
        url: string;
        format: string;
        sample: any[];
    }[];
}

export interface DatasetSelectionViewProps {
    datasets: DatasetMetadata[];
    handleSelectDataset: (datasetMetadata: DatasetMetadata) => void;
    hideRowNum?: boolean;
}


export const DatasetSelectionView: React.FC<DatasetSelectionViewProps> = function DatasetSelectionView({ datasets, handleSelectDataset, hideRowNum  }) {

    const [selectedDatasetName, setSelectedDatasetName] = React.useState<string | undefined>(undefined);

    useEffect(() => {
        if (datasets.length > 0) {
            setSelectedDatasetName(datasets[0].name);
        }
    }, [datasets]);

    const handleDatasetSelect = (index: number) => {
        setSelectedDatasetName(datasets[index].name);
    };

    let datasetTitles : string[] = [];
    for (let i = 0; i < datasets.length; i ++) {
        let k = 0;
        let title = datasets[i].name;
        while (datasetTitles.includes(title)) {
            k = k + 1;
            title = `${title}_${k}`;
        }
        datasetTitles.push(title);
    }

    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', display: 'flex', height: 600, borderRadius: 2 }} >
            {/* Button navigation */}
            <Box sx={{ 
                minWidth: 180, 
                display: 'flex',
                flexDirection: 'column',
                borderRight: 1,
                borderColor: 'divider'
            }}>
                {datasetTitles.map((title, i) => (
                    <Button
                        key={i}
                        variant="text"
                        size="small"
                        color='primary'
                        onClick={() => handleDatasetSelect(i)}
                        sx={{
                            fontSize: 12,
                            textTransform: "none",
                            width: 180,
                            justifyContent: 'flex-start',
                            textAlign: 'left',
                            borderRadius: 0,
                            py: 1,
                            px: 2,
                            color: selectedDatasetName === title ? 'primary.main' : 'text.secondary',
                            borderRight: selectedDatasetName === title ? 2 : 0,
                            borderColor: 'primary.main',
                        }}
                    >
                        {title}
                    </Button>
                ))}
            </Box>

            {/* Content area */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                {datasets.map((dataset, i) => {
                    if (dataset.name !== selectedDatasetName) return null;

                    let tableComponents = dataset.tables.map((table, j) => {
                        let t = createTableFromFromObjectArray(table.table_name, table.sample, true);
                        let maxDisplayRows = dataset.tables.length > 1 ? 5 : 9;
                        if (t.rows.length < maxDisplayRows) {
                            maxDisplayRows = t.rows.length - 1;
                        }
                        let sampleRows = [
                            ...t.rows.slice(0,maxDisplayRows), 
                            Object.fromEntries(t.names.map(n => [n, "..."]))
                        ];
                        let colDefs = t.names.map(name => { return {
                            id: name, label: name, minWidth: 60, align: undefined, format: (v: any) => v,
                        }})

                        let content = <Paper variant="outlined" key={t.names.join("-")} sx={{width: 800, maxWidth: '100%', padding: "0px", marginBottom: "8px"}}>
                            <CustomReactTable rows={sampleRows} columnDefs={colDefs} rowsPerPageNum={-1} compact={false} />
                        </Paper>

                        return (
                            <Box key={j}>
                                <Typography variant="subtitle2" sx={{ mb: 1, fontSize: 12}} color="text.secondary">
                                    {table.url.split("/").pop()?.split(".")[0]}  ({Object.keys(t.rows[0]).length} columns{hideRowNum ? "" : ` ⨉ ${t.rows.length} rows`})
                                </Typography>
                                {content}
                            </Box>
                        )
                    });
                    
                    return (
                        <Box key={i}>
                            <Box sx={{mb: 1, gap: 1, maxWidth: 800, display: "flex", alignItems: "center"}}>
                                <Typography sx={{fontSize: 12}}>
                                    {dataset.description} <Typography variant="caption" sx={{color: "primary.light", fontSize: 10, mx: 0.5}}>[from {dataset.source}]</Typography> 
                                </Typography>
                                <Box sx={{marginLeft: "auto", flexShrink: 0}} >
                                    <Button size="small" variant="contained" 
                                            onClick={(event: React.MouseEvent<HTMLElement>) => {
                                                handleSelectDataset(dataset);
                                            }}>
                                        load dataset
                                    </Button>
                                </Box>
                            </Box>
                            {tableComponents}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}

export const DatasetSelectionDialog: React.FC<{ buttonElement: any }> = function DatasetSelectionDialog({ buttonElement }) {

    const [datasetPreviews, setDatasetPreviews] = React.useState<DatasetMetadata[]>([]);
    const [tableDialogOpen, setTableDialogOpen] = useState<boolean>(false);

    React.useEffect(() => {
        // Show a loading animation/message while loading
        fetch(`${getUrls().EXAMPLE_DATASETS}`)
            .then((response) => response.json())
            .then((result) => {
                let datasets : DatasetMetadata[] = result.map((info: any) => {
                    let tables = info["tables"].map((table: any) => {

                        if (table["format"] == "json") {
                            return {
                                table_name: table["name"],
                                url: table["url"],
                                format: table["format"],
                                sample: table["sample"],
                            }
                        }
                        else if (table["format"] == "csv" || table["format"] == "tsv") {
                            const delimiter = table["format"] === "csv" ? "," : "\t";
                            const rows = table["sample"]
                                .split("\n")
                                .map((row: string) => row.split(delimiter));
                            
                            // Treat first row as headers and convert to object array
                            if (rows.length > 0) {
                                const headers = rows[0];
                                const dataRows = rows.slice(1);
                                const sampleData = dataRows.map((row: string[]) => {
                                    const obj: any = {};
                                    headers.forEach((header: string, index: number) => {
                                        obj[header] = row[index] || '';
                                    });
                                    return obj;
                                });
                                
                                return {
                                    table_name: table["name"],
                                    url: table["url"],
                                    format: table["format"],
                                    sample: sampleData,
                                };
                            }
                            
                            return {
                                table_name: table["name"],
                                url: table["url"],
                                format: table["format"],
                                sample: [],
                            };
                        }
                    })
                    return {tables: tables, name: info["name"], description: info["description"], source: info["source"]}
                }).filter((t : DatasetMetadata | undefined) => t != undefined);
                setDatasetPreviews(datasets);
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
                <DialogTitle sx={{display: "flex"}}>Explore
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
                    <DatasetSelectionView datasets={datasetPreviews} hideRowNum
                        handleSelectDataset={(dataset) => {
                            setTableDialogOpen(false);
                            for (let table of dataset.tables) { 
                                fetch(table.url)
                                .then(res => res.text())
                                .then(textData => {
                                    let tableName = table.url.split("/").pop()?.split(".")[0] || 'table-' + Date.now().toString().substring(0, 8);
                                    let dictTable;
                                    if (table.format == "csv") {
                                        dictTable = createTableFromText(tableName, textData);
                                    } else if (table.format == "json") {
                                        dictTable = createTableFromFromObjectArray(tableName, JSON.parse(textData), true);
                                    } 
                                    if (dictTable) {
                                        dispatch(dfActions.loadTable(dictTable));
                                        dispatch(fetchFieldSemanticType(dictTable));
                                    }
                                    
                                });
                            } 
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
                    reader.onload = async (e) => {
                        const arrayBuffer = e.target?.result as ArrayBuffer;
                        if (arrayBuffer) {
                            try {
                                let tables = await loadBinaryDataWrapper(uniqueName, arrayBuffer);
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
                            } catch (error) {
                                console.error('Error processing Excel file:', error);
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
    
    const [tableContent, setTableContent] = useState<string>("");
    const [tableContentType, setTableContentType] = useState<'text' | 'image'>('text');

    const [cleaningInProgress, setCleaningInProgress] = useState<boolean>(false);

    // Add new state for display optimization
    const [displayContent, setDisplayContent] = useState<string>("");
    const [isLargeContent, setIsLargeContent] = useState<boolean>(false);
    const [showFullContent, setShowFullContent] = useState<boolean>(false);
    
    // Constants for content size limits
    const MAX_DISPLAY_LINES = 20; // Reduced from 30
    const LARGE_CONTENT_THRESHOLD = 50000; // ~50KB threshold

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

        const baseName = defaultName;
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

    // Optimized content change handler
    const handleContentChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const newContent = event.target.value;
        setTableContent(newContent);
        
        // Check if content is large
        const isLarge = newContent.length > LARGE_CONTENT_THRESHOLD;
        setIsLargeContent(isLarge);
        
        if (isLarge && !showFullContent) {
            // For large content, only show a preview in the TextField
            const lines = newContent.split('\n');
            const previewLines = lines.slice(0, MAX_DISPLAY_LINES);
            const preview = previewLines.join('\n') + (lines.length > MAX_DISPLAY_LINES ? '\n... (truncated for performance)' : '');
            setDisplayContent(preview);
        } else {
            setDisplayContent(newContent);
        }
    }, [showFullContent]);

    // Toggle between preview and full content
    const toggleFullContent = useCallback(() => {
        setShowFullContent(!showFullContent);
        if (!showFullContent) {
            setDisplayContent(tableContent);
        } else {
            const lines = tableContent.split('\n');
            const previewLines = lines.slice(0, MAX_DISPLAY_LINES);
            const preview = previewLines.join('\n') + (lines.length > MAX_DISPLAY_LINES ? '\n... (truncated for performance)' : '');
            setDisplayContent(preview);
        }
    }, [showFullContent, tableContent]);


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
                <Box sx={{width: '100%',  display:'flex', position: 'relative', overflow: 'auto'}}>
                    {cleaningInProgress && tableContentType == "text" ? <LinearProgress sx={{ width: '100%', height: "calc(100% - 8px)", marginTop: 1, minHeight: 200, opacity: 0.1, position: 'absolute', zIndex: 1 }} /> : ""}
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        {/* Content size indicator */}
                        {isLargeContent && (
                            <Box sx={{ display: 'flex', alignItems: 'center', marginBottom: 1, padding: 1, backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: 1 }}>
                                <Typography variant="caption" sx={{ flex: 1 }}>
                                    Large content detected ({Math.round(tableContent.length / 1000)}KB). 
                                    {showFullContent ? 'Showing full content (may be slow)' : 'Showing preview for performance'}
                                </Typography>
                                <Button 
                                    size="small" 
                                    variant="outlined" 
                                    onClick={toggleFullContent}
                                    sx={{ textTransform: 'none', minWidth: 'auto' }}
                                >
                                    {showFullContent ? 'Show Preview' : 'Show Full'}
                                </Button>
                            </Box>
                        )}
                        
                        <TextField 
                            disabled={cleaningInProgress} 
                            autoFocus 
                            size="small" 
                            sx={{ 
                                marginTop: 1, 
                                flex: 1, 
                                "& .MuiInputBase-input": {
                                    fontSize: 12, 
                                    lineHeight: 1.2,
                                    // Limit height for performance
                                    maxHeight: isLargeContent && !showFullContent ? '300px' : '400px',
                                    overflow: 'auto'
                                }
                            }} 
                            id="upload content" 
                            value={displayContent} 
                            maxRows={isLargeContent && !showFullContent ? MAX_DISPLAY_LINES : 25} // Dynamic max rows
                            minRows={10} // Reduced from 15
                            onChange={handleContentChange}
                            slotProps={{
                                inputLabel: {
                                    shrink: true
                                }
                            }}
                            placeholder="paste data (csv, tsv, or json) and upload it!"
                            onPasteCapture={(e) => {
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
                            label="data content" 
                            variant="outlined" 
                            multiline 
                        />
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button variant="text" sx={{textTransform: 'none'}} size="small" onClick={()=>{ setDialogOpen(false); }}>cancel</Button>
                <Button disabled={tableContentType != "text" || tableContent.trim() == ""} variant="contained" sx={{textTransform: 'none'}} size="small" 
                    onClick={()=>{ 
                        setDialogOpen(false); 
                        handleSubmitContent(tableContent); // Always use full content for processing
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

