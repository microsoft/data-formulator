import { describe, expect, it } from 'vitest';
import { assembleVegaLite } from 'flint-chart';

import { compile } from 'vega-lite';

import { choroplethRegion, keepUnmatchedRegions, NO_DATA_FILL } from '../../../../src/app/chartMaps';

const rows = [{ map_id: 4, value: 40 }, { map_id: 566, value: 25 }, { map_id: 12, value: 3 }];
const encodings = { id: { field: 'map_id' }, color: { field: 'value' } };

describe('choroplethRegion', () => {
    it('draws numeric country codes on the world map', () => {
        expect(choroplethRegion('Choropleth', encodings, rows)).toEqual({ region: 'world' });
        expect(choroplethRegion('Choropleth', encodings, rows, { region: 'auto', colorScheme: 'blues' })).toEqual({ region: 'world', colorScheme: 'blues' });
    });

    it('leaves US FIPS codes, an explicit region and other charts alone', () => {
        expect(choroplethRegion('Choropleth', encodings, [{ map_id: 6, value: 1 }, { map_id: 48, value: 2 }])).toBeUndefined();
        expect(choroplethRegion('Choropleth', encodings, rows, { region: 'us' })).toEqual({ region: 'us' });
        expect(choroplethRegion('Bar Chart', { x: { field: 'map_id' } }, rows)).toBeUndefined();
    });

    it('gives Flint a world base map', () => {
        const spec = assembleVegaLite({ data: { values: rows }, semantic_types: {}, chart_spec: {
            chartType: 'Choropleth', encodings: { id: { field: 'map_id' }, color: { field: 'value', type: 'quantitative' } },
            chartProperties: choroplethRegion('Choropleth', encodings, rows),
        } } as any) as any;
        expect(JSON.stringify(spec)).toContain('world-110m.json');
    });

    it.each([undefined, 'nyt'])('keeps countries without data, in grey (theme %s)', theme => {
        const spec = keepUnmatchedRegions(assembleVegaLite({ data: { values: rows }, semantic_types: {}, chart_spec: {
            chartType: 'Choropleth', encodings: { id: { field: 'map_id' }, color: { field: 'value', type: 'quantitative' } },
            chartProperties: { region: 'world' },
        }, ...(theme ? { theme_spec: theme } : {}) } as any) as any);
        const json = JSON.stringify(spec);
        expect(json).toContain('"invalid":null');
        expect(json).toContain(NO_DATA_FILL);
        expect(() => compile(spec)).not.toThrow();
    });

    it('shades a map by the plain value, not a log scale', () => {
        const wide = [0.0002, 0.3, 1, 5, 20, 60, 100, 200, 400, 578, 2, 3]
            .map((value, index) => ({ map_id: [4, 12, 24, 31, 32, 36, 40, 50, 56, 68, 76, 100][index], value }));
        const raw = assembleVegaLite({ data: { values: wide }, semantic_types: { value: 'Amount' }, chart_spec: {
            chartType: 'Choropleth', encodings: { id: { field: 'map_id' }, color: { field: 'value', type: 'quantitative' } },
            chartProperties: { region: 'world' },
        } } as any) as any;
        expect(raw.encoding.color.scale.type).toBe('log');
        expect(keepUnmatchedRegions(raw).encoding.color.scale.type).toBeUndefined();
    });

    it('leaves charts that are not maps alone', () => {
        const spec = { mark: 'bar', encoding: { color: { field: 'value' } } };
        expect(keepUnmatchedRegions(structuredClone(spec))).toEqual(spec);
    });
});
