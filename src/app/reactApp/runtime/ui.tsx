// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** `@df/ui`: Data Formulator–styled building blocks for apps (MUI + DF theme). */

import React, { useEffect, useMemo, useState } from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import MuiSelect from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import MuiTabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Slider from '@mui/material/Slider';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import { alpha, useTheme } from '@mui/material/styles';

import { bridge, type Row } from './bridge';
import type { QueryResult } from './data';
import { Sparkline } from './chart';
import { Empty, ErrorState, Loading, QueryView } from './states';

export { Empty, ErrorState, Loading, QueryView };

const BORDER = 'rgba(0, 0, 0, 0.12)';
const SHADOW = '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)';

type Option = string | number | { value: string | number; label?: React.ReactNode };
const optionValue = (option: Option) => typeof option === 'object' ? option.value : option;
const optionLabel = (option: Option) => typeof option === 'object' ? option.label ?? String(option.value) : String(option);

// ── Layout ──────────────────────────────────────────────────────────────

export interface PageProps {
    title: React.ReactNode;
    eyebrow?: React.ReactNode;
    subtitle?: React.ReactNode;
    /** Short facts shown at the right of the header (badges). */
    meta?: React.ReactNode;
    children?: React.ReactNode;
}

/** The app page: a header band, then content on DF's light canvas. */
export function Page({ title, eyebrow, subtitle, meta, children }: PageProps) {
    return (
        <Box sx={{ minHeight: '100vh', bgcolor: '#f6f7f9', px: 2.5, pt: 2, pb: 4, boxSizing: 'border-box' }}>
            <Box sx={{ maxWidth: 1600, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                <Box component="header" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 1, pr: 14 }}>
                    <Box sx={{ minWidth: 0, flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {eyebrow && <Typography sx={{ fontSize: 'var(--df-text-xxs)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'primary.textColor' }}>{eyebrow}</Typography>}
                        <Typography component="h1" sx={{ fontSize: 'var(--df-text-xxl)', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{title}</Typography>
                        {subtitle && <Typography sx={{ fontSize: 'var(--df-text-md)', color: 'text.secondary', maxWidth: '80ch' }}>{subtitle}</Typography>}
                    </Box>
                    {meta && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>{meta}</Box>}
                </Box>
                {children}
            </Box>
        </Box>
    );
}

/** A titled group of content within the page. */
export function Section({ title, actions, children }: { title?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
    return (
        <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {(title || actions) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                    {title && <Typography sx={{ fontSize: 'var(--df-text-xs)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}>{title}</Typography>}
                    <Box sx={{ flex: 1, borderTop: `1px solid ${BORDER}` }} />
                    {actions}
                </Box>
            )}
            {children}
        </Box>
    );
}

export interface GridProps {
    children?: React.ReactNode;
    /** Minimum cell width in px for a responsive grid (default 320). */
    min?: number;
    /** A fixed number of equal columns. */
    columns?: number;
    /** A wide main column with a narrower side column (2:1). */
    main?: boolean;
}

/** Responsive grid of cards. */
export function Grid({ children, min = 320, columns, main }: GridProps) {
    const template = main ? 'minmax(0, 2fr) minmax(0, 1fr)'
        : columns ? `repeat(${columns}, minmax(0, 1fr))`
            : `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`;
    return <Box sx={{ display: 'grid', gap: 1.75, gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: template } }}>{children}</Box>;
}

export function Row({ children, gap = 1, align = 'center', ...rest }: { children?: React.ReactNode; gap?: number; align?: string } & Omit<BoxProps, 'children'>) {
    return <Box {...rest} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: align, gap, ...rest.sx as object }}>{children}</Box>;
}

export function Stack({ children, gap = 1 }: { children?: React.ReactNode; gap?: number }) {
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap }}>{children}</Box>;
}

// ── Filters ─────────────────────────────────────────────────────────────

/** The bar of filters at the top of an app. */
export function FilterBar({ children, sticky }: { children?: React.ReactNode; sticky?: boolean }) {
    return (
        <Paper elevation={0} sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px 16px', px: 1.75, py: 1.25,
            border: `1px solid ${BORDER}`, borderRadius: 2, boxShadow: SHADOW,
            ...(sticky ? { position: 'sticky', top: 8, zIndex: 5 } : {}),
        }}>{children}</Paper>
    );
}

/** A labeled control in a FilterBar. */
export function Field({ label, children, grow, width }: { label?: React.ReactNode; children?: React.ReactNode; grow?: boolean; width?: number }) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: width ?? 140, width, flex: grow ? '1 1 200px' : undefined }}>
            {label && <Typography component="span" sx={{ fontSize: 'var(--df-text-sm)', fontWeight: 500 }}>{label}</Typography>}
            {children}
        </Box>
    );
}

