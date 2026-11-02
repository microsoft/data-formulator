import { describe, expect, it } from 'vitest';

import * as d3 from 'd3';
import { countryDetail, countryId, countyId, customGeoSet, layerGeoSet, loadGeoSet, regionId, stateId } from '../../../../src/maps/geography';
import { pinJoins } from '../../../../src/maps/MapStylePanel';
import { buildLayer, controlDomain, initialParams, matchesFilter, requiredGeoSets } from '../../../../src/maps/model';
import { colorScale, jenksBreaks, sizeScale } from '../../../../src/maps/scales';
import { mapGeoFiles, mapTables, parseMapSpec, type MapSpec } from '../../../../src/maps/spec';
import { sampleMaps } from '../../../../src/maps/samples';

const spec = (body: Record<string, unknown>): MapSpec => {
    const parsed = parseMapSpec(JSON.stringify(body));
    if (!parsed.spec) throw new Error(parsed.errors.join('; '));
    return parsed.spec;
};

describe('map spec', () => {
    it('parses every sample map without errors', () => {
        for (const sample of sampleMaps()) {
            const parsed = parseMapSpec(JSON.stringify(sample.spec));
            expect(parsed.errors, sample.id).toEqual([]);
        }
    });

    it('explains what is wrong with a broken spec', () => {
        expect(parseMapSpec('{').errors[0]).toMatch(/not valid JSON/);
        const { errors } = parseMapSpec(JSON.stringify({
            data: { d: { values: [] } },
            layers: [{ type: 'regions', data: 'd' }, { type: 'points', data: 'nope', lon: 'x', lat: 'y' },
                { type: 'bubbles', data: 'd', key: 'k', color: { field: { param: 'metric' } } }],
            controls: [{ type: 'select', param: 'other' }],
        }));
        expect(errors).toEqual(expect.arrayContaining([
            expect.stringMatching(/regions need key/),
            expect.stringMatching(/reads data "nope"/),
            expect.stringMatching(/param "metric", which no control defines/),
            expect.stringMatching(/select\) needs options/),
        ]));
    });

    it('lists the tables and boundary files a map reads', () => {
        const parsed = spec({
            data: { a: { table: 'sales' }, b: { sql: 'select 1', tables: ['sales', 'stores'] }, c: { values: [] } },
            layers: [{ type: 'shapes', geo: 'files/zones.geojson' }, { type: 'regions', data: 'a', key: 'zone', geo: 'files/zones.geojson', featureKey: 'NAME' }],
        });
        expect(mapTables(parsed)).toEqual(['sales', 'stores']);
        expect(mapGeoFiles(parsed)).toEqual(['files/zones.geojson']);
        expect(requiredGeoSets(parsed)).toEqual(['countries', 'files/zones.geojson', 'files/zones.geojson#NAME']);
    });
});

describe('region keys', () => {
    it('resolves country codes and name variants', () => {
        for (const value of ['USA', 'US', 'us', 840, '840', 'United States', 'United States of America']) expect(countryId(value)).toBe('USA');
        expect(countryId('Congo, Dem. Rep.')).toBe('COD');
        expect(countryId("Côte d'Ivoire")).toBe('CIV');
        expect(countryId('Türkiye')).toBe('TUR');
        expect(countryId('UK')).toBe('GBR');
        expect(countryId('World')).toBeNull();
        expect(countryId('FR', 'iso3')).toBeNull();
    });

    it('resolves US states and counties', () => {
        expect([stateId('CA'), stateId('california'), stateId(6), stateId('06')]).toEqual(['06', '06', '06', '06']);
        expect(stateId('Washington DC')).toBe('11');
        expect(countyId(6037)).toBe('06037');
    });

    it('joins built-in and custom boundaries', async () => {
        const world = await loadGeoSet('countries');
        expect(world.byId.get('FRA')?.properties.name).toBe('France');
        expect(regionId('Kosovo', world)).toBe('XKX');
        const states = await loadGeoSet('us-states');
        expect(regionId('TX', states)).toBe('48');
        const zones = customGeoSet('files/z.geojson', {
            type: 'FeatureCollection', features: [
                { type: 'Feature', properties: { NAME: 'North' }, geometry: { type: 'Point', coordinates: [0, 1] } },
                { type: 'Feature', properties: { NAME: 'South' }, geometry: { type: 'Point', coordinates: [0, -1] } },
            ],
        }, 'NAME');
        expect(regionId(' north ', zones)).toBe('north');
        expect(regionId('East', zones)).toBeNull();
    });

    it('rewinds counter-clockwise (RFC 7946) polygons so they draw as regions, not the whole globe', () => {
        const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
        const set = customGeoSet('files/sq.geojson', { type: 'FeatureCollection', features: [
            { type: 'Feature', properties: { name: 'sq' }, geometry: { type: 'Polygon', coordinates: [square] } },
        ] });
        const area = d3.geoArea(set.features[0] as never);
        expect(area).toBeLessThan(0.001);
        expect(d3.geoCentroid(set.features[0] as never)[0]).toBeCloseTo(0.5, 1);
    });
});

