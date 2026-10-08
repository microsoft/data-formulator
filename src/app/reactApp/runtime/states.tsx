// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Shared loading / empty / error states and small hooks for the app runtime. */

import React, { useRef } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import ErrorOutline from '@mui/icons-material/ErrorOutline';

import type { Row } from './bridge';
import type { QueryResult } from './data';

/**
 * Return the previous reference while the value is structurally unchanged, so
 * inline objects and derived arrays do not re-render charts on every render.
 */
export function useStable<T>(value: T): T {
    const key = JSON.stringify(value) ?? '';
    const ref = useRef({ key, value });
    if (ref.current.key !== key) ref.current = { key, value };
    return ref.current.value;
}

export function Loading({ height = 120 }: { height?: number }) {
    return <Skeleton variant="rounded" animation="wave" height={height} sx={{ bgcolor: 'rgba(0, 0, 0, 0.05)' }} />;
}

export function Empty({ children = 'No data matches the current selection.', height = 120 }: { children?: React.ReactNode; height?: number }) {
    return (
        <Box sx={{
            minHeight: height, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center',
            color: 'text.secondary', fontSize: 'var(--df-text-sm)', border: '1px dashed rgba(0, 0, 0, 0.2)', borderRadius: 2,
        }}>{children}</Box>
    );
}

/**
 * Muted in-place placeholder for a section that failed. The host banner is the
 * one loud alert (with reload / Ask agent to fix), so this stays grey.
 */
export function ErrorState({ error, height = 120, label = 'Data unavailable' }: { error: React.ReactNode; height?: number; label?: React.ReactNode }) {
    const detail = typeof error === 'string' ? error : undefined;
    return (
        <Box role="status" title={detail} sx={{
            minHeight: height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5,
            p: 2, textAlign: 'center', color: 'text.disabled', bgcolor: 'rgba(0, 0, 0, 0.025)',
            border: '1px dashed rgba(0, 0, 0, 0.15)', borderRadius: 2,
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 'var(--df-text-sm)', fontWeight: 500, color: 'text.secondary' }}>
                <ErrorOutline sx={{ fontSize: '1.15em' }} />{label}
            </Box>
            <Box sx={{
                maxWidth: 480, fontSize: 'var(--df-text-xs)', lineHeight: 1.45, overflowWrap: 'anywhere',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{error}</Box>
        </Box>
    );
}

export interface QueryViewProps<T extends Row = Row> {
    query: QueryResult<T>;
    children: (rows: T[]) => React.ReactNode;
    /** Shown when the query returns no rows. */
    empty?: React.ReactNode;
    height?: number;
}

/** Render a query's rows, with loading, empty, and error states handled. */
export function QueryView<T extends Row = Row>({ query, children, empty, height = 120 }: QueryViewProps<T>) {
    if (query.error) return <ErrorState error={query.error} height={height} />;
    if (query.loading && query.rows.length === 0) return <Loading height={height} />;
    if (!query.loading && query.rows.length === 0) return <Empty height={height}>{empty}</Empty>;
    return (
        <Box aria-busy={query.loading || undefined} sx={{ opacity: query.loading ? 0.55 : 1, transition: 'opacity 0.2s ease', minWidth: 0 }}>
            {children(query.rows)}
        </Box>
    );
}