interface ControlProps<V> { label?: React.ReactNode; value: V; onChange: (value: V) => void; grow?: boolean; width?: number }

/** A dropdown. `options` are values or {value, label}; pass `allLabel` to add an "all" choice (value ''). */
export function Select({ label, value, onChange, options, allLabel, grow, width, loading }: ControlProps<string | number> & {
    options: Option[]; allLabel?: string; loading?: boolean;
}) {
    const values = options.map(optionValue);
    const current = values.includes(value) || (allLabel !== undefined && value === '') ? value : '';
    return (
        <Field label={label} grow={grow} width={width}>
            <FormControl size="small" fullWidth>
                <MuiSelect value={current} displayEmpty onChange={event => {
                    const raw = event.target.value;
                    onChange(values.find(item => String(item) === String(raw)) ?? raw);
                }} sx={{ bgcolor: 'background.paper' }}>
                    {allLabel !== undefined && <MenuItem value="">{allLabel}</MenuItem>}
                    {loading && options.length === 0 && <MenuItem value="" disabled>Loading…</MenuItem>}
                    {options.map(option => <MenuItem key={String(optionValue(option))} value={optionValue(option)}>{optionLabel(option)}</MenuItem>)}
                </MuiSelect>
            </FormControl>
        </Field>
    );
}

/** Pick several values from a long list, with type-ahead. */
export function MultiSelect({ label, value, onChange, options, placeholder, grow = true, width }: ControlProps<(string | number)[]> & {
    options: Option[]; placeholder?: string;
}) {
    const labels = new Map(options.map(option => [optionValue(option), optionLabel(option)]));
    return (
        <Field label={label} grow={grow} width={width}>
            <Autocomplete multiple size="small" disableCloseOnSelect options={options.map(optionValue)} value={value}
                getOptionLabel={option => String(labels.get(option) ?? option)}
                onChange={(_, next) => onChange(next)}
                renderInput={params => <TextField {...params} placeholder={value.length ? undefined : placeholder} sx={{ bgcolor: 'background.paper' }} />} />
        </Field>
    );
}

/** Toggle chips for choosing several of a few options. */
export function Chips({ label, value, onChange, options, grow, width }: ControlProps<(string | number)[]> & { options: Option[] }) {
    return (
        <Field label={label} grow={grow} width={width}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {options.map(option => {
                    const optionKey = optionValue(option);
                    const selected = value.includes(optionKey);
                    return <Chip key={String(optionKey)} size="small" label={optionLabel(option)} clickable aria-pressed={selected}
                        color={selected ? 'primary' : 'default'} variant={selected ? 'filled' : 'outlined'}
                        onClick={() => onChange(selected ? value.filter(item => item !== optionKey) : [...value, optionKey])} />;
                })}
            </Box>
        </Field>
    );
}

