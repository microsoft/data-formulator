// TableManager.tsx
import React, { useState, useEffect, useCallback, FC, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  CircularProgress,
  ButtonGroup,
  ToggleButton,
  ToggleButtonGroup,
  MenuItem,
  Menu,
  Chip,
  Checkbox,
  FormControlLabel,
  styled,
  useTheme,
  Link,
  alpha,
  Tooltip,
} from '@mui/material';

import SearchIcon from '@mui/icons-material/Search';

import Autocomplete from '@mui/material/Autocomplete';

import { getUrls, fetchWithIdentity } from '../app/utils';
import { borderColor } from '../app/tokens';
import { CustomReactTable } from './ReactTable';
import { DataSourceConfig, DictTable } from '../components/ComponentType';
import { Type } from '../data/types';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions, dfSelectors } from '../app/dfSlice';
import { DataFormulatorState } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { loadTable } from '../app/tableThunks';
import { AppDispatch } from '../app/store';
import Markdown from 'markdown-to-jsx';

import CheckIcon from '@mui/icons-material/Check';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';


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
    const { t } = useTranslation();
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

    // loaders whose deps are missing on the server, keyed by name -> install hint
    const [disabledLoaders, setDisabledLoaders] = useState<Record<string, {install_hint: string}>>({});

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
        // In ephemeral mode, tables live in Redux, not on the server
        if (serverConfig.WORKSPACE_BACKEND === 'ephemeral') {
            const localTables: DBTable[] = tables.map(t => ({
                name: t.id,
                columns: t.names.map(n => ({ name: n, type: String(t.metadata?.[n]?.type || 'unknown') })),
                row_count: t.rows.length,
                sample_rows: t.rows.slice(0, 100),
                view_source: null,
            }));
            setDbTables(localTables);
            return localTables;
        }
        try {
            const response = await fetchWithIdentity(getUrls().LIST_TABLES, { method: 'GET' });
            const data = await response.json();
            if (data.status === 'success') {
                setDbTables(data.tables);
                return data.tables;
            }
        } catch (error) {
            setSystemMessage(t('db.failedFetchTables'), "error");
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
                setDisabledLoaders(data.disabled_loaders ?? {});
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
        {/* Active data loaders */}
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

        {/* Disabled loaders (missing deps) — greyed out with install hint */}
        {Object.keys(disabledLoaders).length > 0 && (
            <Divider sx={{ my: 0.5 }} />
        )}
        {Object.entries(disabledLoaders).map(([loaderName, { install_hint }]) => (
            <Tooltip
                key={`disabled-${loaderName}`}
                title={t('db.notInstalledHint', { hint: install_hint })}
                placement="right"
                arrow
            >
                <span style={{ width: '100%' }}>
                <Button
                    variant="text"
                    size="small"
                    disabled
                    sx={{
                        fontSize: 12,
                        textTransform: "none",
                        width: '100%',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        borderRadius: 0,
                        py: 1,
                        px: 2,
                        color: 'text.disabled !important',
                        cursor: 'default',
                        userSelect: 'none',
                        minWidth: 0,
                        '&.Mui-disabled': {
                            color: 'text.disabled',
                        },
                    }}
                >
                    {loaderName}
                </Button>
                </span>
            </Tooltip>
        ))}
    </Box>

    let dataConnectorView = <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', overflowX: 'hidden', p: 2, pb: 4, display: 'flex', flexDirection: 'column', minWidth: 0, overscrollBehavior: 'contain' }}>

        {/* Empty state when no loader selected */}
        {selectedDataLoader === '' && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'text.disabled' }}>
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                    {t('db.selectDataLoader')}
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
                                setSystemMessage(message, "success");
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
                    flexDirection: 'column',
                    alignItems: 'center', 
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.85)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 1000,
                    gap: 2,
                }}>
                    <CircularProgress size={60} thickness={5} />
                    <Typography variant="body2" color="text.secondary">
                        {t('db.uploadingData')}
                    </Typography>
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => setIsUploading(false)}
                        sx={{ mt: 1, textTransform: 'none', color: 'text.secondary' }}
                    >
                        {t('app.cancel')}
                    </Button>
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
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();
    const params = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[dataLoaderType] ?? {});
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 50000);
    const workspaceTables = useSelector((state: DataFormulatorState) => state.tables);

    const [tableMetadata, setTableMetadata] = useState<Record<string, any>>({});
    const [selectedPreviewTable, setSelectedPreviewTable] = useState<string | null>(null);
    let [tableFilter, setTableFilter] = useState<string>("");
    // Import mode for the currently selected table
    const [importMode, setImportMode] = useState<'full' | 'subset'>('full');
    const [subsetConfig, setSubsetConfig] = useState<{ rowLimit: number; sortColumns: string[]; sortOrder: 'asc' | 'desc' }>({ rowLimit: 1000, sortColumns: [], sortOrder: 'asc' });
    // Track which tables have been loaded and how (persists across table selections)
    const [loadedTables, setLoadedTables] = useState<Record<string, 'full' | 'subset'>>({});

    // Cross-reference workspace tables with database tables to detect already-loaded ones
    const workspaceLoadedTables = useMemo(() => {
        const result: Record<string, 'full' | 'subset'> = {};
        for (const wt of workspaceTables) {
            const dbTableName = wt.source?.databaseTable;
            if (dbTableName && wt.source?.type === 'database') {
                // Determine if subset: if virtual exists and rowCount > loaded rows, it's a subset
                const isSubset = wt.virtual ? wt.rows.length < wt.virtual.rowCount : false;
                result[dbTableName] = isSubset ? 'subset' : 'full';
            }
        }
        return result;
    }, [workspaceTables]);

    // Merge: local session loads take priority over workspace-detected loads
    const effectiveLoadedTables = useMemo(() => {
        return { ...workspaceLoadedTables, ...loadedTables };
    }, [workspaceLoadedTables, loadedTables]);

    let [isConnecting, setIsConnecting] = useState(false);

    // Auto-select first table for preview when metadata loads
    useEffect(() => {
        const tableNames = Object.keys(tableMetadata);
        if (tableNames.length > 0 && (!selectedPreviewTable || !tableMetadata[selectedPreviewTable])) {
            setSelectedPreviewTable(tableNames[0]);
        }
    }, [tableMetadata]);

    // Reset import mode when switching tables
    useEffect(() => {
        if (selectedPreviewTable && tableMetadata[selectedPreviewTable]) {
            setImportMode('full');
            const metadata = tableMetadata[selectedPreviewTable];
            setSubsetConfig({ rowLimit: Math.min(1000, metadata.row_count || 1000), sortColumns: [], sortOrder: 'asc' });
        }
    }, [selectedPreviewTable]);

    // Build preview DictTable for the selected table
    const previewTable: DictTable | null = useMemo(() => {
        if (!selectedPreviewTable || !tableMetadata[selectedPreviewTable]) return null;
        const metadata = tableMetadata[selectedPreviewTable];
        const sampleRows = metadata.sample_rows || [];
        const columns = metadata.columns || [];
        const names = columns.map((c: any) => c.name);
        return {
            kind: 'table' as const,
            id: selectedPreviewTable,
            displayId: selectedPreviewTable,
            names,
            rows: sampleRows,
            metadata: names.reduce((acc: Record<string, any>, name: string) => ({
                ...acc,
                [name]: { type: 'string' as any, semanticType: '', levels: [] }
            }), {}),
            virtual: { tableId: selectedPreviewTable, rowCount: metadata.row_count || sampleRows.length },
            anchored: true,
            attachedMetadata: '',
        };
    }, [selectedPreviewTable, tableMetadata]);

    const tableNames = Object.keys(tableMetadata);

    let tableMetadataBox = [
        // Tables as chips + preview below
        tableNames.length > 0 && (
            <Box key="table-chips-preview" sx={{ mt: 1 }}>
                {/* Table chips */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
                    {tableNames.map((tableName) => {
                        const metadata = tableMetadata[tableName];
                        const isSelected = tableName === selectedPreviewTable;
                        const loaded = effectiveLoadedTables[tableName];
                        return (
                            <Chip
                                key={tableName}
                                label={tableName}
                                size="small"
                                onClick={() => setSelectedPreviewTable(tableName)}
                                icon={loaded ? <CheckIcon sx={{ fontSize: 14 }} /> : undefined}
                                sx={{
                                    cursor: 'pointer',
                                    fontSize: 11,
                                    height: 26,
                                    borderRadius: 1,
                                    ...(loaded === 'full' ? {
                                        backgroundColor: alpha(theme.palette.success.main, 0.12),
                                        borderColor: alpha(theme.palette.success.main, 0.5),
                                        color: theme.palette.success.dark,
                                        '& .MuiChip-icon': { color: theme.palette.success.main },
                                    } : loaded === 'subset' ? {
                                        backgroundColor: alpha('#f9a825', 0.15),
                                        borderColor: alpha('#f9a825', 0.5),
                                        color: '#e65100',
                                        '& .MuiChip-icon': { color: '#f9a825' },
                                    } : isSelected ? {
                                        backgroundColor: alpha(theme.palette.primary.main, 0.12),
                                        borderColor: alpha(theme.palette.primary.main, 0.5),
                                        color: theme.palette.primary.main,
                                    } : {}),
                                    border: '1px solid',
                                    borderColor: loaded === 'full' 
                                        ? alpha(theme.palette.success.main, 0.5)
                                        : loaded === 'subset' 
                                            ? alpha('#f9a825', 0.5) 
                                            : isSelected 
                                                ? alpha(theme.palette.primary.main, 0.5)
                                                : 'rgba(0,0,0,0.15)',
                                    '&:hover': {
                                        backgroundColor: loaded === 'full'
                                            ? alpha(theme.palette.success.main, 0.18)
                                            : loaded === 'subset'
                                                ? alpha('#f9a825', 0.22)
                                                : alpha(theme.palette.primary.main, 0.08),
                                    },
                                }}
                            />
                        );
                    })}
                </Box>

                {/* Preview + load controls */}
                {previewTable && selectedPreviewTable && (
                    <Box>
                        <Card variant="outlined" sx={{ pb: 0.5 }}>
                            <CustomReactTable
                                rows={previewTable.rows.slice(0, 12)}
                                columnDefs={previewTable.names.map(name => ({
                                    id: name,
                                    label: name,
                                    minWidth: 60,
                                }))}
                                rowsPerPageNum={-1}
                                compact={false}
                                isIncompleteTable={previewTable.rows.length > 12}
                                maxHeight={240}
                            />
                        </Card>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            {tableMetadata[selectedPreviewTable]?.row_count > 0 
                                ? t('db.rowsCount', { count: tableMetadata[selectedPreviewTable].row_count.toLocaleString() })
                                : t('db.sampleRowsCount', { count: previewTable.rows.length })
                            } × {previewTable.names.length} {t('db.columns')}
                        </Typography>

                        {/* Load controls */}
                        <Box sx={{ mt: 1.5, pt: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, flexWrap: 'nowrap' }}>
                            {/* Subset option - hidden when already loaded */}
                            {!effectiveLoadedTables[selectedPreviewTable] && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap' }}>
                                <Checkbox
                                    checked={importMode === 'subset'}
                                    onChange={(e) => setImportMode(e.target.checked ? 'subset' : 'full')}
                                    size="small"
                                    sx={{ p: 0.25 }}
                                />
                                <Typography variant="body2" sx={{ fontSize: 12, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                                    onClick={() => setImportMode(importMode === 'subset' ? 'full' : 'subset')}
                                >
                                    {t('db.loadSubset')}
                                </Typography>
                                {importMode === 'subset' && selectedPreviewTable && tableMetadata[selectedPreviewTable] && (() => {
                                    const metadata = tableMetadata[selectedPreviewTable];
                                    return (
                                        <>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                                                <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>{t('db.rowsLabel')}</Typography>
                                                <TextField
                                                    size="small"
                                                    type="number"
                                                    value={subsetConfig.rowLimit}
                                                    onChange={(e) => {
                                                        const value = parseInt(e.target.value) || 1;
                                                        const maxRows = metadata.row_count || 100000;
                                                        setSubsetConfig(prev => ({ ...prev, rowLimit: Math.min(Math.max(1, value), maxRows) }));
                                                    }}
                                                    slotProps={{ input: { inputProps: { min: 1, max: metadata.row_count || 100000, step: 100 } } }}
                                                    sx={{ width: 90, '& .MuiInputBase-root': { fontSize: 11, height: 26 }, '& .MuiInputBase-input': { py: 0.25, px: 0.75 } }}
                                                />
                                                <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', whiteSpace: 'nowrap' }}>/ {(metadata.row_count || '?').toLocaleString()}</Typography>
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: 400 }}>
                                                <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>{t('app.sort')}:</Typography>
                                                <Autocomplete
                                                    multiple
                                                    size="small"
                                                    options={metadata.columns.map((col: any) => col.name)}
                                                    value={subsetConfig.sortColumns}
                                                    onChange={(_, newValue) => setSubsetConfig(prev => ({ ...prev, sortColumns: newValue }))}
                                                    renderInput={(params) => (
                                                        <TextField {...params} placeholder={t('db.selectColumns')} size="small" sx={{ minWidth: 120, '& .MuiInputBase-root': { fontSize: 11, minHeight: 26, py: 0 } }} />
                                                    )}
                                                    renderTags={(value, getTagProps) =>
                                                        value.map((option, index) => (
                                                            <Chip {...getTagProps({ index })} key={option} label={option} size="small" sx={{ height: 18, fontSize: 10 }} />
                                                        ))
                                                    }
                                                    slotProps={{ paper: { sx: { fontSize: 12, '& .MuiAutocomplete-option': { fontSize: 12, py: 0.5, minHeight: 28 } } } }}
                                                    sx={{ flex: 1, minWidth: 0 }}
                                                />
                                                {subsetConfig.sortColumns.length > 0 && (
                                                    <ToggleButtonGroup
                                                        value={subsetConfig.sortOrder}
                                                        exclusive
                                                        onChange={(_, v) => { if (v) setSubsetConfig(prev => ({ ...prev, sortOrder: v })); }}
                                                        size="small"
                                                        sx={{ height: 24 }}
                                                    >
                                                        <ToggleButton value="asc" sx={{ px: 1, py: 0, fontSize: 10, textTransform: 'none' }}>↑</ToggleButton>
                                                        <ToggleButton value="desc" sx={{ px: 1, py: 0, fontSize: 10, textTransform: 'none' }}>↓</ToggleButton>
                                                    </ToggleButtonGroup>
                                                )}
                                            </Box>
                                        </>
                                    );
                                })()}
                            </Box>}
                            {/* Load Table button */}
                            {effectiveLoadedTables[selectedPreviewTable] ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                                <Button
                                    variant="outlined"
                                    size="medium"
                                    disabled
                                    startIcon={<CheckIcon sx={{ fontSize: 16 }} />}
                                    sx={{ textTransform: 'none', fontSize: 13, px: 3, height: 34,
                                        color: 'success.main', borderColor: 'success.main',
                                        '&.Mui-disabled': { color: 'success.main', borderColor: 'success.main', opacity: 0.8 },
                                    }}
                                >
                                    {effectiveLoadedTables[selectedPreviewTable] === 'subset' ? t('db.subsetLoaded') : t('db.loaded')}
                                </Button>
                                <Button
                                    variant="text"
                                    size="small"
                                    onClick={() => {
                                        const tableName = selectedPreviewTable;
                                        // Find and remove the workspace table that matches this database table
                                        const wt = workspaceTables.find(t => t.source?.databaseTable === tableName && t.source?.type === 'database');
                                        if (wt) {
                                            dispatch(dfActions.deleteTable(wt.id));
                                        }
                                        setLoadedTables(prev => {
                                            const next = { ...prev };
                                            delete next[tableName];
                                            return next;
                                        });
                                    }}
                                    sx={{ textTransform: 'none', fontSize: 11, px: 1, minWidth: 0, height: 28, color: 'text.secondary',
                                        '&:hover': { color: 'error.main', backgroundColor: 'rgba(211,47,47,0.04)' },
                                    }}
                                >
                                    {t('db.unload')}
                                </Button>
                            </Box>
                            ) : (
                            <Button
                                variant="contained"
                                size="medium"
                                sx={{ textTransform: 'none', fontSize: 13, px: 4, height: 34, flexShrink: 0 }}
                                onClick={() => {
                                    const tableName = selectedPreviewTable;
                                    const metadata = tableMetadata[tableName];
                                    if (!metadata) return;

                                    const importOptions: any = {};
                                    if (importMode === 'subset') {
                                        importOptions.rowLimit = subsetConfig.rowLimit;
                                        if (subsetConfig.sortColumns.length > 0) {
                                            importOptions.sortColumns = subsetConfig.sortColumns;
                                            importOptions.sortOrder = subsetConfig.sortOrder;
                                        }
                                    }

                                    const sampleRows = metadata.sample_rows || [];
                                    const columns = metadata.columns || [];
                                    const tableObj: DictTable = {
                                        kind: 'table' as const,
                                        id: tableName.split('.').pop() || tableName,
                                        displayId: tableName,
                                        names: columns.map((c: any) => c.name),
                                        metadata: columns.reduce((acc: Record<string, any>, col: any) => ({
                                            ...acc,
                                            [col.name]: { type: 'string' as any, semanticType: '', levels: [] }
                                        }), {}),
                                        rows: sampleRows,
                                        virtual: { tableId: tableName.split('.').pop() || tableName, rowCount: metadata.row_count || sampleRows.length },
                                        anchored: true,
                                        attachedMetadata: '',
                                        source: {
                                            type: 'database' as const,
                                            databaseTable: tableName,
                                            canRefresh: true,
                                            lastRefreshed: Date.now(),
                                        },
                                    };

                                    onImport();
                                    dispatch(loadTable({
                                        table: tableObj,
                                        dataLoaderType,
                                        dataLoaderParams: params,
                                        sourceTableName: tableName,
                                        importOptions: Object.keys(importOptions).length > 0 ? importOptions : undefined,
                                    })).unwrap()
                                        .then((result) => {
                                            setLoadedTables(prev => ({ ...prev, [tableName]: importMode }));
                                            onFinish("success", `Loaded table "${tableName}"`, [result.table.id]);
                                        })
                                        .catch((error) => {
                                            console.error('Failed to load data:', error);
                                            onFinish("error", `Failed to load "${tableName}": ${error}`);
                                        });
                                }}
                            >
                                {importMode === 'subset' ? t('db.loadTableSubset') : t('db.loadTableBtn')}
                            </Button>
                            )}
                        </Box>
                    </Box>
                )}
            </Box>
        ),
    ]

    const isConnected = Object.keys(tableMetadata).length > 0;

    return (
        <Box sx={{p: 0, pb: 2}}>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.7)"
            }}>
                <CircularProgress size={20} />
            </Box>}
            {isConnected ? (
                // Connected state: show connection parameters and disconnect button
                <Box sx={{}}>
                    <Box sx={{mb: 1.5}}>
                        <Box sx={{display: "flex", flexDirection: "row", alignItems: "center", gap: 0.5, mb: 1.5, flexWrap: "wrap"}}>
                            <Typography variant="body2" component="span" sx={{fontSize: 11, color: 'secondary.main', fontWeight: 600, mr: 0.5}}>
                                {dataLoaderType}
                            </Typography>
                            {paramDefs.filter((paramDef) => params[paramDef.name]).length > 0 && (
                                <Typography variant="body2" component="span" sx={{fontSize: 11, color: 'text.disabled', mr: 0.5}}>·</Typography>
                            )}
                            {paramDefs.filter((paramDef) => params[paramDef.name]).map((paramDef, index) => (
                                <React.Fragment key={paramDef.name}>
                                    <Typography variant="body2" component="span" sx={{fontSize: 11, color: 'text.secondary'}}>
                                        {paramDef.name}:
                                    </Typography>
                                    <Typography variant="body2" component="span" sx={{fontSize: 11, color: 'text.primary', fontWeight: 500, mr: 0.5}}>
                                        {params[paramDef.name] || t('db.emptyValue')}
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
                                    <SearchIcon sx={{ fontSize: 11 }} /> {t('db.tableFilter')}
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
                                    placeholder={t('db.tableFilterPlaceholder')}
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
                                        onFinish("error", t('db.failedFetchLoaderTables', { message: data.message }));
                                    }
                                    setIsConnecting(false);
                                })
                                .catch((error: any) => {
                                    onFinish("error", t('db.failedFetchLoaderTablesServer'));
                                    setIsConnecting(false);
                                });
                                }}
                            >
                                {t('db.refresh')}
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
                                {t('db.disconnect')}
                            </Button>
                        </Box>
                    </Box>
                    
                    {tableMetadataBox}
                </Box>
            ) : (
                // Not connected: show connection forms
                <>
                    <Typography variant="body2" sx={{fontSize: 12, color: 'secondary.main', fontWeight: 600, mt: 1}}>
                        {dataLoaderType}
                    </Typography>
                    <Box sx={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, 1fr)",
                        gap: 1.5,
                        mt: 1,
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
                                <SearchIcon sx={{ fontSize: 11 }} /> {t('db.tableFilter')}
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
                                placeholder={t('db.tableFilterPlaceholder')}
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
                                        onFinish("error", t('db.failedFetchLoaderTables', { message: data.message }));
                                    }
                                    setIsConnecting(false);
                                })
                                .catch((error: any) => {
                                    onFinish("error", t('db.failedFetchLoaderTablesServer'));
                                    setIsConnecting(false);
                                });
                            }}>
                                {t('db.connect', { suffix: tableFilter.trim() ? t('db.withFilter') : '' })}
                            </Button>}
                    </Box>
                    {authInstructions.trim() && (
                        <Box sx={(theme) => ({
                            mt: 2, px: 1.5, py: 1, 
                            backgroundColor: 'rgba(0,0,0,0.02)',
                            borderRadius: 1,
                            border: '1px solid rgba(0,0,0,0.06)',
                            fontFamily: theme.typography.fontFamily,
                            fontSize: '11px',
                            color: 'text.secondary',
                            lineHeight: 1.6,
                            '& *': { fontFamily: theme.typography.fontFamily, fontSize: 'inherit', lineHeight: 'inherit', color: 'inherit' },
                            '& p': { margin: '0 0 4px 0', '&:last-child': { marginBottom: 0 } },
                            '& code': { fontSize: '10px', fontFamily: 'monospace !important', backgroundColor: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: '3px' },
                            '& pre': { fontSize: '10px', fontFamily: 'monospace !important', backgroundColor: 'rgba(0,0,0,0.04)', padding: '8px', borderRadius: '4px', overflow: 'auto', margin: '4px 0', '& code': { backgroundColor: 'transparent', padding: 0 } },
                            '& a': { color: 'primary.main' },
                            '& ul, & ol': { paddingLeft: '20px', margin: '4px 0' },
                            '& li': { marginBottom: '2px' },
                            '& strong': { fontWeight: 600, color: 'text.primary' },
                            '& h1, & h2, & h3, & h4': { fontSize: '12px', fontWeight: 600, color: 'text.primary', margin: '4px 0' },
                        })}>
                            <Markdown>{authInstructions.trim()}</Markdown>
                        </Box>
                    )}</>
            )}
        </Box>
    );
}