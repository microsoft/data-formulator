import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { apiRequest } from '../app/apiClient';
import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { DataFormulatorState, dfSelectors } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { loadTable } from '../app/tableThunks';
import { CatalogTreeNode, collectNamespaceIds } from './CatalogTree';
import { VirtualizedCatalogTree } from './VirtualizedCatalogTree';
import { ColumnMeta, ConnectorTablePreview } from './ConnectorTablePreview';

export const ConnectedSourceOverview: React.FC<{ connectorId: string }> = ({ connectorId }) => {
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
    const [preview, setPreview] = useState<{ columns: ColumnMeta[]; rows: Record<string, any>[]; count: number | null } | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [importing, setImporting] = useState(false);
    const previewRequest = useRef<AbortController | null>(null);
    const sourceRef = (node: CatalogTreeNode) => {
        const name = node.metadata?._source_name || node.metadata?._catalogName || node.name;
        return { id: node.metadata?.dataset_id != null ? String(node.metadata.dataset_id) : name, name };
    };

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        setSelected(null);
        setPreview(null);
        setPreviewError('');
        setPreviewLoading(false);
        previewRequest.current?.abort();
        apiRequest<{ tree: CatalogTreeNode[] }>(CONNECTOR_ACTION_URLS.GET_CATALOG_TREE, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connector_id: connectorId }), signal: controller.signal,
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

    const previewTable = async (node: CatalogTreeNode) => {
        if (node.node_type !== 'table' || importing) return;
        previewRequest.current?.abort();
        const controller = new AbortController();
        previewRequest.current = controller;
        setSelected(node);
        setPreview(null);
        setPreviewError('');
        setPreviewLoading(true);
        try {
            const { data } = await apiRequest<any>(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ connector_id: connectorId, source_table: sourceRef(node), limit: 10 }),
            });
            if (!controller.signal.aborted) {
                const rows = data.rows || [];
                const total = data.total_row_count;
                const columns = (data.columns || []).map((column: ColumnMeta) => {
                    const catalogColumn = node.metadata?.columns?.find((item: ColumnMeta) => item.name === column.name);
                    return { ...column, source_type: column.source_type ?? catalogColumn?.source_type ?? catalogColumn?.type,
                        description: column.description ?? catalogColumn?.description };
                });
                setPreview({ columns, rows, count: total != null && (total > rows.length || rows.length < 10)
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

    return <Box sx={{ mt: 2, minWidth: 0 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
            <TextField fullWidth size="small" label={t('chatConnector.searchTables', { defaultValue: 'Search tables' })}
                value={query} onChange={event => setQuery(event.target.value)} />
            <Tooltip title={t('chatConnector.refreshCatalog', { defaultValue: 'Refresh catalog' })}><span>
                <IconButton disabled={loading || importing} onClick={() => setRefresh(current => current + 1)}
                    aria-label={t('chatConnector.refreshCatalog', { defaultValue: 'Refresh catalog' })}><RefreshIcon /></IconButton>
            </span></Tooltip>
        </Box>
        {loading ? <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
            <CircularProgress size={16} /><Typography variant="body2">{t('chatConnector.loadingCatalog', { defaultValue: 'Loading source catalog...' })}</Typography>
        </Box> : error ? <Typography color="error" role="alert" sx={{ overflowWrap: 'anywhere' }}>{error}</Typography> : <>
            <Typography variant="caption" color="text.secondary">{t('chatConnector.catalogCount', { defaultValue: '{{count}} tables', count: countTables(tree) })}</Typography>
            {filtered.length ? <VirtualizedCatalogTree nodes={filtered} loadedMap={loadedMap}
                expandedIds={query.trim() ? collectNamespaceIds(filtered) : expanded} onExpandedChange={setExpanded}
                onItemClick={node => void previewTable(node)} selectedItemId={selected?.path.join('/')}
                loadingItemId={previewLoading ? selected?.path.join('/') : null} maxHeight={360} />
                : <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('chatConnector.noTables', { defaultValue: 'No matching tables found.' })}</Typography>}
        </>}
        {selected && <Box sx={{ mt: 2, borderTop: 1, borderColor: 'divider', pt: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}><IconButton size="small" disabled={importing}
                aria-label={t('chatConnector.closePreview', { defaultValue: 'Close preview' })}
                onClick={() => { previewRequest.current?.abort(); setSelected(null); setPreviewLoading(false); }}><CloseIcon fontSize="small" /></IconButton></Box>
            {previewError && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography color="error" role="alert" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{previewError}</Typography>
                <Tooltip title={t('chatConnector.retryPreview', { defaultValue: 'Retry preview' })}>
                    <IconButton aria-label={t('chatConnector.retryPreview', { defaultValue: 'Retry preview' })}
                        onClick={() => void previewTable(selected)}><RefreshIcon /></IconButton>
                </Tooltip>
            </Box>}
            <ConnectorTablePreview connectorId={connectorId} sourceTable={sourceRef(selected)} displayName={selected.name}
                pathBreadcrumb={selected.path.join(' / ')} tableDescription={selected.metadata?.description}
                columns={preview?.columns || []} sampleRows={preview?.rows || []} rowCount={preview?.count ?? null}
                loading={previewLoading || importing} alreadyLoaded={Boolean(loadedMap[selected.path.join('/')])}
                hideLoadActions={!preview || !!previewError}
                onRefreshPreview={(rows, columns, count) => setPreview({ rows, columns, count })}
                onLoad={async importOptions => {
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
                }} />
        </Box>}
    </Box>;
};