/** Choose one of 2–5 options; the selection is filled. */
export function Segmented({ label, value, onChange, options, grow, width }: ControlProps<string | number> & { options: Option[] }) {
    const theme = useTheme();
    return (
        <Field label={label} grow={grow} width={width}>
            <ToggleButtonGroup exclusive size="small" value={value} onChange={(_, next) => { if (next !== null) onChange(next); }}
                sx={{
                    alignSelf: 'flex-start', bgcolor: 'background.paper', p: '2px', gap: '2px', border: '1px solid rgba(0, 0, 0, 0.18)', borderRadius: 1.5,
                    '& .MuiToggleButton-root': {
                        border: 0, borderRadius: '6px !important', px: 1.25, py: 0.25, minHeight: 26, textTransform: 'none',
                        fontSize: 'var(--df-text-sm)', fontWeight: 500, color: 'text.primary',
                        '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08), color: 'primary.main' },
                        '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 600 },
                    },
                }}>
                {options.map(option => <ToggleButton key={String(optionValue(option))} value={optionValue(option)}>{optionLabel(option)}</ToggleButton>)}
            </ToggleButtonGroup>
        </Field>
    );
}

export interface TabItem { value: string; label: React.ReactNode; content: React.ReactNode }

/** Tabs that switch between views; only the active view is mounted. */
export function Tabs({ items, value, onChange, defaultValue }: { items: TabItem[]; value?: string; onChange?: (value: string) => void; defaultValue?: string }) {
    const [internal, setInternal] = useState(defaultValue ?? items[0]?.value);
    const active = value ?? internal;
    const current = items.find(item => item.value === active) ?? items[0];
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
            <MuiTabs value={current?.value ?? false} onChange={(_, next) => { setInternal(next); onChange?.(next); }}
                sx={{ minHeight: 32, borderBottom: `1px solid ${BORDER}`, '& .MuiTab-root': { minHeight: 32, py: 0.5, textTransform: 'none', fontSize: 'var(--df-text-sm)' } }}>
                {items.map(item => <Tab key={item.value} value={item.value} label={item.label} />)}
            </MuiTabs>
            {current?.content}
        </Box>
    );
}

/** A two-handle range slider; the label shows the formatted range. */
export function RangeSlider({ label, value, onChange, min, max, step = 1, format, grow, width = 220 }: ControlProps<[number, number]> & {
    min: number; max: number; step?: number; format?: (value: number) => string;
}) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const show = format ?? ((number: number) => bridge().format.number(number));
    return (
        <Field label={<>{label}{label ? ': ' : ''}{show(draft[0])} – {show(draft[1])}</>} grow={grow} width={width}>
            <Slider size="small" value={draft} min={min} max={max} step={step} disableSwap
                onChange={(_, next) => setDraft(next as [number, number])}
                onChangeCommitted={(_, next) => onChange(next as [number, number])} sx={{ mx: 1, width: 'auto' }} />
        </Field>
    );
}

/** A text search box; `onChange` fires after typing pauses. */
export function Search({ label, value, onChange, placeholder = 'Search…', delay = 250, grow, width }: ControlProps<string> & {
    placeholder?: string; delay?: number;
}) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    useEffect(() => {
        if (draft === value) return;
        const timer = setTimeout(() => onChange(draft), delay);
        return () => clearTimeout(timer);
    }, [draft, value, onChange, delay]);
    return (
        <Field label={label} grow={grow} width={width}>
            <TextField size="small" type="search" value={draft} placeholder={placeholder}
                onChange={event => setDraft(event.target.value)} sx={{ bgcolor: 'background.paper' }} />
        </Field>
    );
}

// ── Tiles ───────────────────────────────────────────────────────────────

export interface CardProps {
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
    footer?: React.ReactNode;
    /** Content, or a function of the query's rows when `query` is given. */
    children?: React.ReactNode | ((rows: Row[]) => React.ReactNode);
    query?: QueryResult;
    empty?: React.ReactNode;
    /** Placeholder height while loading. */
    height?: number;
    /** Span every column of the surrounding Grid. */
    wide?: boolean;
}

