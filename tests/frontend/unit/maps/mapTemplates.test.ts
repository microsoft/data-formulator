import { describe, expect, it } from 'vitest';

import { parseMapSpec } from '../../../../src/maps/spec';
import { bindChannel, compatibleTemplates, compileTemplate, switchTemplate, templateErrors } from '../../../../src/maps/templates';

describe('map templates', () => {
    it('compiles a choropleth with time, filter, and interaction kit', () => {
        const compiled = compileTemplate({ template: 'choropleth', data: { table: 'indicators' },
            encoding: { region: 'country', color: 'gdp', time: 'year', filter: 'continent' }, properties: { geography: 'world', classes: 4 } });
        expect(compiled.data).toEqual({ main: { table: 'indicators' } });
        expect(compiled.layers[0]).toMatchObject({ type: 'regions', key: 'country', geo: 'countries', color: { field: 'gdp', classes: 4 }, tooltip: ['gdp'] });
        expect(compiled.controls.map(control => control.type)).toEqual(['slider', 'checkboxes', 'search', 'details']);
        expect(compiled.view).toEqual({ basemap: 'world' });
    });

    it('compiles flows, density, and cartograms', () => {
        expect(compileTemplate({ template: 'flows', data: { table: 't' }, encoding: { origin: 'from', destination: 'to', size: 'n' },
            properties: { curve: 'great-circle' } }).layers[0]).toMatchObject({ type: 'flows', from: { key: 'from' }, to: { key: 'to' }, curve: 'great-circle' });
        expect(compileTemplate({ template: 'density', data: { table: 't' }, encoding: { lat: 'y', lon: 'x' }, properties: { density: 'heatmap' } })
            .layers[0]).toMatchObject({ type: 'heatmap', lat: 'y', lon: 'x' });
        expect(compileTemplate({ template: 'cartogram', data: { table: 't' }, encoding: { region: 'state', size: 'pop' } }).layers[0])
            .toMatchObject({ type: 'bubbles', layout: 'dorling', text: 'state' });
    });

    it('explains missing channels', () => {
        expect(templateErrors({ template: 'bubbles', data: { table: 't' }, encoding: { color: 'x' } })).toEqual([
            'Bubble map needs encoding.size.', 'Bubble map needs encoding.region, or encoding.lat and encoding.lon.']);
        expect(templateErrors({ template: 'pie', data: {}, encoding: {} })[0]).toMatch(/template must be one of/);
        expect(templateErrors({ template: 'choropleth', data: { table: 't' }, encoding: { region: 'r', color: 'c', colour: 'x' } })[0])
            .toMatch(/encoding.colour is not a channel/);
        expect(parseMapSpec(JSON.stringify({ template: 'choropleth', data: { table: 't' }, encoding: { region: 'r', color: 'c' }, layers: [] })).errors)
            .toContain('Give template (with encoding) or layers, not both.');
    });

    it('parses a template map and keeps it for editing', () => {
        const parsed = parseMapSpec(JSON.stringify({ title: 'T', template: 'bubbles', data: { values: [{ x: 1, y: 2, n: 3 }] },
            encoding: { lat: 'y', lon: 'x', size: 'n' }, view: { style: 'dark' }, controls: [{ type: 'stats', layer: 'main' }] }));
        expect(parsed.errors).toEqual([]);
        expect(parsed.template?.template).toBe('bubbles');
        expect(parsed.spec?.view.style).toBe('dark');
        expect(parsed.spec?.controls.map(control => control.type)).toEqual(['details', 'stats']);
    });

    it('offers compatible map types and carries channels across a switch', () => {
        expect(compatibleTemplates({ region: 'state', color: 'rate' })).toEqual(['choropleth', 'bubbles', 'spikes', 'cartogram']);
        expect(compatibleTemplates({ lat: 'y', lon: 'x' })).toEqual(['points', 'density']);
        expect(compatibleTemplates({ origin: 'a', destination: 'b' })).toEqual(['flows']);
        expect(switchTemplate({ region: 'state', color: 'pop' }, 'bubbles')).toEqual({ region: 'state', color: 'pop', size: 'pop' });
        expect(switchTemplate({ region: 'state', size: 'pop', label: 'abbr' }, 'choropleth')).toEqual({ region: 'state', color: 'pop', label: 'abbr' });
    });

    it('turns offered columns into a switch and lets people pick among them', () => {
        const compiled = compileTemplate({ template: 'bubbles', data: { table: 't' }, encoding: {
            region: 'country', size: ['fossil', 'nuclear'], color: ['fossil', 'nuclear'], time: { options: ['year'] }, filter: { field: 'continent', options: ['income', 'continent'] },
        } });
        expect(compiled.layers[0]).toMatchObject({ size: { field: { param: 'color' } }, color: { field: { param: 'color' } }, tooltip: ['fossil', 'nuclear'] });
        // Color and size offered the same columns share one switch; time with no column shown has no slider.
        expect(compiled.controls.map(control => control.type)).toEqual(['select', 'checkboxes', 'search', 'details']);
        expect(compiled.controls[0]).toMatchObject({ param: 'color', value: 'fossil', options: [{ value: 'fossil' }, { value: 'nuclear' }] });
        expect(compiled.controls[1]).toMatchObject({ field: 'continent' });
        expect(parseMapSpec(JSON.stringify({ template: 'bubbles', data: { values: [{ c: 'USA', a: 1, b: 2 }] },
            encoding: { region: 'c', size: { field: 'b', options: ['a', 'b'] } } })).errors).toEqual([]);

        expect(bindChannel(['a', 'b'], 'a')).toEqual(['a', 'b']);
        expect(bindChannel(['a', 'b'], 'b')).toEqual({ field: 'b', options: ['a', 'b'] });
        expect(bindChannel(['year'], undefined)).toEqual({ options: ['year'] });
        expect(bindChannel(['year'], 'year')).toBe('year');

        expect(templateErrors({ template: 'choropleth', data: { table: 't' }, encoding: { region: ['a', 'b'], color: 'c' } })[0]).toMatch(/region must be one column/);
        expect(templateErrors({ template: 'choropleth', data: { table: 't' }, encoding: { region: 'r', color: { field: 'z', options: ['c'] } } }))
            .toContain('encoding.color.field must be one of its options.');
        expect(templateErrors({ template: 'choropleth', data: { table: 't' }, encoding: { region: 'r', color: { options: ['c'] } } }))
            .toContain('Choropleth needs encoding.color.');
        expect(compatibleTemplates({ region: 'r', color: { options: ['c'] } })).toEqual([]);
    });
});

