// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A `.map.json` file as a still picture, for reports (`![caption](files/<name>.map.json)`): drawn
 * offscreen as on the canvas (title, legends, credit; no controls), then captured as a PNG. Street and
 * satellite tiles are left out: they come from another site, which a captured image cannot include.
 */

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@mui/material';
import html2canvas from 'html2canvas';

import { readWorkspaceTextFile } from '../app/workspaceService';
import { useMapInputs, useMapLook } from './MapPreview';
import { MapView, type MapDrawn } from './MapView';
import { parseMapSpec } from './spec';
import { viewStyleName } from './styles';

/** An embedded map's size in a report, in CSS pixels (captured at twice that). */
export const MAP_EMBED_WIDTH = 640;
export const MAP_EMBED_HEIGHT = 400;
/** How long the map must go without redrawing before it is captured. */
const SETTLE_MS = 300;
/** A map that never settles (its data or boundaries never load) gives up. */
const TIMEOUT_MS = 30_000;

export interface MapImage { url: string; width: number; height: number }

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export const MapSnapshot: FC<{
    /** The map's session path, `files/<name>.map.json`. */
    path: string;
    onImage: (image: MapImage) => void;
    onError: (message: string) => void;
    /** Pixels per CSS pixel of the picture (2 by default). */
    scale?: number;
    /** The picture's size in CSS pixels (a report embed's by default). */
    width?: number;
    height?: number;
    /** Shorten the picture to the map: the room the map leaves above and below it (a wide map in a tall frame) is cut. */
    fitHeight?: boolean;
}> = ({ path, onImage, onError, scale = 2, width = MAP_EMBED_WIDTH, height = MAP_EMBED_HEIGHT, fitHeight = false }) => {
    const drawn = useRef<MapDrawn | null>(null);
    const [source, setSource] = useState<string | null>(null);
    const done = useRef(false);
    const fail = (text: string) => {
        if (done.current) return;
        done.current = true;
        onError(text);
    };
    useEffect(() => {
        let cancelled = false;
        readWorkspaceTextFile(path.replace(/^files\//, '')).then(
            file => { if (!cancelled) setSource(file.content); },
            error => { if (!cancelled) fail(message(error)); });
        return () => { cancelled = true; };
    }, [path]);

    const parsed = useMemo(() => source === null ? null : parseMapSpec(source), [source]);
    const spec = useMemo(() => {
        const base = parsed?.spec;
        return base && base.view.tiles && base.view.tiles !== 'none' ? { ...base, view: { ...base.view, style: viewStyleName(base.view), tiles: 'none' as const } } : base ?? null;
    }, [parsed]);
    const inputs = useMapInputs(spec);
    const look = useMapLook(spec);
    useEffect(() => { if (parsed && !parsed.spec) fail(parsed.errors[0] ?? 'Not a map.'); }, [parsed]);
    useEffect(() => { if (spec && !inputs.loading && inputs.errors.length) fail(inputs.errors[0]); }, [spec, inputs]);

    const frame = useRef<HTMLDivElement>(null);
    const settle = useRef<number | undefined>(undefined);
    useEffect(() => {
        // Only time spent visible counts: a hidden page does not lay out or draw, and finishes when shown again.
        let timeout: number | undefined;
        const watch = () => {
            window.clearTimeout(timeout);
            if (document.visibilityState === 'visible') timeout = window.setTimeout(() => fail('The map did not finish drawing.'), TIMEOUT_MS);
        };
        watch();
        document.addEventListener('visibilitychange', watch);
        return () => {
            document.removeEventListener('visibilitychange', watch);
            window.clearTimeout(timeout);
            window.clearTimeout(settle.current);
        };
    }, []);
    /**
     * The rows (CSS pixels) of the picture to keep: the title, the map's own rows, and what is under the map (the
     * legends), leaving out the empty bands a map fitted by its width leaves above and below it. Null keeps all.
     */
    const keptRows = (element: HTMLElement): [number, number][] | null => {
        const bounds = drawn.current?.fittedBounds();
        const view = element.querySelector<HTMLElement>('[data-map-view]');
        if (!bounds || !view) return null;
        const header = element.querySelector<HTMLElement>('[data-map-header]');
        const titleEnd = header ? header.offsetTop + header.offsetHeight + 8 : 0;
        const mapHeight = view.clientHeight;
        const mapTop = Math.max(titleEnd, Math.floor(bounds[1]) - 12);
        const mapBottom = Math.min(mapHeight, Math.ceil(bounds[3]) + 12);
        if (mapBottom <= mapTop || (mapTop - titleEnd) + (mapHeight - mapBottom) < 24) return null;
        return [[0, titleEnd], [mapTop, mapBottom], [mapHeight, element.offsetHeight]];
    };
    /** The picture with only `rows` of it, one under another. */
    const keepRows = (canvas: HTMLCanvasElement, rows: [number, number][]) => {
        const ratio = canvas.width / width;
        const parts = rows.map(([top, bottom]) => [Math.round(top * ratio), Math.round(bottom * ratio)] as const).filter(([top, bottom]) => bottom > top);
        const out = document.createElement('canvas');
        out.width = canvas.width;
        out.height = parts.reduce((sum, [top, bottom]) => sum + bottom - top, 0);
        const context = out.getContext('2d')!;
        let y = 0;
        for (const [top, bottom] of parts) {
            context.drawImage(canvas, 0, top, canvas.width, bottom - top, 0, y, canvas.width, bottom - top);
            y += bottom - top;
        }
        return out;
    };
    const capture = async () => {
        const element = frame.current;
        if (!element || done.current) return;
        done.current = true;
        drawn.current?.drawNow();
        try {
            const rows = fitHeight ? keptRows(element) : null;
            const drawnCanvas = await html2canvas(element, {
                scale, backgroundColor: null, logging: false,
                // Drawn unseen; the copy html2canvas paints from is shown.
                onclone: (_document, clone) => { clone.style.opacity = '1'; },
            });
            const canvas = rows ? keepRows(drawnCanvas, rows) : drawnCanvas;
            // A blob URL, like charts' pictures: an edited report keeps its images' URLs in its text.
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('The map could not be captured.');
            onImage({ url: URL.createObjectURL(blob), width, height: Math.round(canvas.height * width / canvas.width) });
        } catch (error) {
            onError(message(error));
        }
    };
    // Captured once the map stops redrawing (panels placed, boundaries fitted around them).
    const onDrawn = (info: MapDrawn) => {
        drawn.current = info;
        window.clearTimeout(settle.current);
        settle.current = window.setTimeout(capture, SETTLE_MS);
    };

    if (!spec || inputs.loading || inputs.errors.length) return null;
    return createPortal(
        <Box ref={frame} aria-hidden sx={{ position: 'fixed', left: 0, top: 0, width, height,
            opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
            <MapView spec={spec} data={inputs.data} geoSets={inputs.geoSets} still legendBelow onDrawn={onDrawn}
                annotations={look.annotations} defaultTheme={look.defaultTheme} categoryColors={look.categoryColors} />
        </Box>,
        document.body,
    );
};

export default MapSnapshot;
