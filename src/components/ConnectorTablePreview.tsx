// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ConnectorTablePreview — unified preview panel for connector tables.
 *
 * Used in both:
 *  - DataSourceSidebar (Popover preview when clicking a dataset)
 *  - DBTableManager / DataLoaderForm (right-hand preview panel)
 *
 * Provides: header with name/row-count, RowLimitUnderlineSelect, smart filters,
 * sort controls, DataFrameTable, and Load / Already-Loaded footer.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Autocomplete,
    Box,
    Button,
    CircularProgress,
    Collapse,
    IconButton,
    MenuItem,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckIcon from '@mui/icons-material/Check';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';

import { DataFrameTable } from '../views/DataFrameTable';
import { RowLimitUnderlineSelect } from './RowLimitUnderlineSelect';
import { fetchWithIdentity, CONNECTOR_ACTION_URLS, SourceTableRef } from '../app/utils';
import { apiRequest } from '../app/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ColumnMeta {
    name: string;
    type: string;
    source_type?: string;
    description?: string;
    source_description?: string;
    user_description?: string;
    display_description?: string;
    verbose_name?: string;
    expression?: string;
}

export interface PreviewFilter {
    column: string;
    operator: string;
    value: string;
    valueTo?: string;
}

/** Coerced filter ready for the backend API. */
export interface SourceFilter {
    column: string;
    operator: string;
    value?: any;
}

export interface ConnectorTablePreviewProps {
    connectorId: string;
    sourceTable: SourceTableRef;
    displayName: string;
    pathBreadcrumb?: string;
    /** Effective table-level description shown to users. */
    tableDescription?: string;
    /** Original source-system table description, before user annotation override. */
    sourceDescription?: string;
    /** User annotation description, if present. */
    userDescription?: string;
    /** Source metadata sync status (synced, partial, unavailable, not_synced). */
    metadataStatus?: string;

    columns: ColumnMeta[];
    sampleRows: Record<string, any>[];
    rowCount: number | null;
    loading: boolean;

    /** Row-limit presets for the RowLimitUnderlineSelect. */
    rowLimitPresets: number[];
    defaultRowLimit?: number;

    alreadyLoaded: boolean;

    enableFilters?: boolean;
    enableSort?: boolean;

    onLoad: (importOptions: Record<string, any>) => void;
    onUnload?: () => void;
    /** Called when the user clicks "Preview" to refresh with filters. */
    onRefreshPreview?: (rows: Record<string, any>[], columns: ColumnMeta[], rowCount: number | null) => void;
}

// ─── Filter helpers (pure functions) ─────────────────────────────────────────

export function inferInputType(pandasType: string, sourceType?: string): 'time' | 'numeric' | 'boolean' | 'select' | 'text' {
    const src = (sourceType || '').toUpperCase();
    const pd = (pandasType || '').toUpperCase();
    if (src) {
        if (src === 'TEMPORAL' || /DATE|TIME|TIMESTAMP|DATETIME/.test(src)) return 'time';
        if (src === 'NUMERIC' || /INT|FLOAT|DOUBLE|DECIMAL|BIGINT|NUMBER/.test(src)) return 'numeric';
        if (src === 'BOOLEAN' || /BOOL/.test(src)) return 'boolean';
    }
    if (/DATETIME/.test(pd)) return 'time';
    if (/INT|FLOAT/.test(pd)) return 'numeric';
    if (/BOOL/.test(pd)) return 'boolean';
    return 'select';
}

export function defaultOperatorForType(inputType: string): string {
    if (inputType === 'time') return 'BETWEEN';
    if (inputType === 'boolean') return 'EQ';
    if (inputType === 'select') return 'EQ';
    if (inputType === 'numeric') return 'EQ';
    return 'ILIKE';
}

