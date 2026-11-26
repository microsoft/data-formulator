// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A blank session's live-data question: a free, keyless dataset loaded straight from the browser for the agent to
 * chart, offered as one of a few everyday questions picked at random (umbrella, warmer than usual, daylight, air,
 * what the world is reading). Where the user is comes from the time zone alone, so there is no permission prompt:
 * a US zone picks US cities, others the cities of their continent. Maps shade the user's rough area (their time
 * zone's states, or their country) from a small table loaded alongside.
 */

import type { TFunction } from 'i18next';
import type { DictTable } from '../components/ComponentType';
import { createTableFromFromObjectArray } from '../data/utils';

export type UsZone = 'Eastern' | 'Central' | 'Mountain' | 'Pacific' | 'Alaska' | 'Hawaii';

export interface City {
    name: string;
    /** A US state's postal code, else the country's ISO3 code. */
    area: string;
    latitude: number;
    longitude: number;
    zone?: UsZone;
    /** The city's IANA time zone, for its clock time and daylight saving. */
    tz: string;
}

const CITY_TZ: Record<string, string> = {
    'New York': 'America/New_York', 'Los Angeles': 'America/Los_Angeles', Chicago: 'America/Chicago', Houston: 'America/Chicago',
    Phoenix: 'America/Phoenix', Philadelphia: 'America/New_York', 'San Antonio': 'America/Chicago', 'San Diego': 'America/Los_Angeles',
    Dallas: 'America/Chicago', 'San Francisco': 'America/Los_Angeles', Austin: 'America/Chicago', Seattle: 'America/Los_Angeles',
    Denver: 'America/Denver', Washington: 'America/New_York', Boston: 'America/New_York', Nashville: 'America/Chicago',
    Detroit: 'America/Detroit', 'Las Vegas': 'America/Los_Angeles', Portland: 'America/Los_Angeles', Atlanta: 'America/New_York',
    Miami: 'America/New_York', Minneapolis: 'America/Chicago', 'New Orleans': 'America/Chicago', 'Salt Lake City': 'America/Denver',
    Anchorage: 'America/Anchorage', Honolulu: 'Pacific/Honolulu',
    London: 'Europe/London', Paris: 'Europe/Paris', Berlin: 'Europe/Berlin', Madrid: 'Europe/Madrid', Rome: 'Europe/Rome',
    Amsterdam: 'Europe/Amsterdam', Stockholm: 'Europe/Stockholm', Warsaw: 'Europe/Warsaw', Vienna: 'Europe/Vienna', Athens: 'Europe/Athens',
    Lisbon: 'Europe/Lisbon', Dublin: 'Europe/Dublin', Oslo: 'Europe/Oslo', Helsinki: 'Europe/Helsinki', Istanbul: 'Europe/Istanbul',
    Zurich: 'Europe/Zurich', Prague: 'Europe/Prague', Brussels: 'Europe/Brussels',
    Tokyo: 'Asia/Tokyo', Seoul: 'Asia/Seoul', Beijing: 'Asia/Shanghai', Shanghai: 'Asia/Shanghai', 'Hong Kong': 'Asia/Hong_Kong',
    Taipei: 'Asia/Taipei', Singapore: 'Asia/Singapore', Bangkok: 'Asia/Bangkok', Jakarta: 'Asia/Jakarta', Manila: 'Asia/Manila',
    Kolkata: 'Asia/Kolkata', Mumbai: 'Asia/Kolkata', Delhi: 'Asia/Kolkata', Dubai: 'Asia/Dubai', 'Ho Chi Minh City': 'Asia/Ho_Chi_Minh',
    'Kuala Lumpur': 'Asia/Kuala_Lumpur',
    Sydney: 'Australia/Sydney', Melbourne: 'Australia/Melbourne', Brisbane: 'Australia/Brisbane', Perth: 'Australia/Perth',
    Adelaide: 'Australia/Adelaide', Hobart: 'Australia/Hobart', Darwin: 'Australia/Darwin', Auckland: 'Pacific/Auckland',
    Wellington: 'Pacific/Auckland', Christchurch: 'Pacific/Auckland', Suva: 'Pacific/Fiji',
    Cairo: 'Africa/Cairo', Lagos: 'Africa/Lagos', Nairobi: 'Africa/Nairobi', Johannesburg: 'Africa/Johannesburg', 'Cape Town': 'Africa/Johannesburg',
    Casablanca: 'Africa/Casablanca', Accra: 'Africa/Accra', 'Addis Ababa': 'Africa/Addis_Ababa', Dakar: 'Africa/Dakar',
    Kinshasa: 'Africa/Kinshasa', Algiers: 'Africa/Algiers', 'Dar es Salaam': 'Africa/Dar_es_Salaam',
    Toronto: 'America/Toronto', Vancouver: 'America/Vancouver', Montreal: 'America/Toronto', 'Mexico City': 'America/Mexico_City',
    Bogotá: 'America/Bogota', Lima: 'America/Lima', Santiago: 'America/Santiago', 'Buenos Aires': 'America/Argentina/Buenos_Aires',
    'São Paulo': 'America/Sao_Paulo', 'Rio de Janeiro': 'America/Sao_Paulo', Havana: 'America/Havana', 'Panama City': 'America/Panama',
    Quito: 'America/Guayaquil', Caracas: 'America/Caracas',
};

const city = (name: string, area: string, latitude: number, longitude: number, zone?: UsZone): City =>
    ({ name, area, latitude, longitude, ...(zone && { zone }), tz: CITY_TZ[name] ?? 'UTC' });

