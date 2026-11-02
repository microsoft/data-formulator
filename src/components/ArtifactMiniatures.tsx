// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Small pictures for the thread's report and app cards, so an authored output reads at a glance:
 * a report is a page (heading, text, its first chart), an app is a window outlining its layout.
 */

import React from 'react';
import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';
import { getCachedChart } from '../app/chartCache';
import { readWorkspaceTextFile } from '../app/workspaceService';
import { isMapFile } from '../icons';

const frameSx = {
    flexShrink: 0, bgcolor: 'background.paper',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.08)',
} as const;

const lines = (widths: number[]) => widths.map((width, index) =>
    <Box key={index} sx={{ height: 3, width: `${width}%`, flexShrink: 0, bgcolor: 'rgba(0,0,0,0.14)', borderRadius: 1 }} />);

/** A tiny page: heading, text lines, and the report's first chart (text lines while there is none yet). */
export const MiniPage: React.FC<{ chartSrc?: string; width?: number }> = ({ chartSrc, width = 40 }) =>
    <Box aria-hidden sx={{ ...frameSx, width, height: Math.round(width * 1.3), borderRadius: '3px', p: '4px',
        display: 'flex', flexDirection: 'column', gap: '3px', overflow: 'hidden' }}>
        <Box sx={{ height: 4, width: '70%', flexShrink: 0, bgcolor: 'rgba(0,0,0,0.35)', borderRadius: 1 }} />
        {lines([100, 85])}
        {chartSrc
            ? <Box component="img" src={chartSrc} alt="" sx={{ display: 'block', width: '100%', height: Math.round(width * 0.42),
                flexShrink: 0, objectFit: 'cover', objectPosition: 'top', borderRadius: '1px' }} />
            : lines([100, 92, 70])}
        {lines([100, 60])}
    </Box>;

// ── App layout outline ──

export type AppCell = 'chart' | 'table';
export type AppRow =
    | { kind: 'filters'; count: number }
    | { kind: 'kpis'; count: number }
    | { kind: 'tabs' }
    | { kind: 'cells'; cells: AppCell[]; main?: boolean };
/** The parts of an app, top to bottom, as far as its source shows them. */
export type AppLayout = AppRow[];

const MAX_ROWS = 4;
const MAX_ITEMS = 4;
const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;

/**
 * An approximate layout from what an app's source mentions — its controls, KPIs, charts and tables —
 * laid out in the usual order: filters, KPIs, then charts beside a table. Works for React and HTML apps.
 */
export function parseAppLayout(source: string): AppLayout {
    const filters = count(source, /<(Select|MultiSelect|Chips|Segmented|RangeSlider|Search|select|input)\b/g);
    const kpis = count(source, /<Kpi\b/g);
    const charts = count(source, /<(FlintChart|VegaChart|canvas|svg)\b|\b(vegaEmbed|Plotly\.newPlot|new Chart)\(/g);
    const tables = count(source, /<(DataTable|table)\b/g);
    const rows: AppRow[] = [];
    if (filters) rows.push({ kind: 'filters', count: filters });
    if (kpis) rows.push({ kind: 'kpis', count: kpis });
    const cells: AppCell[] = [...Array(Math.min(charts, tables ? 1 : 2)).fill('chart'), ...(tables ? ['table' as const] : [])];
    if (cells.length) rows.push({ kind: 'cells', cells, main: charts > 0 && tables > 0 });
    if (charts > 2 || (tables && charts > 1)) rows.push({ kind: 'cells', cells: charts > 2 && !tables ? ['chart', 'chart'] : ['chart'] });
    return rows;
}

const DEFAULT_LAYOUT: AppLayout = [{ kind: 'filters', count: 2 }, { kind: 'cells', cells: ['chart', 'table'], main: true }];

const chartFill = (strength: number) => (theme: Theme) => alpha(theme.palette.secondary.main, strength);
const cellSx = (cell: AppCell) => cell === 'chart'
    ? { bgcolor: chartFill(0.3), borderRadius: '1px' }
    : { borderRadius: '1px', bgcolor: 'rgba(0,0,0,0.05)',
        backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,0.12) 2px 3px)' };

const MiniRow: React.FC<{ row: AppRow }> = ({ row }) => {
    const count = 'count' in row ? Math.min(row.count, MAX_ITEMS) : 0;
    switch (row.kind) {
        case 'filters': return <Box sx={{ display: 'flex', gap: '2px', height: 3, flexShrink: 0 }}>
            {Array.from({ length: count }, (_, index) => <Box key={index} sx={{ width: 7, bgcolor: 'rgba(0,0,0,0.14)', borderRadius: 1 }} />)}
        </Box>;
        case 'tabs': return <Box sx={{ display: 'flex', gap: '3px', height: 2, flexShrink: 0 }}>
            <Box sx={{ width: 6, bgcolor: chartFill(0.6) }} /><Box sx={{ width: 6, bgcolor: 'rgba(0,0,0,0.14)' }} />
        </Box>;
        case 'kpis': return <Box sx={{ display: 'flex', gap: '2px', height: 5, flexShrink: 0 }}>
            {Array.from({ length: count }, (_, index) => <Box key={index} sx={{ flex: 1, bgcolor: 'rgba(0,0,0,0.07)', borderRadius: '1px' }} />)}
        </Box>;
        case 'cells': {
            const cells = row.cells.slice(0, 3);
            return <Box sx={{ display: 'flex', gap: '2px', flex: 1, minHeight: 4 }}>
                {cells.map((cell, index) => <Box key={index} sx={{ flex: row.main && index === 0 && cells.length > 1 ? 2 : 1, ...cellSx(cell) }} />)}
            </Box>;
        }
    }
};