describe('vector maps and flow direction', () => {
    it('compiles vectors from u/v or an angle, and gives lines a direction', () => {
        const uv = compileTemplate({ template: 'vectors', data: { table: 'w' }, encoding: { lat: 'lat', lon: 'lon', u: 'u', v: 'v', color: 'speed' } });
        expect(uv.layers[0]).toMatchObject({ type: 'vectors', u: 'u', v: 'v', color: { field: 'speed' }, tooltip: ['speed', 'u', 'v'] });
        expect(compileTemplate({ template: 'vectors', data: { table: 'w' }, encoding: { lat: 'lat', lon: 'lon', angle: 'heading' } }).layers[0])
            .toMatchObject({ angle: 'heading' });
        expect(templateErrors({ template: 'vectors', data: { table: 'w' }, encoding: { lat: 'lat', lon: 'lon', u: 'u' } }))
            .toContain('encoding.u and encoding.v go together (east and north components).');
        expect(compatibleTemplates({ lat: 'y', lon: 'x', angle: 'a' })).toContain('vectors');
        expect(compileTemplate({ template: 'flows', data: { table: 't' }, encoding: { origin: 'a', destination: 'b' } }).layers[0].direction).toBe('arrow');
        expect(compileTemplate({ template: 'tracks', data: { table: 't' }, encoding: { lat: 'y', lon: 'x', group: 'g' } }).layers[0].direction).toBe('arrow');
        expect(compileTemplate({ template: 'flows', data: { table: 't' }, encoding: { origin: 'a', destination: 'b' }, properties: { direction: 'animate' } })
            .layers[0].direction).toBe('animate');
    });
});

describe('template colours', () => {
    it('uses the given colour or scheme, else the theme', () => {
        const flows = { template: 'flows' as const, data: { table: 't' }, encoding: { origin: 'a', destination: 'b' } };
        expect(compileTemplate({ ...flows, properties: { color: '#e15759' } }).layers[0].color).toEqual({ value: '#e15759' });
        expect(compileTemplate(flows).layers[0].color).toBeUndefined();
        // A colour column wins over the constant.
        expect(compileTemplate({ ...flows, encoding: { ...flows.encoding, color: 'kind' }, properties: { color: '#e15759' } }).layers[0].color)
            .toEqual({ field: 'kind' });
        // Tracks colour by group unless given one colour.
        const tracks = { template: 'tracks' as const, data: { table: 't' }, encoding: { lat: 'y', lon: 'x', group: 'g' } };
        expect(compileTemplate(tracks).layers[0].color).toEqual({ field: 'g' });
        expect(compileTemplate({ ...tracks, properties: { color: 'darkslategray' } }).layers[0].color).toEqual({ value: 'darkslategray' });
        // Density takes the scheme for its counts.
        expect(compileTemplate({ template: 'density', data: { table: 't' }, encoding: { lat: 'y', lon: 'x' }, properties: { scheme: 'ylOrRd' } }).layers[0].color)
            .toEqual({ scheme: 'ylOrRd' });
        expect(templateErrors({ ...flows, properties: { color: 'not a colour' } })).toContain('properties.color must be a CSS colour, such as "#4e79a7" or "darkslategray".');
    });
});
