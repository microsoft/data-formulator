// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Supplementary pieces from `@df/chart` for what plain MUI makes tedious in a data app: a FilterBar of
 * labeled controls, fed by a column's values or extent (ValueSelect, ValueChips, DateRange, NumberRange)
 * or given choices (Segmented, Search), compact data displays
 * (BarList, TargetBar), the shared focus as chips (FocusChips), and the helpers that turn control values
 * into query filters (queryFilters) or test rows against them (inFocus). All are thin MUI wrappers.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import { bridge, type QueryOptions, type Row } from './bridge';
import { useDistinct, useQuery, type QueryResult } from './data';
import { QueryView } from './states';
import { formatValue } from './table';
import { useDensity, type DensityMetrics } from './density';

type Value = string | number;
type Option = Value | { value: Value; label?: React.ReactNode };
const optionValue = (option: Option) => (typeof option === 'object' ? option.value : option);
const optionLabel = (option: Option) => (typeof option === 'object' ? option.label ?? String(option.value) : String(option));

// ── Filters ─────────────────────────────────────────────────────────────

/**
 * What a control holds, by field: a value, a list of values, `{in: [...]}`, or `{range: [from, to]}` (either
 * end may be null). The same shape as a chart's focus, so a focus works here too.
 */
export type Where = Record<string, unknown>;

type Part = { in: unknown[] } | { range: [unknown, unknown] } | null;

const isEmpty = (value: unknown) => value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0);

/** A field's condition, or null when it does not constrain anything (empty, "All"). */
function partOf(value: unknown): Part {
    if (isEmpty(value)) return null;
    if (Array.isArray(value)) return { in: value };
    if (value && typeof value === 'object') {
        const object = value as { in?: unknown; range?: unknown };
        if (Array.isArray(object.in)) return object.in.length ? { in: object.in } : null;
        if (Array.isArray(object.range)) {
            const [from, to] = object.range;
            return isEmpty(from) && isEmpty(to) ? null : { range: [isEmpty(from) ? null : from, isEmpty(to) ? null : to] };
        }
        return null;
    }
    return { in: [value] };
}

/**
 * Query filters for `useQuery` from what the controls hold: `queryFilters({ region, product: chips,
 * date: { range: dates }, price: { range: prices } })`. Empty controls (`''`, `null`, `[]`) are left out.
 */
export function queryFilters(where: Where | null | undefined): NonNullable<QueryOptions['filters']> {
    const filters: NonNullable<QueryOptions['filters']> = [];
    for (const [field, value] of Object.entries(where ?? {})) {
        const part = partOf(value);
        if (!part) continue;
        if ('in' in part) filters.push({ field, op: 'in', values: part.in });
        else filters.push({ field, op: 'range', ...(part.range[0] !== null ? { min: part.range[0] } : {}), ...(part.range[1] !== null ? { max: part.range[1] } : {}) });
    }
    return filters;
}

const comparable = (value: unknown) => (typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value)) ? Number(value) : String(value));

/** Whether a row meets every condition (the same shapes as `queryFilters`), e.g. to filter rows already loaded. */
export function inFocus(row: Row, where: Where | null | undefined): boolean {
    return Object.entries(where ?? {}).every(([field, value]) => {
        const part = partOf(value);
        if (!part) return true;
        if ('in' in part) return part.in.some(item => String(item) === String(row[field]));
        const [from, to] = part.range;
        const at = comparable(row[field]);
        return (from === null || at >= comparable(from)) && (to === null || at <= comparable(to));
    });
}

// ── Filter bar ──────────────────────────────────────────────────────────

const BORDER = 'var(--df-rule, rgba(0, 0, 0, 0.12))';
/**
 * Every control is the density's height, so labels and controls line up across a FilterBar; an input's
 * text sits centred in it.
 */
const inputSx = (m: DensityMetrics) => ({
    bgcolor: 'background.paper',
    '& .MuiInputBase-root': { minHeight: m.control, fontSize: m.controlFont },
    '& .MuiInputBase-input': { py: `${Math.max(2, (m.control - 20) / 2)}px` },
});