describe('scales', () => {
    it('classes numbers into quantiles with a legend', () => {
        const scale = colorScale({ field: 'v', classes: 4 }, [1, 2, 3, 4, 5, 6, 7, 8], 'v');
        expect(scale.legend?.kind).toBe('classes');
        expect(scale.color(1)).not.toBe(scale.color(8));
        expect(scale.color(null)).toBe('#e3e3e3');
    });

    it('finds natural breaks', () => {
        expect(jenksBreaks([1, 1, 2, 2, 10, 11, 12, 50, 51], 3)).toEqual([10, 50]);
    });

    it('centres diverging scales on the midpoint', () => {
        const scale = colorScale({ field: 'm', type: 'diverging', midpoint: 0 }, [-10, 30], 'm');
        expect(scale.legend).toMatchObject({ kind: 'gradient', domain: [-30, 30], midpoint: 0 });
    });

    it('colours text and bivariate pairs', () => {
        const categories = colorScale({ field: 'kind' }, ['b', 'a', 'b'], 'kind');
        expect(categories.categorical).toBe(true);
        expect(categories.legend).toMatchObject({ kind: 'categories', items: [{ value: 'a' }, { value: 'b' }] });
        const bivariate = colorScale({ field: 'x', field2: 'y', type: 'bivariate' }, [[1, 1], [5, 5], [9, 9]], 'x', 'y');
        expect(bivariate.legend?.kind).toBe('bivariate');
        expect(bivariate.color([1, 1])).toBe('#e8e8e8');
        expect(bivariate.color([9, 9])).not.toBe(bivariate.color([1, 9]));
    });

    it('sizes bubbles by area', () => {
        const scale = sizeScale({ field: 'p', max: 20 }, [0, 25, 100], 'p', 'circle', { min: 1, max: 32, value: 6 });
        expect(scale.size(100)).toBeCloseTo(20);
        expect(scale.size(25)).toBeCloseTo(10);
        expect(scale.legend?.kind).toBe('sizes');
    });
});

