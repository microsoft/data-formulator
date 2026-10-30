// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** `@df/chart`: Flint charts (as on the DF canvas, interactive and linkable), raw Vega-Lite, and sparklines. */

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import {
    FlintChart as FlintChartView, flintSpecKey, useLinkedCharts,
    type ChartChange, type ChartUpdate, type FlintChartFit, type LinkedChartProps, type LinkedCharts,
} from 'flint-chart/react';
import type { ChartAssemblyInput } from 'flint-chart';
import { resolveColumnSorts } from '../../chartSort';
import { choroplethRegion, keepUnmatchedRegions } from '../../chartMaps';

import { appConfig, bridge, errorMessage, reportError, type Row } from './bridge';
import { optionalModule } from './optional/register';
import type { QueryResult } from './data';
import { ErrorState, QueryView, useStable } from './states';

type Encoding = string | { field: string; type?: string; aggregate?: string; sortOrder?: string; sortBy?: string; scheme?: string };

/** Width of an element, tracked across resizes. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const update = () => setWidth(Math.floor(element.getBoundingClientRect().width));
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return width;
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
    height?: number;
}

/** A raw Vega-Lite chart, themed like DF and sized to its container's width. */
export function VegaChart({ spec, data, query, height = 260 }: VegaChartProps) {
    if (query) return <QueryView query={query} height={height}>{rows => <VegaChart spec={spec} data={rows} height={height} />}</QueryView>;
    return <VegaChartBody spec={spec} data={data} height={height} />;
}

