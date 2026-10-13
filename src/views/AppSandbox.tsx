// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Host for sandboxed app artifacts (HTML and React). Runs the app document in an
 * opaque-origin iframe inside a container that blocks navigation, serves the
 * app's data queries for the tables its manifest declares, and shows errors with
 * an optional "Ask agent to fix" action: an app that cannot render at all is
 * replaced by a crash page, other errors show in a banner above the running app.
 */

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Alert, Box, Button, Typography } from '@mui/material';
import SentimentDissatisfiedOutlinedIcon from '@mui/icons-material/SentimentDissatisfiedOutlined';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import {
    APP_SANDBOX,
    CONTAINER_DOCUMENT,
    normalizeAppQuery,
    stripRowIds,
    type HtmlAppManifest,
    type HtmlAppTheme,
} from '../app/htmlApp/htmlAppDocument';
import { apiRequest } from '../app/apiClient';
import type { DataFormulatorState } from '../app/dfSlice';
import { useLayout } from '../app/LayoutProvider';
import { borderColor, readingTypography } from '../app/tokens';
import { getUrls } from '../app/utils';

const MAX_CONCURRENT_QUERIES = 4;
const MAX_QUEUED_QUERIES = 100;
const MAX_ERRORS = 3;
export const APP_PALETTE = ['#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#eeca3b', '#b279a2', '#ff9da6', '#9d755d', '#bab0ac'];

type QueryJob =
    | { kind: 'query'; id: number; table: unknown; options: unknown }
    | { kind: 'sql'; id: number; sql: unknown; params: unknown; options: unknown }
    | { kind: 'source'; id: number; source: unknown; query: unknown; options: unknown };

/** A connected source an app declared, as the backend addresses it. */
export type AppSource = { connectorId: string; tableKey: string };

const requestLimit = (options: unknown): number | undefined => {
    const limit = options && typeof options === 'object' ? (options as { limit?: unknown }).limit : undefined;
    return typeof limit === 'number' && Number.isInteger(limit) ? limit : undefined;
};

const newChannel = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