/** The bar of filters at the top of an app: a tile whose fields stand side by side, labels above, wrapping on a narrow screen. */
export function FilterBar({ children, sticky, sx }: { children?: React.ReactNode; sticky?: boolean; sx?: SxProps<Theme> }) {
    const m = useDensity();
    return (
        <Paper variant="outlined" data-df-filterbar sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: m.barGap, padding: m.barPadding, borderColor: BORDER,
            ...(sticky ? { position: 'sticky', top: 8, zIndex: 5 } : {}), ...(sx as object),
        }}>{children}</Paper>
    );
}

interface FieldProps { label?: React.ReactNode; width?: number; grow?: boolean; children?: React.ReactNode; sx?: SxProps<Theme> }

/** A labeled control: the label above, the control below. */
function Field({ label, width, grow, children, sx }: FieldProps) {
    const m = useDensity();
    return (
        <Stack sx={{ gap: '4px', minWidth: width ?? (m.density === 'compact' ? 120 : 140), width, flex: grow ? '1 1 200px' : undefined, ...(sx as object) }}>
            {label && <Typography variant="body2" fontWeight={500} component="span" sx={{ fontSize: m.labelFont, lineHeight: 1.4 }}>{label}</Typography>}
            {children}
        </Stack>
    );
}

interface ColumnSource {
    /** The declared table and column the choices come from (or pass `options`). */
    table?: string;
    column?: string;
    /** Conditions on the other controls, to narrow the choices (as for `queryFilters`). */
    where?: Where;
}

interface Placement { width?: number; grow?: boolean; sx?: SxProps<Theme> }

export interface ValueSelectProps extends ColumnSource, Placement {
    label?: React.ReactNode;
    /** The chosen value; `''` for all. */
    value: Value;
    onChange: (value: Value) => void;
    /** Choices instead of the column's values: values or `{value, label}`. */
    options?: Option[];
    /** The "all" choice's label; `null` for no such choice. */
    allLabel?: string | null;
}

/** A dropdown of a column's distinct values (or `options`), with an "All" choice. */
export function ValueSelect({ table, column, where, label, value, onChange, options, allLabel = 'All', width, grow, sx }: ValueSelectProps) {
    const m = useDensity();
    const distinct = useDistinct(options ? null : table, column ?? '', { filters: queryFilters(where) });
    const choices: Option[] = options ?? distinct.values;
    const values = choices.map(optionValue);
    const current = values.some(item => String(item) === String(value)) ? String(value) : '';
    return (
        <Field label={label} width={width} grow={grow} sx={sx}>
            <TextField select size="small" value={current} sx={inputSx(m)}
                slotProps={{ select: { displayEmpty: true, MenuProps: { slotProps: { paper: { sx: { maxHeight: 320 } } } } } }}
                onChange={event => onChange(values.find(item => String(item) === event.target.value) ?? '')}>
                {allLabel !== null && <MenuItem value="">{allLabel}</MenuItem>}
                {!options && distinct.loading && !choices.length && <MenuItem value="" disabled>Loading…</MenuItem>}
                {choices.map(option => (
                    <MenuItem key={String(optionValue(option))} value={String(optionValue(option))}>{optionLabel(option)}</MenuItem>
                ))}
            </TextField>
        </Field>
    );
}

export interface ValueChipsProps extends ColumnSource, Placement {
    label?: React.ReactNode;
    /** The chosen values; `[]` for all. */
    value: Value[];
    onChange: (value: Value[]) => void;
    options?: Option[];
    /** Up to this many choices show as chips to toggle; more become a multi-select with type-ahead. */
    chipLimit?: number;
}

