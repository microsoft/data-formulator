// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The user's saved chart themes (Flint ThemeSpecs from their theme library, `/api/themes`), used by id
 * wherever a Flint preset id is: canvas charts, maps, and apps. The agent saves them (`save_theme`).
 */

import { useSyncExternalStore } from 'react';
import { THEME_PRESETS, resolveThemeSpec } from 'flint-chart';

export interface SavedTheme {
    id: string;
    label: string;
    description?: string;
    extends?: string;
    [part: string]: unknown;
}

let themes: SavedTheme[] = [];
// The space's own theme (a space's `chart_theme`), listed with the user's and used by id the same way.
let spaceThemes: SavedTheme[] = [];
let listed: SavedTheme[] = [];
const listeners = new Set<() => void>();
const emit = () => {
    listed = [...spaceThemes, ...themes.filter(theme => !spaceThemes.some(space => space.id === theme.id))];
    listeners.forEach(listener => listener());
};

// The look's inks for charts drawn with Flint's defaults (look/looks.ts `chartInk`), or null.
let chartInk: Record<string, unknown> | null = null;

/** Sets the look's chart inks; default-theme charts (and their caches, keyed by `chartThemeKey`) redraw. */
export function setChartInk(next: Record<string, unknown> | null) {
    if (JSON.stringify(next) === JSON.stringify(chartInk)) return;
    chartInk = next;
    emit();
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** The saved themes (the space's first), re-rendering when they change. */
export const useSavedThemes = () => useSyncExternalStore(subscribe, () => listed, () => listed);

export const savedThemes = () => listed;

export function setSavedThemes(next: SavedTheme[]) {
    themes = next.filter(theme => theme && typeof theme.id === 'string' && !(theme.id in THEME_PRESETS));
    emit();
}

/** The theme the space brings, if any; it is not part of the user's library. */
export function setSpaceTheme(theme: SavedTheme | undefined) {
    const next = theme && typeof theme.id === 'string' && !(theme.id in THEME_PRESETS) ? [theme] : [];
    if (JSON.stringify(next) === JSON.stringify(spaceThemes)) return;
    spaceThemes = next;
    emit();
}

export const isSpaceTheme = (themeId: string | undefined) => !!themeId && spaceThemes.some(theme => theme.id === themeId);

/** Add or replace one theme (e.g. the one a `save_theme` result carries). */
export function upsertSavedTheme(theme: SavedTheme) {
    setSavedThemes([...themes.filter(item => item.id !== theme.id), theme].sort((a, b) => a.id.localeCompare(b.id)));
}

/** The theme a `save_theme` tool result saved, if it saved one. */
export function savedThemeFromResult(stdout: string | undefined): SavedTheme | undefined {
    try {
        const result = JSON.parse(stdout || '{}');
        const theme = result?.theme;
        return result?.saved && theme && typeof theme.id === 'string' ? theme as SavedTheme : undefined;
    } catch {
        return undefined;
    }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
// Loaded when used: the API client imports utils, which draws charts with these themes.
const api = () => import('./apiClient').then(module => module.apiRequest);

export async function refreshSavedThemes() {
    try {
        const apiRequest = await api();
        const { data } = await apiRequest<{ themes?: SavedTheme[] }>('/api/themes/list', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
        setSavedThemes(data.themes ?? []);
    } catch {
        // Without a library (or offline), charts keep the presets.
    }
}

export async function deleteSavedTheme(id: string) {
    const apiRequest = await api();
    await apiRequest('/api/themes/delete', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id }) });
    setSavedThemes(themes.filter(theme => theme.id !== id));
}

/** A saved theme as Flint takes it: the spec without the library's own `description`. */
const flintSpec = ({ description: _description, ...spec }: SavedTheme) => spec;

/**
 * What to give Flint for a chart's theme id: a preset id as is, a saved theme's spec, or undefined
 * (Flint's defaults) for an id this user does not have, so a shared chart still draws.
 */
export function chartThemeSpec(themeId: string | undefined): string | Record<string, unknown> | undefined {
    if (!themeId || themeId === 'none') return undefined;
    if (themeId in THEME_PRESETS) return themeId;
    const saved = listed.find(theme => theme.id === themeId);
    return saved ? flintSpec(saved) : undefined;
}

/** A key that changes when the theme an id names changes, for caches of drawn charts. */
export function chartThemeKey(themeId: string | undefined): string {
    const spec = chartThemeSpec(themeId);
    const key = typeof spec === 'object' ? JSON.stringify(spec) : spec ?? '';
    return spec === undefined && chartInk ? `look:${JSON.stringify(chartInk)}` : key;
}

type InkSpec = { ink?: { surface?: { canvas?: string }; text?: { primary?: string; secondary?: string };
    structure?: { grid?: string; axis?: string } } };

/**
 * For a chart drawn with Flint's defaults (no theme) on a dark look: the look's paper and inks as a Vega-Lite `config`
 * to merge over the chart's, recolouring only text, grid and background (Flint's defaults leave those to Vega), never
 * its colour scales. A chart with a theme keeps it as authored. Interim: Flint's defaults ignore the host background
 * (`options.background`), and its host-surface presets keep their light-page text on a dark host; once Flint derives
 * inks from the host, DF passes `options.background` instead. Undefined otherwise.
 */
export function chartLookConfig(themeId: string | undefined): Record<string, any> | undefined {
    if (!chartInk || chartThemeSpec(themeId) !== undefined) return undefined;
    const { surface, text, structure } = (chartInk as InkSpec).ink ?? {};
    const label = text?.secondary, axis = { labelColor: label, titleColor: label, gridColor: structure?.grid,
        domainColor: structure?.axis, tickColor: structure?.axis };
    return {
        background: surface?.canvas,
        title: { color: text?.primary, subtitleColor: label },
        axis, axisX: axis, axisY: axis,
        legend: { labelColor: label, titleColor: label },
        header: { labelColor: label, titleColor: label },
        text: { color: text?.primary },
    };
}

/** The theme fully resolved (a preset or a saved theme merged over its preset), or undefined. */
export function resolvedChartTheme(themeId: string | undefined): Record<string, any> | undefined {
    const spec = chartThemeSpec(themeId);
    if (!spec) return undefined;
    try {
        return resolveThemeSpec(spec as Parameters<typeof resolveThemeSpec>[0]) as Record<string, any> | undefined;
    } catch {
        return undefined;
    }
}

/** The saved themes for an app, by id, as Flint takes them. */
export const appThemes = (list: SavedTheme[]) => Object.fromEntries(list.map(theme => [theme.id, flintSpec(theme)]));
