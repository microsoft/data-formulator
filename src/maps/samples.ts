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

/** Each country's continent (the UN geoscheme's regions), so a sample's region filter picks real places. */
const CONTINENT_OF: Record<string, string> = Object.fromEntries(Object.entries({
    Africa: 'AGO BDI BEN BFA BWA CAF CIV CMR COD COG COM CPV DJI DZA EGY ERI ESH ETH GAB GHA GIN GMB GNB GNQ IOT KEN LBR LBY LSO MAR MDG MLI '
        + 'MOZ MRT MUS MWI MYT NAM NER NGA REU RWA SDN SEN SHN SLE SOM SSD STP SWZ SYC TCD TGO TUN TZA UGA ZAF ZMB ZWE ATF',
    Americas: 'ABW AIA ARG ATG BES BHS BLM BLZ BMU BOL BRA BRB BVT CAN CHL COL CRI CUB CUW CYM DMA DOM ECU FLK GLP GRD GRL GTM GUF GUY HND HTI '
        + 'JAM KNA LCA MAF MEX MSR MTQ NIC PAN PER PRI PRY SGS SLV SPM SUR SXM TCA TTO URY USA VCT VEN VGB VIR',
    Asia: 'AFG ARE ARM AZE BGD BHR BRN BTN CHN CYP GEO HKG IDN IND IRN IRQ ISR JOR JPN KAZ KGZ KHM KOR KWT LAO LBN LKA MAC MDV MMR MNG MYS NPL '
        + 'OMN PAK PHL PRK PSE QAT SAU SGP SYR THA TJK TKM TLS TUR TWN UZB VNM YEM',
    Europe: 'ALA ALB AND AUT BEL BGR BIH BLR CHE CZE DEU DNK ESP EST FIN FRA FRO GBR GGY GIB GRC HRV HUN IMN IRL ISL ITA JEY LIE LTU LUX LVA MCO '
        + 'MDA MKD MLT MNE NLD NOR POL PRT ROU RUS SJM SMR SRB SVK SVN SWE UKR VAT XKX',
    Oceania: 'ASM AUS CCK COK CXR FJI FSM GUM HMD KIR MHL MNP NCL NFK NIU NRU NZL PCN PLW PNG PYF SLB TKL TON TUV UMI VUT WLF WSM',
}).flatMap(([continent, codes]) => codes.split(' ').map(code => [code, continent])));

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
                region: CONTINENT_OF[country.a3],
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

/** Revenue at a store in each of 15 US cities. */
export function storeRevenue(): Row[] {
    return ([['Seattle', -122.33, 47.61], ['San Francisco', -122.42, 37.77], ['Los Angeles', -118.24, 34.05], ['Phoenix', -112.07, 33.45],
        ['Denver', -104.99, 39.74], ['Dallas', -96.8, 32.78], ['Houston', -95.37, 29.76], ['Chicago', -87.63, 41.88], ['Atlanta', -84.39, 33.75],
        ['Miami', -80.19, 25.76], ['New York', -74.01, 40.71], ['Boston', -71.06, 42.36], ['Minneapolis', -93.27, 44.98], ['Anchorage', -149.9, 61.22],
        ['Honolulu', -157.86, 21.31]] as [string, number, number][]).map(([city, lon, lat]) => ({ city, lon, lat, revenue: Math.round(2e6 + 4e7 * hash01(city) ** 2) }));
}

/** County × year unemployment for the given county FIPS codes. */
export function countyUnemployment(fips: string[]): Row[] {
    return fips.flatMap(id => [2010, 2015, 2020, 2023].map(year => ({
        fips: id, year, rate: round(2 + 10 * hash01(id) ** 1.5 + (year === 2010 ? 3 : year === 2020 ? 2 : 0) * hash01(id + year), 1),
    })));
}

