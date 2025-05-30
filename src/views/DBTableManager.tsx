// TableManager.tsx
import React, { useState, useEffect, FC } from 'react';
import { 
  Card, 
  CardContent, 
  Typography, 
  Button, 
  Grid,
  Box,
  IconButton,
  Paper,
  Tabs,
  Tab,
  TextField,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Alert,
  Snackbar,
  Fade,
  SxProps,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  ButtonGroup,
  Tooltip,
  MenuItem,
  Chip,
  Collapse,
  styled,
  ToggleButtonGroup,
  ToggleButton
} from '@mui/material';

import DeleteIcon from '@mui/icons-material/Delete';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloseIcon from '@mui/icons-material/Close';
import StorageIcon from '@mui/icons-material/Storage';
import SearchIcon from '@mui/icons-material/Search';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import TuneIcon from '@mui/icons-material/Tune';
import AddIcon from '@mui/icons-material/Add';
import UploadIcon from '@mui/icons-material/Upload';
import DownloadIcon from '@mui/icons-material/Download';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import PolylineIcon from '@mui/icons-material/Polyline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TableRowsIcon from '@mui/icons-material/TableRows';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import { getUrls } from '../app/utils';
import { CustomReactTable } from './ReactTable';
import { DictTable } from '../components/ComponentType';
import { Type } from '../data/types';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions, dfSelectors, getSessionId } from '../app/dfSlice';
import { alpha } from '@mui/material';
import { DataFormulatorState } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import Editor from 'react-simple-code-editor';
import Markdown from 'markdown-to-jsx';

import Prism from 'prismjs'
import 'prismjs/components/prism-javascript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import CheckIcon from '@mui/icons-material/Check';
import MuiMarkdown from 'mui-markdown';

export const handleDBDownload = async (sessionId: string) => {
    try {
        const response = await fetch(getUrls().DOWNLOAD_DB_FILE, {
            method: 'GET',
        });
        
        // Check if the response is ok
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to download database file');
        }

        // Get the blob directly from response
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        // Create a temporary link element
        const link = document.createElement('a');
        link.href = url;
        link.download = `df_${sessionId?.slice(0, 4)}.db`;
        document.body.appendChild(link);    
        
        // Trigger download
        link.click();
        
        // Clean up
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        throw error;
    }
};

interface DBTable {
    name: string;
    columns: {
        name: string;
        type: string;
    }[];
    row_count: number;
    sample_rows: any[];
    view_source: string | null;
}

interface TabPanelProps {
  children?: React.ReactNode;
  key: string;
  show: boolean;
  sx?: SxProps;
}

function TabPanel(props: TabPanelProps, sx: SxProps) {
    const { children, show, key, ...other } = props;

    return (
        <Box role="tabpanel" hidden={!show}
            id={`vertical-tabpanel-${key}`}
            aria-labelledby={`vertical-tab-${key}`}
            style={{maxWidth: '100%'}}
            sx={sx} {...other}
        >
            <Box sx={{ p: 2 }}>
                {children}
            </Box>
        </Box>
    );
}

function a11yProps(key: string) {
    return {
        id: `vertical-tab-${key}`,
        'aria-controls': `vertical-tabpanel-${key}`,
    };
}

interface ColumnStatistics {
    column: string;
    type: string;
    statistics: {
        count: number;
        unique_count: number;
        null_count: number;
        min?: number;
        max?: number;
        avg?: number;
    };
}

interface TableStatisticsViewProps {
    tableName: string;
    columnStats: ColumnStatistics[];
}

