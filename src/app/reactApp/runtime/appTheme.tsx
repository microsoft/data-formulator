// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * An app's look, from one Flint theme: `<AppTheme theme="nyt">` gives every chart in it the theme, and
 * MUI and the page the theme's text inks, accent, fonts and (for a theme with its own paper, as Power
 * BI's) page and surface colors.
 */

import React, { createContext, useContext, useMemo } from 'react';
import GlobalStyles from '@mui/material/GlobalStyles';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { THEME_PRESETS, resolveThemeSpec } from 'flint-chart';

import { appConfig, reportError } from './bridge';
import { densityTheme, type Density } from './density';

/** A Flint theme preset id ("nyt", "economist", "powerbi", …) or a Flint theme object (`{ extends: 'nyt', … }`). */
export type AppTheme = string | Record<string, unknown>;

const ChartThemeContext = createContext<AppTheme | undefined>(undefined);

const unknownReported = new Set<string>();

/**
 * The theme Flint takes for an app's theme: a preset id as is, a saved theme's spec for its id, a theme
 * object as is. An id that is neither draws with Flint's defaults, and the app reports it once.
 */
export function resolveAppTheme(theme: AppTheme | undefined, saved = appConfig().themes): AppTheme | undefined {
    if (typeof theme !== 'string') return theme;
    if (theme in THEME_PRESETS) return theme;
    if (saved?.[theme]) return saved[theme];
    if (!unknownReported.has(theme)) {
        unknownReported.add(theme);
        const ids = [...Object.keys(THEME_PRESETS), ...Object.keys(saved ?? {})];
        reportError(`Theme "${theme}" is not a Flint preset or one of the user's saved themes; themes: ${ids.join(', ')}.`);
    }
    return undefined;
}

/** The theme the surrounding AppTheme gives its charts. */
export const usePageChartTheme = () => useContext(ChartThemeContext);

interface ResolvedInk {
    surface?: { source?: string; canvas?: string; plot?: string; panel?: string };
    text?: { primary?: string; secondary?: string; muted?: string };
    structure?: { grid?: string };
    series?: { single?: string; categorical?: string[]; accent?: string };
    accent?: string;
}

/** What a page takes from a theme: CSS variables for `tokens`, and MUI palette and type. */
export interface PageLook {
    vars: Record<string, string>;
    dark: boolean;
    text?: string;
    muted?: string;
    /** The page behind the tiles, and the tiles (the paper the charts draw on), when the theme has its own. */
    page?: string;
    tile?: string;
    font?: string;
    /** The headings' font. */
    display?: string;
    /** The theme's accent, which the page's controls and highlights take. */
    accent?: string;
}

const luminance = (color: string) => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
    if (!hex) return 1;
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Resolve a theme into the page look it implies; throws for a theme Flint does not know. */
export function pageLook(theme: AppTheme): PageLook {
    const spec = resolveThemeSpec(resolveAppTheme(theme) as Parameters<typeof resolveThemeSpec>[0]) as
        { ink?: ResolvedInk; type?: { headline?: { family?: string }; axisLabel?: { family?: string }; deck?: { family?: string } } } | undefined;
    const ink = spec?.ink ?? {};
    const house = ink.surface?.source === 'house' ? ink.surface : undefined;
    const tile = house ? house.plot ?? house.canvas : undefined;
    const page = house ? house.panel ?? house.canvas : undefined;
    const accent = ink.series?.accent ?? ink.accent ?? ink.series?.single;
    const font = spec?.type?.axisLabel?.family;
    const display = spec?.type?.headline?.family;
    const dark = !!page && luminance(page) < 0.35;
    const vars: Record<string, string | undefined> = {
        '--df-text': ink.text?.primary,
        '--df-muted': ink.text?.secondary,
        '--df-primary': accent,
        '--df-font': font,
        '--df-font-display': display,
        '--df-canvas': page,
        '--df-surface': tile,
        '--df-primary-soft': accent ? `color-mix(in srgb, ${accent} 12%, transparent)` : undefined,
        '--df-rule': dark ? 'rgba(255, 255, 255, 0.14)' : undefined,
        '--df-faint': dark ? 'rgba(255, 255, 255, 0.45)' : undefined,
        '--df-scrollbar': dark ? 'rgba(255, 255, 255, 0.16)' : undefined,
        '--df-scrollbar-hover': dark ? 'rgba(255, 255, 255, 0.3)' : undefined,
        ...Object.fromEntries((ink.series?.categorical ?? []).slice(0, 10).map((color, index) => [`--df-palette-${index + 1}`, color])),
    };
    return {
        vars: Object.fromEntries(Object.entries(vars).filter((entry): entry is [string, string] => !!entry[1])),
        dark, text: ink.text?.primary, muted: ink.text?.secondary, page, tile, font, display,
        accent: accent && /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : undefined,
    };
}

