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
  SxProps
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloseIcon from '@mui/icons-material/Close';
import StorageIcon from '@mui/icons-material/Storage';
import SearchIcon from '@mui/icons-material/Search';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import { getUrls } from '../app/utils';
import { CustomReactTable } from './ReactTable';
import { DictTable } from '../components/ComponentType';
import { Type } from '../data/types';
import { useDispatch } from 'react-redux';
import { dfActions } from '../app/dfSlice';
 
interface DBTable {
    name: string;
    columns: {
        name: string;
        type: string;
    }[];
    row_count: number;
    sample_rows: any[];
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
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`vertical-tabpanel-${index}`}
      aria-labelledby={`vertical-tab-${index}`}
      style={{maxWidth: '100%'}}
      sx={sx}
      {...other}
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

export const DBTableManager: React.FC = () => {
    return (
        <DBTableSelectionDialog buttonElement={<Button>DB Tables</Button>} />
    );
}

export const DBTableSelectionDialog: React.FC<{ buttonElement: any }> = function DBTableSelectionDialog({ buttonElement }) {
    
    const dispatch = useDispatch();

    const [tableDialogOpen, setTableDialogOpen] = useState<boolean>(false);

    const [dbTables, setDbTables] = useState<DBTable[]>([]);
    const [selectedTabIndex, setSelectedTabIndex] = useState(0);
    
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [showError, setShowError] = useState(false);

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

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
    
        const formData = new FormData();
        formData.append('file', file);
        formData.append('table_name', file.name.split('.')[0]);
    
        try {
            const response = await fetch(getUrls().CREATE_TABLE, {
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
            setErrorMessage('Failed to upload table. The server may need to be restarted.');
            setShowError(true);
        }
    };

    // Delete table
    const handleDeleteTable = async (tableName: string) => {
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
        
        try {
            const response = await fetch(getUrls().ANALYZE_TABLE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ table_name: tableName })
            });
            const data = await response.json();
            if (data.status === 'success') {
                console.log('Analysis results:', data);
                alert('Analysis completed. Check console for details.');
            }
        } catch (error) {
            console.error('Failed to analyze table data:', error);
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
                rowCount: dbTable.row_count,
                available: true,
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
                <Alert onClose={handleCloseError} severity="error" sx={{ width: '100%' }}>
                    {errorMessage}
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
                <DialogContent sx={{overflowX: "hidden", padding: 0, width: "100%"}} dividers>
                    <Box width="100%" height="100%">
                        {dbTables.length > 0 ? (
                            <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <Tabs
                                    orientation="horizontal"
                                    variant="scrollable"
                                    value={selectedTabIndex}
                                    onChange={handleTabChange}
                                    aria-label="Database tables"
                                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                                >
                                    {dbTables.map((t, i) => (
                                        <Tab 
                                            key={i} 
                                            wrapped 
                                            label={t.name} 
                                            sx={{textTransform: "none",}} 
                                            {...a11yProps(i)} 
                                        />
                                    ))}
                                </Tabs>
                                {dbTables.map((t, i) => {
                                    const currentTable = t;
                                    return (
                                        <TabPanel key={i} sx={{width: 960, maxWidth: '100%'}} value={selectedTabIndex} index={i}>
                                            <Box>
                                                <Paper variant="outlined" sx={{width: "100%", marginBottom: "8px" }}>
                                                    <Box sx={{ px: 1, display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                                        <Typography variant="caption" sx={{  }}>
                                                            {currentTable.name}
                                                            <Typography component="span" sx={{ml: 1, fontSize: 10, color: "text.secondary"}}>
                                                                ({currentTable.columns.length} columns × {currentTable.row_count} rows)
                                                            </Typography>
                                                        </Typography>
                                                        <Box sx={{ marginLeft: 'auto', display: 'flex', gap: 1 }}>
                                                            <IconButton 
                                                                size="small" 
                                                                color="primary"
                                                                onClick={() => handleAnalyzeData(currentTable.name)}
                                                                title="Analyze Data"
                                                            >
                                                                <AnalyticsIcon fontSize="small" />
                                                            </IconButton>
                                                            <IconButton 
                                                                size="small" 
                                                                color="error"
                                                                onClick={() => handleDeleteTable(currentTable.name)}
                                                                title="Delete Table"
                                                            >
                                                                <DeleteIcon fontSize="small" />
                                                            </IconButton>
                                                        </Box>
                                                    </Box>
                                                    
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
                                                </Paper>
                                                <Box width="100%" sx={{display: "flex"}}>
                                                    
                                                </Box>
                                            </Box>
                                        </TabPanel>
                                    );
                                })}
                            </Box>
                        ) : (
                            <Box sx={{ p: 3, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                                <StorageIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 2 }} />
                                <Typography variant="h6" gutterBottom>
                                    Please upload a file to create a table
                                </Typography>
                            </Box>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button
                        variant="outlined"
                        component="label"
                        startIcon={<UploadFileIcon />}
                        size="small"
                        sx={{textTransform: "none", mr: 'auto'}}
                    >
                        Insert File to DB
                        <input
                            type="file"
                            hidden
                            onChange={handleFileUpload}
                            accept=".csv,.xlsx,.json"
                        />
                    </Button>
                    <Button 
                        variant="contained"
                        size="small"
                        onClick={() => {
                            handleAddTableToDF(dbTables[selectedTabIndex]);
                            setTableDialogOpen(false);
                        }}>
                        Load Table
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Query Dialog
            <Dialog 
                open={queryDialogOpen} 
                onClose={() => setQueryDialogOpen(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
                    Execute SQL Query
                    <IconButton
                        sx={{ marginLeft: 'auto' }}
                        edge="start"
                        size="small"
                        color="inherit"
                        onClick={() => setQueryDialogOpen(false)}
                        aria-label="close"
                    >
                        <CloseIcon fontSize="inherit" />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        id="query"
                        label="SQL Query"
                        type="text"
                        fullWidth
                        multiline
                        rows={4}
                        value={queryText}
                        onChange={(e) => setQueryText(e.target.value)}
                        variant="outlined"
                        placeholder="SELECT * FROM table_name WHERE condition"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setQueryDialogOpen(false)}>Cancel</Button>
                    <Button onClick={() => {}} variant="contained">Execute</Button>
                </DialogActions>
            </Dialog> */}
        </>
    );
}