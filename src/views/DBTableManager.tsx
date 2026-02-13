// TableManager.tsx
import React, { useState, useEffect, useCallback, FC, useRef } from 'react';
import { 
  Card, 
  CardContent, 
  Typography, 
  Button, 
  Grid,
  Box,
  IconButton,
  Paper,
  TextField,
  Divider,
  SxProps,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  ButtonGroup,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  MenuItem,
  Menu,
  Chip,
  Collapse,
  styled,
  useTheme,
  Link,
  Popover,
  Switch,
  Slider,
  FormControlLabel
} from '@mui/material';

import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import Autocomplete from '@mui/material/Autocomplete';

// Type for table import configuration
type TableImportConfig = 
    | { mode: 'none' }
    | { mode: 'full' }
    | { mode: 'subset'; rowLimit: number; sortColumns: string[]; sortOrder: 'asc' | 'desc' };

import { getUrls, fetchWithIdentity } from '../app/utils';
import { borderColor } from '../app/tokens';
import { CustomReactTable } from './ReactTable';
import { DataSourceConfig, DictTable } from '../components/componentType';
import { Type } from '../data/types';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions, dfSelectors } from '../app/dfSlice';
import { alpha } from '@mui/material';
import { DataFormulatorState } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { loadTable } from '../app/tableThunks';
import { AppDispatch } from '../app/store';
import Markdown from 'markdown-to-jsx';

import CheckIcon from '@mui/icons-material/Check';
import MuiMarkdown from 'mui-markdown';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SettingsIcon from '@mui/icons-material/Settings';

export const handleDBDownload = async (identityId: string) => {
    try {
        const response = await fetchWithIdentity(
            getUrls().DOWNLOAD_DB_FILE,
            { method: 'GET' }
        );
        
        // Check if the response is ok
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || errorData.message || 'Failed to download database file');
        }

        // Get the blob directly from response
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        // Create a temporary link element
        const link = document.createElement('a');
        link.href = url;
        link.download = `df_${identityId?.slice(0, 4) || 'db'}.db`;
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
    // Source metadata for refreshable tables (from data loaders)
    // Backend stores connection info; frontend manages refresh timing
    source_metadata?: {
        table_name: string;
        data_loader_type: string;
        data_loader_params: Record<string, any>;
        source_table_name?: string;
        source_query?: string;
        last_refreshed?: string;
    } | null;
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


