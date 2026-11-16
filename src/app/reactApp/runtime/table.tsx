// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** `DataTable` (from `@df/chart`): a table with formatted numbers, in-cell bars or heat, groups with subtotals. */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
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
import { Empty, QueryView } from './states';
import { useSize } from './board';

const BORDER = 'var(--df-rule, rgba(0, 0, 0, 0.12))';

export interface Column {
    field: string;
    label?: React.ReactNode;
    /** 'number' | 'number:2' | 'compact' | 'percent' | 'delta' | 'date', or a function. */
    format?: string | ((value: any, row: Row) => React.ReactNode);
    align?: 'left' | 'right';
    /** Draw a bar behind the value, scaled to the column maximum. */
    bar?: boolean;
    /** Tint the cell by its value (a heat map): stronger for larger values; red/green around zero when the column has negatives. */
    heat?: boolean;
    /** The column's value in group rows and the total row: 'sum', 'avg', 'min', 'max', 'count', or a function of the rows. */
    total?: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((rows: Row[]) => unknown);
}

const columnTotal = (rows: Row[], column: Column): unknown => {
    const { total } = column;
    if (!total) return undefined;
    if (typeof total === 'function') return total(rows);
    if (total === 'count') return rows.length;
    const values = rows.map(row => row[column.field]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (!values.length) return undefined;
    if (total === 'sum') return values.reduce((a, b) => a + b, 0);
    if (total === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
    return total === 'min' ? Math.min(...values) : Math.max(...values);
};

export const formatValue = (value: unknown, row: Row, spec: Column['format']): React.ReactNode => {
    if (typeof spec === 'function') return spec(value, row);
    if (!spec) return value === null || value === undefined ? '—' : String(value);
    const [kind, digits] = spec.split(':');
    const places = digits === undefined ? undefined : Number(digits);
    const format = bridge().format as unknown as Record<string, (value: unknown, digits?: number) => string>;
    return (format[kind] ?? format.number)(value, places);
};

/** A table on its side: the first column's values head the columns, and each other column is a row. */
function TurnedTable({ cols, rows, cellText, held }: { cols: Column[]; rows: Row[]; cellText: Record<string, unknown>; held: Record<string, unknown> }) {
    const { head, body } = turnTable(cols, rows);
    const headText = { fontSize: 'max(12px, var(--df-text-xs))', fontWeight: 600, color: 'text.secondary', lineHeight: 1.3, verticalAlign: 'bottom' };
    return (
        <Table size="small" data-table-turned>
            <TableHead>
                <TableRow>
                    {head.map((cell, index) => (
                        <TableCell key={index} align={index === 0 ? 'left' : 'right'} sx={{ ...cellText, ...headText, ...(index ? { color: 'text.primary' } : held) }}>{cell}</TableCell>
                    ))}
                </TableRow>
            </TableHead>
            <TableBody>
                {body.map((row, index) => (
                    <TableRow key={index} hover>
                        <TableCell sx={{ ...cellText, ...headText, verticalAlign: 'middle', ...held }}>{row.label}</TableCell>
                        {row.cells.map((cell, column) => (
                            <TableCell key={column} align={row.align} sx={{ ...cellText, whiteSpace: 'nowrap' }}>{cell}</TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

export interface DataTableProps {
    data?: Row[];
    query?: QueryResult;
    /** Columns to show; defaults to every field of the first row. */
    columns?: Column[];
    maxHeight?: number;
    sortable?: boolean;
    empty?: React.ReactNode;
    /** Group rows under a header row per value of this field, with each column's `total`; click a header to fold it. */
    groupBy?: string;
    /** Start with the groups folded. */
    collapsed?: boolean;
}

/** A sortable table with formatted numbers, in-cell bars or heat, optional groups with subtotals, and a row-count note. */
export function DataTable({ data, query, columns, maxHeight = 420, sortable = true, empty, groupBy, collapsed }: DataTableProps) {
    const options = { columns, maxHeight, sortable, groupBy, collapsed };
    if (query) return <QueryView query={query} empty={empty}>{rows => <DataTableBody rows={rows} total={query.totalRowCount} {...options} />}</QueryView>;
    if (!data || data.length === 0) return <Empty>{empty}</Empty>;
    return <DataTableBody rows={data} total={data.length} {...options} />;
}

/**
 * How a table fits its box, tried in turn until it does: as laid out; `tight` (headings wrap, cells closer);
 * `turned` (a table of a few rows on its side: its columns as rows); `small` (smaller type); then `scroll`
 * (sideways, the first column held). A table that was turned stays turned when it gets smaller or scrolls.
 */
const FITS = ['natural', 'tight', 'turned', 'small', 'scroll'] as const;
type Fit = typeof FITS[number];
/** A table this short (in rows) and this wide (in columns) reads as well on its side. */
const TURN_ROWS = 4;
/** A table this much taller than its box tightens its rows to show them all rather than scroll. */
const SQUEEZE = 1.35;

/** A table of a few rows on its side: one row per column after the first, one column per row (named by its first cell). */
export function turnTable(cols: Column[], rows: Row[]): { head: React.ReactNode[]; body: { label: React.ReactNode; cells: React.ReactNode[]; align: 'left' | 'right' }[] } {
    const [first, ...rest] = cols;
    return {
        head: [first.label ?? first.field, ...rows.map(row => formatValue(row[first.field], row, first.format))],
        body: rest.map(col => ({
            label: col.label ?? col.field,
            cells: rows.map(row => formatValue(row[col.field], row, col.format)),
            align: col.align ?? (rows.some(row => typeof row[col.field] === 'number') ? 'right' : 'left'),
        })),
    };
}

type DataTableBodyProps = Pick<DataTableProps, 'columns' | 'groupBy' | 'collapsed'> & { rows: Row[]; maxHeight: number; sortable: boolean; total: number };

function DataTableBody({ rows, columns, maxHeight, sortable, total, groupBy, collapsed = false }: DataTableBodyProps) {
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
    // Groups keep the order their first rows come in; a sort orders the rows within each group.
    const groups = useMemo(() => {
        if (!groupBy) return null;
        const byKey = new Map<string, { value: unknown; rows: Row[] }>();
        for (const row of rows) {
            const key = String(row[groupBy]);
            if (!byKey.has(key)) byKey.set(key, { value: row[groupBy], rows: [] });
        }
        for (const row of sorted) byKey.get(String(row[groupBy]))!.rows.push(row);
        return [...byKey.entries()];
    }, [rows, sorted, groupBy]);
    const [folded, setFolded] = useState<Set<string>>(() => new Set(collapsed && groups ? groups.map(([key]) => key) : []));
    const toggle = (key: string) => setFolded(previous => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const scales = useMemo(() => Object.fromEntries(cols.filter(col => col.bar || col.heat).map(col => {
        const values = rows.map(row => Number(row[col.field])).filter(Number.isFinite);
        return [col.field, { maxAbs: Math.max(0, ...values.map(Math.abs)), min: Math.min(...values), max: Math.max(...values), signed: values.some(value => value < 0) }];
    })), [cols, rows]);
    const numeric = (field: string) => rows.some(row => typeof row[field] === 'number');
    const alignOf = (col: Column) => col.align ?? (numeric(col.field) ? 'right' : 'left');
    const hasTotals = cols.some(col => col.total);
    const heat = (col: Column, value: unknown) => {
        const scale = scales[col.field];
        const number = Number(value);
        if (!col.heat || !scale || value === null || value === undefined || !Number.isFinite(number)) return {};
        const share = scale.signed ? Math.abs(number) / (scale.maxAbs || 1) : (number - scale.min) / ((scale.max - scale.min) || 1);
        const color = scale.signed ? (number < 0 ? theme.palette.error.main : theme.palette.success.main) : theme.palette.primary.main;
        return { bgcolor: alpha(color, 0.04 + 0.42 * share) };
    };
    // Fit the box: escalate one step per layout until nothing overflows (before the first paint), and start over
    // when the box, the columns, or the rows change.
    const outerRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const width = useSize(outerRef).width;
    const canTurn = !groupBy && !hasTotals && rows.length > 0 && rows.length <= TURN_ROWS && cols.length > rows.length + 1;
    const fitKey = `${width}|${cols.map(col => col.field).join(',')}|${rows.length}|${maxHeight}|${folded.size}`;
    // Tighter rows are tried once, when the table is a little too tall, and kept only if they make it fit.
    const [fitted, setFitted] = useState<{ key: string; fit: Fit; rows: 'normal' | 'dense' | 'tried' }>({ key: '', fit: 'natural', rows: 'normal' });
    const fit = fitted.key === fitKey ? fitted.fit : 'natural';
    const rowFit = fitted.key === fitKey ? fitted.rows : 'normal';
    const dense = rowFit === 'dense';
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!box || !width) return;
        let next = { key: fitKey, fit, rows: rowFit };
        const tall = box.scrollHeight - box.clientHeight > 1;
        if (box.scrollWidth - box.clientWidth > 1 && fit !== 'scroll') {
            const step = FITS.indexOf(fit) + 1;
            next = { ...next, fit: FITS[step] === 'turned' && !canTurn ? 'small' : FITS[step] };
        } else if (rowFit === 'normal' && tall && box.scrollHeight <= box.clientHeight * SQUEEZE) {
            next = { ...next, rows: 'dense' };
        } else if (rowFit === 'dense' && tall) {
            next = { ...next, rows: 'tried' };
        }
        if (next.key !== fitted.key || next.fit !== fitted.fit || next.rows !== fitted.rows) setFitted(next);
    });
    const tight = fit !== 'natural';
    const small = fit === 'small' || fit === 'scroll';
    const turned = canTurn && FITS.indexOf(fit) >= FITS.indexOf('turned');
    const cellPad = {
        ...(dense ? { py: '2px', lineHeight: 1.3 } : {}),
        ...(tight ? { px: small ? '4px' : '6px' } : {}),
        ...(small ? { fontSize: 'max(12px, var(--df-text-xs))' } : {}),
    };
    const cellText = { fontSize: 'var(--df-text-sm)', fontVariantNumeric: 'tabular-nums', ...cellPad };
    // A short value without spaces (a date, a code) is one token: it never breaks, even at a hyphen.
    const token = (value: unknown) => typeof value === 'string' && value.length <= 24 && !/\s/.test(value);
    // A held first column when the table scrolls sideways; shadows at the edges where there is more to scroll to.
    // Its own (opaque) paper hides what scrolls beneath; it takes the row's hover tint on top of that paper.
    const hover = theme.palette.action.hover;
    const held = fit === 'scroll' ? {
        position: 'sticky' as const, left: 0, zIndex: 1, bgcolor: 'background.paper',
        '.MuiTableRow-hover:hover > &': { backgroundImage: `linear-gradient(${hover}, ${hover})` },
    } : {};
    const dataRow = (row: Row, index: number) => (
        <TableRow key={index} hover>
            {cols.map((col, column) => {
                // In a group, the first cell is indented under its header, and blank where it would repeat it.
                if (groupBy && column === 0 && col.field === groupBy) return <TableCell key={col.field} />;
                const align = alignOf(col);
                // A formatted value (a date, an amount) is one token: it never breaks across lines.
                const atomic = align === 'right' || typeof col.format === 'string' || token(row[col.field]);
                const share = col.bar && scales[col.field]?.maxAbs ? Math.abs(Number(row[col.field])) / scales[col.field].maxAbs : 0;
                return (
                    <TableCell key={col.field} align={align} sx={{
                        ...cellText, whiteSpace: atomic ? 'nowrap' : undefined, ...heat(col, row[col.field]),
                        ...(column === 0 ? held : {}),
                        ...(groupBy && column === 0 ? { pl: 3.5 } : {}),
                        ...(col.bar ? {
                            backgroundImage: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.16)} ${share * 100}%, transparent 0)`,
                            backgroundSize: 'calc(100% - 8px) 60%', backgroundPosition: '4px center', backgroundRepeat: 'no-repeat',
                        } : {}),
                    }}>{formatValue(row[col.field], row, col.format)}</TableCell>
                );
            })}
        </TableRow>
    );
    const firstTotal = cols.findIndex((col, index) => index > 0 && col.total);
    const labelSpan = firstTotal < 0 ? cols.length : firstTotal;
    const totalRow = (key: string, label: React.ReactNode, items: Row[], options: { onClick?: () => void; grand?: boolean }) => (
        <TableRow key={key} onClick={options.onClick} sx={{
            bgcolor: alpha(theme.palette.text.primary, options.grand ? 0.06 : 0.035), ...(options.onClick ? { cursor: 'pointer' } : {}),
            '& td': { fontWeight: 600, ...(options.grand ? { borderTop: `1px solid ${BORDER}` } : {}) },
        }}>
            {/* The label spans the columns after it that have no total, so it never widens the first column alone. */}
            <TableCell colSpan={labelSpan} sx={{ ...cellText, whiteSpace: 'nowrap', ...held }}>{label}</TableCell>
            {cols.slice(labelSpan).map(col => {
                const value = columnTotal(items, col);
                return (
                    <TableCell key={col.field} align={alignOf(col)} sx={{ ...cellText, whiteSpace: 'nowrap' }}>
                        {value === undefined ? '' : formatValue(value, {}, col.format)}
                    </TableCell>
                );
            })}
        </TableRow>
    );
    return (
        <Box ref={outerRef} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
            <TableContainer ref={boxRef} data-table-fit={fit} data-table-dense={dense || undefined}
                sx={{ maxHeight, contain: 'inline-size', border: `1px solid ${BORDER}`, borderRadius: 1, bgcolor: 'background.paper' }}>
                {turned ? <TurnedTable cols={cols} rows={sorted} cellText={cellText} held={held} /> : (
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            {cols.map((col, index) => (
                                <TableCell key={col.field} align={alignOf(col)} sx={{ fontSize: 'max(12px, var(--df-text-xs))', fontWeight: 600, color: 'text.secondary',
                                    whiteSpace: tight ? 'normal' : 'nowrap', lineHeight: 1.3, verticalAlign: 'bottom', bgcolor: 'background.paper', ...cellPad,
                                    ...(index === 0 ? { ...held, zIndex: 3 } : {}) }}>
                                    {sortable ? (
                                        <TableSortLabel active={sort?.field === col.field} direction={sort?.field === col.field ? sort.direction : 'asc'}
                                            // The arrow shows on the sorted column only, so no heading keeps room for one.
                                            sx={sort?.field === col.field ? undefined : { '& .MuiTableSortLabel-icon': { display: 'none' }, '&:hover': { color: 'text.primary' } }}
                                            onClick={() => setSort(previous => previous?.field === col.field
                                                ? (previous.direction === 'asc' ? { field: col.field, direction: 'desc' } : null)
                                                : { field: col.field, direction: numeric(col.field) ? 'desc' : 'asc' })}>
                                            {col.label ?? col.field}
                                        </TableSortLabel>
                                    ) : col.label ?? col.field}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {groups ? groups.map(([key, group]) => (
                            <React.Fragment key={key}>
                                {totalRow(`group-${key}`, (
                                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                        <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 10, fontSize: '0.7em', color: 'text.secondary',
                                            transform: folded.has(key) ? 'none' : 'rotate(90deg)', transition: 'transform 120ms' }}>▶</Box>
                                        {String(group.value ?? '—')}
                                        <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>({group.rows.length})</Box>
                                    </Box>
                                ), group.rows, { onClick: () => toggle(key) })}
                                {!folded.has(key) && group.rows.map(dataRow)}
                            </React.Fragment>
                        )) : sorted.map(dataRow)}
                        {hasTotals && totalRow('total', 'Total', rows, { grand: true })}
                    </TableBody>
                </Table>
                )}
            </TableContainer>
            {total > rows.length && (
                <Typography sx={{ fontSize: 'max(12px, var(--df-text-xxs))', color: 'text.secondary' }}>
                    Showing {bridge().format.number(rows.length)} of {bridge().format.number(total)} rows
                </Typography>
            )}
        </Box>
    );
}