/** The MUI theme inside a themed page, so controls and MUI text follow the page's inks and type. */
const pageMuiTheme = (look: PageLook) => (outer: Theme): Theme => ({
    ...outer,
    palette: {
        ...outer.palette,
        ...(look.dark ? { mode: 'dark' as const, divider: 'rgba(255, 255, 255, 0.14)',
            action: { ...outer.palette.action, active: 'rgba(255, 255, 255, 0.7)', hover: 'rgba(255, 255, 255, 0.06)',
                selected: 'rgba(255, 255, 255, 0.12)', disabled: 'rgba(255, 255, 255, 0.3)', disabledBackground: 'rgba(255, 255, 255, 0.12)' } } : {}),
        text: { ...outer.palette.text, ...(look.text ? { primary: look.text } : {}), ...(look.muted ? { secondary: look.muted } : {}) },
        ...(look.accent ? { primary: { ...outer.palette.augmentColor({ color: { main: look.accent } }), textColor: look.accent } } : {}),
        background: { ...outer.palette.background, ...(look.tile ? { paper: look.tile } : {}), default: look.page ?? '#ffffff' },
    },
    typography: {
        ...outer.typography,
        ...(look.font ? { fontFamily: look.font } : {}),
        ...(look.display ? Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(variant =>
            [variant, { ...(outer.typography as unknown as Record<string, object>)[variant], fontFamily: look.display }])) : {}),
    } as Theme['typography'],
});

export interface AppThemeProps {
    /**
     * A Flint theme preset id ("nyt", "economist", "powerbi", "powerbi-light", "datawrapper", "swiss", …), one
     * of the user's saved themes by id, or a Flint theme object (`{ extends: 'economist', … }`).
     */
    theme?: AppTheme;
    /**
     * How dense the app is: 'compact' (the default: a 6 px spacing unit, a smaller type scale, 30 px
     * controls) or 'normal' (MUI's 8 px unit and type, 36 px controls), e.g. for a presentation.
     */
    density?: Density;
    children?: React.ReactNode;
}

/**
 * The app's look, from one Flint theme. Every FlintChart inside takes it (unless it sets its own `theme`);
 * MUI takes its text colors, accent (the primary color), fonts and, for a theme with its own paper, its
 * page and surface (Paper) colors; the page background follows. Wrap the whole app in it, once.
 */
export function AppThemeProvider({ theme, density, children }: AppThemeProps) {
    const themeKey = JSON.stringify(theme ?? null);
    const look = useMemo(() => {
        // `<AppTheme density="normal">` alone keeps the page's look and changes only the density.
        if (theme === undefined) return null;
        try {
            return pageLook(theme);
        } catch (failure) {
            reportError(`AppTheme: ${failure instanceof Error ? failure.message : String(failure)}`);
            return null;
        }
    }, [themeKey]);
    const muiTheme = useMemo(() => (outer: Theme) => {
        const looked = look ? pageMuiTheme(look)(outer) : outer;
        return density ? densityTheme(looked, density) : looked;
    }, [look, density]);
    const page = (
        <ThemeProvider theme={muiTheme}>
            {look && <GlobalStyles styles={{
                // A dark page draws the browser's own parts (scrollbars, inputs) dark too, over the host's light default.
                ':root': look.dark ? { ...look.vars, colorScheme: 'dark' } : look.vars,
                'html, body': {
                    // A theme with its own paper sets the page; one that draws on its host's reads on white.
                    background: look.page ?? '#ffffff',
                    ...(look.text ? { color: look.text } : {}),
                    ...(look.font ? { fontFamily: look.font } : {}),
                },
            }} />}
            {children}
        </ThemeProvider>
    );
    // Without a theme it changes only the density, and the charts keep the theme around it.
    return theme === undefined ? page : <ChartThemeContext.Provider value={look ? theme : undefined}>{page}</ChartThemeContext.Provider>;
}