/** Build a backend-ready filter array from the user's raw filter state. */
export function coerceFilters(filters: PreviewFilter[], columns: ColumnMeta[]): SourceFilter[] {
    return filters
        .filter(f => f.column && f.operator && (
            f.operator === 'IS_NULL' || f.operator === 'IS_NOT_NULL' ||
            (f.operator === 'BETWEEN' ? (f.value || '').trim() && (f.valueTo || '').trim() : (f.value || '').trim())
        ))
        .map(f => {
            const colMeta = columns.find(c => c.name === f.column);
            const iType = colMeta ? inferInputType(colMeta.type, colMeta.source_type) : 'text';
            if (f.operator === 'BETWEEN') {
                const v1 = iType === 'numeric' ? Number(f.value) : f.value;
                const v2 = iType === 'numeric' ? Number(f.valueTo) : f.valueTo;
                return { column: f.column, operator: f.operator, value: [v1, v2] };
            }
            if (f.operator === 'IS_NULL' || f.operator === 'IS_NOT_NULL') {
                return { column: f.column, operator: f.operator };
            }
            let val: any = f.value;
            if (iType === 'numeric' && f.value) val = Number(f.value);
            else if (iType === 'boolean') val = f.value === 'true';
            return { column: f.column, operator: f.operator, value: val };
        });
}

// ─── Component ───────────────────────────────────────────────────────────────