export const US_CITIES: City[] = [
    city('New York', 'NY', 40.7128, -74.006, 'Eastern'), city('Los Angeles', 'CA', 34.0522, -118.2437, 'Pacific'),
    city('Chicago', 'IL', 41.8781, -87.6298, 'Central'), city('Houston', 'TX', 29.7604, -95.3698, 'Central'),
    city('Phoenix', 'AZ', 33.4484, -112.074, 'Mountain'), city('Philadelphia', 'PA', 39.9526, -75.1652, 'Eastern'),
    city('San Antonio', 'TX', 29.4241, -98.4936, 'Central'), city('San Diego', 'CA', 32.7157, -117.1611, 'Pacific'),
    city('Dallas', 'TX', 32.7767, -96.797, 'Central'), city('San Francisco', 'CA', 37.7749, -122.4194, 'Pacific'),
    city('Austin', 'TX', 30.2672, -97.7431, 'Central'), city('Seattle', 'WA', 47.6062, -122.3321, 'Pacific'),
    city('Denver', 'CO', 39.7392, -104.9903, 'Mountain'), city('Washington', 'DC', 38.9072, -77.0369, 'Eastern'),
    city('Boston', 'MA', 42.3601, -71.0589, 'Eastern'), city('Nashville', 'TN', 36.1627, -86.7816, 'Central'),
    city('Detroit', 'MI', 42.3314, -83.0458, 'Eastern'), city('Las Vegas', 'NV', 36.1699, -115.1398, 'Pacific'),
    city('Portland', 'OR', 45.5152, -122.6784, 'Pacific'), city('Atlanta', 'GA', 33.749, -84.388, 'Eastern'),
    city('Miami', 'FL', 25.7617, -80.1918, 'Eastern'), city('Minneapolis', 'MN', 44.9778, -93.265, 'Central'),
    city('New Orleans', 'LA', 29.9511, -90.0715, 'Central'), city('Salt Lake City', 'UT', 40.7608, -111.891, 'Mountain'),
    city('Anchorage', 'AK', 61.2181, -149.9003, 'Alaska'), city('Honolulu', 'HI', 21.3069, -157.8583, 'Hawaii'),
];

/** Each state's main time zone (a few states span two; they count where most people live). */
export const US_STATE_ZONES: Record<string, UsZone> = Object.fromEntries([
    ...['CT', 'DE', 'DC', 'FL', 'GA', 'IN', 'KY', 'ME', 'MD', 'MA', 'MI', 'NH', 'NJ', 'NY', 'NC', 'OH', 'PA', 'RI', 'SC', 'VT', 'VA', 'WV']
        .map(state => [state, 'Eastern']),
    ...['AL', 'AR', 'IL', 'IA', 'KS', 'LA', 'MN', 'MS', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'TX', 'WI'].map(state => [state, 'Central']),
    ...['AZ', 'CO', 'ID', 'MT', 'NM', 'UT', 'WY'].map(state => [state, 'Mountain']),
    ...['CA', 'NV', 'OR', 'WA'].map(state => [state, 'Pacific']),
    ['AK', 'Alaska'], ['HI', 'Hawaii'],
]);

/** Cities of each continent, for a time zone outside the US. */
export const REGION_CITIES: Record<'europe' | 'asia' | 'oceania' | 'africa' | 'americas', City[]> = {
    europe: [
        city('London', 'GBR', 51.5074, -0.1278), city('Paris', 'FRA', 48.8566, 2.3522), city('Berlin', 'DEU', 52.52, 13.405),
        city('Madrid', 'ESP', 40.4168, -3.7038), city('Rome', 'ITA', 41.9028, 12.4964), city('Amsterdam', 'NLD', 52.3676, 4.9041),
        city('Stockholm', 'SWE', 59.3293, 18.0686), city('Warsaw', 'POL', 52.2297, 21.0122), city('Vienna', 'AUT', 48.2082, 16.3738),
        city('Athens', 'GRC', 37.9838, 23.7275), city('Lisbon', 'PRT', 38.7223, -9.1393), city('Dublin', 'IRL', 53.3498, -6.2603),
        city('Oslo', 'NOR', 59.9139, 10.7522), city('Helsinki', 'FIN', 60.1699, 24.9384), city('Istanbul', 'TUR', 41.0082, 28.9784),
        city('Zurich', 'CHE', 47.3769, 8.5417), city('Prague', 'CZE', 50.0755, 14.4378), city('Brussels', 'BEL', 50.8503, 4.3517),
    ],
    asia: [
        city('Tokyo', 'JPN', 35.6762, 139.6503), city('Seoul', 'KOR', 37.5665, 126.978), city('Beijing', 'CHN', 39.9042, 116.4074),
        city('Shanghai', 'CHN', 31.2304, 121.4737), city('Hong Kong', 'HKG', 22.3193, 114.1694), city('Taipei', 'TWN', 25.033, 121.5654),
        city('Singapore', 'SGP', 1.3521, 103.8198), city('Bangkok', 'THA', 13.7563, 100.5018), city('Jakarta', 'IDN', -6.2088, 106.8456),
        city('Manila', 'PHL', 14.5995, 120.9842), city('Kolkata', 'IND', 22.5726, 88.3639), city('Mumbai', 'IND', 19.076, 72.8777),
        city('Delhi', 'IND', 28.6139, 77.209), city('Dubai', 'ARE', 25.2048, 55.2708), city('Ho Chi Minh City', 'VNM', 10.8231, 106.6297),
        city('Kuala Lumpur', 'MYS', 3.139, 101.6869),
    ],
    oceania: [
        city('Sydney', 'AUS', -33.8688, 151.2093), city('Melbourne', 'AUS', -37.8136, 144.9631), city('Brisbane', 'AUS', -27.4698, 153.0251),
        city('Perth', 'AUS', -31.9505, 115.8605), city('Adelaide', 'AUS', -34.9285, 138.6007), city('Hobart', 'AUS', -42.8821, 147.3272),
        city('Darwin', 'AUS', -12.4634, 130.8456), city('Auckland', 'NZL', -36.8485, 174.7633), city('Wellington', 'NZL', -41.2865, 174.7762),
        city('Christchurch', 'NZL', -43.5321, 172.6362), city('Suva', 'FJI', -18.1248, 178.4501),
    ],
    africa: [
        city('Cairo', 'EGY', 30.0444, 31.2357), city('Lagos', 'NGA', 6.5244, 3.3792), city('Nairobi', 'KEN', -1.2921, 36.8219),
        city('Johannesburg', 'ZAF', -26.2041, 28.0473), city('Cape Town', 'ZAF', -33.9249, 18.4241), city('Casablanca', 'MAR', 33.5731, -7.5898),
        city('Accra', 'GHA', 5.6037, -0.187), city('Addis Ababa', 'ETH', 9.0054, 38.7636), city('Dakar', 'SEN', 14.7167, -17.4677),
        city('Kinshasa', 'COD', -4.4419, 15.2663), city('Algiers', 'DZA', 36.7538, 3.0588), city('Dar es Salaam', 'TZA', -6.7924, 39.2083),
    ],
    americas: [
        city('Toronto', 'CAN', 43.6532, -79.3832), city('Vancouver', 'CAN', 49.2827, -123.1207), city('Montreal', 'CAN', 45.5017, -73.5673),
        city('Mexico City', 'MEX', 19.4326, -99.1332), city('Bogotá', 'COL', 4.711, -74.0721), city('Lima', 'PER', -12.0464, -77.0428),
        city('Santiago', 'CHL', -33.4489, -70.6693), city('Buenos Aires', 'ARG', -34.6037, -58.3816), city('São Paulo', 'BRA', -23.5505, -46.6333),
        city('Rio de Janeiro', 'BRA', -22.9068, -43.1729), city('Havana', 'CUB', 23.1136, -82.3666), city('Panama City', 'PAN', 8.9824, -79.5199),
        city('Quito', 'ECU', -0.1807, -78.4678), city('Caracas', 'VEN', 10.4806, -66.9036),
    ],
};

