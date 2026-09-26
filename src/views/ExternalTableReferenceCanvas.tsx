import React, { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, Link, Tooltip, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../app/apiClient';
import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { importExternalTableReference } from '../app/tableThunks';
import type { ExternalTableReference } from '../components/ComponentType';
import { InlineLoadingStatus, LoadingStatus } from '../components/FunComponents';
import { formatBytes, formatCellValue, getColumnAlign } from './ViewUtils';
import { SelectableDataGrid, type ColumnDef } from './SelectableDataGrid';
import { Type } from '../data/types';
import { textVar } from '../app/layout';
import '../scss/DataView.scss';

const SAMPLE_ROW_LIMIT = 50;
const PREVIEW_TIMEOUT_MS = 120_000;

export const ExternalTableReferenceCanvas: React.FC<{ referenceId: string }> = ({ referenceId }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const store = useStore<DataFormulatorState>();
    const readOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly);
    const reference = useSelector((state: DataFormulatorState) => state.externalTableReferences?.find(item => item.id === referenceId));
    const [busy, setBusy] = useState<'refresh' | 'sample' | null>(null);
    const [error, setError] = useState('');
    const [stopped, setStopped] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importError, setImportError] = useState('');
    const importing = useSelector((state: DataFormulatorState) => state.pendingTableLoads.some(item => item.id === `import-copy:${referenceId}`));
    useEffect(() => { setImportDialogOpen(false); setImportError(''); }, [referenceId]);
    const sample = reference?.summary.sampleRows;
    const availableReferenceId = reference?.id;
    let title = reference?.displayName || t('externalReference.missing', { defaultValue: 'Reference unavailable' });
    if (reference && title === reference.sourceTable.name) {
        try { title = new URL(title).pathname; } catch {}
        title = title.split(/[\\/]/).filter(Boolean).pop() || reference.displayName;
    }
    const rows = (sample || []).map((row, index) => ({ ...row, '#rowId': index + 1 }));
    const columns: ColumnDef[] = [
        { id: '#rowId', label: '#', dataType: Type.Integer, source: 'original', width: 56, minWidth: 56 },
        ...(reference?.summary.columns || []).filter(column => !reference?.summary.sampleColumns
            || reference.summary.sampleColumns.includes(column.name)).map(column => {
            const dataType = Object.values(Type).includes(column.type as Type) ? column.type as Type : Type.String;
            const lengths = (sample || []).map(row => String(row[column.name] ?? '').length);
            const averageLength = lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, lengths.length);
            const width = Math.min(300, Math.max(110, Math.max(column.name.length, averageLength) * 8 + 50));
            return { id: column.name, label: column.name, dataType, source: 'original' as const,
                width, minWidth: width, align: getColumnAlign(dataType),
                description: [column.source_type || column.type, column.description].filter(Boolean).join(' - '),
                format: (value: unknown) => {
                    const text = value != null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
                    return <Box title={text} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeof value === 'object' && value != null ? text : formatCellValue(value, dataType)}</Box>;
                },
            };
        }),
    ];

    useEffect(() => {
        const source = store.getState().externalTableReferences.find(item => item.id === availableReferenceId);
        setBusy(null);
        setError('');
        setStopped(false);
        if (!source || readOnly || (refreshVersion === 0 && source.summary.sampleRows !== undefined)) return;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => {
            controller.abort();
            setBusy(null);
            setStopped(true);
        }, PREVIEW_TIMEOUT_MS);
        const loadSample = async () => {
            setBusy(refreshVersion ? 'refresh' : 'sample');
            try {
                const { data } = await apiRequest<{
                    columns: { name: string; type?: string }[];
                    rows: Record<string, unknown>[];
                    inspection?: ExternalTableReference['summary']['inspection'];
                    source_location?: ExternalTableReference['sourceLocation'];
                }>(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connector_id: source.connectorId, source_table: source.sourceTable, limit: SAMPLE_ROW_LIMIT, import_options: { size: SAMPLE_ROW_LIMIT } }),
                    signal: controller.signal,
                });
                const current = store.getState().externalTableReferences.find(item => item.id === source.id);
                if (!current || controller.signal.aborted) return;
                let sampleTruncated = data.inspection?.values_truncated || false;
                const sampleRows = (data.rows || []).slice(0, SAMPLE_ROW_LIMIT).map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => {
                    const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
                    if (text.length <= 1000) return [name, value];
                    sampleTruncated = true;
                    return [name, `${text.slice(0, 1000)}...`];
                })));
                const sampledColumns = (data.columns || []).map(column => {
                    const cached = current.summary.columns.find(item => item.name === column.name);
                    return { ...cached, name: column.name, type: column.type || cached?.type || 'string' };
                });
                const partialSchema = !!data.inspection?.columns_omitted || data.inspection?.schema_complete === false;
                const columns = partialSchema
                    ? current.summary.columns.map(column => sampledColumns.find(item => item.name === column.name) || column)
                    : [...sampledColumns];
                columns.push(...sampledColumns.filter(column => !columns.some(item => item.name === column.name)));
                const updated: ExternalTableReference = { ...current, capturedAt: new Date().toISOString(),
                    sourceLocation: data.source_location || current.sourceLocation,
                    summary: { ...current.summary, columns, sampleRows, sampleTruncated,
                        sampleColumns: sampledColumns.map(column => column.name), inspection: data.inspection } };
                dispatch(dfActions.upsertExternalTableReference(updated));
            } catch (reason) {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
            } finally {
                window.clearTimeout(timeout);
                if (!controller.signal.aborted) setBusy(null);
            }
        };
        void loadSample();
        return () => {
            controller.abort();
            window.clearTimeout(timeout);
        };
    }, [availableReferenceId, readOnly, refreshVersion, store, dispatch]);

    const initialLoading = !!reference && sample === undefined && !error && !stopped && !readOnly;
    const inspection = reference?.summary.inspection;
    const totalRows = reference?.summary.rowCount;
    const knownTotal = typeof totalRows === 'number' && Number.isFinite(totalRows) && totalRows >= 0
        && totalRows >= (sample?.length || 0);
    const location = [reference?.sourceLocation?.address, reference?.sourceLocation?.database,
        reference?.sourceTable.id].filter(Boolean).join(' / ');
    const fileType = reference?.sourceTable.id.match(/\.(csv|tsv|parquet|jsonl?|xlsx?)$/i)?.[1].toUpperCase();
    const loadingLabel = t('externalReference.loadingPreview', { name: title, defaultValue: 'Loading table preview: {{name}}...' });

    return <Box id="vis-view-canvas" sx={{ width: '100%', flex: 1, minWidth: 0, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', px: { xs: 1.5, sm: 3 }, py: 2, boxSizing: 'border-box' }}>
        <Box sx={{ width: '100%', maxWidth: 1200, mx: 'auto', py: 2, flexShrink: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, px: 0.5, pb: 1, pr: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                        <Typography component="h2" sx={{ fontSize: textVar.xl, fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.2, m: 0 }}>{title}</Typography>
                        <Typography component="span" sx={{ fontSize: textVar.xs, color: 'text.secondary', flexShrink: 0 }}>
                            {t('externalReference.virtual', { defaultValue: 'Virtual' })}
                        </Typography>
                    </Box>
                </Box>
                <Tooltip title={t('externalReference.refresh', { defaultValue: 'Refresh metadata' })}><span>
                    <IconButton size="small" sx={{ color: 'text.secondary' }} aria-label={t('externalReference.refresh', { defaultValue: 'Refresh metadata' })} disabled={!reference || readOnly} onClick={() => setRefreshVersion(version => version + 1)}>
                        <RefreshIcon fontSize="small" />
                    </IconButton>
                </span></Tooltip>
            </Box>
            {(error || stopped) && <Box role={error ? 'alert' : 'status'} sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap',
                columnGap: 1, rowGap: 0.25, px: 0.5, py: 0.5, mb: 0.5, minWidth: 0,
                fontSize: textVar.xs, lineHeight: 1.6, color: error ? 'error.main' : 'text.secondary' }}>
                <Typography sx={{ fontSize: 'inherit', lineHeight: 'inherit', minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
                    {error || t('externalReference.previewTimeout', { defaultValue: 'No preview received within 2 minutes. Stopped waiting; the source request may still be running.' })}
                </Typography>
                <Button color="inherit" size="small" startIcon={<RefreshIcon />} disabled={readOnly || !reference}
                    sx={{ fontSize: 'inherit', lineHeight: 'inherit', textTransform: 'none', minWidth: 0, px: 0.5, py: 0, flexShrink: 0,
                        '& .MuiButton-startIcon': { ml: 0, mr: 0.5 }, '& .MuiButton-startIcon > *': { fontSize: '1em' } }}
                    onClick={() => setRefreshVersion(version => version + 1)}>
                    {t('externalReference.retry', { defaultValue: 'Retry' })}
                </Button>
            </Box>}
            {busy && !initialLoading && <InlineLoadingStatus label={loadingLabel} sx={{ mb: 1 }} />}
            {reference && <>
                {sample !== undefined && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, pb: 0.75 }}>
                    <Typography color="text.secondary" sx={{ fontSize: textVar.xs }}>
                        {[inspection?.sample_method === 'source_head' && !inspection.filtered
                            ? t('externalReference.firstRows', { count: sample.length, defaultValue: 'First {{count}} rows' })
                            : t('externalReference.previewRows', { count: sample.length, defaultValue: '{{count}} preview rows' }),
                            t('externalReference.columnsShown', { count: columns.length - 1, defaultValue: '{{count}} columns shown' })].join(' · ')}
                    </Typography>
                </Box>}
                {initialLoading && reference.summary.columns.length > 0 && <Typography color="text.secondary"
                    sx={{ fontSize: textVar.xs, mb: 1, overflowWrap: 'anywhere' }}>
                    {reference.summary.columns.slice(0, 8).map(column => `${column.name} (${column.source_type || column.type})`).join(', ')}
                    {reference.summary.columns.length > 8 ? ', ...' : ''}
                </Typography>}
                <Box role="region" aria-label={t('chatConnector.sampleData', { defaultValue: 'Sample data' })}
                    sx={{ width: '100%', height: initialLoading ? 320 : Math.max(160, (sample?.length || 0) * 25 + 64), maxHeight: 'calc(100dvh - 280px)', minHeight: 160,
                        border: 1, borderColor: 'divider', borderRadius: '8px', overflow: 'hidden', bgcolor: 'action.hover' }}>
                    {initialLoading ? <LoadingStatus
                        label={loadingLabel}
                        sx={{ height: '100%', p: 2, boxSizing: 'border-box' }} />
                        : sample === undefined && (stopped || error) ? <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, boxSizing: 'border-box' }}>
                            <Typography color="text.secondary" sx={{ fontSize: textVar.sm }}>
                                {t('externalReference.previewUnavailable', { defaultValue: 'Preview not loaded.' })}
                            </Typography>
                        </Box>
                        : <SelectableDataGrid tableId={reference.id} tableName={title} rows={rows} rowCount={rows.length}
                            virtual={false} columnDefs={columns} previewOnly hideFooter />}
                </Box>
                {sample?.length === 0 && <Typography color="text.secondary" sx={{ py: 1, fontSize: textVar.sm }}>{t('externalReference.emptySample', { defaultValue: 'No sample rows returned.' })}</Typography>}
                {sample !== undefined && !!(inspection?.schema_source === 'inferred' || inspection?.columns_omitted || reference.summary.sampleTruncated) && <Typography color="text.secondary" sx={{ pt: 0.5, fontSize: textVar.xs, overflowWrap: 'anywhere' }}>
                    {[
                        inspection?.schema_source === 'inferred'
                            ? t('externalReference.inferredSchema', { defaultValue: 'Inferred schema; later records may differ.' }) : null,
                        reference.summary.inspection?.columns_omitted
                            ? t('externalReference.omittedColumns', { count: reference.summary.inspection.columns_omitted,
                                defaultValue: '{{count}} columns omitted from preview.' }) : null,
                        reference.summary.sampleTruncated
                            ? t('externalReference.shortenedValues', { defaultValue: 'Long or nested values shortened.' }) : null,
                    ].filter(Boolean).join(' ')}
                </Typography>}
            </>}
        {reference && <Box sx={{ mt: 0.75, px: 0.5, minWidth: 0,
            '& .MuiTypography-root': { fontSize: textVar.xs, lineHeight: 1.6, color: 'text.secondary', overflowWrap: 'anywhere' } }}>
            <Typography aria-label={t('externalReference.sourceMetadata', { defaultValue: 'Source metadata' })}>
                {[fileType, formatBytes(reference.summary.sizeBytes ?? null), knownTotal
                    ? t('externalReference.totalRowCount', { count: totalRows.toLocaleString(), defaultValue: '{{count}} total rows' })
                    : t('externalReference.totalRowsUnknown', { defaultValue: 'Total rows unknown' })].filter(Boolean).join(' · ')}
            </Typography>
            <Typography>
                <Tooltip title={t('externalReference.showInSources', { defaultValue: 'Show in data sources' })}>
                    <Link component="button" underline="hover" color="inherit" onClick={() => {
                        dispatch(dfActions.setDataSourceSidebarTab('sources'));
                        dispatch(dfActions.focusConnector(reference.connectorId));
                    }} sx={{ font: 'inherit', textAlign: 'left', verticalAlign: 'baseline', overflowWrap: 'anywhere', maxWidth: '100%' }}>
                        {location}
                    </Link>
                </Tooltip>
                {reference.connectorName ? ` · ${reference.connectorName}` : ''}
            </Typography>
            {reference.summary.description && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{reference.summary.description}</Typography>}
            <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1, mt: 0.5 }}>
            <Typography>
                {t('externalReference.sourceGuidance', { defaultValue: 'Data stays in the connected source and is read when needed.' })}
            </Typography>
            {!readOnly && (importing
                ? <Typography role="status">{t('externalReference.importing', { defaultValue: 'Importing workspace copy...' })}</Typography>
                : <Button size="small" startIcon={<DownloadIcon />} onClick={() => { setImportError(''); setImportDialogOpen(true); }}
                    sx={{ fontSize: textVar.xs, textTransform: 'none', py: 0, minHeight: 0 }}>
                    {t('externalReference.importAction', { defaultValue: 'Import into workspace' })}
                </Button>)}
            </Box>
            {importError && <Typography role="alert" sx={{ mt: 0.5 }}>{importError}</Typography>}
            <Dialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} maxWidth="xs" fullWidth aria-labelledby="import-copy-title">
                <DialogTitle id="import-copy-title">{t('externalReference.importTitle', { defaultValue: 'Import a workspace copy?' })}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t('externalReference.importDescription', { name: title,
                            defaultValue: 'Copy {{name}} into this workspace and replace its virtual reference. The original source will not be changed.' })}
                    </DialogContentText>
                    <DialogContentText sx={{ mt: 1 }}>
                        {t('externalReference.importTradeoff', { defaultValue: 'Importing a workspace copy can speed up analysis and reduce repeated reads from the source, but uses workspace storage and won\'t reflect future source changes.' })}
                    </DialogContentText>
                    <DialogContentText sx={{ mt: 1 }}>
                        {[formatBytes(reference.summary.sizeBytes ?? null), knownTotal
                            ? t('externalReference.totalRowCount', { count: totalRows.toLocaleString(), defaultValue: '{{count}} total rows' }) : null].filter(Boolean).join(' · ')}
                    </DialogContentText>
                    <DialogContentText sx={{ mt: 1 }}>
                        {t('externalReference.importLimit', { defaultValue: 'Full copies only, up to 2,000,000 rows. Larger sources remain virtual.' })}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setImportDialogOpen(false)}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
                    <Button variant="contained" disabled={importing || readOnly} onClick={async () => {
                        setImportDialogOpen(false);
                        try { await dispatch(importExternalTableReference(reference.id)).unwrap(); }
                        catch (error: any) { setImportError(error?.message || t('externalReference.importFailed', { defaultValue: 'Import failed. The virtual reference has not changed.' })); }
                    }}>{t('externalReference.importConfirm', { defaultValue: 'Import copy' })}</Button>
                </DialogActions>
            </Dialog>
        </Box>}
        </Box>
    </Box>;
};