// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A map artifact on screen: the D3 map (MapRenderer) with its title, controls, legends,
 * tooltip, details and stats panels, and zoom buttons. Params from controls filter and
 * re-encode the layers; clicking marks selects them (shift adds), double-clicking zooms.
 */

import React, { FC, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { alpha, createTheme, ThemeProvider, useTheme, type Theme } from '@mui/material/styles';
import { Autocomplete, Box, Checkbox, Chip, FormControlLabel, IconButton, Link, MenuItem, Select, Slider, TextField,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import CloseIcon from '@mui/icons-material/Close';
import HighlightAltIcon from '@mui/icons-material/HighlightAlt';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import * as d3 from 'd3';
import { useTranslation } from 'react-i18next';

import { COUNTRY_DETAIL_SETS, countryDetail, loadGeoSet, type GeoSet } from './geography';
import { MapLegend } from './MapLegend';
import { MapRenderer, TILE_STYLES, viewProjection, type Hit, type Scene } from './MapRenderer';
import { buildLayer, controlDomain, initialParams, type LayerModel, type Mark, type Params } from './model';
import { formatter, toNumber, type LegendModel } from './scales';
import type { FieldAnnotation } from './semantics';
import { frameBackground, mapStyle, themeInk } from './styles';
import { isParamRef, type Control, type MapSpec, type Row, type TooltipField } from './spec';

const WORLD_BANK_BOUNDARIES_URL = 'https://datacatalog.worldbank.org/search/dataset/0038272/world-bank-official-boundaries';
export interface MapViewProps {
    spec: MapSpec;
    data: Record<string, Row[]>;
    geoSets: Record<string, GeoSet>;
    /** Static (thumbnails): no controls, tooltips, or zoom. */
    interactive?: boolean;
    /** Room at the top right for the host's floating buttons. */
    reserveTopRight?: number;
    /** Extra status (loading, join warnings) under the legends. */
    footer?: React.ReactNode;
    /** Room at the bottom right for the host's floating buttons. */
    reserveBottomRight?: number;
    /** What the tables' fields are (the session's semantic annotations). */
    annotations?: Record<string, FieldAnnotation>;
    /** The chart theme maps follow when the spec names none (the app's default chart theme). */
    defaultTheme?: string;
}

/**
 * Whether a capped panel's content really outgrows it. Panels scroll only then: with `overflow: auto`,
 * sub-pixel heights show a scrollbar that also narrows the panel into a sideways one.
 */
function useRealOverflow(ref: React.RefObject<HTMLElement | null>) {
    const [overflow, setOverflow] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element) { setOverflow(false); return; }
        const check = () => setOverflow(element.scrollHeight - element.clientHeight > 2);
        const observer = new ResizeObserver(check);
        observer.observe(element);
        Array.from(element.children).forEach(child => observer.observe(child));
        check();
        return () => observer.disconnect();
    });
    return overflow;
}

/** The style, with the frame behind the map as the projection shows it (the page around a globe). */
const framedStyle = (view: MapSpec['view']) => {
    const style = mapStyle(view.style);
    return { ...style, background: frameBackground(style, viewProjection(view)) };
};

const panelSx = {
    bgcolor: (theme: Theme) => alpha(theme.palette.background.paper, 0.94), border: '1px solid', borderColor: 'divider', borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)', backdropFilter: 'blur(4px)',
} as const;

