// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, TextField, IconButton, Tooltip, Chip, Paper,
    Divider, Alert, useTheme, alpha, InputAdornment, LinearProgress,
    Collapse, Select, MenuItem, CircularProgress,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DownloadIcon from '@mui/icons-material/Download';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import TableRowsIcon from '@mui/icons-material/TableRows';
import PersonIcon from '@mui/icons-material/Person';
import { useTranslation } from 'react-i18next';

import {
    fetchDashboards as apiFetchDashboards,
    fetchDashboardDatasets as apiFetchDashboardDatasets,
    loadDataset as apiLoadDataset,
    SupersetDashboard,
    SupersetDataset,
} from './api';
import { SupersetFilterDialog, FilterPayload } from './SupersetFilterDialog';

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const MAX_COLUMN_DISPLAY = 60;
const MAX_TOOLTIP_ROWS = 12;
const ROW_LIMIT_OPTIONS = [20000, 50000, 100000, 200000, 500000];

const ColumnChip: FC<{ columns: string[] }> = ({ columns }) => {
    const { t } = useTranslation();
    const joined = columns.join(', ');
    const truncated = joined.length > MAX_COLUMN_DISPLAY;
    const display = truncated ? joined.slice(0, MAX_COLUMN_DISPLAY) + '…' : joined;

    return (
        <Tooltip
            title={
                <Box sx={{
                    maxWidth: 520, display: 'grid', gridAutoFlow: 'column',
                    gridTemplateRows: `repeat(${MAX_TOOLTIP_ROWS}, minmax(0, auto))`,
                    gridAutoColumns: 'minmax(140px, max-content)',
                    columnGap: 1.5, rowGap: 0.25, alignItems: 'start', fontSize: 11, lineHeight: 1.6,
                }}>
                    {columns.map((col, i) => (
                        <Box key={i} sx={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {col}
                        </Box>
                    ))}
                </Box>
            }
            placement="top" arrow
        >
            <Chip size="small" variant="outlined"
                label={`${t('plugin.superset.columns', { count: columns.length })}: ${display}`}
                sx={{
                    fontSize: 9, height: 'auto', minHeight: 16,
                    color: 'text.disabled', borderColor: 'divider',
                    '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.3, py: 0.25 },
                    maxWidth: '100%',
                }}
            />
        </Tooltip>
    );
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface SupersetDashboardsProps {
    onDatasetLoaded?: (tableName: string, rowCount: number) => void;
}

export const SupersetDashboards: FC<SupersetDashboardsProps> = ({ onDatasetLoaded }) => {
    const theme = useTheme();
    const { t } = useTranslation();

    const [dashboards, setDashboards] = useState<SupersetDashboard[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [datasetsMap, setDatasetsMap] = useState<Record<number, SupersetDataset[]>>({});
    const [loadingDatasetsFor, setLoadingDatasetsFor] = useState<number | null>(null);

    const [loadingDatasetId, setLoadingDatasetId] = useState<number | null>(null);
    const [rowLimit, setRowLimit] = useState<number>(20000);

    const [filterDialogOpen, setFilterDialogOpen] = useState(false);
    const [filterDialogDashboard, setFilterDialogDashboard] = useState<SupersetDashboard | null>(null);
    const [filterDialogDataset, setFilterDialogDataset] = useState<SupersetDataset | null>(null);

    /* ---- fetch dashboards ---- */

    const doFetchDashboards = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const dbs = await apiFetchDashboards();
            setDashboards(dbs);
        } catch (err: any) {
            setError(err.message || 'Network error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { doFetchDashboards(); }, [doFetchDashboards]);

    /* ---- expand / collapse ---- */

    const toggleExpand = async (dashboardId: number) => {
        if (expandedId === dashboardId) { setExpandedId(null); return; }
        setExpandedId(dashboardId);
        if (datasetsMap[dashboardId]) return;
        setLoadingDatasetsFor(dashboardId);
        try {
            const ds = await apiFetchDashboardDatasets(dashboardId);
            setDatasetsMap(prev => ({ ...prev, [dashboardId]: ds }));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoadingDatasetsFor(null);
        }
    };

    /* ---- load dataset ---- */

    const doLoadDataset = async (
        dataset: SupersetDataset,
        tableNameOverride?: string,
        filters?: FilterPayload[],
    ) => {
        setLoadingDatasetId(dataset.id);
        setError(null);
        setSuccessMessage(null);
        try {
            const result = await apiLoadDataset({
                dataset_id: dataset.id,
                row_limit: rowLimit,
                table_name: tableNameOverride,
                filters: filters as any,
            });
            setSuccessMessage(t('plugin.superset.loadSuccess', { name: result.table_name, count: result.row_count }));
            onDatasetLoaded?.(result.table_name, result.row_count);
        } catch (err: any) {
            setError(t('plugin.superset.loadFailed', { message: err.message }));
        } finally {
            setLoadingDatasetId(null);
        }
    };

    /* ---- search filter ---- */

    const filteredDashboards = dashboards.filter(db => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            (db.title ?? '').toLowerCase().includes(q) ||
            (db.slug ?? '').toLowerCase().includes(q) ||
            (db.owners ?? []).some(o => (o ?? '').toLowerCase().includes(q))
        );
    });

    /* ---- render ---- */

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
                <DashboardIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
                    {t('plugin.superset.dashboardsTitle')}
                </Typography>
                <Tooltip title={t('plugin.superset.refresh')}>
                    <IconButton size="small" onClick={doFetchDashboards} disabled={loading}>
                        <RefreshIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                </Tooltip>
            </Box>

            <Divider />

            {/* search + row limit */}
            <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                    size="small" fullWidth
                    placeholder={t('plugin.superset.searchDashboards')}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                            </InputAdornment>
                        ),
                    }}
                    sx={{ '& .MuiOutlinedInput-root': { fontSize: 13 } }}
                />
                <Tooltip title={t('plugin.superset.rowLimitTip')}>
                    <Select size="small" value={rowLimit} onChange={e => setRowLimit(Number(e.target.value))}
                        sx={{ fontSize: 12, minWidth: 90, '& .MuiSelect-select': { py: '6px' } }}
                    >
                        {ROW_LIMIT_OPTIONS.map(v => <MenuItem key={v} value={v} sx={{ fontSize: 12 }}>{v.toLocaleString()}</MenuItem>)}
                    </Select>
                </Tooltip>
            </Box>

            {/* alerts */}
            {error && <Alert severity="error" sx={{ mx: 1.5, fontSize: 12 }} onClose={() => setError(null)}>{error}</Alert>}
            {successMessage && <Alert severity="success" sx={{ mx: 1.5, fontSize: 12 }} onClose={() => setSuccessMessage(null)}>{successMessage}</Alert>}
            {loading && <LinearProgress sx={{ mx: 1.5 }} />}

            {/* dashboard list */}
            <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 0.5 }}>
                {!loading && filteredDashboards.length === 0 && (
                    <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 3, fontSize: 13 }}>
                        {t('plugin.superset.noDashboards')}
                    </Typography>
                )}

                {filteredDashboards.map(db => {
                    const isExpanded = expandedId === db.id;
                    const datasets = datasetsMap[db.id];

                    return (
                        <Paper key={db.id} variant="outlined" sx={{
                            mb: 1, borderColor: isExpanded ? theme.palette.primary.main : alpha(theme.palette.divider, 0.15),
                            transition: 'border-color 0.15s',
                            '&:hover': { borderColor: theme.palette.primary.main, backgroundColor: alpha(theme.palette.primary.main, 0.02) },
                        }}>
                            {/* dashboard row */}
                            <Box sx={{ display: 'flex', alignItems: 'center', p: 1.5, cursor: 'pointer' }} onClick={() => toggleExpand(db.id)}>
                                <DashboardIcon sx={{ fontSize: 16, color: 'primary.main', mr: 1, flexShrink: 0 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {db.title}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25, flexWrap: 'wrap', alignItems: 'center' }}>
                                        {db.owners.length > 0 && (
                                            <Chip size="small" variant="outlined"
                                                icon={<PersonIcon sx={{ fontSize: '12px !important' }} />}
                                                label={db.owners.join(', ')}
                                                sx={{ fontSize: 10, height: 18, color: 'text.secondary', borderColor: 'divider' }}
                                            />
                                        )}
                                        {db.changed_on_delta_humanized && (
                                            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
                                                {db.changed_on_delta_humanized}
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                                {isExpanded ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <ExpandMoreIcon sx={{ fontSize: 18 }} />}
                            </Box>

                            {/* expanded dataset list */}
                            <Collapse in={isExpanded}>
                                <Divider />
                                <Box sx={{ px: 1.5, py: 1 }}>
                                    {loadingDatasetsFor === db.id && <LinearProgress sx={{ mb: 1 }} />}
                                    {datasets && datasets.length === 0 && (
                                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                            {t('plugin.superset.noDatasetsInDashboard')}
                                        </Typography>
                                    )}
                                    {datasets && datasets.map(ds => (
                                        <Box key={ds.id} sx={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            py: 0.75, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' },
                                        }}>
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    <TableRowsIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
                                                    <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {ds.name}
                                                    </Typography>
                                                </Box>
                                                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25, alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
                                                        {`${ds.database}.${ds.schema}`}
                                                    </Typography>
                                                    <Chip size="small" variant="outlined"
                                                        label={t('plugin.superset.columns', { count: ds.column_count })}
                                                        sx={{ fontSize: 9, height: 16, color: 'text.disabled', borderColor: 'divider' }} />
                                                    {ds.row_count != null && (
                                                        <Chip size="small" variant="outlined"
                                                            label={t('plugin.superset.rows', { count: ds.row_count })}
                                                            sx={{ fontSize: 9, height: 16, color: 'text.disabled', borderColor: 'divider' }} />
                                                    )}
                                                </Box>
                                                {ds.column_names.length > 0 && (
                                                    <Box sx={{ mt: 0.5 }}><ColumnChip columns={ds.column_names} /></Box>
                                                )}
                                            </Box>
                                            <Box sx={{ display: 'flex', gap: 0.5, ml: 1, flexShrink: 0 }}>
                                                <Tooltip title={t('plugin.superset.loadWithFilters')}>
                                                    <span>
                                                        <IconButton size="small" disabled={loadingDatasetId === ds.id}
                                                            onClick={() => { setFilterDialogDashboard(db); setFilterDialogDataset(ds); setFilterDialogOpen(true); }}>
                                                            <FilterAltIcon sx={{ fontSize: 16 }} />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                                <Tooltip title={t('plugin.superset.loadDirect')}>
                                                    <span>
                                                        <IconButton size="small" onClick={() => doLoadDataset(ds)} disabled={loadingDatasetId === ds.id}>
                                                            {loadingDatasetId === ds.id ? <CircularProgress size={14} /> : <DownloadIcon sx={{ fontSize: 16 }} />}
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            </Collapse>
                        </Paper>
                    );
                })}
            </Box>

            {filterDialogOpen && filterDialogDashboard && filterDialogDataset && (
                <SupersetFilterDialog
                    open={filterDialogOpen}
                    dashboardId={filterDialogDashboard.id}
                    dashboardTitle={filterDialogDashboard.title}
                    dataset={filterDialogDataset}
                    onClose={() => { setFilterDialogOpen(false); setFilterDialogDashboard(null); setFilterDialogDataset(null); }}
                    onSubmit={async (filters, tableNameOverride) => {
                        if (!filterDialogDataset) return;
                        await doLoadDataset(filterDialogDataset, tableNameOverride, filters);
                    }}
                />
            )}
        </Box>
    );
};
