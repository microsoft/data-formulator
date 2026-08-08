/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    CHART_SIZE_STOPS,
    CHART_STRETCH_STEPS,
    COLUMN_FIT_TOLERANCE,
    COMFORTABLE_CANVAS,
    DEFAULT_CHART_SIZE_STOP_INDEX,
    DENSITY_SCALE,
    MIN_SUPPORTED,
    REFERENCE,
    chartSizeStopIndex,
    chartStretchCeiling,
    clampDensityForViewport,
    comfortableThreadColumns,
    defaultChartSizeStop,
    defaultThreadColumns,
    densityForWidthClass,
    fittableThreadColumnsFor,
    gridSizeCaps,
    iconVar,
    layoutFor,
    maxThreadColumnsForWidth,
    maxThreadColumnsForWidthClass,
    minimumShellBudget,
    resolveHeightClass,
    resolveWidthClass,
    sidebarFitsExpanded,
    textVar,
    threadColumnsForWidthClass,
    threadPaneWidthFor,
    threadStripWidthFor,
    type Density,
} from '../../../../src/app/layout';

const DENSITIES: Density[] = ['compact', 'reference', 'comfortable'];

describe('reference layout', () => {
    it('is the app as hardcoded today', () => {
        // Guards against silently "improving" the reference. A real change
        // belongs behind a density or a width class, not in these numbers.
        expect(REFERENCE.thread).toEqual({ cardWidth: 248, cardGap: 8, panelPadding: 32, maxColumns: 3 });
        expect(REFERENCE.rail).toBe(40);
        expect(REFERENCE.sidebar).toEqual({ min: 240, default: 280, max: 450 });
        expect(REFERENCE.chart).toEqual({ width: 400, height: 300 });
    });

    it('leaves geometry untouched at reference density', () => {
        expect(layoutFor('reference')).toBe(REFERENCE);
        expect(DENSITY_SCALE.reference).toBe(1);
    });

    it('reproduces the thread pane widths the Allotment snaps to', () => {
        expect(threadPaneWidthFor(1)).toBe(280);
        expect(threadPaneWidthFor(2)).toBe(536);
        expect(threadPaneWidthFor(3)).toBe(792);
    });

    it('round-trips pane width back to column count', () => {
        for (let n = 1; n <= REFERENCE.thread.maxColumns; n++) {
            expect(fittableThreadColumnsFor(threadPaneWidthFor(n))).toBe(n);
        }
    });

    it('keeps real headroom below each snap point', () => {
        // The pane can rest a few px under its snap target (Allotment's snap
        // deadzone, sash rounding, fractional zoom). The strip only draws half
        // the reserved padding, so those pixels are genuinely spare — a pane a
        // hair under 536 must still show 2 columns, not collapse to 1.
        for (let n = 2; n <= REFERENCE.thread.maxColumns; n++) {
            const snap = threadPaneWidthFor(n);
            for (let shortfall = 0; shortfall <= 8; shortfall++) {
                expect(
                    fittableThreadColumnsFor(snap - shortfall),
                    `${n} columns at ${snap - shortfall}px (${shortfall}px under snap)`,
                ).toBe(n);
            }
        }
    });

    it('never claims more columns than the strip can draw', () => {
        // The other direction: over-reporting clips a column instead of
        // dropping it, which is worse — a half-visible card. Swept from the
        // pane's own minimum size, since narrower panes can't occur.
        for (let width = threadPaneWidthFor(1); width <= 900; width++) {
            const n = fittableThreadColumnsFor(width);
            expect(
                threadStripWidthFor(n),
                `${n} columns claimed at ${width}px`,
            ).toBeLessThanOrEqual(width + COLUMN_FIT_TOLERANCE);
        }
    });

    it('still counts columns when zoom reports a sub-pixel pane width', () => {
        // 535.6 instead of 536 — the bug COLUMN_FIT_TOLERANCE exists for.
        expect(fittableThreadColumnsFor(535.6)).toBe(2);
    });
});

