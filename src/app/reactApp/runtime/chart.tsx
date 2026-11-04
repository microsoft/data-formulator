// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** `@df/chart`: Flint charts (as on the DF canvas, interactive, with a focus the app sets), raw Vega-Lite, and sparklines. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import {
    FlintChart as FlintChartView,
    type ChartChange, type ChartUpdate, type FlintChartFit, type FlintChartHandle,
} from 'flint-chart/react';
import type { ChartAssemblyInput } from 'flint-chart';
import { resolveColumnSorts } from '../../chartSort';
import { choroplethRegion, keepUnmatchedRegions } from '../../chartMaps';

import { appConfig, bridge, errorMessage, reportError, type Row } from './bridge';
import { optionalModule } from './optional/register';
import { useQuery, type QueryResult } from './data';
import { resolveAppTheme, usePageChartTheme, type AppTheme } from './appTheme';
import { ErrorState, FILL_SX, QueryView, useStable } from './states';

type Encoding = string | { field: string; type?: string; aggregate?: string; sortOrder?: string; sortBy?: string; scheme?: string };

/**
 * A chart takes the width its column gives it and never asks for more: its content does not count toward
 * the layout's sizing (so a wide drawing cannot widen a grid `fr` column or a flex item and squeeze its
 * neighbours), and whatever is wider still is clipped rather than pushing the page sideways.
 */
export const FIT_WIDTH_SX = { width: '100%', minWidth: 0, maxWidth: '100%', contain: 'inline-size', overflowX: 'clip' } as const;

/** The default chart height, and the least a `height="fill"` chart takes when its container gives it less. */
const DEFAULT_HEIGHT = 260;
const FILL_MIN_HEIGHT = 160;
const fixedHeight = (height: ChartHeight | undefined) => (typeof height === 'number' ? height : DEFAULT_HEIGHT);

/** A chart's height: pixels, or 'fill' to take the height its container gives it. */
export type ChartHeight = number | 'fill';

/** Size of an element, tracked across resizes. */
function useSize(ref: React.RefObject<HTMLElement | null>) {
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const update = () => {
            const box = element.getBoundingClientRect();
            setSize(previous => (previous.width === Math.floor(box.width) && previous.height === Math.floor(box.height)
                ? previous : { width: Math.floor(box.width), height: Math.floor(box.height) }));
        };
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return size;
}

const useWidth = (ref: React.RefObject<HTMLElement | null>) => useSize(ref).width;

const CSS_RGB = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/;
const CSS_SRGB = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/;

/** A computed CSS background as [r, g, b, alpha] (0–255, 0–1), or null when it is not a plain color. */
function cssColor(value: string): [number, number, number, number] | null {
    const rgb = CSS_RGB.exec(value.trim());
    const srgb = rgb ? null : CSS_SRGB.exec(value.trim());
    const match = rgb ?? srgb;
    if (!match) return null;
    const scale = srgb ? 255 : 1;
    const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
    return [Number(match[1]) * scale, Number(match[2]) * scale, Number(match[3]) * scale, alpha];
}

/**
 * The color a chart sits on: its ancestors' backgrounds, translucent ones (a tinted card) blended over
 * what is behind them, as hex. Flint draws a theme that defers to its host on this surface.
 */
export function surfaceBehind(element: Element | null): string {
    const layers: [number, number, number, number][] = [];
    for (let node = element; node; node = node.parentElement) {
        const color = cssColor(getComputedStyle(node).backgroundColor);
        if (!color || color[3] <= 0) continue;
        layers.push(color);
        if (color[3] >= 1) break;
    }
    let [r, g, b] = [255, 255, 255];
    for (const [lr, lg, lb, alpha] of layers.reverse()) {
        [r, g, b] = [lr * alpha + r * (1 - alpha), lg * alpha + g * (1 - alpha), lb * alpha + b * (1 - alpha)];
    }
    return '#' + [r, g, b].map(channel => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('');
}

/** The surface behind an element, read once it is laid out. */
function useSurface(ref: React.RefObject<HTMLElement | null>, ready: boolean) {
    const [surface, setSurface] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (ready && ref.current) setSurface(surfaceBehind(ref.current));
    }, [ref, ready]);
    return surface;
}

/** Flint's map basemaps load from the web (vega.github.io, jsDelivr), which the sandbox blocks; `@df/geo` vendors the same boundaries. */
const BASEMAP_URL = /\/(world-110m|us-10m|counties-albers-10m)\.json$/;
const BASEMAPS = { 'world-110m': 'world', 'us-10m': 'us', 'counties-albers-10m': 'usAlbers' } as const;

const basemapOf = (url: string): unknown => {
    const match = BASEMAP_URL.exec(url);
    if (!match) return undefined;
    const geo = optionalModule('@df/geo') as Record<string, unknown> | undefined;
    if (!geo) throw new Error('Map boundaries did not load in this app. Reload the app to try again.');
    return geo[BASEMAPS[match[1] as keyof typeof BASEMAPS]];
};

/**
 * Charts Flint mounts load their basemap through Vega's loader, which calls `fetch`: answer those
 * requests from `@df/geo`, so maps draw offline like the static ones (`resolveBasemaps`).
 */
function serveBasemapsOffline() {
    const host = globalThis as typeof globalThis & { __dfBasemapFetch?: boolean };
    if (typeof host.fetch !== 'function' || host.__dfBasemapFetch || typeof Response === 'undefined') return;
    const network = host.fetch.bind(host);
    host.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!BASEMAP_URL.test(url)) return network(input, init);
        try {
            return Promise.resolve(new Response(JSON.stringify(basemapOf(url)), { headers: { 'Content-Type': 'application/json' } }));
        } catch (failure) {
            return Promise.reject(failure);
        }
    };
    host.__dfBasemapFetch = true;
}
serveBasemapsOffline();

/** Replace basemap URLs in a spec with the vendored topologies (Flint joins on the same ids). */
export function resolveBasemaps(spec: unknown): unknown {
    if (Array.isArray(spec)) return spec.map(resolveBasemaps);
    if (!spec || typeof spec !== 'object') return spec;
    const node = spec as Record<string, unknown>;
    const data = node.data as { url?: unknown; format?: unknown } | undefined;
    const resolved = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === 'data' ? value : resolveBasemaps(value)]));
    if (typeof data?.url !== 'string' || !BASEMAP_URL.test(data.url)) return resolved;
    const { url, ...rest } = data;
    return { ...resolved, data: { ...rest, values: basemapOf(url as string) } };
}

/** Render a Vega/Vega-Lite spec into a div; finalize the view on change and unmount. */
function useVegaView(ref: React.RefObject<HTMLDivElement | null>, spec: Record<string, unknown> | null) {
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element || !spec) return;
        let disposed = false;
        let view: { finalize(): void } | undefined;
        setError(null);
        let resolved: Record<string, unknown>;
        try {
            resolved = resolveBasemaps(spec) as Record<string, unknown>;
        } catch (failure) {
            setError(errorMessage(failure));
            reportError(`Chart: ${errorMessage(failure)}`);
            return;
        }
        bridge().chart(element, resolved).then(
            result => { view = result; if (disposed) result.finalize(); },
            failure => {
                if (disposed) return;
                setError(errorMessage(failure));
                reportError(`Chart: ${errorMessage(failure)}`);
            },
        );
        return () => { disposed = true; view?.finalize(); };
    }, [ref, spec]);
    return error;
}

function ChartError({ message, height }: { message: string; height?: number }) {
    return <ErrorState error={message} height={height} label="Chart unavailable" />;
}

export interface VegaChartProps {
    /** A Vega-Lite spec without data, or with `data.values`. */
    spec: Record<string, any>;
    /** Rows to bind as `data.values` (or pass `query`). */
    data?: Row[];
    query?: QueryResult;
    /** The whole drawing's height, axes and legend included: pixels (default 260), or 'fill' as for FlintChart. */
    height?: ChartHeight;
}

/** A raw Vega-Lite chart, themed like DF and sized to its container's width. */
export function VegaChart({ spec, data, query, height = 260 }: VegaChartProps) {
    if (query) return <QueryView query={query} height={fixedHeight(height)} fill={height === 'fill'}>{rows => <VegaChart spec={spec} data={rows} height={height} />}</QueryView>;
    return <VegaChartBody spec={spec} data={data} height={height} />;
}

