// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A `.map.json` file as a still picture, for reports (`![caption](map://files/<name>.map.json)`): drawn
 * offscreen as on the canvas (title, legends, credit; no controls), then captured as a PNG. Street and
 * satellite tiles are left out: they come from another site, which a captured image cannot include.
 */

import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@mui/material';
import html2canvas from 'html2canvas';

import { readWorkspaceTextFile } from '../app/workspaceService';
import { useMapInputs, useMapLook } from './MapPreview';
import { MapView } from './MapView';
import { parseMapSpec } from './spec';

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
}> = ({ path, onImage, onError }) => {
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
        return base && base.view.tiles && base.view.tiles !== 'none' ? { ...base, view: { ...base.view, tiles: 'none' as const } } : base ?? null;
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
    const capture = async () => {
        const element = frame.current;
        if (!element || done.current) return;
        done.current = true;
        try {
            const canvas = await html2canvas(element, {
                scale: 2, backgroundColor: null, logging: false,
                // Drawn unseen; the copy html2canvas paints from is shown.
                onclone: (_document, clone) => { clone.style.opacity = '1'; },
            });
            // A blob URL, like charts' pictures: an edited report keeps its images' URLs in its text.
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('The map could not be captured.');
            onImage({ url: URL.createObjectURL(blob), width: MAP_EMBED_WIDTH, height: MAP_EMBED_HEIGHT });
        } catch (error) {
            onError(message(error));
        }
    };
    // Captured once the map stops redrawing (panels placed, boundaries fitted around them).
    const onDrawn = () => {
        window.clearTimeout(settle.current);
        settle.current = window.setTimeout(capture, SETTLE_MS);
    };

    if (!spec || inputs.loading || inputs.errors.length) return null;
    return createPortal(
        <Box ref={frame} aria-hidden sx={{ position: 'fixed', left: 0, top: 0, width: MAP_EMBED_WIDTH, height: MAP_EMBED_HEIGHT,
            opacity: 0, pointerEvents: 'none', zIndex: -1 }}>
            <MapView spec={spec} data={inputs.data} geoSets={inputs.geoSets} still onDrawn={onDrawn}
                annotations={look.annotations} defaultTheme={look.defaultTheme} />
        </Box>,
        document.body,
    );
};

export default MapSnapshot;
