import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleVegaLite } from 'flint-chart';
import * as vega from 'vega';
import { compile } from 'vega-lite';

import '../../../../../src/app/reactApp/runtime/optional/geo';
import { resolveBasemaps } from '../../../../../src/app/reactApp/runtime/chart';

// Flint map basemaps resolve to the vendored @df/geo boundaries and render
// offline, joining on the same numeric ids as Vega's world-110m/us-10m files.
const render = async (chartType: string, rows: Record<string, unknown>[], encodings: Record<string, { field: string }>) => {
    const spec = assembleVegaLite({
        data: { values: rows },
        semantic_types: {},
        chart_spec: { chartType, encodings, baseSize: { width: 600, height: 350 } } as any,
        options: {},
    } as any) as Record<string, unknown>;
    expect(JSON.stringify(spec)).toContain('vega.github.io');
    const resolved = resolveBasemaps(spec) as Record<string, unknown>;
    expect(JSON.stringify(resolved)).not.toContain('vega.github.io');
    const view = new vega.View(vega.parse(compile(resolved as any).spec), { renderer: 'none' });
    return view.toSVG();
};

describe('offline Flint maps', () => {
    beforeAll(() => { (globalThis as any).fetch = () => { throw new Error('maps must not use the network'); }; });
    afterAll(() => { delete (globalThis as any).fetch; });

    it('draws a world bubble map', async () => {
        const svg = await render('Map', [{ lat: 35.7, lon: 139.7, mag: 6.1 }, { lat: -33.4, lon: -70.6, mag: 5.2 }],
            { latitude: { field: 'lat' }, longitude: { field: 'lon' }, size: { field: 'mag' } });
        expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(100);
    });

    it('colors countries in a choropleth joined by name', async () => {
        const svg = await render('Choropleth', [{ country: 'Japan', value: 5 }, { country: 'Brazil', value: 9 }, { country: 'Kenya', value: 2 }],
            { id: { field: 'country' }, color: { field: 'value' } });
        // Each country joins its value and takes its own color from the scale (low, middle, high).
        const filled = svg.match(/fill="rgb\([^)]*\)"/g) ?? [];
        expect(new Set(filled).size).toBe(3);
    });

    it('draws US states', async () => {
        const svg = await render('Choropleth', [{ state: 'California', value: 3 }, { state: 'Texas', value: 7 }],
            { id: { field: 'state' }, color: { field: 'value' } });
        expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});