function VegaChartBody({ spec: specProp, data: dataProp, height }: { spec: Record<string, any>; data?: Row[]; height: ChartHeight }) {
    const box = useRef<HTMLDivElement>(null);
    const ref = useRef<HTMLDivElement>(null);
    const spec = useStable(specProp);
    const data = useStable(dataProp);
    const fill = height === 'fill';
    const size = useSize(box);
    const width = Math.floor(size.width / WIDTH_STEP) * WIDTH_STEP;
    const room = fill ? Math.max(FILL_MIN_HEIGHT, Math.floor(size.height / HEIGHT_STEP) * HEIGHT_STEP) : fixedHeight(height);
    const [fullSpec, setFullSpec] = useState<Record<string, unknown> | null>(null);
    useEffect(() => {
        if (!size.width) return;
        // A single view is fitted whole (axes, labels and legend included) into the box: Vega-Lite's own
        // width and height are the plot's, so the drawing would otherwise run past the box by its labels.
        const composed = ['facet', 'repeat', 'concat', 'hconcat', 'vconcat'].some(key => key in spec);
        setFullSpec({
            ...spec,
            ...(data ? { data: { values: data } } : {}),
            ...(composed ? {} : {
                width: typeof spec.width === 'number' ? Math.min(spec.width, size.width) : spec.width ?? size.width,
                height: typeof spec.height === 'number' ? Math.min(spec.height, room) : spec.height ?? room,
                autosize: spec.autosize ?? { type: 'fit', contains: 'padding' },
            }),
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spec, data, width, room]);
    const error = useVegaView(ref, fullSpec);
    return (
        <Box ref={box} data-vega-chart sx={{
            ...FIT_WIDTH_SX,
            ...(fill ? { ...FILL_SX, display: 'block', contain: 'size', minHeight: FILL_MIN_HEIGHT } : { minHeight: room }),
            // Whatever still does not fit is cut at the box, never drawn over what follows it.
            overflow: 'clip',
        }}>
            {error ? <ChartError message={error} height={room} /> : <Box ref={ref} />}
        </Box>
    );
}

/** The narrowest band per category a discrete x axis is squeezed to before it scrolls instead. */
const MIN_CATEGORY_WIDTH = 14;

/**
 * Fit a compiled chart, legend included, to its card's width. Flint gives a discrete x axis a
 * step per category; fitting it shrinks the steps, unless that would make them too narrow to
 * read (a long axis), which keeps its step and scrolls inside the card. Composite charts keep
 * their own layout.
 */
export function fitChartToWidth(spec: Record<string, any>, width: number, rows: Row[], xField?: string): Record<string, any> {
    if (['facet', 'repeat', 'concat', 'hconcat', 'vconcat'].some(key => key in spec)) return spec;
    const current = spec.width;
    if (current !== undefined && typeof current !== 'number') {
        const stepped = typeof current === 'object' && current !== null && 'step' in current;
        const categories = stepped && xField ? new Set(rows.map(row => row[xField])).size : 0;
        if (!categories || categories * MIN_CATEGORY_WIDTH > width) return spec;
    }
    return { ...spec, width, autosize: { type: 'fit-x', contains: 'padding' } };
}

/** One Flint interaction preset: `{ type: 'click-highlight' }`, with its options, or just the preset name. */
export type ChartInteraction = string | { type: string; id?: string; options?: Record<string, unknown> };

/**
 * A chart in the shape of the session's chart files (`session/charts/<id>.json`): copy one and change
 * what the app needs, or write one. `config` is Flint's chartProperties.
 */
export interface ChartSpec {
    chart_type: string;
    table?: string;
    title?: string;
    subtitle?: string;
    encodings: Record<string, Encoding>;
    config?: Record<string, unknown>;
    theme?: AppTheme;
}

/**
 * Something the app draws on a chart: a note on one mark (`at` the fields that pick it out, e.g.
 * `{ year: 2020, region: 'West' }`), a line at a value of an axis (`y: 2`, `x: '2020-03'`), or a band
 * between two values (`x: [2008, 2009]`); each with an optional `text`.
 */
export interface ChartAnnotation {
    at?: Record<string, unknown>;
    x?: unknown;
    y?: unknown;
    text?: string;
    /** The line's, band's and text's color (default a quiet gray). */
    color?: string;
    /** Draw a line dashed. */
    dashed?: boolean;
}

export interface FlintChartProps {
    /**
     * A chart on the user's canvas, by id (`session/charts/<id>.json`): drawn as there (type, fields,
     * title, settings, theme) from its table. Other props change it: `focus`, `select`, `height`, `title`,
     * `encodings` (by channel; `null` drops one), `data`/`query` (other rows, e.g. filtered).
     */
    chart?: string;
    /** A chart written in the chart-file shape ({ chart_type, table, encodings, config, title, theme }); other props change it as for `chart`. */
    spec?: ChartSpec;
    /** A Flint chart type, e.g. "Line Chart", "Bar Chart", "Scatter Plot" (not needed with `chart` or `spec`). */
    chartType?: string;
    /** Channel → field name, or a Flint encoding object ({field, type, aggregate, sortBy, ...}). */
    encodings?: Record<string, Encoding | null>;
    /** The rows to draw; without `data` or `query`, a chart with a `table` reads the table's rows. */
    data?: Row[];
    query?: QueryResult;
    /** Declared table the rows come from; its semantic annotations and display names are used. */
    table?: string;
    /** Extra or overriding semantic types, by field. */
    semanticTypes?: Record<string, string | Record<string, unknown>>;
    /** Axis and legend titles by field, e.g. { metric_value: 'Indexed close' }; '' hides a title. */
    labels?: Record<string, string>;
    /**
     * The chart's own headline, drawn by Flint in the theme's type (the finding, e.g. "Revenue grew 27%"),
     * with `subtitle` (the deck: measure, unit, period), `kicker` (a short line above it), and `source` (the
     * line under it). Use these, or a heading of the app's own above the chart, not both.
     */
    title?: string;
    subtitle?: string;
    kicker?: string;
    source?: string;
    /**
     * Pixels (default 260), or 'fill' to take the height the container gives it (a tile with a set height,
     * a stretched flex item, a sticky graphic box), never less than 160. A fill chart never makes its
     * container taller, so give the container a height.
     */
    height?: ChartHeight;
    chartProperties?: Record<string, unknown>;
    /**
     * A Flint theme preset id (e.g. "economist"), the same themes as the DF canvas, or a Flint theme object
     * (`{ extends: 'economist', … }`). Defaults to the AppTheme's `theme`, then the chart's own.
     */
    theme?: AppTheme;
    /**
     * Let the reader put the focus on part of the chart: `true` to click a mark (a bar, a slice, a line's
     * series, a point; shift-click adds), `'range'` to drag over a period or a range. What they pick goes
     * to `onFocus` (as a focus another chart can take) and `onSelect` (as rows).
     */
    select?: boolean | 'range';
    /** Marks to keep in focus, the rest muted: { region: 'West' }, { model: ['A', 'B'] }, { year: { range: [2010, 2020] } }. */
    focus?: FocusWhere;
    /** A short note on the one mark (or the end of the one line) the focus picks out, in place of its value. */
    note?: string;
    /** Notes on marks, reference lines and bands: `[{ y: 2, text: 'Target' }, { x: [2008, 2009], text: 'Recession' }]`. */
    annotations?: ChartAnnotation[];
    /**
     * Marks to leave out of view, as a focus names them: `{ source: ['Nuclear', 'Solar'] }`. The chart keeps
     * its axes and colors, so a story can reveal series step by step and the chart moves rather than redraws.
     */
    hide?: FocusWhere;
    /**
     * The range the chart frames, by field on its x (or y) axis: `{ date: ['2008-01-01', '2012-12-31'] }`;
     * `null` (or an omitted field) shows everything. The chart moves its view in place, keeping its rows,
     * so a range control can steer it; the reader can also drag over a period on the chart to zoom in
     * (double-click goes back), which `onView` reports in the same shape.
     */
    view?: Record<string, [unknown, unknown] | { range: [unknown, unknown] } | null> | null;
    /** The range the reader zoomed the chart to, as `view` takes it: `{ date: [from, to] }`; null when they go back. */
    onView?: (view: Record<string, [unknown, unknown]> | null) => void;
    /**
     * Rows to keep, as controls hold them (the shapes `queryFilters` takes): `{ category: ['A', 'B'],
     * date: { range: [from, to] }, region: 'West' }`; empty values keep everything. The chart narrows its
     * own rows in place, without loading them again; scales and totals follow.
     */
    filter?: FocusWhere | null;
    /** Advanced: Flint interaction presets. Prefer `select`. */
    interactions?: ChartInteraction[];
    /** Layers the app shows on the chart (emphasis, notes, a viewport), as Flint ChartUpdates; replaced by id. */
    updates?: ChartUpdate[];
    /**
     * What the reader selected, as a focus for other charts: `{region: {in: ['West']}}` for a click,
     * `{year: {range: [2010, 2015]}}` for a drag over a period; null when they clear it. Pass it to other
     * charts' `focus` to link them, or filter rows by it.
     */
    onFocus?: (focus: FocusWhere | null) => void;
    /** The marks the reader selected, as their field values, after each committed change ([] when cleared). */
    onSelect?: (values: Record<string, unknown>[]) => void;
    /** Every change Flint reports: the gesture's phase, interaction, and the chart's state after it. */
    onChange?: (change: ChartChange) => void;
    /** How the chart meets its card: 'relayout' (default) lays it out for the card's width. */
    fit?: FlintChartFit;
}

/** The props of a chart drawn: a referenced or written chart, with the app's props over it. */
type ResolvedChartProps = Omit<FlintChartProps, 'encodings'> & { chartType: string; encodings: Record<string, Encoding> };

/**
 * Resolve `chart` (a session chart by id) or `spec` (a chart file) under the app's own props. The
 * theme is the chart's own prop, then the AppTheme's, then the referenced chart's. Returns an error message
 * when the chart cannot be drawn.
 */
export function resolveChartProps(given: FlintChartProps, pageTheme?: AppTheme,
    sessionCharts: Record<string, ChartSpec> | undefined = appConfig().charts): ResolvedChartProps | string {
    let base: ChartSpec | undefined = given.spec;
    if (given.chart !== undefined) {
        base = sessionCharts?.[given.chart];
        if (!base) {
            const ids = Object.keys(sessionCharts ?? {});
            return `No chart "${given.chart}" in this session${ids.length ? `; its charts are ${ids.slice(0, 12).map(id => `"${id}"`).join(', ')}` : ''}.`;
        }
    }
    const encodings = Object.fromEntries(Object.entries({ ...base?.encodings, ...given.encodings })
        .filter((entry): entry is [string, Encoding] => entry[1] !== null && entry[1] !== undefined));
    const chartType = given.chartType ?? base?.chart_type;
    if (!chartType) return 'FlintChart needs a chartType and encodings, a `spec`, or a session `chart` id.';
    if (!base) return { ...given, chartType, encodings, ...(given.theme === undefined && pageTheme ? { theme: pageTheme } : {}) };
    const chartProperties = base.config || given.chartProperties ? { ...base.config, ...given.chartProperties } : undefined;
    return {
        ...given,
        chartType,
        encodings,
        table: given.table ?? base.table,
        title: given.title !== undefined ? given.title : base.title,
        subtitle: given.subtitle !== undefined ? given.subtitle : base.subtitle,
        chartProperties,
        theme: given.theme ?? pageTheme ?? base.theme,
    };
}

/**
 * A chart's error, as the app's author needs it: which chart (its title or type and encodings), the message,
 * and, for a failure inside the chart engine, how to find what triggers it.
 */
export function chartErrorMessage(props: Pick<ResolvedChartProps, 'chartType' | 'encodings' | 'title'>, failure: string): string {
    const channels = Object.entries(props.encodings ?? {}).map(([channel, encoding]) => {
        if (typeof encoding === 'string') return `${channel}: ${encoding}`;
        const extra = [encoding?.aggregate && `${encoding.aggregate}`, encoding?.sortBy && `sortBy ${encoding.sortBy}`].filter(Boolean).join(', ');
        return `${channel}: ${encoding?.field}${extra ? ` (${extra})` : ''}`;
    }).join(', ');
    const name = props.title ? `"${props.title}" (${props.chartType}; ${channels})` : `${props.chartType} (${channels})`;
    const internal = /cannot (read|destructure)|undefined|is not a function|of null/i.test(failure);
    return `FlintChart ${name}: ${failure}`
        + (internal ? ' — this failed inside the chart engine: change this chart\'s props one at a time (sortBy, aggregate, select, chartProperties, a facet) to find the one that triggers it; keep FlintChart.' : '');
}

/** A chart compiled by Flint from semantic encodings, matching the DF canvas; interactive, with a focus the app sets. */
export function FlintChart(given: FlintChartProps) {
    const pageTheme = usePageChartTheme();
    const resolved = resolveChartProps(given, pageTheme, appConfig().charts);
    if (typeof resolved === 'string') return <ChartSpecError message={resolved} height={fixedHeight(given.height)} />;
    const props = resolved;
    const { query } = props;
    const Body = props.chartType === 'Choropleth' ? StaticChoropleth : FlintChartBody;
    if (query) return <QueryView query={query} height={fixedHeight(props.height)} fill={props.height === 'fill'}>{rows => <Body {...props} data={rows} />}</QueryView>;
    if (!props.data && props.table) return <TableChart {...props} body={Body} />;
    return <Body {...props} />;
}

function ChartSpecError({ message, height }: { message: string; height: number }) {
    useEffect(() => reportError(`FlintChart: ${message}`), [message]);
    return <ChartError message={message} height={height} />;
}

/** The columns a chart draws, so a chart that reads its own table asks for just those. */
const chartColumns = (encodings: Record<string, Encoding>) => [...new Set(Object.values(encodings)
    .map(fieldOfEncoding).filter((field): field is string => !!field))];

/** A chart that reads its table itself (a referenced canvas chart, or one with a `table` and no rows). */
function TableChart({ body: Body, ...props }: ResolvedChartProps & { body: React.ComponentType<ResolvedChartProps> }) {
    const columns = chartColumns(props.encodings);
    const query = useQuery(props.table, { ...(columns.length ? { columns } : {}), limit: 50000 });
    return <QueryView query={query} height={fixedHeight(props.height)} fill={props.height === 'fill'}>{rows => <Body {...props} data={rows} />}</QueryView>;
}

/** Field → a value, a list of values, or `{ range: [from, to] }`. */
export type FocusWhere = Record<string, unknown>;
type FocusPart = { in: unknown[] } | { range: [unknown, unknown] };


const focusPart = (value: unknown): FocusPart => Array.isArray(value) ? { in: value }
    : value && typeof value === 'object' && Array.isArray((value as { range?: unknown }).range)
        ? { range: (value as { range: [unknown, unknown] }).range }
        : value && typeof value === 'object' && Array.isArray((value as { in?: unknown }).in) ? { in: (value as { in: unknown[] }).in }
            : { in: [value] };

/** The interaction preset `select` stands for on each kind of chart. */
export function selectPreset(chartType: string, encodings: Record<string, Encoding>, select: boolean | 'range' | undefined): string | undefined {
    if (!select) return undefined;
    const type = chartType.toLowerCase();
    const series = !!(encodings.color || encodings.detail);
    const linear = /line|area|bump|slope|sparkline/.test(type);
    const scatter = /scatter|bubble/.test(type);
    if (select === 'range') return scatter ? 'select' : linear ? 'brush-x' : 'click-highlight';
    if (linear) return series ? 'click-group-focus' : 'click-highlight';
    return 'click-highlight';
}

const fieldOfEncoding = (encoding: Encoding | undefined) => typeof encoding === 'string' ? encoding : encoding?.field;
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const showNumber = (value: unknown) => isNumber(value)
    ? (value as number).toLocaleString(undefined, { maximumFractionDigits: Math.abs(value as number) >= 100 ? 0 : 1 }) : String(value);

/**
 * The layers that show a focus on a chart: the matching marks emphasized (on the fields the chart's rows
 * carry; the others are not about this chart), and, when the focus picks out one mark or one line, a
 * label with its value.
 */
export function focusLayers(where: FocusWhere | null | undefined, rows: Row[], chartType: string,
    encodings: Record<string, Encoding>, note?: string): ChartUpdate[] {
    const carried = Object.entries(where ?? {}).filter(([field]) => rows.some(row => row && field in row));
    if (!carried.length) return [];
    const parts = Object.fromEntries(carried.map(([field, value]) => [field, focusPart(value)]));
    const layers: ChartUpdate[] = [{
        id: 'df-focus',
        ops: [{ op: 'set-style', targets: [{ select: { where: parts } }], value: { state: 'emphasized' } }],
    } as unknown as ChartUpdate];
    const matching = rows.filter(row => Object.entries(parts).every(([field, part]) => meetsPart(row[field], part)));
    const x = fieldOfEncoding(encodings.x);
    const y = fieldOfEncoding(encodings.y);
    const color = fieldOfEncoding(encodings.color);
    const detail = fieldOfEncoding(encodings.detail);
    if (!x || !y || !matching.length) return layers;
    const numericX = rows.every(row => isNumber(row[x]));
    const numericY = rows.every(row => isNumber(row[y]));
    const linear = /line|area/i.test(chartType);
    let target: Row | undefined;
    let text: string | undefined;
    if (numericX && numericY && !linear) {
        // A point: name it.
        if (matching.length === 1) {
            target = matching[0];
            text = String(target[detail ?? ''] ?? target[color ?? ''] ?? `${showNumber(target[x])}, ${showNumber(target[y])}`);
        }
    } else if (linear && color) {
        // One line in focus: its last value.
        const series = new Set(matching.map(row => String(row[color])));
        if (series.size === 1) {
            target = matching.reduce((last, row) => (comparable(row[x]) >= comparable(last[x]) ? row : last));
            text = showNumber(target[y]);
        }
    } else if (matching.length === 1) {
        // One bar or point: its value.
        target = matching[0];
        text = showNumber(numericY ? target[y] : target[x]);
    }
    if (!target || text === undefined) return layers;
    // A note the app wrote says more than the value; it stands where the value would.
    if (note) text = note;
    const keyFields = numericX && numericY && !linear
        ? (detail ? [detail] : [x, y])
        : [x, y, color, detail].filter((field): field is string => !!field && !(field === (numericY ? y : x) && !linear) && !(linear && field === y));
    const key = Object.fromEntries(keyFields.map(field => [field, target![field]]));
    layers.push({ id: 'df-focus-label', ops: pointNote(rows, encodings, chartType, key, text, 'df-focus-label') } as unknown as ChartUpdate);
    return layers;
}

const ANNOTATION_INK = '#6b6f76';

/**
 * The ops that write a note on the one mark `key` picks out. Flint notes a line or an area only at a
 * series' last point; inside the line, the point is marked and the note written above it.
 */
function pointNote(rows: Row[], encodings: Record<string, Encoding>, chartType: string, key: Record<string, unknown>,
    text: string, name: string, color?: string): Record<string, unknown>[] {
    const linear = /line|area/i.test(chartType);
    const x = fieldOfEncoding(encodings.x);
    const y = fieldOfEncoding(encodings.y);
    const series = fieldOfEncoding(encodings.color) ?? fieldOfEncoding(encodings.detail);
    const row = linear && x && y ? rows.find(item => Object.entries(key).every(([field, value]) => String(item?.[field]) === String(value))) : undefined;
    const last = row && rows.filter(item => !series || item[series] === row[series]).every(item => comparable(item[x!]) <= comparable(row[x!]));
    if (!row || last) {
        // On a line, the note marks the row's own point rather than the segment that starts there.
        return [{ op: 'set-annotation', target: { select: { key } }, value: { text, ...(linear ? { anchor: 'point' } : {}) } }];
    }
    const ink = color ?? '#333333';
    const at = { x: row[x!], y: row[y!] };
    return [
        { op: 'set-overlay', name: `${name}-point`, value: { mark: 'point', role: 'annotation', data: { values: [at] },
            encodings: { x: { field: 'x' }, y: { field: 'y' } }, style: { fill: ink, pointRadius: 3.5 } } },
        ...(text ? [{ op: 'set-overlay', name: `${name}-text`, value: { mark: 'text', role: 'annotation', data: { values: [{ ...at, text }] },
            encodings: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 'text' } }, style: { fill: ink, fontSize: 11, fontWeight: 'bold', dy: -10 } } }] : []),
    ];
}