const labelSx = { fontSize: '0.68rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.3 } as const;
/** Compact inputs, so the widgets read as one quiet group rather than a form. */
const inputSx = { fontSize: '0.74rem', '& .MuiSelect-select, & .MuiInputBase-input': { py: '3px', minHeight: 0 } } as const;
/** The widget group's width: a column beside the map, or each card in a row under it. */
const WIDGET_WIDTH = 220;
let fitCounter = 0;
const MARK_NOUNS: Partial<Record<string, string>> = { flows: 'map.flows', paths: 'map.paths', points: 'map.points' };

const fieldName = (field: string | TooltipField) => typeof field === 'string' ? field : field.field;
/** A field's label and format: as the spec gives them, else from what the field is (its semantics). */
const fieldLabel = (model: LayerModel, field: string | TooltipField) =>
    typeof field !== 'string' && field.label ? field.label : model.describe(fieldName(field)).label;
const fieldFormat = (model: LayerModel, field: string | TooltipField) =>
    typeof field !== 'string' && field.format ? formatter(field.format) : model.describe(fieldName(field)).format;

/** Whether a select switches which field a layer shows (its options are then field names). */
const switchesField = (control: Control, models: LayerModel[]) => control.type === 'select' && !!control.param && models.some(model =>
    [model.layer.color?.field, model.layer.color?.field2, model.layer.size?.field].some(field => isParamRef(field) && field.param === control.param));
/** A field's readable name, from the layer that reads the control's data. */
const controlFieldName = (control: Control, models: LayerModel[], field: string) =>
    (models.find(model => model.layer.data === control.data) ?? models[0])?.describe(field).label ?? field;
/** A control's heading: as the spec gives it, else "Show" for a measure switch, else its field's readable name. */
const controlLabel = (control: Control, models: LayerModel[], show: string): string | undefined => control.label
    ?? (switchesField(control, models) ? show : control.field ? controlFieldName(control, models, control.field) : control.param);

/** Fields a mark's tooltip shows: the layer's list, else its encoded fields. */
function tooltipFields(model: LayerModel): (string | TooltipField)[] {
    const { layer } = model;
    if (Array.isArray(layer.tooltip)) return layer.tooltip;
    return Array.from(new Set([model.colorField, model.colorField2, model.sizeField, layer.weight].filter((field): field is string => !!field)));
}

const isTimeLike = (control: Control, domain: unknown[]) =>
    control.play || /year|date|time|month|day|period|quarter|week/i.test(control.field ?? control.param ?? '')
    || (domain.length > 3 && domain.every(value => toNumber(value) !== null && Number(value) >= 1800 && Number(value) <= 2200));

/** A world map can be viewed flat or as a globe; the toggle changes the view, not the saved map. */
interface ProjectionToggle { globe: boolean; toggle: () => void }

export const MapView: FC<MapViewProps> = (rawProps) => {
    const outer = useTheme();
    const saved = rawProps.spec.view;
    const [override, setOverride] = useState<'flat' | 'globe' | null>(null);
    // An edit to the saved projection takes over from the viewer's choice.
    useEffect(() => setOverride(null), [saved.projection]);
    const world = (saved.basemap ?? 'world').startsWith('world') && !(saved.tiles && saved.tiles !== 'none') && viewProjection(saved) !== 'albersUsa';
    const savedGlobe = viewProjection(saved) === 'orthographic';
    const globe = override ? override === 'globe' : savedGlobe;
    const spec = useMemo(() => !override || globe === savedGlobe ? rawProps.spec : {
        ...rawProps.spec,
        view: { ...saved, projection: globe ? 'orthographic' as const : 'equalEarth' as const, rotate: undefined, center: undefined, zoom: undefined, spin: undefined },
    }, [rawProps.spec, saved, override, globe, savedGlobe]);
    const projectionToggle = world && rawProps.interactive !== false
        ? { globe, toggle: () => setOverride(globe ? 'flat' : 'globe') } : undefined;
    const props = { ...rawProps, spec, projectionToggle };
    const style = framedStyle(props.spec.view);
    // Dark styles draw their panels dark.
    const theme = useMemo(() => style.mode === 'dark' && outer.palette.mode !== 'dark'
        ? createTheme(outer, { palette: { mode: 'dark', background: { paper: '#22272c', default: style.background },
            text: { primary: '#e8eaec', secondary: '#a7b0b8' }, divider: 'rgba(255,255,255,0.12)' } }) : outer, [outer, style.mode, style.background]);
    return <ThemeProvider theme={theme}><MapViewBody {...props} /></ThemeProvider>;
};

const MapViewBody: FC<MapViewProps & { projectionToggle?: ProjectionToggle }> = ({ spec, data, geoSets: loadedGeoSets, interactive = true, reserveTopRight = 0, footer, reserveBottomRight = 0,
    annotations, defaultTheme, projectionToggle }) => {
    const { t } = useTranslation();
    const style = framedStyle(spec.view);
    const ink = useMemo(() => themeInk(spec.view.theme ?? defaultTheme), [spec.view.theme, defaultTheme]);
    const context = useMemo(() => ({ annotations, palette: { ...ink?.palette, noData: style.noData } }), [annotations, ink, style.noData]);
    // A theme's title ink and font, on light styles (dark styles keep their own light ink).
    const titleInk = style.mode === 'light' ? ink : undefined;
    // Zoomed in, world boundaries swap for finer ones (same ids and set name, so joins and framing hold).
    const [detail, setDetail] = useState<0 | 1 | 2>(0);
    const [detailSets, setDetailSets] = useState<Partial<Record<1 | 2, GeoSet>>>({});
    const usesCountries = Object.keys(loadedGeoSets).some(name => name.startsWith('countries'));
    useEffect(() => {
        if (!usesCountries || detail === 0 || detailSets[detail]) return;
        let cancelled = false;
        loadGeoSet(COUNTRY_DETAIL_SETS[detail]).then(set => { if (!cancelled) setDetailSets(current => ({ ...current, [detail]: set })); }).catch(() => {});
        return () => { cancelled = true; };
    }, [usesCountries, detail, detailSets]);
    const geoSets = useMemo(() => {
        const finest = ([2, 1] as const).find(level => level <= detail && detailSets[level]);
        if (!finest) return loadedGeoSets;
        const swapped = { ...loadedGeoSets };
        for (const name of ['countries', 'countries-detailed']) {
            if (swapped[name] && COUNTRY_DETAIL_SETS.indexOf(name as never) < finest) swapped[name] = { ...detailSets[finest]!, name };
        }
        return swapped;
    }, [loadedGeoSets, detail, detailSets]);
    const basemapName = spec.view.basemap ?? 'world';
    const basemapRef = useRef(basemapName);
    basemapRef.current = basemapName;
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<MapRenderer | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [params, setParams] = useState<Params>(() => initialParams(spec.controls, data));
    const [selection, setSelection] = useState<Scene['selection']>(null);
    const [hidden, setHidden] = useState<Record<string, Set<string>>>({});
    const [highlight, setHighlight] = useState<Scene['highlight']>(null);
    const [hover, setHover] = useState<{ hit: Hit; point: [number, number] } | null>(null);
    const [dynamicLegends, setDynamicLegends] = useState<Record<string, LegendModel | null>>({});
    const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
    const [lasso, setLasso] = useState(false);
    const headerRef = useRef<HTMLDivElement>(null);
    const [measuredHeader, setMeasuredHeader] = useState(0);
    useEffect(() => {
        const element = headerRef.current;
        if (!element) { setMeasuredHeader(0); return; }
        const observer = new ResizeObserver(() => setMeasuredHeader(Math.ceil(element.getBoundingClientRect().height)));
        observer.observe(element);
        return () => observer.disconnect();
    }, [spec.title, spec.subtitle, interactive]);
    const widgetsRef = useRef<HTMLDivElement>(null);
    const widgetsOverflow = useRealOverflow(widgetsRef);
    const legendRef = useRef<HTMLDivElement>(null);
    const legendOverflow = useRealOverflow(legendRef);
    const [legendHeight, setLegendHeight] = useState(0);
    useEffect(() => {
        const element = legendRef.current;
        if (!element) { setLegendHeight(0); return; }
        const observer = new ResizeObserver(() => setLegendHeight(Math.ceil(element.getBoundingClientRect().height)));
        observer.observe(element);
        return () => observer.disconnect();
    });
    // The fitted map's width over height, from the renderer: decides where the widgets go.
    const [mapAspect, setMapAspect] = useState<number | null>(null);

    // New data or controls (a reload, an edit) reset params that no longer apply.
    const controlsKey = JSON.stringify(spec.controls);
    useEffect(() => {
        setParams(previous => {
            const fresh = initialParams(spec.controls, data);
            for (const key of Object.keys(fresh)) {
                const control = spec.controls.find(item => item.param === key);
                if (key in previous && control?.value === undefined) fresh[key] = previous[key];
            }
            return fresh;
        });
    }, [controlsKey, data]);

    const layers = useMemo(() => spec.layers.map(layer => layerVisibility[layer.id] === undefined ? layer : { ...layer, visible: layerVisibility[layer.id] }),
        [spec.layers, layerVisibility]);
    // Layers with a selectionFilter follow the selection in the layer they name.
    const linked = spec.layers.some(layer => layer.selectionFilter);
    const baseModels = useMemo(() => layers.map(layer => buildLayer(spec, layer, data, params, geoSets, null, context)), [spec, layers, data, params, geoSets, context]);
    const selectionRows = useMemo(() => {
        if (!linked || !selection) return null;
        const model = baseModels.find(item => item.layer.id === selection.layerId);
        return model ? { layerId: selection.layerId, rows: model.marks.filter(mark => selection.keys.has(mark.key)).flatMap(mark => mark.rows) } : null;
    }, [linked, selection, baseModels]);
    const models = useMemo(() => selectionRows
        ? layers.map((layer, index) => layer.selectionFilter?.layer === selectionRows.layerId ? buildLayer(spec, layer, data, params, geoSets, selectionRows, context) : baseModels[index])
        : baseModels, [selectionRows, baseModels, layers, spec, data, params, geoSets, context]);
    const basemap = useMemo(() => {
        const name = spec.view.basemap ?? 'world';
        return name === 'none' ? null : geoSets[name === 'world' ? 'countries' : name === 'world-detailed' ? 'countries-detailed' : name] ?? null;
    }, [spec.view.basemap, geoSets]);

    const onHover = useCallback((hit: Hit | null, point: [number, number]) => setHover(hit ? { hit, point } : null), []);
    const onClick = useCallback((hit: Hit | null, event: MouseEvent) => {
        if (!hit) { setSelection(null); return; }
        setSelection(current => {
            if (event.shiftKey && current?.layerId === hit.layerId) {
                const keys = new Set(current.keys);
                if (keys.has(hit.mark.key)) keys.delete(hit.mark.key); else keys.add(hit.mark.key);
                return keys.size ? { layerId: hit.layerId, keys } : null;
            }
            if (current?.layerId === hit.layerId && current.keys.size === 1 && current.keys.has(hit.mark.key)) return null;
            return { layerId: hit.layerId, keys: new Set([hit.mark.key]) };
        });
    }, []);

    useEffect(() => {
        if (!svgRef.current || !canvasRef.current) return;
        const renderer = new MapRenderer(svgRef.current, canvasRef.current, {
            onHover, onClick, onDynamicLegends: setDynamicLegends,
            onLasso: selected => { setSelection(selected); setLasso(false); },
            onScale: worldWidth => setDetail(countryDetail(worldWidth, basemapRef.current)),
            onAspect: setMapAspect,
        }, {
            points: count => t('map.pointCount', { count }), density: t('map.density'), low: t('map.low'), high: t('map.high'),
            perHexagon: t('map.pointsPerHexagon'), total: field => t('map.total', { field }),
        });
        rendererRef.current = renderer;
        return () => { renderer.destroy(); rendererRef.current = null; };
    }, [onHover, onClick]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const observer = new ResizeObserver(entries => {
            const box = entries[0]?.contentRect;
            if (box) setSize({ width: Math.round(box.width), height: Math.round(box.height) });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const domains = useMemo(() => Object.fromEntries(spec.controls.map((control, index) => [index, controlDomain(control, data)])), [spec.controls, data]);
    const timeControlIndex = spec.controls.findIndex((control, index) => control.type === 'slider' && isTimeLike(control, domains[index] ?? []));
    const columnControls = spec.controls.filter((control, index) => index !== timeControlIndex && control.type !== 'details' && control.type !== 'stats');
    const sideControls = spec.controls.filter(control => control.type === 'details' || control.type === 'stats');
    const headerHeight = interactive && (spec.title || spec.subtitle) ? measuredHeader + 4 : 0;
    // The map reframes on new data or layers, not when a filter, frame, or selection changes its marks.
    const fitVersion = useMemo(() => ++fitCounter, [spec.layers, data, loadedGeoSets]);

    // Panels floating over the map, measured when the layout changes (not on every legend update, so
    // the map does not jump); the renderer keeps the centred map clear of them.
    const [obstacles, setObstacles] = useState<[number, number, number, number][]>([]);
    const legendCount = models.filter(model => model.layer.visible !== false && (model.color.legend || model.size.legend
        || model.layer.type === 'hexbin' || model.layer.type === 'heatmap')).length;
    // The controls and timeline share one box, placed where the map leaves room: in a column beside it
    // when the panel is wider than the map, else in a row under the title — whichever lets the map be
    // larger. The legend keeps its own corner, bottom left.
    const placement = useMemo((): 'side' | 'top' => {
        if (!mapAspect || !size.width || !size.height) return 'top';
        const width = size.width - 32;
        const height = size.height - 32 - headerHeight;
        const beside = Math.min((width - WIDGET_WIDTH - 12) / mapAspect, height);
        const under = Math.min(width / mapAspect, height - 64);
        return beside > under ? 'side' : 'top';
    }, [mapAspect, size, headerHeight]);
    const layoutKey = JSON.stringify([size, fitVersion, headerHeight, columnControls.length, legendCount, timeControlIndex,
        sideControls.filter(control => control.type === 'stats').length, interactive, placement]);
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container || !interactive) { setObstacles([]); return; }
        const origin = container.getBoundingClientRect();
        const rects = Array.from(container.querySelectorAll('[data-map-obstacle]')).map(element => {
            const box = element.getBoundingClientRect();
            return [box.left - origin.left, box.top - origin.top, box.right - origin.left, box.bottom - origin.top]
                .map(Math.round) as [number, number, number, number];
        }).filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
        setObstacles(current => JSON.stringify(current) === JSON.stringify(rects) ? current : rects);
    // `layoutKey` captures what moves the panels.
    }, [layoutKey, Object.keys(dynamicLegends).length]);

    useEffect(() => { rendererRef.current?.setSize(size.width, size.height); }, [size]);
    useEffect(() => { rendererRef.current?.setLassoMode(lasso); }, [lasso]);
    // A step of the time slider redraws at once (no transition), so playing steps crisply from frame to frame.
    const timeValue = timeControlIndex >= 0 ? params[spec.controls[timeControlIndex].param!] : undefined;
    const lastTimeValue = useRef(timeValue);
    useEffect(() => {
        const stepped = lastTimeValue.current !== timeValue;
        lastTimeValue.current = timeValue;
        rendererRef.current?.update({ view: spec.view, basemap, models, selection, hidden, highlight, interactive, obstacles, fitVersion }, !stepped);
    }, [spec.view, basemap, models, selection, hidden, highlight, interactive, obstacles, fitVersion, timeValue]);

    // Drop a selection whose marks are gone (filtered out).
    useEffect(() => {
        if (!selection) return;
        const model = models.find(item => item.layer.id === selection.layerId);
        const keys = new Set(model?.marks.map(mark => mark.key) ?? []);
        if (![...selection.keys].some(key => keys.has(key))) setSelection(null);
    }, [models, selection]);

    const setParam = useCallback((name: string, value: unknown) => setParams(current => ({ ...current, [name]: value })), []);

    const legends = models.filter(model => model.layer.visible !== false).flatMap(model => {
        const items: { model: LayerModel; legend: LegendModel; key: string }[] = [];
        const dynamic = dynamicLegends[model.layer.id];
        if (model.layer.type === 'hexbin' || model.layer.type === 'heatmap') {
            if (dynamic) items.push({ model, legend: dynamic, key: `${model.layer.id}-density` });
        } else if (model.color.legend) items.push({ model, legend: model.color.legend, key: `${model.layer.id}-color` });
        if (model.size.legend) items.push({ model, legend: model.size.legend, key: `${model.layer.id}-size` });
        return items;
    });
    // Basemap regions a choropleth leaves empty are grey: say so.
    const noData = !!basemap && models.some(model => model.layer.type === 'regions' && model.layer.visible !== false && model.geoSet === basemap
        && model.marks.length > 0 && model.marks.length < basemap.features.filter(item => item.properties.id !== 'ATA'
            // Albers USA draws only the states, not the territories.
            && !(viewProjection(spec.view) === 'albersUsa' && Number(item.properties.id.slice(0, 2)) >= 60)).length);
    const unplaced = models.reduce((count, model) => count + model.unplaced.length, 0);
    const unplacedSample = Array.from(new Set(models.flatMap(model => model.unplaced.slice(0, 50).map(row => {
        const key = model.layer.key ?? model.layer.from?.key ?? model.layer.lon;
        return key ? String(row[key] ?? '∅') : '';
    })).filter(Boolean))).slice(0, 12);

    const tiles = spec.view.tiles && spec.view.tiles !== 'none' ? TILE_STYLES[spec.view.tiles] : null;
    // World boundaries carry their source and the UN-style disclaimer (World Bank Official Boundaries, CC BY 4.0).
    const worldBoundaries = !!basemap?.name.startsWith('countries') || models.some(model => !!model.geoSet?.name.startsWith('countries'));
    const hasLegendCard = legends.length > 0 || unplaced > 0 || noData || !!footer || !!spec.source;
    const creditLine = interactive && worldBoundaries;
    const side = placement === 'side';

    const selectedModel = selection ? models.find(model => model.layer.id === selection.layerId) : undefined;
    const selectedMarks = selectedModel ? selectedModel.marks.filter(mark => selection!.keys.has(mark.key)) : [];
    // The details card floats over the map: put it in the corner that hides the fewest selected marks.
    const hasStats = sideControls.some(control => control.type === 'stats');
    const detailsTopLeft = 12 + headerHeight + (headerHeight ? 4 : 0);
    const detailsCorner = useMemo((): 'top-right' | 'bottom-right' | 'top-left' => {
        const renderer = rendererRef.current;
        if (hasStats || !renderer || !selectedMarks.length) return 'top-right';
        const cardHeight = Math.min(size.height * 0.5, 64 + 20 * Math.min(selectedMarks.length, 10));
        const top = (reserveTopRight ? 52 : 12);
        const rects: Record<'top-right' | 'bottom-right' | 'top-left', [number, number, number, number]> = {
            'top-right': [size.width - 300, top, size.width, top + cardHeight],
            'bottom-right': [size.width - 350, size.height - 16 - cardHeight, size.width - 56, size.height],
            'top-left': [0, detailsTopLeft, 300, detailsTopLeft + cardHeight],
        };
        const covered = (rect: [number, number, number, number]) => selectedMarks.filter(mark => {
            const point = mark.at ? renderer.project(mark.at) : null;
            return point && point[0] >= rect[0] && point[0] <= rect[2] && point[1] >= rect[1] && point[1] <= rect[3];
        }).length;
        // The left side holds the widgets and the legend.
        return (['top-right', 'bottom-right'] as const).reduce<'top-right' | 'bottom-right' | 'top-left'>(
            (best, corner) => covered(rects[corner]) < covered(rects[best]) ? corner : best, 'top-right');
    // Recomputed when the selection or layout changes, not on every hover.
    }, [selection, size, hasStats, reserveTopRight]);

    const legendHover = (model: LayerModel) => (item: { value?: string; from?: number; to?: number } | null) => {
        if (!item) { setHighlight(null); return; }
        setHighlight({
            layerId: model.layer.id,
            test: (mark: Mark) => {
                if (item.value !== undefined) return String(mark.colorValue) === item.value;
                const value = toNumber(mark.colorValue);
                return value !== null && (item.from === undefined || value >= item.from) && (item.to === undefined || value <= item.to);
            },
        });
    };

    return <Box ref={containerRef} data-map-view sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', bgcolor: style.background, color: 'text.primary',
        userSelect: 'none', '& svg': { display: 'block' } }}>
        <svg ref={svgRef} role="img" aria-label={spec.title ?? t('map.map')} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

        {interactive && (spec.title || spec.subtitle) && <Box ref={headerRef} data-map-obstacle sx={{ position: 'absolute', top: 12, left: 16, width: 'fit-content',
            maxWidth: `calc(100% - ${32 + reserveTopRight}px)`, pointerEvents: 'none' }}>
            {spec.title && <Typography component="h2" sx={{ fontSize: '1.05rem', fontWeight: 650, color: titleInk?.primary ?? 'text.primary', lineHeight: 1.3,
                fontFamily: titleInk?.font, letterSpacing: '-0.005em', textShadow: `0 0 4px ${style.background}, 0 0 8px ${style.background}` }}>{spec.title}</Typography>}
            {spec.subtitle && <Typography sx={{ fontSize: '0.8rem', color: titleInk?.secondary ?? 'text.secondary', fontFamily: titleInk?.font,
                textShadow: `0 0 4px ${style.background}` }}>{spec.subtitle}</Typography>}
        </Box>}

        {/* Controls and the timeline in one box, beside the map or under the title. */}
        {interactive && (columnControls.length > 0 || timeControlIndex >= 0) && <Box ref={widgetsRef} data-map-widgets data-map-obstacle data-map-placement={placement} sx={{
            position: 'absolute', left: 16, top: detailsTopLeft, ...panelSx, p: 1, display: 'flex', gap: 1, boxSizing: 'border-box',
            // Scrolls only when a tall column of controls outgrows the panel, and never sideways.
            ...(side ? { width: WIDGET_WIDTH, flexDirection: 'column', maxHeight: `calc(100% - ${detailsTopLeft + 24 + legendHeight + (creditLine ? 10 : 0)}px)`,
                overflowY: widgetsOverflow ? 'auto' : 'hidden', overflowX: 'hidden' }
                // The host's top-right buttons share the first row only when there is no title.
                : { maxWidth: `calc(100% - ${32 + (headerHeight ? 0 : reserveTopRight)}px)`, flexWrap: 'wrap', alignItems: 'center', columnGap: 2,
                    '& > [data-map-controls] > *': { width: WIDGET_WIDTH - 20 }, '& > [data-map-timeline]': { width: 280 } }),
        }}>
            <InlineLabels.Provider value={!side}>
                {columnControls.length > 0 && <Box data-map-controls sx={{ display: 'contents' }}>
                    {columnControls.map(control => <ControlWidget key={spec.controls.indexOf(control)} control={control} domain={domains[spec.controls.indexOf(control)] ?? []}
                        params={params} setParam={setParam} models={models} layerVisibility={layerVisibility}
                        onLayerToggle={(id, visible) => setLayerVisibility(current => ({ ...current, [id]: visible }))}
                        onLocate={(model, mark) => {
                            setSelection({ layerId: model.layer.id, keys: new Set([mark.key]) });
                            if (mark.feature) rendererRef.current?.zoomTo(mark.feature);
                            else if (mark.at) rendererRef.current?.zoomTo(mark.at);
                        }}
                        onClearLocate={() => { setSelection(null); rendererRef.current?.reset(); }} />)}
                </Box>}
                {timeControlIndex >= 0 && <Box data-map-timeline sx={{ minWidth: 0 }}>
                    <TimeSlider control={{ ...spec.controls[timeControlIndex], label: controlLabel(spec.controls[timeControlIndex], models, t('map.show')) }} domain={domains[timeControlIndex] ?? []} value={params[spec.controls[timeControlIndex].param!]}
                        onChange={value => setParam(spec.controls[timeControlIndex].param!, value)} />
                </Box>}
            </InlineLabels.Provider>
        </Box>}

        {/* The legend keeps its own corner. */}
        {interactive && hasLegendCard && <Box ref={legendRef} data-map-legends data-map-obstacle sx={{ position: 'absolute', left: 16, bottom: creditLine ? 26 : 16, ...panelSx, p: 1,
            display: 'flex', flexDirection: 'column', gap: 1, maxWidth: side ? WIDGET_WIDTH : 260, maxHeight: '40%', overflowY: legendOverflow ? 'auto' : 'hidden', overflowX: 'hidden' }}>
            {legends.map(({ model, legend, key }) => <MapLegend key={key} legend={legend} hidden={hidden[model.layer.id]}
                onHover={legend.kind === 'categories' || legend.kind === 'classes' ? legendHover(model) : undefined}
                onToggle={legend.kind === 'categories' ? value => setHidden(current => {
                    const next = new Set(current[model.layer.id] ?? []);
                    if (next.has(value)) next.delete(value); else next.add(value);
                    return { ...current, [model.layer.id]: next };
                }) : undefined} />)}
            {noData && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: style.noData }} />
                <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>{t('map.noData')}</Typography>
            </Box>}
            {unplaced > 0 && <Tooltip title={unplacedSample.length ? t('map.notMatched', { keys: unplacedSample.join(', ') }) : ''}>
                <Typography data-map-unplaced sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>
                    {t('map.notOnMap', { count: unplaced, formatted: unplaced.toLocaleString() })}
                </Typography>
            </Tooltip>}
            {spec.source && <Typography sx={{ fontSize: '0.64rem', color: 'text.secondary' }}>{spec.source}</Typography>}
            {footer}
        </Box>}

        {interactive && (sideControls.length > 0 || selectedMarks.length > 0) && <SidePanel controls={sideControls} models={models}
            selectedModel={selectedModel} selectedMarks={selectedMarks} top={reserveTopRight ? 52 : 12} onClear={() => setSelection(null)}
            corner={detailsCorner} topLeft={detailsTopLeft} />}

        {interactive && <Box data-map-obstacle sx={{ position: 'absolute', right: 16, bottom: (tiles ? 30 : 16) + reserveBottomRight, display: 'flex', flexDirection: 'column', ...panelSx, overflow: 'hidden' }}>
            <Tooltip title={t('map.zoomIn')} placement="left"><IconButton size="small" aria-label={t('map.zoomIn')} onClick={() => rendererRef.current?.zoomBy(1.6)} sx={{ borderRadius: 0 }}><AddIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
            <Tooltip title={t('map.zoomOut')} placement="left"><IconButton size="small" aria-label={t('map.zoomOut')} onClick={() => rendererRef.current?.zoomBy(1 / 1.6)} sx={{ borderRadius: 0 }}><RemoveIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
            <Tooltip title={t('map.selectAreaHint')} placement="left"><IconButton size="small" aria-label={t('map.selectArea')} aria-pressed={lasso}
                onClick={() => setLasso(value => !value)} sx={{ borderRadius: 0, ...(lasso ? { color: 'primary.main' } : {}) }}><HighlightAltIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
            <Tooltip title={t('map.resetView')} placement="left"><IconButton size="small" aria-label={t('map.resetView')} onClick={() => rendererRef.current?.reset()} sx={{ borderRadius: 0 }}><CenterFocusStrongOutlinedIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
            {projectionToggle && <Tooltip title={t(projectionToggle.globe ? 'map.flatView' : 'map.globeView')} placement="left">
                <IconButton size="small" aria-label={t(projectionToggle.globe ? 'map.flatView' : 'map.globeView')} onClick={projectionToggle.toggle} sx={{ borderRadius: 0 }}>
                    {projectionToggle.globe ? <MapOutlinedIcon sx={{ fontSize: 17 }} /> : <PublicOutlinedIcon sx={{ fontSize: 17 }} />}</IconButton></Tooltip>}
        </Box>}
        {/* The basemap's citation, as a footer line along the bottom (CC BY 4.0 asks for it), with the disclaimer on hover. */}
        {creditLine && <Tooltip title={t('map.boundariesDisclaimer')} placement="top-start">
            <Typography data-map-boundaries sx={{ position: 'absolute', left: 16, bottom: 6, maxWidth: 'calc(100% - 200px)', fontSize: '0.62rem', lineHeight: 1.3,
                color: titleInk?.secondary ?? 'text.secondary', opacity: 0.85, textShadow: `0 0 3px ${style.background}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <Link href={WORLD_BANK_BOUNDARIES_URL} target="_blank" rel="noopener noreferrer" color="inherit" underline="hover">{t('map.boundariesCredit')}</Link>
            </Typography>
        </Tooltip>}
        {tiles && <Typography sx={{ position: 'absolute', right: 8, bottom: 4, fontSize: '0.62rem', color: 'text.secondary', bgcolor: 'rgba(255,255,255,0.7)', px: 0.5 }}>{tiles.attribution}</Typography>}
        {interactive && viewProjection(spec.view) === 'orthographic' && size.width > 0 && <Typography sx={{ position: 'absolute', right: 64, bottom: 18, fontSize: '0.66rem', color: 'text.disabled', pointerEvents: 'none' }}>{t('map.dragToRotate')}</Typography>}

        {interactive && hover && <MapTooltip hover={hover} width={size.width} height={size.height} />}
    </Box>;
};

const MapTooltip: FC<{ hover: { hit: Hit; point: [number, number] }; width: number; height: number }> = ({ hover, width, height }) => {
    const { t } = useTranslation();
    const { hit, point } = hover;
    const fields = tooltipFields(hit.model);
    const rows = hit.mark.rows;
    const aggregated = rows.length > 1;
    const right = point[0] > width - 240;
    const below = point[1] < 120;
    const valueOf = (field: string | TooltipField) => markValue(hit.model, hit.mark, fieldName(field));
    return <Box role="tooltip" data-map-tooltip sx={{ position: 'absolute', left: right ? undefined : point[0] + 14, right: right ? width - point[0] + 14 : undefined,
        top: below ? point[1] + 14 : undefined, bottom: below ? undefined : height - point[1] + 10, pointerEvents: 'none', ...panelSx,
        px: 1.25, py: 0.75, maxWidth: 260, zIndex: 5 }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.primary', mb: fields.length ? 0.25 : 0 }}>{hit.mark.label}</Typography>
        {fields.map(field => <Box key={fieldName(field)} sx={{ display: 'flex', gap: 1.5, justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{fieldLabel(hit.model, field)}</Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{fieldFormat(hit.model, field)(valueOf(field))}</Typography>
        </Box>)}
        {aggregated && <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.25 }}>{t('map.rowCount', { count: rows.length, formatted: rows.length.toLocaleString() })}</Typography>}
    </Box>;
};

/** Whether controls put their label on the same line (the row under the title) or above (the side column). */
const InlineLabels = React.createContext(false);

/** A control's label and body, laid out one way for every control in the box. */
const Labeled: FC<{ label: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ label, aside, children }) => {
    const inline = useContext(InlineLabels);
    if (inline) {
        return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28 }}>
            {label && <Typography sx={{ ...labelSx, whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</Typography>}
            <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
            {aside}
        </Box>;
    }
    return <Box>
        {(label || aside) && <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.25 }}>
            <Typography sx={labelSx}>{label}</Typography>{aside}
        </Box>}
        {children}
    </Box>;
};

const TimeSlider: FC<{ control: Control; domain: unknown[]; value: unknown; onChange: (value: unknown) => void }> = ({ control, domain, value, onChange }) => {
    const { t } = useTranslation();
    const [playing, setPlaying] = useState(false);
    const discrete = control.field ? domain : [];
    const index = Math.max(0, discrete.findIndex(item => String(item) === String(value)));
    const indexRef = useRef(index);
    indexRef.current = index;
    useEffect(() => {
        if (!playing || discrete.length < 2) return;
        const timer = window.setInterval(() => {
            const next = indexRef.current + 1;
            if (next >= discrete.length) { setPlaying(false); return; }
            onChange(discrete[next]);
        }, Math.max(100, control.interval ?? 350));
        return () => window.clearInterval(timer);
    }, [playing, discrete, control.interval, onChange]);
    const inline = useContext(InlineLabels);
    const label = control.label ?? control.field ?? control.param ?? '';
    if (discrete.length) {
        const play = control.play !== false && <IconButton size="small" sx={{ p: 0.25, ml: -0.5 }} aria-label={playing ? t('map.pause') : t('map.play')} onClick={() => {
            if (!playing && index >= discrete.length - 1) onChange(discrete[0]);
            setPlaying(current => !current);
        }}>{playing ? <PauseRoundedIcon sx={{ fontSize: 20 }} /> : <PlayArrowRoundedIcon sx={{ fontSize: 20 }} />}</IconButton>;
        const current = <Typography data-map-time-value sx={{ fontSize: '0.8rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{String(value ?? '')}</Typography>;
        const slider = <Slider size="small" aria-label={label} value={index} min={0} max={Math.max(0, discrete.length - 1)} step={1}
            onChange={(_, next) => { setPlaying(false); onChange(discrete[next as number]); }}
            valueLabelDisplay="auto" valueLabelFormat={item => String(discrete[item] ?? '')} sx={{ mx: 1, py: '10px', flex: 1, width: 'auto', minWidth: 0 }} />;
        // One line in the row (▶ Year 2020 ——), label and year above the slider in the column.
        if (inline) {
            return <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 28 }}>
                {play}
                <Typography sx={{ ...labelSx, whiteSpace: 'nowrap' }}>{label}</Typography>
                {current}
                {slider}
            </Box>;
        }
        return <Labeled label={label} aside={current}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>{play}{slider}</Box>
        </Labeled>;
    }
    return <NumericSlider control={control} domain={domain} value={value} onChange={onChange} />;
};

const NumericSlider: FC<{ control: Control; domain: unknown[]; value: unknown; onChange: (value: unknown) => void }> = ({ control, domain, value, onChange }) => {
    const numbers = domain.map(toNumber).filter((item): item is number => item !== null);
    const min = control.min ?? d3.min(numbers) ?? 0;
    const max = control.max ?? d3.max(numbers) ?? 100;
    const label = control.label ?? control.field ?? control.param ?? '';
    return <Labeled label={label} aside={<Typography sx={{ ...labelSx, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{formatter()(toNumber(value))}</Typography>}>
        <Slider size="small" aria-label={label} value={toNumber(value) ?? min} min={min} max={max} step={control.step ?? ((max - min) / 100 || 1)}
            onChange={(_, next) => onChange(next)} sx={{ py: '10px' }} />
    </Labeled>;
};

const ControlWidget: FC<{
    control: Control; domain: unknown[]; params: Params; setParam: (name: string, value: unknown) => void;
    models: LayerModel[]; layerVisibility: Record<string, boolean>;
    onLayerToggle: (id: string, visible: boolean) => void;
    onLocate: (model: LayerModel, mark: Mark) => void;
    /** The search was cleared: back to the whole map. */
    onClearLocate: () => void;
}> = ({ control: given, domain, params, setParam, models, onLayerToggle, onLocate, onClearLocate }) => {
    const { t } = useTranslation();
    const inline = useContext(InlineLabels);
    const label = controlLabel(given, models, t('map.show')) ?? '';
    const control = label ? { ...given, label } : given;
    const value = control.param ? params[control.param] : undefined;
    if (control.type === 'slider') {
        if (control.field && domain.length && domain.every(item => toNumber(item) === null)) {
            return <TimeSlider control={{ ...control, play: control.play ?? false }} domain={domain} value={value} onChange={next => setParam(control.param!, next)} />;
        }
        return <NumericSlider control={control} domain={domain} value={value} onChange={next => setParam(control.param!, next)} />;
    }
    if (control.type === 'select') {
        const fields = switchesField(control, models);
        const options = (control.options?.length ? control.options : domain.map(item => ({ value: item, label: String(item) })))
            .map(option => fields && option.label === undefined ? { ...option, label: controlFieldName(control, models, String(option.value)) } : option);
        const all = !control.options?.length;
        const labels = options.map(option => option.label ?? String(option.value));
        if (!all && options.length <= 3 && labels.join('').length <= 30) {
            return <Labeled label={label}>
                <ToggleButtonGroup exclusive size="small" fullWidth value={JSON.stringify(value ?? null)}
                    onChange={(_, next) => { if (next !== null) setParam(control.param!, JSON.parse(next)); }}
                    sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontSize: '0.7rem', py: '2px', px: 0.75, lineHeight: 1.4 } }}>
                    {options.map(option => <ToggleButton key={JSON.stringify(option.value)} value={JSON.stringify(option.value ?? null)}>{option.label ?? String(option.value)}</ToggleButton>)}
                </ToggleButtonGroup>
            </Labeled>;
        }
        return <Labeled label={label}>
            <Select size="small" fullWidth value={JSON.stringify(value ?? null)} onChange={event => setParam(control.param!, JSON.parse(event.target.value))}
                inputProps={{ 'aria-label': label }} sx={inputSx}>
                {all && <MenuItem value="null" sx={{ fontSize: '0.76rem' }}>{t('map.all')}</MenuItem>}
                {options.map(option => <MenuItem key={JSON.stringify(option.value)} value={JSON.stringify(option.value ?? null)} sx={{ fontSize: '0.76rem' }}>
                    {option.label ?? String(option.value)}</MenuItem>)}
            </Select>
        </Labeled>;
    }
    if (control.type === 'checkboxes') {
        const selected = new Set((Array.isArray(value) ? value : []).map(String));
        const options = control.options?.length ? control.options : domain.map(item => ({ value: item, label: String(item) }));
        return <Labeled label={label} aside={<Typography component="button" type="button"
            onClick={() => setParam(control.param!, selected.size === options.length ? [] : options.map(option => option.value))}
            sx={{ fontSize: '0.68rem', color: 'primary.main', border: 0, bgcolor: 'transparent', cursor: 'pointer', p: 0, whiteSpace: 'nowrap' }}>
            {selected.size === options.length ? t('map.none') : t('map.all')}</Typography>}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 112, overflowY: 'auto' }}>
                {options.slice(0, 60).map(option => {
                    const on = selected.has(String(option.value));
                    return <Chip key={String(option.value)} size="small" label={option.label ?? String(option.value)} variant={on ? 'filled' : 'outlined'}
                        color={on ? 'primary' : 'default'} aria-pressed={on}
                        onClick={() => setParam(control.param!, on ? options.filter(item => item.value !== option.value && selected.has(String(item.value))).map(item => item.value)
                            : options.filter(item => selected.has(String(item.value)) || item.value === option.value).map(item => item.value))}
                        sx={{ fontSize: '0.66rem', height: 20 }} />;
                })}
            </Box>
        </Labeled>;
    }
    if (control.type === 'range') {
        const numbers = domain.map(toNumber).filter((item): item is number => item !== null);
        const min = control.min ?? d3.min(numbers) ?? 0;
        const max = control.max ?? d3.max(numbers) ?? 100;
        const current = Array.isArray(value) ? value.map(item => toNumber(item) ?? min) : [min, max];
        const format = formatter();
        return <Labeled label={label} aside={<Typography sx={{ ...labelSx, color: 'text.primary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {format(current[0])} – {format(current[1])}</Typography>}>
            <Slider size="small" getAriaLabel={index => t(index ? 'map.maximum' : 'map.minimum', { label })} value={current} min={min} max={max}
                step={control.step ?? ((max - min) / 100 || 1)} onChange={(_, next) => setParam(control.param!, next)} sx={{ py: '10px' }} />
        </Labeled>;
    }
    if (control.type === 'layers') {
        return <Labeled label={label || t('map.layers')}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1 }}>
                {models.map(model => <FormControlLabel key={model.layer.id} sx={{ ml: -0.5, mr: 0, '& .MuiFormControlLabel-label': { fontSize: '0.74rem' } }}
                    control={<Checkbox size="small" sx={{ p: 0.25 }} checked={model.layer.visible !== false} onChange={event => onLayerToggle(model.layer.id, event.target.checked)} />}
                    label={model.layer.name ?? model.layer.id} />)}
            </Box>
        </Labeled>;
    }
    if (control.type === 'search') {
        const targets = models.filter(model => !control.layer || model.layer.id === control.layer)
            .flatMap(model => model.marks.filter(mark => mark.label).map(mark => ({ model, mark, label: mark.label })));
        const unique = Array.from(new Map(targets.map(item => [item.label, item])).values()).sort((a, b) => a.label.localeCompare(b.label));
        // The placeholder names the search on one line; in the column it gets a label like the rest.
        return <Labeled label={inline ? '' : given.label ?? t('map.search')}>
            <Autocomplete size="small" options={unique} getOptionLabel={option => option.label}
                onChange={(_, option) => { if (option) onLocate(option.model, option.mark); else onClearLocate(); }}
                renderInput={inputProps => <TextField {...inputProps} placeholder={t('map.findPlace')} slotProps={{ htmlInput: { ...inputProps.inputProps, 'aria-label': given.label ?? t('map.findPlace') } }}
                    sx={{ '& .MuiInputBase-root': { fontSize: '0.74rem', py: '0 !important' }, '& .MuiInputBase-input': { py: '3px !important' } }} />} />
        </Labeled>;
    }
    return null;
};

const SidePanel: FC<{
    controls: Control[]; models: LayerModel[]; selectedModel?: LayerModel; selectedMarks: Mark[]; top: number; onClear: () => void;
    corner?: 'top-right' | 'bottom-right' | 'top-left';
    topLeft?: number;
}> = ({ controls, models, selectedModel, selectedMarks, top, onClear, corner = 'top-right', topLeft = 64 }) => {
    const details = controls.find(control => control.type === 'details');
    const stats = controls.filter(control => control.type === 'stats');
    const showDetails = selectedMarks.length > 0 && (!details?.layer || details.layer === selectedModel?.layer.id);
    if (!showDetails && !stats.length) return null;
    // Stats stay put, so the map avoids them; details come and go with the selection and float over it.
    const place = corner === 'top-left' ? { left: 16, top: topLeft } : corner === 'bottom-right' ? { right: 64, bottom: 16 } : { right: 16, top };
    return <Box data-map-side data-map-corner={corner} data-map-obstacle={stats.length ? '' : undefined} sx={{ position: 'absolute', ...place, width: 270, maxHeight: 'calc(100% - 140px)', overflowY: 'auto',
        ...panelSx, p: 1.25, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {showDetails && selectedModel && <DetailsCard control={details} model={selectedModel} marks={selectedMarks} onClear={onClear} />}
        {stats.map((control, index) => {
            const model = models.find(item => item.layer.id === control.layer) ?? models.find(item => item.layer.visible !== false && item.marks.length);
            return model ? <StatsCard key={index} control={control} model={model} selection={selectedModel === model ? selectedMarks : []} /> : null;
        })}
    </Box>;
};

/** A mark's value for a field: its aggregated colour or size value, else the first row's. */
const markValue = (model: LayerModel, mark: Mark, name: string) => {
    const color = mark.colorValue;
    if (Array.isArray(color)) {
        if (name === model.colorField) return color[0];
        if (name === model.colorField2) return color[1];
    } else if (name === model.colorField && color !== undefined) return color;
    if (name === model.sizeField && mark.sizeValue !== undefined) return mark.sizeValue;
    return mark.rows[0]?.[name];
};

const DetailsCard: FC<{ control?: Control; model: LayerModel; marks: Mark[]; onClear: () => void }> = ({ control, model, marks, onClear }) => {
    const { t } = useTranslation();
    const fields = control?.fields ?? tooltipFields(model);
    const all = fields.length ? fields : Object.keys(marks[0]?.rows[0] ?? {}).slice(0, 6);
    // The place's name heads each row already; a column repeating it is dropped.
    const columns = all.filter(field => !marks.every(mark => String(markValue(model, mark, fieldName(field)) ?? '') === mark.label))
        // With several places, a column that is the same for all (the slider's year) says nothing.
        .filter(field => marks.length < 2 || new Set(marks.map(mark => String(markValue(model, mark, fieldName(field))))).size > 1);
    // Many places: the largest first, a handful shown, so the card stays small over the map.
    const ROWS = 8;
    const first = columns[0] ? fieldName(columns[0]) : '';
    const ranked = first ? marks.slice().sort((a, b) => (toNumber(markValue(model, b, first)) ?? -Infinity) - (toNumber(markValue(model, a, first)) ?? -Infinity)) : marks;
    const title = marks.length === 1 ? marks[0].label : t('map.selectedCount', { count: marks.length });
    return <Box data-map-details>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, flex: 1, minWidth: 0 }}>{title}</Typography>
            <IconButton size="small" aria-label={t('map.clearSelection')} onClick={onClear} sx={{ p: 0.25, mt: -0.25 }}><CloseIcon sx={{ fontSize: 15 }} /></IconButton>
        </Box>
        {marks.length === 1 ? <>
            {columns.map(field => <Box key={fieldName(field)} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }}>
                <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }}>{fieldLabel(model, field)}</Typography>
                <Typography sx={{ fontSize: '0.74rem', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fieldFormat(model, field)(markValue(model, marks[0], fieldName(field)))}</Typography>
            </Box>)}
            {marks[0].rows.length > 1 && <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.25 }}>{t('map.rowCount', { count: marks[0].rows.length, formatted: marks[0].rows.length.toLocaleString() })}</Typography>}
        </> : <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', mt: 0.5, '& td:not(:first-of-type), & th:not(:first-of-type)': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
            '& td, & th': { fontSize: '0.7rem', py: 0.25, pr: 0.75, textAlign: 'left',
            borderBottom: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' },
            '& th': { color: 'text.secondary', fontWeight: 600 } }}>
            <thead><tr><th />{columns.slice(0, 2).map(field => <th key={fieldName(field)}>{fieldLabel(model, field)}</th>)}</tr></thead>
            <tbody>{ranked.slice(0, ROWS).map(mark => <tr key={mark.key}><td>{mark.label}</td>
                {columns.slice(0, 2).map(field => <td key={fieldName(field)}>{fieldFormat(model, field)(markValue(model, mark, fieldName(field)))}</td>)}</tr>)}</tbody>
        </Box>}
        {marks.length > ROWS && <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled', mt: 0.5 }}>{t('map.moreCount', { count: marks.length - ROWS })}</Typography>}
    </Box>;
};

/** A summary of a layer's visible marks (or the selection): count, total/average, and the top marks. */
const StatsCard: FC<{ control: Control; model: LayerModel; selection: Mark[] }> = ({ control, model, selection }) => {
    const { t } = useTranslation();
    const marks = selection.length ? selection : model.marks;
    const field = (control.fields?.[0] && fieldName(control.fields[0])) || model.colorField || model.sizeField;
    const format = control.fields?.[0] ? fieldFormat(model, control.fields[0]) : field ? model.describe(field).format : formatter();
    const label = field ? model.describe(field).label : '';
    const total = !!field && (model.layer.size?.field === field || field === model.sizeField || model.layer.color?.aggregate === 'sum');
    const valueOf = (mark: Mark) => toNumber(field === model.colorField ? mark.colorValue : field === model.sizeField ? mark.sizeValue : mark.rows[0]?.[field]);
    const numbers = marks.map(valueOf).filter((value): value is number => value !== null);
    const top = marks.filter(mark => valueOf(mark) !== null).sort((a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0)).slice(0, 5);
    return <Box data-map-stats>
        <Typography sx={{ ...labelSx, mb: 0.5 }}>{control.label ?? `${model.layer.name ?? t('map.summary')}${selection.length ? ` · ${t('map.selection')}` : ''}`}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: field ? 0.75 : 0 }}>
            <Box><Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>{t(MARK_NOUNS[model.layer.type] ?? 'map.places')}</Typography>
                <Typography sx={{ fontSize: '1rem', fontWeight: 600 }}>{marks.length.toLocaleString()}</Typography></Box>
            {field && numbers.length > 0 && <Box><Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>{total ? t('map.total', { field: label }) : t('map.average', { field: label })}</Typography>
                <Typography sx={{ fontSize: '1rem', fontWeight: 600 }}>{format(total ? d3.sum(numbers) : d3.mean(numbers))}</Typography></Box>}
        </Box>
        {field && top.map(mark => <Box key={mark.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <Typography sx={{ fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mark.label}</Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{format(valueOf(mark))}</Typography>
        </Box>)}
    </Box>;
};

export default MapView;
