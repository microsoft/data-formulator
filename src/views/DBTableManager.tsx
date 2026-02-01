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

import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TableRowsIcon from '@mui/icons-material/TableRows';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import StreamIcon from '@mui/icons-material/Stream';
import Autocomplete from '@mui/material/Autocomplete';

// Type for table import configuration
type TableImportConfig = 
    | { mode: 'none' }
    | { mode: 'full' }
    | { mode: 'subset'; rowLimit: number; sortColumns: string[]; sortOrder: 'asc' | 'desc' };

import { getUrls, fetchWithIdentity } from '../app/utils';
import { CustomReactTable } from './ReactTable';
import { DataSourceConfig, DictTable } from '../components/ComponentType';
import { Type } from '../data/types';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions, dfSelectors } from '../app/dfSlice';
import { alpha } from '@mui/material';
import { DataFormulatorState } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import Markdown from 'markdown-to-jsx';

import CheckIcon from '@mui/icons-material/Check';
import MuiMarkdown from 'mui-markdown';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StorageIcon from '@mui/icons-material/Storage';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SettingsIcon from '@mui/icons-material/Settings';

// Industry-standard database icons
const TableIcon: React.FC<{ sx?: SxProps }> = ({ sx }) => (
    <Box
        component="svg"
        viewBox="0 0 16 16"
        sx={{
            width: 16,
            height: 16,
            ...sx
        }}
    >
        {/* Single rectangle with grid lines - standard table icon */}
        <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" rx="0.5"/>
        <line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="1"/>
        <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1"/>
        <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1"/>
        <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" strokeWidth="1"/>
    </Box>
);

