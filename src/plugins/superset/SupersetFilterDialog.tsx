// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Chip, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogTitle, Divider,
    FormControl, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import { useTranslation } from 'react-i18next';

import {
    fetchDashboardFilters, fetchFilterOptions,
    DashboardFilter, FilterOption, SupersetDataset,
} from './api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FilterPayload {
    column: string;
    operator: string;
    value?: unknown;
}

interface FilterFormValue {
    operator: string;
    value: string | number | boolean | Array<string | number | boolean>;
    valueTo?: string;
}

interface SupersetFilterDialogProps {
    open: boolean;
    dashboardId: number;
    dashboardTitle: string;
    dataset: SupersetDataset;
    onClose: () => void;
    onSubmit: (filters: FilterPayload[], tableNameOverride?: string) => Promise<void> | void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const defaultOperatorForFilter = (f: DashboardFilter): string => {
    if (f.input_type === 'time') return 'BETWEEN';
    if (f.input_type === 'numeric') return 'EQ';
    if (f.input_type === 'select') return f.multi ? 'IN' : 'EQ';
    return 'ILIKE';
};

const isEmptyValue = (fv: FilterFormValue | undefined, inputType: string): boolean => {
    if (!fv) return true;
    if (fv.operator === 'IS_NULL' || fv.operator === 'IS_NOT_NULL') return false;
    if (inputType === 'select') {
        return Array.isArray(fv.value) ? fv.value.length === 0 : fv.value === '' || fv.value == null;
    }
    if (fv.operator === 'BETWEEN') {
        return fv.value === '' || fv.value == null || fv.valueTo === '' || fv.valueTo == null;
    }
    return fv.value === '' || fv.value == null;
};

const normalizeNumericValue = (v: string): string | number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const SupersetFilterDialog: FC<SupersetFilterDialogProps> = ({
    open, dashboardId, dashboardTitle, dataset, onClose, onSubmit,
}) => {
    const { t } = useTranslation();

    const [loading, setLoading] = useState(false);
    const [submitLoading, setSubmitLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filters, setFilters] = useState<DashboardFilter[]>([]);
    const [formValues, setFormValues] = useState<Record<string, FilterFormValue>>({});
    const [suffixInput, setSuffixInput] = useState('');
    const [suffixManuallyEdited, setSuffixManuallyEdited] = useState(false);

    const [optionsMap, setOptionsMap] = useState<Record<string, FilterOption[]>>({});
    const [optionsMoreMap, setOptionsMoreMap] = useState<Record<string, boolean>>({});
    const [optionSearchMap, setOptionSearchMap] = useState<Record<string, string>>({});
    const [optionsLoadingKey, setOptionsLoadingKey] = useState<string | null>(null);
    const searchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    /* ---- auto-generated suffix from filter values ---- */

    const buildAutoSuffix = useCallback(() => {
        const parts: string[] = [];
        for (const f of filters) {
            const fv = formValues[f.id];
            if (isEmptyValue(fv, f.input_type)) continue;
            let valStr: string;
            if (fv.operator === 'IS_NULL') valStr = 'null';
            else if (fv.operator === 'IS_NOT_NULL') valStr = 'notnull';
            else if (Array.isArray(fv.value)) valStr = fv.value.slice(0, 3).map(String).join('_');
            else valStr = String(fv.value);
            valStr = valStr.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').replace(/_+/g, '_').slice(0, 20);
            parts.push(valStr);
        }
        if (parts.length === 0) {
            const d = new Date();
            return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        }
        return parts.join('_');
    }, [filters, formValues]);

    useEffect(() => {
        if (!suffixManuallyEdited) setSuffixInput(buildAutoSuffix());
    }, [buildAutoSuffix, suffixManuallyEdited]);

    /* ---- fetch filter definitions ---- */

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        setError(null);
        setFilters([]);
        setFormValues({});
        setOptionsMap({});
        setOptionsMoreMap({});
        setOptionSearchMap({});
        setSuffixInput('');
        setSuffixManuallyEdited(false);

        fetchDashboardFilters(dashboardId, dataset.id)
            .then(fs => {
                setFilters(fs);
                const defaults: Record<string, FilterFormValue> = {};
                for (const f of fs) {
                    const op = defaultOperatorForFilter(f);
                    if (f.default_value != null) {
                        const dv = f.default_value;
                        if (f.multi) {
                            defaults[f.id] = { operator: op, value: Array.isArray(dv) ? dv as any : [dv] as any, valueTo: '' };
                        } else {
                            defaults[f.id] = { operator: op, value: Array.isArray(dv) ? (dv[0] ?? '') : dv as any, valueTo: '' };
                        }
                    } else {
                        defaults[f.id] = { operator: op, value: f.multi ? [] : '', valueTo: '' };
                    }
                }
                setFormValues(defaults);
            })
            .catch(() => setFilters([]))
            .finally(() => setLoading(false));

        return () => {
            Object.values(searchTimersRef.current).forEach(clearTimeout);
            searchTimersRef.current = {};
        };
    }, [open, dashboardId, dataset.id]);

    /* ---- options loading (with debounce) ---- */

    const loadOptions = async (filter: DashboardFilter, keyword = '') => {
        if (filter.input_type !== 'select') return;
        setOptionsLoadingKey(filter.id);
        try {
            const { options, has_more } = await fetchFilterOptions(filter.dataset_id, filter.column_name, keyword);
            setOptionsMap(prev => ({ ...prev, [filter.id]: options }));
            setOptionsMoreMap(prev => ({ ...prev, [filter.id]: has_more }));
        } catch (err: any) {
            setError(err.message || t('plugin.superset.loadOptionsFailed'));
        } finally {
            setOptionsLoadingKey(cur => (cur === filter.id ? null : cur));
        }
    };

    const queueOptionsLoad = (filter: DashboardFilter, keyword = '') => {
        if (searchTimersRef.current[filter.id]) clearTimeout(searchTimersRef.current[filter.id]);
        searchTimersRef.current[filter.id] = setTimeout(() => loadOptions(filter, keyword), keyword ? 300 : 0);
    };

    /* ---- form helpers ---- */

    const handleValueChange = (filterId: string, patch: Partial<FilterFormValue>) => {
        setFormValues(prev => ({ ...prev, [filterId]: { ...prev[filterId], ...patch } }));
    };

    const getSelectedOptions = (filter: DashboardFilter) => {
        const selected = formValues[filter.id]?.value;
        const opts = optionsMap[filter.id] || [];
        const asOption = (raw: string | number | boolean) => {
            const found = opts.find(o => String(o.value) === String(raw));
            return found || { label: String(raw), value: raw };
        };
        if (filter.multi) return Array.isArray(selected) ? selected.map(asOption) : [];
        if (selected === '' || selected == null || Array.isArray(selected)) return null;
        return asOption(selected);
    };

    /* ---- build payload ---- */

    const buildPayload = useMemo(() => (): FilterPayload[] => {
        return filters.flatMap(f => {
            const fv = formValues[f.id];
            if (isEmptyValue(fv, f.input_type)) return [];
            if (fv.operator === 'IS_NULL' || fv.operator === 'IS_NOT_NULL') {
                return [{ column: f.column_name, operator: fv.operator }];
            }
            if (f.input_type === 'numeric') {
                if (fv.operator === 'BETWEEN') {
                    return [{ column: f.column_name, operator: fv.operator, value: [normalizeNumericValue(String(fv.value)), normalizeNumericValue(String(fv.valueTo ?? ''))] }];
                }
                return [{ column: f.column_name, operator: fv.operator, value: normalizeNumericValue(String(fv.value)) }];
            }
            if (f.input_type === 'time' && fv.operator === 'BETWEEN') {
                return [{ column: f.column_name, operator: fv.operator, value: [String(fv.value), String(fv.valueTo ?? '')] }];
            }
            return [{ column: f.column_name, operator: fv.operator, value: fv.value }];
        });
    }, [filters, formValues]);

    /* ---- submit ---- */

    const handleSubmit = async () => {
        try {
            setSubmitLoading(true);
            setError(null);
            const fullName = suffixInput.trim() ? `${dataset.name}_${suffixInput.trim()}` : undefined;
            await onSubmit(buildPayload(), fullName);
            onClose();
        } catch (err: any) {
            setError(err.message || t('plugin.superset.loadFailed', { message: 'Unknown error' }));
        } finally {
            setSubmitLoading(false);
        }
    };

    /* ---- operator control (per input_type) ---- */

    const renderOperatorControl = (filter: DashboardFilter) => {
        const fv = formValues[filter.id];
        let options: Array<{ value: string; label: string }>;
        if (filter.input_type === 'select') {
            options = filter.multi
                ? [{ value: 'IN', label: t('plugin.superset.op.in') }, { value: 'NOT_IN', label: t('plugin.superset.op.notIn') }]
                : [{ value: 'EQ', label: t('plugin.superset.op.eq') }, { value: 'NEQ', label: t('plugin.superset.op.neq') }];
        } else if (filter.input_type === 'numeric') {
            options = [
                { value: 'EQ', label: t('plugin.superset.op.eq') },
                { value: 'GT', label: t('plugin.superset.op.gt') },
                { value: 'GTE', label: t('plugin.superset.op.gte') },
                { value: 'LT', label: t('plugin.superset.op.lt') },
                { value: 'LTE', label: t('plugin.superset.op.lte') },
                { value: 'BETWEEN', label: t('plugin.superset.op.between') },
                { value: 'IS_NULL', label: t('plugin.superset.op.isNull') },
                { value: 'IS_NOT_NULL', label: t('plugin.superset.op.isNotNull') },
            ];
        } else if (filter.input_type === 'time') {
            options = [
                { value: 'BETWEEN', label: t('plugin.superset.op.timeRange') },
                { value: 'EQ', label: t('plugin.superset.op.eq') },
                { value: 'GT', label: t('plugin.superset.op.gt') },
                { value: 'GTE', label: t('plugin.superset.op.gte') },
                { value: 'LT', label: t('plugin.superset.op.lt') },
                { value: 'LTE', label: t('plugin.superset.op.lte') },
                { value: 'IS_NULL', label: t('plugin.superset.op.isNull') },
                { value: 'IS_NOT_NULL', label: t('plugin.superset.op.isNotNull') },
            ];
        } else {
            options = [
                { value: 'ILIKE', label: t('plugin.superset.op.contains') },
                { value: 'EQ', label: t('plugin.superset.op.eq') },
                { value: 'NEQ', label: t('plugin.superset.op.neq') },
                { value: 'IS_NULL', label: t('plugin.superset.op.isNull') },
                { value: 'IS_NOT_NULL', label: t('plugin.superset.op.isNotNull') },
            ];
        }
        return (
            <FormControl size="small" sx={{ minWidth: 100 }}>
                <Select
                    value={fv?.operator || defaultOperatorForFilter(filter)}
                    onChange={e => handleValueChange(filter.id, { operator: e.target.value })}
                    sx={{ fontSize: 12, '& .MuiSelect-select': { py: 0.625 } }}
                >
                    {options.map(o => <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12 }}>{o.label}</MenuItem>)}
                </Select>
            </FormControl>
        );
    };

    /* ---- value control (per input_type) ---- */

    const renderValueControl = (filter: DashboardFilter) => {
        const fv = formValues[filter.id];
        const operator = fv?.operator || defaultOperatorForFilter(filter);

        if (operator === 'IS_NULL' || operator === 'IS_NOT_NULL') {
            return (
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
                    {t('plugin.superset.noValueNeeded')}
                </Typography>
            );
        }

        const inputSx = { '& .MuiOutlinedInput-root': { fontSize: 12, '& input': { py: 0.75 } } };

        // Select type
        if (filter.input_type === 'select') {
            return (
                <Box sx={{ flex: 1 }}>
                    <Autocomplete
                        multiple={filter.multi}
                        size="small"
                        options={optionsMap[filter.id] || []}
                        value={getSelectedOptions(filter) as any}
                        loading={optionsLoadingKey === filter.id}
                        filterOptions={o => o}
                        isOptionEqualToValue={(a, b) => String(a.value) === String(b.value)}
                        getOptionLabel={o => o.label}
                        onOpen={() => { if (!optionsMap[filter.id]) queueOptionsLoad(filter, ''); }}
                        onChange={(_, val) => {
                            handleValueChange(filter.id, {
                                value: filter.multi
                                    ? (val as FilterOption[]).map(i => i.value).filter(i => i != null) as any
                                    : ((val as FilterOption | null)?.value ?? '') as any,
                            });
                            setOptionSearchMap(prev => ({ ...prev, [filter.id]: '' }));
                        }}
                        inputValue={optionSearchMap[filter.id] || ''}
                        onInputChange={(_, val, reason) => {
                            if (reason === 'input') {
                                setOptionSearchMap(prev => ({ ...prev, [filter.id]: val }));
                                queueOptionsLoad(filter, val);
                            }
                        }}
                        slotProps={{
                            listbox: { sx: { fontSize: 12 } },
                            chip: { size: 'small', sx: { fontSize: 11, height: 20 } },
                        }}
                        renderInput={params => (
                            <TextField {...params} size="small"
                                placeholder={filter.supports_search ? t('plugin.superset.searchableSelect') : t('plugin.superset.selectValue')}
                                sx={{ '& .MuiOutlinedInput-root': { fontSize: 12 } }}
                            />
                        )}
                    />
                    {optionsMoreMap[filter.id] && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.25, display: 'block', fontSize: 10 }}>
                            {t('plugin.superset.resultsTruncated')}
                        </Typography>
                    )}
                </Box>
            );
        }

        // Time type
        if (filter.input_type === 'time') {
            return (
                <Stack direction="row" spacing={0.75} sx={{ flex: 1 }}>
                    <TextField size="small" type="date" value={String(fv?.value || '')}
                        onChange={e => handleValueChange(filter.id, { value: e.target.value })}
                        InputLabelProps={{ shrink: true }} sx={{ flex: 1, ...inputSx }}
                    />
                    {operator === 'BETWEEN' && (
                        <TextField size="small" type="date" value={fv?.valueTo || ''}
                            onChange={e => handleValueChange(filter.id, { valueTo: e.target.value })}
                            InputLabelProps={{ shrink: true }} sx={{ flex: 1, ...inputSx }}
                        />
                    )}
                </Stack>
            );
        }

        // Numeric type
        if (filter.input_type === 'numeric') {
            return (
                <Stack direction="row" spacing={0.75} sx={{ flex: 1 }}>
                    <TextField size="small" type="number" value={String(fv?.value || '')}
                        onChange={e => handleValueChange(filter.id, { value: e.target.value })}
                        placeholder={t('plugin.superset.valuePlaceholder')} sx={{ flex: 1, ...inputSx }}
                    />
                    {operator === 'BETWEEN' && (
                        <TextField size="small" type="number" value={fv?.valueTo || ''}
                            onChange={e => handleValueChange(filter.id, { valueTo: e.target.value })}
                            placeholder={t('plugin.superset.valueToPlaceholder')} sx={{ flex: 1, ...inputSx }}
                        />
                    )}
                </Stack>
            );
        }

        // Text type (default)
        return (
            <TextField size="small" value={String(fv?.value || '')}
                onChange={e => handleValueChange(filter.id, { value: e.target.value })}
                placeholder={t('plugin.superset.filterValuePlaceholder')}
                sx={{ flex: 1, ...inputSx }}
            />
        );
    };

    /* ---- render ---- */

    return (
        <Dialog open={open} onClose={submitLoading ? undefined : onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 2 } }}>
            <DialogTitle sx={{ fontSize: 14, fontWeight: 600, pb: 0.5, pt: 2, px: 2.5, display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
                <FilterAltIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.25 }} />
                <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>
                        {t('plugin.superset.filterDialogHeading')}
                    </Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.3 }}>
                        {dashboardTitle} / {dataset.name}
                    </Typography>
                </Box>
            </DialogTitle>

            <DialogContent sx={{ px: 2.5, pt: 1 }}>
                <Stack spacing={1.5}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 11, lineHeight: 1.5 }}>
                        {t('plugin.superset.filterDialogHint')}
                    </Typography>

                    {error && <Alert severity="error" sx={{ fontSize: 12, py: 0.25 }} onClose={() => setError(null)}>{error}</Alert>}

                    {/* table name input */}
                    <Box>
                        <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary', fontWeight: 500 }}>
                            {t('plugin.superset.tableNameLabel')}
                        </Typography>
                        <Box sx={{
                            display: 'flex', alignItems: 'center',
                            border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden',
                        }}>
                            <Typography variant="body2" sx={{
                                fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap',
                                px: 1.5, py: 0.75, bgcolor: 'action.hover', borderRight: '1px solid', borderColor: 'divider',
                            }}>
                                {dataset.name}_
                            </Typography>
                            <TextField
                                autoFocus size="small" fullWidth variant="standard"
                                placeholder={t('plugin.superset.suffixAutoGenerated')}
                                value={suffixInput}
                                onChange={e => { setSuffixInput(e.target.value); setSuffixManuallyEdited(true); }}
                                slotProps={{ input: { disableUnderline: true, sx: { fontSize: 13, px: 1, py: 0.75 } } }}
                            />
                        </Box>
                        {suffixInput.trim() && (
                            <Chip size="small" variant="outlined" color="primary"
                                label={`${dataset.name}_${suffixInput.trim()}`}
                                sx={{ mt: 0.75, fontSize: 11, height: 22 }}
                            />
                        )}
                    </Box>

                    <Divider />

                    {/* loading / empty / filter list */}
                    {loading ? (
                        <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}><CircularProgress size={20} /></Box>
                    ) : filters.length === 0 ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12, textAlign: 'center', py: 2 }}>
                            {t('plugin.superset.noFiltersAvailable')}
                        </Typography>
                    ) : (
                        <Stack spacing={1}>
                            {filters.map(f => (
                                <Box key={`${f.id}-${f.column_name}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75, flexWrap: 'wrap' }}>
                                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>
                                            {f.name}
                                        </Typography>
                                        <Chip size="small" variant="outlined" label={f.column_name}
                                            sx={{ fontSize: 10, height: 18, color: 'text.secondary', borderColor: 'divider' }} />
                                        <Chip size="small" variant="outlined" label={f.column_type}
                                            sx={{ fontSize: 10, height: 18, color: 'text.secondary', borderColor: 'divider' }} />
                                        {f.multi && <Chip size="small" color="primary" variant="outlined" label={t('plugin.superset.multiSelect')} sx={{ fontSize: 10, height: 18 }} />}
                                        {f.default_value != null && (
                                            <Chip size="small" label={t('plugin.superset.defaultValue')} sx={{ height: 18, fontSize: 10 }} />
                                        )}
                                    </Box>
                                    <Stack direction="row" spacing={0.75} alignItems="center">
                                        {renderOperatorControl(f)}
                                        {renderValueControl(f)}
                                    </Stack>
                                </Box>
                            ))}
                        </Stack>
                    )}
                </Stack>
            </DialogContent>

            <DialogActions sx={{ px: 2.5, pb: 2, pt: 0.5 }}>
                <Button onClick={onClose} disabled={submitLoading} size="small" sx={{ textTransform: 'none', fontSize: 12 }}>
                    {t('app.cancel')}
                </Button>
                <Button
                    variant="contained" size="small" disableElevation
                    onClick={handleSubmit}
                    disabled={loading || submitLoading || !dataset}
                    startIcon={submitLoading ? <CircularProgress size={12} /> : undefined}
                    sx={{ textTransform: 'none', fontSize: 12 }}
                >
                    {t('plugin.superset.loadWithFilters')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
