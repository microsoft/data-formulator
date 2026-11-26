import { describe, expect, it } from 'vitest';
import { assembleVegaLite } from 'flint-chart';

import { compile } from 'vega-lite';
import * as vega from 'vega';

import { mergeableLayerSorts, resolveColumnSorts } from '../../../../src/app/chartSort';

const rows = [
    { region: 'B', value: 5, rank: 2 },
    { region: 'A', value: 1, rank: 3 },
    { region: 'C', value: 3, rank: 1 },
];

describe('resolveColumnSorts', () => {
    it('maps a sort column that another channel shows onto that channel', () => {
        const encodings = { x: { field: 'value' }, y: { field: 'region', sortBy: 'value', sortOrder: 'descending' } };
        expect(resolveColumnSorts(encodings, rows).y).toEqual({ field: 'region', sortBy: 'x', sortOrder: 'descending' });
    });

    it('orders categories by an unmapped column', () => {
        const encodings = { x: { field: 'value' }, y: { field: 'region', sortBy: 'rank' } };
        expect(resolveColumnSorts(encodings, rows).y.sortBy).toBe(JSON.stringify(['C', 'B', 'A']));
    });

    it('leaves channel sorts, value lists and unknown names alone', () => {
        const encodings = {
            x: { field: 'value' },
            y: { field: 'region', sortBy: 'x' },
            color: { field: 'region', sortBy: '["A","B"]' },
            column: { field: 'region', sortBy: 'missing' },
        };
        expect(resolveColumnSorts(encodings, rows)).toEqual(encodings);
    });

    it('gives Flint a value sort it renders largest first', () => {
        const encodings = resolveColumnSorts({ x: { field: 'value', type: 'quantitative' },
            y: { field: 'region', type: 'nominal', sortBy: 'value', sortOrder: 'descending' } }, rows);
        const spec = assembleVegaLite({ data: { values: rows }, semantic_types: {},
            chart_spec: { chartType: 'Bar Chart', encodings } } as any) as any;
        expect(JSON.stringify(spec)).toContain('"sort":"-x"');
    });

    it.each([
        ['nyt', 'descending', ['B', 'C', 'A']], ['nyt', 'ascending', ['A', 'C', 'B']],
        ['datawrapper', 'descending', ['B', 'C', 'A']], ['datawrapper', 'ascending', ['A', 'C', 'B']],
    ])('keeps a value sort when the %s theme draws the chart in layers (%s)', async (theme, sortOrder, expected) => {
        const spec = assembleVegaLite({ data: { values: rows }, semantic_types: {}, chart_spec: { chartType: 'Bar Chart',
            encodings: { x: { field: 'value', type: 'quantitative' }, y: { field: 'region', type: 'nominal', sortBy: 'x', sortOrder } } },
            theme_spec: theme } as any) as any;
        // Themes draw value labels as layers, at the top level (nyt) or inside a header row (datawrapper).
        expect((spec.layer ?? spec.vconcat?.[0]?.layer)?.length).toBeGreaterThan(1);
        const view = new vega.View(vega.parse(compile(mergeableLayerSorts(spec)).spec), { renderer: 'none' });
        await view.runAsync();
        const scale = spec.layer ? 'y' : 'concat_0_y';
        expect(view.scale(scale).domain()).toEqual(expected);
    });
});
