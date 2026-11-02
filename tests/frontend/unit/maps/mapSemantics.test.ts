import { describe, expect, it } from 'vitest';

import { loadGeoSet } from '../../../../src/maps/geography';
import { buildLayer } from '../../../../src/maps/model';
import { formatter } from '../../../../src/maps/scales';
import { annotateField, humanize, resolveField } from '../../../../src/maps/semantics';
import { parseMapSpec, type MapSpec } from '../../../../src/maps/spec';
import { mapStyle, themeInk } from '../../../../src/maps/styles';

const spec = (body: Record<string, unknown>): MapSpec => {
    const parsed = parseMapSpec(JSON.stringify(body));
    if (!parsed.spec) throw new Error(parsed.errors.join('; '));
    return parsed.spec;
};

describe('field semantics', () => {
    it('guesses types from names and values, and keeps declared ones', () => {
        expect(annotateField('poverty_rate', [12.5, 8])).toMatchObject({ semanticType: 'Percentage' });
        expect(annotateField('share', [0.2, 0.5])).toMatchObject({ semanticType: 'Percentage', intrinsicDomain: [0, 1] });
        expect(annotateField('gdp_usd', [1, 2])).toMatchObject({ semanticType: 'Amount', unit: 'USD' });
        expect(annotateField('vote_margin', [-3, 4])).toMatchObject({ semanticType: 'PercentageChange' });
        expect(annotateField('region', ['a', 'b'])).toMatchObject({ semanticType: 'Category' });
        expect(annotateField('poverty_rate', [1], { semanticType: 'Score' })).toMatchObject({ semanticType: 'Score' });
        expect(humanize('life_expectancy')).toBe('Life expectancy');
        expect(resolveField('nuclear_electricity_twh', [1, 2], { semanticType: 'Quantity', unit: 'TWh' }).label).toBe('Nuclear electricity (TWh)');
    });

    it('resolves aggregation, colour type, and units the way charts do', () => {
        const amount = resolveField('income', [100, 2000], { semanticType: 'Amount', unit: 'USD' });
        expect(amount).toMatchObject({ aggregate: 'sum', colorType: 'sequential', additive: true, label: 'Income (US$)' });
        expect(amount.format?.prefix).toBe('$');
        const rate = resolveField('rate', [1, 5], { semanticType: 'Percentage' });
        expect(rate).toMatchObject({ aggregate: 'mean', additive: false });
        const change = resolveField('margin', [-4, 6], { semanticType: 'PercentageChange', unit: 'pts', displayName: 'Margin' });
        expect(change).toMatchObject({ colorType: 'diverging', midpoint: 0, label: 'Margin (pts)' });
        const pivot = resolveField('temp', [10, 30], { semanticType: 'Temperature', divergingMidpoint: 18 });
        expect(pivot).toMatchObject({ colorType: 'diverging', midpoint: 18 });
    });

    it('formats with a currency before the sign', () => {
        expect(formatter(undefined, '$')(-1234567)).toBe('−$1.23M');
        expect(formatter(undefined, '', ' kt')(42)).toBe('42 kt');
    });
});

describe('styles and themes', () => {
    it('reads a Flint chart theme as the map palette', () => {
        const ink = themeInk('datawrapper')!;
        expect(ink.palette.single).toBe('#18a1cd');
        expect(ink.palette.classes).toBe(5);
        expect(typeof ink.palette.sequential).toBe('function');
        expect(themeInk('none')).toBeUndefined();
        expect(mapStyle('dark').mode).toBe('dark');
        expect(mapStyle(undefined).id).toBe('light');
    });

    it('parses styles, themes, and field annotations', () => {
        const parsed = parseMapSpec(JSON.stringify({ view: { style: 'atlas', theme: 'nyt', labels: false },
            fields: { pop: 'Count', gdp: { semanticType: 'Amount', unit: 'USD' } }, layers: [] }));
        expect(parsed.spec?.fields).toEqual({ pop: { semanticType: 'Count' }, gdp: { semanticType: 'Amount', unit: 'USD' } });
        expect(parseMapSpec(JSON.stringify({ view: { style: 'neon' }, layers: [] })).errors[0]).toMatch(/view.style/);
    });

    it('fills encodings from semantics under the theme, with the spec winning', async () => {
        const geoSets = { countries: await loadGeoSet('countries') };
        const rows = [{ c: 'France', margin: -5, pop: 10 }, { c: 'France', margin: 3, pop: 5 }, { c: 'Brazil', margin: 8, pop: 20 }];
        const map = spec({ data: { d: { values: rows } }, fields: { margin: 'PercentageChange', pop: 'Count' },
            layers: [{ id: 'a', type: 'regions', data: 'd', key: 'c', color: { field: 'margin' } },
                { id: 'b', type: 'regions', data: 'd', key: 'c', color: { field: 'pop' } },
                { id: 'c', type: 'regions', data: 'd', key: 'c', color: { field: 'margin', type: 'quantitative', title: 'Mine' } }] });
        const palette = themeInk('datawrapper')!.palette;
        const [diverging, totals, explicit] = map.layers.map(layer => buildLayer(map, layer, { d: rows }, {}, geoSets, null, { palette }));
        expect(diverging.color.legend).toMatchObject({ kind: 'gradient', midpoint: 0, title: 'Margin' });
        // A rate averages across rows; a count sums.
        expect(diverging.marks.find(mark => mark.regionId === 'FRA')?.colorValue).toBe(-1);
        expect(totals.marks.find(mark => mark.regionId === 'FRA')?.colorValue).toBe(15);
        expect(totals.color.legend).toMatchObject({ kind: 'classes', title: 'Pop' });
        expect(explicit.color.legend).toMatchObject({ title: 'Mine' });
        expect(explicit.color.legend?.kind).not.toBe('gradient');
        expect(diverging.describe('pop').label).toBe('Pop');
    });
});