/** The US time zone (Eastern, Central, …) an IANA zone is in; undefined outside the US. Arizona counts as Mountain. */
export function usZone(timeZone: string): UsZone | undefined {
    if (timeZone === 'America/New_York' || timeZone === 'America/Detroit'
        || /^America\/(Kentucky|Indiana\/(?!Knox|Tell_City))/.test(timeZone)) return 'Eastern';
    if (/^America\/(Chicago|Menominee|North_Dakota\/|Indiana\/(Knox|Tell_City))/.test(timeZone)) return 'Central';
    if (/^America\/(Denver|Boise|Phoenix)$/.test(timeZone)) return 'Mountain';
    if (timeZone === 'America/Los_Angeles') return 'Pacific';
    if (/^America\/(Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome)$/.test(timeZone)) return 'Alaska';
    if (timeZone === 'Pacific/Honolulu' || timeZone === 'America/Adak') return 'Hawaii';
    return undefined;
}

/** Where the user seems to be, from the time zone: the cities to fetch, the ones near them, and the area to shade. */
export interface Region {
    us: boolean;
    cities: City[];
    nearby: City[];
    /** The city standing for where the user is: one in their time zone, else the nearest listed. */
    home: City;
    /** How the request names where the user is, e.g. "on Pacific time" or "near Paris". */
    where: string;
    /** The map's shaded area: states (postal codes) or countries (ISO3), with a label for its legend. */
    shade: { key: 'state' | 'country'; areas: string[]; label: string };
}

const distance = (a: City, b: City) => Math.hypot(a.latitude - b.latitude, (a.longitude - b.longitude) * Math.cos((a.latitude + b.latitude) * Math.PI / 360));

// Older names some browsers still report.
const TZ_ALIASES: Record<string, string> = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'America/Montreal': 'America/Toronto',
    'Europe/Kiev': 'Europe/Kyiv', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires' };

export function regionFor(rawTimeZone: string): Region {
    const timeZone = TZ_ALIASES[rawTimeZone] ?? rawTimeZone;
    const zone = usZone(timeZone);
    if (zone) {
        const nearby = US_CITIES.filter(item => item.zone === zone);
        return {
            us: true, cities: US_CITIES, nearby, home: nearby.find(item => item.tz === timeZone) ?? nearby[0], where: `on ${zone} time`,
            shade: { key: 'state', areas: Object.keys(US_STATE_ZONES).filter(state => US_STATE_ZONES[state] === zone), label: `${zone} time (approx.)` },
        };
    }
    const [continent] = timeZone.split('/');
    const cities = continent === 'Europe' ? REGION_CITIES.europe
        : continent === 'Asia' ? REGION_CITIES.asia
        : continent === 'Australia' || continent === 'Pacific' ? REGION_CITIES.oceania
        : continent === 'Africa' ? REGION_CITIES.africa
        : continent === 'America' ? REGION_CITIES.americas
        : [...REGION_CITIES.europe.slice(0, 4), ...REGION_CITIES.asia.slice(0, 4), ...REGION_CITIES.americas.slice(0, 4),
            ...REGION_CITIES.africa.slice(0, 2), ...REGION_CITIES.oceania.slice(0, 2)];
    // The zone's own city, when one listed shares it (Europe/Paris, Asia/Kolkata), and its neighbours.
    const named = (timeZone.split('/').pop() ?? '').replace(/_/g, ' ');
    const home = cities.find(item => item.name === named) ?? cities.find(item => item.tz === timeZone);
    const nearby = home ? [...cities].sort((a, b) => distance(a, home) - distance(b, home)).slice(0, 6) : cities.slice(0, 6);
    return {
        us: false, cities, nearby, home: home ?? nearby[0], where: home ? `near ${home.name}` : 'in my part of the world',
        shade: home ? { key: 'country', areas: [home.area], label: `Near you (${home.name})` }
            : { key: 'country', areas: Array.from(new Set(cities.map(item => item.area))), label: 'Your region (approx.)' },
    };
}

