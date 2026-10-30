// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Offline geography for maps: built-in boundary sets and the key lookups that join
 * data rows to them.
 *
 * Region ids are canonical strings: ISO 3166-1 alpha-3 for countries ("USA"),
 * two-digit FIPS for US states ("06"), five-digit FIPS for counties ("06037"), and
 * the normalized `featureKey` value for custom GeoJSON/TopoJSON files.
 *
 * Sources: World Bank Official Boundaries (CC BY 4.0; the UN-system depiction of borders, with areas of
 * non-determined legal status kept separate), simplified to three levels of detail by
 * ./data/world-bank/build.sh; us-atlas (US Census 1:10m).
 */

import { geoArea } from 'd3';
import type { Feature, FeatureCollection, Geometry, MultiLineString, Position } from 'geojson';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

import countryTable from './data/countries.json';
import type { BasemapName, GeoSetName, KeyType } from './spec';

export type RegionFeature = Feature<Geometry, { name: string; id: string; [key: string]: unknown }>;

export interface GeoSet {
    name: string;
    features: RegionFeature[];
    byId: Map<string, RegionFeature>;
    /** Interior borders, drawn once. */
    borders: MultiLineString | null;
    /** The outer outline (land, nation) for the basemap fill. */
    outline: Feature | FeatureCollection | null;
    /** World sets: borders of areas whose legal status is not determined, drawn dotted (and left out of `borders`). */
    disputedBorders?: MultiLineString;
    /** World sets: the coastline without Antarctica, drawn while Antarctica is left off the map. */
    outlineWithoutAntarctica?: Feature;
}

interface CountryRow { n: string | null; a2: string; a3: string; name: string; aliases: string[] }
const COUNTRIES = countryTable as CountryRow[];

/** Lower-case, strip accents and punctuation, drop a leading "the". */
export const normalizeName = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[.'’`,()]/g, '').replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^the /, '');

const countryByNumeric = new Map(COUNTRIES.filter(row => row.n).map(row => [row.n as string, row]));
const countryByA2 = new Map(COUNTRIES.map(row => [row.a2, row]));
const countryByA3 = new Map(COUNTRIES.map(row => [row.a3, row]));
const countryByName = new Map<string, CountryRow>();
for (const row of COUNTRIES) {
    for (const alias of [row.name, ...row.aliases]) {
        const key = normalizeName(alias);
        if (!countryByName.has(key)) countryByName.set(key, row);
    }
}

/** The canonical display name of a country by ISO alpha-3. */
export const countryName = (a3: string): string | undefined => countryByA3.get(a3)?.name;

// USPS abbreviation, FIPS, name.
const US_STATES: [string, string, string][] = [
    ['AL', '01', 'Alabama'], ['AK', '02', 'Alaska'], ['AZ', '04', 'Arizona'], ['AR', '05', 'Arkansas'], ['CA', '06', 'California'],
    ['CO', '08', 'Colorado'], ['CT', '09', 'Connecticut'], ['DE', '10', 'Delaware'], ['DC', '11', 'District of Columbia'],
    ['FL', '12', 'Florida'], ['GA', '13', 'Georgia'], ['HI', '15', 'Hawaii'], ['ID', '16', 'Idaho'], ['IL', '17', 'Illinois'],
    ['IN', '18', 'Indiana'], ['IA', '19', 'Iowa'], ['KS', '20', 'Kansas'], ['KY', '21', 'Kentucky'], ['LA', '22', 'Louisiana'],
    ['ME', '23', 'Maine'], ['MD', '24', 'Maryland'], ['MA', '25', 'Massachusetts'], ['MI', '26', 'Michigan'], ['MN', '27', 'Minnesota'],
    ['MS', '28', 'Mississippi'], ['MO', '29', 'Missouri'], ['MT', '30', 'Montana'], ['NE', '31', 'Nebraska'], ['NV', '32', 'Nevada'],
    ['NH', '33', 'New Hampshire'], ['NJ', '34', 'New Jersey'], ['NM', '35', 'New Mexico'], ['NY', '36', 'New York'],
    ['NC', '37', 'North Carolina'], ['ND', '38', 'North Dakota'], ['OH', '39', 'Ohio'], ['OK', '40', 'Oklahoma'], ['OR', '41', 'Oregon'],
    ['PA', '42', 'Pennsylvania'], ['RI', '44', 'Rhode Island'], ['SC', '45', 'South Carolina'], ['SD', '46', 'South Dakota'],
    ['TN', '47', 'Tennessee'], ['TX', '48', 'Texas'], ['UT', '49', 'Utah'], ['VT', '50', 'Vermont'], ['VA', '51', 'Virginia'],
    ['WA', '53', 'Washington'], ['WV', '54', 'West Virginia'], ['WI', '55', 'Wisconsin'], ['WY', '56', 'Wyoming'],
    ['AS', '60', 'American Samoa'], ['GU', '66', 'Guam'], ['MP', '69', 'Northern Mariana Islands'], ['PR', '72', 'Puerto Rico'],
    ['VI', '78', 'U.S. Virgin Islands'],
];
const stateByAbbr = new Map(US_STATES.map(([abbr, fips]) => [abbr, fips]));
const abbrByState = new Map(US_STATES.map(([abbr, fips]) => [fips, abbr]));
/** A state's postal code by FIPS ("06" → "CA"). */
export const stateAbbr = (fips: string): string | undefined => abbrByState.get(fips);
const stateByName = new Map(US_STATES.map(([, fips, name]) => [normalizeName(name), fips]));
stateByName.set(normalizeName('Washington DC'), '11');
stateByName.set(normalizeName('Washington D.C.'), '11');
stateByName.set(normalizeName('Commonwealth of the Northern Mariana Islands'), '69');
stateByName.set(normalizeName('United States Virgin Islands'), '78');

const pad = (value: string | number, width: number) => String(value).trim().padStart(width, '0');
const integerText = (value: unknown): string | null => {
    if (typeof value === 'number' && Number.isInteger(value)) return String(value);
    if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) return value.trim();
    return null;
};

