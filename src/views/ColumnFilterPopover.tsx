// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Column filter popover for `SelectableDataGrid` (design-doc 31).
 *
 * The popover variant is chosen synchronously from `metadata.distinctCount`:
 *   - numeric / temporal column → range form
 *   - low-cardinality column (`distinctCount <= LEVELS_LIMIT`) → checklist
 *   - everything else → keyword (case-insensitive substring) form
 *
 * Apply submits the new filter (or `undefined` to clear) and closes the
 * popover.  Clear clears in place.
 *
 * The three wire shapes returned via `onApply` match the backend vocabulary
 * (see `_build_filter_where_duckdb` / `_apply_filters_pandas`).
 */

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Box, Button, Checkbox, Divider, FormControlLabel, ListItemButton,
    Popover, Stack, TextField, Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { Type } from '../data/types';
import { formatCellValue } from './ViewUtils';

/** Wire shapes — must match the backend filter vocabulary. */
export type RangeFilter = {
    op: 'range';
    field: string;
    min?: number | string | null;
    max?: number | string | null;
    include_nulls?: boolean;
};
export type InFilter = {
    op: 'in';
    field: string;
    values: Array<string | number | boolean | null>;
};
export type ContainsFilter = {
    op: 'contains';
    field: string;
    value: string;
};
export type ColumnFilter = RangeFilter | InFilter | ContainsFilter;

const LEVELS_LIMIT = 100;

// Shared styling for the section-title dividers (label sits on the rule,
// uppercase + muted to read as a section break, not a heading).
const SECTION_DIVIDER_SX = {
    mx: 1.25,
    my: 0.5,
    '&::before, &::after': { borderColor: 'divider' },
    '& .MuiDivider-wrapper': { px: 0.75 },
} as const;

const isNumericType = (t: Type | undefined): boolean =>
    t === Type.Integer || t === Type.Number;
const isTemporalType = (t: Type | undefined): boolean =>
    t === Type.Date || t === Type.DateTime;

/** Decide which sub-form to show for a column. */
function pickVariant(
    dataType: Type | undefined,
    distinctCount: number | undefined,
): 'range' | 'checklist' | 'keyword' {
    if (isNumericType(dataType) || isTemporalType(dataType)) return 'range';
    if (distinctCount !== undefined && distinctCount > 0 && distinctCount <= LEVELS_LIMIT) {
        return 'checklist';
    }
    return 'keyword';
}

interface ColumnFilterPopoverProps {
    anchor: HTMLElement | null;
    open: boolean;
    onClose: () => void;
    columnId: string;
    columnLabel: string;
    dataType: Type | undefined;
    rowCount?: number;
    distinctCount?: number;
    nullCount?: number;
    levels?: any[];
    levelCounts?: number[];
    currentFilter?: ColumnFilter;
    onApply: (filter: ColumnFilter | undefined) => void;
    // Sort surface (rendered above the filter form as a unified column panel).
    isSorted: boolean;
    sortOrder: 'asc' | 'desc';
    onSortAsc: () => void;
    onSortDesc: () => void;
    onClearSort: () => void;
}