export const localTimeZone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
};

export interface LiveData {
    tables: DictTable[];
    /** What the thread shows the user asked; the agent gets `request`, about the tables as loaded (they may be renamed). */
    label: string;
    request: (tableNames: string[]) => string;
}

export const LIVE_QUESTIONS = ['umbrella', 'warmer', 'daylight', 'wiki', 'countries', 'moon'] as const;
export type LiveQuestion = typeof LIVE_QUESTIONS[number];

/** Questions whose data comes from Open-Meteo, whose free service is for non-commercial use within a daily cap. */
const OPEN_METEO_QUESTIONS: LiveQuestion[] = ['umbrella', 'warmer'];

/** The questions this deployment offers: Open-Meteo's only on the user's own computer (local mode), where its terms
 *  and limits are the user's; daylight (computed here) and Wikipedia (open to all) everywhere. */
export const availableLiveQuestions = (localMode: boolean): LiveQuestion[] =>
    LIVE_QUESTIONS.filter(question => localMode || !OPEN_METEO_QUESTIONS.includes(question));

/** A service's failure, by its status, said plainly for the system messages. */
export class LiveDataError extends Error {
    constructor(readonly source: string, readonly status: number) {
        super(`${source}: ${status}${status === 429 ? ' (rate limited; try again in a minute)' : ''}`);
    }
}

// ── Fetching: answers are cached for an hour (in memory and the browser's storage), and a rate-limited request
// waits as long as the service says (its Retry-After or rate-limit reset) before trying again, twice at most.
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_PREFIX = 'df-live:';
const memoryCache = new Map<string, { at: number; body: unknown }>();