/** Odysseus's voyage, stop by stop: episode, leg of the story, crew aboard on leaving, lon, lat. */
const ODYSSEY: [number, string, string, number, number, number][] = [
    [1, 'Troy', 'Leaving Troy', 600, 26.24, 39.96], [2, 'Ismarus', 'Leaving Troy', 528, 25.52, 40.89],
    [3, 'The Lotus-Eaters', 'Leaving Troy', 528, 10.86, 33.81], [4, 'The Cyclops', 'Monsters and winds', 522, 15.16, 37.56],
    [5, 'Aeolia', 'Monsters and winds', 522, 14.95, 38.47], [6, 'The Laestrygonians', 'Monsters and winds', 46, 9.16, 41.39],
    [7, 'Aeaea', 'Circe and the dead', 45, 13.05, 41.23], [8, 'The Underworld', 'Circe and the dead', 45, 14.07, 40.84],
    [9, 'The Sirens', 'Sirens to shipwreck', 45, 14.43, 40.58], [10, 'Scylla and Charybdis', 'Sirens to shipwreck', 39, 15.63, 38.25],
    [11, 'Thrinacia', 'Sirens to shipwreck', 1, 15, 37.08], [12, 'Ogygia', 'Homeward', 1, 14.25, 36.05],
    [13, 'Scheria', 'Homeward', 1, 19.92, 39.62], [14, 'Ithaca', 'Homeward', 1, 20.71, 38.37],
];