/** An axis's ends in the chart's rows: the lowest and highest value, or the first and last category. */
function axisEnds(rows: Row[], field: string | undefined): [unknown, unknown] | null {
    if (!field) return null;
    const values = rows.map(row => row?.[field]).filter(value => value !== undefined && value !== null);
    if (!values.length) return null;
    if (values.every(value => Number.isFinite(comparable(value)))) {
        return [values.reduce((a, b) => (comparable(b) < comparable(a) ? b : a)), values.reduce((a, b) => (comparable(b) > comparable(a) ? b : a))];
    }
    return [values[0], values[values.length - 1]];
}

/** Whether an axis's values are numbers or dates (a continuous axis), not categories. */
const numericAxis = (rows: Row[], field: string | undefined) => !!field
    && rows.some(row => row?.[field] !== undefined && row?.[field] !== null)
    && rows.every(row => row?.[field] === undefined || row?.[field] === null || Number.isFinite(comparable(row[field])));

/**
 * The layers that draw the app's annotations: Flint notes on marks, and overlays (projected through the
 * chart's own scales) for lines and bands, with their text at the plot's far end or top.
 */
export function annotationLayers(annotations: ChartAnnotation[] | undefined, rows: Row[], encodings: Record<string, Encoding>,
    chartType = ''): ChartUpdate[] {
    if (!annotations?.length) return [];
    const xEnds = axisEnds(rows, fieldOfEncoding(encodings.x));
    const yEnds = axisEnds(rows, fieldOfEncoding(encodings.y));
    // Each annotation is its own update: Flint skips an update whose target matches nothing, and one
    // note that misses must not take the others with it.
    const layers: ChartUpdate[] = [];
    annotations.forEach((annotation, index) => {
        const name = `df-annotation-${index}`;
        const ops: Record<string, unknown>[] = [];
        const done = () => { if (ops.length) layers.push({ id: name, ops } as unknown as ChartUpdate); };
        const ink = annotation.color ?? ANNOTATION_INK;
        const text = (row: Record<string, unknown>, style: Record<string, unknown>) => annotation.text ? [{
            op: 'set-overlay', name: `${name}-text`, value: {
                mark: 'text', role: 'annotation', data: { values: [{ ...row, text: annotation.text }] },
                encodings: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 'text' } },
                style: { fill: ink, fontSize: 11, ...style },
            },
        }] : [];
        if (annotation.at) {
            ops.push(...pointNote(rows, encodings, chartType, annotation.at, annotation.text ?? '', name, annotation.color));
            done();
            return;
        }
        const axis = annotation.x !== undefined ? 'x' : annotation.y !== undefined ? 'y' : null;
        if (!axis) return;
        const value = axis === 'x' ? annotation.x : annotation.y;
        const band = Array.isArray(value) && value.length === 2;
        const [from, to] = band ? value as [unknown, unknown] : [value, value];
        const other = axis === 'x' ? yEnds : xEnds;
        ops.push({
            op: 'set-overlay', name, value: band
                ? { mark: 'rect', role: 'annotation', data: { values: [{ [axis]: from, [`${axis}2`]: to }] },
                    encodings: { [axis]: { field: axis }, [`${axis}2`]: { field: `${axis}2` } }, style: { fill: ink, fillOpacity: 0.12 } }
                : { mark: 'rule', role: 'annotation', data: { values: [{ [axis]: from }] }, encodings: { [axis]: { field: axis } },
                    style: { stroke: ink, strokeWidth: 1, ...(annotation.dashed ? { strokeDash: [4, 3] } : {}) } },
        });
        if (!other) { done(); return; }
        // A line or band across x is labelled at the top, beside its start; one across y at the far end, above
        // it, or below it over bars, where Flint prints the values above the bars' ends.
        const overBars = axis === 'y' && !numericAxis(rows, fieldOfEncoding(encodings.x));
        ops.push(...(axis === 'x'
            ? text({ x: from, y: other[1] }, { textAlign: 'start', dx: 4, dy: 4 })
            : text({ x: other[1], y: band ? to : from }, { textAlign: 'end', dy: band || overBars ? 12 : -4 })));
        done();
    });
    return layers;
}

