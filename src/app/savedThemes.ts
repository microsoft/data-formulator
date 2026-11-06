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
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** The saved themes, re-rendering when they change. */
export const useSavedThemes = () => useSyncExternalStore(subscribe, () => themes, () => themes);

export const savedThemes = () => themes;

export function setSavedThemes(next: SavedTheme[]) {
    themes = next.filter(theme => theme && typeof theme.id === 'string' && !(theme.id in THEME_PRESETS));
    emit();
}

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
    const saved = themes.find(theme => theme.id === themeId);
    return saved ? flintSpec(saved) : undefined;
}

/** A key that changes when the theme an id names changes, for caches of drawn charts. */
export function chartThemeKey(themeId: string | undefined): string {
    const spec = chartThemeSpec(themeId);
    return typeof spec === 'object' ? JSON.stringify(spec) : spec ?? '';
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