export function sampleMaps(countyIds: string[] = []): SampleMap[] {
    const world = worldIndicators();
    const states = stateStats();
    return [
        {
            id: 'world-time', label: 'Choropleth over time', spec: {
                title: 'Life expectancy at birth', subtitle: 'By country, 2000–2020 (synthetic)', source: 'Sample data',
                template: 'choropleth', data: { values: world },
                encoding: { region: 'country', color: 'life_expectancy', time: 'year', filter: 'region', tooltip: ['life_expectancy', 'gdp_per_capita', 'region'] },
                fields: { life_expectancy: { semanticType: 'Score', unit: 'years', displayName: 'Life expectancy' },
                    gdp_per_capita: { semanticType: 'Price', unit: 'USD', displayName: 'GDP per capita' } },
                properties: { geography: 'world' },
            },
        },
        {
            id: 'us-metric', label: 'US states · measure switch, stats', spec: {
                title: 'State profile', template: 'choropleth', data: { values: states },
                encoding: { region: 'state', color: ['median_income', 'poverty_rate'], tooltip: ['population'] },
                fields: { median_income: { semanticType: 'Price', unit: 'USD' }, poverty_rate: { semanticType: 'Percentage' }, population: { semanticType: 'Count' } },
                properties: { geography: 'us-states', method: 'jenks', stats: true },
            },
        },
        {
            id: 'us-diverging', label: 'US states · diverging margin', spec: {
                title: 'Vote margin by state', subtitle: 'Positive = party A (synthetic)', view: { style: 'muted' },
                template: 'choropleth', data: { values: states }, encoding: { region: 'abbr', color: 'margin' },
                fields: { margin: { semanticType: 'PercentageChange', unit: 'pts', displayName: 'Margin' } },
                properties: { geography: 'us-states' },
            },
        },
        {
            id: 'world-bubbles', label: 'City bubbles', spec: {
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
            id: 'quakes', label: 'Density heatmap · highlights, year', spec: {
                title: 'Earthquakes', subtitle: 'Magnitude 4+ (synthetic)', view: { basemap: 'world', fit: 'basemap', graticule: true, style: 'dark' },
                template: 'density', data: { values: quakes() }, encoding: { lat: 'lat', lon: 'lon', weight: 'magnitude', time: 'year' },
                properties: { density: 'heatmap', radius: 12, scheme: 'ylOrRd', highlight: { field: 'magnitude', op: '>=', value: 7, label: 'M7+' } },
            },
        },
        {
            id: 'globe-flows', label: 'Globe · flows (arrows)', spec: {
                title: 'Largest migration corridors', view: { projection: 'orthographic', spin: true, style: 'atlas' },
                template: 'flows', data: { values: migration() }, encoding: { origin: 'origin', destination: 'destination', size: 'migrants' },
                fields: { migrants: { semanticType: 'Count', displayName: 'Migrants' } },
                properties: { geography: 'world', sizeMax: 8, color: '#e15759', stats: true },
            },
        },
        {
            id: 'spikes', label: 'US · spikes from coordinates', spec: {
                title: 'Store revenue', template: 'spikes', data: { values: storeRevenue() },
                encoding: { lat: 'lat', lon: 'lon', size: 'revenue', label: 'city' },
                fields: { revenue: { semanticType: 'Amount', unit: 'USD', displayName: 'Revenue' } },
                properties: { geography: 'us-states', sizeMax: 140, color: '#4e79a7' },
            },
        },
        {
            id: 'tracks', label: 'Storm tracks (arrows)', spec: {
                title: 'Hurricane tracks', subtitle: 'Synthetic: west in the trades, then recurving north-east',
                template: 'tracks', data: { values: stormTracks() },
                encoding: { lat: 'lat', lon: 'lon', group: 'storm', order: 'step', color: 'storm' },
                properties: { geography: 'world', sizeMax: 3 },
            },
        },
        {
            id: 'routes', label: 'Route of stops (Odysseus)', spec: {
                title: 'The wanderings of Odysseus', subtitle: 'Each leg as wide as the crew that sailed it', view: { basemap: 'world', style: 'atlas' },
                template: 'routes', data: { values: ODYSSEY.map(([stop, episode, leg, crew, lon, lat]) => ({ stop, episode, leg, crew, lon, lat })) },
                encoding: { lat: 'lat', lon: 'lon', order: 'stop', label: 'episode', color: 'leg', size: 'crew' },
                fields: { crew: { semanticType: 'Count', displayName: 'Crew' } },
                properties: { sizeMax: 8, colors: { 'Leaving Troy': '#b2182b', 'Monsters and winds': '#e0622b', 'Circe and the dead': '#d9a320',
                    'Sirens to shipwreck': '#2a9d8f', Homeward: '#1d3557' } },
            },
        },
        {
            id: 'counties', label: 'US counties over time', spec: {
                title: 'Unemployment rate by county', subtitle: 'Synthetic, 2010–2023', view: { style: 'minimal' },
                template: 'choropleth', data: { values: countyUnemployment(countyIds) },
                encoding: { region: 'fips', color: 'rate', time: 'year' },
                fields: { rate: { semanticType: 'Percentage', displayName: 'Unemployment rate' } },
                properties: { geography: 'us-counties', keyType: 'fips', classes: 7, scheme: 'ylOrRd' },
            },
        },
        {
            id: 'bivariate', label: 'Bivariate', spec: {
                title: 'Income and poverty', subtitle: 'Bivariate choropleth (synthetic)',
                template: 'bivariate', data: { values: states }, encoding: { region: 'state', color: 'median_income', color2: 'poverty_rate' },
                fields: { median_income: { semanticType: 'Price', unit: 'USD' }, poverty_rate: { semanticType: 'Percentage' } },
                properties: { geography: 'us-states' },
            },
        },
        {
            id: 'dorling', label: 'Cartogram', spec: {
                title: 'Population by state', subtitle: 'Circles sized by population, spread apart',
                template: 'cartogram', data: { values: states }, encoding: { region: 'state', size: 'population', color: 'margin', label: 'abbr' },
                fields: { population: 'Count', margin: { semanticType: 'PercentageChange', unit: 'pts' } },
                properties: { geography: 'us-states', sizeMax: 40 },
            },
        },
        {
            id: 'flights', label: 'Flight routes from a hub', spec: {
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
            id: 'migration-arrows', label: 'Migration flows (arrows)', spec: {
                title: 'Largest migration corridors', subtitle: 'Arrows point to the destination; dots mark the places',
                template: 'flows', data: { values: migration() },
                encoding: { origin: 'origin', destination: 'destination', size: 'migrants' },
                fields: { migrants: { semanticType: 'Count', displayName: 'Migrants' } },
                properties: { geography: 'world', sizeMax: 6, color: '#e15759' },
                view: { style: 'atlas' },
            },
        },
        {
            id: 'migration-taper', label: 'Migration flows (tapered)', spec: {
                title: 'Largest migration corridors', subtitle: 'Each line narrows toward the destination',
                template: 'flows', data: { values: migration() },
                encoding: { origin: 'origin', destination: 'destination', size: 'migrants' },
                fields: { migrants: { semanticType: 'Count', displayName: 'Migrants' } },
                properties: { geography: 'world', sizeMax: 10, color: '#e15759', direction: 'taper' },
            },
        },
        {
            id: 'wind', label: 'Wind vectors', spec: {
                title: 'Surface wind over the North Atlantic', subtitle: 'Synthetic: westerlies around a cyclone; arrows point downwind',
                template: 'vectors', data: { values: windField() },
                encoding: { lat: 'lat', lon: 'lon', u: 'u', v: 'v', size: 'speed', color: 'speed' },
                fields: { speed: { semanticType: 'Quantity', unit: 'm/s', displayName: 'Wind speed' } },
                properties: { geography: 'world', sizeMax: 22 },
            },
        },
    ];
}
