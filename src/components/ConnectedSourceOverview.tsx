import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, IconButton, InputAdornment, Tab, Tabs, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { apiRequest } from '../app/apiClient';
import { CONNECTOR_ACTION_URLS, fetchConnectorCatalog } from '../app/utils';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { importConnectorFile, previewConnectorFile, isLargeConnectorTable, createExternalTableReference } from '../app/workspaceService';
import { WorkspaceFileCanvas } from '../views/WorkspaceFileCanvas';
import { AppDispatch } from '../app/store';
import { loadTable } from '../app/tableThunks';
import { CatalogTreeNode, collectNamespaceIds } from './CatalogTree';
import { VirtualizedCatalogTree } from './VirtualizedCatalogTree';
import { ColumnMeta, ConnectorTablePreview } from './ConnectorTablePreview';
import { iconVar, textVar } from '../app/layout';

const CATALOG_PREVIEW_ROW_LIMIT = 50;
const MANUAL_PREVIEW_BYTES = 50 * 1024 * 1024;

export interface ConnectedSourceOverviewProps {
    connectorId: string;
    connectorName?: string;
    onReferenceAdded?: () => void;
}

export const ConnectedSourceOverview: React.FC<ConnectedSourceOverviewProps> = ({ connectorId, connectorName, onReferenceAdded }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const tables = useSelector((state: DataFormulatorState) => dfSelectors.getAllTables(state));
    const [tree, setTree] = useState<CatalogTreeNode[]>([]);
    const [expanded, setExpanded] = useState<string[]>([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [selected, setSelected] = useState<CatalogTreeNode | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [catalogProgress, setCatalogProgress] = useState('');
    const [preview, setPreview] = useState<{ columns: ColumnMeta[]; rows: Record<string, any>[]; count: number | null } | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [previewDeferred, setPreviewDeferred] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importedFiles, setImportedFiles] = useState<Record<string, string>>({});
    const [sourceFile, setSourceFile] = useState<File | null>(null);
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const readOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly);
    useEffect(() => setImportedFiles({}), [connectorId, workspaceId]);
    const [activeTab, setActiveTab] = useState<'data' | 'columns' | 'overview'>('data');
    const [catalogScrollParent, setCatalogScrollParent] = useState<HTMLDivElement | null>(null);
    useEffect(() => {
        if (catalogScrollParent) catalogScrollParent.scrollTop = 0;
    }, [catalogScrollParent, connectorId, query]);
    const [browserElement, setBrowserElement] = useState<HTMLDivElement | null>(null);
    const [splitView, setSplitView] = useState(false);
    const previewRequest = useRef<AbortController | null>(null);
    const sourceRef = (node: CatalogTreeNode) => {
        const name = node.metadata?._source_name || node.metadata?._catalogName || node.name;
        return { id: node.metadata?.dataset_id != null ? String(node.metadata.dataset_id) : name, name };
    };
    const tableSize = (node: CatalogTreeNode) => {
        const metadata = node.metadata || {};
        const rawRows = metadata.row_count;
        const rawBytes = metadata.original_size_bytes ?? metadata.size_bytes ?? metadata.file_size;
        const rows = rawRows == null || rawRows === '' ? NaN : Number(rawRows);
        const bytes = rawBytes == null || rawBytes === '' ? NaN : Number(rawBytes);
        return { rows, bytes };
    };
    const isTableTooLarge = (node: CatalogTreeNode) => isLargeConnectorTable(node.metadata);
    const loadReference = async (node: CatalogTreeNode, importOptions: Record<string, any> = {}) => {
        if (importing || readOnly) return;
        setImporting(true);
        setPreviewError('');
        try {
            const { rows, bytes } = tableSize(node);
            const reference = createExternalTableReference({
                kind: 'external-table-reference',
                connectorId, connectorName, tableKey: node.metadata?.table_key || node.path.join('/'), sourceTable: sourceRef(node),
                displayName: node.name, capturedAt: new Date().toISOString(),
                summary: {
                    description: node.metadata?.description || node.metadata?.source_description,
                    columns: preview?.columns || node.metadata?.columns || [],
                    rowCount: Number.isFinite(rows) ? rows : preview?.count ?? undefined,
                    sizeBytes: Number.isFinite(bytes) ? bytes : undefined,
                },
                queryIntent: importOptions,
            });
            dispatch(dfActions.upsertExternalTableReference(reference));
            dispatch(dfActions.setFocused({ type: 'external-table', referenceId: reference.id }));
            onReferenceAdded?.();
        } catch (caught) {
            setPreviewError(caught instanceof Error ? caught.message : String(caught));
        } finally { setImporting(false); }
    };
    const previewWarning = (node: CatalogTreeNode) => {
        const azureBlob = sourceRef(node).name.startsWith('az://') || node.path.some(part => part.startsWith('az://'));
        const file = node.metadata?.artifact_kind === 'file';
        if (!azureBlob && !file) return '';
        const rawSize = node.metadata?.size_bytes ?? node.metadata?.file_size ?? node.metadata?.original_size_bytes;
        const bytes = rawSize == null || rawSize === '' ? NaN : Number(rawSize);
        if (azureBlob && (!Number.isFinite(bytes) || bytes < 0)) return t('chatConnector.unknownBlobPreview', {
            defaultValue: 'Azure Blob file size is unknown. Preview reads the full file and may be slow.',
        });
        if (bytes < MANUAL_PREVIEW_BYTES || !Number.isFinite(bytes)) return '';
        const size = (bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 });
        return azureBlob ? t('chatConnector.largeBlobPreview', {
            size, defaultValue: 'This Azure Blob file is {{size}} MiB. Preview reads the full file and may be slow.',
        }) : t('chatConnector.largeFilePreview', {
            size, defaultValue: 'This file is {{size}} MiB. Preview downloads the file and may be slow.',
        });
    };

    useEffect(() => {
        if (!browserElement) return;
        const updateLayout = () => setSplitView(browserElement.getBoundingClientRect().width >= 760);
        updateLayout();
        const observer = new ResizeObserver(updateLayout);
        observer.observe(browserElement);
        return () => observer.disconnect();
    }, [browserElement]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setCatalogProgress('');
        setError('');
        setSelected(null);
        setDetailOpen(false);
        setPreview(null);
        setSourceFile(null);
        setPreviewError('');
        setPreviewLoading(false);
        setPreviewDeferred(false);
        previewRequest.current?.abort();
        fetchConnectorCatalog<{ tree: CatalogTreeNode[] }>(connectorId, {
            signal: controller.signal,
            onProgress: setCatalogProgress,
        }).then(({ data }) => {
            if (controller.signal.aborted) return;
            setTree(data.tree || []);
            const namespaces = (data.tree || []).filter(node => node.node_type === 'namespace' || node.node_type === 'table_group');
            setExpanded(namespaces.length <= 10 ? namespaces.map(node => node.path.join('/')) : []);
        }).catch(caught => {
            if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => { controller.abort(); previewRequest.current?.abort(); };
    }, [connectorId, refresh]);

    const previewTable = async (node: CatalogTreeNode, confirmed = false) => {
        if (node.node_type !== 'table' || importing) return;
        previewRequest.current?.abort();
        const controller = new AbortController();
        previewRequest.current = controller;
        setSelected(node);
        setDetailOpen(true);
        setPreview(null);
        setSourceFile(null);
        setPreviewError('');
        setPreviewLoading(false);
        const defer = !confirmed && Boolean(previewWarning(node));
        setPreviewDeferred(defer);
        if (defer) {
            setActiveTab('data');
            return;
        }
        if (node.metadata?.artifact_kind === 'file') {
            setPreviewLoading(true);
            try {
                const file = await previewConnectorFile(connectorId, node.path.join('/'), controller.signal);
                if (!controller.signal.aborted) setSourceFile(file);
            } catch (caught) {
                if (!controller.signal.aborted) setPreviewError(caught instanceof Error ? caught.message : String(caught));
            } finally {
                if (!controller.signal.aborted) setPreviewLoading(false);
            }
            return;
        }
        setPreviewLoading(true);
        try {
            const { data } = await apiRequest<any>(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ connector_id: connectorId, source_table: sourceRef(node), limit: CATALOG_PREVIEW_ROW_LIMIT }),
            });
            if (!controller.signal.aborted) {
                const rows = data.rows || [];
                const total = data.total_row_count;
                const columns = (data.columns || []).map((column: ColumnMeta) => {
                    const catalogColumn = node.metadata?.columns?.find((item: ColumnMeta) => item.name === column.name);
                    return { ...column, source_type: column.source_type ?? catalogColumn?.source_type ?? catalogColumn?.type,
                        description: column.description ?? catalogColumn?.description };
                });
                setPreview({ columns, rows, count: total != null && (total > rows.length || rows.length < CATALOG_PREVIEW_ROW_LIMIT)
                    ? total : node.metadata?.row_count ?? null });
            }
        } catch (caught) {
            if (!controller.signal.aborted) setPreviewError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            if (!controller.signal.aborted) setPreviewLoading(false);
        }
    };

    const loadedMap: Record<string, string> = {};
    for (const table of tables) {
        if (table.source?.connectorId === connectorId && table.source.databaseTable) loadedMap[table.source.databaseTable] = table.id;
    }
    const matches = (nodes: CatalogTreeNode[]): CatalogTreeNode[] => nodes.flatMap(node => {
        if (!query.trim() || `${node.name} ${node.metadata?.description || ''}`.toLowerCase().includes(query.trim().toLowerCase())) return [node];
        const children = matches(node.children || []);
        return children.length ? [{ ...node, children }] : [];
    });
    const filtered = matches(tree);
    const countTables = (nodes: CatalogTreeNode[]): number => nodes.reduce((count, node) => count + Number(node.node_type === 'table') + countTables(node.children || []), 0);

    const selectedColumns: ColumnMeta[] = preview?.columns || selected?.metadata?.columns || [];
    const rowCount = preview?.count ?? selected?.metadata?.row_count;
    const description = selected?.metadata?.description || selected?.metadata?.source_description;
    const tableCount = countTables(tree);
    const collectTables = (nodes: CatalogTreeNode[]): CatalogTreeNode[] => nodes.flatMap(node =>
        node.node_type === 'table' ? [node] : collectTables(node.children || []));
    const matchingTables = collectTables(filtered);
    const selectedIndex = matchingTables.findIndex(node => node.path.join('/') === selected?.path.join('/'));
    const previousTable = matchingTables[selectedIndex - 1];
    const nextTable = selectedIndex >= 0 ? matchingTables[selectedIndex + 1] : undefined;
    const isFile = selected?.metadata?.artifact_kind === 'file';
    const importedFile = selected ? importedFiles[selected.path.join('/')] : undefined;
    const containsFiles = collectTables(tree).some(node => node.metadata?.artifact_kind === 'file');
    const previewPrompt = selected && <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 120, gap: 1, p: 2 }}>
        {!isFile && isTableTooLarge(selected) && <Button variant="contained" size="small" disabled={importing || readOnly}
            startIcon={importing ? <CircularProgress size={14} /> : undefined}
            onClick={() => void loadReference(selected)} sx={{ textTransform: 'none' }}>
            {t('connectorPreview.addReference', { defaultValue: 'Add table reference' })}
        </Button>}
        <Button variant="contained" size="small" disabled={importing}
            onClick={() => void previewTable(selected, true)} sx={{ textTransform: 'none' }}>
            {t('chatConnector.viewPreview', { defaultValue: 'View preview' })}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 360, textAlign: 'center', overflowWrap: 'anywhere' }}>
            {previewWarning(selected)}
        </Typography>
    </Box>;

    return <Box ref={setBrowserElement} sx={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: splitView ? 'minmax(220px, 30%) minmax(0, 1fr)' : 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', flex: 1, minHeight: 0 }}>
        <Box component="nav" aria-label={t('chatConnector.tables', { defaultValue: 'Tables' })}
            aria-hidden={detailOpen && !splitView}
            sx={{ gridArea: '1 / 1', visibility: detailOpen && !splitView ? 'hidden' : 'visible', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, pt: 1,
                borderRight: splitView ? '1px solid' : 'none', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 0.75, pr: splitView ? 1 : 0, flexShrink: 0 }}>
                <TextField fullWidth size="small" placeholder={containsFiles ? t('upload.searchFilesAndTables', { defaultValue: 'Search files and tables' }) : t('chatConnector.searchTables', { defaultValue: 'Search tables' })}
                    slotProps={{ htmlInput: { 'aria-label': containsFiles ? t('upload.searchFilesAndTables', { defaultValue: 'Search files and tables' }) : t('chatConnector.searchTables', { defaultValue: 'Search tables' }) },
                        input: {
                            startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: iconVar.md }} /></InputAdornment>,
                            endAdornment: !loading && !error ? <InputAdornment position="end">
                                <Tooltip title={containsFiles ? t('upload.catalogItems', { defaultValue: '{{count}} items', count: tableCount }) : t('chatConnector.catalogCount', { defaultValue: '{{count}} tables', count: tableCount })}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{tableCount.toLocaleString()}</Typography>
                                </Tooltip>
                            </InputAdornment> : undefined,
                        } }}
                    sx={{ minWidth: 0, '& .MuiInputBase-root': { fontSize: '0.8125rem', height: 30, borderRadius: 1, px: 1 }, '& .MuiInputBase-input': { py: 0.5 }, '& .MuiInputAdornment-positionStart': { mr: 0.75 } }} value={query} onChange={event => setQuery(event.target.value)} />
                <Tooltip title={t('chatConnector.refreshCatalog', { defaultValue: 'Refresh catalog' })}><span>
                    <IconButton size="small" disabled={loading || importing} onClick={() => setRefresh(current => current + 1)}
                        aria-label={t('chatConnector.refreshCatalog', { defaultValue: 'Refresh catalog' })}><RefreshIcon sx={{ fontSize: iconVar.md }} /></IconButton>
                </span></Tooltip>
            </Box>
            {query.trim() && !loading && !error && <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                {containsFiles ? t('upload.matchingItems', { defaultValue: '{{count}} matching items', count: countTables(filtered) }) : t('chatConnector.catalogMatches', { defaultValue: '{{count}} matching tables', count: countTables(filtered) })}
            </Typography>}
            <Box ref={setCatalogScrollParent} sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 0.5, scrollbarGutter: 'stable' }}>
                {loading ? <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                    <CircularProgress size={16} /><Typography variant="body2" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{catalogProgress || t('chatConnector.loadingCatalog', { defaultValue: 'Loading source catalog...' })}</Typography>
                </Box> : error ? <Typography variant="body2" color="error" role="alert" sx={{ overflowWrap: 'anywhere' }}>{error}</Typography> :
                    filtered.length ? <VirtualizedCatalogTree nodes={filtered} loadedMap={loadedMap}
                        expandedIds={query.trim() ? collectNamespaceIds(filtered) : expanded} onExpandedChange={setExpanded}
                        onItemClick={node => void previewTable(node)} selectedItemId={selected?.path.join('/')}
                        loadingItemId={previewLoading ? selected?.path.join('/') : null} maxHeight="none" scrollParent={catalogScrollParent} />
                    : <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{containsFiles ? t('upload.noMatchingItems', { defaultValue: 'No matching files or tables found.' }) : t('chatConnector.noTables', { defaultValue: 'No matching tables found.' })}</Typography>}
            </Box>
        </Box>
        <Box component="section" aria-label={t('chatConnector.tableDetails', { defaultValue: 'Table details' })}
            sx={{ gridArea: splitView ? '1 / 2' : '1 / 1', display: detailOpen || splitView ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, minHeight: 0, pt: 2, pl: splitView ? 2 : 0 }}>
        {!selected && splitView && <Typography sx={{ m: 'auto', p: 2, color: 'text.secondary', fontSize: textVar.md }}>
            {containsFiles ? t('upload.selectFileOrTable', { defaultValue: 'Select a file or table' }) : t('chatConnector.selectTable', { defaultValue: 'Select a table' })}
        </Typography>}
        {selected && <>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mb: 1, flexShrink: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flex: '1 1 280px', minWidth: 0 }}>
                {!splitView && <Tooltip title={t('chatConnector.backToTables', { defaultValue: 'Back to tables' })}>
                    <span><IconButton size="small" color="primary" disabled={importing} aria-label={t('chatConnector.backToTables', { defaultValue: 'Back to tables' })}
                        onClick={() => { previewRequest.current?.abort(); setDetailOpen(false); setPreviewLoading(false); }}><ArrowBackIcon fontSize="small" /></IconButton></span>
                </Tooltip>}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography component="h2" sx={{ fontSize: 16, fontWeight: 600, color: 'text.primary', lineHeight: 1.5, overflowWrap: 'anywhere', m: 0 }}>{selected.name}</Typography>
                    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', color: 'text.secondary', mt: 0.25,
                        '& .MuiTypography-root': { fontSize: textVar.sm, fontWeight: 400, lineHeight: 1.5 } }}>
                        {isFile ? <Typography variant="caption">{selected.metadata?.file_type?.toUpperCase()} · {Number(selected.metadata?.file_size || 0).toLocaleString()} bytes</Typography> : <>
                        {rowCount != null && <Typography variant="caption">{t('chatConnector.rowCount', { defaultValue: '{{count}} rows', count: Number(rowCount).toLocaleString() })}</Typography>}
                        {(preview || selected.metadata?.columns) && <Typography variant="caption">{t('chatConnector.columnCount', { defaultValue: '{{count}} columns', count: selectedColumns.length })}</Typography>}
                        </>}
                        {loadedMap[selected.path.join('/')] && <Typography variant="caption">{t('connectorPreview.loaded', { defaultValue: 'Loaded' })}</Typography>}
                    </Box>
                </Box>
                </Box>
                {!splitView && <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, ml: 'auto', minWidth: 0, maxWidth: '100%',
                    color: 'text.secondary', '& .MuiTypography-root': { fontSize: textVar.sm, fontWeight: 400 },
                    '& .MuiButton-root:not(.Mui-disabled) .MuiSvgIcon-root': { color: 'primary.main' },
                    '& .MuiButton-root:hover': { bgcolor: 'action.hover' } }}>
                <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto', minWidth: 0, maxWidth: '100%' }}>
                    <Tooltip title={`${t('chatConnector.previousTable', { defaultValue: 'Previous table' })}${previousTable ? `: ${previousTable.name}` : ''}`}>
                        <Box component="span" sx={{ minWidth: 0, maxWidth: 180, flex: '0 1 auto' }}>
                            <Button size="small" color="inherit" disabled={importing || !previousTable} startIcon={<ChevronLeftIcon fontSize="small" />}
                                aria-label={t('chatConnector.previousTable', { defaultValue: 'Previous table' })}
                                sx={{ width: '100%', minWidth: 0, height: 30, px: 0.75, textTransform: 'none', color: 'text.secondary' }}
                                onClick={() => previousTable && void previewTable(previousTable)}>
                                <Typography component="span" variant="caption" noWrap sx={{ minWidth: 0 }}>
                                    {previousTable?.name}
                                </Typography>
                            </Button>
                        </Box>
                    </Tooltip>
                    <Tooltip title={`${t('chatConnector.nextTable', { defaultValue: 'Next table' })}${nextTable ? `: ${nextTable.name}` : ''}`}>
                        <Box component="span" sx={{ minWidth: 0, maxWidth: 180, flex: '0 1 auto' }}>
                            <Button size="small" color="inherit" disabled={importing || !nextTable} endIcon={<ChevronRightIcon fontSize="small" />}
                                aria-label={t('chatConnector.nextTable', { defaultValue: 'Next table' })}
                                sx={{ width: '100%', minWidth: 0, height: 30, px: 0.75, textTransform: 'none', color: 'text.secondary' }}
                                onClick={() => nextTable && void previewTable(nextTable)}>
                                <Typography component="span" variant="caption" noWrap sx={{ minWidth: 0 }}>
                                    {nextTable?.name}
                                </Typography>
                            </Button>
                        </Box>
                    </Tooltip>
                </Box>
                </Box>}
            </Box>
            {isFile ? <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {importedFile ? <WorkspaceFileCanvas fileName={importedFile} /> : <>
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                    {previewDeferred && previewPrompt}
                    {previewLoading && <CircularProgress size={24} />}
                    {sourceFile && <WorkspaceFileCanvas key={selected.path.join('/')} fileName={sourceFile.name} sourceFile={sourceFile} />}
                </Box>
                <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
                    {previewError && <Typography role="alert" color="error" sx={{ mb: 2 }}>{previewError}</Typography>}
                    <Button variant="contained" disabled={importing} onClick={async () => {
                        setImporting(true);
                        setPreviewError('');
                        try {
                            const data = await importConnectorFile(connectorId, selected.path.join('/'));
                            setImportedFiles(current => ({ ...current, [selected.path.join('/')]: data.name }));
                            dispatch(dfActions.setFocused({ type: 'file', fileName: data.name }));
                        } catch (caught) {
                            setPreviewError(caught instanceof Error ? caught.message : String(caught));
                        } finally { setImporting(false); }
                    }}>{importing ? t('common.loading', { defaultValue: 'Loading...' }) : t('upload.loadFile', { defaultValue: 'Load file' })}</Button>
                </Box></>}
            </Box> : <>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Tabs value={activeTab} onChange={(_event, value) => setActiveTab(value)} variant="scrollable" scrollButtons="auto"
                aria-label={t('chatConnector.tableDetails', { defaultValue: 'Table details' })}
                sx={{ minHeight: 36, minWidth: 0, maxWidth: '100%',
                    '& .MuiTab-root': { minHeight: 36, minWidth: 0, px: 1.5, py: 0.75, textTransform: 'none', fontSize: textVar.md,
                        fontWeight: 400, color: 'text.secondary', '&.Mui-selected': { color: 'primary.main', fontWeight: 600 } },
                    '& .MuiTabs-indicator': { height: 2 } }}>
                <Tab value="data" id="source-tab-data" aria-controls="source-panel-data" label={t('chatConnector.sampleData', { defaultValue: 'Sample data' })} />
                <Tab value="columns" id="source-tab-columns" aria-controls="source-panel-columns" label={t('chatConnector.columns', { defaultValue: 'Columns' })} />
                <Tab value="overview" id="source-tab-overview" aria-controls="source-panel-overview" label={t('chatConnector.overview', { defaultValue: 'Overview' })} />
            </Tabs>
            {activeTab === 'data' && preview && <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', py: 0.75, fontSize: textVar.sm, fontWeight: 400 }}>
                {t('chatConnector.sampleCount', { defaultValue: '{{count}} sample rows', count: preview.rows.length })}
            </Typography>}
            </Box>
            {previewError && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography color="error" role="alert" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{previewError}</Typography>
                <Tooltip title={t('chatConnector.retryPreview', { defaultValue: 'Retry preview' })}>
                    <IconButton aria-label={t('chatConnector.retryPreview', { defaultValue: 'Retry preview' })}
                        onClick={() => void previewTable(selected, true)}><RefreshIcon /></IconButton>
                </Tooltip>
            </Box>}
            <Box role="tabpanel" id="source-panel-overview" aria-labelledby="source-tab-overview" hidden={activeTab !== 'overview'} sx={{ overflow: 'auto', py: 2 }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7 }}>
                    {description || t('chatConnector.noDescription', { defaultValue: 'No description available.' })}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 3, mb: 0.5 }}>{t('chatConnector.tablePath', { defaultValue: 'Table path' })}</Typography>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selected.path.join(' / ')}</Typography>
            </Box>
            <Box role="tabpanel" id="source-panel-columns" aria-labelledby="source-tab-columns" hidden={activeTab !== 'columns'} sx={{ overflow: 'auto', flex: activeTab === 'columns' ? 1 : undefined, minHeight: 0 }}>
                {selectedColumns.length ? <Table size="small" stickyHeader aria-label={t('chatConnector.columns', { defaultValue: 'Columns' })}
                    sx={{ tableLayout: 'fixed', '& .MuiTableCell-root': { fontSize: 12, py: 1, px: 1.5, overflowWrap: 'anywhere', verticalAlign: 'top' } }}>
                    <TableHead><TableRow>
                        <TableCell sx={{ width: '35%' }}>{t('chatConnector.columnName', { defaultValue: 'Name' })}</TableCell>
                        <TableCell sx={{ width: '25%' }}>{t('chatConnector.columnType', { defaultValue: 'Type' })}</TableCell>
                        <TableCell>{t('chatConnector.columnDescription', { defaultValue: 'Description' })}</TableCell>
                    </TableRow></TableHead>
                    <TableBody>{selectedColumns.map(column => <TableRow key={column.name}>
                        <TableCell component="th" scope="row">{column.name}</TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>{column.source_type || column.type}</TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>{column.description || '-'}</TableCell>
                    </TableRow>)}</TableBody>
                </Table> : <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{previewLoading
                    ? t('chatConnector.loadingColumns', { defaultValue: 'Loading columns...' })
                    : t('chatConnector.noColumns', { defaultValue: 'No column metadata available.' })}</Typography>}
            </Box>
            <Box role="tabpanel" id="source-panel-data" aria-labelledby="source-tab-data" hidden={activeTab !== 'data'}
                sx={{ display: activeTab === 'data' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', pt: 1.5 }}>
            {previewDeferred ? previewPrompt : <ConnectorTablePreview key={`${connectorId}:${selected.path.join('/')}`} connectorId={connectorId} sourceTable={sourceRef(selected)} displayName={selected.name}
                hideHeader
                dockActions
                previewRowLimit={CATALOG_PREVIEW_ROW_LIMIT}
                loadLabel={isTableTooLarge(selected) ? t('connectorPreview.addReference', { defaultValue: 'Add table reference' }) : undefined}
                columns={preview?.columns || []} sampleRows={preview?.rows || []} rowCount={preview?.count ?? null}
                loading={previewLoading || importing} alreadyLoaded={Boolean(loadedMap[selected.path.join('/')])}
                hideLoadActions={!preview || !!previewError}
                onRefreshPreview={(rows, columns, count) => setPreview({ rows, columns, count })}
                onLoad={async importOptions => {
                    if (isTableTooLarge(selected)) {
                        await loadReference(selected, importOptions);
                        return;
                    }
                    setImporting(true);
                    setPreviewError('');
                    try {
                        await dispatch(loadTable({ connectorId, sourceTableRef: sourceRef(selected), importOptions,
                            table: { kind: 'table', id: selected.name, displayId: selected.name, names: [], metadata: {}, rows: [], description: '',
                                virtual: { tableId: selected.name, rowCount: selected.metadata?.row_count || 0 },
                                source: { type: 'database', databaseTable: selected.path.join('/'), canRefresh: true, lastRefreshed: Date.now(), connectorId } },
                        })).unwrap();
                    } catch (caught) { setPreviewError(caught instanceof Error ? caught.message : String(caught)); }
                    finally { setImporting(false); }
                }} />}
            </Box>
            </>}
        </>}
        </Box>
        </Box>
    </Box>;
};