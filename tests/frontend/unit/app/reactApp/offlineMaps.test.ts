import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleVegaLite } from 'flint-chart';
import * as vega from 'vega';
import { compile } from 'vega-lite';

import '../../../../../src/app/reactApp/runtime/optional/geo';
import { resolveBasemaps } from '../../../../../src/app/reactApp/runtime/chart';

// Flint map basemaps resolve to the vendored @df/geo boundaries and render offline: Vega's
// world-110m and us-10m files, and the pre-projected US atlas (us-atlas counties-albers-10m)
// Flint 1.0 draws US choropleths from.
const render = async (chartType: string, rows: Record<string, unknown>[], encodings: Record<string, { field: string }>) => {
    const spec = assembleVegaLite({
        data: { values: rows },
        semantic_types: {},
        chart_spec: { chartType, encodings, baseSize: { width: 600, height: 350 } } as any,
        options: {},
    } as any) as Record<string, unknown>;
    const web = /vega\.github\.io|cdn\.jsdelivr\.net|microsoft\.github\.io/;
    expect(JSON.stringify(spec)).toMatch(web);
    const resolved = resolveBasemaps(spec) as Record<string, unknown>;
    expect(JSON.stringify(resolved)).not.toMatch(web);
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
        // Each country joins its value and takes its own color from the scale (low, middle, high); the
        // legend may add swatches of the same scale.
        const filled = svg.match(/fill="rgb\([^)]*\)"/g) ?? [];
        expect(new Set(filled).size).toBeGreaterThanOrEqual(3);
    });

    it('draws US states', async () => {
        const svg = await render('Choropleth', [{ state: 'California', value: 3 }, { state: 'Texas', value: 7 }],
            { id: { field: 'state' }, color: { field: 'value' } });
        expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(2);
        // Both states join their values and take their own colors.
        const filled = svg.match(/fill="rgb\([^)]*\)"/g) ?? [];
        expect(new Set(filled).size).toBeGreaterThanOrEqual(2);
    });

    // Flint's published boundaries (`geo/v1` on its site), whichever Flint version is installed.
    it('draws the World Bank and US boundaries Flint names on its site', async () => {
        const site = 'https://microsoft.github.io/flint-chart/geo/v1';
        const layer = (file: string, feature: string, mark: Record<string, unknown>) =>
            ({ data: { url: `${site}/${file}.json`, format: { type: 'topojson', feature } }, mark: { type: 'geoshape', ...mark } });
        const spec = {
            width: 600, height: 350, projection: { type: 'equalEarth' },
            layer: [
                {
                    ...layer('world-bank-coarse', 'countries', {}),
                    transform: [{ lookup: 'id', from: { data: { values: [{ id: 356, value: 1 }, { id: 76, value: 2 }] }, key: 'id', fields: ['value'] } }],
                    encoding: { color: { field: 'value', type: 'quantitative' } },
                },
                layer('world-bank-coarse', 'disputed', { filled: false, strokeDash: [2, 2] }),
                layer('world-bank-medium', 'countries', { filled: false }),
                layer('states-10m', 'states', { filled: false }),
            ],
        };
        const resolved = resolveBasemaps(spec) as Record<string, unknown>;
        expect(JSON.stringify(resolved)).not.toMatch(/microsoft\.github\.io/);
        const svg = await new vega.View(vega.parse(compile(resolved as any).spec), { renderer: 'none' }).toSVG();
        expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(100);
        // India and Brazil join their values by ISO numeric id and take their own colors.
        expect(new Set(svg.match(/fill="rgb\([^)]*\)"/g) ?? []).size).toBeGreaterThanOrEqual(2);
    });
});
