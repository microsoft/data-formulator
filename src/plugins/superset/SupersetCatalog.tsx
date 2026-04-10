// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Button, TextField, CircularProgress, IconButton,
    Tooltip, Chip, Paper, Divider, Alert, useTheme, alpha,
    InputAdornment, LinearProgress, Dialog, DialogTitle, DialogContent,
    DialogActions, Select, MenuItem,
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import AddIcon from '@mui/icons-material/Add';
import TableRowsIcon from '@mui/icons-material/TableRows';
import { useTranslation } from 'react-i18next';

import { fetchDatasets as apiFetchDatasets, loadDataset as apiLoadDataset, SupersetDataset } from './api';

const MAX_COLUMN_DISPLAY = 60;
const MAX_TOOLTIP_ROWS = 12;
const ROW_LIMIT_OPTIONS = [20000, 50000, 100000, 200000, 500000];

interface SupersetCatalogProps {
    onDatasetLoaded?: (tableName: string, rowCount: number) => void;
}

const ColumnChip: FC<{ columns: string[] }> = ({ columns }) => {
    const { t } = useTranslation();
    const joined = columns.join(', ');
    const truncated = joined.length > MAX_COLUMN_DISPLAY;
    const display = truncated ? joined.slice(0, MAX_COLUMN_DISPLAY) + '…' : joined;

    const chip = (
        <Chip
            size="small"
            variant="outlined"
            label={`${t('plugin.superset.columns', { count: columns.length })}: ${display}`}
            sx={{
                fontSize: 10, height: 'auto', minHeight: 18,
                color: 'text.secondary', borderColor: 'divider',
                '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.3, py: 0.25 },
                maxWidth: '100%',
            }}
        />
    );

    return (
        <Tooltip
            title={
                <Box sx={{
                    maxWidth: 520, display: 'grid', gridAutoFlow: 'column',
                    gridTemplateRows: `repeat(${MAX_TOOLTIP_ROWS}, minmax(0, auto))`,
                    gridAutoColumns: 'minmax(140px, max-content)',
                    columnGap: 1.5, rowGap: 0.25, fontSize: 11, lineHeight: 1.6,
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
            {chip}
        </Tooltip>
    );
};

export const SupersetCatalog: FC<SupersetCatalogProps> = ({ onDatasetLoaded }) => {
    const theme = useTheme();
    const { t } = useTranslation();

    const [datasets, setDatasets] = useState<SupersetDataset[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [loadingDatasetId, setLoadingDatasetId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [rowLimit, setRowLimit] = useState<number>(20000);
    const [suffixDialogOpen, setSuffixDialogOpen] = useState(false);
    const [suffixDialogDs, setSuffixDialogDs] = useState<SupersetDataset | null>(null);
    const [suffixInput, setSuffixInput] = useState('');

    const doFetchDatasets = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const ds = await apiFetchDatasets();
            setDatasets(ds);
        } catch (err: any) {
            setError(err.message || 'Network error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { doFetchDatasets(); }, [doFetchDatasets]);

    const doLoadDataset = async (dataset: SupersetDataset, tableNameOverride?: string) => {
        setLoadingDatasetId(dataset.id);
        setError(null);
        setSuccessMessage(null);
        try {
            const result = await apiLoadDataset({
                dataset_id: dataset.id,
                row_limit: rowLimit,
                table_name: tableNameOverride,
            });
            setSuccessMessage(t('plugin.superset.loadSuccess', {
                name: tableNameOverride || dataset.name,
                count: result.row_count,
            }));
            onDatasetLoaded?.(result.table_name, result.row_count);
        } catch (err: any) {
            setError(t('plugin.superset.loadFailed', { message: err.message }));
        } finally {
            setLoadingDatasetId(null);
        }
    };

    const filteredDatasets = datasets.filter(ds => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            (ds.name ?? '').toLowerCase().includes(q) ||
            (ds.database ?? '').toLowerCase().includes(q) ||
            (ds.schema ?? '').toLowerCase().includes(q) ||
            (ds.description ?? '').toLowerCase().includes(q) ||
            (ds.column_names ?? []).some(c => (c ?? '').toLowerCase().includes(q))
        );
    });

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
                <StorageIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
                    {t('plugin.superset.datasetsTitle')}
                </Typography>
                <Tooltip title={t('plugin.superset.refresh')}>
                    <IconButton size="small" onClick={doFetchDatasets} disabled={loading}>
                        <RefreshIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                </Tooltip>
            </Box>

            <Divider />

            <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                    size="small"
                    placeholder={t('plugin.superset.searchPlaceholder')}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    fullWidth
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
                    <Select
                        size="small"
                        value={rowLimit}
                        onChange={e => setRowLimit(Number(e.target.value))}
                        sx={{ fontSize: 12, minWidth: 90, '& .MuiSelect-select': { py: '6px' } }}
                    >
                        {ROW_LIMIT_OPTIONS.map(val => (
                            <MenuItem key={val} value={val} sx={{ fontSize: 12 }}>
                                {val.toLocaleString()}
                            </MenuItem>
                        ))}
                    </Select>
                </Tooltip>
            </Box>

            {error && <Alert severity="error" sx={{ mx: 1.5, fontSize: 12 }} onClose={() => setError(null)}>{error}</Alert>}
            {successMessage && <Alert severity="success" sx={{ mx: 1.5, fontSize: 12 }} onClose={() => setSuccessMessage(null)}>{successMessage}</Alert>}
            {loading && <LinearProgress sx={{ mx: 1.5 }} />}

            <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 0.5 }}>
                {!loading && filteredDatasets.length === 0 && (
                    <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mt: 3, fontSize: 13 }}>
                        {t('plugin.superset.noDatasets')}
                    </Typography>
                )}

                {filteredDatasets.map(ds => (
                    <Paper
                        key={ds.id}
                        variant="outlined"
                        sx={{
                            p: 1.5, mb: 1, cursor: 'default',
                            borderColor: alpha(theme.palette.divider, 0.15),
                            '&:hover': { borderColor: theme.palette.primary.main, backgroundColor: alpha(theme.palette.primary.main, 0.02) },
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <TableRowsIcon sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {ds.name}
                                    </Typography>
                                </Box>
                                {ds.description && (
                                    <Tooltip title={ds.description.length > 80 ? ds.description : ''} placement="top" arrow>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', mt: 0.25, lineHeight: 1.4 }}>
                                            {ds.description}
                                        </Typography>
                                    </Tooltip>
                                )}
                                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                                        {`${ds.database}.${ds.schema}`}
                                    </Typography>
                                    {ds.row_count != null && (
                                        <Chip size="small" variant="outlined" label={t('plugin.superset.rows', { count: ds.row_count })} sx={{ fontSize: 10, height: 18, color: 'text.secondary', borderColor: 'divider' }} />
                                    )}
                                </Box>
                                {ds.column_names.length > 0 && <Box sx={{ mt: 0.5 }}><ColumnChip columns={ds.column_names} /></Box>}
                            </Box>

                            <Box sx={{ display: 'flex', gap: 0.5, ml: 1, flexShrink: 0, alignSelf: 'center' }}>
                                <Tooltip title={t('plugin.superset.loadOverwrite')}>
                                    <span>
                                        <IconButton size="small" onClick={() => doLoadDataset(ds)} disabled={loadingDatasetId === ds.id}>
                                            {loadingDatasetId === ds.id ? <CircularProgress size={14} /> : <DownloadIcon sx={{ fontSize: 16 }} />}
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                <Tooltip title={t('plugin.superset.createNewDataset')}>
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={() => {
                                                setSuffixDialogDs(ds);
                                                const d = new Date();
                                                setSuffixInput(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);
                                                setSuffixDialogOpen(true);
                                            }}
                                            disabled={loadingDatasetId === ds.id}
                                        >
                                            <AddIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            </Box>
                        </Box>
                    </Paper>
                ))}
            </Box>

            <Dialog open={suffixDialogOpen} onClose={() => setSuffixDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
                <DialogTitle sx={{ fontSize: 14, fontWeight: 600, pb: 0.5, pt: 2, px: 2.5 }}>
                    {t('plugin.superset.suffixDialogTitle')}
                </DialogTitle>
                <DialogContent sx={{ px: 2.5, pt: 1 }}>
                    <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary', fontSize: 12, lineHeight: 1.6 }}>
                        {t('plugin.superset.suffixDialogDesc', { name: suffixDialogDs?.name ?? '' })}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                        <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap', px: 1.5, py: 0.75, bgcolor: 'action.hover', borderRight: '1px solid', borderColor: 'divider' }}>
                            {suffixDialogDs?.name ?? ''}_
                        </Typography>
                        <TextField
                            autoFocus size="small" fullWidth variant="standard"
                            placeholder={t('plugin.superset.suffixPlaceholder')}
                            value={suffixInput}
                            onChange={e => setSuffixInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && suffixInput.trim()) {
                                    doLoadDataset(suffixDialogDs!, `${suffixDialogDs!.name}_${suffixInput.trim()}`);
                                    setSuffixDialogOpen(false);
                                }
                            }}
                            slotProps={{ input: { disableUnderline: true, sx: { fontSize: 13, px: 1, py: 0.75 } } }}
                        />
                    </Box>
                </DialogContent>
                <DialogActions sx={{ px: 2.5, pb: 2, pt: 0.5 }}>
                    <Button onClick={() => setSuffixDialogOpen(false)} size="small" sx={{ textTransform: 'none', fontSize: 12 }}>
                        {t('app.cancel')}
                    </Button>
                    <Button
                        variant="contained" size="small" disableElevation
                        disabled={!suffixInput.trim()}
                        onClick={() => { doLoadDataset(suffixDialogDs!, `${suffixDialogDs!.name}_${suffixInput.trim()}`); setSuffixDialogOpen(false); }}
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {t('plugin.superset.confirmLoad')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