export function clearLiveDataCache() {
    memoryCache.clear();
    try {
        for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
}

const cached = (url: string): unknown => {
    const now = Date.now();
    let hit = memoryCache.get(url);
    if (!hit) {
        try { hit = JSON.parse(localStorage.getItem(CACHE_PREFIX + url) || 'null') ?? undefined; } catch { hit = undefined; }
    }
    return hit && now - hit.at < CACHE_TTL_MS ? hit.body : undefined;
};

const remember = (url: string, body: unknown) => {
    const entry = { at: Date.now(), body };
    memoryCache.set(url, entry);
    try {
        // Old answers go first, so the storage holds only the last hour's.
        for (const key of Object.keys(localStorage)) {
            if (!key.startsWith(CACHE_PREFIX)) continue;
            const at = (JSON.parse(localStorage.getItem(key) || '{}') as { at?: number }).at ?? 0;
            if (entry.at - at >= CACHE_TTL_MS) localStorage.removeItem(key);
        }
        localStorage.setItem(CACHE_PREFIX + url, JSON.stringify(entry));
    } catch { /* full or unavailable: the memory cache still serves this page */ }
};

/** How long a rate-limited answer asks us to wait, within reason. */
const retryDelay = (response: Response, attempt: number): number => {
    const after = Number(response.headers.get('Retry-After'));
    const reset = Number(response.headers.get('X-RateLimit-Reset'));
    const ms = Number.isFinite(after) && response.headers.has('Retry-After') ? after * 1000
        : Number.isFinite(reset) && reset > 0 ? reset * 1000 - Date.now()
        : 1500 * attempt;
    return Math.min(10_000, Math.max(0, ms));
};

async function getJson(url: string, source: string, fetchImpl: typeof fetch): Promise<any> {
    const hit = cached(url);
    if (hit !== undefined) return hit;
    let response = await fetchImpl(url);
    for (let attempt = 1; response.status === 429 && attempt <= 2; attempt++) {
        await new Promise(resolve => setTimeout(resolve, retryDelay(response, attempt)));
        response = await fetchImpl(url);
    }
    if (!response.ok) throw new LiveDataError(source, response.status);
    const body = await response.json();
    remember(url, body);
    return body;
}

// These runs make a few standard views at once: looking at each with view would pause the run on the user's browser.
const NO_VIEW = ' No need to look at the views with the view tool.';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

const table = (name: string, rows: Record<string, unknown>[], url?: string): DictTable => {
    if (!rows.length) throw new Error(`No rows for ${name}`);
    const made = createTableFromFromObjectArray(name, rows);
    return url ? { ...made, source: { type: 'url' as const, url } } : made;
};

const cityColumns = (item: City, region: Region) => ({
    city: item.name, [region.us ? 'state' : 'country']: item.area, ...(item.zone && { time_zone: item.zone }),
    latitude: item.latitude, longitude: item.longitude, near_me: region.nearby.includes(item),
});

/** The areas a map shades for where the user is. */
const shadeTable = (region: Region) => table('my_area', region.shade.areas.map(area => ({ [region.shade.key]: area, label: region.shade.label })));

const shadeRequest = (region: Region, name: string) => `On maps, shade the ${region.shade.key === 'state' ? 'states' : 'countries'} in the table "${name}" `
    + `lightly under the other marks, as roughly where I am (legend: "${region.shade.label}"; the time zone is all I know, so it is approximate).`;

/** Open-Meteo answers for several places at once with one result per place, in order. */
async function openMeteo(url: string, cities: City[], params: Record<string, string>, fetchImpl: typeof fetch): Promise<{ url: string; results: any[] }> {
    const query = new URLSearchParams({
        latitude: cities.map(item => item.latitude).join(','), longitude: cities.map(item => item.longitude).join(','), timezone: 'auto', ...params,
    });
    const full = `${url}?${query}`;
    const body = await getJson(full, 'Open-Meteo', fetchImpl);
    return { url: full, results: Array.isArray(body) ? body : [body] };
}

const units = (region: Region) => region.us
    ? { temperature_unit: 'fahrenheit', precipitation_unit: 'inch', high: 'high_f', low: 'low_f', rain: 'precipitation_in', temp: '°F', amount: 'inches' }
    : { temperature_unit: 'celsius', precipitation_unit: 'mm', high: 'high_c', low: 'low_c', rain: 'precipitation_mm', temp: '°C', amount: 'mm' };

const nearbyNames = (region: Region) => region.nearby.map(item => item.name).join(', ');

async function umbrella(region: Region, label: string, fetchImpl: typeof fetch): Promise<LiveData> {
    const unit = units(region);
    const { url, results } = await openMeteo(FORECAST_URL, region.cities, { daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
        temperature_unit: unit.temperature_unit, precipitation_unit: unit.precipitation_unit, forecast_days: '7' }, fetchImpl);
    const rows = region.cities.flatMap((item, index) => {
        const daily = results[index]?.daily;
        return (daily?.time ?? []).map((date: string, day: number) => ({ ...cityColumns(item, region), date,
            [unit.high]: daily.temperature_2m_max[day], [unit.low]: daily.temperature_2m_min[day], [unit.rain]: daily.precipitation_sum[day] }));
    });
    return {
        tables: [table('weather_forecast', rows, url), shadeTable(region)], label,
        request: ([forecast, area]) => `I loaded this week's daily weather forecast for ${region.cities.length} cities into the table "${forecast}" `
            + `(high and low in ${unit.temp}, precipitation in ${unit.amount}, with each city's location; near_me marks the cities near me). Make three views: `
            + '1) a map of all the cities, colored by the week\'s average high and sized by total precipitation; '
            + `2) a chart of the daily high and low temperatures in the cities ${region.where} (${nearbyNames(region)}); `
            + `3) a chart of the daily precipitation in those cities. ${shadeRequest(region, area)} `
            + 'Then tell me in a sentence or two whether I will need an umbrella this week, and what else stands out.' + NO_VIEW,
    };
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

async function warmer(region: Region, label: string, fetchImpl: typeof fetch, now: Date): Promise<LiveData> {
    const unit = units(region);
    const cities = region.nearby;
    const params = { daily: 'temperature_2m_max,temperature_2m_min', temperature_unit: unit.temperature_unit };
    const forecast = await openMeteo(FORECAST_URL, cities, { ...params, forecast_days: '7' }, fetchImpl);
    const week = (forecast.results[0]?.daily?.time ?? []) as string[];
    if (!week.length) throw new Error('Open-Meteo returned no forecast');
    // The same seven days in each of the past ten years.
    const years = Array.from({ length: 10 }, (_, index) => now.getUTCFullYear() - 1 - index);
    // A week across New Year ends in the year after it starts.
    const spans = Number(week[week.length - 1].slice(0, 4)) - Number(week[0].slice(0, 4));
    // One year at a time, so the requests don't arrive as a burst; a year that fails is left out, as long as most
    // of the decade is there to compare with.
    const past: { year: number; results: any[] }[] = [];
    let lastError: unknown;
    for (const year of years) {
        try {
            const { results } = await openMeteo(ARCHIVE_URL, cities, { ...params,
                start_date: `${year}${week[0].slice(4)}`, end_date: `${year + spans}${week[week.length - 1].slice(4)}` }, fetchImpl);
            past.push({ year, results });
        } catch (error) { lastError = error; }
    }
    if (past.length < 5) throw lastError ?? new Error('Too few past years');
    const rows = [
        ...cities.flatMap((item, index) => week.map((date, day) => ({ ...cityColumns(item, region), year: now.getUTCFullYear(), period: 'this week (forecast)',
            day: date.slice(5), [unit.high]: forecast.results[index]?.daily?.temperature_2m_max?.[day], [unit.low]: forecast.results[index]?.daily?.temperature_2m_min?.[day] }))),
        ...past.flatMap(result => cities.flatMap((item, index) => {
            const daily = result.results[index]?.daily;
            return (daily?.time ?? []).map((date: string, day: number) => ({ ...cityColumns(item, region), year: result.year, period: 'same week, past years',
                day: date.slice(5), [unit.high]: daily.temperature_2m_max[day], [unit.low]: daily.temperature_2m_min[day] }));
        })),
    ].filter(row => row[unit.high] !== null && row[unit.high] !== undefined);
    return {
        tables: [table('this_week_vs_past_years', rows, forecast.url), shadeTable(region)], label,
        request: ([temperatures, area]) => `I loaded this week's forecast highs and lows (in ${unit.temp}) for the cities ${region.where} (${nearbyNames(region)}), `
            + `next to the same week in ${past.length} of the past ten years, into the table "${temperatures}" (period says which; day is month-day). Make three views: `
            + '1) for each city, this week\'s daily high against the range and average of the same days in past years; '
            + '2) a map of the cities colored by how much warmer or cooler this week is than their past-years average; '
            + `3) a chart of each past year's average high for this week, with this week marked, to show any trend. ${shadeRequest(region, area)} `
            + 'Then tell me in a sentence or two whether this week is warmer than usual.' + NO_VIEW,
    };
}

/** Hours of daylight at a latitude on a day of the year (sunrise to sunset, with the usual refraction allowance). */
export function daylightHours(latitude: number, dayOfYear: number): number {
    const declination = 23.44 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365) * Math.PI / 180;
    const phi = latitude * Math.PI / 180;
    const cosHour = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination));
    if (cosHour <= -1) return 24;
    if (cosHour >= 1) return 0;
    return 2 * Math.acos(cosHour) * 180 / Math.PI / 15;
}