/** Several of a column's values: chips to toggle when there are few, a multi-select with type-ahead when many. */
export function ValueChips({ table, column, where, label, value, onChange, options, chipLimit = 6, width, grow, sx }: ValueChipsProps) {
    const m = useDensity();
    const distinct = useDistinct(options ? null : table, column ?? '', { filters: queryFilters(where) });
    const choices: Option[] = options ?? distinct.values;
    const chosen = new Set((value ?? []).map(String));
    if (choices.length > chipLimit) {
        const labels = new Map(choices.map(option => [String(optionValue(option)), optionLabel(option)]));
        return (
            <Field label={label} width={width ?? 240} grow={grow ?? true} sx={sx}>
                <Autocomplete multiple size="small" disableCloseOnSelect limitTags={2} options={choices.map(optionValue)}
                    value={choices.map(optionValue).filter(item => chosen.has(String(item)))}
                    getOptionLabel={item => String(labels.get(String(item)) ?? item)}
                    onChange={(_event, next) => onChange(next)}
                    renderInput={params => <TextField {...params} placeholder={chosen.size ? undefined : 'All'}
                        sx={{ ...inputSx(m), '& .MuiInputBase-root': { minHeight: m.control, fontSize: m.controlFont, py: '1px !important' },
                            '& .MuiInputBase-input': { py: '2px !important' } }} />} />
            </Field>
        );
    }
    return (
        <Field label={label} width={width} grow={grow} sx={sx}>
            <Stack direction="row" useFlexGap flexWrap="wrap" sx={{ gap: '6px', minHeight: m.control, alignItems: 'center' }}>
                {choices.map(option => {
                    const key = String(optionValue(option));
                    const on = chosen.has(key);
                    return (
                        <Chip key={key} size="small" label={optionLabel(option)} clickable aria-pressed={on} sx={{ height: m.chipHeight, fontSize: m.controlFont }}
                            color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'}
                            onClick={() => onChange(on ? value.filter(item => String(item) !== key) : [...value, optionValue(option)])} />
                    );
                })}
            </Stack>
        </Field>
    );
}

export interface SegmentedProps extends Placement {
    label?: React.ReactNode;
    value: Value;
    onChange: (value: Value) => void;
    /** 2–5 choices: values or `{value, label}`. */
    options: Option[];
}

/** One of 2–5 choices (a measure, a view), the chosen one filled. */
export function Segmented({ label, value, onChange, options, width, grow, sx }: SegmentedProps) {
    const m = useDensity();
    const theme = useTheme();
    return (
        <Field label={label} width={width} grow={grow} sx={sx}>
            <ToggleButtonGroup exclusive size="small" value={value} onChange={(_event, next) => { if (next !== null) onChange(next); }}
                sx={{
                    alignSelf: 'flex-start', bgcolor: 'background.paper', p: '2px', gap: '2px', border: `1px solid ${BORDER}`, borderRadius: 1.5,
                    '& .MuiToggleButton-root': {
                        border: 0, borderRadius: '6px !important', px: '10px', py: 0, minHeight: m.control - 6, fontSize: m.controlFont, textTransform: 'none', fontWeight: 500, color: 'text.primary',
                        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08), color: 'primary.main' },
                        '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 600 },
                    },
                }}>
                {options.map(option => <ToggleButton key={String(optionValue(option))} value={optionValue(option)}>{optionLabel(option)}</ToggleButton>)}
            </ToggleButtonGroup>
        </Field>
    );
}

export interface SearchProps extends Placement {
    label?: React.ReactNode;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** Milliseconds of quiet typing before `onChange` (default 250). */
    delay?: number;
}

/** A search box; `onChange` fires once typing pauses. Filter with `{ op: 'contains' }` or `useQuery`'s `search`. */
export function Search({ label, value, onChange, placeholder = 'Search…', delay = 250, width, grow, sx }: SearchProps) {
    const m = useDensity();
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    useEffect(() => {
        if (draft === value) return;
        const timer = setTimeout(() => onChange(draft), delay);
        return () => clearTimeout(timer);
    }, [draft, value, onChange, delay]);
    return (
        <Field label={label} width={width ?? 200} grow={grow} sx={sx}>
            <TextField size="small" type="search" value={draft} placeholder={placeholder}
                onChange={event => setDraft(event.target.value)}
                sx={inputSx(m)} />
        </Field>
    );
}

/** A column's lowest and highest value, from the table or as given. */
function useExtent(table: string | undefined, column: string | undefined, where: Where | undefined, min: unknown, max: unknown) {
    const ask = table && column && (min === undefined || max === undefined);
    const query = useQuery(ask ? table : null, {
        aggregates: [{ op: 'min', field: column }, { op: 'max', field: column }] as QueryOptions['aggregates'],
        ...(where ? { filters: queryFilters(where) } : {}),
    });
    const row = query.rows[0] ?? {};
    return { min: min ?? row[`${column}_min`], max: max ?? row[`${column}_max`], loading: !!ask && query.loading };
}

