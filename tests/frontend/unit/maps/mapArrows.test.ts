import { describe, expect, it } from 'vitest';

import { arcCourse, fitArrow } from '../../../../src/maps/MapRenderer';

const numbers = (d: string) => d.match(/-?[\d.]+/g)!.map(Number);

describe('flow arrowheads', () => {
    // A straight line 200 px long, left to right.
    const line = arcCourse([0, 0], [200, 0], 'straight');

    it('sets the tip short of the end by the gap and ends the line a hair inside the head', () => {
        const arrow = fitArrow(line, 4, 3.5)!;
        const [tipX, tipY] = numbers(arrow.head);
        expect(tipX).toBeCloseTo(196.5, 1);
        expect(tipY).toBeCloseTo(0, 5);
        // Head length for a 4 px line: 2.4 × 4 + 6 = 15.6; the line stops 0.5 px past the head's base.
        expect(line.at(arrow.cut)![0]).toBeCloseTo(200 - 3.5 - 15.6 + 0.5, 1);
        expect(numbers(line.upTo(arrow.cut)).at(-2)).toBeCloseTo(181.4, 1);
        // The halo runs along the two sides only: an open path through the tip.
        expect(arrow.sides).not.toMatch(/Z$/);
        expect(numbers(arrow.sides).slice(2, 4)).toEqual(numbers(arrow.head).slice(0, 2));
    });

    it('shrinks a head on a short line, and drops it on a very short one', () => {
        const full = Math.abs(numbers(fitArrow(line, 4)!.head)[2] - 200);
        const short = fitArrow(arcCourse([0, 0], [20, 0], 'straight'), 4)!;
        expect(Math.abs(numbers(short.head)[2] - 20)).toBeLessThan(full);
        expect(fitArrow(arcCourse([0, 0], [12, 0], 'straight'), 4)).toBeNull();
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