const dayOfYear = (date: Date) => Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);

/** Whether days are getting shorter where the user is, over the next month. */
export const daysShortening = (region: Region, now: Date) => {
    const latitude = region.nearby.reduce((sum, item) => sum + item.latitude, 0) / Math.max(1, region.nearby.length);
    return daylightHours(latitude, dayOfYear(now) + 30) < daylightHours(latitude, dayOfYear(now));
};

function daylight(region: Region, label: string, now: Date): LiveData {
    const days = Array.from({ length: 120 }, (_, index) => new Date(now.getTime() + index * 86_400_000));
    const rows = [...region.cities].sort((a, b) => b.latitude - a.latitude).flatMap(item => days.map(date => ({
        ...cityColumns(item, region), date: isoDay(date), daylight_hours: Math.round(daylightHours(item.latitude, dayOfYear(date)) * 100) / 100,
    })));
    const direction = daysShortening(region, now) ? 'shorter' : 'longer';
    return {
        tables: [table('daylight_next_120_days', rows), shadeTable(region)], label,
        request: ([hours, area]) => `I loaded the hours of daylight for the next 120 days in ${region.cities.length} cities, north to south, into the table "${hours}" `
            + '(computed from each city\'s latitude). Make three views: 1) daylight curves for a handful of cities from the far north to the far south; '
            + '2) a map of the cities colored by today\'s hours of daylight, from dark (short days) to sunny yellow (long days), '
            + 'and sized by how many minutes of daylight each gains or loses per week; '
            + `3) how many minutes of daylight the cities ${region.where} (${nearbyNames(region)}) gain or lose each week. ${shadeRequest(region, area)} `
            + `Then tell me in a sentence or two how fast the days are getting ${direction} where I am, and when that turns around.` + NO_VIEW,
    };
}

const WIKI_LANGUAGES = new Set(['en', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'ko', 'pt', 'ru', 'zh']);
// Namespace pages and main pages are not articles people read about (in the languages the countries below read).
const NOT_ARTICLE = new RegExp('^(Special|Wikipedia|File|Portal|Help|Template|Category|Talk|User|Spezial|Datei|Spécial|Wikipédia|Especial|Speciale|'
    + 'Speciaal|Specjalna|Özel|Vikipedi|Istimewa|Đặc_biệt|พิเศษ|วิกิพีเดีย|Служебная|Википедия|Спеціальна|Вікіпедія|خاص|ويكيبيديا|מיוחד|'
    + 'ויקיפדיה|ویژه|ویکی‌پدیا|特別|特殊|위키백과|특수|विशेष)[:：]');
const MAIN_PAGES = new Set(['Main_Page', 'Hauptseite', 'メインページ', 'Заглавная_страница', 'Halaman_Utama', 'मुखपृष्ठ', 'Pagina_principale',
    'Hoofdpagina', 'Anasayfa', 'Trang_Chính', 'หน้าหลัก', 'الصفحة_الرئيسية', 'עמוד_ראשי', 'Головна_сторінка', 'صفحهٔ_اصلی', 'Laman_Utama',
    'Unang_Pahina']);
