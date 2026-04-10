// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, IconButton, Tooltip, Paper, Divider, Alert,
    useTheme, alpha, LinearProgress, Chip, CircularProgress, Collapse,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DownloadIcon from '@mui/icons-material/Download';
import FilterListIcon from '@mui/icons-material/FilterList';
import TableRowsIcon from '@mui/icons-material/TableRows';
import { useTranslation } from 'react-i18next';

import {
    fetchDashboards as apiFetchDashboards,
    fetchDashboardDatasets as apiFetchDashboardDatasets,
    loadDataset as apiLoadDataset,
    SupersetDashboard,
    SupersetDataset,
} from './api';
import { SupersetFilterDialog } from './SupersetFilterDialog';

interface SupersetDashboardsProps {
    onDatasetLoaded?: (tableName: string, rowCount: number) => void;
}

export const SupersetDashboards: FC<SupersetDashboardsProps> = ({ onDatasetLoaded }) => {
    const theme = useTheme();
    const { t } = useTranslation();

    const [dashboards, setDashboards] = useState<SupersetDashboard[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [datasetsMap, setDatasetsMap] = useState<Record<number, SupersetDataset[]>>({});
    const [loadingDatasetsFor, setLoadingDatasetsFor] = useState<number | null>(null);
    const [loadingDatasetId, setLoadingDatasetId] = useState<number | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const [filterDialogOpen, setFilterDialogOpen] = useState(false);
    const [filterDialogDashboard, setFilterDialogDashboard] = useState<SupersetDashboard | null>(null);
    const [filterDialogDataset, setFilterDialogDataset] = useState<SupersetDataset | null>(null);

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

    const toggleExpand = async (dashboardId: number) => {
        if (expandedId === dashboardId) {
            setExpandedId(null);
            return;
        }
        setExpandedId(dashboardId);

        if (!datasetsMap[dashboardId]) {
            setLoadingDatasetsFor(dashboardId);
            try {
                const ds = await apiFetchDashboardDatasets(dashboardId);
                setDatasetsMap(prev => ({ ...prev, [dashboardId]: ds }));
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoadingDatasetsFor(null);
            }
        }
    };

    const doLoadDataset = async (
        dataset: SupersetDataset,
        tableNameOverride?: string,
        filters?: Array<{ column: string; operator: string; value: unknown }>,
    ) => {
        setLoadingDatasetId(dataset.id);
        setError(null);
        setSuccessMessage(null);
        try {
            const result = await apiLoadDataset({
                dataset_id: dataset.id,
                row_limit: 20000,
                table_name: tableNameOverride,
                filters,
            });
            setSuccessMessage(t('plugin.superset.loadSuccess', { name: result.table_name, count: result.row_count }));
            onDatasetLoaded?.(result.table_name, result.row_count);
        } catch (err: any) {
            setError(t('plugin.superset.loadFailed', { message: err.message }));
        } finally {
            setLoadingDatasetId(null);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

            {error && <Alert severity="error" sx={{ mx: 1.5, mt: 1, fontSize: 12 }} onClose={() => setError(null)}>{error}</Alert>}
            {successMessage && <Alert severity="success" sx={{ mx: 1.5, mt: 1, fontSize: 12 }} onClose={() => setSuccessMessage(null)}>{successMessage}</Alert>}
            {loading && <LinearProgress sx={{ mx: 1.5 }} />}

            <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 0.5 }}>
                {!loading && dashboards.length === 0 && (
                    <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 3, fontSize: 13 }}>
                        {t('plugin.superset.noDashboards')}
                    </Typography>
                )}

                {dashboards.map(db => (
                    <Paper
                        key={db.id}
                        variant="outlined"
                        sx={{
                            mb: 1,
                            borderColor: expandedId === db.id ? theme.palette.primary.main : alpha(theme.palette.divider, 0.15),
                        }}
                    >
                        <Box
                            sx={{ display: 'flex', alignItems: 'center', p: 1.5, cursor: 'pointer' }}
                            onClick={() => toggleExpand(db.id)}
                        >
                            <DashboardIcon sx={{ fontSize: 16, color: 'primary.main', mr: 1 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {db.title}
                                </Typography>
                                <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                                    {db.changed_on_delta_humanized}
                                    {db.owners.length > 0 && ` · ${db.owners.join(', ')}`}
                                </Typography>
                            </Box>
                            {expandedId === db.id ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <ExpandMoreIcon sx={{ fontSize: 18 }} />}
                        </Box>

                        <Collapse in={expandedId === db.id}>
                            <Divider />
                            <Box sx={{ p: 1 }}>
                                {loadingDatasetsFor === db.id && <LinearProgress sx={{ mb: 1 }} />}
                                {datasetsMap[db.id]?.map(ds => (
                                    <Box
                                        key={ds.id}
                                        sx={{
                                            display: 'flex', alignItems: 'center', gap: 1,
                                            p: 1, borderRadius: 1,
                                            '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.04) },
                                        }}
                                    >
                                        <TableRowsIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                        <Typography variant="body2" sx={{ flex: 1, fontSize: 12 }}>{ds.name}</Typography>
                                        <Tooltip title={t('plugin.superset.loadDirect')}>
                                            <span>
                                                <IconButton size="small" onClick={() => doLoadDataset(ds)} disabled={loadingDatasetId === ds.id}>
                                                    {loadingDatasetId === ds.id ? <CircularProgress size={12} /> : <DownloadIcon sx={{ fontSize: 14 }} />}
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                        <Tooltip title={t('plugin.superset.loadWithFilters')}>
                                            <IconButton
                                                size="small"
                                                onClick={() => {
                                                    setFilterDialogDashboard(db);
                                                    setFilterDialogDataset(ds);
                                                    setFilterDialogOpen(true);
                                                }}
                                            >
                                                <FilterListIcon sx={{ fontSize: 14 }} />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                ))}
                                {datasetsMap[db.id]?.length === 0 && (
                                    <Typography variant="caption" sx={{ color: 'text.secondary', px: 1 }}>
                                        {t('plugin.superset.noDatasetsInDashboard')}
                                    </Typography>
                                )}
                            </Box>
                        </Collapse>
                    </Paper>
                ))}
            </Box>

            {filterDialogOpen && filterDialogDashboard && filterDialogDataset && (
                <SupersetFilterDialog
                    open={filterDialogOpen}
                    dashboardId={filterDialogDashboard.id}
                    dashboardTitle={filterDialogDashboard.title}
                    dataset={filterDialogDataset}
                    onClose={() => setFilterDialogOpen(false)}
                    onSubmit={(filters, tableNameOverride) => {
                        setFilterDialogOpen(false);
                        doLoadDataset(filterDialogDataset, tableNameOverride, filters);
                    }}
                />
            )}
        </Box>
    );
};