/** A country's ISO alpha-3 from a code or name of the given kind. */
export function countryId(value: unknown, keyType: KeyType = 'auto'): string | null {
    if (value === null || value === undefined || value === '') return null;
    const digits = integerText(value);
    if (keyType === 'iso-numeric' || (keyType === 'auto' && digits !== null)) {
        return digits === null ? null : countryByNumeric.get(pad(digits, 3))?.a3 ?? null;
    }
    const text = String(value).trim();
    const upper = text.toUpperCase();
    if (keyType === 'iso2' || (keyType === 'auto' && /^[A-Za-z]{2}$/.test(text))) {
        const found = countryByA2.get(upper === 'UK' ? 'GB' : upper)?.a3;
        if (found || keyType === 'iso2') return found ?? null;
    }
    if (keyType === 'iso3' || (keyType === 'auto' && /^[A-Za-z]{3}$/.test(text))) {
        const found = countryByA3.get(upper)?.a3;
        if (found || keyType === 'iso3') return found ?? null;
    }
    return countryByName.get(normalizeName(text))?.a3 ?? null;
}

/** A US state's two-digit FIPS from an abbreviation, name, or FIPS code. */
export function stateId(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const digits = integerText(value);
    if (digits !== null) return digits.length <= 2 ? pad(digits, 2) : null;
    const text = String(value).trim();
    return stateByAbbr.get(text.toUpperCase()) ?? stateByName.get(normalizeName(text)) ?? null;
}

/** A US county's five-digit FIPS. */
export function countyId(value: unknown): string | null {
    const digits = integerText(value);
    return digits !== null && digits.length <= 5 ? pad(digits, 5) : null;
}

type Atlas = Topology<Record<string, GeometryCollection>>;

const toFeatures = (topology: Atlas, object: string, idOf: (geometry: { id?: string | number; properties?: Record<string, unknown> }) => string | null) =>
    (feature(topology, topology.objects[object]) as FeatureCollection).features.flatMap(item => {
        const id = idOf({ id: item.id, properties: item.properties ?? undefined });
        if (!id) return [];
        const name = String((item.properties as { name?: unknown } | null)?.name ?? id);
        return [{ ...item, id, properties: { ...(item.properties ?? {}), name, id } } as RegionFeature];
    });

/**
 * World Bank Official Boundaries: countries keyed by ISO alpha-3 (territories sharing a code merged), and
 * areas of non-determined legal status (Jammu and Kashmir, Aksai Chin, Arunachal Pradesh, Western Sahara,
 * Abyei, Golan Heights, the Falkland Islands (Malvinas), …) as their own features with `ndlsa: true`.
 * Following the UN depiction, those areas are not part of any country: data keyed to a country does not
 * colour them, and their borders are dotted. The set has no Antarctica.
 */
