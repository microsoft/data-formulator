// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect, useCallback } from 'react';
import {
    Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
    Typography, TextField, Select, MenuItem, Chip, CircularProgress,
    Autocomplete, InputAdornment,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import { useTranslation } from 'react-i18next';

import {
    fetchDashboardFilters, fetchFilterOptions,
    DashboardFilter, FilterOption, SupersetDataset,
} from './api';

interface FilterFormValue {
    operator: string;
    value: unknown;
}

interface SupersetFilterDialogProps {
    open: boolean;
    dashboardId: number;
    dashboardTitle: string;
    dataset: SupersetDataset;
    onClose: () => void;
    onSubmit: (
        filters: Array<{ column: string; operator: string; value: unknown }>,
        tableNameOverride?: string,
    ) => void;
}

const OPERATORS = [
    { value: 'EQ', label: '=' },
    { value: 'NEQ', label: '≠' },
    { value: 'IN', label: 'IN' },
    { value: 'NOT_IN', label: 'NOT IN' },
    { value: 'GT', label: '>' },
    { value: 'GTE', label: '≥' },
    { value: 'LT', label: '<' },
    { value: 'LTE', label: '≤' },
    { value: 'LIKE', label: 'LIKE' },
    { value: 'ILIKE', label: 'ILIKE' },
];

export const SupersetFilterDialog: FC<SupersetFilterDialogProps> = ({
    open, dashboardId, dashboardTitle, dataset, onClose, onSubmit,
}) => {
    const { t } = useTranslation();
    const [filters, setFilters] = useState<DashboardFilter[]>([]);
    const [loading, setLoading] = useState(false);
    const [formValues, setFormValues] = useState<Record<string, FilterFormValue>>({});
    const [optionsCache, setOptionsCache] = useState<Record<string, FilterOption[]>>({});
    const [tableNameSuffix, setTableNameSuffix] = useState('');

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        fetchDashboardFilters(dashboardId, dataset.id)
            .then(fs => {
                setFilters(fs);
                const defaults: Record<string, FilterFormValue> = {};
                for (const f of fs) {
                    if (f.default_value != null) {
                        const dv = f.default_value;
                        if (f.multi) {
                            defaults[f.id] = {
                                operator: 'IN',
                                value: Array.isArray(dv) ? dv : [dv],
                            };
                        } else {
                            defaults[f.id] = {
                                operator: 'EQ',
                                value: Array.isArray(dv) ? (dv[0] ?? '') : dv,
                            };
                        }
                    } else {
                        defaults[f.id] = { operator: f.multi ? 'IN' : 'EQ', value: f.multi ? [] : '' };
                    }
                }
                setFormValues(defaults);
            })
            .catch(() => setFilters([]))
            .finally(() => setLoading(false));
    }, [open, dashboardId, dataset.id]);

    const loadOptions = useCallback(async (filterId: string, datasetId: number, columnName: string, keyword = '') => {
        const cacheKey = `${datasetId}_${columnName}_${keyword}`;
        if (optionsCache[cacheKey]) return;
        try {
            const { options } = await fetchFilterOptions(datasetId, columnName, keyword);
            setOptionsCache(prev => ({ ...prev, [cacheKey]: options }));
        } catch {
            // silently ignore
        }
    }, [optionsCache]);

    const handleSubmit = () => {
        const result: Array<{ column: string; operator: string; value: unknown }> = [];
        for (const f of filters) {
            const fv = formValues[f.id];
            if (!fv) continue;
            const val = fv.value;
            if (val === '' || val === null || val === undefined) continue;
            if (Array.isArray(val) && val.length === 0) continue;
            result.push({ column: f.column_name, operator: fv.operator, value: val });
        }
        const tableName = tableNameSuffix.trim()
            ? `${dataset.name}_${tableNameSuffix.trim()}`
            : undefined;
        onSubmit(result, tableName);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
            <DialogTitle sx={{ fontSize: 14, fontWeight: 600, pb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <FilterListIcon sx={{ fontSize: 18 }} />
                {t('plugin.superset.filterDialogTitle', { dashboard: dashboardTitle, dataset: dataset.name })}
            </DialogTitle>
            <DialogContent sx={{ px: 2.5 }}>
                {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>}

                {!loading && filters.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        {t('plugin.superset.noFiltersAvailable')}
                    </Typography>
                )}

                {filters.map(f => {
                    const fv = formValues[f.id] || { operator: 'EQ', value: '' };
                    const cacheKey = `${f.dataset_id}_${f.column_name}_`;
                    const opts = optionsCache[cacheKey] || [];

                    return (
                        <Box key={f.id} sx={{ mb: 2 }}>
                            <Typography variant="caption" sx={{ fontWeight: 500, display: 'block', mb: 0.5 }}>
                                {f.name} ({f.column_name})
                                {f.default_value != null && (
                                    <Chip label={t('plugin.superset.defaultValue')} size="small"
                                        sx={{ ml: 0.5, height: 16, fontSize: 10, verticalAlign: 'middle' }}
                                    />
                                )}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                                <Select
                                    size="small"
                                    value={fv.operator}
                                    onChange={e => setFormValues(prev => ({ ...prev, [f.id]: { ...fv, operator: e.target.value } }))}
                                    sx={{ fontSize: 12, minWidth: 80 }}
                                >
                                    {OPERATORS.map(op => (
                                        <MenuItem key={op.value} value={op.value} sx={{ fontSize: 12 }}>{op.label}</MenuItem>
                                    ))}
                                </Select>

                                {f.supports_search ? (
                                    <Autocomplete
                                        size="small"
                                        multiple={f.multi}
                                        freeSolo
                                        options={opts.map(o => String(o.value))}
                                        value={f.multi ? (fv.value as string[]) : (fv.value as string)}
                                        onOpen={() => loadOptions(f.id, f.dataset_id, f.column_name)}
                                        onInputChange={(_, val) => {
                                            if (val.length >= 2) loadOptions(f.id, f.dataset_id, f.column_name, val);
                                        }}
                                        onChange={(_, newVal) => setFormValues(prev => ({ ...prev, [f.id]: { ...fv, value: newVal } }))}
                                        renderInput={params => <TextField {...params} placeholder={t('plugin.superset.filterValuePlaceholder')} sx={{ '& .MuiOutlinedInput-root': { fontSize: 12 } }} />}
                                        sx={{ flex: 1 }}
                                    />
                                ) : (
                                    <TextField
                                        size="small"
                                        fullWidth
                                        placeholder={t('plugin.superset.filterValuePlaceholder')}
                                        value={fv.value as string}
                                        onChange={e => setFormValues(prev => ({ ...prev, [f.id]: { ...fv, value: e.target.value } }))}
                                        sx={{ flex: 1, '& .MuiOutlinedInput-root': { fontSize: 12 } }}
                                    />
                                )}
                            </Box>
                        </Box>
                    );
                })}

                {filters.length > 0 && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" sx={{ fontWeight: 500, display: 'block', mb: 0.5 }}>
                            {t('plugin.superset.tableNameSuffix')}
                        </Typography>
                        <TextField
                            size="small"
                            fullWidth
                            placeholder={t('plugin.superset.suffixPlaceholder')}
                            value={tableNameSuffix}
                            onChange={e => setTableNameSuffix(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 12 }}>
                                            {dataset.name}_
                                        </Typography>
                                    </InputAdornment>
                                ),
                            }}
                            sx={{ '& .MuiOutlinedInput-root': { fontSize: 12 } }}
                        />
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 2.5, pb: 2 }}>
                <Button onClick={onClose} size="small" sx={{ textTransform: 'none', fontSize: 12 }}>
                    {t('app.cancel')}
                </Button>
                <Button
                    variant="contained" size="small" disableElevation
                    onClick={handleSubmit}
                    sx={{ textTransform: 'none', fontSize: 12 }}
                >
                    {t('plugin.superset.loadWithFilters')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