function VegaChartBody({ spec: specProp, data: dataProp, height }: { spec: Record<string, any>; data?: Row[]; height: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const spec = useStable(specProp);
    const data = useStable(dataProp);
    const [fullSpec, setFullSpec] = useState<Record<string, unknown> | null>(null);
    useEffect(() => {
        setFullSpec({
            ...spec,
            ...(data ? { data: { values: data } } : {}),
            width: spec.width ?? 'container',
            height: spec.height ?? height,
        });
    }, [spec, data, height]);
    const error = useVegaView(ref, fullSpec);
    return error ? <ChartError message={error} height={height} /> : <Box ref={ref} sx={{ width: '100%', minWidth: 0, minHeight: height }} />;
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

export interface FlintChartProps {
    /** A Flint chart type, e.g. "Line Chart", "Bar Chart", "Scatter Plot". */
    chartType: string;
    /** Channel → field name, or a Flint encoding object ({field, type, aggregate, sortBy, ...}). */
    encodings: Record<string, Encoding>;
    data?: Row[];
    query?: QueryResult;
    /** Declared table the rows come from; its semantic annotations and display names are used. */
    table?: string;
    /** Extra or overriding semantic types, by field. */
    semanticTypes?: Record<string, string | Record<string, unknown>>;
    /** Axis and legend titles by field, e.g. { metric_value: 'Indexed close' }. */
    labels?: Record<string, string>;
    title?: string;
    subtitle?: string;
    height?: number;
    chartProperties?: Record<string, unknown>;
    /** A Flint theme preset id (e.g. "economist"), the same themes as the DF canvas. */
    theme?: string;
    /** What the reader can do: Flint interaction presets, e.g. ['click-highlight', { type: 'brush-x' }]. */
    interactions?: ChartInteraction[];
    /** Layers the app shows on the chart (emphasis, notes, a viewport), as Flint ChartUpdates; replaced by id. */
    updates?: ChartUpdate[];
    /** The marks the reader selected, as their field values, after each committed change ([] when cleared). */
    onSelect?: (values: Record<string, unknown>[]) => void;
    /** Every change Flint reports: the gesture's phase, interaction, and the chart's state after it. */
    onChange?: (change: ChartChange) => void;
    /** This chart's id inside a <ChartLink>; defaults to one of its own. */
    linkId?: string;
    /** How the chart meets its card: 'relayout' (default) lays it out for the card's width. */
    fit?: FlintChartFit;
}

/** A chart compiled by Flint from semantic encodings, matching the DF canvas; interactive, and linkable in a <ChartLink>. */
export function FlintChart(props: FlintChartProps) {
    const { query, height = 260 } = props;
    const Body = props.chartType === 'Choropleth' ? StaticChoropleth : FlintChartBody;
    if (query) return <QueryView query={query} height={height}>{rows => <Body {...props} data={rows} />}</QueryView>;
    return <Body {...props} />;
}

const interactionEntries = (interactions: ChartInteraction[] | undefined) =>
    (interactions ?? []).map(entry => typeof entry === 'string' ? { type: entry } : entry);

/** The Flint input for a chart: the rows, what the fields mean, the chart, and its behaviour. */
export function flintChartInput(props: FlintChartProps, rows: Row[], width: number): ChartAssemblyInput {
    const { chartType, table, title, subtitle, height = 260, theme, semanticTypes, labels, chartProperties } = props;
    const tableSemantics = (table && appConfig().semantics?.[table]) || {};
    const semantic_types: Record<string, unknown> = {};
    const field_display_names: Record<string, string> = {};
    for (const [field, info] of Object.entries(tableSemantics)) {
        const { displayName, authored: _authored, ...annotation } = info;
        if (annotation.semanticType) semantic_types[field] = Object.keys(annotation).length === 1 ? annotation.semanticType : annotation;
        if (displayName) field_display_names[field] = displayName;
    }
    Object.assign(semantic_types, semanticTypes);
    Object.assign(field_display_names, labels);
    const encodings = resolveColumnSorts(Object.fromEntries(Object.entries(props.encodings)
        .map(([channel, encoding]) => [channel, typeof encoding === 'string' ? { field: encoding } : encoding])), rows);
    const properties = choroplethRegion(chartType, encodings as Record<string, { field?: string }>, rows, chartProperties);
    const interactions = interactionEntries(props.interactions);
    return {
        data: { values: rows },
        semantic_types,
        chart_spec: {
            chartType,
            encodings,
            baseSize: { width: Math.max(160, width), height },
            ...(title ? { title } : {}),
            ...(subtitle ? { subtitle } : {}),
            ...(properties ? { chartProperties: properties } : {}),
        },
        // A card is the room the chart has: sparse category axes widen into it rather than keep a fixed step.
        options: { addTooltips: true, bandStepFit: 1 },
        ...(theme ? { theme_spec: theme } : {}),
        ...(Object.keys(field_display_names).length ? { field_display_names } : {}),
        ...(interactions.length ? { interaction_spec: { interactions } } : {}),
    } as unknown as ChartAssemblyInput;
}

/** Widths change in steps, so a chart is laid out again only when its card really changes size. */
const WIDTH_STEP = 40;

function FlintChartBody(props: FlintChartProps) {
    const { chartType, height = 260, fit = 'relayout', linkId } = props;
    const encodings = useStable(props.encodings);
    const data = useStable(props.data ?? []);
    const semanticTypes = useStable(props.semanticTypes);
    const labels = useStable(props.labels);
    const chartProperties = useStable(props.chartProperties);
    const interactions = useStable(props.interactions);
    const updates = useStable(props.updates);
    const ref = useRef<HTMLDivElement>(null);
    const width = Math.floor(useWidth(ref) / WIDTH_STEP) * WIDTH_STEP;
    const [error, setError] = useState<string | null>(null);
    const ownId = useId();
    const id = linkId ?? ownId;
    const link = useContext(LinkContext);

    const input = useMemo(() => width > 0 ? flintChartInput({ ...props, encodings, semanticTypes, labels, chartProperties, interactions },
        data, width) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartType, encodings, data, props.table, semanticTypes, labels, props.title, props.subtitle, height, chartProperties, props.theme, interactions, width]);
    useEffect(() => {
        if (!link || !input) return;
        link.register(id, input);
        return () => link.unregister(id);
    }, [link, id, input]);

    const onSelect = useRef(props.onSelect);
    onSelect.current = props.onSelect;
    const onChange = useRef(props.onChange);
    onChange.current = props.onChange;
    const handleChange = useCallback((change: ChartChange) => {
        onChange.current?.(change);
        // Only the reader's own selections: the app's `updates` also commit, and would echo back.
        if (change.phase === 'commit' && change.source === 'reader' && change.changed.includes('selected')) {
            onSelect.current?.(change.state.selected.map(element => element.value as Record<string, unknown>));
        }
    }, []);
    const handleError = useCallback((failure: Error) => {
        setError(errorMessage(failure));
        reportError(`FlintChart: ${errorMessage(failure)}`);
    }, []);
    useEffect(() => setError(null), [input]);

    const linked: Partial<LinkedChartProps> = link ? link.chart(id, { onChange: handleChange, updates: updates ?? [] }) : {};
    return (
        <Box ref={ref} data-flint-chart sx={{ width: '100%', minWidth: 0, minHeight: height }}>
            {error && <ChartError message={error} height={height} />}
            {input && !error && <FlintChartView spec={input} width="100%" height={height} fit={fit} renderer="svg"
                ariaLabel={props.title} onError={handleError}
                onChange={handleChange} {...(updates ? { updates } : {})} {...linked} />}
        </Box>
    );
}

/** A choropleth: Flint's static compiler, so places without data keep their shape in a quiet grey. */
function StaticChoropleth(props: FlintChartProps) {
    const { height = 260 } = props;
    const data = useStable(props.data ?? []);
    const ref = useRef<HTMLDivElement>(null);
    const width = useWidth(ref);
    const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
    const [buildError, setBuildError] = useState<string | null>(null);
    const input = useMemo(() => width > 0 ? flintChartInput(props, data, width) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify({ ...props, data: undefined, query: undefined }), data, width]);
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
            reportError(`FlintChart: ${errorMessage(failure)}`);
        }
    }, [input]);
    const renderError = useVegaView(ref, spec ? fitChartToWidth(spec, width, data) : null);
    const error = buildError ?? renderError;
    return (
        <Box sx={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
            {error && <ChartError message={error} height={height} />}
            <Box ref={ref} sx={{ minHeight: error ? 0 : height, display: error ? 'none' : 'block' }} />
        </Box>
    );
}