/** The layer that hides the marks `hide` names (on the fields the chart's rows carry). */
export function hideLayers(hide: FocusWhere | null | undefined, rows: Row[]): ChartUpdate[] {
    const carried = Object.entries(hide ?? {}).filter(([field]) => rows.some(row => row && field in row));
    if (!carried.length) return [];
    const where = Object.fromEntries(carried.map(([field, value]) => [field, focusPart(value)]));
    return [{ id: 'df-hide', ops: [{ op: 'set-style', targets: [{ select: { where } }], value: { visible: false } }] } as unknown as ChartUpdate];
}

type ViewProp = FlintChartProps['view'];
const viewRange = (value: unknown): [unknown, unknown] | null => {
    const range = Array.isArray(value) ? value : (value as { range?: unknown } | null)?.range;
    return Array.isArray(range) && range.length === 2 && (range[0] != null || range[1] != null) ? range as [unknown, unknown] : null;
};

/** The axes a `view` frames: each field the chart draws on x or y, with its range (open ends at the data's extent). */
function viewAxes(view: ViewProp, rows: Row[], encodings: Record<string, Encoding>): { x?: [unknown, unknown]; y?: [unknown, unknown] } {
    const axes: { x?: [unknown, unknown]; y?: [unknown, unknown] } = {};
    for (const [field, value] of Object.entries(view ?? {})) {
        const range = viewRange(value);
        const axis = field === fieldOfEncoding(encodings.x) ? 'x' : field === fieldOfEncoding(encodings.y) ? 'y' : null;
        if (!range || !axis) continue;
        const present = rows.map(row => row[field]).filter(item => item !== null && item !== undefined);
        const low = range[0] ?? present.reduce((a, b) => (comparable(b) < comparable(a) ? b : a), present[0]);
        const high = range[1] ?? present.reduce((a, b) => (comparable(b) > comparable(a) ? b : a), present[0]);
        axes[axis] = [low, high];
    }
    return axes;
}

