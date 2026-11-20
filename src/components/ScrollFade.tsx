// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared scroll-edge fade.
 *
 * Long scrollable surfaces — connector forms, the data-loading chat, thread
 * columns — all end in the same soft gradient, so "there is more below" reads
 * identically wherever it appears. One strength, defined once, tuned to stay
 * legible over dense text without hiding the last line.
 *
 * Two ways to use it, because surfaces differ in who owns the scroller:
 *
 *   - `ScrollFadeContainer` owns its scroll element. Use for simple panels.
 *   - `useScrollFade` + `ScrollFadeEdge` attach to a scroller you already own
 *     (one that needs its own ref, scroll handler or imperative scrolling).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, alpha } from '@mui/material';
import { ink } from '../app/tokens';

/** Single source for fade strength across every scrolling surface. */
export const SCROLL_FADE = {
    /** Height of the faded band. */
    height: 56,
    /** Width of the band at a left/right edge, where it covers columns rather than lines. */
    width: 40,
    /** Opacity the gradient reaches at its far edge. */
    endOpacity: 0.96,
    /** Where the gradient becomes effectively opaque. */
    stop: '70%',
    /** Slack before an edge counts as "not at the end". */
    threshold: 8,
} as const;

/** Tracks whether a scroll element has content past each of its edges. */
export function useScrollFade<T extends HTMLElement>(
    ref: React.RefObject<T | null>,
    /** Recompute when this changes (e.g. the surface swaps its content). */
    resetKey?: unknown,
) {
    const [edges, setEdges] = useState({ moreAbove: false, moreBelow: false, moreLeft: false, moreRight: false });

    const update = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const next = {
            moreAbove: el.scrollTop > SCROLL_FADE.threshold,
            moreBelow: el.scrollHeight - el.scrollTop - el.clientHeight > SCROLL_FADE.threshold,
            moreLeft: el.scrollLeft > SCROLL_FADE.threshold,
            moreRight: el.scrollWidth - el.scrollLeft - el.clientWidth > SCROLL_FADE.threshold,
        };
        setEdges(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next])
            ? previous : next);
    }, [ref]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        update();
        if (typeof ResizeObserver === 'undefined') return;
        // Content that grows (streaming text, expanding previews) moves the
        // edge without a scroll event, so observe the children too.
        const observer = new ResizeObserver(update);
        observer.observe(el);
        for (const child of Array.from(el.children)) observer.observe(child);
        return () => observer.disconnect();
    }, [ref, update, resetKey]);

    return { ...edges, update };
}

/**
 * The gradient itself. Render as a sibling of the scroll element, inside a
 * `position: relative` wrapper.
 */
export const ScrollFadeEdge: React.FC<{
    visible: boolean;
    edge?: 'top' | 'bottom' | 'left' | 'right';
}> = ({ visible, edge = 'bottom' }) => (
    <Box
        sx={{
            position: 'absolute',
            [edge]: 0,
            ...(edge === 'left' || edge === 'right'
                ? { top: 0, bottom: 0, width: SCROLL_FADE.width }
                : { left: 0, right: 0, height: SCROLL_FADE.height }),
            pointerEvents: 'none',
            // Outlined input labels sit at z-index 1; the fade must cover them too.
            zIndex: 2,
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.2s ease',
            background: (theme) => {
                const from = alpha(theme.palette.background.paper, 0);
                const to = alpha(theme.palette.background.paper, SCROLL_FADE.endOpacity);
                return `linear-gradient(to ${edge}, ${from}, ${to} ${SCROLL_FADE.stop})`;
            },
        }}
    />
);

/** Scrollable area that owns its scroller and fades both edges. */
export const ScrollFadeContainer: React.FC<{
    children: React.ReactNode;
    sx?: object;
    resetKey?: unknown;
}> = ({ children, sx, resetKey }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const { moreAbove, moreBelow, update } = useScrollFade(scrollRef, resetKey);

    return (
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
            <Box ref={scrollRef} onScroll={update} sx={{ flex: 1, minHeight: 0, overflow: 'auto', ...sx }}>
                {children}
            </Box>
            <ScrollFadeEdge visible={moreAbove} edge="top" />
            <ScrollFadeEdge visible={moreBelow} />
        </Box>
    );
};

/** A sideways scroller (a wide table) that fades its left and right edges while there is more. */
export const HorizontalScrollFade: React.FC<{ children: React.ReactNode; sx?: object }> = ({ children, sx }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const { moreLeft, moreRight, update } = useScrollFade(scrollRef);
    return (
        <Box sx={{ position: 'relative', minWidth: 0 }}>
            <Box ref={scrollRef} onScroll={update} sx={{ overflowX: 'auto', ...sx }}>
                {children}
            </Box>
            <ScrollFadeEdge visible={moreLeft} edge="left" />
            <ScrollFadeEdge visible={moreRight} edge="right" />
        </Box>
    );
};