export class TableStatisticsView extends React.Component<TableStatisticsViewProps> {
    render() {
        const { tableName, columnStats } = this.props;
        
        // Common styles for header cells
        const headerCellStyle = {
            backgroundColor: '#fff',
            fontSize: 10,
            color: "#333",
            borderBottomColor: (theme: any) => theme.palette.primary.main,
            borderBottomWidth: '1px',
            borderBottomStyle: 'solid',
            padding: '6px' 
        };
        
        // Common styles for body cells
        const bodyCellStyle = { 
            fontSize: 10, 
            padding: '6px' 
        };
        
        return (
            <Box sx={{ 
                height: '310px',  // Match the table container height from CustomReactTable
                display: 'flex', 
                flexDirection: 'column' 
            }}>
                <TableContainer sx={{ 
                    flex: 1, 
                    maxHeight: '310px',  // Adjust to account for the header
                    overflow: 'auto' 
                }}>
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{...headerCellStyle, backgroundColor: "#f7f7f7", fontWeight: "bold"}}>Column</TableCell>
                                <TableCell sx={headerCellStyle}>Type</TableCell>
                                <TableCell align="right" sx={headerCellStyle}>Count</TableCell>
                                <TableCell align="right" sx={headerCellStyle}>Unique</TableCell>
                                <TableCell align="right" sx={headerCellStyle}>Null</TableCell>
                                <TableCell align="right" sx={headerCellStyle}>Min</TableCell>
                                <TableCell align="right" sx={headerCellStyle}>Max</TableCell>
                                <TableCell align="right" sx={headerCellStyle}>Avg</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {columnStats.map((stat, idx) => (
                                <TableRow 
                                    key={stat.column} 
                                    hover
                                    sx={{ }}
                                >
                                    <TableCell 
                                        component="th" 
                                        scope="row" 
                                        sx={{...bodyCellStyle, fontWeight: "bold", backgroundColor: "#f7f7f7"}}
                                    >
                                        {stat.column}
                                    </TableCell>
                                    <TableCell sx={bodyCellStyle}>
                                        {stat.type}
                                    </TableCell>
                                    <TableCell align="right" sx={bodyCellStyle}>
                                        {stat.statistics.count}
                                    </TableCell>
                                    <TableCell align="right" sx={bodyCellStyle}>
                                        {stat.statistics.unique_count}
                                    </TableCell>
                                    <TableCell align="right" sx={bodyCellStyle}>
                                        {stat.statistics.null_count}
                                    </TableCell>
                                    <TableCell align="right" sx={bodyCellStyle}>
                                        {stat.statistics.min !== undefined ? stat.statistics.min : '-'}
                                    </TableCell>
                                    <TableCell align="right" sx={bodyCellStyle}>
                                        {stat.statistics.max !== undefined ? stat.statistics.max : '-'}
                                    </TableCell>
                                    <TableCell align="right" sx={bodyCellStyle}>
                                        {stat.statistics.avg !== undefined ? 
                                            Number(stat.statistics.avg).toFixed(2) : '-'}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Box>
        );
    }
}

export const DBTableManager: React.FC = () => {
    return (
        <DBTableSelectionDialog buttonElement={<Button>DB Tables</Button>} />
    );
}

export const DBTableSelectionDialog: React.FC<{ buttonElement: any }> = function DBTableSelectionDialog({ buttonElement }) {
    
    const dispatch = useDispatch<AppDispatch>();
    const sessionId = useSelector((state: DataFormulatorState) => state.sessionId);

    const [tableDialogOpen, setTableDialogOpen] = useState<boolean>(false);
    const [tableAnalysisMap, setTableAnalysisMap] = useState<Record<string, ColumnStatistics[] | null>>({});
    
    // maps data loader type to list of param defs
    const [dataLoaderMetadata, setDataLoaderMetadata] = useState<Record<string, {
        params: {name: string, default: string, type: string, required: boolean, description: string}[], 
        auth_instructions: string}>>({});

    const [dbTables, setDbTables] = useState<DBTable[]>([]);
    const [selectedTabKey, setSelectedTabKey] = useState("");

    const [errorMessage, setErrorMessage] = useState<{content: string, severity: "error" | "warning" | "info" | "success"} | null>(null);
    const [showError, setShowError] = useState(false);
    const [isUploading, setIsUploading] = useState<boolean>(false);

    useEffect(() => {
        fetchTables();
        fetchDataLoaders();
    }, []);

    useEffect(() => {
        if (errorMessage?.content?.includes("session_id not found")) {
            dispatch(getSessionId());
        }
    }, [errorMessage])

    useEffect(() => {
        if (!selectedTabKey.startsWith("dataLoader:") && dbTables.length == 0) {
            setSelectedTabKey("");
        } else if (!selectedTabKey.startsWith("dataLoader:") && dbTables.find(t => t.name === selectedTabKey) == undefined) {
            setSelectedTabKey(dbTables[0].name);
        }
    }, [dbTables]);

    // Fetch list of tables
    const fetchTables = async () => {
        try {
            const response = await fetch(getUrls().LIST_TABLES);
            const data = await response.json();
            if (data.status === 'success') {
                setDbTables(data.tables);
            }
        } catch (error) {
            setErrorMessage({content: 'Failed to fetch tables, please check if the server is running', severity: "error"});
            setShowError(true);
        }
    };

    const fetchDataLoaders = async () => {
        fetch(getUrls().DATA_LOADER_LIST_DATA_LOADERS, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === "success") {
                setDataLoaderMetadata(data.data_loaders);
            } else {
                console.error('Failed to fetch data loader params:', data.error);
            }
        })
        .catch(error => {
            console.error('Failed to fetch data loader params:', error);
        });
    }

    const handleDBUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
    
        const formData = new FormData();
        formData.append('file', file);
        formData.append('table_name', file.name.split('.')[0]);
    