/** The layer that frames a `view`: the chart's viewport on those axes. */
/** Small multiples (a `column`, `row`, or `facet` channel) cannot move their viewport; a view narrows their rows. */
export const isFaceted = (encodings: Record<string, Encoding | null | undefined>) => !!(encodings.column || encodings.row || encodings.facet);

export function viewLayers(view: ViewProp, rows: Row[], encodings: Record<string, Encoding>): ChartUpdate[] {
    if (isFaceted(encodings)) return [];
    const axes = viewAxes(view, rows, encodings);
    const names = (Object.keys(axes) as ('x' | 'y')[]).sort();
    if (!names.length) return [];
    return [{ id: 'df-view', ops: [{ op: 'set-viewport', axes: names.join('') as 'x' | 'y' | 'xy', value: axes }] } as unknown as ChartUpdate];
}

/** The axes a chart that takes a `view` can be framed on: those its view names, else x. */
const viewAxisNames = (view: ViewProp, encodings: Record<string, Encoding>) => {
    const names = Object.keys(view ?? {}).map(field => (field === fieldOfEncoding(encodings.y) ? 'y' : field === fieldOfEncoding(encodings.x) ? 'x' : null))
        .filter((axis): axis is 'x' | 'y' => !!axis);
    return names.includes('x') && names.includes('y') ? 'xy' : names.includes('y') ? 'y' : 'x';
};

/** A viewport end the reader zoomed to, written the way the rows write the field (a Date back to "2014-03", 2014, …). */
export function inFieldTerms(value: unknown, sample: unknown): unknown {
    const date = value instanceof Date ? value
        : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !(typeof sample === 'string' && sample.includes('T')) ? new Date(value) : null;
    if (!date) return typeof sample === 'number' && typeof value === 'number' && Number.isInteger(sample) ? Math.round(value) : value;
    if (typeof sample === 'number') return sample >= 1000 && sample <= 3000 ? date.getUTCFullYear() : date.getTime();
    if (typeof sample === 'string') {
        const iso = date.toISOString();
        if (/^\d{4}$/.test(sample)) return iso.slice(0, 4);
        if (/^\d{4}-\d{2}$/.test(sample)) return iso.slice(0, 7);
        if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return iso.slice(0, 10);
        return iso;
    }
    return date;
}

/** The view a reader's zoom stands for, by the fields on the axes it moved. */
function viewOfViewport(viewport: { x?: unknown; y?: unknown } | undefined, rows: Row[], encodings: Record<string, Encoding>):
    Record<string, [unknown, unknown]> | null {
    const out: Record<string, [unknown, unknown]> = {};
    for (const axis of ['x', 'y'] as const) {
        const coordinate = viewport?.[axis] as { kind?: string; start?: unknown; end?: unknown } | undefined;
        const field = fieldOfEncoding(encodings[axis]);
        if (!field || coordinate?.kind !== 'interval') continue;
        const present = rows.map(row => row[field]).filter(value => value !== null && value !== undefined);
        const start = inFieldTerms(coordinate.start, present[0]);
        const end = inFieldTerms(coordinate.end, present[0]);
        // A view over everything is no view: the reader went back to the whole chart.
        const values = present.map(comparable);
        const whole = values.length && comparable(start) <= Math.min(...values.slice(0, 50000)) && comparable(end) >= Math.max(...values.slice(0, 50000));
        if (!whole) out[field] = [start, end];
    }
    return Object.keys(out).length ? out : null;
}

/** Whether a row passes the filters (a range may leave an end open). */
const passes = (row: Row, parts: Record<string, FocusPart>) => Object.entries(parts).every(([field, part]) => {
    if ('in' in part) return part.in.some(item => String(item) === String(row[field]));
    const at = comparable(row[field]);
    const [low, high] = part.range;
    return !Number.isNaN(at) && (low == null || at >= comparable(low)) && (high == null || at <= comparable(high));
});

/** A `filter` as Flint's filter-controls take it: each field the rows carry, empty values left out. */
export function chartFilters(filter: FocusWhere | null | undefined, rows: Row[]): Record<string, FocusPart> {
    const out: Record<string, FocusPart> = {};
    for (const [field, value] of Object.entries(filter ?? {})) {
        if (!rows.some(row => row && field in row)) continue;
        if (value === null || value === undefined || value === '') continue;
        if (Array.isArray(value)) {
            if (value.length) out[field] = { in: value };
            continue;
        }
        const range = viewRange(value);
        if (value && typeof value === 'object' && 'range' in (value as object)) {
            if (range) out[field] = { range };
            continue;
        }
        const listed = (value as { in?: unknown[] })?.in;
        if (Array.isArray(listed)) {
            if (listed.length) out[field] = { in: listed };
            continue;
        }
        out[field] = { in: [value] };
    }
    return out;
}

/**
 * The focus a reader's selection stands for, for other charts: a click picks the categories its marks
 * belong to (a line's series; a bar's or a point's named fields), a drag the span it covers on the axes it
 * runs along. Null when nothing is selected.
 */