export const ConnectorTablePreview: React.FC<ConnectorTablePreviewProps> = ({
    connectorId,
    sourceTable,
    displayName,
    pathBreadcrumb,
    tableDescription,
    sourceDescription,
    userDescription,
    metadataStatus,
    columns,
    sampleRows,
    rowCount,
    loading,
    rowLimitPresets,
    defaultRowLimit = 50_000,
    alreadyLoaded,
    enableFilters = true,
    enableSort = true,
    onLoad,
    onUnload,
    onRefreshPreview,
}) => {
    const { t } = useTranslation();

    // Row limit
    const [rowLimit, setRowLimit] = useState<number>(defaultRowLimit);

    // Filters
    const [filters, setFilters] = useState<PreviewFilter[]>([]);
    const [filterOptionsMap, setFilterOptionsMap] = useState<Record<string, { label: string; value: any }[]>>({});
    const [filterOptionsLoading, setFilterOptionsLoading] = useState<string | null>(null);
    const [filterOptionsMore, setFilterOptionsMore] = useState<Record<string, boolean>>({});

    // Sort
    const [sortColumn, setSortColumn] = useState('');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    // Preview refresh loading (separate from parent loading)
    const [refreshing, setRefreshing] = useState(false);
    const [metadataExpanded, setMetadataExpanded] = useState(false);

    const isLoading = loading || refreshing;
    const effectiveDesc = (tableDescription || sourceDescription || '').trim();
    const statusLabel = metadataStatus
        ? t(`connectorPreview.metadataStatus.${metadataStatus}`, { defaultValue: metadataStatus })
        : '';
    const hasMetadataRow = Boolean(effectiveDesc || metadataStatus || columns.length > 0);

    // ── Operator definitions ─────────────────────────────────────────────

    const getOperatorsForType = useCallback((inputType: string) => {
        switch (inputType) {
            case 'boolean':
                return [
                    { value: 'EQ', label: '=' },
                    { value: 'IS_NULL', label: 'IS NULL' },
                    { value: 'IS_NOT_NULL', label: 'IS NOT NULL' },
                ];
            case 'select':
                return [
                    { value: 'EQ', label: '=' },
                    { value: 'NEQ', label: '!=' },
                    { value: 'IS_NULL', label: 'IS NULL' },
                    { value: 'IS_NOT_NULL', label: 'IS NOT NULL' },
                ];
            case 'numeric':
                return [
                    { value: 'EQ', label: '=' },
                    { value: 'GT', label: '>' },
                    { value: 'GTE', label: '>=' },
                    { value: 'LT', label: '<' },
                    { value: 'LTE', label: '<=' },
                    { value: 'BETWEEN', label: t('connectorPreview.opBetween', { defaultValue: 'BETWEEN' }) },
                    { value: 'IS_NULL', label: 'IS NULL' },
                    { value: 'IS_NOT_NULL', label: 'IS NOT NULL' },
                ];
            case 'time':
                return [
                    { value: 'BETWEEN', label: t('connectorPreview.opBetween', { defaultValue: 'BETWEEN' }) },
                    { value: 'EQ', label: '=' },
                    { value: 'GT', label: '>' },
                    { value: 'GTE', label: '>=' },
                    { value: 'LT', label: '<' },
                    { value: 'LTE', label: '<=' },
                    { value: 'IS_NULL', label: 'IS NULL' },
                    { value: 'IS_NOT_NULL', label: 'IS NOT NULL' },
                ];
            default:
                return [
                    { value: 'ILIKE', label: t('connectorPreview.opContains', { defaultValue: 'CONTAINS' }) },
                    { value: 'EQ', label: '=' },
                    { value: 'NEQ', label: '!=' },
                    { value: 'IS_NULL', label: 'IS NULL' },
                    { value: 'IS_NOT_NULL', label: 'IS NOT NULL' },
                ];
        }
    }, [t]);

    // ── Autocomplete values ──────────────────────────────────────────────

    const loadFilterOptions = useCallback(async (columnName: string, keyword = '') => {
        const cacheKey = `${connectorId}:${sourceTable.id}:${columnName}`;
        setFilterOptionsLoading(cacheKey);
        try {
            const { data } = await apiRequest<any>(CONNECTOR_ACTION_URLS.COLUMN_VALUES, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connector_id: connectorId,
                    source_table: sourceTable,
                    column_name: columnName,
                    keyword: keyword.trim(),
                    limit: 50,
                }),
            });
            setFilterOptionsMap(prev => ({ ...prev, [cacheKey]: data.options || [] }));
            setFilterOptionsMore(prev => ({ ...prev, [cacheKey]: !!data.has_more }));
        } catch { /* best-effort */ } finally {
            setFilterOptionsLoading(cur => cur === cacheKey ? null : cur);
        }
    }, [connectorId, sourceTable]);

    // ── Refresh preview with filters ─────────────────────────────────────

    const handleRefreshPreview = useCallback(() => {
        const validFilters = coerceFilters(filters, columns);
        const opts: Record<string, any> = { size: 10 };
        if (validFilters.length > 0) opts.source_filters = validFilters;
        if (sortColumn) {
            opts.sort_columns = [sortColumn];
            opts.sort_order = sortOrder;
        }
        setRefreshing(true);
        apiRequest<any>(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                connector_id: connectorId,
                source_table: sourceTable,
                import_options: opts,
            }),
        })
            .then(({ data }) => {
                if (data.columns && data.rows) {
                    onRefreshPreview?.(data.rows, data.columns, data.total_row_count ?? null);
                }
            })
            .catch(() => { /* best-effort */ })
            .finally(() => setRefreshing(false));
    }, [filters, columns, connectorId, sourceTable, sortColumn, sortOrder, onRefreshPreview]);

    // ── Load handler ─────────────────────────────────────────────────────

    const handleLoad = useCallback(() => {
        const opts: Record<string, any> = { size: rowLimit };
        const validFilters = coerceFilters(filters, columns);
        if (validFilters.length > 0) {
            opts.source_filters = validFilters;
        }
        if (sortColumn) {
            opts.sort_columns = [sortColumn];
            opts.sort_order = sortOrder;
        }
        onLoad(opts);
    }, [rowLimit, filters, columns, sortColumn, sortOrder, onLoad]);

    // ── Shared styles ────────────────────────────────────────────────────

    const inputSx = {
        '& .MuiInputBase-root': { fontSize: 11, height: 26 },
        '& .MuiInputBase-input': { py: 0.25, px: 0.75 },
    };

    // ── Render value control for a filter row ────────────────────────────

    const renderValueControl = (f: PreviewFilter, idx: number, inputType: string) => {
        const noValue = f.operator === 'IS_NULL' || f.operator === 'IS_NOT_NULL';
        const isBetween = f.operator === 'BETWEEN';

        if (noValue) {
            return (
                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10, flex: 1 }}>
                    {t('connectorPreview.noValueNeeded', { defaultValue: 'No value needed' })}
                </Typography>
            );
        }
        if (inputType === 'boolean') {
            return (
                <TextField
                    select size="small" value={f.value || ''}
                    onChange={(e) => setFilters(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                    sx={{ flex: 1, minWidth: 80, ...inputSx }}
                    slotProps={{ select: { displayEmpty: true } }}
                >
                    <MenuItem value="" sx={{ fontSize: 11, color: 'text.disabled' }}><em>—</em></MenuItem>
                    <MenuItem value="true" sx={{ fontSize: 11 }}>True</MenuItem>
                    <MenuItem value="false" sx={{ fontSize: 11 }}>False</MenuItem>
                </TextField>
            );
        }
        if (inputType === 'select' && f.column) {
            const cacheKey = `${connectorId}:${sourceTable.id}:${f.column}`;
            const hasTruncation = filterOptionsMore[cacheKey];
            return (
                <Tooltip
                    title={hasTruncation ? t('connectorPreview.filterOptionsTruncated', { defaultValue: 'Results truncated, type to narrow' }) : ''}
                    placement="top"
                >
                <Box sx={{ flex: 1, minWidth: 120 }}>
                    <Autocomplete
                        freeSolo size="small"
                        options={filterOptionsMap[cacheKey] || []}
                        value={f.value || null}
                        loading={filterOptionsLoading === cacheKey}
                        filterOptions={(opts) => opts}
                        getOptionLabel={(opt) => typeof opt === 'string' ? opt : (opt as any).label || String((opt as any).value)}
                        isOptionEqualToValue={(opt, val) => String(typeof opt === 'string' ? opt : (opt as any).value) === String(typeof val === 'string' ? val : (val as any).value)}
                        onChange={(_, val) => {
                            const newVal = val == null ? '' : typeof val === 'string' ? val : String((val as any).value);
                            setFilters(prev => prev.map((r, i) => i === idx ? { ...r, value: newVal } : r));
                        }}
                        onInputChange={(_, val, reason) => {
                            if (reason === 'input') {
                                setFilters(prev => prev.map((r, i) => i === idx ? { ...r, value: val } : r));
                            }
                        }}
                        renderInput={(params) => (
                            <TextField
                                {...params} size="small"
                                placeholder={t('connectorPreview.filterValueSearch', { defaultValue: 'Enter & search' })}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        loadFilterOptions(f.column, f.value || '');
                                    }
                                }}
                                sx={{ ...inputSx, '& .MuiOutlinedInput-root': { fontSize: 11, height: 26, py: 0 } }}
                            />
                        )}
                        slotProps={{ listbox: { sx: { fontSize: 11 } } }}
                    />
                </Box>
                </Tooltip>
            );
        }
        if (inputType === 'time') {
            const dateSx = {
                '& .MuiInputBase-root': { fontSize: 11, height: 28 },
                '& .MuiInputBase-input': { py: 0.25, px: 0.75 },
                '& .MuiInputBase-input::-webkit-calendar-picker-indicator': { cursor: 'pointer', opacity: 0.6 },
            };
            return (
                <Stack direction="row" spacing={0.5} sx={{ flex: 1, minWidth: 120 }}>
                    <TextField
                        size="small" type="date" value={f.value || ''} placeholder="YYYY-MM-DD"
                        onChange={(e) => setFilters(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                        slotProps={{ inputLabel: { shrink: true } }}
                        sx={{ flex: 1, ...dateSx }}
                    />
                    {isBetween && (
                        <TextField
                            size="small" type="date" value={f.valueTo || ''} placeholder="YYYY-MM-DD"
                            onChange={(e) => setFilters(prev => prev.map((r, i) => i === idx ? { ...r, valueTo: e.target.value } : r))}
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ flex: 1, ...dateSx }}
                        />
                    )}
                </Stack>
            );
        }
        if (inputType === 'numeric') {
            return (
                <Stack direction="row" spacing={0.5} sx={{ flex: 1, minWidth: 80 }}>
                    <TextField
                        size="small" type="number" value={f.value || ''}
                        placeholder={t('connectorPreview.filterValue', { defaultValue: 'Value' })}
                        onChange={(e) => setFilters(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                        sx={{ flex: 1, ...inputSx }}
                    />
                    {isBetween && (
                        <TextField
                            size="small" type="number" value={f.valueTo || ''}
                            placeholder={t('connectorPreview.filterValueTo', { defaultValue: 'To' })}
                            onChange={(e) => setFilters(prev => prev.map((r, i) => i === idx ? { ...r, valueTo: e.target.value } : r))}
                            sx={{ flex: 1, ...inputSx }}
                        />
                    )}
                </Stack>
            );
        }
        return (
            <TextField
                size="small" value={f.value || ''}
                placeholder={t('connectorPreview.filterValue', { defaultValue: 'Value' })}
                onChange={(e) => setFilters(prev => prev.map((r, i) => i === idx ? { ...r, value: e.target.value } : r))}
                sx={{ flex: 1, minWidth: 80, ...inputSx }}
            />
        );
    };

    // ── JSX ──────────────────────────────────────────────────────────────

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/* Header — name + row count + max rows */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5, flexShrink: 0 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>{displayName}</Typography>
                    {pathBreadcrumb && (
                        <Typography sx={{ fontSize: 11, color: 'text.disabled' }} noWrap>{pathBreadcrumb}</Typography>
                    )}
                    {rowCount != null && (
                        <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                            {t('connectorPreview.rowCount', { count: Number(rowCount).toLocaleString(), defaultValue: '{{count}} rows' })}
                            {sampleRows.length > 0 && (
                                <span style={{ opacity: 0.7, marginLeft: 4 }}>
                                    ({t('connectorPreview.previewRowsNotice', { count: sampleRows.length, defaultValue: `Preview shows first ${sampleRows.length} rows only` })})
                                </span>
                            )}
                        </Typography>
                    )}
                </Box>
                {!alreadyLoaded && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25, flexShrink: 0, mt: 0.125 }}>
                        <Typography sx={{ fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                            {t('connectorPreview.maxRows', { defaultValue: 'Max rows' })}
                        </Typography>
                        <RowLimitUnderlineSelect
                            value={rowLimit}
                            presets={rowLimitPresets}
                            onChange={setRowLimit}
                            fontSize={12}
                        />
                    </Box>
                )}
            </Box>

            {hasMetadataRow && (
                <Box sx={{ flexShrink: 0 }}>
                    <Box
                        onClick={() => setMetadataExpanded(v => !v)}
                        sx={{
                            display: 'flex', alignItems: 'center', gap: 0.5,
                            py: 0.25, cursor: 'pointer', userSelect: 'none',
                            '&:hover': { bgcolor: 'action.hover' },
                        }}
                    >
                        {metadataExpanded
                            ? <KeyboardArrowDownIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                            : <KeyboardArrowRightIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
                        <Typography noWrap sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', flex: 1 }}>
                            {t('connectorPreview.sourceMetadata')}
                        </Typography>
                        {statusLabel && (
                            <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                                {statusLabel}
                            </Typography>
                        )}
                        {columns.length > 0 && (
                            <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                                · {columns.length} {t('connectorPreview.columnsCount', { defaultValue: 'columns' })}
                            </Typography>
                        )}
                    </Box>
                    <Collapse in={metadataExpanded}>
                        <Box sx={{ pl: 2.5, pb: 0.5 }}>
                            {effectiveDesc && (
                                <Typography sx={{ fontSize: 10.5, color: 'text.secondary', whiteSpace: 'pre-wrap', mb: 0.5 }}>
                                    {effectiveDesc}
                                </Typography>
                            )}
                            {columns.length > 0 ? (
                                <Box
                                    component="table"
                                    sx={{
                                        width: '100%',
                                        borderCollapse: 'collapse',
                                        fontSize: 10.5,
                                        maxHeight: 200,
                                        display: 'block',
                                        overflowY: 'auto',
                                        '& th, & td': {
                                            px: 0.75, py: '3px',
                                            borderBottom: '1px solid',
                                            borderColor: 'divider',
                                            textAlign: 'left',
                                            whiteSpace: 'nowrap',
                                        },
                                        '& th': {
                                            fontWeight: 600,
                                            color: 'text.secondary',
                                            bgcolor: 'action.hover',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 1,
                                        },
                                        '& td': { color: 'text.secondary' },
                                        '& tr:nth-of-type(even) td': { bgcolor: 'action.hover' },
                                    }}
                                >
                                    <thead>
                                        <tr>
                                            <Box component="th" sx={{ width: 28 }}>#</Box>
                                            <th>{t('connectorPreview.colName', { defaultValue: 'Column' })}</th>
                                            <th>{t('connectorPreview.colType', { defaultValue: 'Type' })}</th>
                                            <th>{t('connectorPreview.colDesc', { defaultValue: 'Description' })}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {columns.map((col, i) => {
                                            const desc = col.display_description || col.description || col.source_description || '';
                                            const label = col.verbose_name && col.verbose_name !== col.name ? col.verbose_name : '';
                                            return (
                                                <tr key={col.name}>
                                                    <Box component="td" sx={{ color: 'text.disabled', width: 28 }}>{i + 1}</Box>
                                                    <td>
                                                        <Box component="span" sx={{ fontWeight: 600 }}>{col.name}</Box>
                                                        {label && (
                                                            <Box component="span" sx={{ color: 'text.disabled', ml: 0.5 }}>({label})</Box>
                                                        )}
                                                    </td>
                                                    <Box component="td" sx={{ color: 'text.disabled' }}>{col.type}</Box>
                                                    <Box component="td" sx={{ whiteSpace: 'normal', maxWidth: 220 }}>
                                                        {desc || <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>}
                                                        {col.expression && (
                                                            <Box component="div" sx={{ fontSize: 9.5, color: 'text.disabled', fontFamily: 'monospace', mt: '1px' }}>
                                                                {col.expression}
                                                            </Box>
                                                        )}
                                                    </Box>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </Box>
                            ) : !effectiveDesc && (
                                <Typography sx={{ fontSize: 10.5, color: 'text.disabled', fontStyle: 'italic' }}>
                                    {t('connectorPreview.noSourceMetadata')}
                                </Typography>
                            )}
                        </Box>
                    </Collapse>
                </Box>
            )}

            {/* Filter conditions */}
            {enableFilters && columns.length > 0 && !alreadyLoaded && (
                <Box sx={{ mt: 0.5, mb: 0.5, flexShrink: 0 }}>
                    {filters.map((f, idx) => {
                        const colMeta = columns.find(c => c.name === f.column);
                        const inputType = colMeta ? inferInputType(colMeta.type, colMeta.source_type) : 'text';
                        const operators = f.column ? getOperatorsForType(inputType) : getOperatorsForType('text');

                        return (
                            <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                <TextField
                                    select size="small" value={f.column}
                                    onChange={(e) => {
                                        const newCol = e.target.value;
                                        const newMeta = columns.find(c => c.name === newCol);
                                        const newType = newMeta ? inferInputType(newMeta.type, newMeta.source_type) : 'text';
                                        const newOps = getOperatorsForType(newType);
                                        const opValid = newOps.some(op => op.value === f.operator);
                                        setFilters(prev => prev.map((r, i) => i === idx ? {
                                            ...r,
                                            column: newCol,
                                            operator: opValid ? r.operator : defaultOperatorForType(newType),
                                            value: '', valueTo: '',
                                        } : r));
                                    }}
                                    slotProps={{ select: { displayEmpty: true } }}
                                    sx={{ minWidth: 130, '& .MuiInputBase-root': { fontSize: 11, height: 26 }, '& .MuiSelect-select': { py: 0.1, px: 0.75 } }}
                                >
                                    <MenuItem value="" disabled sx={{ fontSize: 11, color: 'text.disabled' }}>
                                        <em>{t('connectorPreview.filterColumn', { defaultValue: 'Column' })}</em>
                                    </MenuItem>
                                    {columns.map(c => (
                                        <MenuItem key={c.name} value={c.name} sx={{ fontSize: 11 }}>
                                            <Tooltip title={c.description || ''} placement="right" enterDelay={400} disableHoverListener={!c.description}>
                                                <span>{c.name}</span>
                                            </Tooltip>
                                        </MenuItem>
                                    ))}
                                </TextField>
                                <TextField
                                    select size="small" value={f.operator}
                                    onChange={(e) => setFilters(prev => prev.map((r, i) => i === idx ? { ...r, operator: e.target.value, value: '', valueTo: '' } : r))}
                                    sx={{ minWidth: 100, '& .MuiInputBase-root': { fontSize: 11, height: 26 }, '& .MuiSelect-select': { py: 0.1, px: 0.75 } }}
                                >
                                    {operators.map(op => (
                                        <MenuItem key={op.value} value={op.value} sx={{ fontSize: 11 }}>{op.label}</MenuItem>
                                    ))}
                                </TextField>
                                {renderValueControl(f, idx, inputType)}
                                <IconButton size="small" onClick={() => setFilters(prev => prev.filter((_, i) => i !== idx))}
                                    sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                                    <CloseIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                            </Box>
                        );
                    })}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Button
                            size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                            onClick={() => setFilters(prev => [...prev, { column: '', operator: 'EQ', value: '' }])}
                            sx={{ textTransform: 'none', fontSize: 11, px: 0.5, minHeight: 0, height: 22, color: 'text.secondary' }}
                        >
                            {t('connectorPreview.addFilter', { defaultValue: 'Add filter' })}
                        </Button>
                    </Box>
                </Box>
            )}

            {/* Preview table */}
            <Box sx={{ flex: '1 1 0', minHeight: 260, overflowY: 'auto' }}>
                {isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress size={20} />
                    </Box>
                ) : sampleRows.length > 0 ? (
                    <DataFrameTable
                        columns={columns.map(c => c.name)}
                        rows={sampleRows}
                        totalRows={rowCount ?? undefined}
                        maxColumns={20}
                        maxRows={10}
                        fontSize={11}
                        headerFontSize={10}
                        showIndex
                        columnDescriptions={columns.reduce<Record<string, string>>((acc, c) => {
                            if (c.description) acc[c.name] = c.description;
                            return acc;
                        }, {})}
                    />
                ) : columns.length > 0 && filters.length > 0 ? (
                    <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic', py: 2, textAlign: 'center' }}>
                        {t('connectorPreview.noMatchingRows', { defaultValue: 'No rows match the current filters' })}
                    </Typography>
                ) : (
                    <Typography sx={{ fontSize: 12, color: 'text.disabled', fontStyle: 'italic', py: 2, textAlign: 'center' }}>
                        {t('connectorPreview.noPreviewAvailable', { defaultValue: 'No preview available' })}
                    </Typography>
                )}
            </Box>

            {/* Footer — sort + load */}
            <Box sx={{ mt: 1, pt: 1, flexShrink: 0, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {alreadyLoaded ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Button
                            variant="outlined" size="small" disabled
                            startIcon={<CheckIcon sx={{ fontSize: 14 }} />}
                            sx={{
                                textTransform: 'none', fontSize: 12, px: 2, height: 30,
                                color: 'success.main', borderColor: 'success.main',
                                '&.Mui-disabled': { color: 'success.main', borderColor: 'success.main', opacity: 0.8 },
                            }}
                        >
                            {t('connectorPreview.loaded', { defaultValue: 'Loaded' })}
                        </Button>
                        {onUnload && (
                            <Button
                                variant="text" size="small" onClick={onUnload}
                                sx={{
                                    textTransform: 'none', fontSize: 11, px: 1, minWidth: 0, height: 28, color: 'text.secondary',
                                    '&:hover': { color: 'error.main', backgroundColor: 'rgba(211,47,47,0.04)' },
                                }}
                            >
                                {t('connectorPreview.unload', { defaultValue: 'Unload' })}
                            </Button>
                        )}
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        {/* Sort controls */}
                        {enableSort && columns.length > 0 && (<>
                            <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>Sort</Typography>
                            <TextField
                                select size="small" value={sortColumn}
                                onChange={(e) => setSortColumn(e.target.value)}
                                slotProps={{ select: { displayEmpty: true } }}
                                sx={{ width: 110, '& .MuiInputBase-root': { fontSize: 11, height: 28 }, '& .MuiSelect-select': { py: 0.25, px: 0.75 } }}
                            >
                                <MenuItem value="" sx={{ fontSize: 11, color: 'text.disabled' }}><em>none</em></MenuItem>
                                {columns.map(col => (
                                    <MenuItem key={col.name} value={col.name} sx={{ fontSize: 11 }}>{col.name}</MenuItem>
                                ))}
                            </TextField>
                            {sortColumn && (
                                <ToggleButtonGroup
                                    value={sortOrder} exclusive
                                    onChange={(_, v) => { if (v) setSortOrder(v); }}
                                    size="small" sx={{ height: 28 }}
                                >
                                    <ToggleButton value="asc" sx={{ px: 0.75, py: 0, fontSize: 10, textTransform: 'none' }}>ASC</ToggleButton>
                                    <ToggleButton value="desc" sx={{ px: 0.75, py: 0, fontSize: 10, textTransform: 'none' }}>DESC</ToggleButton>
                                </ToggleButtonGroup>
                            )}
                        </>)}
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="outlined" size="small"
                            startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
                            disabled={isLoading}
                            onClick={handleRefreshPreview}
                            sx={{ textTransform: 'none', fontSize: 12, px: 2, height: 30, flexShrink: 0 }}
                        >
                            {t('connectorPreview.refreshPreview', { defaultValue: 'Preview' })}
                        </Button>
                        <Button
                            variant="contained" size="small"
                            disabled={isLoading}
                            onClick={handleLoad}
                            sx={{ textTransform: 'none', fontSize: 12, px: 3, height: 30, flexShrink: 0 }}
                        >
                            {t('connectorPreview.loadTable', { defaultValue: 'Load Table' })}
                        </Button>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default ConnectorTablePreview;
