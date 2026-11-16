import { afterEach, describe, expect, it } from 'vitest';

import { appThemes, chartThemeKey, chartThemeSpec, isSiteTheme, resolvedChartTheme, savedThemeFromResult, setSavedThemes, setSiteTheme, upsertSavedTheme, savedThemes } from '../../../../src/app/savedThemes';
import { DEFAULT_CHART_THEME_ID, resolveDefaultChartTheme } from '../../../../src/app/dfSlice';
import { themeInk } from '../../../../src/maps/styles';

const acme = { id: 'acme', label: 'Acme', description: 'Brand', extends: 'datawrapper', ink: { series: { single: '#14213d', categorical: ['#14213d', '#fca311'] } } };

afterEach(() => setSavedThemes([]));

describe('saved themes', () => {
    it('gives Flint a preset by id, a saved theme as its spec, and nothing for an id the user lacks', () => {
        setSavedThemes([acme]);
        expect(chartThemeSpec('economist')).toBe('economist');
        expect(chartThemeSpec('acme')).toEqual({ id: 'acme', label: 'Acme', extends: 'datawrapper', ink: acme.ink });
        expect(chartThemeSpec('gone')).toBeUndefined();
        expect(chartThemeSpec(undefined)).toBeUndefined();
        expect(resolvedChartTheme('acme')?.ink?.series?.single).toBe('#14213d');
        // A saved theme is merged over its preset.
        expect(resolvedChartTheme('acme')?.type?.headline?.family).toMatch(/Roboto/);
        expect(appThemes([acme])).toEqual({ acme: chartThemeSpec('acme') });
    });

    it('keys drawn charts by the theme content, so an edited theme redraws them', () => {
        setSavedThemes([acme]);
        const before = chartThemeKey('acme');
        upsertSavedTheme({ ...acme, ink: { series: { single: '#000000' } } });
        expect(chartThemeKey('acme')).not.toBe(before);
        expect(savedThemes()).toHaveLength(1);
        expect(chartThemeKey('nyt')).toBe('nyt');
    });

    it('ignores saved themes that would shadow a preset', () => {
        setSavedThemes([acme, { id: 'nyt', label: 'Fake' }]);
        expect(savedThemes().map(theme => theme.id)).toEqual(['acme']);
    });

    it('reads the theme a save_theme result saved', () => {
        expect(savedThemeFromResult(JSON.stringify({ saved: 'acme', new: true, theme: acme }))).toEqual(acme);
        expect(savedThemeFromResult(JSON.stringify({ error: 'Theme not saved: …' }))).toBeUndefined();
        expect(savedThemeFromResult('not json')).toBeUndefined();
    });

    it('styles maps with a saved theme', () => {
        setSavedThemes([acme]);
        expect(themeInk('acme')?.palette.single).toBe('#14213d');
        expect(themeInk('gone')).toBeUndefined();
    });

    it('uses a site\'s theme by id beside the user\'s, as the default unless the user chose another', () => {
        const site = { id: 'uis', label: 'UIS', extends: 'datawrapper', ink: { series: { single: '#0069b4' } } };
        try {
            setSiteTheme(site);
            setSavedThemes([acme]);
            expect(savedThemes().map(theme => theme.id)).toEqual(['uis', 'acme']);
            expect(isSiteTheme('uis') && !isSiteTheme('acme')).toBe(true);
            expect(resolvedChartTheme('uis')?.ink?.series?.single).toBe('#0069b4');
            // Refreshing the user's library keeps the site's theme.
            setSavedThemes([]);
            expect(chartThemeSpec('uis')).toMatchObject({ id: 'uis' });
            expect(resolveDefaultChartTheme({ defaultChartThemeId: DEFAULT_CHART_THEME_ID }, 'uis')).toBe('uis');
            expect(resolveDefaultChartTheme({}, 'uis')).toBe('uis');
            expect(resolveDefaultChartTheme({ defaultChartThemeId: 'nyt' }, 'uis')).toBe('nyt');
            expect(resolveDefaultChartTheme({ defaultChartThemeId: '' }, 'uis')).toBeUndefined();
            expect(resolveDefaultChartTheme({ defaultChartThemeId: DEFAULT_CHART_THEME_ID })).toBe(DEFAULT_CHART_THEME_ID);
        } finally {
            setSiteTheme(undefined);
        }
        expect(chartThemeSpec('uis')).toBeUndefined();
    });
});