/** A tiny app window: title-bar dots over an outline of the app (or a generic dashboard). */
export const MiniWindow: React.FC<{ width?: number; layout?: AppLayout }> = ({ width = 48, layout }) => {
    const rows = (layout?.length ? layout : DEFAULT_LAYOUT).slice(0, MAX_ROWS);
    return <Box aria-hidden sx={{ ...frameSx, width, height: Math.round(width * 0.78), borderRadius: '4px', overflow: 'hidden',
        display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ height: 7, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '2px', px: '3px', bgcolor: 'rgba(0,0,0,0.05)' }}>
            {[0, 1, 2].map(index => <Box key={index} sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'rgba(0,0,0,0.22)' }} />)}
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '2px', p: '3px' }}>
            <Box sx={{ height: 3, width: '55%', flexShrink: 0, bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1 }} />
            {rows.map((row, index) => <MiniRow key={index} row={row} />)}
        </Box>
    </Box>;
};

// ── Map outline ──

/** The silhouette a map miniature draws, from its spec's basemap and projection. */
export interface MapOutline { d: string; globe: boolean }

const mapOutlines = new Map<string, Promise<MapOutline | null>>();

/** A map's basemap silhouette as an SVG path in a 48×36 box (loaded lazily, cached per basemap and projection). */
function loadMapOutline(source: string): Promise<MapOutline | null> {
    let spec: { view?: { basemap?: string; projection?: string; tiles?: string } };
    try { spec = JSON.parse(source); } catch { return Promise.resolve(null); }
    const view = spec?.view ?? {};
    const key = JSON.stringify([view.basemap, view.projection, view.tiles]);
    let outline = mapOutlines.get(key);
    if (!outline) {
        outline = Promise.all([import('d3'), import('../maps/geography'), import('../maps/MapRenderer')]).then(async ([d3, geography, renderer]) => {
            const basemap = (view.basemap ?? 'world') as never;
            const setName = geography.basemapGeoSet(basemap) ?? 'countries';
            const set = await geography.loadGeoSet(setName === 'countries-detailed' ? 'countries' : setName);
            const projectionName = renderer.viewProjection(view as never);
            const projection = renderer.makeProjection(projectionName);
            const globe = projectionName === 'orthographic';
            const target = set.outline ?? { type: 'FeatureCollection', features: set.features };
            if (globe) projection.rotate([-10, -25, 0]).fitExtent([[2, 2], [46, 34]], { type: 'Sphere' } as never);
            else projection.fitExtent([[2, 2], [46, 34]], target as never);
            return { d: d3.geoPath(projection)(target as never) ?? '', globe };
        }).catch(() => null);
        mapOutlines.set(key, outline);
    }
    return outline;
}

/** A tiny map: the basemap's land in the app tint (a globe draws its sphere too). */
export const MiniMap: React.FC<{ width?: number; outline?: MapOutline | null }> = ({ width = 48, outline }) =>
    <Box aria-hidden data-mini-map sx={{ ...frameSx, width, height: Math.round(width * 0.75), borderRadius: '4px', overflow: 'hidden',
        bgcolor: '#f3f6f9', display: 'flex' }}>
        <svg viewBox="0 0 48 36" width="100%" height="100%">
            {outline?.globe && <circle cx={24} cy={18} r={16} fill="#fff" stroke="rgba(0,0,0,0.12)" strokeWidth={0.5} />}
            {outline?.d && <Box component="path" d={outline.d} sx={{ fill: chartFill(0.45), stroke: '#fff', strokeWidth: 0.25 }} />}
        </svg>
    </Box>;

const MapMiniature: React.FC<{ path: string; version: string; width?: number }> = ({ path, version, width }) => {
    const [outline, setOutline] = React.useState<MapOutline | null | undefined>(undefined);
    React.useEffect(() => {
        let cancelled = false;
        readWorkspaceTextFile(path).then(file => loadMapOutline(file.content)).then(result => { if (!cancelled) setOutline(result); }).catch(() => {});
        return () => { cancelled = true; };
    }, [path, version]);
    return <MiniMap width={width} outline={outline} />;
};

const appLayouts = new Map<string, AppLayout>();

/** An app's window, outlined from its source (one small text read per version of the file, then cached); a map shows its basemap. */
export const AppMiniature: React.FC<{ path: string; version?: string; width?: number }> = ({ path, version = '', width }) =>
    isMapFile(path) ? <MapMiniature path={path} version={version} width={width} /> : <AppWindowMiniature path={path} version={version} width={width} />;

const AppWindowMiniature: React.FC<{ path: string; version: string; width?: number }> = ({ path, version, width }) => {
    const key = `${path}@${version}`;
    const [layout, setLayout] = React.useState(() => appLayouts.get(key));
    React.useEffect(() => {
        if (appLayouts.has(key)) { setLayout(appLayouts.get(key)); return; }
        let cancelled = false;
        readWorkspaceTextFile(path).then(file => {
            const parsed = parseAppLayout(file.content);
            appLayouts.set(key, parsed);
            if (!cancelled) setLayout(parsed);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [key, path]);
    return <MiniWindow layout={layout} width={width} />;
};

/** The best available picture of a chart: its rendered thumbnail, or the stored one. */
export const useChartThumbnail = (chartId: string | undefined): string | undefined => {
    const stored = useSelector((state: DataFormulatorState) => chartId ? state.chartThumbnails?.[chartId] : undefined);
    const cached = chartId ? getCachedChart(chartId) : undefined;
    return cached?.thumbnailDataUrl || stored || cached?.fullPngDataUrl;
};

/** A report's page, showing the thumbnail of the first chart it includes. */
export const ReportMiniature: React.FC<{ chartIds: string[]; width?: number }> = ({ chartIds, width }) =>
    <MiniPage chartSrc={useChartThumbnail(chartIds[0])} width={width} />;
