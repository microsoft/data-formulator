// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import vegaSource from '../../node_modules/vega/build/vega.min.js?raw';
import vegaLiteSource from '../../node_modules/vega-lite/build/vega-lite.min.js?raw';
import runtimeSource from '../app/htmlApp/dfAppRuntime.js?raw';
import {
    APP_SANDBOX,
    CONTAINER_DOCUMENT,
    buildAppDocument,
    normalizeAppQuery,
    parseAppManifest,
    stripRowIds,
    type HtmlAppTheme,
} from '../app/htmlApp/htmlAppDocument';
import { apiRequest } from '../app/apiClient';
import { getUrls } from '../app/utils';

const MAX_CONCURRENT_QUERIES = 4;
const MAX_QUEUED_QUERIES = 100;
const MAX_ERRORS = 3;
const PALETTE = ['#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#eeca3b', '#b279a2', '#ff9da6', '#9d755d', '#bab0ac'];

type QueryJob = { id: number; table: unknown; options: unknown };

const newChannel = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export const HtmlAppPreview: FC<{ html: string; title: string; reloadKey?: number }> = ({ html, title, reloadKey = 0 }) => {
    const { t } = useTranslation();
    const muiTheme = useTheme();
    const containerRef = useRef<HTMLIFrameElement>(null);
    const [containerReady, setContainerReady] = useState(false);
    const [revision, setRevision] = useState(0);
    const [errors, setErrors] = useState<string[]>([]);
    const [stopped, setStopped] = useState(false);
    const manifest = useMemo(() => parseAppManifest(html), [html]);
    const theme = useMemo<HtmlAppTheme>(() => ({
        font: String(muiTheme.typography.fontFamily || 'sans-serif'),
        fontMono: getComputedStyle(document.documentElement).getPropertyValue('--df-font-mono').trim() || 'ui-monospace, monospace',
        text: muiTheme.palette.text.primary,
        muted: muiTheme.palette.text.secondary,
        bg: '#ffffff',
        surface: '#fafafa',
        border: muiTheme.palette.divider,
        primary: muiTheme.palette.primary.main,
        palette: PALETTE,
    }), [muiTheme]);

    useEffect(() => {
        const containerWindow = containerRef.current?.contentWindow;
        const containerDocument = containerRef.current?.contentDocument;
        if (!containerReady || !containerWindow || !containerDocument) return;
        let disposed = false;
        let loads = 0;
        let active = 0;
        const queue: QueryJob[] = [];
        const channel = newChannel();
        setErrors([]);
        setStopped(false);

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
                    .catch(error => post({ type: 'result', id: job.id, error: error instanceof Error ? error.message : 'Query failed' }))
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
        frame.srcdoc = buildAppDocument(html, {
            runtimeScripts: [vegaSource, vegaLiteSource, runtimeSource],
            theme,
            config: { channel, hostOrigin: window.location.origin, manifest, theme },
        });
        containerDocument.body.appendChild(frame);
        return () => {
            disposed = true;
            queue.length = 0;
            containerWindow.removeEventListener('message', onMessage);
            frame.remove();
        };
    }, [containerReady, html, manifest, theme, title, revision, reloadKey, t]);

    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff' }}>
            {(errors.length > 0 || stopped) && (
                <Alert severity={stopped ? 'warning' : 'error'} sx={{ flexShrink: 0, borderRadius: 0, '& .MuiAlert-message': { minWidth: 0 } }}
                    action={<Button color="inherit" size="small" onClick={() => setRevision(value => value + 1)}>{t('htmlApp.reload')}</Button>}>
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

export default HtmlAppPreview;
