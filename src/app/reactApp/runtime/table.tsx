// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** `DataTable` (from `@df/chart`): a table with formatted numbers, in-cell bars or heat, groups with subtotals. */

import React, { useMemo, useState } from 'react';
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
    const cellText = { fontSize: 'var(--df-text-sm)', fontVariantNumeric: 'tabular-nums' };
    const dataRow = (row: Row, index: number) => (
        <TableRow key={index} hover>
            {cols.map((col, column) => {
                // In a group, the first cell is indented under its header, and blank where it would repeat it.
                if (groupBy && column === 0 && col.field === groupBy) return <TableCell key={col.field} />;
                const align = alignOf(col);
                const share = col.bar && scales[col.field]?.maxAbs ? Math.abs(Number(row[col.field])) / scales[col.field].maxAbs : 0;
                return (
                    <TableCell key={col.field} align={align} sx={{
                        ...cellText, whiteSpace: align === 'right' ? 'nowrap' : undefined, ...heat(col, row[col.field]),
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
    const totalRow = (key: string, label: React.ReactNode, items: Row[], options: { onClick?: () => void; grand?: boolean }) => (
        <TableRow key={key} onClick={options.onClick} sx={{
            bgcolor: alpha(theme.palette.text.primary, options.grand ? 0.06 : 0.035), ...(options.onClick ? { cursor: 'pointer' } : {}),
            '& td': { fontWeight: 600, ...(options.grand ? { borderTop: `1px solid ${BORDER}` } : {}) },
        }}>
            {cols.map((col, index) => {
                const value = columnTotal(items, col);
                return (
                    <TableCell key={col.field} align={index === 0 ? 'left' : alignOf(col)} sx={{ ...cellText, whiteSpace: 'nowrap' }}>
                        {index === 0 ? label : value === undefined ? '' : formatValue(value, {}, col.format)}
                    </TableCell>
                );
            })}
        </TableRow>
    );
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
            <TableContainer sx={{ maxHeight, contain: 'inline-size', border: `1px solid ${BORDER}`, borderRadius: 1, bgcolor: 'background.paper' }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            {cols.map(col => (
                                <TableCell key={col.field} align={alignOf(col)} sx={{ fontSize: 'max(12px, var(--df-text-xs))', fontWeight: 600, color: 'text.secondary', whiteSpace: 'nowrap', bgcolor: 'background.paper' }}>
                                    {sortable ? (
                                        <TableSortLabel active={sort?.field === col.field} direction={sort?.field === col.field ? sort.direction : 'asc'}
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
            </TableContainer>
            {total > rows.length && (
                <Typography sx={{ fontSize: 'max(12px, var(--df-text-xxs))', color: 'text.secondary' }}>
                    Showing {bridge().format.number(rows.length)} of {bridge().format.number(total)} rows
                </Typography>
            )}
        </Box>
    );
}