export function selectionFocus(values: Record<string, unknown>[], chartType: string, encodings: Record<string, Encoding>,
    select: boolean | 'range' | undefined): FocusWhere | null {
    if (!values.length) return null;
    const field = (channel: string) => fieldOfEncoding(encodings[channel]);
    const linear = /line|area|bump|slope|sparkline/i.test(chartType);
    const scatter = /scatter|bubble/i.test(chartType);
    const span = (name: string | undefined): [string, unknown] | null => {
        if (!name) return null;
        const present = values.map(row => row[name]).filter(value => value !== undefined && value !== null);
        if (!present.length) return null;
        const low = present.reduce((a, b) => (comparable(b) < comparable(a) ? b : a));
        const high = present.reduce((a, b) => (comparable(b) > comparable(a) ? b : a));
        return [name, { range: [low, high] }];
    };
    if (select === 'range' && (linear || scatter)) {
        const parts = (scatter ? [span(field('x')), span(field('y'))] : [span(field('x'))]).filter((part): part is [string, unknown] => !!part);
        return parts.length ? Object.fromEntries(parts) : null;
    }
    // A click: the categories the selected marks belong to, not the measures they draw.
    const named = linear
        ? [field('color') ?? field('detail')]
        : ['x', 'y', 'color', 'detail', 'column', 'row'].map(field)
            .filter(name => name && !values.every(row => isNumber(row[name])));
    const parts = [...new Set(named.filter((name): name is string => !!name))]
        .map(name => [name, { in: [...new Set(values.map(row => row[name]))] }] as [string, unknown]);
    return parts.length ? Object.fromEntries(parts) : null;
}

const interactionEntries = (interactions: ChartInteraction[] | undefined) =>
    (interactions ?? []).map(entry => typeof entry === 'string' ? { type: entry } : entry);

/** The fields a chart's `filter` narrows, which its filter-controls are mounted for. */
const FILTER_ID = 'df-filter';

/**
 * The chart's interactions: the preset its `select` stands for; for a `view`, the zoom that lets the app
 * frame it and the reader drag a period to zoom (without `select`, which has the drag) or else only the
 * frame; for a `filter`, Flint's filter controls, drawn by the app's own controls; then any advanced ones.
 */
const chartInteractions = (props: Pick<ResolvedChartProps, 'chartType' | 'encodings' | 'select' | 'interactions' | 'view' | 'onView' | 'filter'>,
    filterFields: string[] = []): ChartInteraction[] | undefined => {
    const own = props.interactions ?? [];
    const has = (type: string) => own.some(entry => (typeof entry === 'string' ? entry : entry.type) === type);
    const added: ChartInteraction[] = [];
    const preset = selectPreset(props.chartType, props.encodings, props.select);
    if (preset && !has(preset)) added.push(preset);
    if (('view' in props || props.onView) && !isFaceted(props.encodings) && !has('brush-zoom') && !has('navigate')) {
        const axes = viewAxisNames(props.view, props.encodings);
        added.push(props.select
            ? { type: 'navigate', options: { axes, pan: false, zoom: false } }
            : { type: 'brush-zoom', options: { axes, reset: ['double-click', 'escape'] } });
    }
    if (filterFields.length && !has('filter-controls')) {
        added.push({ type: 'filter-controls', id: FILTER_ID, options: { fields: filterFields, mode: 'filter', render: false } });
    }
    if (!added.length) return props.interactions;
    return [...added, ...own];
};

/**
 * Turn a sort by another channel (`sortBy: 'x'`, which a column on that channel also becomes) into the
 * category order it means, computed from the rows. Flint passes a channel sort to Vega-Lite as `"-x"`, and
 * where a theme lays the chart out in layers that do not all carry that channel (row names above narrow
 * bars, value labels), Vega-Lite fails outright ("Cannot destructure property 'aggregate' …"). An explicit
 * order draws the same and holds in every layer.
 */
export function explicitChannelSorts(encodings: Record<string, Encoding>, rows: Row[]): Record<string, Encoding> {
    const resolved = { ...encodings };
    for (const [channel, encoding] of Object.entries(encodings)) {
        if (typeof encoding !== 'object' || !encoding?.field || !encoding.sortBy || !/^(x|y|color)$/.test(encoding.sortBy)) continue;
        const by = encodings[encoding.sortBy];
        const byField = fieldOfEncoding(by);
        if (!byField || byField === encoding.field) continue;
        const op = (typeof by === 'object' && by?.aggregate) || 'sum';
        const groups = new Map<unknown, number[]>();
        for (const row of rows) {
            const key = row[encoding.field];
            const value = Number(row[byField]);
            if (!groups.has(key)) groups.set(key, []);
            if (row[byField] !== null && row[byField] !== undefined && Number.isFinite(value)) groups.get(key)!.push(value);
        }
        const measure = (values: number[]) => {
            if (op === 'count') return values.length;
            if (!values.length) return -Infinity;
            if (op === 'mean' || op === 'average') return values.reduce((a, b) => a + b, 0) / values.length;
            if (op === 'min') return Math.min(...values);
            if (op === 'max') return Math.max(...values);
            return values.reduce((a, b) => a + b, 0);
        };
        const order = [...groups.entries()].map(([key, values]) => [key, measure(values)] as const)
            .sort((a, b) => a[1] - b[1]).map(([key]) => key);
        resolved[channel] = { ...encoding, sortBy: JSON.stringify(order) };
    }
    return resolved;
}

/** The Flint input for a chart: the rows, what the fields mean, the chart, and its behaviour. */
export function flintChartInput(props: ResolvedChartProps, rows: Row[], width: number, surface?: string): ChartAssemblyInput {
    const { chartType, table, title, subtitle, theme, semanticTypes, labels, chartProperties } = props;
    const height = fixedHeight(props.height);
    const tableSemantics = (table && appConfig().semantics?.[table]) || {};
    const semantic_types: Record<string, unknown> = {};
    const field_display_names: Record<string, string> = {};
    for (const [field, info] of Object.entries(tableSemantics)) {
        const { displayName, authored: _authored, ...annotation } = info;
        if (annotation.semanticType) semantic_types[field] = Object.keys(annotation).length === 1 ? annotation.semanticType : annotation;
        if (displayName) field_display_names[field] = displayName;
    }
    Object.assign(semantic_types, semanticTypes);
    // An empty label hides the title: Flint names an untitled axis after its field, and a space draws nothing.
    Object.assign(field_display_names, Object.fromEntries(Object.entries(labels ?? {}).map(([field, label]) => [field, label === '' ? ' ' : label])));
    const encodings = explicitChannelSorts(resolveColumnSorts(Object.fromEntries(Object.entries(props.encodings)
        .map(([channel, encoding]) => [channel, typeof encoding === 'string' ? { field: encoding } : encoding])), rows), rows);
    const properties = choroplethRegion(chartType, encodings as Record<string, { field?: string }>, rows, chartProperties);
    const interactions = interactionEntries(chartInteractions(props));
    return {
        data: { values: rows },
        semantic_types,
        chart_spec: {
            chartType,
            encodings,
            // The box is the chart's ceiling as well as its base: it lays out for the box, axes and keys included.
            baseSize: { width: Math.max(160, width), height },
            canvasSize: { width: Math.max(160, width), height },
            ...(title ? { title } : {}),
            ...(subtitle ? { subtitle } : {}),
            ...(props.kicker ? { label: props.kicker } : {}),
            ...(props.source ? { source: props.source } : {}),
            ...(properties ? { chartProperties: properties } : {}),
        },
        // A card is the room the chart has: sparse category axes widen into it rather than keep a fixed step.
        options: { addTooltips: true, bandStepFit: 1, ...(surface ? { background: surface } : {}) },
        ...(resolveAppTheme(theme) ? { theme_spec: resolveAppTheme(theme) } : {}),
        ...(Object.keys(field_display_names).length ? { field_display_names } : {}),
        ...(interactions.length ? { interaction_spec: { interactions } } : {}),
    } as unknown as ChartAssemblyInput;
}

/** How long a chart's updates stay unchanged before they are checked (a story's steps pass quickly). */
const UPDATE_CHECK_DELAY_MS = 300;

type ChartValidator = (input: ChartAssemblyInput, backend: string, options: { updates: ChartUpdate[] }) =>
    { updates?: { id: string; ops: { ok: boolean; text?: string; reason?: string }[] }[] };

/**
 * Report the app's updates Flint cannot apply (a key that names no mark, a viewport on a chart that
 * cannot move), which the chart otherwise skips without a word. Each problem is reported once.
 */
