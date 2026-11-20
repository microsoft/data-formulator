// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Bring the focused item into view in the data thread, so new or reopened work
 * is never off screen. Pure geometry plus DOM lookup; DataThread decides when.
 */

import type { FocusedId } from '../app/dfSlice';

export interface Span {
    top: number;
    bottom: number;
}

/** Keep revealed items this far from the viewport edge (15% of its height, 48–160px). */
export const revealMargin = (viewportHeight: number) => Math.min(160, Math.max(48, viewportHeight * 0.15));

/**
 * Vertical scroll delta that reveals `item`; 0 when it is already fully visible
 * (unless `settle`, which re-centres an item we revealed after a late layout shift).
 * Moves the smallest distance that puts the item inside the comfortable zone
 * (the viewport inset by `revealMargin`), together with `leadIn` (what produced
 * it, just above) when both fit. An item taller than the zone shows its top.
 */
export function revealDelta(viewport: Span, item: Span, leadIn?: Span, settle = false): number {
    const height = viewport.bottom - viewport.top;
    const margin = revealMargin(height);
    const edge = settle ? margin - 8 : -1;
    if (item.top >= viewport.top + edge && item.bottom <= viewport.bottom - edge) return 0;
    const room = height - 2 * margin;
    const span = leadIn && leadIn.top < item.top && item.bottom - leadIn.top <= room
        ? { top: leadIn.top, bottom: item.bottom }
        : item;
    if (span.bottom - span.top > room || span.top < viewport.top + margin) return span.top - (viewport.top + margin);
    return span.bottom - (viewport.bottom - margin);
}

const escape = (value: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&'));

/** The thread element that represents the focused item, if it is rendered. */
export function findRevealTarget(
    container: ParentNode,
    focusedId: FocusedId | undefined,
    fileNodes: { id: string; path: string }[],
): HTMLElement | null {
    if (!focusedId) return null;
    const item = (key: string) => container.querySelector<HTMLElement>(`[data-thread-item="${escape(key)}"]`);
    switch (focusedId.type) {
        case 'text': return item(`textturn-${focusedId.textId}`);
        case 'report': return item(`report-${focusedId.reportId}`);
        case 'reference': return item(focusedId.referenceId);
        case 'file': {
            const node = fileNodes.find(file => file.path === focusedId.fileName);
            return node ? item(node.id) : null;
        }
        case 'chart': return container.querySelector<HTMLElement>(`[data-chart-id="${escape(focusedId.chartId)}"]`);
        case 'table': return container.querySelector<HTMLElement>(`[data-thread-flow-block="output-${escape(focusedId.tableId)}"]`);
        default: return null;
    }
}

/** The thread row just above `target` in the same thread: usually the prompt that produced it. */
export function findLeadIn(target: HTMLElement): HTMLElement | null {
    const entry = target.closest('[data-thread-entry]');
    if (!entry) return null;
    const rows = Array.from(entry.querySelectorAll<HTMLElement>('[data-thread-item]'))
        .filter(row => !row.contains(target) && !target.contains(row));
    let previous: HTMLElement | null = null;
    for (const row of rows) {
        if (row.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) previous = row;
        else break;
    }
    return previous;
}
