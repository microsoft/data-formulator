// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A map artifact on screen: the D3 map (MapRenderer) with its title, controls, legends,
 * tooltip, details and stats panels, and zoom buttons. Params from controls filter and
 * re-encode the layers; clicking marks selects them (shift adds), double-clicking zooms.
 */

import React, { FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { alpha, createTheme, ThemeProvider, useTheme, type Theme, type ThemeOptions } from '@mui/material/styles';
import { Autocomplete, Box, Checkbox, Chip, FormControlLabel, IconButton, Link, MenuItem, Popover, Select, Slider, TextField,
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
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
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
import { bottomInset, chooseLayout, EDGE, panelTop, ROW_GAP, ROW_PADDING, ROW_WIDTH, rowFit, rowRoom, TOGGLE_SPACE, WIDGET_WIDTH, ZOOM_SPACE,
    type Box as PanelBox, type MapLayout, type Size } from './layout';

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

const DARK_PALETTE = createTheme({ palette: { mode: 'dark' } } as ThemeOptions).palette;

const panelSx = {
    bgcolor: (theme: Theme) => alpha(theme.palette.background.paper, 0.94), border: '1px solid', borderColor: 'divider', borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)', backdropFilter: 'blur(4px)',
} as const;

const labelSx = { fontSize: '0.68rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.3 } as const;
/** Compact inputs, so the widgets read as one quiet group rather than a form. */
const inputSx = { fontSize: '0.74rem', '& .MuiSelect-select, & .MuiInputBase-input': { py: '3px', minHeight: 0 } } as const;
/** Inputs keep to their own width: a slider's end thumbs (12px, centred on the ends) sit inside it, not over the panel's edge. */
const sliderSx = { py: '10px', mx: '6px', width: 'calc(100% - 12px)' } as const;
/** Heights to plan with before a control is laid out (and where nothing is, as in tests). */
const ESTIMATED_HEIGHT: Record<string, number> = { timeline: 64, select: 50, search: 50, slider: 56, range: 56, checkboxes: 110, layers: 90 };
/** A legend's widest, in its own corner. */
const LEGEND_WIDTH = 260;
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
    // Dark styles draw their panels dark. The outer theme's computed light `action` and `text.disabled`
    // inks would otherwise carry over (icon buttons near-black on dark), so take them from a dark palette.
    const theme = useMemo(() => style.mode === 'dark' && outer.palette.mode !== 'dark'
        ? createTheme(outer, { palette: { mode: 'dark', background: { paper: '#22272c', default: style.background },
            text: { primary: '#e8eaec', secondary: '#a7b0b8', disabled: DARK_PALETTE.text.disabled },
            action: DARK_PALETTE.action, divider: 'rgba(255,255,255,0.12)' } }) : outer, [outer, style.mode, style.background]);
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
    const [rendererReady, setRendererReady] = useState(false);
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
    // In the row under the title the box shows its first row of controls, the rest on request: the map stays in view
    // and the controls stay at hand. `rowBottom` is where that first row ends inside the box, measured.
    const [controlsExpanded, setControlsExpanded] = useState(false);
    // Minimised by the viewer: the controls shrink to one line of their values (no labels), each opening the whole
    // control on a click. The map does not refit for it: it stays where it is.
    const [controlsMinimized, setControlsMinimized] = useState(false);
    const [widgetsWidth, setWidgetsWidth] = useState(0);
    const [rowBottom, setRowBottom] = useState<number | null>(null);
    const [widgetsHeight, setWidgetsHeight] = useState(0);
    const legendRef = useRef<HTMLDivElement>(null);
    const legendOverflow = useRealOverflow(legendRef);
    const [legendSize, setLegendSize] = useState<Size>({ width: 0, height: 0 });
    useEffect(() => {
        const element = legendRef.current;
        if (!element) { setLegendSize(current => current.width || current.height ? { width: 0, height: 0 } : current); return; }
        const observer = new ResizeObserver(() => {
            const box = element.getBoundingClientRect();
            const next = { width: Math.ceil(box.width), height: Math.ceil(box.height) };
            setLegendSize(current => current.width === next.width && current.height === next.height ? current : next);
        });
        observer.observe(element);
        return () => observer.disconnect();
    });
    const zoomRef = useRef<HTMLDivElement>(null);

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
        }, {
            points: count => t('map.pointCount', { count }), density: t('map.density'), low: t('map.low'), high: t('map.high'),
            perHexagon: t('map.pointsPerHexagon'), total: field => t('map.total', { field }),
        });
        rendererRef.current = renderer;
        setRendererReady(true);
        return () => { renderer.destroy(); rendererRef.current = null; setRendererReady(false); };
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
    const legends = models.filter(model => model.layer.visible !== false).flatMap(model => {
        const items: { model: LayerModel; legend: LegendModel; key: string }[] = [];
        const dynamic = dynamicLegends[model.layer.id];
        if (model.layer.type === 'hexbin' || model.layer.type === 'heatmap') {
            if (dynamic) items.push({ model, legend: dynamic, key: `${model.layer.id}-density` });
        } else if (model.color.legend) items.push({ model, legend: model.color.legend, key: `${model.layer.id}-color` });
        // Vectors sized and coloured by one column: the colour field says it; the arrow lengths need no second legend.
        const sameAsColor = model.layer.type === 'vectors' && !!model.sizeField && model.sizeField === model.colorField;
        if (model.size.legend && !sameAsColor) items.push({ model, legend: model.size.legend, key: `${model.layer.id}-size` });
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

    // Where the panels go (layout.ts): the controls and timeline share one box in a row under the title, a row along
    // the bottom, or a column at the left; the legend takes a corner or joins that box. Chosen by trying each
    // arrangement on the map when it opens, when its projection, layers, data or controls change, or when the panel
    // is resized a lot; a filter, a frame, a zoom or a selection never moves a panel.
    const pin = spec.view.layout && spec.view.layout !== 'auto' ? spec.view.layout : undefined;
    const [decided, setDecided] = useState<{ key: string; layout: MapLayout; width: number; height: number } | null>(null);
    const layout: MapLayout = decided?.layout ?? { controls: pin ?? 'top', legend: 'bottom-left' };
    const placement = layout.controls;
    const side = placement === 'side';
    // The row's controls in order: the timeline leads (a map that plays over time is driven by it), then the rest.
    const rowOrder: (Control | 'timeline')[] = [...(timeControlIndex >= 0 ? ['timeline' as const] : []), ...columnControls];
    const rowWidths = rowOrder.map(item => item === 'timeline' ? ROW_WIDTH.timeline : ROW_WIDTH[item.type] ?? ROW_WIDTH.select);
    const hasControls = interactive && rowOrder.length > 0;
    const roomFor = (legend: MapLayout['legend']) => rowRoom({ controls: placement, legend }, size.width,
        { header: headerHeight > 0, reserveTopRight, legendWidth: legendSize.width });
    // The legend joins the controls' box when the layout says so: in the column, or in a row while the whole row still fits.
    const legendJoins = interactive && hasLegendCard && hasControls && layout.legend === 'controls'
        && (side || (size.width > 0 && !rowFit([...rowWidths, legendSize.width], roomFor('controls'))));
    // A legend that cannot join (the row grew too long) takes the corner the controls leave free.
    const legendCorner = legendJoins || !hasLegendCard ? null
        : layout.legend === 'controls' ? (placement === 'bottom' ? 'bottom-right' : 'bottom-left')
        : layout.legend === 'top-left' && hasControls && placement !== 'bottom' ? 'bottom-left'
        : layout.legend === 'bottom-left' && hasControls && placement === 'bottom' ? 'bottom-right' : layout.legend;
    // How many controls fit in the first row (null: all of them), how wide they are, and opened, its widest row. The
    // box takes those widths rather than the panel's, and the toggle sits at the end of the first row.
    const room = roomFor(legendCorner ?? 'controls');
    const firstRow = side || !size.width || legendJoins ? null : rowFit(rowWidths, room);
    const compactRow = !!firstRow && !controlsExpanded;
    const moreCount = firstRow ? rowOrder.length - firstRow.count : 0;
    // The toggle says how many controls past the first row are set away from where they start, so a hidden filter is not forgotten.
    const defaultParams = useMemo(() => initialParams(spec.controls, data), [controlsKey, data]);
    // An empty value (null: no filter) is as good as the start.
    const isChanged = (control: Control) => !!control.param && params[control.param] != null
        && JSON.stringify(params[control.param]) !== JSON.stringify(defaultParams[control.param]);
    const changedBeyondRow = firstRow ? rowOrder.slice(firstRow.count).filter(item => item !== 'timeline' && isChanged(item)).length : 0;
    useLayoutEffect(() => {
        const element = widgetsRef.current;
        if (!element) { setRowBottom(null); return; }
        const measure = () => {
            const box = element.getBoundingClientRect();
            setWidgetsHeight(Math.ceil(box.height));
            setWidgetsWidth(Math.ceil(box.width));
            if (!firstRow) { setRowBottom(null); return; }
            // Where the first row ends (its tallest control), to cut the box there.
            const items = Array.from(element.querySelectorAll<HTMLElement>('[data-map-item]')).slice(0, firstRow.count);
            // Nothing laid out (yet): nothing to cut.
            if (!items.length || !items[0].offsetHeight) { setRowBottom(null); return; }
            setRowBottom(Math.ceil(Math.max(...items.map(item => item.offsetTop + item.offsetHeight))));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        element.querySelectorAll('[data-map-item]').forEach(item => observer.observe(item));
        return () => observer.disconnect();
    }, [placement, rowOrder.length, controlsExpanded, firstRow?.count, controlsMinimized]);
    const layoutKey = JSON.stringify([size, fitVersion, headerHeight, columnControls.length, legendCount, timeControlIndex,
        sideControls.filter(control => control.type === 'stats').length, interactive, layout, legendJoins, legendCorner, compactRow, widgetsHeight]);
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container || !interactive) { setObstacles([]); return; }
        // Minimised controls cover less than the map was fitted around: keep the fit, so the map does not move.
        if (controlsMinimized) return;
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


    const selectedModel = selection ? models.find(model => model.layer.id === selection.layerId) : undefined;
    const selectedMarks = selectedModel ? selectedModel.marks.filter(mark => selection!.keys.has(mark.key)) : [];
    // The details card floats over the map: put it in the corner that hides the fewest selected marks.
    const hasStats = sideControls.some(control => control.type === 'stats');
    const detailsTopLeft = panelTop(headerHeight ? measuredHeader : 0);
    const bottomRightTaken = legendCorner === 'bottom-right' || (hasControls && placement === 'bottom');
    // A card in the top-right corner starts below the controls row (which runs the panel's width), not over it.
    const topRight = Math.max(reserveTopRight ? 52 : 12, placement === 'top' && interactive && rowOrder.length && widgetsHeight
        ? detailsTopLeft + widgetsHeight + 8 : 0);
    const detailsCorner = useMemo((): 'top-right' | 'bottom-right' | 'top-left' => {
        const renderer = rendererRef.current;
        if (hasStats || !renderer || !selectedMarks.length) return 'top-right';
        const cardHeight = Math.min(size.height * 0.5, 64 + 20 * Math.min(selectedMarks.length, 10));
        const top = topRight;
        const rects: Record<'top-right' | 'bottom-right' | 'top-left', [number, number, number, number]> = {
            'top-right': [size.width - DETAILS_WIDTH - 30, top, size.width, top + cardHeight],
            'bottom-right': [size.width - DETAILS_WIDTH - 80, size.height - 16 - cardHeight, size.width - 56, size.height],
            'top-left': [0, detailsTopLeft, DETAILS_WIDTH + 30, detailsTopLeft + cardHeight],
        };
        const covered = (rect: [number, number, number, number]) => selectedMarks.filter(mark => {
            const point = mark.at ? renderer.project(mark.at) : null;
            return point && point[0] >= rect[0] && point[0] <= rect[2] && point[1] >= rect[1] && point[1] <= rect[3];
        }).length;
        // The left side holds the widgets and the legend; the bottom right may hold the legend or the end of a bottom row.
        const corners = bottomRightTaken ? ['top-right'] as const : ['top-right', 'bottom-right'] as const;
        return corners.reduce<'top-right' | 'bottom-right' | 'top-left'>(
            (best, corner) => covered(rects[corner]) < covered(rects[best]) ? corner : best, 'top-right');
    // Recomputed when the selection or layout changes, not on every hover.
    }, [selection, size, hasStats, topRight, bottomRightTaken]);

    // Choose the layout: when the map opens, when what it shows changes (its projection, layers, data, controls,
    // legend, title), or when the panel is resized by more than a third; never on a filter, a frame, or a zoom.
    const decisionKey = JSON.stringify([fitVersion, viewProjection(spec.view), spec.view.basemap ?? 'world', spec.view.tiles ?? 'none',
        spec.view.center, spec.view.zoom, spec.view.rotate, spec.view.fit, pin ?? 'auto', controlsKey, hasLegendCard, !!(spec.title || spec.subtitle)]);
    useLayoutEffect(() => {
        const renderer = rendererRef.current;
        const container = containerRef.current;
        if (!interactive || !renderer || !container || !size.width || !size.height) return;
        if (decided && decided.key === decisionKey && Math.abs(size.width - decided.width) <= decided.width / 3
            && Math.abs(size.height - decided.height) <= decided.height / 3) return;
        // Measured where laid out; planned from estimates where not (before the first layout, or without a layout engine).
        const origin = container.getBoundingClientRect();
        const measure = (element: Element | null): Size | null => {
            const box = element?.getBoundingClientRect();
            return box && box.width > 0 && box.height > 0 ? { width: Math.ceil(box.width), height: Math.ceil(box.height) } : null;
        };
        const hasHeader = !!(spec.title || spec.subtitle);
        const header = hasHeader ? measure(headerRef.current) ?? { width: 280, height: spec.title && spec.subtitle ? 44 : 24 } : null;
        const elements = Array.from(widgetsRef.current?.querySelectorAll<HTMLElement>('[data-map-item]') ?? []);
        const items = rowOrder.map((item, index) => ({ width: rowWidths[index],
            height: elements[index]?.offsetHeight || ESTIMATED_HEIGHT[item === 'timeline' ? 'timeline' : item.type] || ESTIMATED_HEIGHT.select }));
        const legend = hasLegendCard ? measure(legendRef.current) ?? { width: 200, height: 80 } : null;
        const zoom = zoomRef.current?.getBoundingClientRect();
        const bottomRight = tiles ? 30 : 16;
        const zoomBox: PanelBox = zoom && zoom.width > 0
            ? [zoom.left - origin.left, zoom.top - origin.top, zoom.right - origin.left, zoom.bottom - origin.top].map(Math.round) as PanelBox
            : [size.width - EDGE - 34, size.height - bottomRight - reserveBottomRight - 170, size.width - EDGE, size.height - bottomRight - reserveBottomRight];
        const scene: Scene = { view: spec.view, basemap, models, selection: null, hidden: {}, highlight: null, interactive, fitVersion };
        const next = chooseLayout({
            width: size.width, height: size.height, header, items, legend, fixed: [zoomBox], creditLine, reserveTopRight, bottomRight, pin,
            timelineOnly: rowOrder.length === 1 && rowOrder[0] === 'timeline',
        }, arrangements => renderer.measureLayouts(scene, size.width, size.height, arrangements));
        setDecided({ key: decisionKey, layout: next, width: size.width, height: size.height });
    // What the layout depends on is in `decisionKey`; the rest (filters, frames) must not move the panels.
    }, [decisionKey, size.width, size.height, rendererReady, interactive]);
    // Until the layout is chosen, the panels wait unseen (so they do not appear in one place, then jump to another).
    const pending = interactive && decided?.key !== decisionKey;

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

    const renderControl = (control: Control) => <ControlWidget control={control} domain={domains[spec.controls.indexOf(control)] ?? []}
        params={params} setParam={setParam} models={models} layerVisibility={layerVisibility}
        onLayerToggle={(id, visible) => setLayerVisibility(current => ({ ...current, [id]: visible }))}
        onLocate={(model, mark) => {
            setSelection({ layerId: model.layer.id, keys: new Set([mark.key]) });
            if (mark.feature) rendererRef.current?.zoomTo(mark.feature);
            else if (mark.at) rendererRef.current?.zoomTo(mark.at);
        }}
        onClearLocate={() => { setSelection(null); rendererRef.current?.reset(); }} />;
    /** A control's current value in a few words, for the minimised controls. */
    const controlSummary = (control: Control): string => {
        const value = control.param ? params[control.param] : undefined;
        const domain = domains[spec.controls.indexOf(control)] ?? [];
        const format = formatter();
        if (control.type === 'select') {
            if (value == null) return t('map.all');
            const option = control.options?.find(item => JSON.stringify(item.value) === JSON.stringify(value));
            return option?.label ?? (switchesField(control, models) ? controlFieldName(control, models, String(value)) : String(value));
        }
        if (control.type === 'slider') { const number = toNumber(value); return number === null ? String(value ?? '') : format(number); }
        if (control.type === 'range') return Array.isArray(value) ? `${format(toNumber(value[0]))} – ${format(toNumber(value[1]))}` : t('map.all');
        if (control.type === 'checkboxes') {
            const options = control.options?.length ? control.options : domain.map(item => ({ value: item, label: String(item) }));
            // No list is no filter: all of them.
            if (!Array.isArray(value)) return t('map.all');
            const chosen = new Set(value.map(String));
            const selected = options.filter(option => chosen.has(String(option.value)));
            if (selected.length === options.length) return t('map.all');
            if (!selected.length) return t('map.none');
            return selected.length <= 2 ? selected.map(option => option.label ?? String(option.value)).join(', ') : t('map.selectedCount', { count: selected.length });
        }
        if (control.type === 'layers') return `${t('map.layers')} ${models.filter(model => model.layer.visible !== false).length}/${models.length}`;
        return t('map.search');
    };

    const legendBody = <>
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
        {spec.source && <SourceNote text={spec.source} />}
        {footer}
    </>;

    return <Box ref={containerRef} data-map-view sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', bgcolor: style.background, color: 'text.primary',
        userSelect: 'none', '& svg': { display: 'block' }, '& [data-map-widgets]:hover + [data-map-minimize]': { opacity: 1 }, ...(pending ? { '& [data-map-obstacle], & [data-map-legends]': { visibility: 'hidden' } } : {}) }}>
        <svg ref={svgRef} role="img" aria-label={spec.title ?? t('map.map')} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />

        {/* Only the title's line shares the top with the host's buttons; the subtitle below them runs the full width. */}
        {interactive && (spec.title || spec.subtitle) && <Box ref={headerRef} data-map-obstacle sx={{ position: 'absolute', top: 12, left: 16, width: 'fit-content',
            maxWidth: 'calc(100% - 32px)', pointerEvents: 'none' }}>
            {spec.title && <Typography component="h2" sx={{ fontSize: '1.05rem', fontWeight: 650, color: titleInk?.primary ?? 'text.primary', lineHeight: 1.3,
                maxWidth: reserveTopRight && size.width ? size.width - 16 - reserveTopRight : undefined,
                fontFamily: titleInk?.font, letterSpacing: '-0.005em', textShadow: `0 0 4px ${style.background}, 0 0 8px ${style.background}` }}>{spec.title}</Typography>}
            {spec.subtitle && <Typography sx={{ fontSize: '0.8rem', color: titleInk?.secondary ?? 'text.secondary', fontFamily: titleInk?.font,
                ...(!spec.title && reserveTopRight && size.width ? { maxWidth: size.width - 16 - reserveTopRight } : {}),
                textShadow: `0 0 4px ${style.background}` }}>{spec.subtitle}</Typography>}
        </Box>}

        {/* Controls and the timeline in one box: beside the map, under the title, or along the bottom (in a row, its first row,
            the rest on request). */}
        {hasControls && <Box ref={widgetsRef} data-map-widgets data-map-obstacle data-map-placement={placement}
            data-map-compact={compactRow ? '' : undefined} data-map-minimized={controlsMinimized ? '' : undefined} sx={{
            position: 'absolute', left: EDGE, ...(placement === 'bottom' ? { bottom: bottomInset(creditLine) } : { top: detailsTopLeft }),
            ...panelSx, py: 1, px: `${ROW_PADDING}px`, display: 'flex', gap: 1, boxSizing: 'border-box',
            // Minimised, it wraps within the room the whole box had (a column's width), so it never covers more than it did.
            ...(controlsMinimized ? { py: 0.5, px: 0.75, gap: 0.5, flexWrap: 'wrap', alignItems: 'center',
                maxWidth: side ? WIDGET_WIDTH : Math.max(0, room + 2 * ROW_PADDING + 2) }
            // Scrolls only when a tall column of controls outgrows the panel, and never sideways.
            : side ? { width: WIDGET_WIDTH, flexDirection: 'column',
                maxHeight: `calc(100% - ${detailsTopLeft + bottomInset(creditLine) + 8 + (legendCorner === 'bottom-left' ? legendSize.height : 0)}px)`,
                overflowY: widgetsOverflow ? 'auto' : 'hidden', overflowX: 'hidden' }
                // At the top, the host's top-right buttons share the first row only when there is no title; at the bottom,
                // the row stops short of the zoom buttons (and a legend beside them).
                : { maxWidth: Math.max(0, room + 2 * ROW_PADDING + 2), flexWrap: 'wrap', alignItems: 'flex-start', columnGap: `${ROW_GAP}px`, rowGap: 1,
                    // Folded to its first row: as wide as that row and its toggle, the rows past it cut off (and out of reach of the keyboard).
                    ...(compactRow ? { width: firstRow!.width + ROW_PADDING + TOGGLE_SPACE + 2, pr: `${TOGGLE_SPACE}px`, overflow: 'hidden',
                        ...(rowBottom !== null ? { maxHeight: rowBottom + 10 } : {}) }
                        : firstRow ? { width: firstRow.openWidth + ROW_PADDING + TOGGLE_SPACE + 2, pr: `${TOGGLE_SPACE}px` } : {}) }),
        }}>
            {controlsMinimized ? <>
                {timeControlIndex >= 0 && <TimeSlider compact above={placement === 'bottom'} control={{ ...spec.controls[timeControlIndex], label: controlLabel(spec.controls[timeControlIndex], models, t('map.show')) }}
                    domain={domains[timeControlIndex] ?? []} value={params[spec.controls[timeControlIndex].param!]} onChange={value => setParam(spec.controls[timeControlIndex].param!, value)} />}
                {columnControls.map(control => <CompactControl key={spec.controls.indexOf(control)} label={controlLabel(control, models, t('map.show')) ?? ''}
                    summary={controlSummary(control)} above={placement === 'bottom'}>{renderControl(control)}</CompactControl>)}
                <Tooltip title={t('map.showControls')}>
                    <IconButton size="small" aria-label={t('map.showControls')} onClick={() => setControlsMinimized(false)} sx={{ p: 0.5 }}>
                        <OpenInFullIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                </Tooltip>
                {legendJoins && <Box data-map-joined sx={{ flexBasis: '100%', borderTop: '1px solid', borderColor: 'divider', pt: 0.75, pb: 0.5, px: 0.5 }}>
                    <Box ref={legendRef} data-map-legends sx={{ width: 'fit-content', maxWidth: LEGEND_WIDTH, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {legendBody}
                    </Box>
                </Box>}
            </> : <>
            {/* First in the row (always in its first row); in the column it follows the controls. */}
            {timeControlIndex >= 0 && <Box data-map-timeline data-map-item sx={{ minWidth: 0, order: side ? 1 : 0, width: side ? undefined : ROW_WIDTH.timeline }}>
                <TimeSlider control={{ ...spec.controls[timeControlIndex], label: controlLabel(spec.controls[timeControlIndex], models, t('map.show')) }} domain={domains[timeControlIndex] ?? []} value={params[spec.controls[timeControlIndex].param!]}
                    onChange={value => setParam(spec.controls[timeControlIndex].param!, value)} />
            </Box>}
            {columnControls.length > 0 && <Box data-map-controls sx={{ display: 'contents' }}>
                {columnControls.map(control => {
                    const hidden = compactRow && rowOrder.indexOf(control) >= firstRow!.count;
                    return <Box key={spec.controls.indexOf(control)} data-map-item aria-hidden={hidden || undefined}
                        sx={{ minWidth: 0, width: side ? undefined : ROW_WIDTH[control.type] ?? ROW_WIDTH.select, ...(hidden ? { visibility: 'hidden' } : {}) }}>
                        {renderControl(control)}
                    </Box>;
                })}
            </Box>}
            {/* The legend joined to the controls: after them in the column, or at the end of a row that fits whole. */}
            {legendJoins && <Box data-map-joined sx={{ minWidth: 0, ...(side ? { order: 2, borderTop: '1px solid', borderColor: 'divider', pt: 1 } : {}) }}>
                {/* As wide as its content, so it measures the same joined or in its corner. */}
                <Box ref={legendRef} data-map-legends sx={{ width: 'fit-content', maxWidth: side ? '100%' : LEGEND_WIDTH, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {legendBody}
                </Box>
            </Box>}
            {/* Right after the first row's last control, level with its inputs, folded or open (the first row is the same
                either way, so the toggle stays put). No outline of its own inside the box's. */}
            {firstRow && <Box component="button" type="button" data-map-more aria-expanded={controlsExpanded} onClick={() => setControlsExpanded(open => !open)}
                sx={{ position: 'absolute', left: ROW_PADDING + firstRow.width + 8, top: rowBottom !== null ? rowBottom - 25 : 24,
                    display: 'flex', alignItems: 'center', gap: 0.25, px: 0.75, py: '3px', border: 0, borderRadius: '6px', bgcolor: 'transparent', cursor: 'pointer',
                    font: 'inherit', fontSize: '0.7rem', fontWeight: 600, color: 'primary.main', whiteSpace: 'nowrap', '&:hover': { bgcolor: 'action.hover' },
                    '&:focus:not(:focus-visible)': { outline: 'none' } }}>
                {controlsExpanded ? t('map.showLess') : t('map.moreCount', { count: moreCount })}
                {!controlsExpanded && changedBeyondRow > 0 && <Box component="span" title={t('map.changedCount', { count: changedBeyondRow })}
                    sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main', ml: 0.25 }} />}
                {controlsExpanded ? <ExpandLessIcon sx={{ fontSize: 15 }} /> : <ExpandMoreIcon sx={{ fontSize: 15 }} />}
            </Box>}
            </>}
        </Box>}
        {/* On the box's top-right corner, shown while the box is hovered (or the button focused), so it takes none of its room. */}
        {hasControls && !controlsMinimized && <Tooltip title={t('map.minimizeControls')}>
            <IconButton data-map-minimize size="small" aria-label={t('map.minimizeControls')} onClick={() => setControlsMinimized(true)}
                sx={{ position: 'absolute', left: EDGE + widgetsWidth - 11, ...(placement === 'bottom' ? { bottom: bottomInset(creditLine) + widgetsHeight - 11 } : { top: detailsTopLeft - 11 }),
                    width: 22, height: 22, p: 0, ...panelSx, borderRadius: '50%', opacity: 0, transition: 'opacity 120ms',
                    '&:hover, &:focus-visible': { opacity: 1, bgcolor: 'background.paper' } }}>
                <CloseFullscreenIcon sx={{ fontSize: 12 }} />
            </IconButton>
        </Tooltip>}

        {/* The legend in its corner (when it does not join the controls' box). */}
        {interactive && legendCorner && <Box ref={legendRef} data-map-legends data-map-obstacle data-map-corner={legendCorner} sx={{ position: 'absolute',
            ...(legendCorner === 'bottom-right' ? { right: EDGE + ZOOM_SPACE, bottom: tiles ? 30 : 16 }
                : legendCorner === 'top-left' ? { left: EDGE, top: detailsTopLeft } : { left: EDGE, bottom: bottomInset(creditLine) }),
            ...panelSx, p: 1, display: 'flex', flexDirection: 'column', gap: 1, maxWidth: side && legendCorner === 'bottom-left' ? WIDGET_WIDTH : LEGEND_WIDTH,
            maxHeight: '40%', overflowY: legendOverflow ? 'auto' : 'hidden', overflowX: 'hidden' }}>
            {legendBody}
        </Box>}

        {interactive && (sideControls.length > 0 || selectedMarks.length > 0) && <SidePanel controls={sideControls} models={models}
            selectedModel={selectedModel} selectedMarks={selectedMarks} top={topRight} onClear={() => setSelection(null)}
            corner={detailsCorner} topLeft={detailsTopLeft} />}

        {interactive && <Box ref={zoomRef} data-map-obstacle sx={{ position: 'absolute', right: 16, bottom: (tiles ? 30 : 16) + reserveBottomRight, display: 'flex', flexDirection: 'column', ...panelSx, overflow: 'hidden' }}>
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
        {interactive && viewProjection(spec.view) === 'orthographic' && size.width > 0 && <Typography sx={{ position: 'absolute', right: EDGE + ZOOM_SPACE,
            // Above a legend that shares the corner.
            bottom: legendCorner === 'bottom-right' ? (tiles ? 30 : 16) + legendSize.height + 6 : 18,
            fontSize: '0.66rem', color: 'text.disabled', pointerEvents: 'none' }}>{t('map.dragToRotate')}</Typography>}

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

/** Long lists (checkboxes, layers) show this many until opened, so one control cannot take over the panel. */
const LIST_PREVIEW = 4;
const CHIP_PREVIEW = 8;
/** The selection's details card: its width, and the fields it shows before "more". */
const DETAILS_WIDTH = 240;
const DETAILS_FIELDS = 6;

/** The map's source or notes under the legend: two lines, the rest on a click (and on hover). */
const SourceNote: FC<{ text: string }> = ({ text }) => {
    const [open, setOpen] = useState(false);
    return <Typography data-map-source title={open ? undefined : text} onClick={() => setOpen(current => !current)}
        sx={{ fontSize: '0.64rem', color: 'text.secondary', cursor: 'pointer', overflowWrap: 'anywhere',
            ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>{text}</Typography>;
};

/** A label that keeps to one line: cut short with the whole of it on hover. */
const ControlLabel: FC<{ label: string; sx?: Record<string, unknown> }> = ({ label, sx }) =>
    <Typography title={label} sx={{ ...labelSx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, ...sx }}>{label}</Typography>;

/** A control's label above its body (as in an app's FilterBar), with a value or action beside the label. */
const Labeled: FC<{ label: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ label, aside, children }) =>
    <Box sx={{ minWidth: 0 }}>
        {(label || aside) && <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mb: 0.25, minWidth: 0 }}>
            <ControlLabel label={label} />{aside && <Box sx={{ flexShrink: 0 }}>{aside}</Box>}
        </Box>}
        {children}
    </Box>;

/**
 * A minimised control: its current value alone (its label on hover), opening the whole control on a click. Above
 * the button for controls along the bottom.
 */
const CompactControl: FC<{ label: string; summary: string; above?: boolean; children: React.ReactNode }> = ({ label, summary, above, children }) => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return <>
        <Tooltip title={label} placement={above ? 'top' : 'bottom'}>
            <Box component="button" type="button" data-map-compact-control aria-label={label ? `${label}: ${summary}` : summary} aria-haspopup="dialog"
                aria-expanded={!!anchor} onClick={event => setAnchor(event.currentTarget)}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.25, maxWidth: 170, px: 0.75, py: '2px', border: '1px solid', borderColor: 'divider',
                    borderRadius: '6px', bgcolor: 'transparent', color: 'text.primary', font: 'inherit', fontSize: '0.72rem', lineHeight: 1.5, cursor: 'pointer',
                    whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', '&:hover': { bgcolor: 'action.hover' } }}>
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</Box>
                <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
            </Box>
        </Tooltip>
        <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: above ? 'top' : 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: above ? 'bottom' : 'top', horizontal: 'left' }}
            slotProps={{ paper: { sx: { p: 1.25, width: 240, mt: above ? -0.5 : 0.5 } } }}>
            {children}
        </Popover>
    </>;
};

/** The first few of a long list, and a way to open (and close) the rest. */
function usePreview<T>(items: T[], limit: number, slack = 2): { shown: T[]; toggle: React.ReactNode } {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    // A little slack: hiding one or two items saves nothing.
    if (items.length <= limit + slack) return { shown: items, toggle: null };
    return {
        shown: open ? items : items.slice(0, limit),
        toggle: <Typography component="button" type="button" data-map-list-toggle aria-expanded={open} onClick={() => setOpen(current => !current)}
            sx={{ fontSize: '0.68rem', color: 'primary.main', border: 0, bgcolor: 'transparent', cursor: 'pointer', p: 0, whiteSpace: 'nowrap' }}>
            {open ? t('map.showLess') : t('map.moreCount', { count: items.length - limit })}</Typography>,
    };
}

const TimeSlider: FC<{ control: Control; domain: unknown[]; value: unknown; onChange: (value: unknown) => void;
    /** Minimised: ▶ and the value, the slider on a click. */
    compact?: boolean; above?: boolean }> = ({ control, domain, value, onChange, compact, above }) => {
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
    const label = control.label ?? control.field ?? control.param ?? '';
    if (discrete.length) {
        const play = control.play !== false && <IconButton size="small" sx={{ p: 0.25, ml: -0.5 }} aria-label={playing ? t('map.pause') : t('map.play')} onClick={() => {
            if (!playing && index >= discrete.length - 1) onChange(discrete[0]);
            setPlaying(current => !current);
        }}>{playing ? <PauseRoundedIcon sx={{ fontSize: 20 }} /> : <PlayArrowRoundedIcon sx={{ fontSize: 20 }} />}</IconButton>;
        const current = <Typography data-map-time-value sx={{ fontSize: '0.8rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{String(value ?? '')}</Typography>;
        const slider = <Slider size="small" aria-label={label} value={index} min={0} max={Math.max(0, discrete.length - 1)} step={1}
            onChange={(_, next) => { setPlaying(false); onChange(discrete[next as number]); }}
            valueLabelDisplay="auto" valueLabelFormat={item => String(discrete[item] ?? '')} sx={{ mx: 1, py: '10px', flex: 1, width: 'auto', minWidth: 60 }} />;
        if (compact) {
            return <Box data-map-timeline sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                {play}
                <CompactControl label={label} summary={String(value ?? '')} above={above}>
                    <Labeled label={label} aside={current}>{slider}</Labeled>
                </CompactControl>
            </Box>;
        }
        // Label and year above, ▶ and the slider below.
        return <Labeled label={label} aside={current}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>{play}{slider}</Box>
        </Labeled>;
    }
    const numeric = <NumericSlider control={control} domain={domain} value={value} onChange={onChange} />;
    return compact ? <CompactControl label={label} summary={formatter()(toNumber(value))} above={above}>{numeric}</CompactControl> : numeric;
};

const NumericSlider: FC<{ control: Control; domain: unknown[]; value: unknown; onChange: (value: unknown) => void }> = ({ control, domain, value, onChange }) => {
    const numbers = domain.map(toNumber).filter((item): item is number => item !== null);
    const min = control.min ?? d3.min(numbers) ?? 0;
    const max = control.max ?? d3.max(numbers) ?? 100;
    const label = control.label ?? control.field ?? control.param ?? '';
    return <Labeled label={label} aside={<Typography sx={{ ...labelSx, color: 'text.primary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatter()(toNumber(value))}</Typography>}>
        <Slider size="small" aria-label={label} value={toNumber(value) ?? min} min={min} max={max} step={control.step ?? ((max - min) / 100 || 1)}
            onChange={(_, next) => onChange(next)} sx={sliderSx} />
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
        const options = control.options?.length ? control.options : domain.map(item => ({ value: item, label: String(item) }));
        return <ChecklistControl label={label} options={options} value={value} onChange={next => setParam(control.param!, next)} />;
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
                step={control.step ?? ((max - min) / 100 || 1)} onChange={(_, next) => setParam(control.param!, next)} sx={sliderSx} />
        </Labeled>;
    }
    if (control.type === 'layers') {
        return <LayersControl label={label || t('map.layers')} models={models} onToggle={onLayerToggle} />;
    }
    if (control.type === 'search') {
        const targets = models.filter(model => !control.layer || model.layer.id === control.layer)
            .flatMap(model => model.marks.filter(mark => mark.label).map(mark => ({ model, mark, label: mark.label })));
        const unique = Array.from(new Map(targets.map(item => [item.label, item])).values()).sort((a, b) => a.label.localeCompare(b.label));
        // Its label above, like the rest.
        return <Labeled label={given.label ?? t('map.search')}>
            <Autocomplete size="small" options={unique} getOptionLabel={option => option.label}
                onChange={(_, option) => { if (option) onLocate(option.model, option.mark); else onClearLocate(); }}
                renderInput={inputProps => <TextField {...inputProps} placeholder={t('map.findPlace')} slotProps={{ htmlInput: { ...inputProps.inputProps, 'aria-label': given.label ?? t('map.findPlace') } }}
                    sx={{ '& .MuiInputBase-root': { fontSize: '0.74rem', py: '0 !important' }, '& .MuiInputBase-input': { py: '3px !important' } }} />} />
        </Labeled>;
    }
    return null;
};

type ListOption = { value: unknown; label?: string };

/** Several values to toggle, as chips: the first few, the rest on request. */
const ChecklistControl: FC<{ label: string; options: ListOption[]; value: unknown; onChange: (next: unknown[]) => void }> = ({ label, options, value, onChange }) => {
    const { t } = useTranslation();
    const selected = new Set((Array.isArray(value) ? value : []).map(String));
    const { shown, toggle } = usePreview(options.slice(0, 60), CHIP_PREVIEW);
    return <Labeled label={label} aside={<Typography component="button" type="button"
        onClick={() => onChange(selected.size === options.length ? [] : options.map(option => option.value))}
        sx={{ fontSize: '0.68rem', color: 'primary.main', border: 0, bgcolor: 'transparent', cursor: 'pointer', p: 0, whiteSpace: 'nowrap' }}>
        {selected.size === options.length ? t('map.none') : t('map.all')}</Typography>}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, maxHeight: 112, overflowY: 'auto' }}>
            {shown.map(option => {
                const on = selected.has(String(option.value));
                const text = option.label ?? String(option.value);
                return <Chip key={String(option.value)} size="small" label={text} title={text} variant={on ? 'filled' : 'outlined'}
                    color={on ? 'primary' : 'default'} aria-pressed={on}
                    onClick={() => onChange(on ? options.filter(item => item.value !== option.value && selected.has(String(item.value))).map(item => item.value)
                        : options.filter(item => selected.has(String(item.value)) || item.value === option.value).map(item => item.value))}
                    sx={{ fontSize: '0.66rem', height: 20, maxWidth: '100%' }} />;
            })}
            {toggle}
        </Box>
    </Labeled>;
};

/** The map's layers to show or hide, one per line: the first few, the rest on request. */
const LayersControl: FC<{ label: string; models: LayerModel[]; onToggle: (id: string, visible: boolean) => void }> = ({ label, models, onToggle }) => {
    const { shown, toggle } = usePreview(models, LIST_PREVIEW);
    return <Labeled label={label}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
            {shown.map(model => {
                const name = model.layer.name ?? model.layer.id;
                return <FormControlLabel key={model.layer.id} title={name}
                    sx={{ ml: -0.5, mr: 0, maxWidth: '100%', minWidth: 0,
                        '& .MuiFormControlLabel-label': { fontSize: '0.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } }}
                    control={<Checkbox size="small" sx={{ p: 0.25 }} checked={model.layer.visible !== false} onChange={event => onToggle(model.layer.id, event.target.checked)} />}
                    label={name} />;
            })}
            {toggle && <Box sx={{ mt: 0.25 }}>{toggle}</Box>}
        </Box>
    </Labeled>;
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
    const placedTop = corner === 'top-left' ? topLeft : corner === 'bottom-right' ? 140 : top;
    return <Box data-map-side data-map-corner={corner} data-map-obstacle={stats.length ? '' : undefined} sx={{ position: 'absolute', ...place, width: DETAILS_WIDTH,
        maxHeight: `calc(100% - ${placedTop + 16}px)`, overflowY: 'auto',
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
    // One place: its first fields, the rest on request, so the card stays small over the map.
    const { shown: shownColumns, toggle: fieldToggle } = usePreview(columns, DETAILS_FIELDS, 1);
    return <Box data-map-details>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, flex: 1, minWidth: 0 }}>{title}</Typography>
            <IconButton size="small" aria-label={t('map.clearSelection')} onClick={onClear} sx={{ p: 0.25, mt: -0.25 }}><CloseIcon sx={{ fontSize: 15 }} /></IconButton>
        </Box>
        {marks.length === 1 ? <>
            {shownColumns.map(field => {
                const label = fieldLabel(model, field);
                const value = String(fieldFormat(model, field)(markValue(model, marks[0], fieldName(field))));
                return <Box key={fieldName(field)} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, py: 0.25, minWidth: 0 }}>
                    <Typography title={label} sx={{ fontSize: '0.74rem', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 48 }}>{label}</Typography>
                    {/* A long value (a note) keeps to two lines; the whole of it on hover. */}
                    <Typography title={value} sx={{ fontSize: '0.74rem', fontVariantNumeric: 'tabular-nums', textAlign: 'right', minWidth: 0, flexShrink: 2,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{value}</Typography>
                </Box>;
            })}
            {fieldToggle && <Box sx={{ mt: 0.25 }}>{fieldToggle}</Box>}
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
