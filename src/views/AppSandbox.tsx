// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Host for sandboxed app artifacts (HTML and React). Runs the app document in an
 * opaque-origin iframe inside a container that blocks navigation, serves the
 * app's data queries for the tables its manifest declares, and shows errors with
 * an optional "Ask agent to fix" action.
 */

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
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
import { useLayout } from '../app/LayoutProvider';
import { borderColor, readingTypography } from '../app/tokens';
import { getUrls } from '../app/utils';

const MAX_CONCURRENT_QUERIES = 4;
const MAX_QUEUED_QUERIES = 100;
const MAX_ERRORS = 3;
export const APP_PALETTE = ['#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#eeca3b', '#b279a2', '#ff9da6', '#9d755d', '#bab0ac'];

type QueryJob = { id: number; table: unknown; options: unknown };

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
    /** Errors known before the app runs (e.g. compile errors). */
    initialErrors?: string[];
    reloadKey?: number;
    /** Leave room in the error banner for controls floating over the app. */
    reserveTopRight?: boolean;
    /** Offer "Ask agent to fix" with the current errors. */
    onAskFix?: (errors: string[]) => void;
}

export const AppSandbox: FC<AppSandboxProps> = ({ title, manifest, buildDocument, initialErrors, reloadKey = 0, reserveTopRight = false, onAskFix }) => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLIFrameElement>(null);
    const [containerReady, setContainerReady] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [stopped, setStopped] = useState(false);

    useEffect(() => {
        const containerWindow = containerRef.current?.contentWindow;
        const containerDocument = containerRef.current?.contentDocument;
        setErrors(initialErrors ?? []);
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
        const pump = () => {
            while (!disposed && active < MAX_CONCURRENT_QUERIES && queue.length) {
                const job = queue.shift()!;
                active += 1;
                let request;
                try {
                    request = normalizeAppQuery(job.table, job.options, manifest);
                } catch (error) {
                    active -= 1;
                    // Invalid queries are app bugs; surface them even if the app catches the rejection.
                    reportError(`DF.query: ${(error as Error).message}`);
                    post({ type: 'result', id: job.id, error: (error as Error).message });
                    continue;
                }
                apiRequest<{ rows: unknown; total_row_count?: number }>(getUrls().SAMPLE_TABLE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request),
                })
                    .then(({ data }) => post({
                        type: 'result', id: job.id, rows: stripRowIds(data.rows), totalRowCount: data.total_row_count ?? 0,
                    }))
                    .catch(error => {
                        const message = error instanceof Error ? error.message : 'Query failed';
                        reportError(`DF.query: ${message}`);
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
            } else if (data.type === 'query' && typeof data.id === 'number') {
                if (queue.length >= MAX_QUEUED_QUERIES) {
                    post({ type: 'result', id: data.id, error: t('htmlApp.tooManyQueries') });
                    return;
                }
                queue.push({ id: data.id, table: data.table, options: data.options });
                pump();
            } else if (data.type === 'error') {
                reportError(String(data.message || '').slice(0, 500));
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

    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
            {(errors.length > 0 || stopped) && (
                <Alert severity={stopped ? 'warning' : 'error'}
                    action={!stopped && onAskFix ? <Button color="inherit" size="small" onClick={() => onAskFix(errors)}>{t('htmlApp.askAgentToFix')}</Button> : undefined}
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
                    style={{ display: 'block', border: 0, width: '100%', height: '100%' }} />
            </Box>
        </Box>
    );
};

export default AppSandbox;
