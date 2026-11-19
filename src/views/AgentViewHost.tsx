// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Draws what the agent asked to `view` (the workspace skill's action), as the user sees it, and hands the pictures
 * back: a chart's picture from the chart render service, a map drawn offscreen as for reports, an app run offscreen
 * and captured from inside its frame. The run resumes with them (SimpleChartRecBox).
 */

import React, { FC, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@mui/material';
import { useSelector } from 'react-redux';

import { dfSelectors } from '../app/dfSlice';
import { getCachedChart } from '../app/chartCache';
import { readWorkspaceTextFile } from '../app/workspaceService';
import type { AppCapture } from './AppSandbox';
import type { ViewRequest, ViewResult } from './agentView';
import { renderChartPng } from './ChartRenderService';

const MapSnapshot = React.lazy(() => import('../maps/MapSnapshot'));
const ReactAppPreview = React.lazy(() => import('./ReactAppPreview'));
const HtmlAppPreview = React.lazy(() => import('./HtmlAppPreview'));

/** The size apps are run at for their picture, a laptop window. */
const APP_WIDTH = 1280;
const APP_HEIGHT = 800;
/** A chart's picture counts as current once it has stopped changing for this long. */
const CHART_SETTLE_MS = 800;
const CHART_TIMEOUT_MS = 20_000;
/** Everything is answered by then, drawn or not. */
const VIEW_TIMEOUT_MS = 60_000;
/** Pictures are kept within this size (longest side) and length, so a run's request stays reasonable. */
const MAX_SIDE = 1600;
const MAX_URL_CHARS = 3_000_000;
/** Sharper pictures (a `scale`, for sharing) are kept within this longest side. */
const SHARP_MAX_SIDE = 4800;
/** Maps drawn sharper (for sharing) are drawn larger too, so the map has room beside its title and legends. */
const SHARP_MAP_WIDTH = 960;
const SHARP_MAP_HEIGHT = 640;

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

const toDataUrl = (url: string) => url.startsWith('data:') ? Promise.resolve(url) : fetch(url).then(response => response.blob())
    .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    }));

/** A picture small enough to send: large ones are scaled down and, if still large, saved as JPEG. */
async function fit(url: string): Promise<{ image: string; shrink: number }> {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url; });
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height, 1));
    if (scale === 1 && url.length <= MAX_URL_CHARS) return { image: url, shrink: 1 };
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    return { image: png.length <= MAX_URL_CHARS ? png : canvas.toDataURL('image/jpeg', 0.85), shrink: scale };
}

type Report = (result: Omit<ViewResult, 'path'>) => void;

/** A chart's picture, once the render service has drawn its current version (drawn again at `scale`, if given). */
const ChartShot: FC<{ id: string; report: Report; scale?: number }> = ({ id, report, scale }) => {
    const chart = useSelector(dfSelectors.getAllCharts).find(item => item.id === id);
    const drawable = !!chart && !['Table', 'Auto', '?'].includes(chart.chartType);
    useEffect(() => {
        if (!drawable) {
            report({ error: chart ? `a ${chart.chartType} chart has no picture` : 'the chart is not in the session' });
            return;
        }
        let last: string | undefined;
        let changed = 0;
        // Only time the page is visible counts: a hidden page does not draw.
        let elapsed = 0;
        const timer = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            elapsed += 200;
            const url = getCachedChart(id)?.fullPngDataUrl;
            if (url !== last) { last = url; changed = elapsed; }
            if (url && elapsed - changed >= CHART_SETTLE_MS) {
                window.clearInterval(timer);
                const entry = getCachedChart(id);
                if (!scale || !entry?.spec) { report({ image: url, density: 2 }); return; }
                const sharp = Math.min(scale, SHARP_MAX_SIDE / Math.max(entry.naturalWidth, entry.naturalHeight, 1));
                renderChartPng(entry.spec, sharp).then(image => report({ image, density: sharp }),
                    () => report({ image: url, density: 2 }));
            } else if (elapsed > CHART_TIMEOUT_MS) {
                window.clearInterval(timer);
                report({ error: 'the chart was not drawn (its data may be missing)' });
            }
        }, 200);
        return () => window.clearInterval(timer);
    }, [id, drawable]);
    return null;
};