export const ColumnFilterPopover: React.FC<ColumnFilterPopoverProps> = ({
    anchor, open, onClose, columnId, columnLabel, dataType,
    rowCount, distinctCount, nullCount, levels, levelCounts, currentFilter, onApply,
    isSorted, sortOrder, onSortAsc, onSortDesc, onClearSort,
}) => {
    const { t } = useTranslation();
    const variant = pickVariant(dataType, distinctCount);

    const close = () => onClose();

    // Build the column-summary line ("N rows · N distinct · N blanks").
    const summaryParts: string[] = [];
    if (rowCount !== undefined) {
        summaryParts.push(t('dataGrid.filter.summaryRows', { count: rowCount }));
    }
    if (distinctCount !== undefined) {
        summaryParts.push(t('dataGrid.filter.summaryDistinct', { count: distinctCount }));
    }
    if (nullCount !== undefined && nullCount > 0) {
        summaryParts.push(t('dataGrid.filter.summaryBlanks', { count: nullCount }));
    }
    const summary = summaryParts.join(' · ');

    return (
        <Popover
            anchorEl={anchor}
            open={open}
            onClose={close}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: { sx: { p: 0, minWidth: 240, maxWidth: 320 } } }}
        >
            {/* Section 1 — column summary. */}
            <Box sx={{ px: 1.25, pt: 1, pb: 0.75 }}>
                <Typography
                    variant="subtitle2"
                    sx={{
                        fontSize: 13, fontWeight: 600, lineHeight: 1.3,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                >
                    {columnLabel}
                </Typography>
                {summary && (
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mt: 0.25 }}
                    >
                        {summary}
                    </Typography>
                )}
            </Box>
            <Divider textAlign="left" sx={SECTION_DIVIDER_SX}>
                <Typography
                    variant="overline"
                    color="text.disabled"
                    sx={{ fontSize: 10, lineHeight: 1, fontWeight: 400, letterSpacing: '0.08em' }}
                >
                    {t('dataGrid.filter.sectionSort')}
                </Typography>
            </Divider>
            {/* Section 2 — sort actions. */}
            <Box sx={{ py: 0.5 }}>
                <SortActionRow
                    icon={<ArrowUpwardIcon sx={{ fontSize: 14 }} />}
                    label={t('dataGrid.columnMenu.sortAsc')}
                    selected={isSorted && sortOrder === 'asc'}
                    onClick={() => { onSortAsc(); close(); }}
                />
                <SortActionRow
                    icon={<ArrowDownwardIcon sx={{ fontSize: 14 }} />}
                    label={t('dataGrid.columnMenu.sortDesc')}
                    selected={isSorted && sortOrder === 'desc'}
                    onClick={() => { onSortDesc(); close(); }}
                />
                <SortActionRow
                    label={t('dataGrid.columnMenu.clearSort')}
                    disabled={!isSorted}
                    onClick={() => { onClearSort(); close(); }}
                />
            </Box>
            <Divider textAlign="left" sx={SECTION_DIVIDER_SX}>
                <Typography
                    variant="overline"
                    color="text.disabled"
                    sx={{ fontSize: 10, lineHeight: 1, fontWeight: 400, letterSpacing: '0.08em' }}
                >
                    {t('dataGrid.filter.sectionFilter')}
                </Typography>
            </Divider>
            {/* Section 3 — filter form. */}
            <Box sx={{ px: 1.25, pt: 1, pb: 1 }}>
            {variant === 'range' && (
                <RangeFilterForm
                    columnId={columnId}
                    dataType={dataType}
                    nullCount={nullCount}
                    currentFilter={currentFilter}
                    onApply={(f) => { onApply(f); close(); }}
                />
            )}
            {variant === 'checklist' && (
                <ChecklistFilterForm
                    columnId={columnId}
                    dataType={dataType}
                    nullCount={nullCount}
                    levels={levels || []}
                    levelCounts={levelCounts}
                    currentFilter={currentFilter as InFilter | undefined}
                    onApply={(f) => { onApply(f); close(); }}
                />
            )}
            {variant === 'keyword' && (
                <KeywordFilterForm
                    columnId={columnId}
                    currentFilter={currentFilter as ContainsFilter | undefined}
                    onApply={(f) => { onApply(f); close(); }}
                />
            )}
            </Box>
        </Popover>
    );
};


// ──────────────────────────────────────────────────────────────────────────
//   Range form (numeric / date)
// ──────────────────────────────────────────────────────────────────────────

interface RangeFormProps {
    columnId: string;
    dataType: Type | undefined;
    nullCount?: number;
    currentFilter?: ColumnFilter;
    onApply: (filter: ColumnFilter | undefined) => void;
}