describe('density scaling', () => {
    it('uses designed type stops, not a multiplied reference', () => {
        // Multiplying deforms the ramp — 12 x 1.15 rounds to 14 but 13 x 1.15
        // rounds to 15, so the steps stop being even. Every stop must be a
        // whole, sensible size at every density.
        for (const density of DENSITIES) {
            const { text, icon } = layoutFor(density);
            for (const [name, value] of Object.entries({ ...text, ...icon })) {
                expect(Number.isInteger(value), `${density}.${name} = ${value}`).toBe(true);
                expect(value, `${density}.${name}`).toBeGreaterThanOrEqual(9);
                expect(value, `${density}.${name}`).toBeLessThanOrEqual(24);
            }
        }
    });

    it('keeps the ramp rhythm at every density', () => {
        // The reference ramp steps 1,1,1,1,2,2 — every density keeps that shape,
        // so relative emphasis between labels and headings never shifts.
        const shape = (t: Record<string, number>) => {
            const ordered = [t.xxs, t.xs, t.sm, t.md, t.lg, t.xl, t.xxl];
            return ordered.slice(1).map((v, i) => v - ordered[i]);
        };
        const reference = shape(layoutFor('reference').text);
        for (const density of DENSITIES) {
            expect(shape(layoutFor(density).text), density).toEqual(reference);
        }
    });

    it('moves every stop up as density increases', () => {
        const order: Density[] = ['compact', 'reference', 'comfortable', 'spacious'];
        for (const key of ['xxs', 'sm', 'xxl'] as const) {
            let previous = 0;
            for (const density of order) {
                const value = layoutFor(density).text[key];
                expect(value, `${density}.${key}`).toBeGreaterThan(previous);
                previous = value;
            }
        }
    });

    it('scales lengths but never counts', () => {
        for (const density of DENSITIES) {
            expect(layoutFor(density).thread.maxColumns).toBe(REFERENCE.thread.maxColumns);
        }
        expect(layoutFor('compact').thread.cardWidth).toBeLessThan(REFERENCE.thread.cardWidth);
        expect(layoutFor('comfortable').thread.cardWidth).toBeGreaterThan(REFERENCE.thread.cardWidth);
    });

    it('yields whole pixels', () => {
        for (const density of DENSITIES) {
            const t = layoutFor(density);
            expect(Number.isInteger(t.thread.cardWidth)).toBe(true);
            expect(Number.isInteger(t.grid.rowHeight)).toBe(true);
        }
    });
});

describe('size classes', () => {
    it.each([
        [800, 'floor'],
        [1024, 'compact'],
        [1279, 'compact'],
        [1280, 'standard'],
        [1680, 'wide'],
        [2560, 'ultra'],
        [3440, 'ultra'],
    ] as const)('classifies width %i as %s', (width, expected) => {
        expect(resolveWidthClass(width)).toBe(expected);
    });

    it.each([
        [600, 'short'],
        [660, 'short'],
        [900, 'standard'],
        [1440, 'tall'],
    ] as const)('classifies height %i as %s', (height, expected) => {
        expect(resolveHeightClass(height)).toBe(expected);
    });

    it('asks for more thread columns as width grows', () => {
        const widths = ['floor', 'compact', 'standard', 'wide', 'ultra'] as const;
        const columns = widths.map(threadColumnsForWidthClass);
        for (let i = 1; i < columns.length; i++) {
            expect(columns[i]).toBeGreaterThanOrEqual(columns[i - 1]);
        }
        // The point of the exercise: ultrawide must not stay pinned at 3.
        expect(maxThreadColumnsForWidthClass('ultra')).toBeGreaterThan(REFERENCE.thread.maxColumns);
    });

    it('scales density up with the screen, and only down on small ones', () => {
        expect(densityForWidthClass('floor')).toBe('compact');
        expect(densityForWidthClass('compact')).toBe('compact');
        expect(densityForWidthClass('standard')).toBe('reference');
        expect(densityForWidthClass('wide')).toBe('comfortable');
        expect(densityForWidthClass('ultra')).toBe('spacious');
    });
});

describe('type scale', () => {
    it('exposes a CSS variable for every token', () => {
        expect(Object.keys(textVar).sort()).toEqual(Object.keys(REFERENCE.text).sort());
        expect(Object.keys(iconVar).sort()).toEqual(Object.keys(REFERENCE.icon).sort());
    });

    it('seeds index.css with the reference values', () => {
        // The seed exists so the scale is defined before React mounts. If it
        // drifts from REFERENCE, the app flashes the wrong size on load.
        const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf-8');
        const seeded = (name: string) => {
            const match = indexCss.match(new RegExp(`--df-${name}:\\s*([0-9.]+)px`));
            return match ? Number(match[1]) : null;
        };
        for (const [key, value] of Object.entries(REFERENCE.text)) {
            expect(seeded(`text-${key}`), `--df-text-${key}`).toBe(value);
        }
        for (const [key, value] of Object.entries(REFERENCE.icon)) {
            expect(seeded(`icon-${key}`), `--df-icon-${key}`).toBe(value);
        }
    });
});

