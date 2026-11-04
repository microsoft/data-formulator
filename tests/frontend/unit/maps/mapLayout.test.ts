import { expect, it } from 'vitest';

import { chooseLayout, layoutCandidates, type Box, type LayoutFit, type LayoutInput } from '../../../../src/maps/layout';
import { parseMapSpec } from '../../../../src/maps/spec';

const base: LayoutInput = {
    width: 900, height: 600,
    header: { width: 300, height: 40 },
    items: [{ width: 150, height: 50 }, { width: 170, height: 56 }],
    timelineOnly: false,
    legend: { width: 200, height: 70 },
    fixed: [[850, 400, 884, 570]],
    creditLine: false, reserveTopRight: 0, bottomRight: 16,
};

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

it('offers only arrangements whose panels stay apart and inside the panel', () => {
    const candidates = layoutCandidates(base);
    expect(candidates.length).toBeGreaterThan(4);
    for (const { boxes } of candidates) {
        for (const [index, box] of boxes.entries()) {
            expect(box[0] >= 0 && box[1] >= 0 && box[2] <= base.width && box[3] <= base.height).toBe(true);
            for (const other of boxes.slice(index + 1)) expect(overlaps(box, other)).toBe(false);
        }
    }
    // The top left belongs to controls under the title; the bottom left to controls along the bottom.
    const layouts = candidates.map(candidate => `${candidate.layout.controls}/${candidate.layout.legend}`);
    expect(layouts).not.toContain('top/top-left');
    expect(layouts).not.toContain('bottom/bottom-left');
    expect(layouts).toContain('side/controls');
    expect(layouts).toContain('top/controls');
});

it('lets the legend join a row only when the whole row fits, and a column only when it fits whole', () => {
    const crowded = { ...base, items: Array.from({ length: 4 }, () => ({ width: 170, height: 56 })) };
    expect(layoutCandidates(crowded).some(candidate => candidate.layout.controls === 'top' && candidate.layout.legend === 'controls')).toBe(false);
    const tall = { ...base, items: Array.from({ length: 8 }, () => ({ width: 150, height: 56 })) };
    expect(layoutCandidates(tall).some(candidate => candidate.layout.controls === 'side' && candidate.layout.legend === 'controls')).toBe(false);
});

it('picks the arrangement that leaves the map largest, and keeps the usual one on a tie', () => {
    // The map grows when nothing sits along the top (as a globe does beside a column).
    const measure = (arrangements: Box[][]): LayoutFit[] => arrangements.map(boxes => ({
        scale: boxes.some(box => box[1] > 50 && box[1] < 100 && box[2] - box[0] > 300) ? 200 : 260, covered: 0, offset: 0 }));
    expect(chooseLayout(base, measure).controls).toBe('side');
    // All equal: the controls stay under the title.
    const flat = (arrangements: Box[][]) => arrangements.map(() => ({ scale: 250, covered: 0, offset: 0 }));
    expect(chooseLayout({ ...base, legend: null }, flat)).toEqual({ controls: 'top', legend: 'bottom-left' });
    // Covering the data costs more than a slightly smaller map.
    const covering = (arrangements: Box[][]) => arrangements.map(boxes => boxes.some(box => box[1] > 400 && box[0] < 50 && box[2] - box[0] > 300)
        ? { scale: 260, covered: 0.4, offset: 0 } : { scale: 250, covered: 0, offset: 0 });
    expect(chooseLayout({ ...base, legend: null }, covering).controls).not.toBe('bottom');
});

it('follows a pinned placement for the controls', () => {
    const measure = (arrangements: Box[][]) => arrangements.map(() => ({ scale: 250, covered: 0, offset: 0 }));
    expect(chooseLayout({ ...base, pin: 'bottom' }, measure).controls).toBe('bottom');
    expect(layoutCandidates({ ...base, pin: 'side' }).every(candidate => candidate.layout.controls === 'side')).toBe(true);
});

it('checks the spec\'s layout choice', () => {
    const spec = (layout: string) => JSON.stringify({ view: { layout }, data: { d: { values: [] } }, layers: [], controls: [] });
    expect(parseMapSpec(spec('bottom')).errors).toEqual([]);
    expect(parseMapSpec(spec('diagonal')).errors).toContain('view.layout must be one of auto, top, bottom, side.');
});
