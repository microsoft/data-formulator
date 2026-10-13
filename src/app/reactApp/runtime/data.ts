// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * `@df/data`: hooks that read data through the host bridge: declared workspace
 * tables (`useQuery`, `useSql`) and declared connected sources, live
 * (`useSourceQuery`). See design-docs/59.
 */

import { useEffect, useState } from 'react';

import { bridge, errorMessage, type QueryOptions, type Row, type SourceQuery } from './bridge';

export interface QueryResult<T extends Row = Row> {
    rows: T[];
    totalRowCount: number;
    /** True while a request is in flight; rows keep the previous result meanwhile. */
    loading: boolean;
    error: string | null;
    /** More rows matched than were returned (see `limit`). */
    truncated: boolean;
}

type Response = { rows: Row[]; totalRowCount: number; truncated?: boolean };

const MAX_CACHED = 200;
const cache = new Map<string, Promise<Response>>();

/** Identical requests share one result while cached. */
function cachedRequest(key: string, run: () => Promise<Response>) {
    let request = cache.get(key);
    if (!request) {
        request = run();
        cache.set(key, request);
        request.catch(() => cache.delete(key));
        if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
    }
    return request;
}

/** Test hook: forget cached results. */
export const clearQueryCache = () => cache.clear();

/** One bridge request as a hook; a falsy key skips it, and a response for an old key is ignored. */
function useBridgeRequest<T extends Row>(key: string, run: () => Promise<Response>): QueryResult<T> {
    const [state, setState] = useState<{ key: string; rows: Row[]; totalRowCount: number; truncated: boolean; error: string | null; done: boolean }>(
        { key: '', rows: [], totalRowCount: 0, truncated: false, error: null, done: !key });

    useEffect(() => {
        if (!key) {
            setState({ key, rows: [], totalRowCount: 0, truncated: false, error: null, done: true });
            return;
        }
        let active = true;
        cachedRequest(key, run).then(
            result => {
                if (active) setState({ key, rows: result.rows, totalRowCount: result.totalRowCount,
                    truncated: result.truncated ?? result.totalRowCount > result.rows.length, error: null, done: true });
            },
            error => { if (active) setState(previous => ({ ...previous, key, error: errorMessage(error), done: true })); },
        );
        return () => { active = false; };
        // `key` captures the request by value.
    }, [key]);

    const current = state.key === key && state.done;
    return {
        rows: state.rows as T[],
        totalRowCount: state.totalRowCount,
        loading: !current,
        error: current ? state.error : null,
        truncated: state.truncated,
    };
}

/**
 * Query a declared table. Options match `DF.query`; identical requests share one
 * result, and a response that arrives after the options changed is ignored.
 * Pass a falsy table to skip the query.
 */
export function useQuery<T extends Row = Row>(table: string | null | undefined, options?: QueryOptions): QueryResult<T> {
    return useBridgeRequest<T>(table ? JSON.stringify(['query', table, options ?? {}]) : '',
        () => bridge().query(table!, options));
}

/**
 * Read-only SQL (DuckDB) over the app's declared workspace tables, referred to by
 * name: `useSql('select region, sum(sales) as sales from orders where year = ? group by 1', [year])`.
 * Use `?` placeholders for values. Returns at most `limit` rows (default 5,000, max 50,000).
 * Pass a falsy sql to skip the query.
 */
export function useSql<T extends Row = Row>(sql: string | null | undefined, params: unknown[] = [],
    options: { limit?: number } = {}): QueryResult<T> {
    return useBridgeRequest<T>(sql ? JSON.stringify(['sql', sql, params, options]) : '',
        () => bridge().sql(sql!, params, options));
}

/**
 * A live query against a connected source the app declared in its manifest
 * `sources`, read at the source when the app runs (not the session's copy):
 * `useSourceQuery('external:kusto:Events', { group_by: ['day'], aggregates: [{ op: 'count', as: 'events' }] })`.
 * The query uses the data-loading shape: filters, columns, group_by, aggregates,
 * order_by, limit, or native `{ language, text }` where the source allows it.
 * Pass a falsy source to skip the query.
 */
export function useSourceQuery<T extends Row = Row>(source: string | null | undefined, query: SourceQuery = {},
    options: { limit?: number } = {}): QueryResult<T> {
    return useBridgeRequest<T>(source ? JSON.stringify(['source', source, query, options]) : '',
        () => bridge().sourceQuery(source!, query, options));
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