function useUpdateCheck(input: ChartAssemblyInput | null, updates: ChartUpdate[] | undefined, title?: string) {
    const reported = useRef(new Set<string>());
    useEffect(() => {
        const validate = (optionalModule('flint-links') as { validateChart?: ChartValidator } | undefined)?.validateChart;
        if (!validate || !input || !updates?.length || !(input.data.values?.length)) return;
        const timer = setTimeout(() => {
            let result: ReturnType<ChartValidator>;
            try {
                result = validate(input, 'vegalite', { updates });
            } catch {
                return;
            }
            const chart = title ? `"${title}"` : `the ${input.chart_spec.chartType}`;
            for (const update of result.updates ?? []) {
                for (const op of update.ops) {
                    if (op.ok) continue;
                    const message = `FlintChart ${chart}: update "${update.id}" ${op.text ?? ''} cannot apply: ${op.reason ?? 'unsupported'}`;
                    if (reported.current.has(message)) continue;
                    reported.current.add(message);
                    reportError(message);
                }
            }
        }, UPDATE_CHECK_DELAY_MS);
        return () => clearTimeout(timer);
    }, [input, updates, title]);
}

/** Widths change in steps, so a chart is laid out again only when its card really changes size. */
const WIDTH_STEP = 40;
const HEIGHT_STEP = 4;

function FlintChartBody(props: ResolvedChartProps) {
    const { chartType, fit = 'relayout' } = props;
    const fill = props.height === 'fill';
    const encodings = useStable(props.encodings);
    const rows = useStable(props.data ?? []);
    const semanticTypes = useStable(props.semanticTypes);
    const labels = useStable(props.labels);
    const chartProperties = useStable(props.chartProperties);
    // A filter on fields the chart draws narrows its rows in place (Flint's filter controls); on other fields
    // (a bar chart of averages filtered by date) it narrows the rows before they reach the chart.
    // Small multiples cannot be framed, so their view narrows their rows instead.
    const viewAsFilter = isFaceted(encodings) && props.view
        ? Object.fromEntries(Object.entries(props.view).map(([field, value]) => [field, { range: viewRange(value) }]))
        : {};
    const allFilters = chartFilters({ ...viewAsFilter, ...props.filter }, rows);
    // Flint's in-place filter loses a chart's own aggregates (a bar of averages draws nothing), so such a
    // chart takes its rows narrowed instead.
    const aggregates = Object.values(encodings).some(encoding => typeof encoding === 'object' && !!(encoding as { aggregate?: unknown })?.aggregate);
    const drawn = new Set(aggregates ? [] : Object.values(encodings).map(fieldOfEncoding).filter((field): field is string => !!field));
    const filters = useStable(Object.fromEntries(Object.entries(allFilters).filter(([field]) => drawn.has(field))));
    const outside = useStable(Object.fromEntries(Object.entries(allFilters).filter(([field]) => !drawn.has(field))));
    const data = useMemo(() => (Object.keys(outside).length ? rows.filter(row => passes(row, outside)) : rows), [rows, outside]);
    // The fields a filter-controls preset is mounted for: every field the app has filtered on so far, so a
    // control that empties keeps the chart as mounted.
    const filterFieldsSeen = useRef<string[]>([]);
    for (const field of Object.keys(filters)) if (!filterFieldsSeen.current.includes(field)) filterFieldsSeen.current = [...filterFieldsSeen.current, field].sort();
    const filterFields = 'filter' in props ? filterFieldsSeen.current : [];
    const interactions = useStable(chartInteractions(props, filterFields));
    const focus = useStable(props.focus);
    const note = props.note;
    // A chart the app gives a focus (even an empty one, as a step without a focus does) keeps the
    // same kind of chart as its focus comes and goes, so it moves rather than being drawn again.
    const focusable = 'focus' in props || 'note' in props || 'annotations' in props || 'hide' in props || 'view' in props;
    const annotations = useStable(props.annotations);
    const hide = useStable(props.hide);
    const view = useStable(props.view);
    const layers = useMemo(() => [...hideLayers(hide, data), ...focusLayers(focus, data, chartType, encodings, note),
        ...annotationLayers(annotations, data, encodings, chartType), ...viewLayers(view, data, encodings)],
    [hide, focus, data, chartType, encodings, note, annotations, view]);
    const updates = useStable(focusable || props.updates ? [...layers, ...(props.updates ?? [])] : undefined);
    const ref = useRef<HTMLDivElement>(null);
    const size = useSize(ref);
    const width = Math.floor(size.width / WIDTH_STEP) * WIDTH_STEP;
    // A fill chart takes its box's height to the nearest few pixels (a box's height seldom changes, unlike its width).
    const height = fill ? Math.max(FILL_MIN_HEIGHT, Math.floor(size.height / HEIGHT_STEP) * HEIGHT_STEP) : fixedHeight(props.height);
    const surface = useSurface(ref, width > 0);
    const theme = useStable(props.theme);
    const [error, setError] = useState<string | null>(null);
    // Flint lays a chart out for its box but can draw it wider or taller (a legend, long labels), and the view
    // then scales the whole drawing down, leaving empty bands in the box. Measure what it drew and lay it out
    // again with the overshoot taken off, so it fills the box at full size (a few rounds at most).
    const rowsVersion = useRef(0);
    const rowsKey = useMemo(() => ++rowsVersion.current, [data]);
    const layoutKey = JSON.stringify([width, height, chartType, encodings, labels, props.title, props.subtitle, props.kicker, props.source, chartProperties, theme, rowsKey]);
    const [shrink, setShrink] = useState({ key: '', w: 0, h: 0, rounds: 0, settled: false });
    // The first fit for a box is not shown while it settles; later ones (new rows) redraw in view.
    const sizeKey = `${width}x${height}`;
    const fittedSizes = useRef(new Set<string>());
    if (shrink.settled && shrink.key === layoutKey) fittedSizes.current.add(sizeKey);
    const settling = !fittedSizes.current.has(sizeKey);
    const taken = shrink.key === layoutKey ? shrink : { w: 0, h: 0 };
    const input = useMemo(() => width > 0 && surface ? flintChartInput({ ...props, height: Math.max(80, height - taken.h), encodings, semanticTypes, labels,
        chartProperties, interactions, theme, select: undefined }, data, Math.max(120, size.width - taken.w), surface) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartType, encodings, data, props.table, semanticTypes, labels, props.title, props.subtitle, props.kicker, props.source, height, chartProperties, theme, interactions, width, surface, taken.w, taken.h]);
    // `size.width` changes with every pixel; the layout follows it only when `width` (its 40 px step) does.

    const onSelect = useRef(props.onSelect);
    onSelect.current = props.onSelect;
    const onFocus = useRef(props.onFocus);
    onFocus.current = props.onFocus;
    const focusOf = useRef({ chartType, encodings, select: props.select });
    focusOf.current = { chartType, encodings, select: props.select };
    const onChange = useRef(props.onChange);
    onChange.current = props.onChange;
    const onView = useRef(props.onView);
    onView.current = props.onView;
    const viewOf = useRef({ data, encodings });
    const reportedView = useRef<string>('null');
    // A view the app sets (a slider) is the chart's now: the next zoom reports even if it lands on the last one.
    useEffect(() => { reportedView.current = ''; }, [view]);
    viewOf.current = { data, encodings };
    const chartRef = useRef<FlintChartHandle>(null);
    // The reader's own selection layers, by interaction id, and the focus this chart last reported.
    const readerLayers = useRef(new Set<string>());
    const reported = useRef<string | null>(null);
    const handleChange = useCallback((change: ChartChange) => {
        onChange.current?.(change);
        // Only the reader's own selections: the app's `updates` (its focus) also commit, and would echo back.
        if (change.source !== 'reader') return;
        // The reader zoomed (or went back): the range the gesture framed, which the state shows only later.
        const zoomed = change.interactionId === 'brush-zoom' || change.interactionId === 'navigate';
        // A double-click or Escape is "back to everything", even when the app's view holds the frame in place.
        const back = change.reset === 'double-click' || change.reset === 'escape';
        if (onView.current && (back || (change.phase === 'commit' && zoomed))) {
            const domain = change.reset ? undefined : (change.geometry as { domain?: { x?: unknown; y?: unknown } } | undefined)?.domain ?? change.state.viewport;
            const view = domain ? viewOfViewport(domain, viewOf.current.data, viewOf.current.encodings) : null;
            const key = JSON.stringify(view);
            if (key !== reportedView.current) {
                reportedView.current = key;
                onView.current?.(view);
            }
            return;
        }
        const report = (values: Record<string, unknown>[]) => {
            onSelect.current?.(values);
            const { chartType: type, encodings: channels, select } = focusOf.current;
            const focus = selectionFocus(values, type, channels, select);
            reported.current = JSON.stringify(focus);
            onFocus.current?.(focus);
        };
        // A click on nothing or Escape lets the selection go, even when the chart holds none of its own.
        if (change.reset) {
            report([]);
            return;
        }
        if (change.phase !== 'commit' || !change.changed.includes('selected')) return;
        // The state's `selected` is every emphasis on the chart, the app's focus included: read the
        // reader's own layer, the marks this gesture picked.
        const own = change.interactionId ? change.state.entries?.get(change.interactionId) : undefined;
        if (change.interactionId) readerLayers.current.add(change.interactionId);
        const elements = own ? own.elements : change.state.selected;
        report(elements.map(element => element.value as Record<string, unknown>));
    }, []);
    // A focus the app sets from elsewhere (a control, another chart) replaces what the reader picked here.
    const focusKey = JSON.stringify(props.focus ?? null);
    useEffect(() => {
        if (!('focus' in props) || focusKey === reported.current) return;
        reported.current = null;
        for (const id of readerLayers.current) void chartRef.current?.clearUpdate(id);
        readerLayers.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusKey]);
    // The app's filter reaches the chart through its filter-controls, after every mount and whenever it changes.
    const filtersKey = JSON.stringify(filters);
    const latestFilters = useRef(filters);
    latestFilters.current = filters;
    const sendFilters = useCallback(() => {
        if (!filterFields.length) return;
        void chartRef.current?.dispatch(FILTER_ID, { filters: latestFilters.current })?.catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterFields.join('|')]);
    useEffect(() => { sendFilters(); }, [filtersKey, sendFilters]);
    const room = useRef({ width: 0, height: 0, key: '' });
    room.current = { width: size.width, height, key: layoutKey };
    const handleRender = useCallback(() => {
        sendFilters();
        const svg = ref.current?.querySelector('svg');
        const drawnWidth = parseFloat(svg?.getAttribute('width') ?? '');
        const drawnHeight = parseFloat(svg?.getAttribute('height') ?? '');
        if (!Number.isFinite(drawnWidth) || !Number.isFinite(drawnHeight)) return;
        const { width: roomWidth, height: roomHeight, key } = room.current;
        setShrink(previous => {
            const current = previous.key === key ? previous : { key, w: 0, h: 0, rounds: 0, settled: false };
            const overWidth = drawnWidth - roomWidth;
            const overHeight = drawnHeight - roomHeight;
            // Take off what it drew past the box; give back what it left unused, never more than was taken.
            const next = (taken: number, over: number) => (Math.abs(over) <= 2 ? taken : Math.max(0, taken + Math.round(over)));
            const w = next(current.w, overWidth);
            const h = next(current.h, overHeight);
            if (current.rounds >= 4 || (w === current.w && h === current.h)) {
                return current.settled && current === previous ? previous : { ...current, settled: true };
            }
            return { key, w, h, rounds: current.rounds + 1, settled: false };
        });
    }, [sendFilters]);
    const errorSource = useRef(props);
    errorSource.current = props;
    const handleError = useCallback((failure: Error) => {
        setError(errorMessage(failure));
        reportError(chartErrorMessage(errorSource.current, errorMessage(failure)));
    }, []);
    useEffect(() => setError(null), [input]);

    useUpdateCheck(input, updates, props.title);

    return (
        <Box ref={ref} data-flint-chart data-chart-type={chartType} sx={{
            ...FIT_WIDTH_SX,
            // A fill chart's own drawing never counts toward its container's height, so it cannot grow it.
            ...(fill ? { ...FILL_SX, display: 'block', contain: 'size', minHeight: FILL_MIN_HEIGHT, overflow: 'clip' }
                : { minHeight: height }),
            opacity: settling && !error ? 0 : 1, transition: 'opacity 120ms ease-out',
            // Without a theme, Vega paints white whatever the chart sits on; let what is behind it show.
            ...(resolveAppTheme(theme) ? {} : { '& svg': { backgroundColor: 'transparent !important' } }),
        }}>
            {error && <ChartError message={error} height={height} />}
            {input && !error && <FlintChartView ref={chartRef} spec={input} width="100%" height={height} fit={fit === 'relayout' ? 'scale-down' : fit} renderer="svg" background={surface}
                ariaLabel={props.title} onError={handleError} onRender={handleRender}
                onChange={handleChange} {...(updates ? { updates } : {})} />}
        </Box>
    );
}