        try {
            setIsUploading(true);
            const response = await fetch(getUrls().UPLOAD_DB_FILE, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.status === 'success') {
                fetchTables();  // Refresh table list
            } else {
                // Handle error from server
                setErrorMessage(data.error || 'Failed to upload table');
                setShowError(true);
            }
        } catch (error) {
            console.error('Failed to upload table:', error);
            setErrorMessage({content: 'Failed to upload table, please check if the server is running', severity: "error"});
            setShowError(true);
        } finally {
            setIsUploading(false);
        }
    };

    const handleDBFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
    
        const formData = new FormData();
        formData.append('file', file);
        formData.append('table_name', file.name.split('.')[0]);
    
        try {
            setIsUploading(true);
            const response = await fetch(getUrls().CREATE_TABLE, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.status === 'success') {
                if (data.is_renamed) {
                    setErrorMessage({content: `Table ${data.original_name} already exists. Renamed to ${data.table_name}`, severity: "warning"});
                    setShowError(true);
                } 
                fetchTables();  // Refresh table list
            } else {
                setErrorMessage({content: data.error || 'Failed to upload table', severity: "error"});
                setShowError(true);
            }
        } catch (error) {
            console.error('Failed to upload table:', error);
            setErrorMessage({content: 'Failed to upload table, please check if the server is running', severity: "error"});
            setShowError(true);
        } finally {
            setIsUploading(false);
            // Clear the file input value to allow uploading the same file again
            if (event.target) {
                event.target.value = '';
            }
        }
    };

    const handleDBReset = async () => {
        try {
            const response = await fetch(getUrls().RESET_DB_FILE, {
                method: 'POST',
            });
            const data = await response.json();
            if (data.status === 'success') {
                fetchTables();
            } else {
                setErrorMessage(data.error || 'Failed to reset database');
                setShowError(true);
            }
        } catch (error) {
            console.error('Failed to reset database:', error);
            setErrorMessage({content: 'Failed to reset database', severity: "error"});
            setShowError(true);
        }
    }

    // Delete table
    const handleDropTable = async (tableName: string) => {
        if (!confirm(`Are you sure you want to delete ${tableName}?`)) return;

        try {
            const response = await fetch(getUrls().DELETE_TABLE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ table_name: tableName })
            });
            const data = await response.json();
            if (data.status === 'success') {
                fetchTables();
                setSelectedTabKey(dbTables.length > 0 ? dbTables[0].name : "");
            } else {
                setErrorMessage({content: data.error || 'Failed to delete table', severity: "error"});
                setShowError(true);
            }
        } catch (error) {
            setErrorMessage({content: 'Failed to delete table, please check if the server is running', severity: "error"});
            setShowError(true);
        }
    };

    // Handle data analysis
    const handleAnalyzeData = async (tableName: string) => {
        if (!tableName) return;
        if (tableAnalysisMap[tableName]) return;

        console.log('Analyzing table:', tableName);
        
        try {
            const response = await fetch(getUrls().GET_COLUMN_STATS, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ table_name: tableName })
            });
            const data = await response.json();
            if (data.status === 'success') {
                console.log('Analysis results:', data);
                // Update the analysis map with the new results
                setTableAnalysisMap(prevMap => ({
                    ...prevMap,
                    [tableName]: data
                }));
            }
        } catch (error) {
            console.error('Failed to analyze table data:', error);
            setErrorMessage({content: 'Failed to analyze table data, please check if the server is running', severity: "error"});
            setShowError(true);
        }
    };

    // Toggle analysis view
    const toggleAnalysisView = (tableName: string) => {
        if (tableAnalysisMap[tableName]) {
            // If we already have analysis, remove it to show table data again
            setTableAnalysisMap(prevMap => {
                const newMap = { ...prevMap };
                delete newMap[tableName];
                return newMap;
            });
        } else {
            // If no analysis yet, fetch it
            handleAnalyzeData(tableName);
        }
    };

    const handleAddTableToDF = (dbTable: DBTable) => {
        const convertSqlTypeToAppType = (sqlType: string): Type => {
            // Convert SQL types to application types
            sqlType = sqlType.toUpperCase();
            if (sqlType.includes('INT') || sqlType === 'BIGINT' || sqlType === 'SMALLINT' || sqlType === 'TINYINT') {
                return Type.Integer;
            } else if (sqlType.includes('FLOAT') || sqlType.includes('DOUBLE') || sqlType.includes('DECIMAL') || sqlType.includes('NUMERIC') || sqlType.includes('REAL')) {
                return Type.Number;
            } else if (sqlType.includes('BOOL')) {
                return Type.Boolean;
            } else if (sqlType.includes('DATE') || sqlType.includes('TIME') || sqlType.includes('TIMESTAMP')) {
                return Type.Date;
            } else {
                return Type.String;
            }
        };

        let table: DictTable = {
            id: dbTable.name,
            displayId: dbTable.name,
            names: dbTable.columns.map((col: any) => col.name),
            types: dbTable.columns.map((col: any) => convertSqlTypeToAppType(col.type)),
            rows: dbTable.sample_rows,
            virtual: {
                tableId: dbTable.name,
                rowCount: dbTable.row_count,
            },
            anchored: true, // by default, db tables are anchored
        }
       dispatch(dfActions.loadTable(table));
       dispatch(fetchFieldSemanticType(table));
       setTableDialogOpen(false);
    }

    const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
        setSelectedTabKey(newValue);
    };

    const handleCloseError = () => {
        setShowError(false);
    };

    useEffect(() => {
        if (tableDialogOpen) {
            fetchTables();
        }
    }, [tableDialogOpen]);

    let importButton = (buttonElement: React.ReactNode) => {
        return <Tooltip title="import a duckdb .db file to the local database">
            <Button variant="text" sx={{fontSize: "inherit", minWidth: "auto"}} component="label" disabled={isUploading}>
                {buttonElement}
                <input type="file" hidden onChange={handleDBUpload} accept=".db" disabled={isUploading} />
            </Button>
        </Tooltip>
    }

    let exportButton = 
        <Tooltip title="save the local database to a duckdb .db file">
            <Button variant="text" size="small" onClick={() => {
                handleDBDownload(sessionId ?? '')
                    .catch(error => {
                        console.error('Failed to download database:', error);
                        setErrorMessage({content: 'Failed to download database file', severity: "error"});
                        setShowError(true);
                    });
            }} disabled={isUploading || dbTables.length === 0}>
                export
            </Button>
        </Tooltip>

    function uploadFileButton(element: React.ReactNode, buttonSx?: SxProps) {
        return (
            <Tooltip title="upload a csv/tsv file to the local database">
                <Button
                    variant="text"
                    component="label"
                    sx={{ fontSize: "inherit", ...buttonSx}}                    
                    disabled={isUploading}
                >
                    {element}
                    <input
                        type="file"
                        hidden
                        onChange={handleDBFileUpload}
                        accept=".csv,.xlsx,.json"
                        disabled={isUploading}
                    />
                </Button>
            </Tooltip>
        );
    }

    let mainContent =  
        <Box sx={{flexGrow: 1, bgcolor: 'background.paper', display: 'flex', flexDirection: 'row', minHeight: 400 }}>
            <Box sx={{display: "flex", flexDirection: "column", width: "180px", borderRight: 1, borderColor: 'divider'}}>
                <Tabs
                    value={0} // not used, just to keep MUI happy
                    orientation="vertical"
                    variant="scrollable"
                    scrollButtons={dbTables.length > 8 ? "auto" : false}
                    allowScrollButtonsMobile
                    aria-label="Database tables"
                    sx={{ 
                        maxHeight: '360px',
                        px: 0.5,
                        pt: 1,
                        '& .MuiTabs-scrollButtons.Mui-disabled': {
                            opacity: 0.3,
                        },
                    }}
                >
                    <Typography variant="caption" sx={{color: "text.secondary", fontWeight: "bold", px: 1 }}>
                        available tables
                        <Tooltip title="refresh the table list">
                            <IconButton size="small" color="primary" sx={{
                                '&:hover': {
                                    transform: 'rotate(180deg)',
                                },
                                transition: 'transform 0.3s ease-in-out',
                            }} onClick={() => {
                                fetchTables();
                            }}>
                                <RefreshIcon sx={{fontSize: 14}} />
                            </IconButton>
                        </Tooltip>
                    </Typography>
                    {dbTables.length == 0 && 
                        <Typography variant="caption" sx={{color: "lightgray", px: 2, py: 0.5, fontStyle: "italic"}}>no tables available</Typography>}
                    {dbTables.map((t, i) => (
                        <Tab 
                            key={t.name} 
                            value={t.name}
                            wrapped 
                            label={
                                <Typography variant="caption" 
                                    sx={{textTransform: "none", width: "calc(100% - 4px)", textAlign: 'left', 
                                         textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap'}}>
                                    <Typography variant="caption" sx={{fontSize: 12}}>{t.name}</Typography>
                                </Typography>
                            } 
                            onClick={() => {
                                setSelectedTabKey(t.name);
                            }}
                            sx={{textTransform: "none", minHeight: 24, p: 0.5, ml: 2}}
                            {...a11yProps(t.name)} 
                        />
                    ))}
                </Tabs>
                <Divider sx={{my: 1}} />
                <Tabs
                    orientation="vertical"
                    textColor="secondary"
                    indicatorColor="secondary"
                    value={0} // not used, just to keep MUI happy
                    sx={{px: 0.5}}
                >
                    <Typography variant="caption" sx={{color: "text.secondary", fontWeight: "bold", px: 1}}>
                        connect external data
                        <Tooltip title="refresh the data loader list">
                            <IconButton size="small" color="primary" sx={{
                                '&:hover': {
                                    transform: 'rotate(180deg)',
                                },
                                transition: 'transform 0.3s ease-in-out',
                            }} onClick={() => {
                                fetchDataLoaders();
                            }}>
                                <RefreshIcon sx={{fontSize: 14}} />
                            </IconButton>
                        </Tooltip>
                    </Typography>
                    {["file upload", ...Object.keys(dataLoaderMetadata ?? {})].map((dataLoaderType, i) => (
                        <Tab 
                            key={`dataLoader:${dataLoaderType}`} 
                            wrapped 
                            label={<Typography variant="caption" 
                                        sx={{textTransform: "none", width: "calc(100% - 4px)", textAlign: 'left', 
                                            textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap'}}>
                                    {dataLoaderType}</Typography>} 
                            onClick={() => {
                                setSelectedTabKey('dataLoader:' + dataLoaderType);
                            }}
                            sx={{textTransform: "none", minHeight: 24, p: 0.5, ml: 2}}
                            {...a11yProps(dataLoaderType)} 
                        />
                    ))}
                </Tabs> 
            </Box>
            <TabPanel key={`dataLoader:note`} sx={{width: 960, }} show={selectedTabKey === ''}>
                <Typography variant="caption" sx={{color: "text.secondary",  px: 1}}>The database is empty, refresh the table list or import some data to get started.</Typography>
            </TabPanel>
            <TabPanel key={`dataLoader:file upload`} sx={{width: 960, }} show={selectedTabKey === 'dataLoader:file upload'}>
                {uploadFileButton(<Typography component="span" fontSize={18} textTransform="none">{isUploading ? 'uploading...' : 'upload a csv/tsv file to the local database'}</Typography>)} 
            </TabPanel>
            {dataLoaderMetadata && Object.entries(dataLoaderMetadata).map(([dataLoaderType, metadata]) => (
                <TabPanel key={`dataLoader:${dataLoaderType}`} sx={{width: 960, position: "relative", maxWidth: '100%'}} 
                    show={selectedTabKey === 'dataLoader:' + dataLoaderType}>
                    <DataLoaderForm 
                        key={`data-loader-form-${dataLoaderType}`}
                        dataLoaderType={dataLoaderType} 
                        paramDefs={metadata.params}
                        authInstructions={metadata.auth_instructions}
                        onImport={() => {
                            setIsUploading(true);
                        }} 
                        onFinish={(status, message) => {
                            setIsUploading(false);
                            fetchTables();
                            if (status === "error") {
                                setErrorMessage({content: message, severity: "error"});
                                setShowError(true);
                            }
                        }} 
                    />
                </TabPanel>
            ))}
            {dbTables.map((t, i) => {
                const currentTable = t;
                const showingAnalysis = tableAnalysisMap[currentTable.name] !== undefined;
                return (
                    <TabPanel key={t.name} sx={{width: 960, maxWidth: '100%'}} show={selectedTabKey === t.name}>
                        <Paper variant="outlined" sx={{width: "100%"}}>
                            <Box sx={{ px: 1, display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                <Typography variant="caption" sx={{  }}>
                                    {showingAnalysis ? "column stats for " : "sample data from "} 
                                    <Typography component="span" sx={{fontSize: 12, fontWeight: "bold"}}>
                                        {currentTable.name}
                                    </Typography>
                                    <Typography component="span" sx={{ml: 1, fontSize: 10, color: "text.secondary"}}>
                                        ({currentTable.columns.length} columns × {currentTable.row_count} rows)
                                    </Typography>
                                </Typography>
                                <Box sx={{ marginLeft: 'auto', display: 'flex', gap: 1 }}>
                                    <Button 
                                        size="small"
                                        color={showingAnalysis ? "secondary" : "primary"}
                                        onClick={() => toggleAnalysisView(currentTable.name)}
                                        startIcon={<AnalyticsIcon fontSize="small" />}
                                        sx={{textTransform: "none"}}
                                    >
                                        {showingAnalysis ? "show data samples" : "show column stats"}
                                    </Button>
                                    <IconButton 
                                        size="small" 
                                        color="error"
                                        onClick={() => handleDropTable(currentTable.name)}
                                        title="Drop Table"
                                    >
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            </Box>
                            {showingAnalysis ? (
                                <TableStatisticsView 
                                    tableName={currentTable.name}
                                    columnStats={tableAnalysisMap[currentTable.name] ?? []}
                                />
                            ) : (
                                <CustomReactTable 
                                    rows={currentTable.sample_rows.map((row: any) => {
                                        return Object.fromEntries(Object.entries(row).map(([key, value]: [string, any]) => {
                                            return [key, String(value)];
                                        }));
                                    }).slice(0, 9)} 
                                    columnDefs={currentTable.columns.map(col => ({
                                        id: col.name,
                                        label: col.name,
                                        minWidth: 60
                                    }))}
                                    rowsPerPageNum={-1}
                                    compact={false}
                                    isIncompleteTable={currentTable.row_count > 10}
                                />
                            )}
                        </Paper>
                    </TabPanel>
                );
            })}
        </Box>  

    return (
        <>
            <Button sx={{fontSize: "inherit"}} onClick={() => {
                setTableDialogOpen(true);
            }}>
                {buttonElement}
            </Button>
            
            {/* Error Snackbar */}
            <Snackbar 
                open={showError} 
                autoHideDuration={6000} 
                onClose={handleCloseError}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert onClose={handleCloseError} severity={errorMessage?.severity} sx={{ width: '100%' }}>
                    {errorMessage?.content}
                </Alert>
            </Snackbar>
            <Dialog 
                key="db-table-selection-dialog" 
                onClose={() => {setTableDialogOpen(false)}} 
                open={tableDialogOpen}
                sx={{ '& .MuiDialog-paper': { maxWidth: '100%', maxHeight: 800, minWidth: 800 } }}
            >
                <DialogTitle sx={{display: "flex"}}>
                    Database
                    <IconButton
                        sx={{marginLeft: "auto"}}
                        edge="start"
                        size="small"
                        color="inherit"
                        aria-label="close"
                        onClick={() => setTableDialogOpen(false)}
                    >
                        <CloseIcon fontSize="inherit"/>
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{overflowX: "hidden", padding: 0, width: "100%", position: "relative"}} dividers>
                    {mainContent}
                    {isUploading && (
                        <Box sx={{ 
                            position: 'absolute', 
                            top: 0, 
                            left: 0, 
                            width: '100%', 
                            height: '100%', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.7)',
                            zIndex: 1000
                        }}>
                            <CircularProgress size={60} thickness={5} />
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Typography variant="caption" sx={{ mr: 'auto', '& .MuiButton-root': { minWidth: 'auto',  textTransform: "none" } }}>
                        {importButton(<Typography component="span" fontSize="inherit">Import</Typography>)}
                        ,
                        {exportButton}
                        or
                        <Button
                            variant="text" size="small"
                            color="warning"
                            onClick={handleDBReset}
                            disabled={isUploading}
                            //endIcon={<RestartAltIcon />}
                        >
                            reset
                        </Button>
                        the backend database
                    </Typography>
                    <Button 
                        variant="contained"
                        size="small"
                        disabled={isUploading || dbTables.length === 0 || dbTables.find(t => t.name === selectedTabKey) === undefined}
                        onClick={() => {
                            let t = dbTables.find(t => t.name === selectedTabKey);
                            if (t) {
                                handleAddTableToDF(t);
                                setTableDialogOpen(false);
                            }
                        }}>
                        Load Table
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}

export const DataLoaderForm: React.FC<{
    dataLoaderType: string, 
    paramDefs: {name: string, default: string, type: string, required: boolean, description: string}[],
    authInstructions: string,
    onImport: () => void,
    onFinish: (status: "success" | "error", message: string) => void
}> = ({dataLoaderType, paramDefs, authInstructions, onImport, onFinish}) => {

    const dispatch = useDispatch();

    const params = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[dataLoaderType] ?? {});

    const [tableMetadata, setTableMetadata] = useState<Record<string, any>>({});
    let [displaySamples, setDisplaySamples] = useState<Record<string, boolean>>({});

    const [displayAuthInstructions, setDisplayAuthInstructions] = useState(false);

    let [isConnecting, setIsConnecting] = useState(false);
    let [mode, setMode] = useState<"view tables" | "query">("view tables");
    const toggleDisplaySamples = (tableName: string) => {
        setDisplaySamples({...displaySamples, [tableName]: !displaySamples[tableName]});
    }

    const handleModeChange = (event: React.MouseEvent<HTMLElement>, newMode: "view tables" | "query") => {
        if (newMode != null) {
            setMode(newMode);
        }
    };

    let tableMetadataBox = [
        <Box sx={{my: 2}}>
            <ToggleButtonGroup
                color="primary"
                value={mode}
                exclusive
                size="small"
                onChange={handleModeChange}
                aria-label="Platform"
                sx={{
                    '& .MuiButtonBase-root': {
                    lineHeight: 1,
                    color: "text.primary",
                    textTransform: 'none',
                    '&.Mui-selected': {
                        fontWeight: 'bold',
                    }
                }}}
            >
                <ToggleButton value="view tables">View Tables</ToggleButton>
                <ToggleButton value="query">Query Data</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="body2" sx={{mb: 1,}}></Typography>
        </Box>,
        mode === "view tables" && <TableContainer component={Paper} sx={{maxHeight: 400, overflowY: "auto"}} >
            <Table sx={{ minWidth: 650 }} size="small" aria-label="simple table">
            <TableBody>
                {Object.entries(tableMetadata).map(([tableName, metadata]) => {
                    return [
                    <TableRow
                        key={tableName}
                        sx={{ '&:last-child td, &:last-child th': { border: 0 }, '& .MuiTableCell-root': { padding: 0.25, wordWrap: 'break-word', whiteSpace: 'normal' }}}
                    >
                        <TableCell sx={{borderBottom: displaySamples[tableName] ? 'none' : '1px solid rgba(0, 0, 0, 0.1)'}}>
                            <IconButton size="small" onClick={() => toggleDisplaySamples(tableName)}>
                                {displaySamples[tableName] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </IconButton>
                        </TableCell>
                        <TableCell sx={{maxWidth: 240, borderBottom: displaySamples[tableName] ? 'none' : '1px solid rgba(0, 0, 0, 0.1)'}} component="th" scope="row">
                            {tableName} <Typography variant="caption" sx={{color: "text.secondary"}} fontSize={10}>
                                ({metadata.row_count > 0 ? `${metadata.row_count} rows × ` : ""}{metadata.columns.length} cols)
                            </Typography>
                        </TableCell>
                        <TableCell sx={{maxWidth: 500}}>
                            {metadata.columns.map((column: any) => (
                                <Chip key={column.name} label={column.name} sx={{fontSize: 11, margin: 0.25, height: 20}} size="small" />
                            ))}
                        </TableCell>
                        <TableCell sx={{width: 60}}>
                            <Button size="small" onClick={() => {
                                onImport();
                                fetch(getUrls().DATA_LOADER_INGEST_DATA, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({
                                        data_loader_type: dataLoaderType, 
                                        data_loader_params: params, table_name: tableName
                                    })
                                })
                                .then(response => response.json())
                                .then(data => {
                                    
                                    if (data.status === "success") {
                                        onFinish("success", "Data ingested successfully");
                                    } else {
                                        onFinish("error", data.error);
                                    }
                                })
                                .catch(error => {
                                    console.error('Failed to ingest data:', error);
                                    onFinish("error", `Failed to ingest data: ${error}`);
                                });
                            }}>Import</Button>
                        </TableCell>
                    </TableRow>,
                    <TableRow >
                        <TableCell sx={{ paddingBottom: 0, paddingTop: 0, px: 0, maxWidth: 800, overflowX: "auto", borderBottom: displaySamples[tableName] ? '1px solid rgba(0, 0, 0, 0.1)' : 'none' }} colSpan={4}>
                        <Collapse in={displaySamples[tableName]} timeout="auto" unmountOnExit>
                            <Box sx={{ px: 1, py: 0.5}}>
                                <CustomReactTable rows={metadata.sample_rows.slice(0, 9).map((row: any) => {
                                    return Object.fromEntries(Object.entries(row).map(([key, value]: [string, any]) => {
                                        return [key, String(value)];
                                    }));
                                })} 
                                columnDefs={metadata.columns.map((column: any) => ({id: column.name, label: column.name}))} 
                                rowsPerPageNum={-1} 
                                compact={false} 
                                isIncompleteTable={metadata.row_count > 10}
                                />
                            </Box>
                        </Collapse>
                        </TableCell>
                    </TableRow>]
                })}
                </TableBody>
                </Table>
            </TableContainer>,
        mode === "query" && <DataQueryForm 
            dataLoaderType={dataLoaderType} 
            availableTables={Object.keys(tableMetadata).map(t => ({name: t, fields: tableMetadata[t].columns.map((c: any) => c.name)}))} 
            dataLoaderParams={params} onImport={onImport} onFinish={onFinish} />
    ]

    return (
        <Box sx={{p: 0}}>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.7)"
            }}>
                <CircularProgress size={20} />
            </Box>}
            <Typography variant="body2" sx={{}}>
                Data Connector (<Typography component="span" sx={{color: "secondary.main", fontWeight: "bold"}}>{dataLoaderType}</Typography>)
            </Typography>
            <Box sx={{display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 1, ml: 4, mt: 2}}>
                {paramDefs.map((paramDef) => (
                    <Box key={paramDef.name}>
                        <TextField
                            disabled={Object.keys(tableMetadata).length > 0}
                            sx={{width: "270px", 
                                '& .MuiInputLabel-root': {fontSize: 14},
                                '& .MuiInputBase-root': {fontSize: 14},
                                '& .MuiInputBase-input::placeholder': {fontSize: 12, fontStyle: "italic"}
                            }}
                            variant="standard"
                            size="small"
                            required={paramDef.required}
                            key={paramDef.name}
                            label={paramDef.name}
                            value={params[paramDef.name]}
                            placeholder={paramDef.description}
                            onChange={(event) => { 
                                dispatch(dfActions.updateDataLoaderConnectParam({
                                    dataLoaderType, paramName: paramDef.name, 
                                    paramValue: event.target.value}));
                            }}
                            slotProps={{
                                inputLabel: {shrink: true}
                            }}
                        />
                    </Box>
                ))}
                {paramDefs.length > 0 && <ButtonGroup sx={{height: 32, mt: 'auto'}} size="small" 
                 variant="contained" color="primary">
                    <Button 
                        sx={{textTransform: "none"}}
                        onClick={() => {
                            setIsConnecting(true);
                            setDisplayAuthInstructions(false);
                            fetch(getUrls().DATA_LOADER_LIST_TABLES, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    data_loader_type: dataLoaderType, 
                                    data_loader_params: params
                                })
                        }).then(response => response.json())
                        .then(data => {
                            if (data.status === "success") {
                                console.log(data.tables);
                                setTableMetadata(Object.fromEntries(data.tables.map((table: any) => {
                                    return [table.name, table.metadata];
                                })));
                            } else {
                                console.error('Failed to fetch data loader tables: {}', data.message);
                                onFinish("error", `Failed to fetch data loader tables: ${data.message}`);
                            }
                            setIsConnecting(false);
                        })
                        .catch(error => {
                            onFinish("error", `Failed to fetch data loader tables, please check the server is running`);
                            setIsConnecting(false);
                        });
                    }}>
                        {Object.keys(tableMetadata).length > 0 ? "refresh" : "connect"}
                    </Button>
                    <Button 
                        disabled={Object.keys(tableMetadata).length === 0}
                        sx={{textTransform: "none"}}
                        onClick={() => {
                            setTableMetadata({});
                        }}>
                        disconnect
                    </Button>
                </ButtonGroup>
                }
                
            </Box>
            <Button 
                variant="text" 
                size="small" 
                sx={{textTransform: "none", height: 32, mt: 1}}
                onClick={() => setDisplayAuthInstructions(!displayAuthInstructions)}>
                {displayAuthInstructions ? "hide" : "show"} authentication instructions
            </Button>
            {<Collapse in={displayAuthInstructions} timeout="auto" unmountOnExit>
                <Paper sx={{px: 1, py: 0.5}}>
                    <Typography variant="body2" sx={{color: "text.secondary", fontSize: 12, whiteSpace: "pre-wrap", p: 1}}>
                        {authInstructions.trim()}
                    </Typography>
                </Paper>
                </Collapse>
            }
            
            {Object.keys(tableMetadata).length > 0 && tableMetadataBox }
        </Box>
    );
}