describe('layer model', () => {
    const rows = [
        { country: 'France', year: 2000, v: 1, group: 'a' }, { country: 'FRA', year: 2010, v: 9, group: 'a' },
        { country: 'Germany', year: 2000, v: 2, group: 'b' }, { country: 'DEU', year: 2010, v: 4, group: 'b' },
        { country: 'Atlantis', year: 2010, v: 5, group: 'b' }, { country: 'Antarctica', year: 2010, v: 3, group: 'b' },
    ];

    it('joins rows to regions, filters by controls, and keeps one colour domain across frames', async () => {
        const geoSets = { countries: await loadGeoSet('countries') };
        const map = spec({
            data: { d: { values: rows } },
            layers: [{ id: 'r', type: 'regions', data: 'd', key: 'country', color: { field: 'v', method: 'continuous' } }],
            controls: [{ type: 'slider', field: 'year', data: 'd' }],
        });
        const params = initialParams(map.controls, { d: rows });
        expect(params.year).toBe(2010);
        const model = buildLayer(map, map.layers[0], { d: rows }, params, geoSets);
        expect(model.marks.map(mark => mark.regionId).sort()).toEqual(['DEU', 'FRA']);
        expect(model.unplaced.map(row => row.country)).toEqual(['Atlantis']);
        // Antarctica is a real place the world basemap does not draw.
        expect(model.undrawn.map(row => row.country)).toEqual(['Antarctica']);
        // The 2000 frame's France (1) still gets the lightest colour of the 1–9 domain shared by all frames.
        const earlier = buildLayer(map, map.layers[0], { d: rows }, { year: 2000 }, geoSets);
        const france2000 = earlier.marks.find(mark => mark.regionId === 'FRA')!;
        expect(earlier.color.color(france2000.colorValue)).toBe(model.color.color(1));
        expect(model.color.legend).toMatchObject({ kind: 'gradient', domain: [1, 9] });
    });

    it('recomputes the shared frame domain when another param filters the rows', async () => {
        const geoSets = { countries: await loadGeoSet('countries') };
        const map = spec({
            data: { d: { values: rows } },
            layers: [{ id: 'r', type: 'regions', data: 'd', key: 'country', filter: [{ field: 'v', op: '>=', value: { param: 'minV' } }],
                color: { field: 'v', method: 'continuous' } }],
            controls: [{ type: 'slider', field: 'year', data: 'd' }, { type: 'slider', param: 'minV', min: 0, max: 10 }],
        });
        const all = buildLayer(map, map.layers[0], { d: rows }, { year: 2010, minV: 0 }, geoSets);
        const high = buildLayer(map, map.layers[0], { d: rows }, { year: 2010, minV: 4 }, geoSets);
        expect(all.color.legend).toMatchObject({ domain: [1, 9] });
        expect(high.color.legend).toMatchObject({ domain: [4, 9] });
        // Moving the stepped slider itself reuses the domain.
        expect(buildLayer(map, map.layers[0], { d: rows }, { year: 2000, minV: 4 }, geoSets).color.legend).toMatchObject({ domain: [4, 9] });
    });

    it('aggregates rows per region and follows another layer’s selection', async () => {
        const geoSets = { countries: await loadGeoSet('countries') };
        const map = spec({
            data: { d: { values: rows } },
            layers: [
                { id: 'r', type: 'regions', data: 'd', key: 'country', color: { field: 'v', aggregate: 'sum' } },
                { id: 'p', type: 'bubbles', data: 'd', key: 'country', size: { field: 'v' }, selectionFilter: { layer: 'r', field: 'group' } },
            ],
        });
        const regions = buildLayer(map, map.layers[0], { d: rows }, {}, geoSets);
        expect(regions.marks.find(mark => mark.regionId === 'FRA')?.colorValue).toBe(10);
        const selected = { layerId: 'r', rows: regions.marks.find(mark => mark.regionId === 'DEU')!.rows };
        const linked = buildLayer(map, map.layers[1], { d: rows }, {}, geoSets, selected);
        expect(linked.marks.map(mark => mark.regionId)).toEqual(['DEU']);
    });

    it('places flows and lists control values', async () => {
        const geoSets = { countries: await loadGeoSet('countries') };
        const flows = [{ from: 'MEX', to: 'USA', n: 5 }, { from: 'Nowhere', to: 'USA', n: 1 }];
        const map = spec({ data: { f: { values: flows } }, layers: [{ type: 'flows', data: 'f', from: { key: 'from' }, to: { key: 'to' }, size: { field: 'n' } }],
            controls: [{ type: 'checkboxes', field: 'from', data: 'f' }] });
        const model = buildLayer(map, map.layers[0], { f: flows }, initialParams(map.controls, { f: flows }), geoSets);
        expect(model.marks).toHaveLength(1);
        expect(model.marks[0].label).toBe('MEX → USA');
        expect(model.unplaced).toHaveLength(1);
        expect(controlDomain(map.controls[0], { f: flows })).toEqual(['MEX', 'Nowhere']);
    });

    it('matches filters with params, ranges, and dates', () => {
        const row = { year: 2010, kind: 'Taxi', when: '2020-05-01' };
        expect(matchesFilter(row, { field: 'year', op: 'between', value: { param: 'range' } }, { range: [2000, 2015] })).toBe(true);
        expect(matchesFilter(row, { field: 'kind', op: 'in', value: ['Bike'] }, {})).toBe(false);
        expect(matchesFilter(row, { field: 'when', op: '>=', value: '2020-01-01' }, {})).toBe(true);
        expect(matchesFilter(row, { field: 'kind', value: { param: 'unset' } }, {})).toBe(true);
    });
});

describe('boundaries across basemaps and zoom', () => {
    it('keeps a layer joined to US states when the basemap becomes the world', () => {
        const draft = { view: { basemap: 'us-states' }, layers: [
            { type: 'regions', key: 'state' }, { type: 'regions', key: 'iso3', keyType: 'iso3' },
            { type: 'flows', from: { key: 'a' }, to: { lon: 'x', lat: 'y' } }, { type: 'points', lon: 'x', lat: 'y' }] };
        pinJoins(draft, 'us-states', 'world');
        expect(draft.layers.map(layer => (layer as { geo?: string }).geo)).toEqual(['us-states', undefined, undefined, undefined]);
        expect((draft.layers[2] as { from: { geo?: string } }).from.geo).toBe('us-states');
        // Between world basemaps the countries join needs no pin.
        const world = { layers: [{ type: 'regions', key: 'country' }] };
        pinJoins(world, 'world', 'world-detailed');
        expect((world.layers[0] as { geo?: string }).geo).toBeUndefined();
        expect(layerGeoSet('countries', undefined, 'world-detailed')).toBe('countries-detailed');
    });

    it('picks finer world boundaries as the map zooms in', () => {
        expect(countryDetail(1200, 'world')).toBe(0);
        expect(countryDetail(1200, 'world-detailed')).toBe(1);
        expect(countryDetail(6000, 'world')).toBe(1);
        expect(countryDetail(40000, 'world')).toBe(2);
    });
});
