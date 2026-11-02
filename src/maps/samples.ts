// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Sample maps for the /dev/maps gallery and tests: one per common map task, with
 * deterministic generated data inlined as `values` (the gallery has no workspace).
 */

import countryTable from './data/countries.json';
import type { Row } from './spec';

/** A deterministic pseudo-random number in [0, 1) from a string. */
export const hash01 = (text: string): number => {
    let h = 2166136261;
    for (let index = 0; index < text.length; index++) { h ^= text.charCodeAt(index); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
};

const COUNTRIES = (countryTable as { a3: string; name: string; aliases: string[] }[]);

export const CITIES: [string, string, number, number, number][] = [
    ['Tokyo', 'JPN', 139.69, 35.69, 37.4], ['Delhi', 'IND', 77.21, 28.61, 31.0], ['Shanghai', 'CHN', 121.47, 31.23, 27.1],
    ['São Paulo', 'BRA', -46.63, -23.55, 22.0], ['Mexico City', 'MEX', -99.13, 19.43, 21.8], ['Cairo', 'EGY', 31.24, 30.04, 20.9],
    ['Mumbai', 'IND', 72.88, 19.08, 20.4], ['Beijing', 'CHN', 116.41, 39.9, 20.4], ['Dhaka', 'BGD', 90.41, 23.81, 21.0],
    ['Osaka', 'JPN', 135.5, 34.69, 19.2], ['New York', 'USA', -74.01, 40.71, 18.8], ['Karachi', 'PAK', 67.01, 24.86, 16.1],
    ['Buenos Aires', 'ARG', -58.38, -34.6, 15.2], ['Istanbul', 'TUR', 28.98, 41.01, 15.2], ['Kolkata', 'IND', 88.36, 22.57, 14.9],
    ['Lagos', 'NGA', 3.38, 6.52, 14.4], ['Manila', 'PHL', 120.98, 14.6, 13.9], ['Rio de Janeiro', 'BRA', -43.17, -22.91, 13.5],
    ['Guangzhou', 'CHN', 113.26, 23.13, 13.3], ['Los Angeles', 'USA', -118.24, 34.05, 12.4], ['Moscow', 'RUS', 37.62, 55.76, 12.5],
    ['Kinshasa', 'COD', 15.27, -4.44, 14.3], ['Paris', 'FRA', 2.35, 48.86, 11.0], ['Lima', 'PER', -77.04, -12.05, 10.7],
    ['Bangkok', 'THA', 100.5, 13.76, 10.5], ['Jakarta', 'IDN', 106.85, -6.21, 10.6], ['London', 'GBR', -0.13, 51.51, 9.3],
    ['Seoul', 'KOR', 126.98, 37.57, 9.9], ['Tehran', 'IRN', 51.39, 35.69, 9.1], ['Chicago', 'USA', -87.63, 41.88, 8.9],
    ['Johannesburg', 'ZAF', 28.05, -26.2, 5.8], ['Sydney', 'AUS', 151.21, -33.87, 5.1], ['Toronto', 'CAN', -79.38, 43.65, 6.2],
    ['Madrid', 'ESP', -3.7, 40.42, 6.7], ['Nairobi', 'KEN', 36.82, -1.29, 4.9], ['Singapore', 'SGP', 103.82, 1.35, 5.9],
    ['Berlin', 'DEU', 13.4, 52.52, 3.6], ['Santiago', 'CHL', -70.67, -33.45, 6.8], ['Riyadh', 'SAU', 46.68, 24.71, 7.5],
    ['Ho Chi Minh City', 'VNM', 106.63, 10.82, 9.0],
];

export const US_STATE_ROWS: [string, string][] = [
    ['Alabama', 'AL'], ['Alaska', 'AK'], ['Arizona', 'AZ'], ['Arkansas', 'AR'], ['California', 'CA'], ['Colorado', 'CO'], ['Connecticut', 'CT'],
    ['Delaware', 'DE'], ['District of Columbia', 'DC'], ['Florida', 'FL'], ['Georgia', 'GA'], ['Hawaii', 'HI'], ['Idaho', 'ID'], ['Illinois', 'IL'],
    ['Indiana', 'IN'], ['Iowa', 'IA'], ['Kansas', 'KS'], ['Kentucky', 'KY'], ['Louisiana', 'LA'], ['Maine', 'ME'], ['Maryland', 'MD'],
    ['Massachusetts', 'MA'], ['Michigan', 'MI'], ['Minnesota', 'MN'], ['Mississippi', 'MS'], ['Missouri', 'MO'], ['Montana', 'MT'],
    ['Nebraska', 'NE'], ['Nevada', 'NV'], ['New Hampshire', 'NH'], ['New Jersey', 'NJ'], ['New Mexico', 'NM'], ['New York', 'NY'],
    ['North Carolina', 'NC'], ['North Dakota', 'ND'], ['Ohio', 'OH'], ['Oklahoma', 'OK'], ['Oregon', 'OR'], ['Pennsylvania', 'PA'],
    ['Rhode Island', 'RI'], ['South Carolina', 'SC'], ['South Dakota', 'SD'], ['Tennessee', 'TN'], ['Texas', 'TX'], ['Utah', 'UT'],
    ['Vermont', 'VT'], ['Virginia', 'VA'], ['Washington', 'WA'], ['West Virginia', 'WV'], ['Wisconsin', 'WI'], ['Wyoming', 'WY'],
];

const US_CITIES: [string, string, number, number][] = [
    ['Seattle', 'Washington', -122.33, 47.61], ['San Francisco', 'California', -122.42, 37.77], ['Los Angeles', 'California', -118.24, 34.05],
    ['Phoenix', 'Arizona', -112.07, 33.45], ['Denver', 'Colorado', -104.99, 39.74], ['Dallas', 'Texas', -96.8, 32.78], ['Houston', 'Texas', -95.37, 29.76],
    ['Chicago', 'Illinois', -87.63, 41.88], ['Atlanta', 'Georgia', -84.39, 33.75], ['Miami', 'Florida', -80.19, 25.76],
    ['New York', 'New York', -74.01, 40.71], ['Boston', 'Massachusetts', -71.06, 42.36], ['Minneapolis', 'Minnesota', -93.27, 44.98],
];

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Country × year indicators, keyed by mixed codes and names (as real data is). */
export function worldIndicators(): Row[] {
    const rows: Row[] = [];
    COUNTRIES.filter(country => country.a3 !== 'ATA').forEach((country, index) => {
        const base = 50 + 30 * hash01(country.a3);
        const gdpBase = 500 + 60000 * hash01(`${country.a3}gdp`) ** 2;
        for (let year = 2000; year <= 2020; year += 2) {
            rows.push({
                // Every third country by name, the rest by ISO3: the map resolves both.
                country: index % 3 === 0 ? country.name : country.a3,
                iso3: country.a3, year,
                life_expectancy: round(base + (year - 2000) * 0.25 * (0.5 + hash01(country.a3 + 'trend'))),
                gdp_per_capita: Math.round(gdpBase * (1 + (year - 2000) * 0.02)),
                region: ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'][Math.floor(hash01(country.a3 + 'r') * 5)],
            });
        }
    });
    rows.push({ country: 'World', iso3: 'WLD', year: 2020, life_expectancy: 72.8, gdp_per_capita: 11000, region: 'World' });
    return rows;
}

export function stateStats(): Row[] {
    return US_STATE_ROWS.map(([state, abbr]) => ({
        state, abbr,
        population: Math.round(500000 + 30000000 * hash01(state) ** 2),
        median_income: Math.round(48000 + 40000 * hash01(state + 'inc')),
        poverty_rate: round(8 + 12 * hash01(state + 'pov')),
        margin: round(-40 + 80 * hash01(state + 'vote')),
    }));
}

export function cityPoints(count = 6000): Row[] {
    const kinds = ['Taxi', 'Rideshare', 'Bike'];
    const centers: [number, number][] = [[-73.985, 40.758], [-73.99, 40.73], [-73.95, 40.78], [-73.94, 40.71], [-73.87, 40.77]];
    const rows: Row[] = [];
    for (let index = 0; index < count; index++) {
        const [cx, cy] = centers[Math.floor(hash01(`c${index}`) * centers.length)];
        const r = 0.035 * Math.sqrt(-2 * Math.log(Math.max(1e-6, hash01(`r${index}`))));
        const angle = 2 * Math.PI * hash01(`a${index}`);
        rows.push({ lon: round(cx + r * Math.cos(angle) * 1.3, 5), lat: round(cy + r * Math.sin(angle), 5),
            kind: kinds[Math.floor(hash01(`k${index}`) * 3)], fare: round(6 + 40 * hash01(`f${index}`) ** 2, 2) });
    }
    return rows;
}

export function quakes(): Row[] {
    const arcs: [number, number, number, number][] = [[140, 35, 145, 45], [120, 15, 128, 30], [-72, -35, -70, -15], [-125, 40, -150, 60],
        [95, 0, 105, -8], [175, -40, 178, -20], [25, 37, 45, 38], [-90, 13, -100, 18]];
    const rows: Row[] = [];
    for (let index = 0; index < 1500; index++) {
        const arc = arcs[Math.floor(hash01(`q${index}`) * arcs.length)];
        const t = hash01(`t${index}`);
        rows.push({ lon: round(arc[0] + (arc[2] - arc[0]) * t + (hash01(`x${index}`) - 0.5) * 3, 3),
            lat: round(arc[1] + (arc[3] - arc[1]) * t + (hash01(`y${index}`) - 0.5) * 3, 3),
            magnitude: round(4 + 4 * hash01(`m${index}`) ** 3), year: 2015 + Math.floor(hash01(`yr${index}`) * 8) });
    }
    return rows;
}

export function migration(): Row[] {
    const pairs: [string, string][] = [['MEX', 'USA'], ['IND', 'ARE'], ['SYR', 'TUR'], ['UKR', 'POL'], ['CHN', 'USA'], ['IND', 'USA'],
        ['BGD', 'IND'], ['PAK', 'SAU'], ['PHL', 'USA'], ['DZA', 'FRA'], ['GBR', 'AUS'], ['KAZ', 'RUS'], ['VEN', 'COL'], ['AFG', 'IRN'],
        ['MAR', 'ESP'], ['TUR', 'DEU'], ['IDN', 'MYS'], ['EGY', 'SAU'], ['NGA', 'GBR'], ['BRA', 'PRT']];
    return pairs.map(([origin, destination]) => ({ origin, destination, migrants: Math.round(300000 + 11000000 * hash01(origin + destination) ** 2) }));
}

export function stormTracks(): Row[] {
    // Atlantic hurricanes: west-northwest in the trades, then recurving north and east around the
    // subtropical high. Each storm starts and recurves somewhere different, so tracks spread apart.
    const names = ['Alma', 'Bret', 'Celia', 'Dorian', 'Erin', 'Fiona'];
    const rows: Row[] = [];
    names.forEach((storm, index) => {
        let lon = -22 - 26 * hash01(`s${index}`);
        let lat = 10 + 8 * hash01(`l${index}`);
        const turn = 9 + Math.floor(8 * hash01(`t${index}`));
        for (let step = 0; step < 26; step++) {
            const t = Math.max(0, (step - turn) / 8);
            const heading = (285 + 75 * Math.min(1.4, t)) * Math.PI / 180;
            const speed = 1.6 + 1.4 * Math.min(1, t);
            rows.push({ storm, step, lon: round(lon, 2), lat: round(lat, 2),
                wind: Math.round(35 + 105 * Math.sin(Math.PI * step / 26) * (0.6 + 0.4 * hash01(`w${index}`))) });
            lon += Math.sin(heading) * speed / Math.cos(lat * Math.PI / 180);
            lat += Math.cos(heading) * speed;
        }
    });
    return rows;
}

/** Wind on a grid over the North Atlantic: westerlies with a cyclone turning counter-clockwise off Newfoundland. */
export function windField(): Row[] {
    const rows: Row[] = [];
    const [cx, cy] = [-38, 46];
    for (let lat = 12; lat <= 64; lat += 3) {
        for (let lon = -82; lon <= 2; lon += 3) {
            const westerly = 9 * Math.exp(-(((lat - 45) / 14) ** 2));
            const trade = -6 * Math.exp(-(((lat - 15) / 6) ** 2));
            const [dx, dy] = [(lon - cx) * Math.cos(lat * Math.PI / 180), lat - cy];
            const distance = Math.hypot(dx, dy) || 1;
            const swirl = 16 * (distance / 9) * Math.exp(1 - distance / 9);
            const u = westerly + trade - swirl * dy / distance + (hash01(`u${lat},${lon}`) - 0.5) * 1.5;
            const v = swirl * dx / distance + (hash01(`v${lat},${lon}`) - 0.5) * 1.5;
            rows.push({ lon, lat, u: round(u, 2), v: round(v, 2), speed: round(Math.hypot(u, v), 1) });
        }
    }
    return rows;
}

export interface SampleMap { id: string; label: string; spec: Record<string, unknown> }

/** County × year unemployment for the given county FIPS codes. */
export function countyUnemployment(fips: string[]): Row[] {
    return fips.flatMap(id => [2010, 2015, 2020, 2023].map(year => ({
        fips: id, year, rate: round(2 + 10 * hash01(id) ** 1.5 + (year === 2010 ? 3 : year === 2020 ? 2 : 0) * hash01(id + year), 1),
    })));
}

export function sampleMaps(countyIds: string[] = []): SampleMap[] {
    const world = worldIndicators();
    const states = stateStats();
    return [
        {
            id: 'world-time', label: 'Template · choropleth over time', spec: {
                title: 'Life expectancy at birth', subtitle: 'By country, 2000–2020 (synthetic)', source: 'Sample data',
                template: 'choropleth', data: { values: world },
                encoding: { region: 'country', color: 'life_expectancy', time: 'year', filter: 'region', tooltip: ['life_expectancy', 'gdp_per_capita', 'region'] },
                fields: { life_expectancy: { semanticType: 'Score', unit: 'years', displayName: 'Life expectancy' },
                    gdp_per_capita: { semanticType: 'Price', unit: 'USD', displayName: 'GDP per capita' } },
                properties: { geography: 'world' },
            },
        },
        {
            id: 'us-metric', label: 'US states · metric switch, labels, stats', spec: {
                title: 'State profile', view: { basemap: 'us-states' }, data: { s: { values: states } },
                fields: { median_income: { semanticType: 'Price', unit: 'USD' }, poverty_rate: { semanticType: 'Percentage' }, population: { semanticType: 'Count' } },
                layers: [{ id: 'states', type: 'regions', data: 's', key: 'state', keyType: 'us-state', name: 'States',
                    color: { field: { param: 'metric' }, method: 'jenks' }, tooltip: ['population', 'median_income', 'poverty_rate'] }],
                controls: [{ type: 'select', param: 'metric', label: 'Measure', options: [{ label: 'Median income', value: 'median_income' },
                    { label: 'Poverty rate', value: 'poverty_rate' }, { label: 'Population', value: 'population' }] }, { type: 'stats', layer: 'states' }],
            },
        },
        {
            id: 'us-diverging', label: 'US states · diverging margin', spec: {
                title: 'Vote margin by state', subtitle: 'Positive = party A (synthetic)', view: { basemap: 'us-states', style: 'muted' }, data: { s: { values: states } },
                fields: { margin: { semanticType: 'PercentageChange', unit: 'pts', displayName: 'Margin' } },
                // The margin is a signed change, so it diverges around 0 without saying so.
                layers: [{ id: 'm', type: 'regions', data: 's', key: 'abbr', color: { field: 'margin' }, tooltip: ['margin'] }],
            },
        },
        {
            id: 'world-bubbles', label: 'Template · city bubbles', spec: {
                title: 'Largest metropolitan areas', subtitle: 'Population (millions)', view: { basemap: 'world', projection: 'naturalEarth' },
                template: 'bubbles',
                data: { values: CITIES.map(([city, iso3, lon, lat, pop]) => ({ city, iso3, lon, lat, population: pop,
                    continent: lon < -30 ? 'Americas' : lon < 60 ? (lat > 35 ? 'Europe' : 'Africa / Middle East') : 'Asia-Pacific' })) },
                encoding: { lat: 'lat', lon: 'lon', size: 'population', color: 'continent', label: 'city' },
                fields: { population: { semanticType: 'Quantity', unit: 'M', displayName: 'Population' } },
                properties: { sizeMax: 26 },
            },
        },
        {
            id: 'city-points', label: 'Street tiles · points, hexbin, layers', spec: {
                title: 'Pickups in Manhattan', subtitle: '6,000 trips (synthetic)', view: { tiles: 'light' }, data: { t: { values: cityPoints() } },
                layers: [{ id: 'hex', type: 'hexbin', data: 't', lon: 'lon', lat: 'lat', radius: 14, name: 'Trips per hexagon' },
                    { id: 'pts', type: 'points', data: 't', lon: 'lon', lat: 'lat', name: 'Trips', color: { field: 'kind' }, size: { value: 2 }, visible: false,
                        tooltip: ['kind', { field: 'fare', format: '$.2f' }] }],
                controls: [{ type: 'layers' }, { type: 'checkboxes', field: 'kind', data: 't', label: 'Service' }, { type: 'range', field: 'fare', data: 't', label: 'Fare' }],
            },
        },
        {
            id: 'quakes', label: 'Density heatmap · year filter', spec: {
                title: 'Earthquakes', subtitle: 'Magnitude 4+ (synthetic)', view: { basemap: 'world', projection: 'equalEarth', fit: 'basemap', graticule: true, style: 'dark' }, data: { q: { values: quakes() } },
                layers: [{ id: 'heat', type: 'heatmap', data: 'q', lon: 'lon', lat: 'lat', weight: 'magnitude', radius: 12, name: 'Density', color: { scheme: 'ylOrRd' } },
                    { id: 'big', type: 'points', data: 'q', lon: 'lon', lat: 'lat', filter: [{ field: 'magnitude', op: '>=', value: 7 }], name: 'M7+',
                        size: { field: 'magnitude', max: 6 }, color: { value: '#b2182b' }, tooltip: ['magnitude', 'year'] }],
                controls: [{ type: 'slider', field: 'year', play: true }, { type: 'layers' }],
            },
        },
        {
            id: 'globe-flows', label: 'Globe · flows (arrows)', spec: {
                title: 'Largest migration corridors', view: { projection: 'orthographic', spin: true, style: 'atlas' }, data: { m: { values: migration() } },
                layers: [{ id: 'flows', type: 'flows', data: 'm', from: { key: 'origin' }, to: { key: 'destination' }, direction: 'arrow',
                    size: { field: 'migrants', max: 8, format: '.2s' }, color: { value: '#e15759' }, tooltip: [{ field: 'migrants', format: ',' }] }],
                controls: [{ type: 'stats', layer: 'flows' }],
            },
        },
        {
            id: 'spikes', label: 'US · spikes from coordinates', spec: {
                title: 'Store revenue', view: { basemap: 'us-states' },
                data: { s: { values: [['Seattle', -122.33, 47.61], ['San Francisco', -122.42, 37.77], ['Los Angeles', -118.24, 34.05], ['Phoenix', -112.07, 33.45],
                    ['Denver', -104.99, 39.74], ['Dallas', -96.8, 32.78], ['Houston', -95.37, 29.76], ['Chicago', -87.63, 41.88], ['Atlanta', -84.39, 33.75],
                    ['Miami', -80.19, 25.76], ['New York', -74.01, 40.71], ['Boston', -71.06, 42.36], ['Minneapolis', -93.27, 44.98], ['Anchorage', -149.9, 61.22],
                    ['Honolulu', -157.86, 21.31]].map(([city, lon, lat]) => ({ city, lon, lat, revenue: Math.round(2e6 + 4e7 * hash01(String(city)) ** 2) })) } },
                layers: [{ id: 'rev', type: 'spikes', data: 's', lon: 'lon', lat: 'lat', text: 'city', size: { field: 'revenue', max: 140, format: '$.2s' },
                    color: { value: '#4e79a7' }, tooltip: [{ field: 'revenue', format: '$,.0f' }] }],
            },
        },
        {
            id: 'tracks', label: 'Template · storm tracks (arrows)', spec: {
                title: 'Hurricane tracks', subtitle: 'Synthetic: west in the trades, then recurving north-east',
                template: 'tracks', data: { values: stormTracks() },
                encoding: { lat: 'lat', lon: 'lon', group: 'storm', order: 'step', color: 'storm' },
                properties: { geography: 'world', sizeMax: 3 },
            },
        },
        {
            id: 'counties', label: 'Template · US counties over time', spec: {
                title: 'Unemployment rate by county', subtitle: 'Synthetic, 2010–2023', view: { style: 'minimal' },
                template: 'choropleth', data: { values: countyUnemployment(countyIds) },
                encoding: { region: 'fips', color: 'rate', time: 'year' },
                fields: { rate: { semanticType: 'Percentage', displayName: 'Unemployment rate' } },
                properties: { geography: 'us-counties', keyType: 'fips', classes: 7, scheme: 'ylOrRd' },
            },
        },
        {
            id: 'bivariate', label: 'Template · bivariate', spec: {
                title: 'Income and poverty', subtitle: 'Bivariate choropleth (synthetic)',
                template: 'bivariate', data: { values: states }, encoding: { region: 'state', color: 'median_income', color2: 'poverty_rate' },
                fields: { median_income: { semanticType: 'Price', unit: 'USD' }, poverty_rate: { semanticType: 'Percentage' } },
                properties: { geography: 'us-states' },
            },
        },
        {
            id: 'dorling', label: 'Template · cartogram', spec: {
                title: 'Population by state', subtitle: 'Circles sized by population, spread apart',
                template: 'cartogram', data: { values: states }, encoding: { region: 'state', size: 'population', color: 'margin', label: 'abbr' },
                fields: { population: 'Count', margin: { semanticType: 'PercentageChange', unit: 'pts' } },
                properties: { geography: 'us-states', sizeMax: 40 },
            },
        },
        {
            id: 'linked', label: 'Linked · click a state, filter its cities', spec: {
                title: 'Stores by state', subtitle: 'Click a state to show its stores; shift-drag to lasso', view: { basemap: 'us-states' },
                data: { s: { values: states }, stores: { values: Array.from({ length: 300 }, (_, index) => {
                    const [city, state, lon, lat] = US_CITIES[Math.floor(hash01(`st${index}`) * US_CITIES.length)];
                    return { store: `${city} #${index + 1}`, city, state, lon: round(lon + (hash01(`x${index}`) - 0.5) * 1.6, 3),
                        lat: round(lat + (hash01(`y${index}`) - 0.5) * 1.2, 3), revenue: Math.round(1e5 + 5e6 * hash01(`rv${index}`) ** 2) };
                }) } },
                layers: [{ id: 'states', type: 'regions', data: 's', key: 'state', color: { field: 'median_income', scheme: 'greens' }, tooltip: ['state'] },
                    { id: 'stores', type: 'bubbles', data: 'stores', lon: 'lon', lat: 'lat', selectionFilter: { layer: 'states', field: 'state' },
                        size: { field: 'revenue', max: 24, format: '$.2s' }, color: { value: '#f28e2b' }, tooltip: ['store', { field: 'revenue', format: '$,.0f' }] }],
                controls: [{ type: 'stats', layer: 'stores', label: 'Store revenue' }],
            },
        },
        {
            id: 'flights', label: 'Template · flight routes from a hub', spec: {
                title: 'Routes from Seattle', subtitle: 'Weekly nonstop flights by airline (synthetic)', view: { basemap: 'world', labels: false },
                template: 'flows',
                data: { values: CITIES.filter(city => city[0] !== 'Seattle').slice(0, 24).map(([city, , lon, lat], index) => ({
                    origin: 'Seattle', o_lon: -122.33, o_lat: 47.61, destination: city, d_lon: lon, d_lat: lat,
                    airline: ['Alaska', 'Delta', 'United'][index % 3], weekly: Math.round(3 + 20 * hash01(String(city))) })) },
                encoding: { origin: 'origin', destination: 'destination', originLat: 'o_lat', originLon: 'o_lon', destinationLat: 'd_lat', destinationLon: 'd_lon',
                    color: 'airline', size: 'weekly', filter: 'airline' },
                fields: { weekly: { semanticType: 'Count', displayName: 'Weekly flights' } },
                // Routes from one hub need no arrows: the hub is marked, every line leaves it.
                properties: { curve: 'great-circle', sizeMax: 3, direction: 'none' },
            },
        },
        {
            id: 'migration-arrows', label: 'Template · migration flows (arrows)', spec: {
                title: 'Largest migration corridors', subtitle: 'Arrows point to the destination; dots mark the places',
                template: 'flows', data: { values: migration() },
                encoding: { origin: 'origin', destination: 'destination', size: 'migrants' },
                fields: { migrants: { semanticType: 'Count', displayName: 'Migrants' } },
                properties: { geography: 'world', sizeMax: 6, color: '#e15759' },
                view: { style: 'atlas' },
            },
        },
        {
            id: 'migration-taper', label: 'Template · migration flows (tapered)', spec: {
                title: 'Largest migration corridors', subtitle: 'Each line narrows toward the destination',
                template: 'flows', data: { values: migration() },
                encoding: { origin: 'origin', destination: 'destination', size: 'migrants' },
                fields: { migrants: { semanticType: 'Count', displayName: 'Migrants' } },
                properties: { geography: 'world', sizeMax: 10, color: '#e15759', direction: 'taper' },
            },
        },
        {
            id: 'wind', label: 'Template · wind vectors', spec: {
                title: 'Surface wind over the North Atlantic', subtitle: 'Synthetic: westerlies around a cyclone; arrows point downwind',
                template: 'vectors', data: { values: windField() },
                encoding: { lat: 'lat', lon: 'lon', u: 'u', v: 'v', size: 'speed', color: 'speed' },
                fields: { speed: { semanticType: 'Quantity', unit: 'm/s', displayName: 'Wind speed' } },
                properties: { geography: 'world', scheme: 'viridis', sizeMax: 22 },
            },
        },
    ];
}