function countrySet(topology: Atlas, name: string): GeoSet {
    const undetermined = (geometry: { properties?: unknown }) => !!(geometry.properties as { ndlsa?: boolean } | undefined)?.ndlsa;
    const features = toFeatures(topology, 'countries', ({ id }) => id === undefined || id === null || id === '' ? null : String(id))
        .map(item => ({ ...item, properties: { ...item.properties, name: (item.properties.ndlsa ? undefined : countryName(item.properties.id)) ?? item.properties.name } }));
    const outline = feature(topology, topology.objects.land) as Feature | FeatureCollection;
    return {
        name, features, byId: new Map(features.map(item => [item.properties.id, item])),
        borders: mesh(topology, topology.objects.countries, (a, b) => a !== b && !undetermined(a) && !undetermined(b)),
        disputedBorders: mesh(topology, topology.objects.countries, (a, b) => a !== b && (undetermined(a) || undetermined(b))),
        outline,
        outlineWithoutAntarctica: (outline.type === 'Feature' ? outline : outline.features[0]) as Feature,
    };
}

function usSet(topology: Atlas, object: 'states' | 'counties', name: string): GeoSet {
    const width = object === 'states' ? 2 : 5;
    const features = toFeatures(topology, object, ({ id }) => id === undefined || id === null ? null : pad(id, width));
    if (object === 'counties') {
        const states = new Map(US_STATES.map(([abbr, fips]) => [fips, abbr]));
        for (const county of features) {
            const state = states.get(county.properties.id.slice(0, 2));
            if (state) county.properties.name = `${county.properties.name}, ${state}`;
        }
    }
    return {
        name, features, byId: new Map(features.map(item => [item.properties.id, item])),
        borders: mesh(topology, topology.objects[object], (a, b) => a !== b),
        outline: feature(topology, topology.objects.nation) as Feature | FeatureCollection,
    };
}

const loaders: Record<string, () => Promise<GeoSet>> = {
    countries: async () => countrySet((await import('./data/world-bank/coarse.json')).default as unknown as Atlas, 'countries'),
    'countries-detailed': async () => countrySet((await import('./data/world-bank/medium.json')).default as unknown as Atlas, 'countries-detailed'),
    'countries-fine': async () => countrySet((await import('./data/world-bank/fine.json')).default as unknown as Atlas, 'countries-fine'),
    'us-states': async () => usSet((await import('us-atlas/states-10m.json')).default as unknown as Atlas, 'states', 'us-states'),
    'us-counties': async () => usSet((await import('us-atlas/counties-10m.json')).default as unknown as Atlas, 'counties', 'us-counties'),
};
const cache = new Map<string, Promise<GeoSet>>();

/** A built-in boundary set, loaded once. */
export function loadGeoSet(name: GeoSetName | 'countries-detailed' | 'countries-fine'): Promise<GeoSet> {
    let set = cache.get(name);
    if (!set) {
        set = loaders[name]();
        cache.set(name, set);
        set.catch(() => cache.delete(name));
    }
    return set;
}

/** The boundary set a basemap draws. */
export const basemapGeoSet = (basemap: BasemapName): GeoSetName | 'countries-detailed' | null =>
    basemap === 'world' ? 'countries' : basemap === 'world-detailed' ? 'countries-detailed'
        : basemap === 'us-states' ? 'us-states' : basemap === 'us-counties' ? 'us-counties' : null;

/**
 * World boundaries fine enough for the zoom: the coarse level for the whole world, medium from about a
 * continent, fine from about a country. `worldWidth` is the projected width of 360° in pixels.
 */
export const countryDetail = (worldWidth: number, basemap: BasemapName): 0 | 1 | 2 =>
    worldWidth > 16000 ? 2 : worldWidth > 3200 || basemap === 'world-detailed' ? 1 : 0;

export const COUNTRY_DETAIL_SETS = ['countries', 'countries-detailed', 'countries-fine'] as const;