/** A choropleth: Flint's static compiler, so places without data keep their shape in a quiet grey. */
function StaticChoropleth(props: ResolvedChartProps) {
    const height = fixedHeight(props.height);
    const data = useStable(props.data ?? []);
    const ref = useRef<HTMLDivElement>(null);
    const width = useWidth(ref);
    const surface = useSurface(ref, width > 0);
    const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
    const [buildError, setBuildError] = useState<string | null>(null);
    const input = useMemo(() => width > 0 && surface ? flintChartInput(props, data, width, surface) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify({ ...props, data: undefined, query: undefined }), data, width, surface]);
    useEffect(() => {
        if (!input) return;
        try {
            const flint = optionalModule('@df/geo/flint') as { assembleVegaLite(input: ChartAssemblyInput): Record<string, any> } | undefined;
            if (!flint) throw new Error('Map boundaries did not load in this app. Reload the app to try again.');
            const { interaction_spec: _interactions, ...staticInput } = input as ChartAssemblyInput & { interaction_spec?: unknown };
            setSpec(keepUnmatchedRegions(flint.assembleVegaLite(staticInput as ChartAssemblyInput)));
            setBuildError(null);
        } catch (failure) {
            setSpec(null);
            setBuildError(errorMessage(failure));
            reportError(chartErrorMessage(props, errorMessage(failure)));
        }
    }, [input]);
    const renderError = useVegaView(ref, spec ? fitChartToWidth(spec, width, data) : null);
    const error = buildError ?? renderError;
    return (
        <Box sx={{ ...FIT_WIDTH_SX, overflowX: 'auto',
            ...(resolveAppTheme(props.theme) ? {} : { '& svg': { backgroundColor: 'transparent !important' } }) }}>
            {error && <ChartError message={error} height={height} />}
            <Box ref={ref} sx={{ minHeight: error ? 0 : height, display: error ? 'none' : 'block' }} />
        </Box>
    );
}

type LinkPartValue = { in?: unknown[]; range?: [unknown, unknown] } | null | undefined;

const comparable = (value: unknown) => value instanceof Date ? value.getTime()
    : typeof value === 'string' && isNaN(Number(value)) ? Date.parse(value) : Number(value);

const meetsPart = (value: unknown, part: LinkPartValue) => {
    if (!part) return true;
    if (part.in) return part.in.some(item => String(item) === String(value));
    if (part.range) {
        const [low, high] = part.range.map(comparable);
        const at = comparable(value);
        return at >= Math.min(low, high) && at <= Math.max(low, high);
    }
    return true;
};

export interface SparklineProps {
    data?: Row[];
    query?: QueryResult;
    x: string;
    y: string;
    color?: string;
    height?: number;
}

/** An axis-free trend line, e.g. inside a Kpi. */
export function Sparkline({ data, query, x, y, color, height = 32 }: SparklineProps) {
    const rows = useStable(query ? query.rows : data ?? []);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element || rows.length === 0) return;
        let disposed = false;
        let view: { finalize(): void } | undefined;
        bridge().sparkline(element, rows, { x, y, color, height }).then(
            result => { view = result; if (disposed) result.finalize(); },
            failure => reportError(`Sparkline: ${errorMessage(failure)}`),
        );
        return () => { disposed = true; view?.finalize(); };
    }, [rows, x, y, color, height]);
    return <Box ref={ref} sx={{ ...FIT_WIDTH_SX, height }} />;
}