const RangeFilterForm: React.FC<RangeFormProps> = ({
    columnId, dataType, nullCount, currentFilter, onApply,
}) => {
    const { t } = useTranslation();
    const isDate = dataType === Type.Date;
    const isDateTime = dataType === Type.DateTime;
    const isNumeric = isNumericType(dataType);
    // For numeric columns we use type="text" + inputMode="decimal" instead of
    // type="number" — the native spinner buttons are visually awkward in a
    // narrow popover and add no value when bounds can be typed directly.
    const inputType = isDate ? 'date' : (isDateTime ? 'datetime-local' : 'text');
    const inputMode: React.HTMLAttributes<HTMLInputElement>['inputMode'] | undefined =
        isNumeric ? 'decimal' : undefined;

    const rangeFilter = currentFilter?.op === 'range' ? currentFilter : undefined;
    const isBlanksFilter =
        currentFilter?.op === 'in' &&
        currentFilter.values.length === 1 &&
        currentFilter.values[0] === null;

    const [minStr, setMinStr] = React.useState<string>(
        rangeFilter?.min != null ? String(rangeFilter.min) : '',
    );
    const [maxStr, setMaxStr] = React.useState<string>(
        rangeFilter?.max != null ? String(rangeFilter.max) : '',
    );
    // "Show blanks only" checkbox — when checked, the filter is an `in [null]`
    // and the min/max bounds are ignored.
    const [blanksOnly, setBlanksOnly] = React.useState<boolean>(isBlanksFilter);

    const buildFilter = (): ColumnFilter | undefined => {
        if (blanksOnly) {
            return { op: 'in', field: columnId, values: [null] };
        }
        const hasMin = minStr.trim() !== '';
        const hasMax = maxStr.trim() !== '';
        if (!hasMin && !hasMax) return undefined;
        let minVal: number | string | undefined;
        let maxVal: number | string | undefined;
        if (isNumeric) {
            // type="text" + inputMode="decimal" allows arbitrary strings —
            // drop a bound silently if it isn't a finite number.
            const n1 = hasMin ? Number(minStr) : NaN;
            const n2 = hasMax ? Number(maxStr) : NaN;
            minVal = Number.isFinite(n1) ? n1 : undefined;
            maxVal = Number.isFinite(n2) ? n2 : undefined;
        } else {
            minVal = hasMin ? minStr : undefined;
            maxVal = hasMax ? maxStr : undefined;
        }
        if (minVal === undefined && maxVal === undefined) return undefined;
        return {
            op: 'range',
            field: columnId,
            ...(minVal !== undefined ? { min: minVal as any } : {}),
            ...(maxVal !== undefined ? { max: maxVal as any } : {}),
        };
    };

    return (
        <Stack spacing={0.75}>
            <Stack direction="row" spacing={0.75}>
                <TextField
                    size="small"
                    type={inputType}
                    label={t('dataGrid.filter.from')}
                    value={minStr}
                    disabled={blanksOnly}
                    onChange={(e) => setMinStr(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onApply(buildFilter()); }}
                    autoComplete="off"
                    slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: {
                            style: { fontSize: 12 },
                            autoComplete: 'off',
                            name: `df-filter-from-${columnId}`,
                            ...(inputMode ? { inputMode } : {}),
                        },
                    }}
                    sx={{ '& .MuiInputBase-root': { fontSize: 12 }, '& .MuiInputLabel-root': { fontSize: 11 } }}
                />
                <TextField
                    size="small"
                    type={inputType}
                    label={t('dataGrid.filter.to')}
                    value={maxStr}
                    disabled={blanksOnly}
                    onChange={(e) => setMaxStr(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onApply(buildFilter()); }}
                    autoComplete="off"
                    slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: {
                            style: { fontSize: 12 },
                            autoComplete: 'off',
                            name: `df-filter-to-${columnId}`,
                            ...(inputMode ? { inputMode } : {}),
                        },
                    }}
                    sx={{ '& .MuiInputBase-root': { fontSize: 12 }, '& .MuiInputLabel-root': { fontSize: 11 } }}
                />
            </Stack>
            {(nullCount === undefined || nullCount > 0) && (
                <FormControlLabel
                    control={
                        <Checkbox
                            size="small"
                            checked={blanksOnly}
                            onChange={(e) => setBlanksOnly(e.target.checked)}
                            sx={{ p: 0.25 }}
                        />
                    }
                    label={
                        <Typography sx={{ fontSize: 11 }}>
                            {t('dataGrid.filter.showBlanksOnly')}
                            {nullCount !== undefined ? ` (${nullCount.toLocaleString()})` : ''}
                        </Typography>
                    }
                    sx={{ ml: 0, mt: 0.25 }}
                />
            )}
            <FilterActions
                onApply={() => onApply(buildFilter())}
                onClear={() => onApply(undefined)}
                clearDisabled={!currentFilter}
            />
        </Stack>
    );
};


