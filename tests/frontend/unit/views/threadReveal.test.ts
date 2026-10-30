import { describe, expect, it } from 'vitest';

import { findLeadIn, findRevealTarget, revealDelta, revealMargin } from '../../../../src/views/threadReveal';

const viewport = { top: 0, bottom: 600 };
const margin = revealMargin(600); // 90px

describe('revealDelta', () => {
    it('leaves a fully visible item alone, even near an edge', () => {
        expect(revealDelta(viewport, { top: 540, bottom: 598 })).toBe(0);
        expect(revealDelta(viewport, { top: 0, bottom: 60 })).toBe(0);
    });

    it('scrolls the least distance that puts an item inside the comfortable zone', () => {
        // Below the fold: its bottom lands one margin above the viewport bottom.
        expect(revealDelta(viewport, { top: 700, bottom: 760 })).toBe(760 - (600 - margin));
        // Peeking at the bottom edge counts as not visible.
        expect(revealDelta(viewport, { top: 580, bottom: 640 })).toBe(640 - (600 - margin));
        // Above: its top lands one margin below the viewport top.
        expect(revealDelta(viewport, { top: -300, bottom: -240 })).toBe(-300 - margin);
    });

    it('includes the lead-in that produced the item when both fit', () => {
        const item = { top: 700, bottom: 760 };
        // Bottom-aligned either way; the lead-in only matters when it would be cut off at the top.
        expect(revealDelta(viewport, item, { top: 640, bottom: 690 })).toBe(760 - (600 - margin));
        const above = { top: -300, bottom: -240 };
        expect(revealDelta(viewport, above, { top: -380, bottom: -310 })).toBe(-380 - margin);
        // A lead-in too tall to fit with the item is dropped.
        expect(revealDelta(viewport, above, { top: -900, bottom: -310 })).toBe(-300 - margin);
    });

    it('shows the top of an item taller than the zone', () => {
        expect(revealDelta(viewport, { top: 800, bottom: 1600 })).toBe(800 - margin);
    });

    it('settles a revealed item that a late layout shift pushed toward an edge', () => {
        const nearBottom = { top: 520, bottom: 560 };
        expect(revealDelta(viewport, nearBottom)).toBe(0);
        expect(revealDelta(viewport, nearBottom, undefined, true)).toBe(560 - (600 - margin));
        expect(revealDelta(viewport, { top: 300, bottom: 340 }, undefined, true)).toBe(0);
    });

    it('bounds the margin for small and large viewports', () => {
        expect(revealMargin(200)).toBe(48);
        expect(revealMargin(2000)).toBe(160);
    });
});

describe('thread lookup', () => {
    const build = () => {
        document.body.innerHTML = `
            <div id="scroller">
              <div data-thread-entry="a">
                <div data-thread-item="prompt-1">Make a dashboard</div>
                <div data-thread-item="file-sales.app.jsx">Sales app</div>
                <div data-thread-flow-block="output-t1"><div data-chart-id="c1"></div></div>
                <div data-thread-item="textturn-x">Explanation</div>
              </div>
              <div data-thread-entry="b"><div data-thread-item="report-r1">Report</div></div>
            </div>`;
        return document.getElementById('scroller')!;
    };

    it('finds the element for each kind of focus', () => {
        const scroller = build();
        const files = [{ id: 'file-sales.app.jsx', path: 'sales.app.jsx' }];
        expect(findRevealTarget(scroller, { type: 'text', textId: 'x' }, files)?.textContent).toBe('Explanation');
        expect(findRevealTarget(scroller, { type: 'report', reportId: 'r1' }, files)?.textContent).toBe('Report');
        expect(findRevealTarget(scroller, { type: 'file', fileName: 'sales.app.jsx' }, files)?.textContent).toBe('Sales app');
        expect(findRevealTarget(scroller, { type: 'reference', referenceId: 'file-sales.app.jsx' }, files)?.textContent).toBe('Sales app');
        expect(findRevealTarget(scroller, { type: 'chart', chartId: 'c1' }, files)?.dataset.chartId).toBe('c1');
        expect(findRevealTarget(scroller, { type: 'table', tableId: 't1' }, files)?.dataset.threadFlowBlock).toBe('output-t1');
        expect(findRevealTarget(scroller, { type: 'file', fileName: 'missing.md' }, files)).toBeNull();
        expect(findRevealTarget(scroller, undefined, files)).toBeNull();
    });

    it('takes the lead-in from the row just above, within the same thread', () => {
        const scroller = build();
        const file = scroller.querySelector<HTMLElement>('[data-thread-item="file-sales.app.jsx"]')!;
        expect(findLeadIn(file)?.dataset.threadItem).toBe('prompt-1');
        const chart = scroller.querySelector<HTMLElement>('[data-chart-id="c1"]')!;
        expect(findLeadIn(chart)?.dataset.threadItem).toBe('file-sales.app.jsx');
        expect(findLeadIn(scroller.querySelector<HTMLElement>('[data-thread-item="prompt-1"]')!)).toBeNull();
        expect(findLeadIn(scroller.querySelector<HTMLElement>('[data-thread-item="report-r1"]')!)).toBeNull();
    });
});