/** Read a custom GeoJSON or TopoJSON document as a region set keyed by `featureKey`. */
export function customGeoSet(name: string, document: unknown, featureKey?: string): GeoSet {
    let collection: FeatureCollection | null = null;
    let borders: MultiLineString | null = null;
    const record = document as { type?: string; objects?: Record<string, GeometryCollection>; features?: Feature[] } | null;
    if (record?.type === 'Topology' && record.objects) {
        const topology = record as unknown as Atlas;
        const objectName = Object.keys(topology.objects)[0];
        const object = topology.objects[objectName];
        const result = feature(topology, object) as FeatureCollection | Feature;
        collection = result.type === 'FeatureCollection' ? result : { type: 'FeatureCollection', features: [result] };
        borders = mesh(topology, object, (a, b) => a !== b);
    } else if (record?.type === 'FeatureCollection' && Array.isArray(record.features)) {
        collection = record as FeatureCollection;
    } else if (record?.type === 'Feature') {
        collection = { type: 'FeatureCollection', features: [record as unknown as Feature] };
    }
    if (!collection) throw new Error(`${name} is not GeoJSON or TopoJSON.`);
    const keyOf = (item: Feature, index: number): string => {
        const properties = (item.properties ?? {}) as Record<string, unknown>;
        const raw = featureKey ? properties[featureKey] : item.id ?? properties.id ?? properties.name ?? properties.NAME ?? index;
        return normalizeKey(raw);
    };
    const features = collection.features.filter(item => item?.geometry).map((item, index) => {
        const properties = (item.properties ?? {}) as Record<string, unknown>;
        const id = keyOf(item, index);
        const label = properties.name ?? properties.NAME ?? properties.Name ?? (featureKey ? properties[featureKey] : undefined) ?? id;
        return { ...item, geometry: rewindGeometry(item.geometry), id, properties: { ...properties, id, name: String(label) } } as RegionFeature;
    });
    return { name, features, byId: new Map(features.map(item => [item.properties.id, item])), borders, outline: null };
}

/**
 * d3-geo wants clockwise outer rings; RFC 7946 GeoJSON (geojson.io, turf, ogr2ogr) winds them the
 * other way, which d3 reads as the whole globe minus the region. Reverse polygons that cover over
 * half the sphere.
 */
function rewindPolygon(rings: Position[][]): Position[][] {
    const area = geoArea({ type: 'Polygon', coordinates: rings } as never);
    return area > 2 * Math.PI ? rings.map(ring => ring.slice().reverse()) : rings;
}

export function rewindGeometry(geometry: Geometry): Geometry {
    if (geometry.type === 'Polygon') return { ...geometry, coordinates: rewindPolygon(geometry.coordinates) };
    if (geometry.type === 'MultiPolygon') return { ...geometry, coordinates: geometry.coordinates.map(rewindPolygon) };
    if (geometry.type === 'GeometryCollection') return { ...geometry, geometries: geometry.geometries.map(rewindGeometry) };
    return geometry;
}

/** Custom keys compare as trimmed, case-folded text; integers lose leading zeros. */
export const normalizeKey = (value: unknown): string => {
    const digits = integerText(value);
    if (digits !== null) return String(Number(digits));
    return normalizeName(String(value ?? ''));
};

/** The geo set a layer joins against, from its `geo`, key type, or the basemap. */
export function layerGeoSet(geo: string | undefined, keyType: KeyType | undefined, basemap: BasemapName): string {
    if (geo === 'countries' && basemap === 'world-detailed') return 'countries-detailed';
    if (geo) return geo;
    if (keyType === 'us-state') return 'us-states';
    if (keyType === 'fips') return 'us-counties';
    if (keyType && ['iso2', 'iso3', 'iso-numeric', 'country-name'].includes(keyType)) return basemap === 'world-detailed' ? 'countries-detailed' : 'countries';
    if (basemap === 'us-states' || basemap === 'us-counties') return basemap;
    return basemap === 'world-detailed' ? 'countries-detailed' : 'countries';
}

/** Resolve a row's key to a region id in `set`, or null when nothing matches. */
export function regionId(value: unknown, set: GeoSet, keyType: KeyType = 'auto'): string | null {
    if (value === null || value === undefined || value === '') return null;
    let id: string | null;
    if (set.name.startsWith('countries')) id = countryId(value, keyType);
    else if (set.name === 'us-states') id = stateId(value);
    else if (set.name === 'us-counties') id = keyType === 'us-state' ? stateId(value) : countyId(value);
    else id = normalizeKey(value);
    return id && set.byId.has(id) ? id : null;
}