/** Hides an element's own scrollbar, for a scroller that draws an `OverlayScrollbar` instead. */
export const hiddenScrollbarSx = { scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } } as const;

/** How near the scroller's right edge (px) the pointer brings the overlay thumb up. */
const OVERLAY_REVEAL_ZONE = 24;
/** How long (ms) the thumb stays after scrolling stops. */
const OVERLAY_LINGER = 800;

/**
 * A slim scroll thumb drawn over a scroller whose own scrollbar is hidden (`hiddenScrollbarSx`), for surfaces where
 * a full-height native bar would read as another border (the data thread beside the canvas). It shows while the
 * surface scrolls, when the pointer nears its right edge, and while it is dragged; the edge fades say the rest.
 * Render as a sibling of the scroller, inside a `position: relative` wrapper.
 */
export const OverlayScrollbar: React.FC<{ scrollRef: React.RefObject<HTMLElement | null>; resetKey?: unknown }> = ({ scrollRef, resetKey }) => {
    const [metrics, setMetrics] = useState({ top: 0, height: 0, right: 0, trackTop: 0, trackHeight: 0 });
    const [scrolling, setScrolling] = useState(false);
    const [near, setNear] = useState(false);
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef<{ startY: number; startScroll: number; ratio: number } | null>(null);

    const measure = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const inset = 4;
        const trackHeight = Math.max(0, el.clientHeight - inset * 2);
        const overflow = el.scrollHeight - el.clientHeight;
        if (overflow <= 1 || trackHeight <= 0) { setMetrics(previous => previous.height ? { ...previous, height: 0 } : previous); return; }
        const height = Math.max(28, trackHeight * el.clientHeight / el.scrollHeight);
        const top = (trackHeight - height) * (el.scrollTop / overflow);
        const right = (el.offsetParent as HTMLElement | null)?.clientWidth !== undefined
            ? (el.offsetParent as HTMLElement).clientWidth - (el.offsetLeft + el.offsetWidth) : 0;
        setMetrics({ top, height, right, trackTop: el.offsetTop + inset, trackHeight });
    }, [scrollRef]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        measure();
        let timer: number | undefined;
        const onScroll = () => {
            measure();
            setScrolling(true);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setScrolling(false), OVERLAY_LINGER);
        };
        const onMove = (event: PointerEvent) => {
            const box = el.getBoundingClientRect();
            setNear(box.right - event.clientX <= OVERLAY_REVEAL_ZONE);
        };
        const onLeave = () => setNear(false);
        // Watched on the wrapper, which holds the thumb too, so moving onto the thumb does not count as leaving.
        const zone = el.parentElement ?? el;
        el.addEventListener('scroll', onScroll, { passive: true });
        zone.addEventListener('pointermove', onMove);
        zone.addEventListener('pointerleave', onLeave);
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
        observer?.observe(el);
        for (const child of Array.from(el.children)) observer?.observe(child);
        return () => {
            window.clearTimeout(timer);
            el.removeEventListener('scroll', onScroll);
            zone.removeEventListener('pointermove', onMove);
            zone.removeEventListener('pointerleave', onLeave);
            observer?.disconnect();
        };
    }, [scrollRef, measure, resetKey]);

    if (!metrics.height) return null;
    const shown = scrolling || near || dragging;
    return <Box aria-hidden="true" data-overlay-scrollbar
        onPointerDown={event => {
            const el = scrollRef.current;
            if (!el) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const room = metrics.trackHeight - metrics.height;
            dragRef.current = { startY: event.clientY, startScroll: el.scrollTop, ratio: room > 0 ? (el.scrollHeight - el.clientHeight) / room : 0 };
            setDragging(true);
        }}
        onPointerMove={event => {
            const el = scrollRef.current, drag = dragRef.current;
            if (el && drag) el.scrollTop = drag.startScroll + (event.clientY - drag.startY) * drag.ratio;
        }}
        onPointerUp={() => { dragRef.current = null; setDragging(false); }}
        onPointerCancel={() => { dragRef.current = null; setDragging(false); }}
        sx={{
            // A wider grab area around a slim visible thumb.
            position: 'absolute', zIndex: 3, top: metrics.trackTop + metrics.top, height: metrics.height,
            // Inset from the scroller's edge, so it never sits against a neighbouring border.
            right: metrics.right, width: 14, display: 'flex', justifyContent: 'flex-end', pr: '6px', boxSizing: 'border-box',
            cursor: 'default', touchAction: 'none',
            opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none', transition: 'opacity 0.25s ease',
            '&::after': {
                content: '""', display: 'block', height: '100%', borderRadius: 3,
                width: dragging || near ? 5 : 3, transition: 'width 0.15s ease, background-color 0.15s ease',
                backgroundColor: dragging ? ink(0.38) : near ? ink(0.26) : ink(0.18),
            },
        }} />;
};
