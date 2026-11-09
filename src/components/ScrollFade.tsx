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