const ViewIcon: React.FC<{ sx?: SxProps }> = ({ sx }) => (
    <Box
        component="svg"
        viewBox="0 0 16 16"
        sx={{
            width: 16,
            height: 16,
            ...sx
        }}
    >
        {/* Two overlapping rectangles - standard view icon */}
        <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" rx="0.5" opacity="0.8"/>
        <rect x="4" y="4" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" rx="0.5"/>
    </Box>
);

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
}> = function DBManagerPane({ }) {
    
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
    const [connectorMenuAnchorEl, setConnectorMenuAnchorEl] = useState<HTMLElement | null>(null);

    const [isUploading, setIsUploading] = useState<boolean>(false);
    const [resetAnchorEl, setResetAnchorEl] = useState<HTMLElement | null>(null);
    const [tableMenuAnchorEl, setTableMenuAnchorEl] = useState<HTMLElement | null>(null);
    const [showViews, setShowViews] = useState<boolean>(false);
    const dbFileInputRef = useRef<HTMLInputElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    
    // Watch/auto-refresh settings for the currently selected table
    const [watchEnabled, setWatchEnabled] = useState<boolean>(false);
    const [watchInterval, setWatchInterval] = useState<number>(600);
    
    // Reset watch settings when selected table changes
    useEffect(() => {
        setWatchEnabled(false);
        setWatchInterval(600);
    }, [selectedTabKey]);
    
    // Helper to format interval for display
    const formatInterval = (seconds: number) => {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        return `${Math.floor(seconds / 3600)}h`;
    };

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

    const handleDBUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
    
        const formData = new FormData();
        formData.append('file', file);
        formData.append('table_name', file.name.split('.')[0]);
    
        try {
            setIsUploading(true);
            const response = await fetchWithIdentity(getUrls().UPLOAD_DB_FILE, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.status === 'success') {
                fetchTables();  // Refresh table list
            } else {
                // Handle error from server
                setSystemMessage(data.error || 'Failed to upload table', "error");
            }
        } catch (error) {
            setSystemMessage('Failed to upload table, please check if the server is running', "error");
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
            const response = await fetchWithIdentity(getUrls().CREATE_TABLE, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.status === 'success') {
                if (data.is_renamed) {
                    setSystemMessage(`Table ${data.original_name} already exists. Renamed to ${data.table_name}`, "warning");
                } 
                fetchTables();  // Refresh table list
            } else {
                setSystemMessage(data.error || 'Failed to upload table', "error");
            }
        } catch (error) {
            setSystemMessage('Failed to upload table, please check if the server is running', "error");
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
            const response = await fetchWithIdentity(getUrls().RESET_DB_FILE, {
                method: 'POST',
            });
            const data = await response.json();
            if (data.status === 'success') {
                fetchTables();
            } else {
                setSystemMessage(data.error || 'Failed to reset database', "error");
            }
        } catch (error) {
            setSystemMessage('Failed to reset database', "error");
        }
    }

    const handleCleanDerivedViews = async () => {
        let unreferencedViews = dbTables.filter(t => t.view_source !== null && t.view_source !== undefined && !tables.some(t2 => t2.id === t.name));

        if (unreferencedViews.length > 0) {
            if (confirm(`Are you sure you want to delete the following unreferenced derived views? \n${unreferencedViews.map(v => `- ${v.name}`).join("\n")}`)) {
                let deletedViews = [];
                for (let view of unreferencedViews) {
                    try {
                        const response = await fetchWithIdentity(getUrls().DELETE_TABLE, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ table_name: view.name })
                        });
                        const data = await response.json();
                        if (data.status === 'success') {
                            deletedViews.push(view.name);
                        } else {
                            setSystemMessage(data.error || 'Failed to delete table', "error");
                        }
                    } catch (error) {
                        setSystemMessage('Failed to delete table, please check if the server is running', "error");
                    }
                }
                if (deletedViews.length > 0) {
                    setSystemMessage(`Deleted ${deletedViews.length} unreferenced derived views: ${deletedViews.join(", ")}`, "success");
                }
                fetchTables();
                setSelectedTabKey(dbTables.length > 0 ? dbTables[0].name : "");
            }
        }
    }

    // Delete table
    const handleDropTable = async (tableName: string) => {
        if (tables.some(t => t.id === tableName)) {
            if (!confirm(`Are you sure you want to delete ${tableName}? \n ${tableName} is currently loaded into the data formulator and will be removed from the database.`)) return;
        }

        try {
            const response = await fetchWithIdentity(getUrls().DELETE_TABLE, {
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
                setSystemMessage(data.error || 'Failed to delete table', "error");
            }
        } catch (error) {
            setSystemMessage('Failed to delete table, please check if the server is running', "error");
        }
    };

    const handleAddTableToDF = (dbTable: DBTable, refreshSettings?: {autoRefresh: boolean, refreshIntervalSeconds: number}) => {
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

        // Build source config - backend stores connection details, frontend just manages refresh timing
        const sourceMeta = dbTable.source_metadata;
        const sourceConfig: DataSourceConfig = {
            type: 'database',
            databaseTable: dbTable.name,
            // Frontend manages these refresh settings (from user selection)
            autoRefresh: refreshSettings?.autoRefresh ?? false,
            refreshIntervalSeconds: refreshSettings?.refreshIntervalSeconds ?? 60,
            // Backend has connection info if source_metadata exists
            canRefresh: sourceMeta != null,
            lastRefreshed: Date.now()
        };

        let table: DictTable = {
            id: dbTable.name,
            displayId: dbTable.name,
            names: dbTable.columns.map((col: any) => col.name),
            metadata: dbTable.columns.reduce((acc: Record<string, {type: Type, semanticType: string, levels: any[]}>, col: any) => ({
                ...acc,
                [col.name]: {
                    type: convertSqlTypeToAppType(col.type),
                    semanticType: "",
                    levels: []
                }
            }), {}),
            rows: dbTable.sample_rows,
            virtual: {
                tableId: dbTable.name,
                rowCount: dbTable.row_count,
            },
            anchored: true, // by default, db tables are anchored
            createdBy: 'user',
            attachedMetadata: '',
            source: sourceConfig
        }
       dispatch(dfActions.loadTable(table));
       dispatch(fetchFieldSemanticType(table));
    }


    useEffect(() => {
        fetchTables();
    }, []);

    function uploadFileButton(element: React.ReactNode, buttonSx?: SxProps) {
        return (
            <Tooltip title="upload a csv/tsv file to the local database">
                <span>
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
                </span>
            </Tooltip>
        );
    }

    let tableSelectionPanel = <Box sx={{ 
        px: 0.5, pt: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        width: '100%'
    }}>
        {/* Recent Data Loaders */}
        <Box sx={{ px: 1, mb: 1 }}>
                <Typography variant="caption" sx={{
                    color: "text.disabled",
                    fontSize: "0.75rem",
                    my: 1,
                    display: 'block'
                }}>
                    External Data Loaders
                </Typography>
                <Box sx={{ 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: 0.5,
                    alignItems: 'flex-start',
                    width: '100%',
                    minWidth: 0
                }}>
                    <Chip
                        key="file upload"
                        label="file"
                        size="small"
                        variant="outlined"
                        onClick={() => setSelectedDataLoader("file upload")}
                        sx={{
                            fontSize: '0.7rem',
                            height: 20,
                            maxWidth: '100%',
                            borderColor: selectedDataLoader === "file upload"
                                ? theme.palette.secondary.main
                                : theme.palette.divider,
                            '& .MuiChip-label': {
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            },
                        }}
                    />
                    {Object.keys(dataLoaderMetadata ?? {})
                        .map((dataLoaderType) => (
                            <Chip
                                key={dataLoaderType}
                                label={dataLoaderType}
                                size="small"
                                variant="outlined"
                                onClick={() => setSelectedDataLoader(dataLoaderType)}
                                sx={{
                                    fontSize: '0.7rem',
                                    height: 20,
                                    maxWidth: '100%',
                                    backgroundColor: selectedDataLoader === dataLoaderType 
                                        ? alpha(theme.palette.secondary.main, 0.2) 
                                        : 'transparent',
                                    borderColor: selectedDataLoader === dataLoaderType
                                        ? theme.palette.secondary.main
                                        : theme.palette.divider,
                                    '& .MuiChip-label': {
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    },
                                }}
                            />
                        ))}
                </Box>
            </Box>
        
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, my: 1 }}>
            <Typography variant="caption" sx={{
                color: "text.disabled", 
                fontWeight: "500", 
                flexGrow: 1,
                fontSize: "0.75rem",
            }}>
                Local DuckDB
            </Typography>
            <IconButton 
                ref={menuButtonRef}
                size="small" 
                onClick={(e) => setTableMenuAnchorEl(e.currentTarget)}
                sx={{ 
                    padding: 0.5,
                    '&:hover': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.08),
                    }
                }}
            >
                <MoreVertIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <Menu
                anchorEl={tableMenuAnchorEl}
                open={Boolean(tableMenuAnchorEl)}
                onClose={() => setTableMenuAnchorEl(null)}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
            >
                <MenuItem 
                    onClick={() => {
                        fetchTables();
                        setTableMenuAnchorEl(null);
                    }}
                    dense
                >
                    <RefreshIcon sx={{ fontSize: 16, mr: 1 }} />
                    Refresh table list
                </MenuItem>
                <Divider />
                <MenuItem 
                    onClick={() => {
                        dbFileInputRef.current?.click();
                        setTableMenuAnchorEl(null);
                    }}
                    disabled={isUploading}
                    dense
                >
                    <UploadFileIcon sx={{ fontSize: 16, mr: 1 }} />
                    Import database file
                </MenuItem>
                <MenuItem 
                    onClick={() => {
                        if (!isUploading && dbTables.length > 0) {
                            handleDBDownload(identity.id)
                                .catch(error => {
                                    console.error('Failed to download database:', error);
                                    setSystemMessage('Failed to download database file', "error");
                                });
                        }
                        setTableMenuAnchorEl(null);
                    }}
                    disabled={isUploading || dbTables.length === 0}
                    dense
                >
                    <DownloadIcon sx={{ fontSize: 16, mr: 1 }} />
                    Export database file
                </MenuItem>
                <MenuItem 
                    onClick={() => {
                        setTableMenuAnchorEl(null);
                        if (!isUploading && menuButtonRef.current) {
                            // Use setTimeout to ensure menu closes before popover opens
                            setTimeout(() => {
                                setResetAnchorEl(menuButtonRef.current);
                            }, 100);
                        }
                    }}
                    disabled={isUploading}
                    dense
                    sx={{ color: 'error.main' }}
                >
                    <RestartAltIcon sx={{ fontSize: 16, mr: 1 }} />
                    Reset database
                </MenuItem>
            </Menu>
            <input 
                ref={dbFileInputRef}
                type="file" 
                hidden 
                onChange={handleDBUpload} 
                accept=".db" 
                disabled={isUploading} 
            />
        </Box>
    
        
        {dbTables.length == 0 && 
            <Typography variant="caption" sx={{color: "lightgray", px: 2, py: 0.5, fontStyle: "italic"}}>
                no tables available
            </Typography>
        }
        
        {/* Regular Tables */}
        {dbTables.filter(t => t.view_source === null).map((t, i) => {
            const isLoaded = tables.some(loadedTable => loadedTable.id === t.name);
            return (
                <Button
                    key={t.name}
                    variant="text"
                    size="small"
                    color='primary'
                    onClick={() => {
                        setSelectedTabKey(t.name);
                        // If in data loader view, go back to table view
                        if (selectedDataLoader !== "") {
                            setSelectedDataLoader("");
                        }
                    }}
                    sx={{
                        textTransform: "none",
                        width: '100%',
                        maxWidth: '100%',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        borderRadius: 0,
                        py: 0.5,
                        px: 2,
                        color: (selectedTabKey === t.name && selectedDataLoader === "") ? 'primary.main' : 'text.secondary',
                        borderRight: (selectedTabKey === t.name && selectedDataLoader === "") ? 2 : 0,
                        minWidth: 0,
                    }}
                    startIcon={<TableIcon />}
                    endIcon={isLoaded ? <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} /> : null}
                >
                    <Typography 
                        fontSize='inherit'
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            textAlign: 'left', 
                            textOverflow: 'ellipsis', 
                            overflow: 'hidden', 
                            whiteSpace: 'nowrap',
                        }}>
                        {t.name}
                    </Typography>
                </Button>
            );
        })}
        
        {/* Derived Views Section */}
        {dbTables.filter(t => t.view_source !== null).length > 0 && (
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => setShowViews(!showViews)}
                        sx={{
                            textTransform: "none",
                            flex: 1,
                            justifyContent: 'flex-start',
                            textAlign: 'left',
                            borderRadius: 0,
                            py: 0.5,
                            px: 2,
                            color: 'text.secondary',
                            minWidth: 0,
                            '&:hover': {
                                backgroundColor: alpha(theme.palette.primary.main, 0.08)
                            }
                        }}
                        startIcon={showViews ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
                    >
                        <Typography 
                            fontSize='0.75rem'
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                textAlign: 'left',
                            }}>
                            Views ({dbTables.filter(t => t.view_source !== null).length})
                        </Typography>
                    </Button>
                    <Tooltip title="Clean up unused views">
                        <IconButton
                            size="small"
                            onClick={handleCleanDerivedViews}
                            disabled={dbTables.filter(t => t.view_source !== null && t.view_source !== undefined && !tables.some(t2 => t2.id === t.name)).length === 0}
                            sx={{
                                padding: 0.5,
                                mr: 0.5,
                                '&:hover': {
                                    backgroundColor: alpha(theme.palette.primary.main, 0.08),
                                }
                            }}
                        >
                            <CleaningServicesIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Collapse in={showViews}>
                    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                        {dbTables.filter(t => t.view_source !== null).map((t, i) => {
                            return (
                            <Button
                                key={t.name}
                                variant="text"
                                size="small"
                                onClick={() => {
                                    setSelectedTabKey(t.name);
                                    // If in data loader view, go back to table view
                                    if (selectedDataLoader !== "") {
                                        setSelectedDataLoader("");
                                    }
                                }}
                                sx={{
                                    textTransform: "none",
                                    width: '100%',
                                    maxWidth: '100%',
                                    justifyContent: 'flex-start',
                                    textAlign: 'left',
                                    borderRadius: 0,
                                    py: 0.5,
                                    px: 2,
                                    color: (selectedTabKey === t.name && selectedDataLoader === "") ? 'primary.main' : 'text.secondary',
                                    backgroundColor: 'transparent',
                                    borderRight: (selectedTabKey === t.name && selectedDataLoader === "") ? 2 : 0,
                                    borderColor: 'primary.main',
                                    minWidth: 0,
                                    '&:hover': {
                                        backgroundColor: (selectedTabKey === t.name && selectedDataLoader === "") ? 'primary.100' : 'primary.50'
                                    }
                                }}
                                startIcon={<ViewIcon />}
                            >
                                <Typography 
                                    fontSize='inherit'
                                    sx={{
                                        flex: 1,
                                        minWidth: 0,
                                        textAlign: 'left', 
                                        textOverflow: 'ellipsis', 
                                        overflow: 'hidden', 
                                        whiteSpace: 'nowrap',
                                    }}>
                                    {t.name}
                                </Typography>
                            </Button>
                            );
                        })}
                    </Box>
                </Collapse>
            </Box>
        )}
    </Box>

    let dataConnectorView = <Box sx={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', p: 2, display: 'flex', flexDirection: 'column', minWidth: 0, overscrollBehavior: 'contain' }}>

        
        {/* File upload */}
        {selectedDataLoader === 'file upload' && (
            <Box>
                {uploadFileButton(<Typography component="span" fontSize={18} textTransform="none">{isUploading ? 'uploading...' : 'upload a csv/tsv file to the local database'}</Typography>)} 
            </Box>
        )}
        
        {/* Data loader forms */}
        {dataLoaderMetadata && Object.entries(dataLoaderMetadata).map(([dataLoaderType, metadata]) => (
            selectedDataLoader === dataLoaderType && (
                <Box key={`dataLoader:${dataLoaderType}`} sx={{ position: "relative", maxWidth: '100%' }}>
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
                            fetchTables().then(() => {
                                // Switch back to tables view after import
                                setSelectedDataLoader("");
                                // Navigate to the first imported table after tables are fetched
                                if (status === "success" && importedTables && importedTables.length > 0) {
                                    setSelectedTabKey(importedTables[0]);
                                }
                            });
                            if (status === "error") {
                                setSystemMessage(message, "error");
                            }
                        }} 
                    />
                </Box>
            )
        ))}
    </Box>;

    let tableView = <Box sx={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', p: 2, minWidth: 0, overscrollBehavior: 'contain' }}>
        {/* Empty state */}
        {selectedTabKey === '' && (
            <Typography variant="caption" sx={{color: "text.secondary", px: 1}}>
                The database is empty, refresh the table list or import some data to get started.
            </Typography>
        )}
        
        {/* Table content */}
        {dbTables.map((t, i) => {
            if (selectedTabKey !== t.name) return null;
            
            const currentTable = t;
            
            return (
                <Box key={t.name} sx={{ maxWidth: '100%', overflowX: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ px: 1, display: 'flex', alignItems: 'center' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {currentTable.view_source ? <ViewIcon /> : <TableIcon />}
                            <Typography component="span" sx={{fontSize: 16, fontWeight: "bold"}}>
                                {currentTable.name}
                            </Typography>
                            <Typography component="span" sx={{fontSize: 12, color: 'text.secondary'}}>
                                {currentTable.source_metadata && `imported from ${currentTable.source_metadata.data_loader_type}.${currentTable.source_metadata.source_table_name}`}
                            </Typography>
                        </Box>
                        <Tooltip title="Drop Table">
                            <IconButton 
                                size="small" 
                                color="error"
                                sx={{ml: 'auto'}}
                                onClick={() => handleDropTable(currentTable.name)}
                                title="Drop Table"
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                    <Box sx={{ }}>
                        <Card variant="outlined" sx={{ position: 'relative' }}>
                            <CustomReactTable
                                rows={currentTable.sample_rows.slice(0, 9).map((row: any) => {
                                    return Object.fromEntries(
                                        currentTable.columns.map((col) => [col.name, String(row[col.name] ?? '')])
                                    );
                                })}
                                columnDefs={currentTable.columns.map((col) => ({
                                    id: col.name,
                                    label: col.name,
                                    minWidth: 80
                                }))}
                                rowsPerPageNum={-1}
                                compact={false}
                                maxCellWidth={80}
                                isIncompleteTable={currentTable.row_count > 10}
                                maxHeight={340}
                            />
                        </Card>
                        {currentTable.row_count > 10 && (
                            <Box sx={{ px: 1, py: 0.5}}>
                                <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', fontStyle: 'italic' }}>
                                    Showing first 9 rows of {currentTable.row_count} total rows
                                </Typography>
                            </Box>
                        )}
                    </Box>
                    {tables.some(t => t.id === currentTable.name) ? (
                        <Box 
                            sx={{
                                ml: 'auto',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                color: 'success.main',
                                fontSize: '12px',
                                fontWeight: 500
                            }}
                        >
                            <CheckIcon sx={{ fontSize: 16 }} />
                            <Typography sx={{ fontSize: 'inherit', color: 'inherit', fontWeight: 'inherit' }}>
                                Loaded
                            </Typography>
                        </Box>
                    ) : (
                        <Box sx={{  display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1, mt: 2 }}>
                            {/* Watch settings - only show for tables that can be refreshed */}
                            {currentTable.source_metadata && (
                                <Paper variant="outlined" sx={{ px: 2, py: 1, borderRadius: 1 }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, alignItems: 'center', height: 24 }}>
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={watchEnabled}
                                                    onChange={(e) => setWatchEnabled(e.target.checked)}
                                                    size="small"
                                                />
                                            }
                                            label={
                                                <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
                                                    Watch Mode
                                                </Typography>
                                            }
                                        />
                                        {watchEnabled ? (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, }}>
                                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                                                    check for updates every
                                                </Typography>
                                                {[
                                                    { seconds: 10, label: '10s' },
                                                    { seconds: 30, label: '30s' },
                                                    { seconds: 60, label: '1m' },
                                                    { seconds: 300, label: '5m' },
                                                    { seconds: 600, label: '10m' },
                                                    { seconds: 1800, label: '30m' },
                                                    { seconds: 3600, label: '1h' },
                                                    { seconds: 86400, label: '24h' },
                                                ].map((opt) => (
                                                    <Chip
                                                        key={opt.seconds}
                                                        label={opt.label}
                                                        size="small"
                                                        variant={watchInterval === opt.seconds ? 'filled' : 'outlined'}
                                                        color={watchInterval === opt.seconds ? 'primary' : 'default'}
                                                        onClick={() => setWatchInterval(opt.seconds)}
                                                        sx={{ 
                                                            cursor: 'pointer', 
                                                            fontSize: '0.7rem',
                                                            height: 24,
                                                        }}
                                                    />
                                                ))}
                                            </Box>
                                        ) : <Typography component="span" variant="caption" color="text.secondary">
                                            automatically check and refresh data from the database at regular intervals
                                        </Typography>}
                                    </Box>
                                </Paper>
                            )}
                            <Button 
                                variant="contained"
                                sx={{ textTransform: 'none', ml: 'auto'}}
                                disabled={isUploading || dbTables.length === 0 || dbTables.find(t => t.name === selectedTabKey) === undefined}
                                onClick={() => {
                                    let t = dbTables.find(t => t.name === selectedTabKey);
                                    if (t) {
                                        handleAddTableToDF(t, currentTable.source_metadata ? {
                                            autoRefresh: watchEnabled,
                                            refreshIntervalSeconds: watchInterval
                                        } : undefined);
                                    }
                                }}>
                                Load {watchEnabled? 'Live' : ''} Table
                            </Button>
                        </Box>
                    )}
                </Box>
            );
        })}
    </Box>;

    let mainContent =  
        <Box sx={{ display: 'flex', flexDirection: 'column', bgcolor: 'white', flex: 1, overflow: 'hidden', height: '100%' }}>
            <Box sx={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden', minHeight: 0, height: '100%' }}>
                {/* Button navigation - similar to TableSelectionView */}
                <Box sx={{ display: 'flex', flexDirection: 'column', px: 1, width: 240, minWidth: 240, maxWidth: 240, overflow: 'hidden', height: '100%' }}>
                    <Box sx={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        flex: 1,
                        minHeight: 0,
                        height: '100%',
                        position: 'relative',
                        borderRight: `1px solid ${theme.palette.divider}`,
                        overscrollBehavior: 'contain'
                    }}>
                        {/* Available Tables Section - always visible */}
                        {tableSelectionPanel}
                    </Box>
                    {/* Reset Confirmation Popover */}
                    <Popover
                        open={Boolean(resetAnchorEl)}
                        anchorEl={resetAnchorEl}
                        onClose={() => setResetAnchorEl(null)}
                        anchorOrigin={{
                            vertical: 'bottom',
                            horizontal: 'left',
                        }}
                        transformOrigin={{
                            vertical: 'top',
                            horizontal: 'left',
                        }}
                    >
                        <Box sx={{ p: 1.5, width: '240px' }}>
                            <Typography variant="body2" sx={{ mb: 1.5, fontSize: '12px' }}>
                                Reset backend database and delete all tables? This cannot be undone.
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                <Button
                                    size="small"
                                    onClick={() => setResetAnchorEl(null)}
                                    sx={{ textTransform: 'none', fontSize: '12px', minWidth: 'auto', px: 0.75, py: 0.25, minHeight: '24px' }}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="small"
                                    color="error"
                                    variant="contained"
                                    onClick={async () => {
                                        setResetAnchorEl(null);
                                        await handleDBReset();
                                    }}
                                    sx={{ textTransform: 'none', fontSize: '12px', minWidth: 'auto', px: 0.75, py: 0.25, minHeight: '24px' }}
                                >
                                    Reset
                                </Button>
                            </Box>
                        </Box>
                    </Popover>
                </Box>
                {/* Content area - show connector view if a connector is selected, otherwise show table view */}
                <Box sx={{ flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0, height: '100%', position: 'relative' }}>
                    {selectedDataLoader !== "" ? dataConnectorView : tableView}
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

    const dispatch = useDispatch();
    const theme = useTheme();
    const params = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[dataLoaderType] ?? {});

    const [tableMetadata, setTableMetadata] = useState<Record<string, any>>({});
    let [displaySamples, setDisplaySamples] = useState<Record<string, boolean>>({});
    let [tableFilter, setTableFilter] = useState<string>("");
    const [tableImportConfigs, setTableImportConfigs] = useState<Record<string, TableImportConfig>>({});
    const [subsetConfigAnchor, setSubsetConfigAnchor] = useState<{element: HTMLElement, tableName: string} | null>(null);
    
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
        <TableContainer component={Box} sx={{borderTop: '1px solid rgba(0, 0, 0, 0.1)', maxHeight: 340, overflowY: "auto"}} >
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
        Object.keys(tableMetadata).length > 0 && <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2}}>
            <Button 
                variant="contained" 
                color="secondary"
                disabled={selectedTables.length === 0}
                sx={{ textTransform: 'none' }}
                onClick={() => {
                    const tablesToImport = selectedTables;
                    onImport();
                    
                    // Import all selected tables sequentially
                    const importPromises = tablesToImport.map(tableName => {
                        const config = getTableConfig(tableName);
                        
                        // Build import options based on config
                        const importOptions: any = {};
                        if (config.mode === 'subset') {
                            importOptions.row_limit = config.rowLimit;
                            if (config.sortColumns.length > 0) {
                                importOptions.sort_columns = config.sortColumns;
                                importOptions.sort_order = config.sortOrder;
                            }
                        }
                        
                        return fetchWithIdentity(getUrls().DATA_LOADER_INGEST_DATA, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                data_loader_type: dataLoaderType, 
                                data_loader_params: params, 
                                table_name: tableName,
                                import_options: Object.keys(importOptions).length > 0 ? importOptions : undefined
                            })
                        }).then((response: Response) => response.json());
                    });
                    
                    Promise.all(importPromises)
                        .then(results => {
                            const errors = results.filter(r => r.status !== "success");
                            if (errors.length === 0) {
                                setTableImportConfigs({});
                                // Get the actual table names that were created (may be sanitized)
                                const actualTableNames = results
                                    .filter(r => r.status === "success" && r.table_name)
                                    .map(r => r.table_name);
                                // Fallback to original names if actual names not provided
                                const finalTableNames = actualTableNames.length > 0 ? actualTableNames : tablesToImport;
                                onFinish("success", `Successfully imported ${tablesToImport.length} table(s)`, finalTableNames);
                            } else {
                                // Backend returns 'message' field for errors
                                const errorMessages = errors.map(e => e.message || e.error || 'Unknown error').filter(Boolean);
                                onFinish("error", `Failed to import some tables: ${errorMessages.join(", ")}`);
                            }
                        })
                        .catch(error => {
                            console.error('Failed to ingest data:', error);
                            onFinish("error", `Failed to ingest data: ${error}`);
                        });
                }}
            >
                Import Selected Tables to Local DuckDB ({selectedTables.length})
            </Button>
        </Box>
    ]

    const isConnected = Object.keys(tableMetadata).length > 0;

    return (
        <Box sx={{p: 0}}>
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
                <Box sx={{mt: 2}}>
                    <Box sx={{mb: 2}}>
                        <Box sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 1, mb: 2, flexWrap: "wrap"}}>
                            <Box sx={{flex: 1, minWidth: 200, display: "flex", flexDirection: "row", alignItems: "center", gap: 1.5, flexWrap: "wrap"}}>
                                {paramDefs.filter((paramDef) => params[paramDef.name]).map((paramDef, index) => (
                                    <Box key={paramDef.name} sx={{display: "flex", alignItems: "center", gap: 0.5}}>
                                        <Typography variant="body2" component="span" sx={{fontSize: 13, color: 'text.secondary', fontWeight: 500}}>
                                            {paramDef.name}:
                                        </Typography>
                                        <Typography variant="body2" component="span" sx={{fontSize: 13, color: 'text.primary'}}>
                                            {params[paramDef.name] || '(empty)'}
                                        </Typography>
                                        {index < paramDefs.filter((paramDef) => params[paramDef.name]).length - 1 && (
                                            <Typography variant="body2" component="span" sx={{fontSize: 13, color: 'text.secondary', mx: 0.5}}>
                                                •
                                            </Typography>
                                        )}
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                        <Box sx={{display: "flex", flexDirection: "row", gap: 1}}>
                            <Box sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 1, width: "calc(40% - 1rem)"}}>
                                <Box sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 0.5, minWidth: "70px"}}>
                                    <SearchIcon sx={{ fontSize: 12, color: theme.palette.secondary.main }} />
                                    <Typography 
                                        sx={{
                                            fontSize: 12,
                                            fontWeight: 400,
                                            color: theme.palette.secondary.main
                                        }}
                                    >
                                        table filter
                                    </Typography>
                                </Box>
                                <TextField
                                    sx={{
                                        flex: 1,
                                        '& .MuiInputBase-root': {fontSize: 12, height: '32px'},
                                        '& .MuiInputBase-input': {fontSize: 12, py: 0.75},
                                        '& .MuiInputBase-input::placeholder': {fontSize: 11, fontStyle: "italic"},
                                        '& .MuiOutlinedInput-root': {
                                            '& fieldset': {borderColor: theme.palette.secondary.main},
                                            '&:hover fieldset': {borderColor: theme.palette.secondary.dark},
                                        }
                                    }}
                                    variant="outlined"
                                    size="small"
                                    color="secondary"
                                    autoComplete="off"
                                    placeholder="load only tables containing keywords"
                                    value={tableFilter}
                                    onChange={(event) => setTableFilter(event.target.value)}
                                />
                            </Box>
                            <Box sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 1}}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    sx={{textTransform: "none"}}
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
                                    sx={{textTransform: "none"}}
                                    onClick={() => {
                                        setTableMetadata({});
                                        setTableFilter("");
                                    }}
                                >
                                    Disconnect
                                </Button>
                            </Box>
                        </Box>
                    </Box>
                    
                    {tableMetadataBox}
                </Box>
            ) : (
                // Not connected: show connection forms
                <>
                    <Box sx={{display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 1, mt: 2}}>
                        {paramDefs.map((paramDef) => (
                            <Box key={paramDef.name} 
                                sx={{display: "flex", flexDirection: "row", mr: 1,alignItems: "center", gap: 1, width: "calc(50% - 1rem)"}}>
                                <Typography 
                                    sx={{
                                        minWidth: "70px",
                                        fontSize: 12,
                                        fontWeight: paramDef.required ? 500 : 400,
                                        color: paramDef.required ? 'text.primary' : 'text.secondary'
                                    }}
                                >
                                    {paramDef.name}
                                    {paramDef.required && <span style={{color: 'red'}}> *</span>}
                                </Typography>
                                <TextField
                                    sx={{
                                        flex: 1,
                                        '& .MuiInputBase-root': {fontSize: 12, height: '32px'},
                                        '& .MuiInputBase-input': {fontSize: 12, py: 0.75},
                                        '& .MuiInputBase-input::placeholder': {fontSize: 11, fontStyle: "italic"}
                                    }}
                                    variant="outlined"
                                    size="small"
                                    required={paramDef.required}
                                    value={params[paramDef.name] ?? ''}
                                    placeholder={paramDef.default ? `e.g. ${paramDef.default}` : paramDef.description}
                                    onChange={(event: any) => { 
                                        dispatch(dfActions.updateDataLoaderConnectParam({
                                            dataLoaderType, paramName: paramDef.name, 
                                            paramValue: event.target.value}));
                                    }}
                                />
                            </Box>
                        ))}
                        <Box sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 1, width: "calc(50% - 1rem)", mr: 1}}>
                            <Box sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 0.5, minWidth: "70px"}}>
                                <SearchIcon sx={{ fontSize: 12, color: theme.palette.secondary.main }} />
                                <Typography 
                                    sx={{
                                        fontSize: 12,
                                        fontWeight: 400,
                                        color: theme.palette.secondary.main
                                    }}
                                >
                                    table filter
                                </Typography>
                            </Box>
                            <TextField
                                sx={{
                                    flex: 1,
                                    '& .MuiInputBase-root': {fontSize: 12, height: '32px'},
                                    '& .MuiInputBase-input': {fontSize: 12, py: 0.75},
                                    '& .MuiInputBase-input::placeholder': {fontSize: 11, fontStyle: "italic"},
                                    '& .MuiOutlinedInput-root': {
                                        '& fieldset': {borderColor: theme.palette.secondary.main},
                                        '&:hover fieldset': {borderColor: theme.palette.secondary.dark},
                                    }
                                }}
                                variant="outlined"
                                size="small"
                                color="secondary"
                                autoComplete="off"
                                placeholder="load only tables containing keywords"
                                value={tableFilter}
                                onChange={(event) => setTableFilter(event.target.value)}
                            />
                        </Box>
                        {paramDefs.length > 0 && 
                            <Button 
                                variant="contained"
                                color="primary"
                                sx={{textTransform: "none", minWidth: 120}}
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
                                Connect {tableFilter.trim() ? "with filter" : ""}
                            </Button>}
                    </Box>
                    <Box  sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 1, ml: 4, mt: 4}}>
                        
                    </Box>
                    <Typography variant="body2" sx={{
                        color: "text.secondary",
                        fontSize: 12, overflowY: "auto", whiteSpace: "pre-wrap", p: 1}}>
                        {authInstructions.trim()}
                    </Typography>
                </>
            )}
        </Box>
    );
}