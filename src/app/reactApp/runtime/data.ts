// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** `@df/data`: hooks that read declared workspace tables through the bridge. */

import { useEffect, useState } from 'react';

import { bridge, errorMessage, type QueryOptions, type Row } from './bridge';

export interface QueryResult<T extends Row = Row> {
    rows: T[];
    totalRowCount: number;
    /** True while a request is in flight; rows keep the previous result meanwhile. */
    loading: boolean;
    error: string | null;
    /** More rows matched than were returned (see `limit`). */
    truncated: boolean;
}

const MAX_CACHED = 200;
const cache = new Map<string, Promise<{ rows: Row[]; totalRowCount: number }>>();

function cachedQuery(key: string, table: string, options: QueryOptions | undefined) {
    let request = cache.get(key);
    if (!request) {
        request = bridge().query(table, options);
        cache.set(key, request);
        request.catch(() => cache.delete(key));
        if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
    }
    return request;
}

/** Test hook: forget cached results. */
export const clearQueryCache = () => cache.clear();

/**
 * Query a declared table. Options match `DF.query`; identical requests share one
 * result, and a response that arrives after the options changed is ignored.
 * Pass a falsy table to skip the query.
 */
export function useQuery<T extends Row = Row>(table: string | null | undefined, options?: QueryOptions): QueryResult<T> {
    const key = table ? JSON.stringify([table, options ?? {}]) : '';
    const [state, setState] = useState<{ key: string; rows: Row[]; totalRowCount: number; error: string | null; done: boolean }>(
        { key: '', rows: [], totalRowCount: 0, error: null, done: !table });

    useEffect(() => {
        if (!table) {
            setState({ key, rows: [], totalRowCount: 0, error: null, done: true });
            return;
        }
        let active = true;
        cachedQuery(key, table, options).then(
            result => { if (active) setState({ key, rows: result.rows, totalRowCount: result.totalRowCount, error: null, done: true }); },
            error => { if (active) setState(previous => ({ ...previous, key, error: errorMessage(error), done: true })); },
        );
        return () => { active = false; };
        // `key` captures table and options by value.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    const current = state.key === key && state.done;
    return {
        rows: state.rows as T[],
        totalRowCount: state.totalRowCount,
        loading: !current,
        error: current ? state.error : null,
        truncated: state.totalRowCount > state.rows.length,
    };
}

/** Sorted distinct non-empty values of one column, e.g. for a Select. */
export function useDistinct(table: string | null | undefined, column: string,
    options: { limit?: number; filters?: QueryOptions['filters'] } = {}) {
    const result = useQuery(table, {
        columns: [column], aggregates: [{ op: 'count' }], orderBy: column,
        limit: options.limit ?? 1000, ...(options.filters ? { filters: options.filters } : {}),
    });
    const values = result.rows.map(row => row[column]).filter(value => value !== null && value !== undefined && value !== '');
    return { ...result, values: values as (string | number)[] };
}

/** All rows of a small table (default limit 5000). */
export function useTable<T extends Row = Row>(table: string | null | undefined, options: { limit?: number } = {}) {
    return useQuery<T>(table, { limit: options.limit ?? 5000 });
}