/** A raised tile with a title; renders loading/empty/error states for `query`. */
export function Card({ title, subtitle, actions, footer, children, query, empty, height = 260, wide }: CardProps) {
    const body = query
        ? <QueryView query={query} empty={empty} height={height}>{rows => typeof children === 'function' ? children(rows) : children}</QueryView>
        : typeof children === 'function' ? null : children;
    return (
        <Paper elevation={0} sx={{
            display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0, px: 2, py: 1.75,
            border: `1px solid ${BORDER}`, borderRadius: 2, boxShadow: SHADOW, ...(wide ? { gridColumn: '1 / -1' } : {}),
        }}>
            {(title || subtitle || actions) && (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
                    <Box sx={{ minWidth: 0 }}>
                        {title && <Typography component="h2" sx={{ fontSize: 'var(--df-text-md)', fontWeight: 600, lineHeight: 1.35 }}>{title}</Typography>}
                        {subtitle && <Typography sx={{ fontSize: 'var(--df-text-xs)', color: 'text.secondary' }}>{subtitle}</Typography>}
                    </Box>
                    {actions && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>{actions}</Box>}
                </Box>
            )}
            {body}
            {footer && <Box sx={{ mt: 'auto', pt: 1, borderTop: `1px solid ${BORDER}`, fontSize: 'var(--df-text-xs)', color: 'text.secondary' }}>{footer}</Box>}
        </Paper>
    );
}

/** A Card meant to hold one chart. */
export const ChartCard = Card;

/** A responsive row of KPI tiles. With `query`, children may be a function of its rows. */
export function KpiGrid({ children, query, min = 180 }: { children?: React.ReactNode | ((rows: Row[]) => React.ReactNode); query?: QueryResult; min?: number }) {
    const content = query
        ? <QueryView query={query} height={88}>{rows => <KpiRow min={min}>{typeof children === 'function' ? children(rows) : children}</KpiRow>}</QueryView>
        : <KpiRow min={min}>{typeof children === 'function' ? null : children}</KpiRow>;
    return content;
}

function KpiRow({ children, min }: { children?: React.ReactNode; min: number }) {
    return <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}>{children}</Box>;
}

export interface KpiProps {
    label: React.ReactNode;
    value: React.ReactNode;
    unit?: React.ReactNode;
    /** Change versus a comparison; a number is formatted as +1.2 / −0.4. */
    delta?: number | string | null;
    /** Formats a numeric delta, e.g. (d) => format.percent(d). */
    deltaFormat?: (value: number) => string;
    /** Whether a higher value is good (green) or bad (red). Default 'up'. */
    goodDirection?: 'up' | 'down';
    note?: React.ReactNode;
    /** A small trend line under the value. */
    spark?: { data: Row[]; x: string; y: string };
    /** Accent stripe color; defaults to the primary color. */
    accent?: string;
}