const isArticle = (title: string) => title !== '-' && !MAIN_PAGES.has(title) && !NOT_ARTICLE.test(title);
const wikiDate = (date: Date) => `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;

async function wiki(language: string, label: string, fetchImpl: typeof fetch, now: Date): Promise<LiveData> {
    const project = `${WIKI_LANGUAGES.has(language) ? language : 'en'}.wikipedia`;
    // Yesterday's list may not be out yet early in the (UTC) day: then the day before.
    let top: { article: string; views: number }[] = [];
    let day = new Date(now.getTime() - 86_400_000);
    for (let attempt = 0; attempt < 2 && !top.length; attempt++, day = new Date(day.getTime() - 86_400_000)) {
        try {
            top = (await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${project}/all-access/${wikiDate(day)}`,
                'Wikimedia', fetchImpl))?.items?.[0]?.articles ?? [];
        } catch (error) {
            if (!(error instanceof LiveDataError && error.status === 404)) throw error;
        }
    }
    const listed = new Date(day.getTime() + 86_400_000);
    const articles = top.filter(item => isArticle(item.article)).slice(0, 20);
    const title = (article: string) => article.replace(/_/g, ' ');
    const ranks = articles.map((item, index) => ({ rank: index + 1, article: title(item.article), views: item.views, date: isoDay(listed) }));
    const start = new Date(listed.getTime() - 6 * 86_400_000);
    const stamp = (date: Date) => isoDay(date).replace(/-/g, '');
    const trends = (await Promise.all(articles.slice(0, 5).map(async item => {
        const body = await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/`
            + `${encodeURIComponent(item.article)}/daily/${stamp(start)}/${stamp(listed)}`, 'Wikimedia', fetchImpl).catch(() => undefined);
        return (body?.items ?? []).map((point: any) => ({ article: title(item.article),
            date: `${point.timestamp.slice(0, 4)}-${point.timestamp.slice(4, 6)}-${point.timestamp.slice(6, 8)}`, views: point.views }));
    }))).flat();
    return {
        tables: [table('wikipedia_most_read', ranks), table('wikipedia_top_five_this_week', trends)], label,
        request: ([most, week]) => `I loaded the ${ranks.length} most-read articles on ${project} on ${isoDay(listed)} into the table "${most}", `
            + `and the daily views of the top five over that week into "${week}". Make two views: 1) a bar chart of the most-read articles; `
            + '2) the top five\'s daily views over the week, to show which ones spiked. Then tell me in a sentence or two what the world was reading about, '
            + 'and guess why the top ones spiked.' + NO_VIEW,
    };
}

// ── The moon and clocks, computed here (no service): the mean lunation for the moon (good to about a day), and the
// browser's own time-zone rules for clock times.
const validZone = (timeZone: string) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone }); return timeZone || 'UTC'; } catch { return 'UTC'; }
};

const zoneParts = (date: Date, timeZone: string) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
    return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour % 24, minute: +parts.minute, second: +parts.second };
};

/** A zone's offset from UTC at an instant, in minutes. */
export const utcOffsetMinutes = (date: Date, timeZone: string) => {
    const p = zoneParts(date, timeZone);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60_000);
};

/** The instant a zone's clock shows `hour` on a day. */
const atClock = (year: number, month: number, day: number, hour: number, timeZone: string) => {
    let guess = Date.UTC(year, month, day, hour);
    for (let pass = 0; pass < 2; pass++) guess = Date.UTC(year, month, day, hour) - utcOffsetMinutes(new Date(guess), timeZone) * 60_000;
    return new Date(guess);
};
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

const SYNODIC_DAYS = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
/** The moon's age (days since new) and lit fraction at an instant, from the mean lunation. */
export function moonAt(date: Date): { age: number; illumination: number } {
    const age = (((date.getTime() - KNOWN_NEW_MOON) / 86_400_000) % SYNODIC_DAYS + SYNODIC_DAYS) % SYNODIC_DAYS;
    return { age, illumination: (1 - Math.cos(2 * Math.PI * age / SYNODIC_DAYS)) / 2 };
}

function moon(label: string, timeZone: string, now: Date): LiveData {
    const zone = validZone(timeZone);
    const phase = (age: number) => age < 1.85 || age >= 27.68 ? 'new' : age < 5.54 ? 'waxing crescent' : age < 9.23 ? 'first quarter'
        : age < 12.92 ? 'waxing gibbous' : age < 16.61 ? 'full' : age < 20.3 ? 'waning gibbous' : age < 23.99 ? 'last quarter' : 'waning crescent';
    const start = zoneParts(now, zone);
    const rows = Array.from({ length: 60 }, (_, index) => {
        const evening = atClock(start.year, start.month - 1, start.day + index, 21, zone);
        const { age, illumination } = moonAt(evening);
        const next = moonAt(new Date(evening.getTime() + 86_400_000)).age;
        // The night a principal phase falls on: the moon's age crosses it before the next evening.
        const crosses = (at: number) => age <= at && (next > at || next < age);
        const event = crosses(SYNODIC_DAYS / 2) ? 'full moon' : crosses(SYNODIC_DAYS / 4) ? 'first quarter'
            : crosses(SYNODIC_DAYS * 3 / 4) ? 'last quarter' : next < age ? 'new moon' : '';
        const p = zoneParts(evening, zone);
        return { date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
            illumination_pct: round(illumination * 100, 1), moon_age_days: round(age, 1), phase: phase(age), event };
    });
    return {
        tables: [table('moon_next_60_days', rows)], label,
        request: ([nights]) => `I loaded the moon over the next 60 nights (at 9 pm on my clock, ${zone}) into the table "${nights}" `
            + '(how much of it is lit, its age in days, its phase, and the night of each full moon, new moon and quarter; '
            + 'computed from the average lunar month, so dates may be off by a day). Make two views: '
            + '1) the lit percentage night by night, with the full and new moons marked; 2) a calendar of the next two months shaded by how lit the moon is. '
            + 'Then tell me in a sentence or two when the next full moon is and when the darkest nights for stargazing are.' + NO_VIEW,
    };
}

/** Countries whose top reads the countries question compares: ISO2 (the API's), ISO3 (the map's) and a name. */
const READING_COUNTRIES: [string, string, string][] = [
    ['US', 'USA', 'United States'], ['GB', 'GBR', 'United Kingdom'], ['CA', 'CAN', 'Canada'], ['AU', 'AUS', 'Australia'], ['IN', 'IND', 'India'],
    ['DE', 'DEU', 'Germany'], ['FR', 'FRA', 'France'], ['ES', 'ESP', 'Spain'], ['IT', 'ITA', 'Italy'], ['NL', 'NLD', 'Netherlands'],
    ['SE', 'SWE', 'Sweden'], ['PL', 'POL', 'Poland'], ['RU', 'RUS', 'Russia'], ['UA', 'UKR', 'Ukraine'], ['TR', 'TUR', 'Turkey'],
    ['JP', 'JPN', 'Japan'], ['KR', 'KOR', 'South Korea'], ['TW', 'TWN', 'Taiwan'], ['ID', 'IDN', 'Indonesia'], ['PH', 'PHL', 'Philippines'],
    ['VN', 'VNM', 'Vietnam'], ['TH', 'THA', 'Thailand'], ['MY', 'MYS', 'Malaysia'], ['BR', 'BRA', 'Brazil'], ['MX', 'MEX', 'Mexico'],
    ['AR', 'ARG', 'Argentina'], ['CO', 'COL', 'Colombia'], ['PT', 'PRT', 'Portugal'], ['ZA', 'ZAF', 'South Africa'], ['NG', 'NGA', 'Nigeria'],
    ['EG', 'EGY', 'Egypt'], ['KE', 'KEN', 'Kenya'], ['SA', 'SAU', 'Saudi Arabia'], ['IL', 'ISR', 'Israel'], ['PK', 'PAK', 'Pakistan'],
    ['IR', 'IRN', 'Iran'],
];

/** Run `task` over `items`, a few at a time, so a burst of requests stays polite. */
async function inBatches<T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    for (let index = 0; index < items.length; index += size) results.push(...await Promise.all(items.slice(index, index + size).map(task)));
    return results;
}

async function countriesReading(region: Region, label: string, fetchImpl: typeof fetch, now: Date): Promise<LiveData> {
    const mine = region.us ? 'USA' : region.home.area;
    // A day's lists come out a day or so later: yesterday's, else the day before's.
    for (let back = 1; back <= 2; back++) {
        const day = new Date(now.getTime() - back * 86_400_000);
        const lists = await inBatches(READING_COUNTRIES, 6, async ([iso2, iso3, name]) => {
            const body = await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/${iso2}/all-access/${wikiDate(day)}`,
                'Wikimedia', fetchImpl).catch(() => undefined);
            const articles: { article: string; project: string; views_ceil: number }[] = body?.items?.[0]?.articles ?? [];
            return articles.filter(item => isArticle(item.article)).slice(0, 3).map((item, index) => ({
                country: name, iso2, iso3, rank: index + 1, article: item.article.replace(/_/g, ' '),
                language: item.project.split('.')[0], views: item.views_ceil, date: isoDay(day), my_country: iso3 === mine,
            }));
        });
        const rows = lists.flat();
        if (lists.filter(list => list.length).length < READING_COUNTRIES.length / 2) continue;
        return {
            tables: [table('what_countries_read', rows)], label,
            request: ([reads]) => `I loaded the top three Wikipedia articles read in each of ${lists.filter(list => list.length).length} countries `
                + `on ${isoDay(day)} into the table "${reads}" (rank 1 is the most read; views are rounded up by Wikipedia; language is the `
                + `Wikipedia edition; my_country marks mine). Make two views: 1) a world map of the countries (key: iso3), each labelled with `
                + 'its most-read article and colored by the language it was read in; 2) the articles read in more than one country, '
                + 'and where. Then tell me in a sentence or two what the world was curious about, what my country read, '
                + 'and a surprise, such as neighbours reading about completely different things.' + NO_VIEW,
        };
    }
    throw new LiveDataError('Wikimedia', 404);
}

