import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { availableLiveQuestions, clearLiveDataCache, daylightHours, fetchLiveData, livePickCopy, moonAt, regionFor, US_CITIES,
    utcOffsetMinutes } from '../../../../src/app/liveDataPick';

const t = ((_key: string, options: { defaultValue: string; [name: string]: unknown }) =>
    options.defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name]))) as unknown as TFunction;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers }));

describe('live data pick', () => {
    beforeEach(() => clearLiveDataCache());

    it('reads where the user is from the time zone: US zone states, or a listed city and its neighbours', () => {
        const pacific = regionFor('America/Los_Angeles');
        expect(pacific.us).toBe(true);
        expect(pacific.nearby.map(city => city.name)).toEqual(['Los Angeles', 'San Diego', 'San Francisco', 'Seattle', 'Las Vegas', 'Portland']);
        expect(pacific.shade).toEqual({ key: 'state', areas: ['CA', 'NV', 'OR', 'WA'], label: 'Pacific time (approx.)' });
        expect(regionFor('America/Indiana/Knox').where).toBe('on Central time');

        const paris = regionFor('Europe/Paris');
        expect(paris.us).toBe(false);
        expect(paris.nearby[0].name).toBe('Paris');
        expect(paris.shade).toEqual({ key: 'country', areas: ['FRA'], label: 'Near you (Paris)' });
        expect(regionFor('Asia/Calcutta').nearby[0].name).toBe('Kolkata');
        // A zone whose city is not listed shades its region.
        expect(regionFor('Europe/Ljubljana').shade.label).toBe('Your region (approx.)');
        expect(regionFor('America/Toronto').cities.some(city => city.name === 'Toronto')).toBe(true);
    });

    it('computes daylight from latitude, including polar day and night', () => {
        expect(daylightHours(0, 80)).toBeCloseTo(12.1, 0);
        expect(daylightHours(51.5, 355)).toBeCloseTo(7.8, 0);
        expect(daylightHours(51.5, 172)).toBeCloseTo(16.6, 0);
        expect(daylightHours(78, 355)).toBe(0);
        expect(daylightHours(78, 172)).toBe(24);
        // Days shorten in a northern November and lengthen in a southern one.
        const november = new Date('2026-11-21T12:00:00Z');
        expect(livePickCopy(t, 'daylight', 'Europe/Paris', november).ask).toBe('How fast are the days getting shorter?');
        expect(livePickCopy(t, 'daylight', 'Australia/Sydney', november).ask).toBe('How fast are the days getting longer?');
    });

    it('loads the forecast for every city with the user\'s area to shade, and asks about the cities near them', async () => {
        const daily = { time: ['2026-11-21', '2026-11-22'], temperature_2m_max: [60, 62], temperature_2m_min: [40, 41], precipitation_sum: [0, 0.3] };
        const fetchImpl = vi.fn(() => json(US_CITIES.map(() => ({ daily }))));

        const live = await fetchLiveData(t, 'umbrella', { timeZone: 'America/Denver', fetchImpl: fetchImpl as unknown as typeof fetch });

        const [forecast, area] = live.tables;
        expect(forecast.rows).toHaveLength(US_CITIES.length * 2);
        expect(forecast.rows[1]).toMatchObject({ city: 'New York', state: 'NY', time_zone: 'Eastern', near_me: false, date: '2026-11-22', precipitation_in: 0.3 });
        expect(forecast.rows.find(row => row.city === 'Denver')?.near_me).toBe(true);
        expect(area.rows.map(row => row.state)).toEqual(['AZ', 'CO', 'ID', 'MT', 'NM', 'UT', 'WY']);
        const request = live.request(['weather_2', 'my_area']);
        expect(request).toContain('"weather_2"');
        expect(request).toContain('cities on Mountain time (Phoenix, Denver, Salt Lake City)');
        expect(request).toContain('shade the states in the table "my_area"');
    });

    it('compares this week with the same days in past years, across New Year too', async () => {
        const week = ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'];
        const urls: string[] = [];
        const fetchImpl = vi.fn((url: string) => {
            urls.push(url);
            const daily = url.includes('archive') ? { time: ['x'], temperature_2m_max: [5], temperature_2m_min: [1] }
                : { time: week, temperature_2m_max: [8, 9, 10, 11], temperature_2m_min: [2, 3, 4, 5] };
            return json(Array.from({ length: 6 }, () => ({ daily })));
        });

        const live = await fetchLiveData(t, 'warmer', { timeZone: 'Europe/Berlin', now: new Date('2026-12-29T09:00:00Z'),
            fetchImpl: fetchImpl as unknown as typeof fetch });

        const archive = urls.filter(url => url.includes('archive'));
        expect(archive).toHaveLength(10);
        expect(archive[0]).toContain('start_date=2025-12-29&end_date=2026-01-01');
        expect(live.tables[0].rows.filter(row => row.period === 'this week (forecast)')).toHaveLength(6 * 4);
        expect(live.tables[0].rows[0]).toMatchObject({ city: 'Berlin', country: 'DEU', high_c: 8 });
    });

    it('lists yesterday\'s most-read articles without special pages, falling back a day when the list is not out yet', async () => {
        const fetchImpl = vi.fn((url: string) => {
            if (url.includes('/top/de.wikipedia/all-access/2026/11/20')) return json({}, 404);
            if (url.includes('/top/')) return json({ items: [{ articles: [
                { article: 'Hauptseite', views: 900 }, { article: 'Spezial:Suche', views: 800 },
                { article: 'Ramayana:_Part_1', views: 500 }, { article: 'Berlin', views: 400 },
            ] }] });
            return json({ items: [{ timestamp: '2026111900', views: 42 }] });
        });

        const live = await fetchLiveData(t, 'wiki', { language: 'de-DE', now: new Date('2026-11-21T06:00:00Z'),
            fetchImpl: fetchImpl as unknown as typeof fetch });

        expect(live.tables[0].rows.map(row => row.article)).toEqual(['Ramayana: Part 1', 'Berlin']);
        expect(live.tables[0].rows[0].date).toBe('2026-11-19');
        expect(live.tables[1].rows[0]).toEqual({ article: 'Ramayana: Part 1', date: '2026-11-19', views: 42 });
        expect(live.request(['a', 'b'])).toContain('de.wikipedia');
    });

    it('lists each country\'s top reads without main or special pages, a day earlier when the lists are not out yet', async () => {
        const fetchImpl = vi.fn((url: string) => {
            if (url.includes('/2026/11/20')) return json({}, 404);
            const country = url.split('/top-per-country/')[1].split('/')[0];
            return json({ items: [{ articles: [
                { article: 'Wikipedia:Hauptseite', project: 'de.wikipedia', views_ceil: 900 },
                { article: 'Main_Page', project: 'en.wikipedia', views_ceil: 800 },
                { article: 'Especial:Pesquisar', project: 'pt.wikipedia', views_ceil: 700 },
                { article: `Story_of_${country}`, project: 'en.wikipedia', views_ceil: 500 },
                { article: 'Shared_news', project: 'en.wikipedia', views_ceil: 400 },
                { article: 'Third', project: 'fr.wikipedia', views_ceil: 300 },
                { article: 'Fourth', project: 'fr.wikipedia', views_ceil: 200 },
            ] }] });
        });

        const live = await fetchLiveData(t, 'countries', { timeZone: 'Europe/Paris', now: new Date('2026-11-21T06:00:00Z'),
            fetchImpl: fetchImpl as unknown as typeof fetch });

        const rows = live.tables[0].rows;
        expect(rows.filter(row => row.iso2 === 'FR')).toEqual([
            { country: 'France', iso2: 'FR', iso3: 'FRA', rank: 1, article: 'Story of FR', language: 'en', views: 500, date: '2026-11-19', my_country: true },
            { country: 'France', iso2: 'FR', iso3: 'FRA', rank: 2, article: 'Shared news', language: 'en', views: 400, date: '2026-11-19', my_country: true },
            { country: 'France', iso2: 'FR', iso3: 'FRA', rank: 3, article: 'Third', language: 'fr', views: 300, date: '2026-11-19', my_country: true },
        ]);
        expect(rows.filter(row => row.my_country)).toHaveLength(3);
        expect(new Set(rows.map(row => row.iso2)).size).toBe(36);
    });

    it('fails rather than loading an empty table when the service does not answer', async () => {
        const fetchImpl = vi.fn(() => json('busy', 503));
        await expect(fetchLiveData(t, 'umbrella', { timeZone: 'Europe/Paris', fetchImpl: fetchImpl as unknown as typeof fetch }))
            .rejects.toThrow('Open-Meteo: 503');
    });

    it('offers the Open-Meteo questions only on the user\'s own computer', () => {
        expect(availableLiveQuestions(true)).toEqual(['umbrella', 'warmer', 'daylight', 'wiki', 'countries', 'moon']);
        expect(availableLiveQuestions(false)).toEqual(['daylight', 'wiki', 'countries', 'moon']);
    });

    it('places the moon, and reads each zone\'s clock', () => {
        expect(moonAt(new Date('2026-01-03T10:03:00Z')).illumination).toBeGreaterThan(0.97);
        expect(utcOffsetMinutes(new Date('2026-01-15T00:00:00Z'), 'America/Los_Angeles')).toBe(-480);
        expect(utcOffsetMinutes(new Date('2026-07-15T00:00:00Z'), 'America/Los_Angeles')).toBe(-420);
    });

    it('computes the moon question without any service', async () => {
        const fetchImpl = vi.fn();
        const options = { timeZone: 'America/Los_Angeles', now: new Date('2026-11-21T20:00:00Z'), fetchImpl: fetchImpl as unknown as typeof fetch };

        const moon = (await fetchLiveData(t, 'moon', options)).tables[0].rows;
        expect(moon).toHaveLength(60);
        expect(moon.filter(row => row.event === 'full moon').length).toBeGreaterThanOrEqual(2);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('waits as long as a rate-limited service asks, and serves a repeat from the cache', async () => {
        const daily = { time: ['2026-11-21'], temperature_2m_max: [12], temperature_2m_min: [4], precipitation_sum: [1.5] };
        const fetchImpl = vi.fn()
            .mockImplementationOnce(() => json({ reason: 'Too many requests' }, 429, { 'Retry-After': '0' }))
            .mockImplementation(() => json(Array.from({ length: 18 }, () => ({ daily }))));
        const options = { timeZone: 'Europe/Paris', fetchImpl: fetchImpl as unknown as typeof fetch };

        expect((await fetchLiveData(t, 'umbrella', options)).tables[0].rows[0]).toMatchObject({ city: 'London', high_c: 12, precipitation_mm: 1.5 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        await fetchLiveData(t, 'umbrella', options);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('compares with the past years it could load, if most of the decade is there', async () => {
        let archiveCalls = 0;
        const fetchImpl = vi.fn((url: string) => {
            if (url.includes('archive') && ++archiveCalls % 3 === 0) return json('down', 500);
            return json(Array.from({ length: 6 }, () => ({ daily: { time: ['2026-11-21'], temperature_2m_max: [10], temperature_2m_min: [3] } })));
        });
        const live = await fetchLiveData(t, 'warmer', { timeZone: 'Europe/Berlin', now: new Date('2026-11-21T09:00:00Z'),
            fetchImpl: fetchImpl as unknown as typeof fetch });
        expect(new Set(live.tables[0].rows.filter(row => row.period !== 'this week (forecast)').map(row => row.year)).size).toBe(7);
        expect(live.request(['a', 'b'])).toContain('in 7 of the past ten years');
    });
});