// ──────────────────────────────────────────────────────────────────────────
//   Checklist form (categorical, ≤ 100 distinct values)
// ──────────────────────────────────────────────────────────────────────────

interface ChecklistFormProps {
    columnId: string;
    dataType: Type | undefined;
    nullCount?: number;
    levels: any[];
    levelCounts?: number[];
    currentFilter?: InFilter;
    onApply: (filter: InFilter | undefined) => void;
}

const ChecklistFilterForm: React.FC<ChecklistFormProps> = ({
    columnId, dataType, nullCount, levels, levelCounts, currentFilter, onApply,
}) => {
    const { t } = useTranslation();
    const showCounts = Array.isArray(levelCounts) && levelCounts.length === levels.length;
    const includeNullRow = nullCount === undefined || nullCount > 0;

    // Initial selection: all levels (and blank row when shown) selected when
    // no filter is active, else honour the existing filter.
    const initial = React.useMemo<Set<any>>(() => {
        if (currentFilter && Array.isArray(currentFilter.values)) {
            return new Set(currentFilter.values);
        }
        const s = new Set<any>(levels);
        if (includeNullRow) s.add(null);
        return s;
    }, [currentFilter, levels, includeNullRow]);

    const [selected, setSelected] = React.useState<Set<any>>(initial);

    const allSelected = selected.size === levels.length + (includeNullRow ? 1 : 0);

    const toggle = (val: any) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(val)) next.delete(val); else next.add(val);
            return next;
        });
    };
    const toggleAll = () => {
        if (allSelected) {
            setSelected(new Set());
        } else {
            const all = new Set<any>(levels);
            if (includeNullRow) all.add(null);
            setSelected(all);
        }
    };

    const buildFilter = (): InFilter | undefined => {
        if (allSelected) return undefined;
        return {
            op: 'in',
            field: columnId,
            values: Array.from(selected),
        };
    };

    return (
        <Stack spacing={0.5}>
            <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
                <ChecklistRow
                    label={<i>{t('dataGrid.filter.selectAll')}</i>}
                    checked={allSelected}
                    indeterminate={!allSelected && selected.size > 0}
                    onToggle={toggleAll}
                />
                {includeNullRow && (
                    <ChecklistRow
                        label={<i style={{ color: 'rgba(0,0,0,0.55)' }}>{t('dataGrid.filter.blank')}</i>}
                        count={showCounts ? nullCount : undefined}
                        checked={selected.has(null)}
                        onToggle={() => toggle(null)}
                    />
                )}
                {levels.map((v, idx) => {
                    const c = showCounts ? levelCounts![idx] : undefined;
                    return (
                        <ChecklistRow
                            key={idx}
                            label={formatCellValue(v, dataType)}
                            count={c}
                            checked={selected.has(v)}
                            onToggle={() => toggle(v)}
                        />
                    );
                })}
            </Box>
            <FilterActions
                onApply={() => onApply(buildFilter())}
                onClear={() => onApply(undefined)}
                clearDisabled={!currentFilter}
            />
        </Stack>
    );
};

