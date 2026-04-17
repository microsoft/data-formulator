// TableManager.tsx
import React, { useState, useEffect, useCallback, FC, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Card, 
  Typography, 
  Button, 
  Box,
  IconButton,
  TextField,
  Divider,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  MenuItem,
  Checkbox,
  FormControlLabel,
  styled,
  useTheme,
  Tooltip,
} from '@mui/material';

import SearchIcon from '@mui/icons-material/Search';

import Autocomplete from '@mui/material/Autocomplete';

import { getUrls, CONNECTOR_ACTION_URLS, fetchWithIdentity } from '../app/utils';
import { borderColor } from '../app/tokens';
import { CustomReactTable } from './ReactTable';
import { DictTable } from '../components/ComponentType';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { DataFormulatorState } from '../app/dfSlice';
import { fetchFieldSemanticType } from '../app/dfSlice';
import { loadTable, buildDictTableFromWorkspace } from '../app/tableThunks';
import { AppDispatch } from '../app/store';
import Markdown from 'markdown-to-jsx';

import CheckIcon from '@mui/icons-material/Check';

import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { TableIcon } from '../icons';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem, treeItemClasses } from '@mui/x-tree-view/TreeItem';

// ---------- Catalog tree types & helpers ----------

/** A node returned by the catalog/tree endpoint */
interface CatalogTreeNode {
    name: string;
    node_type: 'namespace' | 'table' | 'table_group';
    path: string[];
    metadata: Record<string, any> | null;
    children?: CatalogTreeNode[];
}

/** A source filter definition from the backend (e.g. Superset native filter). */
interface SourceFilter {
    name: string;
    column: string;
    input_type: 'select' | 'numeric' | 'time' | 'text';
    column_type: string;
    multi: boolean;
    required: boolean;
    default_value?: unknown;
    applies_to?: number[];
    options?: string[];
}

/** Collect all namespace item IDs for default-expanded state */
function collectNamespaceIds(nodes: CatalogTreeNode[]): string[] {
    const ids: string[] = [];
    for (const n of nodes) {
        if (n.node_type === 'namespace') {
            ids.push(n.path.join('/'));
            if (n.children) ids.push(...collectNamespaceIds(n.children));
        }
    }
    return ids;
}

/** Find a node by path in the catalog tree */
function findNodeByPath(nodes: CatalogTreeNode[], itemId: string): CatalogTreeNode | null {
    for (const n of nodes) {
        if (n.path.join('/') === itemId) return n;
        if (n.children) {
            const found = findNodeByPath(n.children, itemId);
            if (found) return found;
        }
    }
    return null;
}

/** Styled TreeItem — clean, compact, GitHub-flavoured. */
const StyledTreeItem = styled(TreeItem)(({ theme }) => ({
    [`& .${treeItemClasses.groupTransition}`]: {
        marginLeft: 12,
        paddingLeft: 8,
        borderLeft: `1px solid ${theme.palette.divider}`,
    },
    [`& > .${treeItemClasses.content}`]: {
        padding: '2px 6px',
        borderRadius: 6,
        gap: 4,
        [`& .${treeItemClasses.iconContainer}`]: {
            width: 16, minWidth: 16,
            color: theme.palette.text.disabled,
        },
        // Hide the empty icon container on leaf items (no expand/collapse arrow)
        [`& .${treeItemClasses.iconContainer}:empty`]: {
            display: 'none',
        },
        [`& .${treeItemClasses.label}`]: {
            fontSize: 13,
        },
        '&:hover': { backgroundColor: theme.palette.action.hover },
    },
    [`& > .${treeItemClasses.content}.Mui-selected`]: {
        backgroundColor: theme.palette.action.selected,
        fontWeight: 500,
        '&:hover': { backgroundColor: theme.palette.action.selected },
    },
})) as typeof TreeItem;

// ---------- End catalog tree ----------


export const handleDBDownload = async (identityId: string) => {
    const response = await fetchWithIdentity(
        getUrls().DOWNLOAD_DB_FILE,
        { method: 'GET' }
    );
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'Failed to download database file');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `df_${identityId?.slice(0, 4) || 'db'}.db`;
    document.body.appendChild(link);    
    
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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