interface LinkRegistry {
    register(id: string, input: ChartAssemblyInput): void;
    unregister(id: string): void;
    chart: LinkedCharts['chart'];
}
const LinkContext = createContext<LinkRegistry | null>(null);
const LinkStateContext = createContext<LinkedCharts | null>(null);

export interface ChartLinkProps {
    /** The fields the charts connect on, e.g. ['region']: selecting in one chart emphasizes the matching marks in the others. */
    fields: string[];
    children?: React.ReactNode;
}

/**
 * Links the FlintCharts inside it on the fields they share: a click or a brush in one emphasizes
 * the matching marks in every other, and a reset on any clears them all. Controls and tables join
 * through useChartLink().
 */
export function ChartLink({ fields, children }: ChartLinkProps) {
    const [inputs, setInputs] = useState<Record<string, ChartAssemblyInput>>({});
    const keys = useRef(new Map<string, string>());
    const fieldsKey = JSON.stringify(fields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const spec = useMemo(() => ({ fields }), [fieldsKey]);
    const link = useLinkedCharts(inputs, spec);
    const register = useCallback((id: string, input: ChartAssemblyInput) => {
        const key = flintSpecKey(input);
        if (keys.current.get(id) === key) return;
        keys.current.set(id, key);
        setInputs(current => ({ ...current, [id]: input }));
    }, []);
    const unregister = useCallback((id: string) => {
        keys.current.delete(id);
        setInputs(current => {
            const { [id]: _gone, ...rest } = current;
            return rest;
        });
    }, []);
    const registry = useMemo(() => ({ register, unregister, chart: link.chart }), [register, unregister, link.chart]);
    return <LinkContext.Provider value={registry}><LinkStateContext.Provider value={link}>{children}</LinkStateContext.Provider></LinkContext.Provider>;
}

type LinkPartValue = { in?: unknown[]; range?: [unknown, unknown] } | null | undefined;

const meetsPart = (value: unknown, part: LinkPartValue) => {
    if (!part) return true;
    if (part.in) return part.in.some(item => String(item) === String(value));
    if (part.range) {
        const [low, high] = part.range;
        const at = value instanceof Date ? value.getTime() : typeof value === 'string' && isNaN(Number(value)) ? Date.parse(value) : Number(value);
        const bound = (edge: unknown) => edge instanceof Date ? edge.getTime() : typeof edge === 'string' && isNaN(Number(edge)) ? Date.parse(edge) : Number(edge);
        return at >= bound(low) && at <= bound(high);
    }
    return true;
};

/**
 * The selection the linked charts share, inside a <ChartLink>: `condition` holds a part per field
 * ({ in: [...] } or { range: [low, high] }), `matches(row)` tests a row against it (to filter a
 * table or a KPI), `select(parts)` sets parts from a control, and `clear()` lets everything go.
 */
export function useChartLink() {
    const link = useContext(LinkStateContext);
    if (!link) throw new Error('useChartLink needs a <ChartLink> around it.');
    const condition = (link.condition?.condition ?? {}) as Record<string, LinkPartValue>;
    const matches = useCallback((row: Row) => Object.entries(condition).every(([field, part]) => meetsPart(row[field], part)),
        [condition]);
    return {
        condition,
        active: Object.values(condition).some(Boolean),
        matches,
        select: (parts: Record<string, LinkPartValue>) => link.select(parts as Parameters<LinkedCharts['select']>[0]),
        clear: link.clear,
    };
}

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
    return <Box ref={ref} sx={{ width: '100%', height }} />;
}
