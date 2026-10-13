// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Typed access to what the sandbox host provides: the `DF` bridge (installed by
 * dfAppRuntime.js before this runtime loads) and the app config.
 */

import type { FieldSemanticsInfo } from '../../../components/ComponentType';

export type Row = Record<string, any>;

export interface QueryOptions {
    columns?: string[];
    aggregates?: { op: 'count' | 'sum' | 'avg' | 'min' | 'max'; field?: string }[];
    filters?: Record<string, unknown>[];
    search?: string;
    orderBy?: string | string[] | { field: string; descending?: boolean }[];
    descending?: boolean;
    limit?: number;
    offset?: number;
}

/** A live connected-source query, in the data-loading shape (see data_operations/models.py LoadQuery). */
export interface SourceQuery {
    filters?: { column: string; op: string; value?: unknown }[];
    columns?: string[];
    group_by?: string[];
    aggregates?: { op: 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max'; column?: string; as: string }[];
    order_by?: { column: string; dir?: 'asc' | 'desc' }[];
    limit?: number;
    native?: { language: string; text: string };
}

export interface DfFormat {
    number(value: unknown, digits?: number): string;
    compact(value: unknown, digits?: number): string;
    percent(value: unknown, digits?: number): string;
    delta(value: unknown, digits?: number): string;
    date(value: unknown, options?: Intl.DateTimeFormatOptions): string;
}

export interface DfBridge {
    ready: Promise<void>;
    manifest: { version: number; title: string; tables: string[]; sources?: string[] };
    theme: { palette: string[]; primary: string; [key: string]: unknown };
    query(table: string, options?: QueryOptions): Promise<{ rows: Row[]; totalRowCount: number }>;
    sql(sql: string, params?: unknown[], options?: { limit?: number }): Promise<{ rows: Row[]; totalRowCount: number; truncated: boolean }>;
    sourceQuery(source: string, query?: SourceQuery, options?: { limit?: number }): Promise<{ rows: Row[]; totalRowCount: number; truncated: boolean }>;
    chart(target: Element, spec: Record<string, unknown>): Promise<{ finalize(): void }>;
    sparkline(target: Element, rows: Row[], options: { x: string; y: string; color?: string; height?: number }): Promise<{ finalize(): void }>;
    format: DfFormat;
    /** `fatal`: the app cannot render at all (it failed to start or crashed). */
    reportError(message: unknown, fatal?: boolean): void;
}

export interface ReactAppConfig {
    paletteKey?: string;
    /** Field annotations of declared tables, keyed by table then field. */
    semantics?: Record<string, Record<string, FieldSemanticsInfo>>;
}

export const bridge = (): DfBridge => {
    const df = (window as unknown as { DF?: DfBridge }).DF;
    if (!df) throw new Error('The DF bridge is not available.');
    return df;
};

/** Report an error to the host; never throws (reporting must not cause a second error). */
export const reportError = (message: unknown, fatal = false) => {
    try { (window as unknown as { DF?: DfBridge }).DF?.reportError(message, fatal); } catch { /* the host is gone */ }
};

export const appConfig = (): ReactAppConfig =>
    ((window as unknown as { __DF_APP_CONFIG__?: ReactAppConfig }).__DF_APP_CONFIG__) ?? {};

export const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong';