describe('canvas content sizing', () => {
    it('never gives less room than the old fixed caps', () => {
        // Small screens must not regress: the previous constants were 900x400.
        for (const [w, h] of [[0, 0], [600, 500], [1027, 768], [1583, 1080]]) {
            const caps = gridSizeCaps(w, h);
            expect(caps.maxWidth, `width at ${w}`).toBeGreaterThanOrEqual(900);
            expect(caps.maxHeight, `height at ${h}`).toBeGreaterThanOrEqual(400);
        }
    });

    it('gives a big canvas materially more table', () => {
        const small = gridSizeCaps(1027, 768);
        const large = gridSizeCaps(2221, 1440);
        expect(large.maxWidth).toBeGreaterThan(small.maxWidth * 1.5);
        expect(large.maxHeight).toBeGreaterThan(small.maxHeight);
    });

    it('bounds the table so it cannot run away on a 4K screen', () => {
        const huge = gridSizeCaps(3501, 2160);
        expect(huge.maxWidth).toBeLessThanOrEqual(2400);
        expect(huge.maxHeight).toBeLessThanOrEqual(900);
    });

    it('raises the chart ceiling with the room, within bounds', () => {
        // Permission to stretch, not instruction: the compiler only uses this
        // when the data wants it. Never below today's 1.5, never unbounded.
        expect(chartStretchCeiling(0, 400)).toBe(1.5);
        expect(chartStretchCeiling(600, 400)).toBe(1.5);
        expect(chartStretchCeiling(1600, 400)).toBe(3);
        expect(chartStretchCeiling(4000, 400)).toBe(3);
        expect(chartStretchCeiling(800, 400)).toBe(2);
    });

    it('holds steady through a drag instead of changing every pixel', () => {
        // The ceiling feeds the compile, so a continuous value recompiles the
        // chart on every pixel and the new size feeds back into the measured
        // width — visible as size flicker while resizing. Sweeping the full
        // range may only ever produce the few defined steps.
        const seen = new Set<number>();
        for (let width = 0; width <= 4000; width++) {
            seen.add(chartStretchCeiling(width, 400));
        }
        expect([...seen].sort((a, b) => a - b)).toEqual([...CHART_STRETCH_STEPS]);
    });

    it('never moves backwards as the canvas widens', () => {
        let previous = 0;
        for (let width = 0; width <= 4000; width += 1) {
            const ceiling = chartStretchCeiling(width, 400);
            expect(ceiling, `${width}px`).toBeGreaterThanOrEqual(previous);
            previous = ceiling;
        }
    });
});

describe('default thread columns', () => {
    it('starts at two once the screen affords it, even with one thread', () => {
        // The docked chat box sits under the thread; one 248px column is too
        // narrow to compose in, so an empty second column is worth its width.
        expect(defaultThreadColumns('standard', 1)).toBe(2);
        expect(defaultThreadColumns('wide', 1)).toBe(2);
        expect(defaultThreadColumns('ultra', 1)).toBe(2);
    });

    it('stays at one where the shell cannot seat two', () => {
        expect(defaultThreadColumns('floor', 1)).toBe(1);
        expect(defaultThreadColumns('compact', 3)).toBe(1);
    });

    it('follows the content once it needs more than two', () => {
        expect(defaultThreadColumns('wide', 3)).toBe(3);
        expect(defaultThreadColumns('ultra', 4)).toBe(4);
    });

    it('never offers more than the width class allows', () => {
        for (const widthClass of ['floor', 'compact', 'standard', 'wide', 'ultra'] as const) {
            expect(defaultThreadColumns(widthClass, 99))
                .toBeLessThanOrEqual(threadColumnsForWidthClass(widthClass));
        }
    });

    it('keeps two columns on a mid-size laptop', () => {
        // A 1245px viewport (split ~1205) leaves the canvas ~669px with two
        // columns, which is a size we want to keep them at.
        expect(defaultThreadColumns('standard', 1, 1205)).toBe(2);
    });

    it('drops to one column once a second would squeeze the canvas', () => {
        const needed = threadPaneWidthFor(2) + COMFORTABLE_CANVAS;
        expect(defaultThreadColumns('standard', 1, needed - 1)).toBe(1);
        expect(defaultThreadColumns('standard', 1, needed)).toBe(2);
    });

    it('leaves the canvas comfortable at every count it suggests', () => {
        for (let width = 600; width <= 4000; width += 1) {
            const columns = comfortableThreadColumns(width);
            if (columns === 1) continue;
            expect(width - threadPaneWidthFor(columns), `${columns} columns at ${width}px`)
                .toBeGreaterThanOrEqual(COMFORTABLE_CANVAS);
        }
    });

    it('treats a missing container as no constraint, not as a cap', () => {
        // Returning `maxColumns` here silently held ultrawide at 3 instead of 5.
        expect(defaultThreadColumns('ultra', 4)).toBe(4);
        expect(defaultThreadColumns('standard', 1)).toBe(2);
    });
});

