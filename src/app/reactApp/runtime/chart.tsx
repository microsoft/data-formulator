// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** `@df/chart`: Flint charts (as on the DF canvas), raw Vega-Lite, and sparklines. */

import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { assembleVegaLite } from 'flint-chart';

import { appConfig, bridge, errorMessage, reportError, type Row } from './bridge';
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

/** Render a Vega/Vega-Lite spec into a div; finalize the view on change and unmount. */
function useVegaView(ref: React.RefObject<HTMLDivElement | null>, spec: Record<string, unknown> | null) {
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        const element = ref.current;
        if (!element || !spec) return;
        let disposed = false;
        let view: { finalize(): void } | undefined;
        setError(null);
        bridge().chart(element, spec).then(
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
}

/** A chart compiled by Flint from semantic encodings, matching the DF canvas. */
export function FlintChart(props: FlintChartProps) {
    const { query, height = 260 } = props;
    if (query) return <QueryView query={query} height={height}>{rows => <FlintChartBody {...props} data={rows} />}</QueryView>;
    return <FlintChartBody {...props} />;
}

function FlintChartBody(props: FlintChartProps) {
    const { chartType, table, title, subtitle, height = 260 } = props;
    const encodings = useStable(props.encodings);
    const data = useStable(props.data ?? []);
    const semanticTypes = useStable(props.semanticTypes);
    const labels = useStable(props.labels);
    const chartProperties = useStable(props.chartProperties);
    const ref = useRef<HTMLDivElement>(null);
    const width = useWidth(ref);
    const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
    const [buildError, setBuildError] = useState<string | null>(null);

    useEffect(() => {
        if (width <= 0) return;
        try {
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
            const normalized = Object.fromEntries(Object.entries(encodings)
                .map(([channel, encoding]) => [channel, typeof encoding === 'string' ? { field: encoding } : encoding]));
            const target = { width: Math.max(160, width - 80), height };
            const compiled = assembleVegaLite({
                data: { values: data },
                semantic_types: semantic_types as any,
                chart_spec: {
                    chartType,
                    encodings: normalized as any,
                    baseSize: target,
                    canvasSize: { width: Math.max(160, width - 40), height: Math.round(height * 1.4) },
                    ...(title ? { title } : {}),
                    ...(subtitle ? { subtitle } : {}),
                    ...(chartProperties ? { chartProperties } : {}),
                } as any,
                options: { addTooltips: true },
                ...(Object.keys(field_display_names).length ? { field_display_names } : {}),
            } as any) as Record<string, any>;
            // Flint sizes the plot area; fit the whole chart, legend included, to the card.
            // Step-sized discrete axes keep their step and scroll inside the card instead.
            const composite = ['facet', 'repeat', 'concat', 'hconcat', 'vconcat'].some(key => key in compiled);
            if (!composite && (compiled.width === undefined || typeof compiled.width === 'number')) {
                compiled.width = width;
                compiled.autosize = { type: 'fit-x', contains: 'padding' };
            }
            setSpec(compiled);
            setBuildError(null);
        } catch (failure) {
            setSpec(null);
            setBuildError(errorMessage(failure));
            reportError(`FlintChart: ${errorMessage(failure)}`);
        }
    }, [chartType, encodings, data, table, semanticTypes, labels, title, subtitle, height, chartProperties, width]);

    const renderError = useVegaView(ref, spec);
    const error = buildError ?? renderError;
    return (
        <Box sx={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
            {error && <ChartError message={error} height={height} />}
            <Box ref={ref} sx={{ minHeight: error ? 0 : height, display: error ? 'none' : 'block' }} />
        </Box>
    );
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