/** DF's design tokens for apps, following the active palette and density. */
export function useAppTheme(): HtmlAppTheme {
    const muiTheme = useTheme();
    const { density, tokens } = useLayout();
    return useMemo<HtmlAppTheme>(() => {
        const palette = muiTheme.palette as unknown as Record<string, { main: string; bgcolor?: string; textColor?: string }>;
        return {
            font: readingTypography.fontFamily,
            fontMono: getComputedStyle(document.documentElement).getPropertyValue('--df-font-mono').trim() || 'ui-monospace, monospace',
            text: muiTheme.palette.text.primary,
            muted: muiTheme.palette.text.secondary,
            bg: '#ffffff',
            canvas: '#f6f7f9',
            surface: '#ffffff',
            border: borderColor.divider,
            primary: muiTheme.palette.primary.main,
            primarySoft: palette.primary.bgcolor ?? alpha(muiTheme.palette.primary.main, 0.1),
            primaryText: palette.primary.textColor ?? muiTheme.palette.primary.main,
            secondary: muiTheme.palette.secondary.main,
            accent: palette.custom?.main ?? muiTheme.palette.secondary.main,
            positive: muiTheme.palette.success.main,
            negative: muiTheme.palette.error.main,
            warning: muiTheme.palette.warning.main,
            textSize: { xxs: tokens.text.xxs, xs: tokens.text.xs, sm: tokens.text.sm, md: tokens.text.md, lg: tokens.text.lg, xl: tokens.text.xl, xxl: tokens.text.xxl },
            palette: APP_PALETTE,
        };
        // Tokens only change with density; the object identity changes on every resize.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [muiTheme, density]);
}

export interface AppSandboxProps {
    title: string;
    manifest: HtmlAppManifest;
    /** Build the app document for a bridge channel; null when the app cannot run. */
    buildDocument: ((channel: string) => string) | null;
    /** Errors known before the app runs (e.g. compile errors); the app cannot render. */
    initialErrors?: string[];
    reloadKey?: number;
    /** Leave room in the error banner for controls floating over the app. */
    reserveTopRight?: boolean;
    /** Offer "Ask agent to fix" with the current errors. */
    onAskFix?: (errors: string[]) => void;
    /** Resolve a source the app declared (an external reference id) for live queries. */
    resolveSource?: (source: string) => AppSource | undefined;
}

export const AppSandbox: FC<AppSandboxProps> = ({ title, manifest, buildDocument, initialErrors, reloadKey = 0, reserveTopRight = false, onAskFix,
    resolveSource }) => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLIFrameElement>(null);
    const [containerReady, setContainerReady] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [stopped, setStopped] = useState(false);
    // The app cannot render at all: it did not compile, failed to start, or crashed.
    const [fatal, setFatal] = useState(false);
    const [askedFix, setAskedFix] = useState(false);
    // Read when a query runs, so a change to the session's sources does not reload the app.
    const resolveSourceRef = useRef(resolveSource);
    resolveSourceRef.current = resolveSource;
    useEffect(() => {
        const containerWindow = containerRef.current?.contentWindow;
        const containerDocument = containerRef.current?.contentDocument;
        setErrors(initialErrors ?? []);
        setFatal(!!initialErrors?.length);
        setAskedFix(false);
        setStopped(false);
        if (!containerReady || !containerWindow || !containerDocument || !buildDocument) return;
        let disposed = false;
        let loads = 0;
        let active = 0;
        const queue: QueryJob[] = [];
        const channel = newChannel();

        const frame = containerDocument.createElement('iframe');
        frame.setAttribute('sandbox', APP_SANDBOX);
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('title', manifest.title || title);

        const post = (message: Record<string, unknown>) => {
            if (!disposed) frame.contentWindow?.postMessage({ dfApp: channel, ...message }, '*');
        };
        const reportError = (message: string) => {
            if (!disposed) setErrors(current => current.includes(message) ? current : [...current, message].slice(-MAX_ERRORS));
        };
        /** Validate a job against the manifest and turn it into an API request; throws for app bugs. */
        const toRequest = (job: QueryJob): { label: string; url: string; body: unknown } => {
            if (job.kind === 'query') {
                return { label: 'DF.query', url: getUrls().SAMPLE_TABLE, body: normalizeAppQuery(job.table, job.options, manifest) };
            }
            if (job.kind === 'sql') {
                if (typeof job.sql !== 'string' || !job.sql.trim()) throw new Error('Pass the SQL text to run.');
                if (!manifest.tables.length) throw new Error('Declare the tables the SQL reads in the app manifest.');
                if (!Array.isArray(job.params) || job.params.length > 100) throw new Error('params must be a list of at most 100 values.');
                return { label: 'DF.sql', url: getUrls().APP_SQL, body: {
                    tables: manifest.tables, sql: job.sql, params: job.params, limit: requestLimit(job.options) } };
            }
            const declared = typeof job.source === 'string' && (manifest.sources ?? []).includes(job.source);
            const target = declared ? resolveSourceRef.current?.(job.source as string) : undefined;
            if (!declared) throw new Error(`Source "${String(job.source)}" is not declared in the app manifest.`);
            if (!target) throw new Error(`Source "${String(job.source)}" is not connected in this session.`);
            return { label: 'DF.sourceQuery', url: getUrls().APP_SOURCE_QUERY, body: {
                connector_id: target.connectorId, table_key: target.tableKey, query: job.query ?? {}, limit: requestLimit(job.options) } };
        };
        const pump = () => {
            while (!disposed && active < MAX_CONCURRENT_QUERIES && queue.length) {
                const job = queue.shift()!;
                active += 1;
                let request: ReturnType<typeof toRequest>;
                try {
                    request = toRequest(job);
                } catch (error) {
                    active -= 1;
                    // Invalid queries are app bugs; surface them even if the app catches the rejection.
                    const label = job.kind === 'query' ? 'DF.query' : job.kind === 'sql' ? 'DF.sql' : 'DF.sourceQuery';
                    reportError(`${label}: ${(error as Error).message}`);
                    post({ type: 'result', id: job.id, error: (error as Error).message });
                    continue;
                }
                apiRequest<{ rows: unknown; total_row_count?: number; truncated?: boolean }>(request.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request.body),
                })
                    .then(({ data }) => {
                        const rows = stripRowIds(data.rows);
                        post({ type: 'result', id: job.id, rows, totalRowCount: data.total_row_count ?? (Array.isArray(rows) ? rows.length : 0),
                            ...(data.truncated !== undefined ? { truncated: data.truncated } : {}) });
                    })
                    .catch(error => {
                        const message = error instanceof Error ? error.message : 'Query failed';
                        reportError(`${request.label}: ${message}`);
                        post({ type: 'result', id: job.id, error: message });
                    })
                    .finally(() => { active -= 1; pump(); });
            }
        };
        const onMessage = (event: MessageEvent) => {
            if (disposed || event.source !== frame.contentWindow) return;
            const data = event.data;
            if (!data || typeof data !== 'object' || data.dfApp !== channel) return;
            if (data.type === 'hello') {
                post({ type: 'init' });
            } else if ((data.type === 'query' || data.type === 'sql' || data.type === 'source') && typeof data.id === 'number') {
                if (queue.length >= MAX_QUEUED_QUERIES) {
                    post({ type: 'result', id: data.id, error: t('htmlApp.tooManyQueries') });
                    return;
                }
                queue.push(data.type === 'query' ? { kind: 'query', id: data.id, table: data.table, options: data.options }
                    : data.type === 'sql' ? { kind: 'sql', id: data.id, sql: data.sql, params: data.params, options: data.options }
                    : { kind: 'source', id: data.id, source: data.source, query: data.query, options: data.options });
                pump();
            } else if (data.type === 'error') {
                reportError(String(data.message || '').slice(0, 500));
                if (data.fatal === true && !disposed) setFatal(true);
            }
        };
        frame.addEventListener('load', () => {
            loads += 1;
            // A second load means the app navigated; navigation away is blocked
            // by the container CSP, so stop serving data to whatever loaded.
            if (loads > 1 && !disposed) {
                disposed = true;
                frame.remove();
                setStopped(true);
            }
        });
        containerWindow.addEventListener('message', onMessage);
        frame.srcdoc = buildDocument(channel);
        containerDocument.body.appendChild(frame);
        return () => {
            disposed = true;
            queue.length = 0;
            containerWindow.removeEventListener('message', onMessage);
            frame.remove();
        };
    }, [containerReady, buildDocument, initialErrors, manifest, title, reloadKey, t]);

    const askFix = onAskFix && !askedFix ? () => { setAskedFix(true); onAskFix(errors); } : undefined;
    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
            {!fatal && (errors.length > 0 || stopped) && (
                <Alert severity={stopped ? 'warning' : 'error'}
                    action={!stopped && onAskFix ? <Button color="inherit" size="small" disabled={askedFix} onClick={askFix}>
                        {askedFix ? t('htmlApp.askedAgentToFix', { defaultValue: 'Sent to the agent' }) : t('htmlApp.askAgentToFix')}</Button> : undefined}
                    sx={{ flexShrink: 0, borderRadius: 0, pr: reserveTopRight ? 19 : 2, '& .MuiAlert-message': { minWidth: 0 } }}>
                    {stopped ? t('htmlApp.navigationBlocked') : <>
                        <strong>{t('htmlApp.appError')}</strong>
                        {errors.map(message => <Box key={message} component="div" sx={{ overflowWrap: 'anywhere' }}>{message}</Box>)}
                    </>}
                </Alert>
            )}
            <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
                <iframe ref={containerRef} srcDoc={CONTAINER_DOCUMENT} title={t('htmlApp.frameTitle', { title: manifest.title || title })}
                    onLoad={() => setContainerReady(true)}
                    style={{ display: 'block', border: 0, width: '100%', height: '100%', visibility: fatal ? 'hidden' : 'visible' }} />
                {fatal && (
                    <Box data-app-crash role="alert" sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 4, bgcolor: 'grey.50', color: 'text.secondary', textAlign: 'center' }}>
                        <SentimentDissatisfiedOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                        <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'text.primary' }}>
                            {t('htmlApp.crashTitle', { defaultValue: 'This app couldn\'t be displayed' })}
                        </Typography>
                        <Box sx={{ maxWidth: 560, maxHeight: 160, overflow: 'auto', fontFamily: 'var(--df-font-mono, ui-monospace, monospace)',
                            fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                            {errors.map(message => <Box key={message} component="div">{message}</Box>)}
                        </Box>
                        {onAskFix && <Button variant="contained" size="small" disableElevation disabled={askedFix} onClick={askFix}>
                            {askedFix ? t('htmlApp.askedAgentToFix', { defaultValue: 'Sent to the agent' }) : t('htmlApp.askAgentToFix')}
                        </Button>}
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default AppSandbox;

/** Resolve an app's declared source (an external reference id) to the connector and table the backend reads live. */
export function useAppSourceResolver(): (source: string) => AppSource | undefined {
    const references = useSelector((state: DataFormulatorState) => state.externalTableReferences);
    return useCallback((source: string) => {
        const reference = references.find(item => item.id === source);
        return reference ? { connectorId: reference.connectorId, tableKey: reference.tableKey } : undefined;
    }, [references]);
}