const niceStep = (span: number) => {
    const raw = span / 100;
    if (raw <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map(factor => factor * power).find(candidate => candidate >= raw) ?? power;
};

/** A two-handle slider in a labeled field; the label shows the range, and the range is reported when let go. */
function RangeField({ label, summary, count, from, to, onDraft, onCommit, step, width, grow, sx, disabled }: Placement & {
    label?: React.ReactNode; summary: React.ReactNode; count: [number, number]; from: number; to: number; step: number;
    onDraft: (next: [number, number]) => void; onCommit: (next: [number, number]) => void; disabled?: boolean;
}) {
    const m = useDensity();
    return (
        <Field label={<>{label}{label ? ': ' : ''}<Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>{summary}</Box></>}
            width={width ?? 240} grow={grow} sx={sx}>
            <Box sx={{ px: 1, minHeight: m.control, display: 'flex', alignItems: 'center' }}>
                <Slider size="small" disableSwap disabled={disabled} min={count[0]} max={count[1]} step={step} value={[from, to]}
                    onChange={(_event, next) => onDraft(next as [number, number])}
                    onChangeCommitted={(_event, next) => onCommit(next as [number, number])} />
            </Box>
        </Field>
    );
}

export interface NumberRangeProps extends ColumnSource, Placement {
    label?: React.ReactNode;
    /** `[from, to]`, or null for the whole range. */
    value: [number, number] | null;
    onChange: (value: [number, number] | null) => void;
    /** The ends instead of the column's extent. */
    min?: number;
    max?: number;
    step?: number;
    /** How the ends read: a function, or a DataTable format such as 'compact' or 'percent'. */
    format?: string | ((value: number) => React.ReactNode);
}

/** A range slider over a number column's extent (or `min`/`max`); null when it spans everything. */
export function NumberRange({ table, column, where, label, value, onChange, min, max, step, format, width, grow, sx }: NumberRangeProps) {
    const extent = useExtent(table, column, where, min, max);
    const low = Number(extent.min);
    const high = Number(extent.max);
    const ready = Number.isFinite(low) && Number.isFinite(high) && high > low;
    const [draft, setDraft] = useState<[number, number] | null>(null);
    useEffect(() => setDraft(null), [value]);
    const [from, to] = draft ?? value ?? [low, high];
    const show = (number: number) => (typeof format === 'function' ? format(number) : formatValue(number, {}, format ?? 'number'));
    return (
        <RangeField label={label} summary={ready ? <>{show(from)} – {show(to)}</> : '…'} disabled={!ready}
            count={ready ? [low, high] : [0, 1]} from={ready ? from : 0} to={ready ? to : 1} step={step ?? (ready ? niceStep(high - low) : 1)}
            onDraft={setDraft} onCommit={([a, b]) => onChange(a <= low && b >= high ? null : [a, b])} width={width} grow={grow} sx={sx} />
    );
}

// ── DateRange ───────────────────────────────────────────────────────────

type DateFormat = 'year' | 'year-text' | 'month' | 'day';

/** How a column writes its dates, from one of its values. */
export function dateFormatOf(value: unknown): DateFormat {
    if (typeof value === 'number') return 'year';
    const text = String(value ?? '');
    if (/^\d{4}$/.test(text)) return 'year-text';
    if (/^\d{4}-\d{2}$/.test(text)) return 'month';
    return 'day';
}

const pad = (number: number) => String(number).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A date at the start or end of its period, written the way the column writes dates. */
export function dateBound(text: string, granularity: 'year' | 'month' | 'day', end: boolean, format: DateFormat): Value {
    const [yearText, monthText, dayText] = text.split('-');
    const year = Number(yearText);
    const month = granularity === 'year' ? (end ? 12 : 1) : Number(monthText);
    const day = granularity === 'day' ? Number(dayText) : end ? lastDay(year, month) : 1;
    if (format === 'year') return year;
    if (format === 'year-text') return String(year);
    if (format === 'month') return `${year}-${pad(month)}`;
    return `${year}-${pad(month)}-${pad(day)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The periods (years, or months as "YYYY-MM") from one date to another, oldest first. */
export function periodsBetween(min: unknown, max: unknown, unit: 'year' | 'month'): string[] {
    const [y0, m0] = String(min ?? '').split('-').map(Number);
    const [y1, m1] = String(max ?? '').split('-').map(Number);
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || y1 < y0) return [];
    const periods: string[] = [];
    if (unit === 'year') {
        for (let year = y0; year <= y1; year++) periods.push(String(year));
        return periods;
    }
    for (let year = y0, month = m0 || 1; year < y1 || (year === y1 && month <= (m1 || 12)); month++) {
        if (month > 12) { month = 1; year++; if (year > y1) break; }
        periods.push(`${year}-${pad(month)}`);
        if (periods.length > 600) break;
    }
    return periods;
}

const periodLabel = (period: string) => {
    const [year, month] = period.split('-');
    return month ? `${MONTHS[Number(month) - 1]} ${year}` : year;
};

export interface DateRangeProps extends ColumnSource, Placement {
    label?: React.ReactNode;
    /** `[from, to]` in the column's own format (a year number, "2024", "2024-03", or "2024-03-15"), or null for all. */
    value: [Value | null, Value | null] | null;
    onChange: (value: [Value | null, Value | null] | null) => void;
    /** What the slider steps by: whole years or months (default: as the column writes dates). */
    granularity?: 'year' | 'month';
    /** The ends instead of the column's extent. */
    min?: Value;
    max?: Value;
}

/**
 * A range slider over a date column's months (or years), the label showing the period ("Jan 2023 – Jun
 * 2024"). Values are in the column's own format, a month or year taking its whole span, so
 * `queryFilters({ date: { range } })` compares like with like; null when it spans everything.
 */
export function DateRange({ table, column, where, label = 'Period', value, onChange, granularity, min, max, width, grow, sx }: DateRangeProps) {
    const extent = useExtent(table, column, where, min, max);
    const format = dateFormatOf(extent.max ?? extent.min);
    const unit = granularity ?? (format === 'year' || format === 'year-text' ? 'year' : 'month');
    const periods = useMemo(() => periodsBetween(extent.min, extent.max, unit), [extent.min, extent.max, unit]);
    const last = periods.length - 1;
    const indexOf = (bound: Value | null, fallback: number) => {
        if (bound === null || bound === undefined) return fallback;
        const at = periods.indexOf(String(bound).slice(0, unit === 'year' ? 4 : 7));
        return at < 0 ? fallback : at;
    };
    const [draft, setDraft] = useState<[number, number] | null>(null);
    useEffect(() => setDraft(null), [value]);
    const [from, to] = draft ?? [indexOf(value?.[0] ?? null, 0), indexOf(value?.[1] ?? null, last)];
    const ready = last > 0;
    return (
        <RangeField label={label} disabled={!ready}
            summary={ready ? (from === 0 && to === last ? `All (${periodLabel(periods[0])} – ${periodLabel(periods[last])})` : `${periodLabel(periods[from])} – ${periodLabel(periods[to])}`) : '…'}
            count={[0, Math.max(1, last)]} from={from} to={ready ? to : 1} step={1} onDraft={setDraft}
            onCommit={([a, b]) => onChange(a <= 0 && b >= last ? null
                : [dateBound(periods[a], unit, false, format), dateBound(periods[b], unit, true, format)])}
            width={width ?? 280} grow={grow} sx={sx} />
    );
}

// ── Header ──────────────────────────────────────────────────────────────

/** A value as a reader reads it in a header: "Jan 2023", "Mar 4, 2024", "12,400", "West". */
export function headerValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (value instanceof Date) return headerValue(value.toISOString().slice(0, 10));
    if (typeof value === 'number') return Number.isInteger(value) && value >= 1000 && value <= 3000 ? String(value) : bridge().format.number(value);
    const text = String(value);
    const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (date) return `${MONTHS[Number(date[2]) - 1]} ${Number(date[3])}, ${date[1]}`;
    if (/^\d{4}(-\d{2})?$/.test(text)) return periodLabel(text);
    return text;
}

/** "from – to", one value when both are the same, open ends as "from …" / "… to". */
export function headerRange(from: unknown, to: unknown): string {
    const [a, b] = [isEmpty(from) ? null : headerValue(from), isEmpty(to) ? null : headerValue(to)];
    if (a && b) return a === b ? a : `${a} – ${b}`;
    return a ? `from ${a}` : b ? `to ${b}` : '';
}

/** What the controls hold, in words: "Region: West · Category: Office, Technology · Period: Jan 2023 – Jun 2024". */
export function filterSummary(where: Where | null | undefined, labels?: Record<string, string>): string {
    return Object.entries(where ?? {}).map(([field, value]) => {
        const part = partOf(value);
        if (!part) return null;
        const text = 'in' in part
            ? (part.in.length > 3 ? `${part.in.slice(0, 3).map(headerValue).join(', ')} +${part.in.length - 3}` : part.in.map(headerValue).join(', '))
            : headerRange(part.range[0], part.range[1]);
        return `${labels?.[field] ?? field}: ${text}`;
    }).filter(Boolean).join(' · ');
}

export interface AppHeaderProps {
    /** A short line above the title: the topic or section ("Sales", "Energy"). */
    kicker?: React.ReactNode;
    /** The page's title. A story, panel, or slide deck states its finding; a dashboard names what it monitors. */
    title: React.ReactNode;
    /** One sentence under the title: what the page covers (scope, units) or the key result. */
    deck?: React.ReactNode;
    /** The data's period: `[from, to]`, or a table column to read it from (`{ table, column }`, narrowed by `where`). */
    period?: [unknown, unknown] | { table: string; column: string; where?: Where };
    /** When the data was last updated or what it runs through. */
    asOf?: unknown;
    /** How many records the page shows: a number with what they are, e.g. `{ value: 3193, noun: 'films' }`. */
    count?: { value: number; noun: string };
    /** Where the data comes from, e.g. "Bureau of Labor Statistics". */
    source?: React.ReactNode;
    /** What the controls hold now (as for `queryFilters`), summarised under the title so the page says what it shows. */
    where?: Where | null;
    /** Names for the fields in `where`, e.g. `{ region: 'Region' }`. */
    labels?: Record<string, string>;
    /** `"editorial"` sets a larger title for a story or a reading page. */
    variant?: 'page' | 'editorial';
    /** Controls beside the title (one or two, often in a `FilterBar`); they stack under it on a narrow screen. */
    children?: React.ReactNode;
}

/**
 * The top of an app: kicker, title, and deck, then a line of context — the data's period, as-of date, count,
 * and source — and, when controls narrow the data, what they hold. Controls passed as children stand beside it.
 */
export function AppHeader({ kicker, title, deck, period, asOf, count, source, where, labels, variant = 'page', children }: AppHeaderProps) {
    const column = period && !Array.isArray(period) ? period : null;
    const extent = useQuery(column ? column.table : null, column ? {
        aggregates: [{ op: 'min', field: column.column }, { op: 'max', field: column.column }],
        filters: queryFilters(column.where),
    } : {});
    const range = Array.isArray(period) ? period
        : column && extent.rows[0] ? [extent.rows[0][`${column.column}_min`], extent.rows[0][`${column.column}_max`]] : null;
    const meta: React.ReactNode[] = [
        range ? headerRange(range[0], range[1]) : null,
        isEmpty(asOf) ? null : `As of ${headerValue(asOf)}`,
        count ? `${bridge().format.number(count.value)} ${count.noun}` : null,
        source ? <>Source: {source}</> : null,
    ].filter(item => item !== null && item !== '');
    const filters = filterSummary(where, labels);
    const editorial = variant === 'editorial';
    return (
        <Stack data-df-header direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between"
            alignItems={{ md: 'flex-start' }}>
            <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
                {kicker && <Typography variant="overline" color="primary" sx={{ lineHeight: 1.4 }}>{kicker}</Typography>}
                <Typography variant={editorial ? 'h4' : 'h5'} component="h1" fontWeight={editorial ? undefined : 600}>{title}</Typography>
                {deck && <Typography color="text.secondary" sx={{ maxWidth: '72ch' }}>{deck}</Typography>}
                {(meta.length > 0 || filters) && (
                    <Typography variant="caption" color="text.secondary" component="div" data-df-header-meta>
                        {meta.map((item, index) => <React.Fragment key={index}>{index ? ' · ' : ''}{item}</React.Fragment>)}
                        {filters && <>{meta.length ? ' · ' : ''}<Box component="span" sx={{ color: 'text.primary' }}>Showing {filters}</Box></>}
                    </Typography>
                )}
            </Stack>
            {children && <Box sx={{ flexShrink: 0, maxWidth: { md: '62%' } }}>{children}</Box>}
        </Stack>
    );
}

// ── Displays ────────────────────────────────────────────────────────────

export interface BarListProps {
    data?: Row[];
    query?: QueryResult;
    /** The field naming each row, and the field of its number. */
    label: string;
    value: string;
    /** How values read: a DataTable format ('compact', 'percent', 'number:1') or a function. */
    format?: string | ((value: unknown, row: Row) => React.ReactNode);
    /** The largest rows only (default 10); the list is ranked by value. */
    limit?: number;
    /** Highlights the rows a focus names; clicking a row sets the focus to it (and clicking it again clears it). */
    focus?: Where | null;
    onFocus?: (focus: Where | null) => void;
    color?: string;
}

/**
 * A ranked list: each row's name over a bar of its value, the value at the end. Compact, for a tile or a sidebar.
 * It keeps to the room its tile leaves: in a tile of set height, the rows that fit show, with "+N more" for the rest
 * (which then scroll inside the tile); in a tile of natural height, every row shows and sets the height.
 */
export function BarList({ data, query, ...props }: BarListProps) {
    if (query) return <QueryView query={query} height={160} fill>{rows => <BarListBody rows={rows} {...props} />}</QueryView>;
    return <BarListBody rows={data ?? []} {...props} />;
}

const BAR_ROW = 28;
const BAR_GAP = 6;
const BAR_MORE = 22;

function BarListBody({ rows, label, value, format = 'compact', limit = 10, focus, onFocus, color }: Omit<BarListProps, 'data' | 'query'> & { rows: Row[] }) {
    const theme = useTheme();
    const ink = color ?? theme.palette.primary.main;
    const ranked = useMemo(() => [...rows].sort((a, b) => Number(b[value]) - Number(a[value])).slice(0, limit), [rows, value, limit]);
    const top = Math.max(0, ...ranked.map(row => Math.abs(Number(row[value])) || 0));
    const focused = focus ? partOf(focus[label]) : null;
    const isOn = (row: Row) => !focused || inFocus(row, { [label]: focus![label] });
    // The height it is given (null: not laid out). It grows into a tile's free room and shrinks to fit a short one, so
    // this is the room it has, never just what its rows take.
    const boxRef = useRef<HTMLDivElement>(null);
    const [room, setRoom] = useState<number | null>(null);
    const [open, setOpen] = useState(false);
    useLayoutEffect(() => {
        const element = boxRef.current;
        if (!element) return;
        const measure = () => setRoom(element.clientHeight || null);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const fitsAll = room === null || ranked.length * (BAR_ROW + BAR_GAP) - BAR_GAP <= room + 1;
    // Cut short: the rows that fit above the "+N more" line (at least one).
    const shown = open || fitsAll ? ranked : ranked.slice(0, Math.max(1, Math.floor((room! - BAR_MORE) / (BAR_ROW + BAR_GAP))));
    return (
        <Box ref={boxRef} data-bar-list sx={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: `${BAR_GAP}px`,
            overflowY: open && !fitsAll ? 'auto' : 'hidden', overflowX: 'hidden' }}>
            {shown.map(row => {
                const share = top ? Math.abs(Number(row[value])) / top : 0;
                const name = row[label];
                const picked = focused && 'in' in focused && focused.in.some(item => String(item) === String(name));
                return (
                    <Box key={String(name)} role={onFocus ? 'button' : undefined} tabIndex={onFocus ? 0 : undefined}
                        onClick={onFocus ? () => onFocus(picked ? null : { [label]: { in: [name] } }) : undefined}
                        onKeyDown={onFocus ? event => { if (event.key === 'Enter') onFocus(picked ? null : { [label]: { in: [name] } }); } : undefined}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0, cursor: onFocus ? 'pointer' : 'default',
                            opacity: isOn(row) ? 1 : 0.4, transition: 'opacity 150ms' }}>
                        <Box sx={{ position: 'relative', flex: 1, minWidth: 0, height: BAR_ROW, borderRadius: 1, overflow: 'hidden' }}>
                            <Box sx={{ position: 'absolute', inset: 0, width: `${share * 100}%`, bgcolor: alpha(ink, 0.2), borderRadius: 1 }} />
                            <Typography variant="body2" noWrap sx={{ position: 'relative', lineHeight: '28px', px: 1 }}>{String(name ?? '—')}</Typography>
                        </Box>
                        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>
                            {formatValue(row[value], row, format)}
                        </Typography>
                    </Box>
                );
            })}
            {!fitsAll && <Typography component="button" type="button" data-bar-list-more aria-expanded={open} onClick={() => setOpen(current => !current)}
                sx={{ alignSelf: 'flex-start', flexShrink: 0, height: BAR_MORE, p: 0, px: 1, border: 0, bgcolor: 'transparent', cursor: 'pointer',
                    font: 'inherit', fontSize: '0.8rem', fontWeight: 600, color: 'primary.main' }}>
                {open ? 'Show less' : `+${ranked.length - shown.length} more`}
            </Typography>}
        </Box>
    );
}

export interface TargetBarProps {
    value: number;
    target: number;
    /** How the target reads (default: compact). */
    label?: React.ReactNode;
    /** Whether reaching the target means going over it ('up', default) or staying under it ('down'). */
    goodDirection?: 'up' | 'down';
}

/** Progress toward a target: a bar to it, and the share reached. Under a KPI's value, for instance. */
export function TargetBar({ value, target, label, goodDirection = 'up' }: TargetBarProps) {
    const theme = useTheme();
    const share = target ? value / target : 0;
    const met = goodDirection === 'up' ? value >= target : value <= target;
    const tone = met ? theme.palette.success.main : theme.palette.warning.main;
    return (
        <Stack spacing={0.5}>
            <Box sx={{ position: 'relative', height: 6, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, 0.1), overflow: 'hidden' }}>
                <Box sx={{ position: 'absolute', inset: 0, width: `${Math.max(0, Math.min(1, share)) * 100}%`, bgcolor: tone, borderRadius: 3 }} />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {bridge().format.percent(share, 0)} of target {label ?? bridge().format.compact(target)}
            </Typography>
        </Stack>
    );
}

export interface FocusChipsProps {
    focus: Where | null | undefined;
    onChange: (focus: Where | null) => void;
    /** Names for fields, e.g. { gdp: 'GDP per person' }. */
    labels?: Record<string, string>;
    /** How a range's ends read. */
    format?: (value: unknown, field: string) => React.ReactNode;
}

/** The shared focus as chips, one per field, each removable, with a way to clear them all. Nothing when no focus. */
export function FocusChips({ focus, onChange, labels, format }: FocusChipsProps) {
    const parts = Object.entries(focus ?? {}).map(([field, value]) => [field, partOf(value)] as const).filter(([, part]) => part);
    if (!parts.length) return null;
    const show = (value: unknown, field: string) => (format ? format(value, field) : typeof value === 'number' ? bridge().format.number(value) : String(value));
    const remove = (field: string) => {
        const next = Object.fromEntries(Object.entries(focus ?? {}).filter(([key]) => key !== field));
        onChange(Object.keys(next).length ? next : null);
    };
    return (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
            {parts.map(([field, part]) => {
                const text = 'in' in part! ? part!.in.map(item => show(item, field)).join(', ')
                    : `${part!.range[0] === null ? '…' : show(part!.range[0], field)} – ${part!.range[1] === null ? '…' : show(part!.range[1], field)}`;
                return <Chip key={field} size="small" color="primary" variant="outlined" label={<>{labels?.[field] ?? field}: {text}</>} onDelete={() => remove(field)} />;
            })}
            {parts.length > 1 && <Button size="small" onClick={() => onChange(null)}>Clear all</Button>}
        </Stack>
    );
}
