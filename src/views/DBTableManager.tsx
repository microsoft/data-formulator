// TableManager.tsx
import React, { useState, useEffect } from 'react';
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
  Tooltip
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

import { getUrls } from '../app/utils';
import { CustomReactTable } from './ReactTable';
import { DictTable } from '../components/ComponentType';
import { Type } from '../data/types';
import { useDispatch } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { alpha } from '@mui/material';

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
  index: number;
  value: number;
  sx?: SxProps;
}

function TabPanel(props: TabPanelProps, sx: SxProps) {
    const { children, value, index, ...other } = props;

    return (
        <Box role="tabpanel" hidden={value !== index}
            id={`vertical-tabpanel-${index}`}
            aria-labelledby={`vertical-tab-${index}`}
            style={{maxWidth: '100%'}}
            sx={sx} {...other}
        >
            {value === index && (
                <Box sx={{ p: 2 }}>
                    {children}
                </Box>
            )}
        </Box>
    );
}

function a11yProps(index: number) {
    return {
        id: `vertical-tab-${index}`,
        'aria-controls': `vertical-tabpanel-${index}`,
    };
}

interface TableStatistics {
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
    tableAnalysisMap: Record<string, AnalysisResults | null>;
}

export class TableStatisticsView extends React.Component<TableStatisticsViewProps> {
    render() {
        const { tableName, tableAnalysisMap } = this.props;
        
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
                            {tableAnalysisMap[tableName]?.statistics.map((stat, idx) => (
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

interface AnalysisResults {
    table_name: string;
    statistics: TableStatistics[];
}

export const DBTableManager: React.FC = () => {
    return (
        <DBTableSelectionDialog buttonElement={<Button>DB Tables</Button>} />
    );
}

export const DBTableSelectionDialog: React.FC<{ buttonElement: any }> = function DBTableSelectionDialog({ buttonElement }) {
    
    const dispatch = useDispatch();

    const [tableDialogOpen, setTableDialogOpen] = useState<boolean>(false);
    const [tableAnalysisMap, setTableAnalysisMap] = useState<Record<string, AnalysisResults | null>>({});
    
    const [dbTables, setDbTables] = useState<DBTable[]>([]);
    const [selectedTabIndex, setSelectedTabIndex] = useState(0);
    
    const [errorMessage, setErrorMessage] = useState<{content: string, severity: "error" | "warning" | "info" | "success"} | null>(null);
    const [showError, setShowError] = useState(false);
    const [isUploading, setIsUploading] = useState<boolean>(false);

    useEffect(() => {
        fetchTables();
    }, []);

    // Fetch list of tables
    const fetchTables = async () => {
        try {
            const response = await fetch(getUrls().LIST_TABLES);
            const data = await response.json();
            if (data.status === 'success') {
                setDbTables(data.tables);
            }
        } catch (error) {
            console.error('Failed to fetch tables:', error);
        }
    };

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
            setErrorMessage({content: 'Failed to upload table. The server may need to be restarted.', severity: "error"});
            setShowError(true);
        } finally {
            setIsUploading(false);
        }
    };

    const handleDBDownload = async () => {
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
            link.download = 'df_session.db';
            document.body.appendChild(link);    
            
            // Trigger download
            link.click();
            
            // Clean up
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to download database:', error);
            setErrorMessage({content: 'Failed to download database file', severity: "error"});
            setShowError(true);
        }
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
            setErrorMessage({content: 'Failed to upload table. The server may need to be restarted.', severity: "error"});
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
                if (dbTables[selectedTabIndex]?.name === tableName) {
                    setSelectedTabIndex(selectedTabIndex > 0 ? selectedTabIndex - 1 : 0);
                }
            }
        } catch (error) {
            console.error('Failed to delete table:', error);
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
            setErrorMessage({content: 'Failed to analyze table data', severity: "error"});
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
       setTableDialogOpen(false);
    }

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setSelectedTabIndex(newValue);
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
            <Button variant="text" size="small" onClick={handleDBDownload} disabled={isUploading || dbTables.length === 0}>
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
                        onChange={handleFileUpload}
                        accept=".csv,.xlsx,.json"
                        disabled={isUploading}
                    />
                </Button>
            </Tooltip>
        );
    }

    let mainContent = dbTables.length > 0 ? 
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', display: 'flex', flexDirection: 'row', height: '100%' }}>
            <Box sx={{display: "flex", flexDirection: "column", width: "120px", borderRight: 1, borderColor: 'divider'}}>
                <Tabs
                    orientation="vertical"
                    variant="scrollable"
                    value={selectedTabIndex}
                    onChange={handleTabChange}
                    aria-label="Database tables"
                    sx={{ width: '120px', maxHeight: '360px' }}
                >
                    {dbTables.map((t, i) => (
                        <Tab 
                            key={i} 
                            wrapped 
                            label={<Typography variant="caption" 
                                        sx={{textTransform: "none", width: "calc(100% - 4px)", textAlign: 'center', 
                                            textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap'}}>
                                    {t.name}</Typography>} 
                            sx={{textTransform: "none", minHeight: 24, padding: 1}}
                            {...a11yProps(i)} 
                        />
                    ))}
                </Tabs> 
                <Divider sx={{my: 1}} textAlign='left'> <TuneIcon sx={{fontSize: 12, color: "text.secondary"}} /></Divider>
                {uploadFileButton(<Typography component="span" fontSize={12}>{isUploading ? 'uploading...' : 'upload file'}</Typography>)}
            </Box>
            {dbTables.map((t, i) => {
                const currentTable = t;
                const showingAnalysis = tableAnalysisMap[currentTable.name] !== undefined;
                return (
                    <TabPanel key={i} sx={{width: 960, maxWidth: '100%'}} value={selectedTabIndex} index={i}>
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
                                    tableAnalysisMap={tableAnalysisMap}
                                />
                            ) : (
                                <CustomReactTable 
                                    rows={currentTable.sample_rows.slice(0, 9)} 
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
        </Box> : 
        <Box sx={{ p: 3, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <StorageIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 2 }} />
            <Typography variant="caption"> Database is currently empty. </Typography>
            <Typography>
                {uploadFileButton(<Typography component="span">Upload a csv dataset </Typography>)}
                or
                {importButton(<Typography component="span">Import a db file</Typography>)}
                <Typography component="span"> to get started.</Typography>
            </Typography>
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
                    <Box width="100%" height="100%">
                        {mainContent}
                    </Box>
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
                        disabled={isUploading || dbTables.length === 0}
                        onClick={() => {
                            handleAddTableToDF(dbTables[selectedTabIndex]);
                            setTableDialogOpen(false);
                        }}>
                        Load Table
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}