// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Opening a file at a place in it: a report's excerpt asks for its source near the
 * quoted page or words, then focuses the file; the file canvas takes the request when
 * it shows that file (now, or once it mounts) and scrolls there. Approximate by design —
 * a PDF opens at the cited page, a text file at the first match of the quote's opening.
 */

export interface SourceLocation {
    page?: number;
    text?: string;
}

const pending = new Map<string, SourceLocation>();
const listeners = new Set<(fileName: string) => void>();

export function requestSourceLocation(fileName: string, location: SourceLocation): void {
    pending.set(fileName, location);
    listeners.forEach(listener => listener(fileName));
}

/** The location asked for this file, once: taking it clears it. */
export function takeSourceLocation(fileName: string): SourceLocation | undefined {
    const location = pending.get(fileName);
    pending.delete(fileName);
    return location;
}

export function onSourceLocation(listener: (fileName: string) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

const SNIPPET = 48;
const WHOLE = 2000;
const isWordChar = (char: string) => /[\p{L}\p{N}]/u.test(char);

/**
 * The range of the first place under `root` whose letters and digits match `quote` — all of it,
 * else its opening (spacing, punctuation, Markdown and line breaks ignored); null when neither is there.
 */
export function findQuoteRange(root: Node, quote: string): Range | null {
    const words = quote.replace(/\[\^[^\]\s]+\]/g, '').normalize('NFKC').toLowerCase()
        .split('').filter(isWordChar).join('');
    if (words.length < 8) return null;
    const doc = root.ownerDocument ?? document;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let compact = '';
    const positions: { node: Text; offset: number }[] = [];
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const text = node.data;
        for (let offset = 0; offset < text.length; offset++) {
            const char = text[offset].normalize('NFKC').toLowerCase();
            if (char.length === 1 && isWordChar(char)) {
                compact += char;
                positions.push({ node, offset });
            }
        }
    }
    let wanted = words.slice(0, WHOLE);
    let at = compact.indexOf(wanted);
    if (at < 0) {
        wanted = words.slice(0, SNIPPET);
        at = compact.indexOf(wanted);
    }
    if (at < 0) return null;
    const start = positions[at];
    const end = positions[at + wanted.length - 1];
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
}

const HIGHLIGHT = 'df-source-quote';

/**
 * Scroll `container` so the quote sits in its upper third and highlight it while the file is
 * shown (re-found if the content re-renders). Returns a cleanup, or null when it isn't there.
 */
export function showQuote(container: HTMLElement, quote: string): (() => void) | null {
    const range = findQuoteRange(container, quote);
    if (!range) return null;
    const rect = range.getBoundingClientRect?.();
    if (rect) {
        const box = container.getBoundingClientRect();
        container.scrollTop += rect.top - box.top - container.clientHeight / 3;
    }
    const highlights = (globalThis as any).CSS?.highlights;
    const Highlight = (globalThis as any).Highlight;
    if (!highlights || !Highlight || typeof MutationObserver === 'undefined') return () => {};
    const highlight = new Highlight(range);
    highlights.set(HIGHLIGHT, highlight);
    const observer = new MutationObserver(() => {
        const next = findQuoteRange(container, quote);
        highlight.clear();
        if (next) highlight.add(next);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
        observer.disconnect();
        if (highlights.get(HIGHLIGHT) === highlight) highlights.delete(HIGHLIGHT);
    };
}

/** The style that draws the quote highlight (the CSS Custom Highlight API), for the scrolling container. */
export const quoteHighlightSx = {
    [`& ::highlight(${HIGHLIGHT})`]: { backgroundColor: 'rgba(255, 213, 79, 0.55)' },
};
