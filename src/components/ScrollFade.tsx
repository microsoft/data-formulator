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
    /** Opacity the gradient reaches at its far edge. */
    endOpacity: 0.96,
    /** Where the gradient becomes effectively opaque. */
    stop: '70%',
    /** Slack before an edge counts as "not at the end". */
    threshold: 8,
} as const;

/** Tracks whether a scroll element has content past its top/bottom edges. */
export function useScrollFade<T extends HTMLElement>(
    ref: React.RefObject<T | null>,
    /** Recompute when this changes (e.g. the surface swaps its content). */
    resetKey?: unknown,
) {
    const [edges, setEdges] = useState({ moreAbove: false, moreBelow: false });

    const update = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        setEdges({
            moreAbove: el.scrollTop > SCROLL_FADE.threshold,
            moreBelow: el.scrollHeight - el.scrollTop - el.clientHeight > SCROLL_FADE.threshold,
        });
    }, [ref]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        update();
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
    edge?: 'top' | 'bottom';
}> = ({ visible, edge = 'bottom' }) => (
    <Box
        sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            [edge]: 0,
            height: SCROLL_FADE.height,
            pointerEvents: 'none',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.2s ease',
            background: (theme) => {
                const from = alpha(theme.palette.background.paper, 0);
                const to = alpha(theme.palette.background.paper, SCROLL_FADE.endOpacity);
                return edge === 'bottom'
                    ? `linear-gradient(to bottom, ${from}, ${to} ${SCROLL_FADE.stop})`
                    : `linear-gradient(to top, ${from}, ${to} ${SCROLL_FADE.stop})`;
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