/** How a question is offered: the question itself, what shows while its data loads, and a hint of what it fetches. */
export function livePickCopy(t: TFunction, question: LiveQuestion, timeZone = localTimeZone(), now = new Date()) {
    const label = (key: string, defaultValue: string) => t(`upload.livePick.${key}`, { defaultValue }) as string;
    switch (question) {
        case 'umbrella': return { question, ask: label('umbrella', 'Do I need an umbrella this week?'), busy: label('umbrellaBusy', 'Checking the sky…'),
            hint: label('umbrellaHint', "This week's forecast for cities near you, loaded live and charted on a map") };
        case 'warmer': return { question, ask: label('warmer', 'Is this week warmer than usual?'), busy: label('warmerBusy', 'Digging through old weather…'),
            hint: label('warmerHint', "This week's forecast next to the same week in the past ten years, for cities near you") };
        case 'daylight': return { question, ask: daysShortening(regionFor(timeZone), now)
                ? label('daylightShorter', 'How fast are the days getting shorter?') : label('daylightLonger', 'How fast are the days getting longer?'),
            busy: label('daylightBusy', 'Watching the sun…'), hint: label('daylightHint', 'Hours of daylight over the next four months, from north to south') };
        case 'wiki': return { question, ask: label('wiki', "What's the world reading about today?"), busy: label('wikiBusy', "Reading over the world's shoulder…"),
            hint: label('wikiHint', "Yesterday's most-read Wikipedia articles, and how they trended this week") };
        case 'countries': return { question, ask: label('countries', 'What is each country reading today?'),
            busy: label('countriesBusy', "Peeking at the world's reading…"),
            hint: label('countriesHint', "Yesterday's most-read Wikipedia articles around the world, on a map") };
        case 'moon': return { question, ask: label('moon', "When's the next full moon?"), busy: label('moonBusy', 'Checking the moon…'),
            hint: label('moonHint', "The moon's phases over the next two months") };
    }
}

/** Fetch a question's live data for where the time zone says the user is. */
export async function fetchLiveData(t: TFunction, question: LiveQuestion, options: {
    timeZone?: string; language?: string; now?: Date; fetchImpl?: typeof fetch;
} = {}): Promise<LiveData> {
    const { timeZone = localTimeZone(), language = 'en', now = new Date(), fetchImpl = fetch } = options;
    const region = regionFor(timeZone);
    const label = livePickCopy(t, question, timeZone, now).ask;
    switch (question) {
        case 'umbrella': return umbrella(region, label, fetchImpl);
        case 'warmer': return warmer(region, label, fetchImpl, now);
        case 'daylight': return daylight(region, label, now);
        case 'wiki': return wiki(language.split('-')[0], label, fetchImpl, now);
        case 'countries': return countriesReading(region, label, fetchImpl, now);
        case 'moon': return moon(label, timeZone, now);
    }
}