/** A big-number tile. */
export function Kpi({ label, value, unit, delta, deltaFormat, goodDirection = 'up', note, spark, accent }: KpiProps) {
    const theme = useTheme();
    const numericDelta = typeof delta === 'number' && Number.isFinite(delta) ? delta : null;
    const deltaText = numericDelta !== null ? (deltaFormat ?? ((d: number) => bridge().format.delta(d)))(numericDelta)
        : typeof delta === 'string' ? delta : null;
    const good = numericDelta === null || numericDelta === 0 ? null : (numericDelta > 0) === (goodDirection === 'up');
    const tone = good === null ? theme.palette.text.secondary : good ? theme.palette.success.main : theme.palette.error.main;
    return (
        <Paper elevation={0} sx={{
            position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0,
            px: 1.75, pt: 1.25, pb: 1.25, border: `1px solid ${BORDER}`, borderRadius: 2, boxShadow: SHADOW,
            '&::before': { content: '""', position: 'absolute', inset: '0 0 auto 0', height: 3, bgcolor: accent ?? 'primary.main' },
        }}>
            <Typography sx={{ fontSize: 'var(--df-text-xs)', fontWeight: 500, color: 'text.secondary' }}>{label}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 8px' }}>
                <Typography component="span" sx={{ fontSize: 'calc(var(--df-text-xxl) + 4px)', fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.015em', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
                {unit && <Typography component="span" sx={{ fontSize: 'var(--df-text-sm)', fontWeight: 500, color: 'text.secondary' }}>{unit}</Typography>}
                {deltaText && (
                    <Box component="span" sx={{
                        display: 'inline-flex', alignItems: 'center', gap: '3px', alignSelf: 'center', whiteSpace: 'nowrap',
                        px: 0.75, py: '1px', borderRadius: 999, fontSize: 'var(--df-text-xs)', fontWeight: 600, lineHeight: 1.4,
                        fontVariantNumeric: 'tabular-nums', color: tone, bgcolor: alpha(tone, 0.1),
                    }}>
                        {numericDelta !== null && numericDelta !== 0 && <Box component="span" aria-hidden sx={{ fontSize: '0.75em' }}>{numericDelta > 0 ? '▲' : '▼'}</Box>}
                        {deltaText}
                    </Box>
                )}
            </Box>
            {note && <Typography sx={{ fontSize: 'var(--df-text-xxs)', color: 'text.secondary' }}>{note}</Typography>}
            {spark && <Box sx={{ mt: 0.5 }}><Sparkline data={spark.data} x={spark.x} y={spark.y} color={accent} height={30} /></Box>}
        </Paper>
    );
}

/** A highlighted takeaway. */
export function Callout({ title, children, tone = 'info' }: { title?: React.ReactNode; children?: React.ReactNode; tone?: 'info' | 'warning' }) {
    const theme = useTheme();
    const color = tone === 'warning' ? theme.palette.warning.main : theme.palette.primary.main;
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, px: 1.75, py: 1.25, borderLeft: `3px solid ${color}`,
            borderRadius: '0 4px 4px 0', bgcolor: alpha(color, 0.08), fontSize: 'var(--df-text-sm)' }}>
            {title && <Typography component="strong" sx={{ fontSize: 'inherit', fontWeight: 600, color }}>{title}</Typography>}
            <Box>{children}</Box>
        </Box>
    );
}

/** A small label for facts such as coverage or row counts. */
export function Badge({ children, tone = 'default' }: { children?: React.ReactNode; tone?: 'default' | 'primary' }) {
    return <Chip size="small" label={children} color={tone === 'primary' ? 'primary' : 'default'} variant={tone === 'primary' ? 'filled' : 'outlined'}
        sx={{ height: 22, fontSize: 'var(--df-text-xxs)', fontWeight: 500, bgcolor: tone === 'primary' ? undefined : 'background.paper' }} />;
}

// ── Data table ──────────────────────────────────────────────────────────

export interface Column {
    field: string;
    label?: React.ReactNode;
    /** 'number' | 'number:2' | 'compact' | 'percent' | 'delta' | 'date', or a function. */
    format?: string | ((value: any, row: Row) => React.ReactNode);
    align?: 'left' | 'right';
    /** Draw a bar behind the value, scaled to the column maximum. */
    bar?: boolean;
}

const formatValue = (value: unknown, row: Row, spec: Column['format']): React.ReactNode => {
    if (typeof spec === 'function') return spec(value, row);
    if (!spec) return value === null || value === undefined ? '—' : String(value);
    const [kind, digits] = spec.split(':');
    const places = digits === undefined ? undefined : Number(digits);
    const format = bridge().format as unknown as Record<string, (value: unknown, digits?: number) => string>;
    return (format[kind] ?? format.number)(value, places);
};

export interface DataTableProps {
    data?: Row[];
    query?: QueryResult;
    /** Columns to show; defaults to every field of the first row. */
    columns?: Column[];
    maxHeight?: number;
    sortable?: boolean;
    empty?: React.ReactNode;
}

