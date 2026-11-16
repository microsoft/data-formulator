import { describe, expect, it } from 'vitest';

import { arcCourse, fitArrow, headShape } from '../../../../src/maps/MapRenderer';

const numbers = (d: string) => d.match(/-?[\d.]+/g)!.map(Number);

describe('flow arrowheads', () => {
    // A straight line 200 px long, left to right.
    const line = arcCourse([0, 0], [200, 0], 'straight');

    it('sets the tip on the line’s end and ends the line a hair inside the head', () => {
        const arrow = fitArrow(line, 4)!;
        const [tipX, tipY] = numbers(arrow.head);
        expect(tipX).toBeCloseTo(200, 1);
        expect(tipY).toBeCloseTo(0, 5);
        // Head length for a 4 px line: 4 + 2.6 × 4 = 14.4; the line stops 0.5 px past the head's base.
        expect(line.at(arrow.cut)![0]).toBeCloseTo(200 - 14.4 + 0.5, 1);
        expect(numbers(line.upTo(arrow.cut)).at(-2)).toBeCloseTo(186.1, 1);
        // The halo runs along the two sides only: an open path through the tip.
        expect(arrow.sides).not.toMatch(/Z$/);
        expect(numbers(arrow.sides).slice(2, 4)).toEqual(numbers(arrow.head).slice(0, 2));
    });

    it('sizes a head to its line: a hairline’s slim and small, a broad line’s broad', () => {
        const spread = (width: number) => { const [, , lx, ly, rx, ry] = numbers(fitArrow(line, width)!.head); return Math.hypot(lx - rx, ly - ry); };
        expect(spread(0.5)).toBeLessThan(4);
        expect(spread(8)).toBeGreaterThan(5 * spread(0.5));
        expect(headShape(0.5).length / headShape(0.5).half).toBeGreaterThan(headShape(8).length / headShape(8).half);
    });

    it('shrinks a head on a short line, keeps a small one on a very short line, and drops it only on a line a few px long', () => {
        const full = Math.abs(numbers(fitArrow(line, 4)!.head)[2] - 200);
        const short = fitArrow(arcCourse([0, 0], [20, 0], 'straight'), 4)!;
        expect(Math.abs(numbers(short.head)[2] - 20)).toBeLessThan(full);
        // 8 px: the head is no longer than the line.
        const tiny = fitArrow(arcCourse([0, 0], [8, 0], 'straight'), 4)!;
        expect(numbers(tiny.head)[0]).toBeCloseTo(8, 1);
        expect(8 - numbers(tiny.head)[2]).toBeLessThanOrEqual(8);
        expect(fitArrow(arcCourse([0, 0], [2, 0], 'straight'), 4)).toBeNull();
    });

    it('cuts a curved arc on its own curve', () => {
        const arc = arcCourse([0, 0], [200, 0], 'arc');
        const arrow = fitArrow(arc, 2)!;
        const end = numbers(arc.upTo(arrow.cut)).slice(-2);
        const onCurve = arc.at(arrow.cut)!;
        expect(end[0]).toBeCloseTo(onCurve[0], 5);
        expect(end[1]).toBeCloseTo(onCurve[1], 5);
        // It is the bowed arc, not the chord.
        expect(Math.abs(arc.at(0.5)![1])).toBeGreaterThan(10);
    });

    it('draws no head where the line does not reach its end on screen', () => {
        const hidden = { ...line, ts: line.ts.slice(0, -1), points: line.points.slice(0, -1) };
        expect(fitArrow(hidden, 4)).toBeNull();
    });
});
