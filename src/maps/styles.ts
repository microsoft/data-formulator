// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * How a map looks: a basemap style (water, land, borders, place labels, panels) and a Flint chart
 * theme (text ink, single and categorical colours, sequential and diverging ramps), the same
 * themes charts use. A map follows the app's default chart theme unless its spec names one.
 */

import * as d3 from 'd3';
import { THEME_PRESETS } from 'flint-chart';

import type { Palette } from './scales';
import type { MapStyleName } from './spec';

export interface MapStyle {
    id: MapStyleName;
    /** Behind the map (outside the sphere): the water itself on styles where it fills the frame. */
    background: string;
    /** Behind a globe, which floats on the page with its own sea even when water fills a flat map's frame. */
    page: string;
    /** The sphere; 'none' leaves the background. */
    ocean: string;
    land: string;
    /** Interior borders between regions. */
    border: string;
    /** The outline of the land and the sphere. */
    coast: string;
    graticule: string;
    noData: string;
    /** Basemap place names, and the halo that keeps them readable. */
    placeLabel: string;
    halo: string;
    /** Text and halo for data labels. */
    text: string;
    selection: string;
    /** Panels (controls, legends) are drawn light or dark. */
    mode: 'light' | 'dark';
    /** The street tiles that match, when tiles are on. */
    tiles: 'light' | 'dark';
    /**
     * Draw the ocean as a shape on flat world maps (the globe always has its sphere). Styles that want
     * water paint the whole frame instead (background = ocean): an oval of sea in a rectangle looks boxed.
     */
    sphere: boolean;
}

export const MAP_STYLE_PRESETS: Record<MapStyleName, MapStyle> = {
    // Datawrapper's look: light grey land with white borders on the page, no painted ocean, so a world
    // map sits on the page like a chart rather than an oval in a box. The globe gets a pale sea.
    light: {
        id: 'light', page: '#ffffff', background: '#ffffff', ocean: '#eef3f6', land: '#e6e6e4', border: '#ffffff', coast: '#d4d4d1',
        graticule: '#e8ecef', noData: '#dededb', placeLabel: '#888c8f', halo: 'rgba(255,255,255,0.85)', text: '#2b2b2b',
        selection: '#1f1f1f', mode: 'light', tiles: 'light', sphere: false,
    },
    // Outlines first: near-white land drawn by grey borders, for dense or colourful data.
    muted: {
        id: 'muted', page: '#ffffff', background: '#ffffff', ocean: '#f4f6f7', land: '#f6f6f4', border: '#d6d6d3', coast: '#bdbdba',
        graticule: '#efefef', noData: '#ebebe8', placeLabel: '#9a9a9a', halo: 'rgba(255,255,255,0.85)', text: '#2b2b2b',
        selection: '#111111', mode: 'light', tiles: 'light', sphere: false,
    },
    // A printed atlas: water fills the whole frame (like Tableau's map tiles), warm land on it.
    atlas: {
        id: 'atlas', page: '#ffffff', background: '#dbe9f2', ocean: '#dbe9f2', land: '#f6f3eb', border: '#dad2c4', coast: '#b8cbd8',
        graticule: '#c2d8e6', noData: '#ebe6db', placeLabel: '#958e82', halo: 'rgba(245,241,232,0.9)', text: '#2b2b2b',
        selection: '#1f1f1f', mode: 'light', tiles: 'light', sphere: false,
    },
    // Dark water fills the frame; dark land; bright marks read as light.
    dark: {
        id: 'dark', page: '#15181b', background: '#1d2227', ocean: '#1d2227', land: '#2e343a', border: '#424a52', coast: '#4b545d',
        graticule: '#262c32', noData: '#383f46', placeLabel: '#78818a', halo: 'rgba(29,34,39,0.85)', text: '#e8eaec',
        selection: '#ffffff', mode: 'dark', tiles: 'dark', sphere: false,
    },
    // Outlines only, for print and reports.
    minimal: {
        id: 'minimal', page: '#ffffff', background: '#ffffff', ocean: 'none', land: '#ffffff', border: '#c9c9c9', coast: '#9a9a9a',
        graticule: '#eeeeee', noData: '#f0f0f0', placeLabel: '#a6a6a6', halo: 'rgba(255,255,255,0.9)', text: '#2b2b2b',
        selection: '#111111', mode: 'light', tiles: 'light', sphere: false,
    },
};

/** What fills the frame: water on full-bleed styles, but the page around a globe. */
export const frameBackground = (style: MapStyle, projection: string) => projection === 'orthographic' ? style.page : style.background;

export const mapStyle = (name: MapStyleName | undefined): MapStyle => MAP_STYLE_PRESETS[name ?? 'light'] ?? MAP_STYLE_PRESETS.light;

export interface ThemeInk {
    /** Title and legend text. */
    primary?: string;
    secondary?: string;
    font?: string;
    palette: Palette;
}

interface Ramp { stops: string[]; space?: string; consumption?: string; quantizeCount?: number }

const rampInterpolator = (ramp: Ramp | undefined) => {
    if (!ramp?.stops?.length) return undefined;
    const interpolate = ramp.space === 'hcl' ? d3.interpolateHcl : ramp.space === 'rgb' ? d3.interpolateRgb : d3.interpolateLab;
    return d3.piecewise(interpolate, ramp.stops);
};

/** A Flint theme's ink for maps; undefined for Flint's own defaults ("none" or unknown ids). */
export function themeInk(themeId: string | undefined): ThemeInk | undefined {
    if (!themeId || themeId === 'none') return undefined;
    const preset = (THEME_PRESETS as Record<string, { spec?: { ink?: Record<string, any>; type?: Record<string, any> } }>)[themeId];
    const ink = preset?.spec?.ink;
    if (!ink) return undefined;
    const series = ink.series ?? {};
    const sequential = series.sequential as Ramp | undefined;
    const family = preset.spec?.type?.headline?.family as string | undefined;
    return {
        primary: ink.text?.primary,
        secondary: ink.text?.secondary,
        font: family,
        palette: {
            single: series.single,
            categorical: series.categoricalExtended ?? series.categorical,
            sequential: rampInterpolator(sequential),
            diverging: rampInterpolator(series.diverging),
            designed: true,
            classes: sequential?.consumption === 'quantize' ? sequential.quantizeCount : undefined,
        },
    };
}
