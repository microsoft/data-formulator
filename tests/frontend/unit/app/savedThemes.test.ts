import { afterEach, describe, expect, it } from 'vitest';

import { appThemes, chartThemeKey, chartThemeSpec, resolvedChartTheme, savedThemeFromResult, setSavedThemes, upsertSavedTheme, savedThemes } from '../../../../src/app/savedThemes';
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
});