/** A sortable table with formatted numbers, optional in-cell bars, and a row-count note. */
export function DataTable({ data, query, columns, maxHeight = 420, sortable = true, empty }: DataTableProps) {
    if (query) return <QueryView query={query} empty={empty}>{rows => <DataTableBody rows={rows} columns={columns} maxHeight={maxHeight} sortable={sortable}
        total={query.totalRowCount} />}</QueryView>;
    if (!data || data.length === 0) return <Empty>{empty}</Empty>;
    return <DataTableBody rows={data} columns={columns} maxHeight={maxHeight} sortable={sortable} total={data.length} />;
}

function DataTableBody({ rows, columns, maxHeight, sortable, total }: { rows: Row[]; columns?: Column[]; maxHeight: number; sortable: boolean; total: number }) {
    const theme = useTheme();
    const cols = useMemo<Column[]>(() => columns ?? Object.keys(rows[0] ?? {}).map(field => ({ field })), [columns, rows]);
    const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(null);
    const sorted = useMemo(() => {
        if (!sort) return rows;
        const factor = sort.direction === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const left = a[sort.field]; const right = b[sort.field];
            if (left === right) return 0;
            if (left === null || left === undefined) return 1;
            if (right === null || right === undefined) return -1;
            return (left < right ? -1 : 1) * factor;
        });
    }, [rows, sort]);
    const maxima = useMemo(() => Object.fromEntries(cols.filter(col => col.bar).map(col =>
        [col.field, Math.max(...rows.map(row => Math.abs(Number(row[col.field])) || 0), 0)])), [cols, rows]);
    const numeric = (field: string) => rows.some(row => typeof row[field] === 'number');
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
            <TableContainer sx={{ maxHeight, border: `1px solid ${BORDER}`, borderRadius: 1, bgcolor: 'background.paper' }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            {cols.map(col => {
                                const align = col.align ?? (numeric(col.field) ? 'right' : 'left');
                                return (
                                    <TableCell key={col.field} align={align} sx={{ fontSize: 'var(--df-text-xs)', fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                        {sortable ? (
                                            <TableSortLabel active={sort?.field === col.field} direction={sort?.field === col.field ? sort.direction : 'asc'}
                                                onClick={() => setSort(previous => previous?.field === col.field
                                                    ? (previous.direction === 'asc' ? { field: col.field, direction: 'desc' } : null)
                                                    : { field: col.field, direction: numeric(col.field) ? 'desc' : 'asc' })}>
                                                {col.label ?? col.field}
                                            </TableSortLabel>
                                        ) : col.label ?? col.field}
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sorted.map((row, index) => (
                            <TableRow key={index} hover>
                                {cols.map(col => {
                                    const align = col.align ?? (numeric(col.field) ? 'right' : 'left');
                                    const share = col.bar && maxima[col.field] ? Math.abs(Number(row[col.field])) / maxima[col.field] : 0;
                                    return (
                                        <TableCell key={col.field} align={align} sx={{
                                            fontSize: 'var(--df-text-sm)', fontVariantNumeric: 'tabular-nums', whiteSpace: align === 'right' ? 'nowrap' : undefined,
                                            ...(col.bar ? {
                                                backgroundImage: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.16)} ${share * 100}%, transparent 0)`,
                                                backgroundSize: 'calc(100% - 8px) 60%', backgroundPosition: '4px center', backgroundRepeat: 'no-repeat',
                                            } : {}),
                                        }}>{formatValue(row[col.field], row, col.format)}</TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            {total > rows.length && (
                <Typography sx={{ fontSize: 'var(--df-text-xxs)', color: 'text.secondary' }}>
                    Showing {bridge().format.number(rows.length)} of {bridge().format.number(total)} rows
                </Typography>
            )}
        </Box>
    );
}

/** Plain text in DF's muted note style, e.g. sources and caveats. */
export function Note({ children }: { children?: React.ReactNode }) {
    return <Typography sx={{ fontSize: 'var(--df-text-xs)', color: 'text.secondary', maxWidth: '100ch' }}>{children}</Typography>;
}
