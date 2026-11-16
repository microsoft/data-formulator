// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * KPIs for `@df/chart`: a number with what it is compared against. `Kpi` shows a label, the value, its change against
 * a previous value (or a target, or an average), coloured by whether the change is good, and an optional sparkline
 * of the value's history; `KpiStrip` lines a few up in one outlined strip. A bare total says little: the comparison
 * and the trend are what make a KPI worth its space.
 */

import React from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import { bridge, type Row } from './bridge';
import { Sparkline } from './chart';
import type { QueryResult } from './data';
import { formatValue } from './table';

export interface KpiProps {
    /** What the number is ("Reports", "Avg. rating"). */
    label: React.ReactNode;
    /** The number; undefined or null while it loads (a placeholder shows). */
    value: number | null | undefined;
    /** How it reads: a DataTable format ('number', 'number:1', 'compact', 'percent', 'percent:1') or a function. */
    format?: string | ((value: unknown) => React.ReactNode);
    /** A unit after the value ("°C", "pts"), set smaller. */
    unit?: React.ReactNode;
    /** The value it is compared with, and what that is ("2020", "last month", "the average"). */
    previous?: number | null;
    vs?: React.ReactNode;
    /** A target to reach: shows the share reached and colours it by whether it is met. */
    target?: number | null;
    /**
     * How the change reads: 'percent' (relative, +12%), 'points' (a difference of shares, +2.1 pts), or 'number'
     * (the difference in the value's own format). Default: points for a percent value, else percent.
     */
    change?: 'percent' | 'points' | 'number';
    /** Whether up is good ('up', default), down is good ('down'), or neither ('none', grey). */
    good?: 'up' | 'down' | 'none';
    /** The value's history for a sparkline: rows (or a query) with its `x` and `y` fields. */
    trend?: Row[] | QueryResult;
    x?: string;
    y?: string;
    /** A short line under it (what it counts, the period). */
    note?: React.ReactNode;
}

const ratio = (value: number, base: number) => (base === 0 ? null : (value - base) / Math.abs(base));

function changeOf(props: KpiProps): { text: string; direction: -1 | 0 | 1; against: React.ReactNode } | null {
    const { value, previous, target, format } = props;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const percentValue = typeof format === 'string' && format.startsWith('percent');
    if (typeof previous === 'number' && Number.isFinite(previous)) {
        const mode = props.change ?? (percentValue ? 'points' : 'percent');
        const difference = value - previous;
        const direction = difference > 0 ? 1 : difference < 0 ? -1 : 0;
        const format_ = bridge().format;
        const relative = ratio(value, previous);
        const text = mode === 'points' ? `${format_.delta((percentValue ? difference * 100 : difference), 1)} pts`
            : mode === 'percent' && relative !== null ? format_.delta(relative * 100, Math.abs(relative) < 0.1 ? 1 : 0) + '%'
            : `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${String(formatValue(Math.abs(difference), {}, typeof format === 'string' ? format : 'number'))}`;
        return { text, direction, against: props.vs ?? null };
    }
    if (typeof target === 'number' && Number.isFinite(target) && target !== 0) {
        const share = value / target;
        const met = (props.good ?? 'up') === 'down' ? value <= target : value >= target;
        return { text: `${bridge().format.percent(share, 0)} of target`, direction: met ? 1 : -1,
            against: props.vs ?? String(formatValue(target, {}, typeof format === 'string' ? format : 'number')) };
    }
    return null;
}

/** One KPI: label, value (and unit), its change against `previous` or `target`, a sparkline of `trend`, and a note. */
export function Kpi(props: KpiProps) {
    const theme = useTheme();
    const { label, value, format = 'number', unit, trend, x, y, note } = props;
    const change = changeOf(props);
    const good = props.good ?? 'up';
    // With a target, `direction` already says whether it is met.
    const tone = !change || change.direction === 0 || good === 'none' ? theme.palette.text.secondary
        : (props.target != null && props.previous == null ? change.direction > 0 : (change.direction > 0) === (good === 'up'))
            ? theme.palette.success.main : theme.palette.error.main;
    const arrow = !change || change.direction === 0 ? '' : change.direction > 0 ? '▲ ' : '▼ ';
    const rows = Array.isArray(trend) ? trend : trend?.rows;
    const loading = value === undefined || (!Array.isArray(trend) && trend?.loading && !trend.rows.length);
    return (
        <Stack data-kpi spacing={0.25} sx={{ flex: 1, minWidth: 0, px: 2, py: 1.5 }}>
            <Typography variant="body2" color="text.secondary" noWrap>{label}</Typography>
            {loading ? <Skeleton variant="text" width="60%" sx={{ fontSize: theme.typography.h4.fontSize }} /> : (
                <Stack direction="row" alignItems="baseline" spacing={0.5} sx={{ minWidth: 0 }}>
                    <Typography variant="h4" fontWeight={600} lineHeight={1.15} sx={{ fontVariantNumeric: 'tabular-nums' }} noWrap>
                        {value === null ? '—' : formatValue(value, {}, format)}
                    </Typography>
                    {unit && <Typography variant="body2" color="text.secondary" noWrap>{unit}</Typography>}
                </Stack>
            )}
            {change && (
                <Typography data-kpi-change variant="caption" noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    <Box component="span" sx={{ color: tone, fontWeight: 600 }}>{arrow}{change.text}</Box>
                    {change.against ? <Box component="span" sx={{ color: 'text.secondary' }}> vs {change.against}</Box> : null}
                </Typography>
            )}
            {rows && rows.length > 1 && x && y && <Box sx={{ pt: 0.5 }}><Sparkline data={rows} x={x} y={y} height={30} /></Box>}
            {/* A note may take two lines; past that it is cut, the whole of it in the tooltip. */}
            {note && <Typography variant="caption" color="text.secondary" title={typeof note === 'string' ? note : undefined}
                sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{note}</Typography>}
        </Stack>
    );
}

/** KPIs side by side in one outlined strip, divided by rules (stacked on a narrow screen). */
export function KpiStrip({ children }: { children: React.ReactNode }) {
    return (
        <Paper variant="outlined" data-kpi-strip>
            <Stack direction={{ xs: 'column', sm: 'row' }} divider={<Divider flexItem orientation="vertical" />}>
                {children}
            </Stack>
        </Paper>
    );
}