describe('column capacity as the window resizes', () => {
    // Dragging the window edge should feel stepped and predictable: the count
    // only ever goes up as the split gets wider, and the canvas keeps its
    // minimum at every width.
    const cap = maxThreadColumnsForWidthClass('ultra');

    it('never decreases as the split container grows', () => {
        let previous = 0;
        for (let width = 0; width <= 4000; width += 1) {
            const columns = maxThreadColumnsForWidth(width, REFERENCE, cap);
            expect(columns, `${width}px`).toBeGreaterThanOrEqual(previous);
            previous = columns;
        }
    });

    it('always leaves the canvas its minimum', () => {
        for (let width = threadPaneWidthFor(1) + REFERENCE.canvas.min; width <= 4000; width += 7) {
            const columns = maxThreadColumnsForWidth(width, REFERENCE, cap);
            expect(
                width - threadPaneWidthFor(columns),
                `${columns} columns at ${width}px`,
            ).toBeGreaterThanOrEqual(REFERENCE.canvas.min);
        }
    });

    it('steps exactly at the pane snap points', () => {
        for (let n = 2; n <= cap; n++) {
            const threshold = threadPaneWidthFor(n) + REFERENCE.canvas.min;
            expect(maxThreadColumnsForWidth(threshold - 1, REFERENCE, cap)).toBe(n - 1);
            expect(maxThreadColumnsForWidth(threshold, REFERENCE, cap)).toBe(n);
        }
    });
});

describe('chart size stops', () => {
    it('puts the authored size on a stop, so `1` is always reachable', () => {
        expect(CHART_SIZE_STOPS[DEFAULT_CHART_SIZE_STOP_INDEX]).toBe(1);
    });

    it('increases monotonically', () => {
        const sorted = [...CHART_SIZE_STOPS].sort((a, b) => a - b);
        expect([...CHART_SIZE_STOPS]).toEqual(sorted);
    });

    it('snaps a persisted free-slider factor to the closest stop', () => {
        expect(chartSizeStopIndex(1)).toBe(DEFAULT_CHART_SIZE_STOP_INDEX);
        expect(CHART_SIZE_STOPS[chartSizeStopIndex(0.62)]).toBe(0.6);
        expect(CHART_SIZE_STOPS[chartSizeStopIndex(1.3)]).toBe(1.25);
        expect(CHART_SIZE_STOPS[chartSizeStopIndex(9)]).toBe(2);
        expect(CHART_SIZE_STOPS[chartSizeStopIndex(0.1)]).toBe(0.6);
    });

    it('grows the suggested size with the screen', () => {
        // The stops are the only thing that actually scales a chart with the
        // window — the stretch ceiling is inert for sparse data.
        const order = ['floor', 'compact', 'standard', 'wide', 'ultra'] as const;
        let previous = 0;
        for (const widthClass of order) {
            const stop = defaultChartSizeStop(widthClass);
            expect(stop, widthClass).toBeGreaterThanOrEqual(previous);
            previous = stop;
        }
        expect(defaultChartSizeStop('ultra')).toBeGreaterThan(defaultChartSizeStop('standard'));
    });

    it('suggests the authored size on a standard screen', () => {
        expect(defaultChartSizeStop('standard')).toBe(1);
    });

    it('only ever suggests a real stop, so the slider can show it', () => {
        for (const widthClass of ['floor', 'compact', 'standard', 'wide', 'ultra'] as const) {
            expect(CHART_SIZE_STOPS as readonly number[], widthClass)
                .toContain(defaultChartSizeStop(widthClass));
        }
    });
});

describe('minimum screen budget', () => {
    // The floor is only real if the minima fit inside it. A constant that grows
    // past this should fail here, not on a user's laptop.
    it('fits MIN_SUPPORTED at the densities small screens actually get', () => {
        for (const density of ['compact', 'reference'] as Density[]) {
            const budget = minimumShellBudget(layoutFor(density));
            expect(budget.fitsWidth, `${density} width ${budget.width}`).toBe(true);
            expect(budget.fitsHeight, `${density} height ${budget.height}`).toBe(true);
        }
    });

    it('does not pretend comfortable density fits a floor viewport', () => {
        // 600px of viewport height cannot seat comfortable — the honest answer
        // is to step down, not to clip the data grid.
        expect(minimumShellBudget(layoutFor('comfortable')).fitsHeight).toBe(false);
    });

    it('clamps any requested density to what the viewport can seat', () => {
        for (const requested of DENSITIES) {
            const effective = clampDensityForViewport(requested, MIN_SUPPORTED.width, MIN_SUPPORTED.height);
            const budget = minimumShellBudget(layoutFor(effective));
            expect(budget.fitsWidth && budget.fitsHeight, `${requested} → ${effective}`).toBe(true);
        }
        // Roomy viewports keep what they asked for.
        expect(clampDensityForViewport('comfortable', 2560, 1440)).toBe('comfortable');
    });

    it('cannot fit an expanded sidebar at the floor — which is why it rails', () => {
        expect(sidebarFitsExpanded(MIN_SUPPORTED.width)).toBe(false);
        expect(sidebarFitsExpanded(1280)).toBe(true);
    });
});