export const DBManagerPane: React.FC<{ 
    onClose?: () => void;
}> = function DBManagerPane({ onClose }) {
    
    const theme = useTheme();

    const dispatch = useDispatch<AppDispatch>();
    const identity = useSelector((state: DataFormulatorState) => state.identity);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const dataLoaderConnectParams = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams);


    // maps data loader type to list of param defs
    const [dataLoaderMetadata, setDataLoaderMetadata] = useState<Record<string, {
        params: {name: string, default: string, type: string, required: boolean, description: string}[], 
        auth_instructions: string}>>({});

    const [dbTables, setDbTables] = useState<DBTable[]>([]);
    const [selectedTabKey, setSelectedTabKey] = useState("");
    const [selectedDataLoader, setSelectedDataLoader] = useState<string>("");

    const [isUploading, setIsUploading] = useState<boolean>(false);

    let setSystemMessage = (content: string, severity: "error" | "warning" | "info" | "success") => {
        dispatch(dfActions.addMessages({
            "timestamp": Date.now(),
            "component": "DB manager",
            "type": severity,
            "value": content
        }));
    }

    useEffect(() => {
        fetchDataLoaders();
    }, []);

    useEffect(() => {
        if (selectedDataLoader === "") {
            if (dbTables.length == 0) {
                setSelectedTabKey("");
            } else if (dbTables.find(t => t.name === selectedTabKey) == undefined) {
                setSelectedTabKey(dbTables[0]?.name || "");
            }
        }
    }, [dbTables, selectedDataLoader]);

    // Fetch list of tables
    const fetchTables = async (): Promise<DBTable[] | undefined> => {
        if (serverConfig.DISABLE_DATABASE) return undefined;
        try {
            const response = await fetchWithIdentity(getUrls().LIST_TABLES, { method: 'GET' });
            const data = await response.json();
            if (data.status === 'success') {
                setDbTables(data.tables);
                return data.tables;
            }
        } catch (error) {
            setSystemMessage('Failed to fetch tables, please check if the server is running', "error");
        }
        return undefined;
    };

    const fetchDataLoaders = async () => {
        fetchWithIdentity(getUrls().DATA_LOADER_LIST_DATA_LOADERS, {
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

    useEffect(() => {
        fetchTables();
    }, []);

    let tableSelectionPanel = <Box sx={{ 
        pt: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        width: '100%',
    }}>
        {/* Data loaders */}
        {Object.keys(dataLoaderMetadata ?? {}).map((dataLoaderType) => (
            <Button
                key={dataLoaderType}
                variant="text"
                size="small"
                color="primary"
                onClick={() => setSelectedDataLoader(dataLoaderType)}
                sx={{
                    fontSize: 12,
                    textTransform: "none",
                    width: '100%',
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    borderRadius: 0,
                    py: 1,
                    px: 2,
                    color: selectedDataLoader === dataLoaderType ? 'primary.main' : 'text.secondary',
                    borderRight: selectedDataLoader === dataLoaderType ? 2 : 0,
                    borderColor: 'primary.main',
                }}
            >
                {dataLoaderType}
            </Button>
        ))}
    </Box>

    let dataConnectorView = <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', overflowX: 'hidden', p: 2, pb: 4, display: 'flex', flexDirection: 'column', minWidth: 0, overscrollBehavior: 'contain' }}>

        {/* Empty state when no loader selected */}
        {selectedDataLoader === '' && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'text.disabled' }}>
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                    Select a data loader from the left panel
                </Typography>
            </Box>
        )}
        
        {/* Data loader forms */}
        {dataLoaderMetadata && Object.entries(dataLoaderMetadata).map(([dataLoaderType, metadata]) => (
            selectedDataLoader === dataLoaderType && (
                <Box key={`dataLoader:${dataLoaderType}`} sx={{ position: "relative", maxWidth: '100%', flexShrink: 0 }}>
                    <DataLoaderForm 
                        key={`data-loader-form-${dataLoaderType}`}
                        dataLoaderType={dataLoaderType} 
                        paramDefs={metadata.params}
                        authInstructions={metadata.auth_instructions}
                        onImport={() => {
                            setIsUploading(true);
                        }} 
                        onFinish={(status, message, importedTables) => {
                            setIsUploading(false);
                            if (status === "success") {
                                onClose?.();
                            } else {
                                setSystemMessage(message, "error");
                            }
                        }} 
                    />
                </Box>
            )
        ))}
    </Box>;

    let mainContent =  
        <Box sx={{ display: 'flex', flexDirection: 'column', bgcolor: 'white', flex: 1, overflow: 'hidden', height: '100%' }}>
            <Box sx={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden', minHeight: 0, height: '100%' }}>
                {/* Button navigation - similar to TableSelectionView */}
                <Box sx={{ display: 'flex', flexDirection: 'column', px: 0, width: 150, minWidth: 150, maxWidth: 150, overflow: 'hidden', height: '100%' }}>
                    <Box sx={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        flex: 1,
                        minHeight: 0,
                        height: '100%',
                        position: 'relative',
                        borderRight: `1px solid ${borderColor.view}`,
                        overscrollBehavior: 'contain'
                    }}>
                        {/* Available Tables Section - always visible */}
                        {tableSelectionPanel}
                    </Box>
                </Box>
                {/* Content area - show selected data loader form */}
                <Box sx={{ flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0, height: '100%', position: 'relative' }}>
                    {dataConnectorView}
                </Box>
            </Box>
        </Box>  

    return (
        <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
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
            
        </Box>
    );
  
}