export const DBManagerPane: React.FC<{ 
    onClose?: () => void;
}> = function DBManagerPane({ onClose }) {
    const { t } = useTranslation();
    const theme = useTheme();

    const dispatch = useDispatch<AppDispatch>();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

    // Disabled data sources (missing deps) from app-config
    const disabledSources = serverConfig.DISABLED_SOURCES ?? {};

    // Sources with vault credentials or active in-memory loaders
    const [connectedIds, setConnectedIds] = useState<Set<string>>(
        new Set(serverConfig.CONNECTED_CONNECTORS ?? [])
    );

    // Split sources into connected vs available
    const allSources = serverConfig.CONNECTORS ?? [];
    const connectedSources = allSources.filter(s => connectedIds.has(s.source_id));
    const availableSources = allSources.filter(s => !connectedIds.has(s.source_id));

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

    useEffect(() => {
        fetchTables();
    }, []);

    const sourceButtonSx = (sourceId: string) => ({
        fontSize: 12,
        textTransform: "none" as const,
        width: '100%',
        justifyContent: 'flex-start',
        textAlign: 'left' as const,
        borderRadius: 0,
        py: 1,
        px: 2,
        color: selectedDataLoader === sourceId ? 'primary.main' : 'text.secondary',
        borderRight: selectedDataLoader === sourceId ? 2 : 0,
        borderColor: 'primary.main',
    });

    let tableSelectionPanel = <Box sx={{ 
        pt: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        width: '100%',
    }}>
        {/* Connected sources — user has stored or active credentials */}
        {connectedSources.length > 0 && (
            <Typography variant="caption" sx={{ px: 2, pt: 0.5, pb: 0.5, color: 'text.disabled', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('db.connectedSection')}
            </Typography>
        )}
        {connectedSources.map((source) => (
            <Button
                key={`source-${source.source_id}`}
                variant="text"
                size="small"
                color="primary"
                onClick={() => setSelectedDataLoader(source.source_id)}
                sx={sourceButtonSx(source.source_id)}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%' }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.name}</span>
                </Box>
            </Button>
        ))}

        {/* Available sources — registered but no credentials */}
        {availableSources.length > 0 && (
            <Typography variant="caption" sx={{ px: 2, pt: 1, pb: 0.5, color: 'text.disabled', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('db.availableSection')}
            </Typography>
        )}
        {availableSources.map((source) => (
            <Button
                key={`source-${source.source_id}`}
                variant="text"
                size="small"
                color="primary"
                onClick={() => setSelectedDataLoader(source.source_id)}
                sx={sourceButtonSx(source.source_id)}
            >
                {source.name}
            </Button>
        ))}

        {/* Disabled sources (missing deps) — greyed out with install hint */}
        {Object.keys(disabledSources).length > 0 && (
            <Divider sx={{ my: 0.5 }} />
        )}
        {Object.entries(disabledSources).map(([sourceName, { install_hint }]) => (
            <Tooltip
                key={`disabled-${sourceName}`}
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
                    {sourceName}
                </Button>
                </span>
            </Tooltip>
        ))}
    </Box>

    let dataConnectorView = <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', overflowX: 'hidden', p: 2, pb: 4, display: 'flex', flexDirection: 'column', minWidth: 0, overscrollBehavior: 'contain' }}>

        {/* Empty state when no source selected */}
        {selectedDataLoader === '' && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'text.disabled' }}>
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                    {t('db.selectDataLoader')}
                </Typography>
            </Box>
        )}

        {/* Data source forms (connected + available) */}
        {allSources.map((source) => (
            selectedDataLoader === source.source_id && (
                <Box key={`source:${source.source_id}`} sx={{ position: "relative", maxWidth: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <DataLoaderForm 
                        key={`source-form-${source.source_id}`}
                        dataLoaderType={source.source_id}
                        paramDefs={source.params_form}
                        authInstructions={source.auth_instructions}
                        connectorId={source.source_id}
                        autoConnect={connectedIds.has(source.source_id)}
                        delegatedLogin={source.delegated_login}
                        authMode={source.auth_mode}
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
                        onConnected={() => {
                            setConnectedIds(prev => new Set([...prev, source.source_id]));
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

// ---------------------------------------------------------------------------
// GroupLoadPanel — right panel for table_group nodes (BI dashboards)
// ---------------------------------------------------------------------------

const GroupLoadPanel: React.FC<{
    groupName: string;
    tables: { name: string; dataset_id: number; row_count?: number; columns?: string[] }[];
    sourceFilters: SourceFilter[];
    frontendRowLimit: number;
    rowLimitPresets: number[];
    connectorId: string;
    loadedKey?: string;
    onLoaded: (label: string) => void;
    onImport: () => void;
    onFinish: (severity: "error" | "success", msg: string, tableIds?: string[]) => void;
}> = ({ groupName, tables, sourceFilters, frontendRowLimit, rowLimitPresets, connectorId, loadedKey, onLoaded, onImport, onFinish }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    // Filter values state — keyed by filter name
    const [filterValues, setFilterValues] = useState<Record<string, any>>(() => {
        const defaults: Record<string, any> = {};
        for (const f of sourceFilters) {
            if (f.default_value != null) defaults[f.name] = f.default_value;
        }
        return defaults;
    });

    // Row limit
    const [rowLimit, setRowLimit] = useState<number>(-1);

    // Loading state
    const [isLoading, setIsLoading] = useState(false);

    const totalRows = tables.reduce((sum, t) => sum + (t.row_count ?? 0), 0);

    const handleLoadGroup = async () => {
        setIsLoading(true);
        onImport();
        try {
            // Build source_filters payload from user-selected values
            const appliedFilters: { column: string; operator: string; value: any; applies_to?: number[] }[] = [];
            for (const f of sourceFilters) {
                const val = filterValues[f.name];
                if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
                if (f.multi && Array.isArray(val)) {
                    appliedFilters.push({ column: f.column, operator: 'IN', value: val, applies_to: f.applies_to });
                } else if (f.input_type === 'numeric') {
                    appliedFilters.push({ column: f.column, operator: 'EQ', value: val, applies_to: f.applies_to });
                } else {
                    appliedFilters.push({ column: f.column, operator: 'EQ', value: val, applies_to: f.applies_to });
                }
            }

            const resp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.IMPORT_GROUP, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connector_id: connectorId,
                    tables: tables.map(t => ({ dataset_id: t.dataset_id, name: t.name })),
                    row_limit: rowLimit > 0 ? rowLimit : -1,
                    source_filters: appliedFilters,
                    group_name: groupName,
                }),
            });
            const data = await resp.json();

            if (data.status === 'success') {
                const results: any[] = data.results || [];
                const succeeded = results.filter(r => r.status === 'success');
                const failed = results.filter(r => r.status === 'error');

                // Fetch workspace table list to get full data for loaded tables
                const listResp = await fetchWithIdentity(getUrls().LIST_TABLES, { method: 'GET' });
                const listData = await listResp.json();
                if (listData.status === 'success') {
                    for (const r of succeeded) {
                        const wsTable = (listData.tables || []).find((t: any) => t.name === r.table_name);
                        if (wsTable) {
                            const source = {
                                type: 'database' as const,
                                databaseTable: r.table_name,
                                canRefresh: true,
                                lastRefreshed: Date.now(),
                                connectorId,
                            };
                            const tableObj = buildDictTableFromWorkspace(wsTable, source);
                            dispatch(dfActions.addTableToStore(tableObj));
                            dispatch(fetchFieldSemanticType(tableObj));
                        }
                    }
                }

                onLoaded('loaded');
                if (failed.length > 0) {
                    onFinish("error", `Loaded ${succeeded.length} tables, ${failed.length} failed`);
                } else {
                    onFinish("success", `Loaded ${succeeded.length} tables from "${groupName}"`,
                        succeeded.map(r => r.table_name));
                }
            } else {
                throw new Error(data.message || 'Failed to load group');
            }
        } catch (err: any) {
            onFinish("error", err.message || 'Failed to load dashboard');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexShrink: 0 }}>
                <DashboardOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{groupName}</Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                    {tables.length} {tables.length === 1 ? 'table' : 'tables'}
                    {totalRows > 0 && ` · ~${totalRows.toLocaleString()} rows`}
                </Typography>
            </Box>

            {/* Scrollable content */}
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {/* Tables list */}
                <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Tables
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
                        {tables.map((tbl, idx) => (
                                <Box key={idx} sx={{ mb: 0.25 }}>
                                    <Box sx={{
                                        display: 'flex', alignItems: 'center', gap: 0.75, py: 0.5, px: 0.5,
                                        borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' },
                                    }}>
                                        <TableIcon sx={{ fontSize: 14, color: 'text.secondary', opacity: 0.7 }} />
                                        <Typography sx={{ fontSize: 12, flex: 1 }}>{tbl.name}</Typography>
                                        {tbl.row_count != null && (
                                            <Typography sx={{ fontSize: 11, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
                                                {Number(tbl.row_count).toLocaleString()} rows
                                            </Typography>
                                        )}
                                        {tbl.columns && (
                                            <Typography component="span" sx={{ fontSize: 11, color: 'text.disabled' }}>
                                                {tbl.columns.length} cols
                                            </Typography>
                                        )}
                                    </Box>
                                    {tbl.columns && tbl.columns.length > 0 && (
                                        <Typography sx={{ fontSize: 11, color: 'text.disabled', pl: 3.5, pb: 0.5, lineHeight: 1.6 }}>
                                            {tbl.columns.join(', ')}
                                        </Typography>
                                    )}
                                </Box>
                            ))}
                    </Box>
                </Box>

                {/* Source Filters */}
                {sourceFilters.length > 0 && (
                    <Box>
                        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            Filters
                        </Typography>
                        <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                            {sourceFilters.map((f, idx) => (
                                <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography sx={{ fontSize: 12, minWidth: 80, color: 'text.secondary' }}>
                                        {f.name}
                                        {f.required && <Box component="span" sx={{ color: 'error.main', ml: 0.25 }}>*</Box>}
                                    </Typography>
                                    {f.input_type === 'select' ? (
                                        <Autocomplete
                                            multiple={f.multi} freeSolo size="small"
                                            options={f.options || []}
                                            value={filterValues[f.name] ?? (f.multi ? [] : '')}
                                            onChange={(_e, newVal) => setFilterValues(prev => ({ ...prev, [f.name]: newVal }))}
                                            sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: 11, minHeight: 28, py: '0px !important' } }}
                                            renderInput={(params) => <TextField {...params} placeholder={f.column} />}
                                            slotProps={{ popper: { sx: { '& .MuiAutocomplete-option': { fontSize: 11, minHeight: 28 } } } }}
                                        />
                                    ) : f.input_type === 'numeric' ? (
                                        <TextField
                                            size="small" type="number"
                                            value={filterValues[f.name] ?? ''}
                                            onChange={(e) => setFilterValues(prev => ({ ...prev, [f.name]: e.target.value ? Number(e.target.value) : '' }))}
                                            placeholder={f.column}
                                            sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: 11, height: 28 } }}
                                        />
                                    ) : (
                                        <TextField
                                            size="small"
                                            value={filterValues[f.name] ?? ''}
                                            onChange={(e) => setFilterValues(prev => ({ ...prev, [f.name]: e.target.value }))}
                                            placeholder={f.column}
                                            sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: 11, height: 28 } }}
                                        />
                                    )}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}
            </Box>

            {/* Load controls — pinned at bottom */}
            <Box sx={{
                mt: 1, pt: 1, flexShrink: 0,
                borderTop: '1px solid', borderColor: 'divider',
                display: 'flex', alignItems: 'center', gap: 1,
            }}>
                {loadedKey ? (
                    <Button
                        variant="outlined" size="small" disabled
                        startIcon={<CheckIcon sx={{ fontSize: 14 }} />}
                        sx={{
                            textTransform: 'none', fontSize: 12, px: 2, height: 30,
                            color: 'success.main', borderColor: 'success.main',
                            '&.Mui-disabled': { color: 'success.main', borderColor: 'success.main', opacity: 0.8 },
                        }}
                    >
                        {t('db.loaded')}
                    </Button>
                ) : (
                    <>
                        <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary' }}>Rows/table</Typography>
                        <Autocomplete
                            freeSolo size="small"
                            options={[
                                ...rowLimitPresets.map(n => ({ label: n.toLocaleString(), value: n })),
                                { label: 'All', value: -1 },
                            ]}
                            value={rowLimit === -1
                                ? { label: 'All', value: -1 }
                                : { label: rowLimit.toLocaleString(), value: rowLimit }
                            }
                            onChange={(_e, newVal) => {
                                if (newVal == null) return;
                                if (typeof newVal === 'string') {
                                    const v = parseInt(newVal.replace(/,/g, ''));
                                    if (!isNaN(v) && v > 0) setRowLimit(v);
                                } else {
                                    setRowLimit(newVal.value);
                                }
                            }}
                            getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                            isOptionEqualToValue={(opt, val) => opt.value === val.value}
                            disableClearable
                            sx={{ width: 100, '& .MuiInputBase-root': { fontSize: 11, height: 28, py: '0px !important' } }}
                            renderInput={(params) => <TextField {...params} />}
                            slotProps={{ popper: { sx: { '& .MuiAutocomplete-option': { fontSize: 11, minHeight: 28 } } } }}
                        />
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="contained" size="small"
                            disabled={isLoading}
                            onClick={handleLoadGroup}
                            startIcon={isLoading ? <CircularProgress size={14} /> : <DashboardOutlinedIcon sx={{ fontSize: 14 }} />}
                            sx={{ textTransform: 'none', fontSize: 12, px: 2, height: 30, flexShrink: 0 }}
                        >
                            {isLoading ? 'Loading...' : `Load Tables (${tables.length})`}
                        </Button>
                    </>
                )}
            </Box>
        </Box>
    );
};

