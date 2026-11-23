import { describe, expect, it } from 'vitest';
import * as d3 from 'd3';

import {
    chartCategoryColors, colorPool, registerCategoryColors, sessionPins, sessionValueColors,
    type SessionCategoryColors,
} from '../../../../src/app/categoryColors';
import { FLINT_INPUT, assembleVegaChart } from '../../../../src/app/utils';
import { loadGeoSet } from '../../../../src/maps/geography';
import { buildLayer } from '../../../../src/maps/model';
import { parseMapSpec } from '../../../../src/maps/spec';

const DATAWRAPPER = ['#18a1cd', '#c71e1d', '#fa8c00', '#09bb9f', '#15607a', '#009076', '#ffca76', '#1d81a2', '#00dca6', '#c4c4c4', '#ffe59c'];
const empty = (): SessionCategoryColors => ({ registry: {}, pins: { byKind: {}, byValue: {} } });
const country = { semanticType: 'Country' };

/** Draw a chart of `values` and keep what it registers, as the app does. */
function draw(session: SessionCategoryColors, values: string[], field = 'country', annotation?: object) {
    const result = sessionValueColors(session, field, annotation, values, DATAWRAPPER);
    if (result.register) session.registry = registerCategoryColors(session.registry, result.register);
    return result.colors ?? {};
}