export const DataQueryForm: React.FC<{
    dataLoaderType: string,
    availableTables: {name: string, fields: string[]}[],
    dataLoaderParams: Record<string, string>,
    onImport: () => void,
    onFinish: (status: "success" | "error", message: string) => void
}> = ({dataLoaderType, availableTables, dataLoaderParams, onImport, onFinish}) => {

    let activeModel = useSelector(dfSelectors.getActiveModel);

    const [selectedTables, setSelectedTables] = useState<string[]>(availableTables.map(t => t.name).slice(0, 5));

    const [waiting, setWaiting] = useState(false);

    const [query, setQuery] = useState("-- query the data source / describe your goal and ask AI to help you write the query\n");
    const [queryResult, setQueryResult] = useState<{
        status: string,
        message: string,
        sample: any[],
        code: string,
    } | undefined>(undefined);
    const [queryResultName, setQueryResultName] = useState("");
    
    const aiCompleteQuery = (query: string) => {
        if (queryResult?.status === "error") {
            setQueryResult(undefined);
        }
        let data = {
            data_source_metadata: {
                data_loader_type: dataLoaderType,
                tables: availableTables.filter(t => selectedTables.includes(t.name))
            },
            query: query,
            model: activeModel
        }
        setWaiting(true);
        fetch(getUrls().QUERY_COMPLETION, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(data => {
            setWaiting(false);
            if (data.status === "ok") {
                setQuery(data.query);
            } else {
                onFinish("error", data.reasoning);
            }
        })
        .catch(error => {
            setWaiting(false);
            onFinish("error", `Failed to complete query please try again.`);
        });
    }

    const handleViewQuerySample = (query: string) => {
        setQueryResult(undefined);
        setWaiting(true);
        fetch(getUrls().DATA_LOADER_VIEW_QUERY_SAMPLE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                data_loader_type: dataLoaderType,
                data_loader_params: dataLoaderParams,
                query: query
            })
        })
        .then(response => response.json())
        .then(data => {
            setWaiting(false);
            if (data.status === "success") {
                setQueryResult({
                    status: "success",
                    message: "Data loaded successfully",
                    sample: data.sample,
                    code: query
                });
                let newName = `r_${Math.random().toString(36).substring(2, 4)}`;
                setQueryResultName(newName);
            } else {
                setQueryResult({
                    status: "error",
                    message: data.message,
                    sample: [],
                    code: query
                });
            }
        })
        .catch(error => {
            setWaiting(false);
            setQueryResult({
                status: "error",
                message: `Failed to view query sample, please try again.`,
                sample: [],
                code: query
            });
        });
    }

    const handleImportQueryResult = () => {
        setWaiting(true);
        fetch(getUrls().DATA_LOADER_INGEST_DATA_FROM_QUERY, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                data_loader_type: dataLoaderType,
                data_loader_params: dataLoaderParams,
                query: queryResult?.code ?? query,
                name_as: queryResultName
            })
        })
        .then(response => response.json())
        .then(data => {
            setWaiting(false);
            if (data.status === "success") {
                onFinish("success", "Data imported successfully");
            } else {
                onFinish("error", data.reasoning);
            }
        })
        .catch(error => {
            setWaiting(false);
            onFinish("error", `Failed to import data, please try again.`);
        });
    }

    let queryResultBox = queryResult?.status === "success" ? [
         <Box sx={{display: "flex", flexDirection: "row", gap: 1, justifyContent: "space-between"}}>
            <CustomReactTable rows={queryResult.sample} columnDefs={Object.keys(queryResult.sample[0]).map((t: any) => ({id: t, label: t}))} rowsPerPageNum={-1} compact={false} />
        </Box>,
        <Box sx={{display: "flex", flexDirection: "row", gap: 1, alignItems: "center"}}>
            <Button variant="outlined" color="primary" size="small" sx={{textTransform: "none", minWidth: 120, mr: 'auto'}}
                onClick={() => {
                    setQueryResult(undefined);
                    setQueryResultName("");
                }}>
                clear result
            </Button>
            <TextField
                size="small"
                label="import as"
                sx={{width: 120, ml: 'auto', '& .MuiInputBase-root': {fontSize: 12, height: 32}, 
                     '& .MuiInputLabel-root': {fontSize: 12, transform: "translate(14px, -6px) scale(0.75)"}}}
                slotProps={{
                    inputLabel: {shrink: true}
                }}
                value={queryResultName}
                onChange={(event) => setQueryResultName(event.target.value)}
            />
            <Button variant="contained" color="primary" size="small" disabled={queryResultName === ""} sx={{textTransform: "none", width: 120}}
                onClick={() => handleImportQueryResult()}>
            import data
            </Button> 
        </Box>
    ] : [];
    
    return (
        <Paper sx={{display: "flex", flexDirection: "column", gap: 1, p: 1, position: "relative"}}>
            {waiting && <Box sx={{position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.7)"}}>
                <CircularProgress size={20} />
            </Box>}
            <Typography variant="body2" sx={{color: "text.secondary"}}>
                <Typography variant="caption" sx={{color: "text.primary", fontSize: 11, mx: 0.5}}>
                    query from tables:
                </Typography>
                {availableTables.map((table) => (
                    <Chip key={table.name} label={table.name} //icon={selectedTables.includes(table.name) ? <CheckIcon /> : undefined}
                        color={selectedTables.includes(table.name) ? "primary" : "default"} variant="outlined" 
                        sx={{ fontSize: 11, margin: 0.25, 
                            height: 20, borderRadius: 0.5, 
                            borderColor: selectedTables.includes(table.name) ? "primary.main" : "rgba(0, 0, 0, 0.1)",
                            color: selectedTables.includes(table.name) ? "primary.main" : "text.secondary",
                            '&:hover': {
                                backgroundColor: "rgba(0, 0, 0, 0.07)",
                            }
                        }}
                        size="small" 
                        onClick={() => {
                            setSelectedTables(selectedTables.includes(table.name) ? selectedTables.filter(t => t !== table.name) : [...selectedTables, table.name]);
                        }}
                    />
                ))}
            </Typography>
            <Box sx={{display: "flex", flexDirection: "column", gap: 1, }}>
                <Box sx={{maxHeight: 300, overflowY: "auto"}}>
                    <Editor
                        value={query}
                        onValueChange={(tempCode: string) => {
                            setQuery(tempCode);
                        }}
                        highlight={code => Prism.highlight(code, Prism.languages.sql, 'sql')}
                        padding={10}
                        style={{
                            minHeight: queryResult ? 60 : 200,
                            fontFamily: '"Fira code", "Fira Mono", monospace',
                            fontSize: 12,
                            paddingBottom: '24px',
                            backgroundColor: "rgba(0, 0, 0, 0.03)",
                            
                            overflowY: "auto"
                        }}
                    />
                </Box>
                {queryResult?.status === "error" && <Box sx={{display: "flex", flexDirection: "row", gap: 1, alignItems: "center"}}>
                        <Typography variant="body2" sx={{color: "text.secondary", fontSize: 11, backgroundColor: "rgba(255, 0, 0, 0.1)", p: 0.5, borderRadius: 0.5}}>
                            {queryResult?.message} 
                        </Typography>
                        <Button variant="outlined" color="primary" size="small" sx={{textTransform: "none", height: 24, ml: 1, minWidth: 120}} 
                            startIcon={<PrecisionManufacturingIcon />} onClick={() => aiCompleteQuery(queryResult.code + "\n error:" + queryResult.message)}>
                            help me fix it
                        </Button>
                    </Box>}
                <Box sx={{display: "flex", flexDirection: "row", gap: 1, justifyContent: "space-between"}}>
                    <Button variant="outlined" color="primary" size="small" sx={{textTransform: "none"}} disabled={queryResult?.status === "error"}
                        startIcon={<PrecisionManufacturingIcon />} onClick={() => aiCompleteQuery(query)}>
                        help me complete the query from selected tables
                    </Button>
                    <Button variant="contained" color="primary" size="small" sx={{textTransform: "none", width: 80}}
                        onClick={() => handleViewQuerySample(query)}>
                        run query
                    </Button>
                </Box>
                {queryResult && queryResultBox}
            </Box>
        </Paper>
    )
}