export const DataLoaderForm: React.FC<{
    dataLoaderType: string, 
    paramDefs: {name: string, default?: string, type: string, required: boolean, description?: string, sensitive?: boolean, tier?: 'connection' | 'auth' | 'filter'}[],
    authInstructions: string,
    connectorId?: string,
    autoConnect?: boolean,
    delegatedLogin?: { login_url: string; label?: string } | null,
    authMode?: string,
    onImport: () => void,
    onFinish: (status: "success" | "error", message: string, importedTables?: string[]) => void,
    onConnected?: () => void,
    /** Called when the user clicks Delete. Receives the connectorId. */
    onDelete?: (connectorId: string) => void,
    /** Called before the connect step. Returns the effective connectorId to use.
     *  Used by AddConnectionPanel to create the connector before connecting. */
    onBeforeConnect?: (params: Record<string, any>) => Promise<string>,
}> = ({dataLoaderType, paramDefs, authInstructions, connectorId, autoConnect, delegatedLogin, authMode, onImport, onFinish, onConnected, onDelete, onBeforeConnect}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const theme = useTheme();
    // Effective connectorId — may be updated by onBeforeConnect (e.g. AddConnectionPanel)
    const connectorIdRef = useRef(connectorId);
    useEffect(() => { connectorIdRef.current = connectorId; }, [connectorId]);
    const params = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[dataLoaderType] ?? {});
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 2_000_000);
    const workspaceTables = useSelector((state: DataFormulatorState) => state.tables);

    const [tableMetadata, setTableMetadata] = useState<Record<string, any>>({});
    const [selectedPreviewTable, setSelectedPreviewTable] = useState<string | null>(null);
    // Catalog tree state (hierarchical browsing)
    const [catalogTree, setCatalogTree] = useState<CatalogTreeNode[]>([]);
    const [selectedTreeNode, setSelectedTreeNode] = useState<CatalogTreeNode | null>(null);
    const [expandedItems, setExpandedItems] = useState<string[]>([]);
    // Import options for the currently selected table
    // Standard row-limit presets, capped by the system frontendRowLimit setting
    const rowLimitPresets = useMemo(
        () => [1000, 5000, 10000, 50000, 100000, 200000, 500000, 1000000].filter(n => n <= frontendRowLimit),
        [frontendRowLimit],
    );
    const [loadConfig, setLoadConfig] = useState<{
        limit: number;
        sortColumn: string;
        sortOrder: 'asc' | 'desc';
    }>({ limit: frontendRowLimit, sortColumn: '', sortOrder: 'desc' });

    // Track which tables have been loaded and how (persists across table selections)
    const [loadedTables, setLoadedTables] = useState<Record<string, string>>({});

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
    const [persistCredentials, setPersistCredentials] = useState(true);

    // Sensitive params (passwords, tokens, secrets) live in component state only —
    // never persisted to Redux / localStorage.
    // Sensitivity is declared by the loader via `sensitive: true` or `type: "password"`.
    const sensitiveParamNames = useMemo(
        () => new Set(paramDefs.filter(p => p.sensitive || p.type === 'password').map(p => p.name)),
        [paramDefs]
    );
    const [sensitiveParams, setSensitiveParams] = useState<Record<string, string>>({});

    // Merged params: Redux (non-sensitive) + component state (sensitive)
    const mergedParams = useMemo(
        () => ({ ...params, ...sensitiveParams }),
        [params, sensitiveParams]
    );

    // Ref for the connected-state table filter input (uncontrolled for performance)
    const filterInputRef = useRef<HTMLInputElement>(null);

    // Connection timeout in milliseconds (30 seconds)
    const CONNECTION_TIMEOUT_MS = 30_000;

    // Helper: extract flat table metadata from the tree for preview/load logic
    const extractTableMetadata = useCallback((tree: CatalogTreeNode[]) => {
        const result: Record<string, any> = {};
        const walk = (nodes: CatalogTreeNode[]) => {
            for (const n of nodes) {
                if (n.node_type === 'table') {
                    // Use the path-based key so duplicate table names under different namespaces stay distinct
                    const key = n.path.join('/');
                    result[key] = { ...n.metadata, _catalogName: n.name, _catalogPath: n.path };
                } else if (n.node_type === 'table_group') {
                    const key = n.path.join('/');
                    result[key] = { ...n.metadata, _catalogName: n.name, _catalogPath: n.path, _isGroup: true };
                }
                if (n.children) walk(n.children);
            }
        };
        walk(tree);
        return result;
    }, []);

    // Helper: fetch catalog tree and update state
    const fetchCatalogTree = useCallback(async (filter?: string) => {
        const treeResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.GET_CATALOG_TREE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connector_id: connectorIdRef.current, filter: filter?.trim() || null }),
        });
        const treeData = await treeResp.json();
        if (treeData.tree) {
            setCatalogTree(treeData.tree);
            setExpandedItems(collectNamespaceIds(treeData.tree));
            const flatMeta = extractTableMetadata(treeData.tree);
            setTableMetadata(flatMeta);
            return treeData;
        } else if (treeData.status === 'error') {
            throw new Error(treeData.message || 'Failed to load catalog tree');
        }
        return treeData;
    }, [extractTableMetadata]);

    // Helper: connect and list tables via data connector
    const connectAndListTables = useCallback(async (filter?: string) => {
        setIsConnecting(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
        try {
            // Strip table_filter from params sent to connect (it's for catalog browsing, not connection)
            const { table_filter: _tf, ...connectParams } = mergedParams as Record<string, any>;
            // If onBeforeConnect is provided (e.g. AddConnectionPanel), create the connector first
            if (onBeforeConnect) {
                connectorIdRef.current = await onBeforeConnect(connectParams);
            }
            const connectResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.CONNECT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: connectorIdRef.current, params: connectParams, persist: persistCredentials }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const connectData = await connectResp.json();
            if (connectData.status !== 'connected') {
                throw new Error(connectData.message || 'Connection failed');
            }
            // Fetch catalog tree before promoting to "connected" state
            const tableFilterValue = filter ?? (mergedParams as Record<string, any>).table_filter ?? '';
            await fetchCatalogTree(tableFilterValue);
            // Only promote to "connected" after tree is loaded
            onConnected?.();
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                onFinish("error", t('db.connectionTimeout'));
            } else {
                onFinish("error", error.message || 'Failed to connect');
            }
        } finally {
            setIsConnecting(false);
        }
    }, [mergedParams, persistCredentials, onFinish, onConnected, onBeforeConnect, fetchCatalogTree, t]);

    // Delegated (popup-based) login flow for token-based connectors
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const handleDelegatedLogin = useCallback(async () => {
        if (!delegatedLogin?.login_url) return;
        setIsConnecting(true);
        try {
            // If onBeforeConnect is provided (e.g. AddConnectionPanel), create the connector first
            if (onBeforeConnect) {
                const { table_filter: _tf, ...connectParams } = mergedParams as Record<string, any>;
                connectorIdRef.current = await onBeforeConnect(connectParams);
            }
            if (!connectorIdRef.current) return;
        } catch (err: any) {
            onFinish('error', err.message || 'Failed to create connector');
            setIsConnecting(false);
            return;
        }

        const url = new URL(delegatedLogin.login_url, window.location.origin);
        url.searchParams.set('df_origin', window.location.origin);
        // Pass auth-tier form params (e.g. client_id, tenant_id) to the login endpoint
        for (const p of paramDefs) {
            if (p.tier === 'auth' && !p.sensitive && p.type !== 'password' && mergedParams[p.name]) {
                url.searchParams.set(p.name, mergedParams[p.name]);
            }
        }

        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        const popup = window.open(
            url.toString(),
            'df-sso-login',
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`,
        );

        if (!popup) {
            onFinish("error", t('db.popupBlocked') || 'Popup was blocked. Please allow popups and try again.');
            setIsConnecting(false);
            return;
        }

        const handler = async (event: MessageEvent) => {
            if (event.data?.type !== 'df-sso-auth') return;
            window.removeEventListener('message', handler);
            if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
            popup.close();

            const { access_token, refresh_token, user } = event.data;
            if (access_token) {
                try {
                    // Send tokens to backend token-connect endpoint
                    const connectResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.CONNECT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            connector_id: connectorIdRef.current,
                            mode: 'token',
                            access_token,
                            refresh_token,
                            user,
                            params: mergedParams,  // include any filled-in params (e.g. url)
                            persist: persistCredentials,
                        }),
                    });
                    const connectData = await connectResp.json();
                    if (connectData.status !== 'connected') {
                        throw new Error(connectData.message || 'Token connection failed');
                    }
                    // Fetch catalog tree
                    await fetchCatalogTree(null as any);
                    onConnected?.();
                } catch (err: any) {
                    onFinish("error", err.message || 'Login failed');
                }
            }
            setIsConnecting(false);
        };

        window.addEventListener('message', handler);

        pollTimerRef.current = setInterval(() => {
            if (popup.closed) {
                if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
                window.removeEventListener('message', handler);
                setIsConnecting(false);
            }
        }, 1000);
    }, [delegatedLogin, mergedParams, persistCredentials, onFinish, onConnected, onBeforeConnect, t]);

    // Auto-connect on mount if this source has stored vault credentials.
    // Uses auth/status which auto-reconnects from vault, then lists tables.
    const autoConnectTriggered = useRef(false);
    useEffect(() => {
        if (autoConnect && connectorIdRef.current && !autoConnectTriggered.current && Object.keys(tableMetadata).length === 0) {
            autoConnectTriggered.current = true;
            (async () => {
                setIsConnecting(true);
                try {
                    // Check current connection status (no side effects)
                    const statusResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.GET_STATUS, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ connector_id: connectorIdRef.current }),
                    });
                    const statusData = await statusResp.json();
                    if (statusData.connected) {
                        // Already connected — fetch catalog tree
                        await fetchCatalogTree();
                    } else if (statusData.has_stored_credentials) {
                        // Vault has creds — attempt reconnect
                        const connectResp = await fetchWithIdentity(CONNECTOR_ACTION_URLS.CONNECT, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ connector_id: connectorIdRef.current, params: {}, persist: true }),
                        });
                        const connectData = await connectResp.json();
                        if (connectData.status === 'connected') {
                            await fetchCatalogTree();
                        }
                    }
                } catch (err) {
                    console.warn('Auto-connect failed for', connectorIdRef.current, err);
                } finally {
                    setIsConnecting(false);
                }
            })();
        }
    }, [autoConnect, connectorId]);

    // Auto-select first table for preview when metadata loads
    useEffect(() => {
        const tableNames = Object.keys(tableMetadata);
        if (tableNames.length > 0 && (!selectedPreviewTable || !tableMetadata[selectedPreviewTable])) {
            setSelectedPreviewTable(tableNames[0]);
        }
    }, [tableMetadata]);

    // Reset load config when switching tables
    useEffect(() => {
        if (selectedPreviewTable && tableMetadata[selectedPreviewTable]) {
            const rowCount = tableMetadata[selectedPreviewTable].row_count || 0;
            // Default to All unless the table exceeds the system row limit
            const defaultLimit = rowCount > frontendRowLimit ? frontendRowLimit : -1;
            setLoadConfig({ limit: defaultLimit, sortColumn: '', sortOrder: 'desc' });

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

    // Handler for selecting a table node from the catalog tree
    const handleTreeTableSelect = useCallback((node: CatalogTreeNode) => {
        setSelectedTreeNode(node);
        const pathKey = node.path.join('/');
        setSelectedPreviewTable(pathKey);
    }, []);

    // The source_table identifier for import: use the original name from list_tables()
    // For flat sources this is the table name; for hierarchical sources it's the dotted path (e.g. "schema.table")
    const getSourceTableName = useCallback((pathKey: string): string => {
        const meta = tableMetadata[pathKey];
        if (meta?._source_name) return meta._source_name;
        if (meta?._catalogName) return meta._catalogName;
        // Fallback: last segment of the path
        return pathKey.split('/').pop() || pathKey;
    }, [tableMetadata]);

    /** Shared helper: build DictTable + dispatch loadTable */
    const doLoadTable = useCallback((importOptions: Record<string, any>, label?: string) => {
        const pathKey = selectedPreviewTable;
        if (!pathKey) return;
        const meta = tableMetadata[pathKey];
        if (!meta) return;

        const sourceTableName = getSourceTableName(pathKey);
        const sampleRows = meta.sample_rows || [];
        const columns = meta.columns || [];
        const tableObj: DictTable = {
            kind: 'table' as const,
            id: sourceTableName.split('.').pop() || sourceTableName,
            displayId: sourceTableName,
            names: columns.map((c: any) => c.name),
            metadata: columns.reduce((acc: Record<string, any>, col: any) => ({
                ...acc,
                [col.name]: { type: 'string' as any, semanticType: '', levels: [] }
            }), {}),
            rows: sampleRows,
            virtual: { tableId: sourceTableName.split('.').pop() || sourceTableName, rowCount: meta.row_count || sampleRows.length },
            anchored: true,
            attachedMetadata: '',
            source: {
                type: 'database' as const,
                databaseTable: pathKey,
                canRefresh: true,
                lastRefreshed: Date.now(),
                connectorId: connectorIdRef.current,
            },
        };

        onImport();
        dispatch(loadTable({
            table: tableObj,
            connectorId: connectorIdRef.current,
            sourceTableName,
            importOptions,
        })).unwrap()
            .then((result) => {
                setLoadedTables(prev => ({ ...prev, [pathKey]: label || 'loaded' }));
                onFinish("success", `Loaded table "${sourceTableName}"`, [result.table.id]);
            })
            .catch((error) => {
                console.error('Failed to load data:', error);
                onFinish("error", `Failed to load "${sourceTableName}": ${error}`);
            });
    }, [selectedPreviewTable, tableMetadata, getSourceTableName, onImport, onFinish, dispatch]);


    const isConnected = catalogTree.length > 0 || Object.keys(tableMetadata).length > 0;

    /** Recursively render CatalogTreeNode[] as styled TreeItem elements */
    const countBadgeSx = {
        fontSize: 11, color: 'text.disabled', bgcolor: 'action.selected',
        borderRadius: 10, px: 0.8, lineHeight: '18px', flexShrink: 0,
        fontVariantNumeric: 'tabular-nums', minWidth: 22, textAlign: 'center',
    } as const;

    const renderCatalogTreeItems = (nodes: CatalogTreeNode[], loadedMap: Record<string, string>, expandedSet: Set<string>): React.ReactNode =>
        nodes.map((node) => {
            const itemId = node.path.join('/');
            const isTable = node.node_type === 'table';
            const isGroup = node.node_type === 'table_group';
            const loaded = isTable ? loadedMap[node.name] || loadedMap[itemId] : undefined;
            const groupLoaded = isGroup ? loadedMap[itemId] : undefined;
            const childCount = !isTable && !isGroup ? (node.children?.length ?? 0) : 0;
            const tableCount = isGroup ? (node.metadata?.tables?.length ?? 0) : 0;
            const isExpanded = expandedSet.has(itemId);

            const labelContent = (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                    {isGroup
                        ? <DashboardOutlinedIcon sx={{ fontSize: 16, color: groupLoaded ? 'success.main' : 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                        : isTable
                            ? <TableIcon sx={{ fontSize: 16, color: loaded ? 'success.main' : 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                            : <FolderOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0, opacity: 0.7 }} />
                    }
                    <Typography noWrap component="span" sx={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                        {node.name}
                    </Typography>
                    {(loaded || groupLoaded) && <CheckIcon sx={{ fontSize: 13, color: 'success.main', flexShrink: 0 }} />}
                    {isTable && node.metadata?.row_count != null && (
                        <Typography component="span" sx={{ fontSize: 11, color: 'text.disabled', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {Number(node.metadata.row_count).toLocaleString()}
                        </Typography>
                    )}
                    {isGroup && tableCount > 0 && (
                        <Box component="span" sx={countBadgeSx}>
                            {tableCount}
                        </Box>
                    )}
                    {childCount > 0 && !isExpanded && (
                        <Box component="span" sx={countBadgeSx}>
                            {childCount}
                        </Box>
                    )}
                </Box>
            );

            return (
                <StyledTreeItem key={itemId} itemId={itemId} label={labelContent}>
                    {!isGroup && node.children && renderCatalogTreeItems(node.children, loadedMap, expandedSet)}
                </StyledTreeItem>
            );
        });

    return (
        <Box sx={{p: 0, pb: 2, display: 'flex', flexDirection: 'column', height: isConnected ? '100%' : 'auto' }}>
            {isConnecting && <Box sx={{
                position: "absolute", top: 0, left: 0, width: "100%", height: "100%", 
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                backgroundColor: "rgba(255, 255, 255, 0.7)"
            }}>
                <CircularProgress size={20} />
            </Box>}
            {isConnected ? (
                // Connected state: tree browser (left) + table detail (right)
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Header: source name · connection params · delete */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap', flexShrink: 0 }}>
                        <Typography variant="body2" component="span" sx={{ fontSize: 12, color: 'secondary.main', fontWeight: 600 }}>
                            {dataLoaderType}
                        </Typography>
                        {paramDefs.filter(p => params[p.name] && !sensitiveParamNames.has(p.name) && p.tier !== 'auth').map((paramDef) => (
                            <Typography key={paramDef.name} variant="body2" component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>
                                {paramDef.name}: <Box component="span" sx={{ fontWeight: 500, color: 'text.primary' }}>{params[paramDef.name]}</Box>
                            </Typography>
                        ))}
                        <Box sx={{ flex: 1 }} />
                        {onDelete && connectorIdRef.current && (
                            <Button
                                variant="outlined" size="small" color="error"
                                sx={{ textTransform: "none", fontSize: 11, height: 26, minWidth: 0 }}
                                onClick={() => onDelete(connectorIdRef.current!)}
                            >
                                {t('db.deleteConnector', { defaultValue: 'Delete' })}
                            </Button>
                        )}
                    </Box>
                    {/* Main content: tree (left) + detail (right) */}
                    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, gap: 1 }}>
                        {/* Left: catalog tree */}
                        <Box sx={{
                            width: '40%', minWidth: 180, maxWidth: 340,
                            overflowY: 'auto', overflowX: 'hidden',
                            py: 0,
                            overscrollBehavior: 'contain',
                            display: 'flex', flexDirection: 'column',
                        }}>
                            {/* Inline search */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, pb: 0.5, flexShrink: 0 }}>
                                <SearchIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                <TextField
                                    sx={{
                                        flex: 1,
                                        '& .MuiInputBase-root': { fontSize: 12 },
                                        '& .MuiInputBase-input': { fontSize: 12, py: 0.25, px: 0.5 },
                                        '& .MuiInputBase-input::placeholder': { fontSize: 11, opacity: 0.5 },
                                        '& .MuiInput-underline:before, & .MuiInput-underline:after': { display: 'none' },
                                    }}
                                    variant="standard" size="small"
                                    placeholder={t('db.tableFilterPlaceholder')}
                                    autoComplete="off"
                                    defaultValue={params.table_filter || ''}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const val = (e.target as HTMLInputElement).value;
                                            dispatch(dfActions.updateDataLoaderConnectParam({dataLoaderType, paramName: 'table_filter', paramValue: val}));
                                            connectAndListTables(val);
                                        }
                                    }}
                                    inputRef={filterInputRef}
                                />
                                <IconButton
                                    size="small"
                                    sx={{ p: 0.25 }}
                                    onClick={() => {
                                        const val = filterInputRef.current?.value ?? params.table_filter ?? '';
                                        dispatch(dfActions.updateDataLoaderConnectParam({dataLoaderType, paramName: 'table_filter', paramValue: val}));
                                        connectAndListTables(val);
                                    }}
                                >
                                    <RefreshIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                </IconButton>
                            </Box>
                            <Divider sx={{ mb: 0.5 }} />
                            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                            {catalogTree.length > 0 ? (
                                <SimpleTreeView
                                    expandedItems={expandedItems}
                                    onExpandedItemsChange={(_event, itemIds) => setExpandedItems(itemIds)}
                                    selectedItems={selectedPreviewTable}
                                    onSelectedItemsChange={(_event, itemId) => {
                                        if (itemId == null) return;
                                        const node = findNodeByPath(catalogTree, itemId);
                                        if (node && (node.node_type === 'table' || node.node_type === 'table_group')) {
                                            handleTreeTableSelect(node);
                                        }
                                    }}
                                    itemChildrenIndentation={0}
                                    sx={{ px: 0.5 }}
                                >
                                    {renderCatalogTreeItems(catalogTree, effectiveLoadedTables, new Set(expandedItems))}
                                </SimpleTreeView>
                            ) : (
                                <Typography sx={{ fontSize: 11, color: 'text.disabled', p: 1.5, fontStyle: 'italic' }}>
                                    {t('db.noTablesFound')}
                                </Typography>
                            )}
                            </Box>
                        </Box>

                        {/* Right: table detail + preview + load controls */}
                        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', px: 1 }}>
                            {/* Group load panel for table_group nodes */}
                            {selectedPreviewTable && tableMetadata[selectedPreviewTable]?._isGroup ? (() => {
                                const metadata = tableMetadata[selectedPreviewTable];
                                const groupName = metadata._catalogName || selectedPreviewTable;
                                const tables: any[] = metadata.tables || [];
                                const sourceFilters: SourceFilter[] = metadata.source_filters || [];
                                return (
                                    <GroupLoadPanel
                                        groupName={groupName}
                                        tables={tables}
                                        sourceFilters={sourceFilters}
                                        frontendRowLimit={frontendRowLimit}
                                        rowLimitPresets={rowLimitPresets}
                                        connectorId={connectorIdRef.current!}
                                        loadedKey={effectiveLoadedTables[selectedPreviewTable]}
                                        onLoaded={(label) => setLoadedTables(prev => ({ ...prev, [selectedPreviewTable!]: label }))}
                                        onImport={onImport}
                                        onFinish={onFinish}
                                    />
                                );
                            })() : previewTable && selectedPreviewTable && tableMetadata[selectedPreviewTable] ? (() => {
                                const metadata = tableMetadata[selectedPreviewTable];
                                const displayName = metadata?._catalogName || selectedPreviewTable.split('/').pop() || selectedPreviewTable;
                                return (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                                        {/* Table header */}
                                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexShrink: 0 }}>
                                            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                                                {displayName}
                                            </Typography>
                                            {selectedTreeNode && selectedTreeNode.path.length > 1 && (
                                                <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                                                    {selectedTreeNode.path.slice(0, -1).join(' / ')}
                                                </Typography>
                                            )}
                                        </Box>
                                        {/* Summary line */}
                                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5, flexShrink: 0 }}>
                                            {metadata?.row_count > 0 
                                                ? t('db.rowsCount', { count: Number(metadata.row_count).toLocaleString() })
                                                : t('db.sampleRowsCount', { count: previewTable.rows.length })
                                            } × {previewTable.names.length} {t('db.columns')}
                                        </Typography>
                                        {/* Preview table — scrolls when tall, shrink-wraps when short */}
                                        <Box sx={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}>
                                            <Card variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
                                                <CustomReactTable
                                                    rows={previewTable.rows.slice(0, 20)}
                                                    columnDefs={previewTable.names.map(name => ({
                                                        id: name,
                                                        label: name,
                                                        minWidth: 60,
                                                    }))}
                                                    rowsPerPageNum={-1}
                                                    compact={false}
                                                    isIncompleteTable={previewTable.rows.length > 20}
                                                />
                                            </Card>
                                        </Box>

                                        {/* Load & filter panel — pinned below table */}
                                        <Box sx={{
                                            mt: 1, pt: 1, flexShrink: 0,
                                            borderTop: '1px solid', borderColor: 'divider',
                                            display: 'flex', flexDirection: 'column', gap: 1,
                                        }}>
                                            {effectiveLoadedTables[selectedPreviewTable] ? (
                                                /* Already loaded */
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    <Button
                                                        variant="outlined" size="small" disabled
                                                        startIcon={<CheckIcon sx={{ fontSize: 14 }} />}
                                                        sx={{ textTransform: 'none', fontSize: 12, px: 2, height: 30,
                                                            color: 'success.main', borderColor: 'success.main',
                                                            '&.Mui-disabled': { color: 'success.main', borderColor: 'success.main', opacity: 0.8 },
                                                        }}
                                                    >
                                                        {t('db.loaded')}
                                                    </Button>
                                                    <Button
                                                        variant="text" size="small"
                                                        onClick={() => {
                                                            const tableName = selectedPreviewTable;
                                                            const wt = workspaceTables.find(t => t.source?.databaseTable === tableName && t.source?.type === 'database');
                                                            if (wt) dispatch(dfActions.deleteTable(wt.id));
                                                            setLoadedTables(prev => { const next = { ...prev }; delete next[tableName]; return next; });
                                                        }}
                                                        sx={{ textTransform: 'none', fontSize: 11, px: 1, minWidth: 0, height: 28, color: 'text.secondary',
                                                            '&:hover': { color: 'error.main', backgroundColor: 'rgba(211,47,47,0.04)' },
                                                        }}
                                                    >
                                                        {t('db.unload')}
                                                    </Button>
                                                </Box>
                                            ) : (
                                                /* Not yet loaded — show options */
                                                <>
                                                    {/* Row 1: Limit + Sort + Load Button */}
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                                        {metadata?.row_count > 1000 && (<>
                                                            <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>Rows</Typography>
                                                            <Autocomplete
                                                                freeSolo size="small"
                                                                options={[
                                                                    ...rowLimitPresets.filter(n => n <= metadata.row_count && n <= frontendRowLimit).map(n => ({
                                                                        label: n.toLocaleString(), value: n,
                                                                    })),
                                                                    { label: 'All', value: -1 },
                                                                ]}
                                                                value={loadConfig.limit === -1
                                                                    ? { label: 'All', value: -1 }
                                                                    : { label: loadConfig.limit.toLocaleString(), value: loadConfig.limit }
                                                                }
                                                                onChange={(_e, newVal) => {
                                                                    if (newVal == null) return;
                                                                    if (typeof newVal === 'string') {
                                                                        const v = parseInt(newVal.replace(/,/g, ''));
                                                                        if (!isNaN(v) && v > 0) setLoadConfig(prev => ({ ...prev, limit: v }));
                                                                    } else {
                                                                        setLoadConfig(prev => ({ ...prev, limit: newVal.value }));
                                                                    }
                                                                }}
                                                                onInputChange={(_e, inputVal, reason) => {
                                                                    if (reason !== 'input') return;
                                                                    const v = parseInt(inputVal.replace(/,/g, ''));
                                                                    if (!isNaN(v) && v > 0) setLoadConfig(prev => ({ ...prev, limit: v }));
                                                                }}
                                                                getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
                                                                isOptionEqualToValue={(opt, val) => opt.value === val.value}
                                                                disableClearable
                                                                sx={{ width: 110, '& .MuiInputBase-root': { fontSize: 11, height: 28, py: '0px !important' }, '& .MuiInputBase-input': { px: 0.75 } }}
                                                                renderInput={(params) => <TextField {...params} />}
                                                                slotProps={{ popper: { sx: { '& .MuiAutocomplete-option': { fontSize: 11, minHeight: 28 } } } }}
                                                            />
                                                            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
                                                            <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>Sort</Typography>
                                                            <TextField
                                                                select size="small"
                                                                value={loadConfig.sortColumn}
                                                                onChange={(e) => setLoadConfig(prev => ({ ...prev, sortColumn: e.target.value }))}
                                                                slotProps={{ select: { displayEmpty: true } }}
                                                                sx={{ width: 110, '& .MuiInputBase-root': { fontSize: 11, height: 28 }, '& .MuiSelect-select': { py: 0.25, px: 0.75 } }}
                                                            >
                                                                <MenuItem value="" sx={{ fontSize: 11, color: 'text.disabled' }}><em>none</em></MenuItem>
                                                                {(metadata.columns || []).map((col: any) => (
                                                                    <MenuItem key={col.name} value={col.name} sx={{ fontSize: 11 }}>{col.name}</MenuItem>
                                                                ))}
                                                            </TextField>
                                                            {loadConfig.sortColumn && (
                                                                <ToggleButtonGroup
                                                                    value={loadConfig.sortOrder} exclusive
                                                                    onChange={(_, v) => { if (v) setLoadConfig(prev => ({ ...prev, sortOrder: v })); }}
                                                                    size="small" sx={{ height: 28 }}
                                                                >
                                                                    <ToggleButton value="asc" sx={{ px: 0.75, py: 0, fontSize: 10, textTransform: 'none' }}>ASC</ToggleButton>
                                                                    <ToggleButton value="desc" sx={{ px: 0.75, py: 0, fontSize: 10, textTransform: 'none' }}>DESC</ToggleButton>
                                                                </ToggleButtonGroup>
                                                            )}
                                                        </>)}
                                                        <Box sx={{ flex: 1 }} />
                                                        <Button
                                                            variant="contained" size="small"
                                                            sx={{ textTransform: 'none', fontSize: 12, px: 3, height: 30, flexShrink: 0 }}
                                                            onClick={() => {
                                                                const importOptions: any = {
                                                                    ...(loadConfig.limit > 0 ? { size: loadConfig.limit } : {}),
                                                                };
                                                                if (loadConfig.sortColumn) {
                                                                    importOptions.sortColumns = [loadConfig.sortColumn];
                                                                    importOptions.sortOrder = loadConfig.sortOrder;
                                                                }
                                                                const isSubset = (metadata?.row_count > 1000) && (loadConfig.limit > 0 || loadConfig.sortColumn);
                                                                doLoadTable(importOptions, isSubset ? 'subset' : 'loaded');
                                                            }}
                                                        >
                                                            {(metadata?.row_count > 1000) && (loadConfig.limit > 0 || loadConfig.sortColumn)
                                                                ? t('db.loadTableSubset') : t('db.loadTableBtn')}
                                                        </Button>
                                                    </Box>

                                                </>
                                            )}
                                        </Box>
                                    </Box>
                                );
                            })() : (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.disabled' }}>
                                    <Typography variant="body2" sx={{ fontStyle: 'italic', fontSize: 12 }}>
                                        {tableNames.length > 0 ? t('db.selectTableFromTree') : t('db.noTablesFound')}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Box>
            ) : (
                // Not connected: show connection forms
                <>
                    {!onBeforeConnect && (
                        <Typography variant="body2" sx={{fontSize: 12, color: 'secondary.main', fontWeight: 600, mt: 1}}>
                            {dataLoaderType}
                        </Typography>
                    )}
                    {(() => {
                        const hasTiers = paramDefs.some(p => p.tier);
                        // Section wrapper: subtle background, rounded, with label
                        const sectionSx = { mt: 1, px: 1.5, pt: 0.75, pb: 1.5, borderRadius: 1, backgroundColor: 'rgba(0,0,0,0.025)' };
                        // Shared input style: standard variant (underline), label always shrunk so placeholder is visible
                        const inputSx = {
                            '& .MuiInput-underline:before': { borderBottomColor: 'rgba(0,0,0,0.15)' },
                            '& .MuiInputBase-root': { fontSize: 12, mt: 1.5 },
                            '& .MuiInputBase-input': { fontSize: 12, py: 0.5, px: 0 },
                            '& .MuiInputBase-input::placeholder': { fontSize: 11, opacity: 0.45 },
                            '& .MuiInputLabel-root': { fontSize: 11, color: 'text.secondary', fontWeight: 500 },
                            '& .MuiInputLabel-root.Mui-focused': { color: 'primary.main' },
                        };
                        const labelShrinkSlotProps = { inputLabel: { shrink: true } };
                        // Pick 2 or 3 columns to minimise orphan fields on the last row
                        const balancedCols = (n: number) => {
                            if (n <= 2) return 2;
                            if (n % 3 === 0) return 3;  // 3,6,9 → perfect 3-col rows
                            if (n % 2 === 0) return 2;  // 4,8 → perfect 2-col rows
                            return 3;                    // 5,7 → 3 cols (3+2, 3+3+1) is acceptable
                        };
                        if (!hasTiers) {
                            // Legacy: no tier field, render flat grid
                            const cols = balancedCols(paramDefs.length);
                            return (
                                <Box sx={{ ...sectionSx, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 350px))`, gap: 2 }}>
                                    {paramDefs.map((paramDef) => (
                                        <TextField
                                            key={paramDef.name}
                                            sx={inputSx}
                                            variant="standard" size="small" fullWidth
                                            slotProps={labelShrinkSlotProps}
                                            label={paramDef.name}
                                            type={paramDef.type === 'password' ? 'password' : 'text'}
                                            required={paramDef.required}
                                            value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                            placeholder={paramDef.description || (paramDef.default ? `${paramDef.default}` : '')}
                                            onChange={(event: any) => {
                                                if (sensitiveParamNames.has(paramDef.name)) {
                                                    setSensitiveParams(prev => ({ ...prev, [paramDef.name]: event.target.value }));
                                                } else {
                                                    dispatch(dfActions.updateDataLoaderConnectParam({ dataLoaderType, paramName: paramDef.name, paramValue: event.target.value }));
                                                }
                                            }}
                                        />
                                    ))}
                                </Box>
                            );
                        }

                        const renderParamGrid = (tierParams: typeof paramDefs) => {
                            const cols = balancedCols(tierParams.length);
                            return (
                            <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 350px))`, gap: 2 }}>
                                {tierParams.map((paramDef) => (
                                    <TextField
                                        key={paramDef.name}
                                        sx={inputSx}
                                        variant="standard" size="small" fullWidth
                                        slotProps={labelShrinkSlotProps}
                                        label={paramDef.name}
                                        type={paramDef.type === 'password' ? 'password' : 'text'}
                                        required={paramDef.required}
                                        value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                        placeholder={paramDef.description || (paramDef.default ? `${paramDef.default}` : '')}
                                        onChange={(event: any) => {
                                            if (sensitiveParamNames.has(paramDef.name)) {
                                                setSensitiveParams(prev => ({ ...prev, [paramDef.name]: event.target.value }));
                                            } else {
                                                dispatch(dfActions.updateDataLoaderConnectParam({ dataLoaderType, paramName: paramDef.name, paramValue: event.target.value }));
                                            }
                                        }}
                                    />
                                ))}
                            </Box>
                            );
                        };

                        const connectionParams = paramDefs.filter(p => p.tier === 'connection');
                        const filterParams = paramDefs.filter(p => p.tier === 'filter');
                        const authParams = paramDefs.filter(p => p.tier === 'auth');
                        const hasDelegated = !!delegatedLogin?.login_url;
                        const connectLabel = onBeforeConnect
                            ? t('db.createConnector', { defaultValue: 'Create Connector' })
                            : t('db.connect', { suffix: (params.table_filter || '').trim() ? t('db.withFilter') : '' });

                        return (
                            <>
                                {/* Tier 1: Connection */}
                                {connectionParams.length > 0 && (
                                    <Box sx={sectionSx}>
                                        <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                            {t('db.tierConnection')}
                                        </Typography>
                                        {renderParamGrid(connectionParams)}
                                    </Box>
                                )}

                                {/* Tier 2: Scope */}
                                {filterParams.length > 0 && (
                                    <Box sx={sectionSx}>
                                        <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                            {t('db.tierFilter')}
                                        </Typography>
                                        {renderParamGrid(filterParams)}
                                    </Box>
                                )}

                                {/* Tier 3: Sign in — Connect lives here */}
                                <Box sx={sectionSx}>
                                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                        {t('db.tierAuth')}
                                    </Typography>

                                    {hasDelegated && authParams.length > 0 ? (
                                        /* Left/right split: delegated | or | credentials + connect */
                                        <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'stretch' }}>
                                            {/* Left: delegated login */}
                                            <Box sx={{ display: 'flex', alignItems: 'center', pr: 2.5, borderRight: '1px solid', borderColor: 'divider' }}>
                                                <Button
                                                    variant="outlined"
                                                    color="primary"
                                                    size="small"
                                                    sx={{ textTransform: "none", minWidth: 80, height: 30, fontSize: 12, whiteSpace: 'nowrap' }}
                                                    disabled={isConnecting}
                                                    onClick={handleDelegatedLogin}
                                                >
                                                    {delegatedLogin!.label || t('db.delegatedLogin')}
                                                </Button>
                                            </Box>
                                            {/* Right: credential fields + connect */}
                                            <Box sx={{ flex: 1 }}>
                                                <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${authParams.length}, minmax(0, 350px))`, gap: 2 }}>
                                                    {authParams.map((paramDef) => (
                                                        <TextField
                                                            key={paramDef.name}
                                                            sx={inputSx}
                                                            variant="standard" size="small" fullWidth
                                                            slotProps={labelShrinkSlotProps}
                                                            label={paramDef.name}
                                                            type={paramDef.type === 'password' ? 'password' : 'text'}
                                                            value={sensitiveParamNames.has(paramDef.name) ? (sensitiveParams[paramDef.name] ?? '') : (params[paramDef.name] ?? '')}
                                                            placeholder={paramDef.description || (paramDef.default ? `${paramDef.default}` : '')}
                                                            onChange={(event: any) => {
                                                                if (sensitiveParamNames.has(paramDef.name)) {
                                                                    setSensitiveParams(prev => ({ ...prev, [paramDef.name]: event.target.value }));
                                                                } else {
                                                                    dispatch(dfActions.updateDataLoaderConnectParam({ dataLoaderType, paramName: paramDef.name, paramValue: event.target.value }));
                                                                }
                                                            }}
                                                        />
                                                    ))}
                                                </Box>
                                                <Button
                                                    variant="contained" color="primary" size="small"
                                                    sx={{ textTransform: "none", minWidth: 80, height: 30, mt: 1.5, fontSize: 12 }}
                                                    onClick={() => connectAndListTables()}>
                                                    {connectLabel}
                                                </Button>
                                            </Box>
                                        </Box>
                                    ) : hasDelegated ? (
                                        /* Delegated only */
                                        <Button
                                            variant="contained" color="primary" size="small"
                                            sx={{ textTransform: "none", minWidth: 80, height: 30, fontSize: 12 }}
                                            disabled={isConnecting}
                                            onClick={handleDelegatedLogin}
                                        >
                                            {delegatedLogin!.label || t('db.delegatedLogin')}
                                        </Button>
                                    ) : (
                                        /* Manual credentials only + connect */
                                        <>
                                            {renderParamGrid(authParams)}
                                            <Button
                                                variant="contained" color="primary" size="small"
                                                sx={{ textTransform: "none", minWidth: 80, height: 30, mt: 1.5, fontSize: 12 }}
                                                onClick={() => connectAndListTables()}>
                                                {connectLabel}
                                            </Button>
                                        </>
                                    )}
                                </Box>
                            </>
                        );
                    })()}
                    {paramDefs.length > 0 && (
                        <FormControlLabel
                            sx={{ mt: 0.5, ml: 0 }}
                            control={
                                <Checkbox
                                    size="small"
                                    checked={persistCredentials}
                                    onChange={(e) => setPersistCredentials(e.target.checked)}
                                    sx={{ p: 0.5 }}
                                />
                            }
                            label={
                                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                                    {t('db.rememberCredentials')}
                                </Typography>
                            }
                        />
                    )}
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
                    )}
                    {onDelete && connectorIdRef.current && (
                        <Box sx={{ mt: 2 }}>
                            <Button
                                variant="outlined" size="small" color="error"
                                sx={{ textTransform: "none", fontSize: 11, height: 26, minWidth: 0 }}
                                onClick={() => onDelete(connectorIdRef.current!)}
                            >
                                {t('db.deleteConnector', { defaultValue: 'Delete' })}
                            </Button>
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
}