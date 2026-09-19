import React, { useEffect, useState } from 'react';
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import LinkIcon from '@mui/icons-material/Link';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../app/apiClient';
import { CONNECTOR_ACTION_URLS } from '../app/utils';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import type { ExternalTableReference } from '../components/ComponentType';
import { LoadingStatus } from '../components/FunComponents';
import { formatBytes, formatCellValue, getColumnAlign } from './ViewUtils';
import { SelectableDataGrid, type ColumnDef } from './SelectableDataGrid';
import { Type } from '../data/types';
import { textVar } from '../app/layout';
import '../scss/DataView.scss';

const SAMPLE_ROW_LIMIT = 50;
const PREVIEW_TIMEOUT_MS = 120_000;
const SLOW_PREVIEW_SECONDS = 15;

export const ExternalTableReferenceCanvas: React.FC<{ referenceId: string }> = ({ referenceId }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const store = useStore<DataFormulatorState>();
    const readOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly);
    const reference = useSelector((state: DataFormulatorState) => state.externalTableReferences?.find(item => item.id === referenceId));
    const [busy, setBusy] = useState<'refresh' | 'sample' | null>(null);
    const [error, setError] = useState('');
    const [stopped, setStopped] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [refreshVersion, setRefreshVersion] = useState(0);
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
        ...(reference?.summary.columns || []).map(column => {
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
        setElapsedSeconds(0);
        if (!source || readOnly || (refreshVersion === 0 && source.summary.sampleRows !== undefined)) return;
        const controller = new AbortController();
        const startedAt = Date.now();
        const interval = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
        const timeout = window.setTimeout(() => {
            controller.abort();
            window.clearInterval(interval);
            setBusy(null);
            setStopped(true);
        }, PREVIEW_TIMEOUT_MS);
        const loadSample = async () => {
            setBusy(refreshVersion ? 'refresh' : 'sample');
            try {
                const { data } = await apiRequest<{
                    columns: { name: string; type?: string }[];
                    rows: Record<string, unknown>[];
                    source_location?: ExternalTableReference['sourceLocation'];
                }>(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connector_id: source.connectorId, source_table: source.sourceTable, limit: SAMPLE_ROW_LIMIT, import_options: { size: SAMPLE_ROW_LIMIT } }),
                    signal: controller.signal,
                });
                const current = store.getState().externalTableReferences.find(item => item.id === source.id);
                if (!current || controller.signal.aborted) return;
                let sampleTruncated = false;
                const sampleRows = (data.rows || []).slice(0, SAMPLE_ROW_LIMIT).map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => {
                    const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
                    if (text.length <= 1000) return [name, value];
                    sampleTruncated = true;
                    return [name, `${text.slice(0, 1000)}...`];
                })));
                const columns = (data.columns || []).map(column => {
                    const cached = current.summary.columns.find(item => item.name === column.name);
                    return { ...cached, name: column.name, type: column.type || cached?.type || 'string' };
                });
                const updated: ExternalTableReference = { ...current, capturedAt: new Date().toISOString(),
                    sourceLocation: data.source_location || current.sourceLocation,
                    summary: { ...current.summary, columns, sampleRows, sampleTruncated } };
                dispatch(dfActions.upsertExternalTableReference(updated));
            } catch (reason) {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
            } finally {
                window.clearInterval(interval);
                window.clearTimeout(timeout);
                if (!controller.signal.aborted) setBusy(null);
            }
        };
        void loadSample();
        return () => {
            controller.abort();
            window.clearInterval(interval);
            window.clearTimeout(timeout);
        };
    }, [availableReferenceId, readOnly, refreshVersion, store, dispatch]);

    const initialLoading = !!reference && sample === undefined && !error && !stopped && !readOnly;
    const columnCount = reference && (reference.summary.columns.length > 0 || sample !== undefined)
        ? t('dataGrid.columnCount', { count: reference.summary.columns.length }) : null;
    const loadingLabel = elapsedSeconds >= SLOW_PREVIEW_SECONDS
        ? t('externalReference.waitingForSource', { defaultValue: 'Still waiting for the source...' })
        : t('externalReference.loadingPreview', { name: title, defaultValue: 'Loading table preview: {{name}}...' });

    return <Box id="vis-view-canvas" sx={{ width: '100%', flex: 1, minWidth: 0, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', px: { xs: 1.5, sm: 3 }, py: 2, boxSizing: 'border-box' }}>
        <Box sx={{ width: '100%', maxWidth: 1200, mx: 'auto', py: 2, flexShrink: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, px: 0.5, pb: 1, pr: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                        <Typography component="h2" sx={{ fontSize: textVar.xl, fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.2, m: 0 }}>{title}</Typography>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                            <LinkIcon sx={{ fontSize: 14, flexShrink: 0 }} />
                            <Typography component="span" sx={{ fontSize: textVar.xs }}>{t('externalReference.virtual', { defaultValue: 'Virtual' })}</Typography>
                        </Box>
                    </Box>
                    {reference && <Typography color="text.secondary" sx={{ fontSize: textVar.xs, mt: 0.25 }}>
                        {[sample !== undefined ? t('externalReference.sampleCount', { count: sample.length, defaultValue: '{{count}} sample rows' }) : null,
                            columnCount, formatBytes(reference.summary.sizeBytes ?? null)].filter(Boolean).join(' · ')}
                    </Typography>}
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
            {busy && !initialLoading && <Box sx={{ mb: 1, color: 'text.secondary' }}>
                <Typography role="status" sx={{ fontSize: textVar.sm }}>{loadingLabel}</Typography>
            </Box>}
            {reference && <>
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
            </>}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 1.5, width: '100%' }}>
            <Box sx={{ flex: 1, minWidth: 0, '& .MuiTypography-root': { fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere', lineHeight: 1.6 } }}>
                {reference && <>
                    <Typography>
                        {t('externalReference.virtualDescription', { defaultValue: 'Virtual table. Full data remains in the connected source.' })}
                    </Typography>
                    <Typography>
                        {t('externalReference.locationLabel', { defaultValue: 'Location:' })}{' '}
                        {[reference.sourceLocation?.address, reference.sourceLocation?.database,
                            reference.sourceTable.name].filter(Boolean).join(' / ')}
                    </Typography>
                    <Typography>
                        {t('externalReference.connectorLabel', { defaultValue: 'Connector:' })}{' '}
                        {[reference.connectorName || reference.connectorId,
                            reference.summary.rowCount != null ? t('chatConnector.rowCount', { count: reference.summary.rowCount.toLocaleString(), defaultValue: '{{count}} rows' }) : null,
                            columnCount,
                            formatBytes(reference.summary.sizeBytes ?? null),
                            new Date(reference.capturedAt).toLocaleString()].filter(Boolean).join(' · ')}
                    </Typography>
                    {reference.summary.description && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{reference.summary.description}</Typography>}
                </>}
            </Box>
        </Box>
        </Box>
    </Box>;
};