// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';

function scrollParent(element: HTMLElement): HTMLElement | null {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
    }
    return null;
}

/**
 * Renders a long list a page at a time: `count` items first, growing by `step`
 * whenever the returned `sentinel` (placed after the rendered items) nears its
 * scroll container. Opening and closing a panel then mounts and unmounts only
 * what is on screen instead of every item. `resetKey` (e.g. a query or sort)
 * starts over at `initial`.
 */
export function useProgressiveCount(total: number, { initial, step, resetKey }: { initial: number; step: number; resetKey?: unknown }) {
    const supported = typeof IntersectionObserver !== 'undefined';
    const [page, setPage] = useState({ key: resetKey, count: initial });
    if (page.key !== resetKey) setPage({ key: resetKey, count: initial });
    const count = supported ? Math.min(total, page.key === resetKey ? page.count : initial) : total;

    const [sentinelElement, setSentinelElement] = useState<HTMLElement | null>(null);
    useEffect(() => {
        if (!sentinelElement || count >= total) return;
        // Re-observing after each page fires again while the sentinel is still in reach.
        // Observed against its scroller, since a root margin doesn't reach past an ancestor's clipping.
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                setPage(previous => ({ ...previous, count: Math.min(total, previous.count + step) }));
            }
        }, { root: scrollParent(sentinelElement), rootMargin: '400px 0px' });
        observer.observe(sentinelElement);
        return () => observer.disconnect();
    }, [sentinelElement, count, total, step]);

    const sentinel = count < total ? <div ref={setSentinelElement} aria-hidden style={{ height: 1 }} /> : null;
    return { count, sentinel };
}