const ChecklistRow: React.FC<{
    label: React.ReactNode;
    count?: number;
    checked: boolean;
    indeterminate?: boolean;
    onToggle: () => void;
}> = ({ label, count, checked, indeterminate, onToggle }) => (
    <Box
        onClick={onToggle}
        sx={{
            display: 'flex',
            alignItems: 'center',
            px: 0.5,
            py: 0.1,
            cursor: 'pointer',
            '&:hover': { backgroundColor: 'action.hover' },
        }}
    >
        <Checkbox
            size="small"
            checked={checked}
            indeterminate={indeterminate}
            sx={{ p: 0.25 }}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggle}
        />
        <Typography sx={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
        </Typography>
        {count !== undefined && (
            <Typography sx={{ fontSize: 11, color: 'text.secondary', ml: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                {count.toLocaleString()}
            </Typography>
        )}
    </Box>
);


// ──────────────────────────────────────────────────────────────────────────
//   Keyword form (case-insensitive substring)
// ──────────────────────────────────────────────────────────────────────────

interface KeywordFormProps {
    columnId: string;
    currentFilter?: ContainsFilter;
    onApply: (filter: ContainsFilter | undefined) => void;

}

const KeywordFilterForm: React.FC<KeywordFormProps> = ({
    columnId, currentFilter, onApply,
}) => {
    const { t } = useTranslation();
    const [value, setValue] = React.useState<string>(currentFilter?.value || '');

    const buildFilter = (): ContainsFilter | undefined => {
        const v = value.trim();
        if (!v) return undefined;
        return { op: 'contains', field: columnId, value: v };
    };

    return (
        <Stack spacing={0.75}>
            <TextField
                size="small"
                autoFocus
                placeholder={t('dataGrid.filter.contains') as string}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onApply(buildFilter()); }}
                autoComplete="off"
                slotProps={{ htmlInput: { style: { fontSize: 12 }, autoComplete: 'off', name: `df-filter-contains-${columnId}` } }}
                sx={{ '& .MuiInputBase-root': { fontSize: 12 } }}
            />
            <FilterActions
                onApply={() => onApply(buildFilter())}
                onClear={() => onApply(undefined)}
                clearDisabled={!currentFilter}
            />
        </Stack>
    );
};


// ──────────────────────────────────────────────────────────────────────────
//   Apply / Clear footer
// ──────────────────────────────────────────────────────────────────────────

const SortActionRow: React.FC<{
    icon?: React.ReactNode;
    label: string;
    onClick: () => void;
    selected?: boolean;
    disabled?: boolean;
}> = ({ icon, label, onClick, selected, disabled }) => (
    <ListItemButton
        dense
        selected={selected}
        disabled={disabled}
        onClick={onClick}
        sx={{
            minHeight: 28,
            py: 0.25,
            px: 1.25,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
        }}
    >
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
                width: 16,
            }}
        >
            {icon}
        </Box>
        <Typography variant="body2" sx={{ fontSize: 12, lineHeight: 1.4 }}>
            {label}
        </Typography>
    </ListItemButton>
);

const FilterActions: React.FC<{
    onApply: () => void;
    onClear: () => void;
    clearDisabled?: boolean;
}> = ({ onApply, onClear, clearDisabled }) => {
    const { t } = useTranslation();
    return (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
            <Button
                size="small"
                onClick={onClear}
                disabled={clearDisabled}
                sx={{
                    fontSize: 11,
                    py: 0.25,
                    px: 1,
                    minWidth: 0,
                    textTransform: 'none',
                }}
            >
                {t('dataGrid.filter.clear')}
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button
                size="small"
                variant="contained"
                onClick={onApply}
                sx={{ fontSize: 11, py: 0.25, px: 1.25, minWidth: 0, textTransform: 'none' }}
            >
                {t('dataGrid.filter.apply')}
            </Button>
        </Stack>
    );
};