describe('session category colours', () => {
    it('keeps a value\'s colour when a follow-up chart adds others', () => {
        const session = empty();
        const first = draw(session, ['China'], 'country', country);
        const second = draw(session, ['United States', 'China'], 'country', country);
        const third = draw(session, ['China', 'Japan', 'United States'], 'nation', country);
        expect(second.China).toBe(first.China);
        // Countries share colours across columns and tables: the kind is the semantic type.
        expect(third.China).toBe(first.China);
        expect(third['United States']).toBe(second['United States']);
        expect(new Set(Object.values(third)).size).toBe(3);
    });

    it('gives late values strong, distinct colours rather than the palette\'s pale or grey tail', () => {
        const session = empty();
        const pool = colorPool(DATAWRAPPER).map(item => item.color);
        expect(pool).not.toContain('#c4c4c4');
        expect(pool).not.toContain('#ffe59c');
        // Too close to an earlier blue to tell apart.
        expect(pool).not.toContain('#1d81a2');
        draw(session, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 'region', undefined);
        const late = draw(session, ['A', 'Y', 'Z'], 'region', undefined);
        for (const color of Object.values(late)) {
            expect(pool).toContain(color);
            expect(d3.hcl(color).c).toBeGreaterThanOrEqual(20);
        }
        expect(new Set(Object.values(late)).size).toBe(3);
    });

    it('lets values that share a slot meet: the earlier keeps its colour', () => {
        const session = empty();
        const size = colorPool(DATAWRAPPER).length;
        const many = Array.from({ length: size }, (_, index) => `v${index}`);
        draw(session, many, 'region', undefined);
        const reused = draw(session, ['late'], 'region', undefined);
        const owner = Object.entries(draw(session, many, 'region', undefined)).find(([, color]) => color === reused.late)![0];
        const together = draw(session, [owner, 'late'], 'region', undefined);
        expect(together[owner]).toBe(reused.late);
        expect(together.late).not.toBe(reused.late);
        // Only first sightings are registered; the clash stays local to that chart.
        expect(draw(session, ['late'], 'region', undefined).late).toBe(reused.late);
    });

    it('applies pinned colours across the session, the field\'s own first', () => {
        const pins = sessionPins([
            { fields: { party: { semanticType: 'Category', colors: { Democratic: '#1f5fbf', Republican: '#d62728' } } } },
            { fields: { winner: { semanticType: 'Category', authored: { colors: { Democratic: '#1f5fbf', Other: '#999999' } } } } },
            { fields: { answer: { colors: { Yes: '#2ca02c' } } }, },
            { fields: { vote: { colors: { Yes: '#d62728' } } } },
        ]);
        const session = { ...empty(), pins };
        // Same column name in another table: the kind's pins.
        expect(sessionValueColors(session, 'party', { semanticType: 'Category' }, ['Republican', 'Green'], DATAWRAPPER).colors?.Republican).toBe('#d62728');
        // A value pinned one way everywhere follows it into other fields; a value pinned two ways does not.
        const other = sessionValueColors(session, 'candidate_party', undefined, ['Democratic', 'Yes', 'Green'], DATAWRAPPER).colors!;
        expect(other.Democratic).toBe('#1f5fbf');
        expect(other.Yes).not.toBe('#2ca02c');
        expect(other.Yes).not.toBe('#d62728');
        // The field's own colours win, and other values keep clear of colours pinned for this kind anywhere in the session.
        const own = sessionValueColors(session, 'party', { colors: { Democratic: '#000080' } }, ['Democratic', 'Green'], ['#1f5fbf', '#18a1cd', '#fa8c00']).colors!;
        expect(own.Democratic).toBe('#000080');
        expect(own.Green).toBe('#18a1cd');
        const near = sessionValueColors(session, 'party', undefined, ['Democratic', 'Green'], ['#2060c0', '#fa8c00']).colors!;
        expect(near.Green).toBe('#fa8c00');
    });

    it('leaves amounts, times, ranks, and role values to the chart', () => {
        const session = empty();
        expect(sessionValueColors(session, 'year', { semanticType: 'Year' }, ['2020', '2021'], DATAWRAPPER)).toEqual({});
        expect(sessionValueColors(session, 'code', undefined, ['1', '2', '3'], DATAWRAPPER)).toEqual({});
        expect(sessionValueColors(session, 'size', { sortOrder: ['S', 'M', 'L'] }, ['S', 'M'], DATAWRAPPER)).toEqual({});
        const roles = sessionValueColors(session, 'country', country, ['China', 'Other'], DATAWRAPPER);
        expect(Object.keys(roles.colors!)).toEqual(['China']);
        expect(Object.keys(roles.register!.entries)).toEqual(['china']);
        // More values than strong colours: the chart's own palette serves better than a partial identity.
        expect(sessionValueColors(session, 'region', undefined, Array.from({ length: 30 }, (_, index) => `r${index}`), DATAWRAPPER)).toEqual({});
    });

    it('reaches charts through the colour encoding, unless the chart picks a scheme', () => {
        const session = empty();
        const fields = [{ id: 'f1', name: 'country' }, { id: 'f2', name: 'gdp' }];
        const rows = [{ country: 'China', gdp: 10 }, { country: 'Japan', gdp: 5 }];
        const result = chartCategoryColors(session, { x: { fieldID: 'f1' }, y: { fieldID: 'f2' }, color: { fieldID: 'f1' } }, fields, rows,
            { country: { semanticType: 'Country' } } as never, undefined);
        expect(Object.keys(result.colors!)).toEqual(['China', 'Japan']);
        expect(chartCategoryColors(session, { color: { fieldID: 'f1', scheme: 'set2' } }, fields, rows, undefined, undefined)).toEqual({});
        const spec = assembleVegaChart('Bar Chart', { x: { fieldID: 'f1' }, y: { fieldID: 'f2' }, color: { fieldID: 'f1' } } as never,
            fields as never, rows, {}, 300, 300, false, undefined, 1, undefined, undefined, undefined, undefined, undefined, undefined, result.colors);
        expect(spec[FLINT_INPUT].chart_spec.encodings.color.colors).toEqual(result.colors);
    });

    it('reaches maps through their categorical colour scale', async () => {
        const geoSets = { countries: await loadGeoSet('countries') };
        const rows = [{ c: 'France', bloc: 'EU' }, { c: 'Brazil', bloc: 'Mercosur' }];
        const map = parseMapSpec(JSON.stringify({ data: { d: { values: rows } },
            layers: [{ id: 'a', type: 'regions', data: 'd', key: 'c', color: { field: 'bloc', type: 'categorical' } }] })).spec!;
        const session = empty();
        draw(session, ['Mercosur'], 'bloc', undefined);
        const chartColor = draw(session, ['Mercosur', 'EU'], 'bloc', undefined);
        const layer = buildLayer(map, map.layers[0], { d: rows }, {}, geoSets, null, {
            categoryColors: (field, annotation, domain, palette, surface) => sessionValueColors(session, field, annotation, domain, DATAWRAPPER, surface).colors,
        });
        expect(layer.color.color('Mercosur')).toBe(chartColor.Mercosur);
        expect(layer.color.color('EU')).toBe(chartColor.EU);
    });
});