export const DataLoaderForm: React.FC<{
    dataLoaderType: string, 
    paramDefs: {name: string, default: string, type: string, required: boolean, description: string}[],
    authInstructions: string,
    onImport: () => void,
    onFinish: (status: "success" | "error", message: string, importedTables?: string[]) => void
}> = ({dataLoaderType, paramDefs, authInstructions, onImport, onFinish}) => {

    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();
    const params = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[dataLoaderType] ?? {});
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 10000);

    const [tableMetadata, setTableMetadata] = useState<Record<string, any>>({});
    let [displaySamples, setDisplaySamples] = useState<Record<string, boolean>>({});
    let [tableFilter, setTableFilter] = useState<string>("");
    const [tableImportConfigs, setTableImportConfigs] = useState<Record<string, TableImportConfig>>({});
    const [subsetConfigAnchor, setSubsetConfigAnchor] = useState<{element: HTMLElement, tableName: string} | null>(null);
    
    // Store on server toggle for data loader imports
    const [importStoreOnServer, setImportStoreOnServer] = useState<boolean>(true);
    
    // Helper to get import config for a table (defaults to 'none')
    const getTableConfig = (tableName: string): TableImportConfig => {
        return tableImportConfigs[tableName] ?? { mode: 'none' };
    };
    
    // Helper to update config for a specific table
    const updateTableConfig = (tableName: string, config: TableImportConfig) => {
        setTableImportConfigs(prev => ({ ...prev, [tableName]: config }));
    };
    
    // Get selected tables (those with mode !== 'none')
    const selectedTables = Object.entries(tableImportConfigs)
        .filter(([_, config]) => config.mode !== 'none')
        .map(([tableName, _]) => tableName);

    let [isConnecting, setIsConnecting] = useState(false);

    const toggleDisplaySamples = (tableName: string) => {
        setDisplaySamples({...displaySamples, [tableName]: !displaySamples[tableName]});
    }

    let tableMetadataBox = [
        <TableContainer component={Box} sx={{borderTop: `1px solid ${borderColor.divider}`, maxHeight: 340, overflowY: "auto"}} >
            <Table sx={{ minWidth: 650 }} size="small" aria-label="simple table">
                <TableHead>
                    <TableRow sx={{ '& .MuiTableCell-root': { fontSize: 12 } }}>
                        <TableCell> </TableCell>
                        <TableCell>Table Name</TableCell>
                        <TableCell>Columns</TableCell>
                        <TableCell align="right">Import Options</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {Object.entries(tableMetadata).map(([tableName, metadata]) => {
                        return [
                        <TableRow
                            key={tableName}
                            sx={{ 
                                '&:last-child td, &:last-child th': { border: 0 }, 
                                '& .MuiTableCell-root': { 
                                    borderBottom: displaySamples[tableName] ? 'none' : '1px solid rgba(0, 0, 0, 0.1)',
                                    padding: 0.25, wordWrap: 'break-word', whiteSpace: 'normal'},
                                backgroundColor: getTableConfig(tableName).mode !== 'none' ? 'action.selected' : 'inherit',
                                '&:hover': { backgroundColor: getTableConfig(tableName).mode !== 'none' ? 'action.selected' : 'action.hover' },
                            }}
                        >
                            <TableCell>
                                <IconButton size="small" onClick={(e) => {
                                    e.stopPropagation();
                                    toggleDisplaySamples(tableName);
                                }}>
                                    {displaySamples[tableName] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                </IconButton>
                            </TableCell>
                            <TableCell sx={{maxWidth: 240}} component="th" scope="row">
                                {tableName} <Typography variant="caption" sx={{color: "text.secondary"}} fontSize={10}>
                                    ({metadata.row_count > 0 ? `${metadata.row_count} rows × ` : ""}{metadata.columns.length} cols)
                                </Typography>
                            </TableCell>
                            <TableCell sx={{maxWidth: 400}}>
                                {metadata.columns.map((column: any) => (
                                    <Chip key={column.name} label={column.name} sx={{fontSize: 11, margin: 0.25, height: 20}} size="small" />
                                ))}
                            </TableCell>
                            <TableCell sx={{width: 220}} align="right">
                                <Box sx={{ display: 'flex', alignItems: 'flex-end', flexDirection: 'column', mx: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', my: 1, gap: 0.5, flexDirection: 'row', justifyContent: 'flex-end' }}>
                                        <ToggleButtonGroup
                                            size="small"
                                            value={getTableConfig(tableName).mode}
                                            exclusive
                                            onChange={(e, newMode) => {
                                                if (newMode === null) return; // Prevent deselecting all
                                                if (newMode === 'none') {
                                                    updateTableConfig(tableName, { mode: 'none' });
                                                } else if (newMode === 'full') {
                                                    updateTableConfig(tableName, { mode: 'full' });
                                                } else if (newMode === 'subset') {
                                                    // Initialize with default values
                                                    updateTableConfig(tableName, { 
                                                        mode: 'subset', 
                                                        rowLimit: Math.min(1000, metadata.row_count || 1000),
                                                        sortColumns: [],
                                                        sortOrder: 'asc'
                                                    });
                                                }
                                            }}
                                        >
                                            <ToggleButton value="none" sx={{ 
                                                px: 1, py: 0, fontSize: 11, textTransform: 'none',
                                                '&.Mui-selected': { backgroundColor: 'grey.400', color: 'white' },
                                                '&.Mui-selected:hover': { backgroundColor: 'grey.500' }
                                            }}>
                                                <Tooltip title="Don't import this table">
                                                    <span>Skip</span>
                                                </Tooltip>
                                            </ToggleButton>
                                            <ToggleButton value="full" sx={{ 
                                                px: 1, py: 0, fontSize: 11, textTransform: 'none',
                                                '&.Mui-selected': { backgroundColor: 'secondary.main', color: 'white' },
                                                '&.Mui-selected:hover': { backgroundColor: 'secondary.dark' }
                                            }}>
                                                <Tooltip title="Import entire table">
                                                    <span>Full</span>
                                                </Tooltip>
                                            </ToggleButton>
                                            <ToggleButton value="subset" onClick={(e) => {
                                                e.stopPropagation();
                                                setSubsetConfigAnchor({ element: e.currentTarget, tableName });
                                            }} sx={{ 
                                                px: 1, py: 0, fontSize: 11, textTransform: 'none',
                                                '&.Mui-selected': { backgroundColor: '#f9a825', color: 'white' },
                                                '&.Mui-selected:hover': { backgroundColor: '#f57f17' }
                                            }}>
                                                <Tooltip title="Import first K rows (with optional sorting)">
                                                    <span>Subset</span>
                                                </Tooltip>
                                            </ToggleButton>
                                        </ToggleButtonGroup>
                                    </Box>
                                    {getTableConfig(tableName).mode === 'subset' && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexDirection: 'row', justifyContent: 'flex-end' }}>
                                            <Button
                                                size="small"
                                                startIcon={<SettingsIcon sx={{ fontSize: 12 }} />}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSubsetConfigAnchor({ element: e.currentTarget, tableName });
                                                }}
                                                sx={{ 
                                                    fontSize: 11,
                                                    textTransform: 'none',
                                                    minWidth: 'auto',
                                                    padding: '2px 4px',
                                                }}
                                            >
                                                {(() => {
                                                    const config = getTableConfig(tableName);
                                                    if (config.mode === 'subset') {
                                                        const sortInfo = config.sortColumns.length > 0 
                                                            ? `, ${config.sortOrder === 'asc' ? '↑' : '↓'} by ${config.sortColumns.join(', ')} ` 
                                                            : '';
                                                        return `first ${config.rowLimit} rows${sortInfo}`;
                                                    }
                                                    return '';
                                                })()}
                                            </Button>
                                        </Box>
                                    )}
                                </Box>
                            </TableCell>
                        </TableRow>,
                        <TableRow key={`${tableName}-sample`}>
                            <TableCell colSpan={4} sx={{ paddingBottom: 0, paddingTop: 0, px: 0, maxWidth: 800, overflowX: "auto", 
                                            borderBottom: displaySamples[tableName] ? '1px solid rgba(0, 0, 0, 0.1)' : 'none' }}>
                            <Collapse in={displaySamples[tableName]} timeout="auto" unmountOnExit>
                                <Card variant="outlined" sx={{ ml: 5, my: 1}}>
                                    <CustomReactTable rows={metadata.sample_rows.slice(0, 5).map((row: any) => {
                                        return Object.fromEntries(Object.entries(row).map(([key, value]: [string, any]) => {
                                            return [key, String(value)];
                                        }));
                                    })} 
                                    columnDefs={metadata.columns.map((column: any) => ({id: column.name, label: column.name}))} 
                                    rowsPerPageNum={-1} 
                                    compact={false} 
                                    isIncompleteTable={metadata.row_count > 10}
                                    />
                                </Card>
                            </Collapse>
                            </TableCell>
                        </TableRow>]
                    })}
                    </TableBody>
                </Table>
            </TableContainer>,
        // Subset configuration popover
        <Popover
            key="subset-config-popover"
            open={subsetConfigAnchor !== null}
            anchorEl={subsetConfigAnchor?.element}
            onClose={() => setSubsetConfigAnchor(null)}
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
            }}
            transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
            }}
        >
            {subsetConfigAnchor && (() => {
                const tableName = subsetConfigAnchor.tableName;
                const config = getTableConfig(tableName);
                const metadata = tableMetadata[tableName];
                if (config.mode !== 'subset' || !metadata) return null;
                
                return (
                    <Box sx={{ fontSize: 12, p: 1.5, minWidth: 280, maxWidth: 360 }}>
                        <Typography variant="body2" sx={{ mb: 1.5, fontSize: 14, fontWeight: 600 }}>
                            Create a subset of "{tableName}"
                        </Typography>
                        <Typography variant="caption" sx={{  display: 'block', mb: 0.75, fontSize: 12, fontWeight: 500 }}>
                            Row Limit (max: {metadata.row_count || 'unknown'} rows)
                        </Typography>
                        <Box sx={{ my: 2, ml: 2 }}>
                            <TextField
                                size="small"
                                type="number"
                                value={config.rowLimit}
                                onChange={(e) => {
                                    const value = parseInt(e.target.value) || 1;
                                    const maxRows = metadata.row_count || 100000;
                                    updateTableConfig(tableName, {
                                        ...config,
                                        rowLimit: Math.min(Math.max(1, value), maxRows)
                                    });
                                }}
                                slotProps={{ 
                                    input: {
                                        inputProps: { 
                                            min: 1, 
                                            max: metadata.row_count || 100000,
                                            step: 100
                                        }
                                    }
                                }}
                                fullWidth
                                sx={{ mb: 1, '& .MuiInputBase-root': { fontSize: 12 } }}
                            />
                            <Slider
                                size="small"
                                value={config.rowLimit}
                                onChange={(_, value) => {
                                    updateTableConfig(tableName, {
                                        ...config,
                                        rowLimit: value as number
                                    });
                                }}
                                min={1}
                                max={metadata.row_count || 10000}
                                step={Math.max(1, Math.floor((metadata.row_count || 10000) / 100))}
                                valueLabelDisplay="auto"
                            />
                        </Box>
                        
                        <Typography variant="caption" sx={{  display: 'block', my: 1, fontSize: 12, fontWeight: 500 }}>
                            Sort By <span style={{ fontWeight: 400, color: 'rgba(0, 0, 0, 0.6)' }}>(optional)</span>
                        </Typography>
                        <Box sx={{ my: 2, ml: 2 }}>
                            <Autocomplete
                                multiple
                                size="small"
                                options={metadata.columns.map((col: any) => col.name)}
                                value={config.sortColumns}
                                onChange={(_, newValue) => {
                                    updateTableConfig(tableName, {
                                        ...config,
                                        sortColumns: newValue
                                    });
                                }}
                                renderInput={(params) => (
                                    <TextField 
                                        {...params} 
                                        placeholder="Select columns..."
                                        size="small"
                                        sx={{ '& .MuiInputBase-root': { fontSize: 12 } }}
                                    />
                                )}
                                renderTags={(value, getTagProps) =>
                                    value.map((option, index) => (
                                        <Chip
                                            {...getTagProps({ index })}
                                            key={option}
                                            label={option}
                                            size="small"
                                            sx={{ height: 20, fontSize: 11 }}
                                        />
                                    ))
                                }
                            />
                            {config.sortColumns.length > 0 && (
                                <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <ToggleButtonGroup
                                        value={config.sortOrder}
                                        exclusive
                                        onChange={(_, newValue) => {
                                            if (newValue) {
                                                updateTableConfig(tableName, {
                                                    ...config,
                                                    sortOrder: newValue
                                                });
                                            }
                                        }}
                                        size="small"
                                        sx={{ height: 24 }}
                                    >
                                        <ToggleButton value="asc" sx={{ 
                                            px: 1.5, py: 0, fontSize: 11, textTransform: 'none',
                                            '&.Mui-selected': { backgroundColor: 'primary.main', color: 'white' },
                                            '&.Mui-selected:hover': { backgroundColor: 'primary.dark' }
                                        }}>
                                            ↑ Asc
                                        </ToggleButton>
                                        <ToggleButton value="desc" sx={{ 
                                            px: 1.5, py: 0, fontSize: 11, textTransform: 'none',
                                            '&.Mui-selected': { backgroundColor: 'primary.main', color: 'white' },
                                            '&.Mui-selected:hover': { backgroundColor: 'primary.dark' }
                                        }}>
                                            ↓ Desc
                                        </ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                            )}
                        </Box>
                        
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                            <Button 
                                size="small" 
                                variant="contained" 
                                onClick={() => setSubsetConfigAnchor(null)}
                                sx={{ textTransform: 'none', fontSize: 11, height: 28 }}
                            >
                                Done
                            </Button>
                        </Box>
                    </Box>
                );
            })()}
        </Popover>,
        Object.keys(tableMetadata).length > 0 && <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2, gap: 1}}>
            <Tooltip title={importStoreOnServer 
                ? "Data will be stored on the server workspace (supports large tables)" 
                : `Data stays in browser only (limited to ${frontendRowLimit.toLocaleString()} rows, like incognito mode)`}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={importStoreOnServer}
                            onChange={(e) => setImportStoreOnServer(e.target.checked)}
                            size="small"
                        />
                    }
                    label={
                        <Typography variant="body2" sx={{ fontSize: '0.75rem', color: importStoreOnServer ? 'text.primary' : 'text.secondary' }}>
                            {importStoreOnServer ? 'Store on server' : `Local only (≤${frontendRowLimit.toLocaleString()} rows)`}
                        </Typography>
                    }
                />
            </Tooltip>
            <Button 
                variant="contained" 
                color="primary"
                disabled={selectedTables.length === 0}
                sx={{ textTransform: 'none' }}
                onClick={() => {
                    const tablesToImport = selectedTables;
                    onImport();
                    
                    // Import all selected tables using loadTable thunk
                    const importPromises = tablesToImport.map(tableName => {
                        const config = getTableConfig(tableName);
                        const metadata = tableMetadata[tableName];
                        
                        // Build import options based on config
                        const importOptions: any = {};
                        if (config.mode === 'subset') {
                            importOptions.rowLimit = config.rowLimit;
                            if (config.sortColumns.length > 0) {
                                importOptions.sortColumns = config.sortColumns;
                                importOptions.sortOrder = config.sortOrder;
                            }
                        }
                        
                        // Build a preliminary DictTable from the metadata
                        const sampleRows = metadata?.sample_rows || [];
                        const columns = metadata?.columns || [];
                        const tableObj: DictTable = {
                            id: tableName.split('.').pop() || tableName,
                            displayId: tableName,
                            names: columns.map((c: any) => c.name),
                            metadata: columns.reduce((acc: Record<string, any>, col: any) => ({
                                ...acc,
                                [col.name]: { type: 'string' as any, semanticType: '', levels: [] }
                            }), {}),
                            rows: sampleRows,
                            anchored: true,
                            createdBy: 'user' as const,
                            attachedMetadata: '',
                            source: {
                                type: 'database' as const,
                                databaseTable: tableName,
                                canRefresh: true,
                                lastRefreshed: Date.now(),
                            },
                        };
                        
                        return dispatch(loadTable({
                            table: tableObj,
                            storeOnServer: importStoreOnServer,
                            dataLoaderType,
                            dataLoaderParams: params,
                            sourceTableName: tableName,
                            importOptions: Object.keys(importOptions).length > 0 ? importOptions : undefined,
                        })).unwrap();
                    });
                    
                    Promise.all(importPromises)
                        .then(results => {
                            setTableImportConfigs({});
                            const tableNames = results.map(r => r.table.id);
                            onFinish("success", `Successfully loaded ${tablesToImport.length} table(s)`, tableNames);
                        })
                        .catch(error => {
                            console.error('Failed to load data:', error);
                            onFinish("error", `Failed to load data: ${error}`);
                        });
                }}
            >
                Load Selected Tables ({selectedTables.length})
            </Button>
        </Box>
    ]

    const isConnected = Object.keys(tableMetadata).length > 0;

    return (
        <Box sx={{p: 0, pb: 2}}>
            <Typography sx={{fontSize: 16, flex: 1}}>
                Import tables from <Typography component="span" sx={{ fontSize: 'inherit', color: 'secondary.main', fontWeight: 'bold'}}>{dataLoaderType}</Typography>
            </Typography>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.7)"
            }}>
                <CircularProgress size={20} />
            </Box>}
            {isConnected ? (
                // Connected state: show connection parameters and disconnect button
                <Box sx={{mt: 1}}>
                    <Box sx={{mb: 1.5}}>
                        <Box sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 0.5, mb: 1.5, flexWrap: "wrap"}}>
                            {paramDefs.filter((paramDef) => params[paramDef.name]).map((paramDef, index) => (
                                <React.Fragment key={paramDef.name}>
                                    <Typography variant="body2" component="span" sx={{fontSize: 11, color: 'text.secondary'}}>
                                        {paramDef.name}:
                                    </Typography>
                                    <Typography variant="body2" component="span" sx={{fontSize: 11, color: 'text.primary', fontWeight: 500, mr: 0.5}}>
                                        {params[paramDef.name] || '(empty)'}
                                    </Typography>
                                    {index < paramDefs.filter((p) => params[p.name]).length - 1 && (
                                        <Typography variant="body2" component="span" sx={{fontSize: 11, color: 'text.disabled', mr: 0.5}}>·</Typography>
                                    )}
                                </React.Fragment>
                            ))}
                        </Box>
                        <Box sx={{display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 1.5}}>
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, flex: 1, maxWidth: 300 }}>
                                <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.secondary', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <SearchIcon sx={{ fontSize: 11 }} /> table filter
                                </Typography>
                                <TextField
                                    sx={{
                                        '& .MuiInputBase-root': {fontSize: 12, height: '30px'},
                                        '& .MuiInputBase-input': {fontSize: 12, py: 0.5, px: 1},
                                        '& .MuiInputBase-input::placeholder': {fontSize: 11, fontStyle: "italic"},
                                        '& .MuiOutlinedInput-root': {
                                            '& fieldset': { borderColor: 'rgba(0,0,0,0.15)' },
                                        }
                                    }}
                                    variant="outlined"
                                    size="small"
                                    fullWidth
                                    autoComplete="off"
                                    placeholder="filter tables by keyword"
                                    value={tableFilter}
                                    onChange={(event) => setTableFilter(event.target.value)}
                                />
                            </Box>
                            <Button
                                variant="outlined"
                                size="small"
                                sx={{textTransform: "none", height: 30, fontSize: 12}}
                                onClick={() => {
                                    setIsConnecting(true);
                                    fetchWithIdentity(getUrls().DATA_LOADER_LIST_TABLES, {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({
                                            data_loader_type: dataLoaderType, 
                                            data_loader_params: params,
                                            table_filter: tableFilter.trim() || null
                                        })
                                    }).then((response: Response) => response.json())
                                .then((data: any) => {
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
                                .catch((error: any) => {
                                    onFinish("error", `Failed to fetch data loader tables, please check the server is running`);
                                    setIsConnecting(false);
                                });
                                }}
                            >
                                Refresh
                            </Button>
                            <Button
                                variant="outlined"
                                size="small"
                                sx={{textTransform: "none", height: 30, fontSize: 12}}
                                onClick={() => {
                                    setTableMetadata({});
                                    setTableFilter("");
                                }}
                            >
                                Disconnect
                            </Button>
                        </Box>
                    </Box>
                    
                    {tableMetadataBox}
                </Box>
            ) : (
                // Not connected: show connection forms
                <>
                    <Box sx={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: 1.5,
                        mt: 2,
                    }}>
                        {paramDefs.map((paramDef) => (
                            <Box key={paramDef.name} sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                                <Typography 
                                    sx={{
                                        fontSize: 11,
                                        fontWeight: 500,
                                        color: paramDef.required ? 'text.primary' : 'text.secondary',
                                        lineHeight: 1.3,
                                    }}
                                >
                                    {paramDef.name}
                                    {paramDef.required && <span style={{color: '#d32f2f'}}> *</span>}
                                </Typography>
                                <TextField
                                    sx={{
                                        '& .MuiInputBase-root': {fontSize: 12, height: '30px'},
                                        '& .MuiInputBase-input': {fontSize: 12, py: 0.5, px: 1},
                                        '& .MuiInputBase-input::placeholder': {fontSize: 11, fontStyle: "italic"},
                                        '& .MuiOutlinedInput-root': {
                                            '& fieldset': { borderColor: 'rgba(0,0,0,0.15)' },
                                        }
                                    }}
                                    variant="outlined"
                                    size="small"
                                    fullWidth
                                    required={paramDef.required}
                                    value={params[paramDef.name] ?? ''}
                                    placeholder={paramDef.default ? `${paramDef.default}` : paramDef.description || ''}
                                    onChange={(event: any) => { 
                                        dispatch(dfActions.updateDataLoaderConnectParam({
                                            dataLoaderType, paramName: paramDef.name, 
                                            paramValue: event.target.value}));
                                    }}
                                />
                            </Box>
                        ))}
                    </Box>
                    <Box sx={{ display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 1.5, mt: 2 }}>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, flex: 1, maxWidth: 300 }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'text.secondary', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <SearchIcon sx={{ fontSize: 11 }} /> table filter
                            </Typography>
                            <TextField
                                sx={{
                                    '& .MuiInputBase-root': {fontSize: 12, height: '30px'},
                                    '& .MuiInputBase-input': {fontSize: 12, py: 0.5, px: 1},
                                    '& .MuiInputBase-input::placeholder': {fontSize: 11, fontStyle: "italic"},
                                    '& .MuiOutlinedInput-root': {
                                        '& fieldset': { borderColor: 'rgba(0,0,0,0.15)' },
                                    }
                                }}
                                variant="outlined"
                                size="small"
                                fullWidth
                                autoComplete="off"
                                placeholder="filter tables by keyword"
                                value={tableFilter}
                                onChange={(event) => setTableFilter(event.target.value)}
                            />
                        </Box>
                        {paramDefs.length > 0 && 
                            <Button 
                                variant="contained"
                                color="primary"
                                size="small"
                                sx={{textTransform: "none", minWidth: 100, height: 30}}
                                onClick={() => {
                                    setIsConnecting(true);
                                    fetchWithIdentity(getUrls().DATA_LOADER_LIST_TABLES, {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({
                                            data_loader_type: dataLoaderType, 
                                            data_loader_params: params,
                                            table_filter: tableFilter.trim() || null
                                        })
                                    }).then((response: Response) => response.json())
                                .then((data: any) => {
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
                                .catch((error: any) => {
                                    onFinish("error", `Failed to fetch data loader tables, please check the server is running`);
                                    setIsConnecting(false);
                                });
                            }}>
                                Connect{tableFilter.trim() ? " with filter" : ""}
                            </Button>}
                    </Box>
                    {authInstructions.trim() && (
                        <Typography variant="body2" sx={{
                            color: "text.secondary",
                            fontSize: 11, whiteSpace: "pre-wrap", mt: 2, lineHeight: 1.5}}>
                            {authInstructions.trim()}
                        </Typography>
                    )}</>
            )}
        </Box>
    );
}