/** An app, run offscreen at a window's size and captured from inside its frame once it settles. */
const AppShot: FC<{ name: string; report: Report; scale?: number }> = ({ name, report, scale }) => {
    const [source, setSource] = useState<string | null>(null);
    const [script, setScript] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            readWorkspaceTextFile(name).then(file => file.content),
            import('../../node_modules/html-to-image/dist/html-to-image.js?raw').then(module => module.default as string),
        ]).then(([content, library]) => { if (!cancelled) { setSource(content); setScript(library); } },
            error => { if (!cancelled) report({ error: message(error) }); });
        return () => { cancelled = true; };
    }, [name]);
    const capture = useMemo<AppCapture | undefined>(() => script ? {
        script, scale, onImage: image => report({ image, density: scale ?? 1 }), onError: error => report({ error }),
    } : undefined, [script, scale]);
    if (source === null || !capture) return null;
    const preview = name.toLowerCase().endsWith('.html')
        ? <HtmlAppPreview html={source} title={name} capture={capture} />
        : <ReactAppPreview source={source} title={name} capture={capture} />;
    return createPortal(
        <Box aria-hidden sx={{ position: 'fixed', left: 0, top: 0, width: APP_WIDTH, height: APP_HEIGHT,
            opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
            <Suspense fallback={null}>{preview}</Suspense>
        </Box>,
        document.body,
    );
};

/**
 * Draws each item of a view request once, then answers with every result (in the request's order). With a
 * `scale` (pixels per CSS pixel, for sharing) pictures are drawn that sharp and kept larger.
 */
export const AgentViewHost: FC<{ request: ViewRequest; onDone: (results: ViewResult[]) => void; scale?: number }> = ({ request, onDone, scale }) => {
    const [results, setResults] = useState<Record<string, ViewResult>>({});
    const done = useRef(false);
    const reporters = useMemo(() => Object.fromEntries(request.targets.map(target => [target.path, (result: Omit<ViewResult, 'path'>) => {
        const settle = (value: Omit<ViewResult, 'path'>) => setResults(previous => previous[target.path]
            ? previous : { ...previous, [target.path]: { path: target.path, ...value } });
        if (!result.image) settle(result);
        else if (scale) toDataUrl(result.image).then(image => settle({ ...result, image }), error => settle({ error: message(error) }));
        else toDataUrl(result.image).then(fit).then(({ image, shrink }) => settle({ image, ...(result.density ? { density: result.density * shrink } : {}) }),
            error => settle({ error: message(error) }));
    }])) as Record<string, Report>, [request, scale]);
    useEffect(() => {
        // Only time the page is visible counts (a hidden page does not draw).
        let elapsed = 0;
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') elapsed += 500;
            if (elapsed < VIEW_TIMEOUT_MS) return;
            window.clearInterval(timer);
            setResults(previous => Object.fromEntries(request.targets.map(target =>
                [target.path, previous[target.path] ?? { path: target.path, error: 'it did not finish drawing' }])));
        }, 500);
        return () => window.clearInterval(timer);
    }, [request]);
    useEffect(() => {
        if (done.current || !request.targets.every(target => results[target.path])) return;
        done.current = true;
        onDone(request.targets.map(target => results[target.path]));
    }, [results, request, onDone]);
    return <Suspense fallback={null}>
        {request.targets.filter(target => !results[target.path]).map(target => target.kind === 'chart' && target.id
            ? <ChartShot key={target.path} id={target.id} report={reporters[target.path]} scale={scale} />
            : target.kind === 'map'
                ? <MapSnapshot key={target.path} path={target.path} scale={scale ? Math.min(scale, 3) : 2}
                    {...(target.width && target.height ? { width: target.width, height: target.height }
                        : scale ? { width: SHARP_MAP_WIDTH, height: SHARP_MAP_HEIGHT } : {})}
                    fitHeight={target.fitHeight}
                    onImage={image => reporters[target.path]({ image: image.url, density: scale ? Math.min(scale, 3) : 2 })}
                    onError={error => reporters[target.path]({ error })} />
                : <AppShot key={target.path} name={target.name || target.path.replace(/^files\//, '')} report={reporters[target.path]}
                    scale={scale && Math.min(scale, 2)} />)}
    </Suspense>;
};

export default AgentViewHost;
