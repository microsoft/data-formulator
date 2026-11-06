// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The `@df/geo` app module: offline world and US boundaries (the sandbox has no
 * network). Feature ids are numbers: ISO 3166-1 numeric for countries, FIPS for
 * states, the same ids Flint's Map and Choropleth charts join on. Names are in
 * `properties.name`. The same topologies back Flint's basemaps (see chart.tsx).
 *
 * Sources: world-atlas (Natural Earth 1:110m) and us-atlas (US Census 1:10m).
 */

import { feature, merge, mesh, neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { assembleVegaLite } from 'flint-chart/vegalite';
import countries110m from 'world-atlas/countries-110m.json';
import states10m from 'us-atlas/states-10m.json';
import countiesAlbers10m from 'us-atlas/counties-albers-10m.json';

import { registerOptionalModule } from './register';

type Atlas = Topology<Record<string, GeometryCollection>>;

/** The atlas packages use zero-padded string ids ("004", "01"); Flint's joins use numbers. */
const withNumericIds = (topology: unknown): Atlas => {
    const source = topology as Atlas;
    return {
        ...source,
        objects: Object.fromEntries(Object.entries(source.objects).map(([name, object]) => [name, {
            ...object,
            geometries: (object.geometries ?? []).map(geometry =>
                geometry.id === undefined ? geometry : { ...geometry, id: Number(geometry.id) }),
        }])),
    };
};

/** World countries: objects `countries` and `land`. */
export const world = withNumericIds(countries110m);
/** US states (unprojected; use an Albers USA projection): objects `states` and `nation`. */
export const us = withNumericIds(states10m);
/**
 * US states and counties already projected to Albers USA (975×610), with the atlas's own string ids:
 * the basemap of Flint's US choropleths, which convert the ids themselves.
 */
export const usAlbers = countiesAlbers10m as unknown as Atlas;

export const countries = () => feature(world, world.objects.countries).features;
export const land = () => feature(world, world.objects.land);
export const countryBorders = () => mesh(world, world.objects.countries, (a, b) => a !== b);
export const states = () => feature(us, us.objects.states).features;
export const nation = () => feature(us, us.objects.nation);
export const stateBorders = () => mesh(us, us.objects.states, (a, b) => a !== b);

const geo = { world, us, usAlbers, countries, land, countryBorders, states, nation, stateBorders, feature, mesh, merge, neighbors };

registerOptionalModule('@df/geo', geo);
// Choropleths draw through Flint's static compiler, so places without data keep their shape (see
// chartMaps.keepUnmatchedRegions); it rides with the boundaries every map app loads.
registerOptionalModule('@df/geo/flint', { assembleVegaLite });
