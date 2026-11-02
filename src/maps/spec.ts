// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The map artifact: a declarative spec saved as `files/<name>.map.json` and drawn by
 * the built-in D3 renderer (MapView). The agent writes it with `write_map`; the user
 * edits it from the map's style panel. See design-docs/70-map-artifact.md.
 *
 * A map is a basemap plus layers. Each layer reads rows from a named data source
 * and places them by region key (country code or name, US state, county FIPS, or a
 * feature property of a custom GeoJSON) or by longitude/latitude. Controls (sliders,
 * selects, checkboxes, ranges) hold params; a control bound to a field filters the
 * layers that read its data, and `{ "param": name }` can stand in for a field or a
 * filter value anywhere.
 */

import type { FieldAnnotation } from './semantics';
import { compileTemplate, templateErrors, type TemplateSpec } from './templates';

export type Row = Record<string, unknown>;

export const PROJECTIONS = [
    'equalEarth', 'naturalEarth', 'mercator', 'equirectangular', 'orthographic', 'albersUsa',
    'albers', 'conicEqualArea', 'azimuthalEqualArea', 'stereographic', 'transverseMercator',
] as const;
export type ProjectionName = typeof PROJECTIONS[number];

export const BASEMAPS = ['world', 'world-detailed', 'us-states', 'us-counties', 'none'] as const;
export type BasemapName = typeof BASEMAPS[number];

export const TILES = ['none', 'light', 'dark', 'streets'] as const;

/** Basemap looks: water, land, borders, place labels, and panels. */
export const MAP_STYLES = ['light', 'muted', 'atlas', 'dark', 'minimal'] as const;
export type MapStyleName = typeof MAP_STYLES[number];
export type TileStyle = typeof TILES[number];

/** Where a layer's region features come from. */
export const GEO_SETS = ['countries', 'us-states', 'us-counties'] as const;
export type GeoSetName = typeof GEO_SETS[number];

export const KEY_TYPES = ['auto', 'iso3', 'iso2', 'iso-numeric', 'country-name', 'us-state', 'fips', 'property'] as const;
export type KeyType = typeof KEY_TYPES[number];

export const LAYER_TYPES = ['regions', 'bubbles', 'points', 'heatmap', 'hexbin', 'flows', 'spikes', 'labels', 'paths', 'shapes', 'vectors'] as const;
export type LayerType = typeof LAYER_TYPES[number];

export const CLASS_METHODS = ['continuous', 'quantile', 'equal', 'jenks', 'threshold', 'log'] as const;
export type ClassMethod = typeof CLASS_METHODS[number];

export const AGGREGATES = ['sum', 'mean', 'median', 'min', 'max', 'count', 'first'] as const;
export type Aggregate = typeof AGGREGATES[number];

export const CONTROL_TYPES = ['slider', 'select', 'checkboxes', 'range', 'search', 'layers', 'details', 'stats'] as const;
export type ControlType = typeof CONTROL_TYPES[number];

export const FILTER_OPS = ['==', '!=', '>', '>=', '<', '<=', 'in', 'between', 'contains'] as const;
export type FilterOp = typeof FILTER_OPS[number];

export type ParamRef = { param: string };
export type FieldRef = string | ParamRef;

export interface ColorEncoding {
    field?: FieldRef;
    /** Bivariate colour (`type: "bivariate"`): the second field, on the legend's vertical axis. */
    field2?: FieldRef;
    /** A constant colour (a CSS colour) when there is no field. */
    value?: string;
    type?: 'quantitative' | 'categorical' | 'diverging' | 'bivariate';
    scheme?: string;
    method?: ClassMethod;
    classes?: number;
    thresholds?: number[];
    domain?: (number | string)[];
    /** Diverging scales: the neutral value (default 0). */
    midpoint?: number;
    reverse?: boolean;
    aggregate?: Aggregate;
    format?: string;
    /** Text around formatted numbers: a currency ("$") or unit (" kt", "%"). */
    prefix?: string;
    suffix?: string;
    title?: string;
}

export interface SizeEncoding {
    field?: FieldRef;
    value?: number;
    /** Largest radius (bubbles) or height (spikes) / width (flows) in pixels. */
    max?: number;
    min?: number;
    aggregate?: Aggregate;
    format?: string;
    prefix?: string;
    suffix?: string;
    title?: string;
}

export interface TooltipField { field: string; label?: string; format?: string }

export interface Filter {
    field: FieldRef;
    op?: FilterOp;
    value?: unknown;
}

/** Where a row sits: a region key or a longitude/latitude pair. */
export interface Location {
    key?: string;
    keyType?: KeyType;
    /** Region features: a built-in set or a workspace GeoJSON/TopoJSON file (`files/…`). */
    geo?: GeoSetName | string;
    /** For custom geo files: the feature property the key matches (default: the feature id or `name`). */
    featureKey?: string;
    lon?: string;
    lat?: string;
    /** Flows: a field naming the place when it is placed by lon/lat (shown at the flow's ends). */
    label?: string;
}

export interface Layer extends Location {
    id: string;
    type: LayerType;
    name?: string;
    data?: string;
    filter?: Filter[];
    visible?: boolean;
    opacity?: number;
    color?: ColorEncoding;
    size?: SizeEncoding;
    stroke?: string;
    /** Flows: the origin and destination of each row. */
    from?: Location;
    to?: Location;
    /** Labels: the text field; other layers: a label drawn beside each mark. */
    text?: string;
    /** Paths: rows sharing `group` form one line, ordered by `order`. */
    group?: string;
    order?: string;
    /** Hexbin radius / heatmap bandwidth, in pixels. */
    radius?: number;
    weight?: string;
    tooltip?: (string | TooltipField)[] | false;
    /** Click a region to zoom to it. */
    zoomOnClick?: boolean;
    /** Show only rows whose `field` matches the rows selected in another layer (`by`: that layer's field, default `field`). */
    selectionFilter?: { layer: string; field: string; by?: string };
    /** Flows: curved arcs (default on flat maps), great circles (default on the globe), or straight lines. */
    curve?: 'arc' | 'great-circle' | 'straight';
    /** Bubbles: `dorling` spreads circles so they do not overlap (a Dorling cartogram). */
    layout?: 'dorling';
    /**
     * Flows and paths: how the direction of travel shows — an arrowhead at the end, a line tapering
     * from origin to destination, or dashes moving along it. Without it a line reads both ways.
     */
    direction?: FlowDirection;
    /** Vectors: the heading in degrees clockwise from north (where the arrow points)… */
    angle?: string;
    /** …or eastward and northward components, the heading and, without a size field, the length. */
    u?: string;
    v?: string;
}

export const FLOW_DIRECTIONS = ['arrow', 'taper', 'animate', 'none'] as const;
export type FlowDirection = typeof FLOW_DIRECTIONS[number];

export interface ControlOption { label?: string; value: unknown }

export interface Control {
    type: ControlType;
    param?: string;
    label?: string;
    /** Bound field: the control filters the layers that read `data` (unless `filter` is false). */
    field?: string;
    data?: string;
    filter?: boolean;
    options?: ControlOption[];
    value?: unknown;
    min?: number;
    max?: number;
    step?: number;
    play?: boolean;
    /** Play speed: milliseconds per step. */
    interval?: number;
    /** details/stats: the layer they describe, and its fields. */
    layer?: string;
    fields?: (string | TooltipField)[];
}

export interface MapView {
    projection?: ProjectionName;
    basemap?: BasemapName;
    tiles?: TileStyle;
    center?: [number, number];
    zoom?: number;
    rotate?: [number, number] | [number, number, number];
    fit?: 'basemap' | 'data';
    graticule?: boolean;
    /** Globe: rotate slowly until the user interacts. */
    spin?: boolean;
    /** The basemap's look (default light). */
    style?: MapStyleName;
    /** A Flint chart theme for text, palettes, and ramps ("none" for Flint's own); default: the app's chart theme. */
    theme?: string;
    /** Names of countries or states on the basemap (default on). */
    labels?: boolean;
}

export type DataSource =
    | { table: string; sql?: string; limit?: number }
    | { sql: string; tables: string[]; limit?: number }
    | { values: Row[] };

export interface MapSpec {
    version: 1;
    title?: string;
    subtitle?: string;
    /** Credit line: data sources, notes. */
    source?: string;
    view: MapView;
    data: Record<string, DataSource>;
    layers: Layer[];
    controls: Control[];
    /** What fields are (Flint semantic annotations): type, unit, display name, diverging midpoint. */
    fields: Record<string, FieldAnnotation>;
}

export interface ParsedMap {
    spec: MapSpec | null;
    errors: string[];
    warnings: string[];
    /** The template the map was written as, if any (the spec is its compiled form). */
    template?: TemplateSpec;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const isParamRef = (value: unknown): value is ParamRef =>
    isRecord(value) && typeof value.param === 'string' && Object.keys(value).length === 1;

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

/** Tables a map reads, for loading and for the manifest. */
export function mapTables(spec: MapSpec): string[] {
    const tables = Object.values(spec.data).flatMap(source =>
        'table' in source ? [source.table] : 'tables' in source ? source.tables : []);
    return Array.from(new Set(tables));
}

/** Workspace geo files a map draws (`files/…`). */
export function mapGeoFiles(spec: MapSpec): string[] {
    const files = spec.layers.flatMap(layer => [layer.geo, layer.from?.geo, layer.to?.geo])
        .filter((geo): geo is string => typeof geo === 'string' && geo.startsWith('files/'));
    return Array.from(new Set(files));
}

/**
 * Parse and check a map spec. Errors stop the map from drawing; warnings point at parts
 * that are ignored. Shapes are kept loose so a hand edit with an unknown key still draws.
 */
export function parseMapSpec(text: string): ParsedMap {
    const errors: string[] = [];
    const warnings: string[] = [];
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        return { spec: null, errors: [`The map file is not valid JSON: ${(error as Error).message}`], warnings };
    }
    if (!isRecord(raw)) return { spec: null, errors: ['The map file must be a JSON object.'], warnings };
    // A template map compiles into the layer form, then is checked like any other map.
    let template: TemplateSpec | undefined;
    if (raw.template !== undefined) {
        const problems = templateErrors(raw);
        if (raw.layers !== undefined) problems.push('Give template (with encoding) or layers, not both.');
        if (problems.length) return { spec: null, errors: problems, warnings };
        template = { template: raw.template, data: raw.data, encoding: raw.encoding, properties: raw.properties } as TemplateSpec;
        const compiled = compileTemplate(template);
        raw = { ...raw, data: compiled.data, layers: compiled.layers, controls: [...compiled.controls, ...(Array.isArray(raw.controls) ? raw.controls : [])],
            view: { ...compiled.view, ...(isRecord(raw.view) ? raw.view : {}) } };
    }
    if (!isRecord(raw)) return { spec: null, errors: ['The map file must be a JSON object.'], warnings };

    const view = isRecord(raw.view) ? raw.view : {};
    if (raw.view !== undefined && !isRecord(raw.view)) errors.push('view must be an object.');
    if (view.projection !== undefined && !oneOf(PROJECTIONS, view.projection)) {
        errors.push(`view.projection must be one of ${PROJECTIONS.join(', ')}.`);
    }
    if (view.basemap !== undefined && !oneOf(BASEMAPS, view.basemap)) errors.push(`view.basemap must be one of ${BASEMAPS.join(', ')}.`);
    if (view.tiles !== undefined && !oneOf(TILES, view.tiles)) errors.push(`view.tiles must be one of ${TILES.join(', ')}.`);
    if (view.style !== undefined && !oneOf(MAP_STYLES, view.style)) errors.push(`view.style must be one of ${MAP_STYLES.join(', ')}.`);
    if (view.theme !== undefined && typeof view.theme !== 'string') errors.push('view.theme must be a chart theme id.');
    const fields: Record<string, FieldAnnotation> = {};
    if (raw.fields !== undefined && !isRecord(raw.fields)) errors.push('fields must map field names to annotations.');
    for (const [name, annotation] of Object.entries(isRecord(raw.fields) ? raw.fields : {})) {
        if (typeof annotation === 'string') fields[name] = { semanticType: annotation };
        else if (isRecord(annotation)) fields[name] = annotation as FieldAnnotation;
        else errors.push(`fields.${name} must be a semantic type or an annotation object.`);
    }
    for (const key of ['center', 'rotate'] as const) {
        const value = view[key];
        if (value !== undefined && !(Array.isArray(value) && value.length >= 2 && value.length <= 3 && value.every(item => typeof item === 'number'))) {
            errors.push(`view.${key} must be [longitude, latitude]${key === 'rotate' ? ' (or [λ, φ, γ])' : ''} numbers.`);
        }
    }

    const data: Record<string, DataSource> = {};
    if (raw.data !== undefined && !isRecord(raw.data)) errors.push('data must be an object of named sources.');
    for (const [name, source] of Object.entries(isRecord(raw.data) ? raw.data : {})) {
        if (!isRecord(source)) { errors.push(`data.${name} must be an object.`); continue; }
        if (typeof source.table === 'string' && source.table) data[name] = source as DataSource;
        else if (typeof source.sql === 'string' && Array.isArray(source.tables) && source.tables.every(table => typeof table === 'string')) data[name] = source as DataSource;
        else if (Array.isArray(source.values)) data[name] = { values: source.values.filter(isRecord) };
        else errors.push(`data.${name} needs a table, sql with tables, or inline values.`);
    }

    const layers: Layer[] = [];
    if (!Array.isArray(raw.layers)) errors.push('layers must be a list.');
    (Array.isArray(raw.layers) ? raw.layers : []).forEach((item, index) => {
        if (!isRecord(item)) { errors.push(`layers[${index}] must be an object.`); return; }
        const where = `layers[${index}]${typeof item.name === 'string' ? ` (${item.name})` : ''}`;
        if (!oneOf(LAYER_TYPES, item.type)) { errors.push(`${where}.type must be one of ${LAYER_TYPES.join(', ')}.`); return; }
        const layer = { ...item, id: typeof item.id === 'string' && item.id ? item.id : `layer${index + 1}` } as Layer;
        if (layer.data !== undefined && !data[layer.data]) errors.push(`${where} reads data "${layer.data}", which is not defined in data.`);
        if (layer.type !== 'shapes' && !layer.data) errors.push(`${where} needs data.`);
        const located = (location: Location | undefined) => !!location && (!!location.key || (!!location.lon && !!location.lat));
        if (layer.type === 'flows') {
            if (!located(layer.from) || !located(layer.to)) errors.push(`${where}: flows need from and to, each a key or lon/lat.`);
        } else if (layer.type === 'regions') {
            if (!layer.key) errors.push(`${where}: regions need key, the field naming each row's region.`);
        } else if (['points', 'heatmap', 'hexbin', 'paths', 'vectors'].includes(layer.type)) {
            if (!layer.lon || !layer.lat) errors.push(`${where}: ${layer.type} need lon and lat fields.`);
            if (layer.type === 'vectors' && !layer.angle && !(layer.u && layer.v)) {
                errors.push(`${where}: vectors need angle (degrees clockwise from north) or u and v (east and north components).`);
            }
        } else if (layer.type === 'shapes') {
            if (typeof layer.geo !== 'string') errors.push(`${where}: shapes need geo, a built-in set or a files/… GeoJSON.`);
        } else if (!located(layer)) {
            errors.push(`${where}: ${layer.type} need key or lon and lat.`);
        }
        if (layer.type === 'labels' && !layer.text) errors.push(`${where}: labels need text, the field to show.`);
        if (layer.type === 'paths' && !layer.group) warnings.push(`${where}: paths without group draw one line through all rows.`);
        for (const location of [layer, layer.from, layer.to]) {
            if (location?.keyType !== undefined && !oneOf(KEY_TYPES, location.keyType)) errors.push(`${where}.keyType must be one of ${KEY_TYPES.join(', ')}.`);
        }
        if (layer.color && !isRecord(layer.color)) {
            layer.color = typeof layer.color === 'string' ? { value: layer.color } : undefined;
        }
        if (layer.color?.method !== undefined && !oneOf(CLASS_METHODS, layer.color.method)) {
            errors.push(`${where}.color.method must be one of ${CLASS_METHODS.join(', ')}.`);
        }
        for (const encoding of [layer.color, layer.size]) {
            if (encoding?.aggregate !== undefined && !oneOf(AGGREGATES, encoding.aggregate)) errors.push(`${where}: aggregate must be one of ${AGGREGATES.join(', ')}.`);
        }
        if (layer.size !== undefined && !isRecord(layer.size)) {
            layer.size = typeof layer.size === 'number' ? { value: layer.size } : undefined;
        }
        if (layer.color?.type === 'bivariate' && (layer.color.field === undefined || layer.color.field2 === undefined)) {
            errors.push(`${where}.color: a bivariate colour needs field and field2.`);
        }
        if (layer.curve !== undefined && !['arc', 'great-circle', 'straight'].includes(layer.curve)) errors.push(`${where}.curve must be arc, great-circle, or straight.`);
        if (layer.layout !== undefined && layer.layout !== 'dorling') errors.push(`${where}.layout must be dorling.`);
        if (layer.direction !== undefined && !oneOf(FLOW_DIRECTIONS, layer.direction)) errors.push(`${where}.direction must be one of ${FLOW_DIRECTIONS.join(', ')}.`);
        if ((layer.u === undefined) !== (layer.v === undefined)) errors.push(`${where}: u and v go together.`);
        if (layer.selectionFilter !== undefined && !(isRecord(layer.selectionFilter) && typeof layer.selectionFilter.layer === 'string'
            && typeof layer.selectionFilter.field === 'string')) errors.push(`${where}.selectionFilter needs layer and field.`);
        if (layer.filter !== undefined && !Array.isArray(layer.filter)) { errors.push(`${where}.filter must be a list.`); layer.filter = []; }
        for (const filter of layer.filter ?? []) {
            if (!isRecord(filter) || !filter.field) errors.push(`${where}: each filter needs a field.`);
            else if (filter.op !== undefined && !oneOf(FILTER_OPS, filter.op)) errors.push(`${where}: filter op must be one of ${FILTER_OPS.join(', ')}.`);
        }
        layers.push(layer);
    });
    const ids = layers.map(layer => layer.id);
    for (const layer of layers) {
        if (layer.selectionFilter?.layer && !ids.includes(layer.selectionFilter.layer)) errors.push(`${layer.id}.selectionFilter names layer "${layer.selectionFilter.layer}", which does not exist.`);
    }
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate) errors.push(`Layer id "${duplicate}" is used twice.`);

    const controls: Control[] = [];
    if (raw.controls !== undefined && !Array.isArray(raw.controls)) errors.push('controls must be a list.');
    (Array.isArray(raw.controls) ? raw.controls : []).forEach((item, index) => {
        if (!isRecord(item) || !oneOf(CONTROL_TYPES, item.type)) {
            errors.push(`controls[${index}].type must be one of ${CONTROL_TYPES.join(', ')}.`);
            return;
        }
        const control = { ...item } as unknown as Control;
        if (['slider', 'select', 'checkboxes', 'range'].includes(control.type)) {
            control.param = control.param || control.field;
            if (!control.param) { errors.push(`controls[${index}] (${control.type}) needs param or field.`); return; }
            if (control.field && control.data && !data[control.data]) errors.push(`controls[${index}] reads data "${control.data}", which is not defined.`);
            if (control.type === 'select' && !control.options && !(control.field && control.data)) {
                errors.push(`controls[${index}] (select) needs options, or field and data to list values from.`);
            }
        }
        if ((control.type === 'details' || control.type === 'stats') && control.layer && !ids.includes(control.layer)) {
            errors.push(`controls[${index}] (${control.type}) names layer "${control.layer}", which does not exist.`);
        }
        controls.push(control);
    });
    const params = new Set(controls.map(control => control.param).filter(Boolean));
    const checkRef = (value: unknown, where: string) => {
        if (isParamRef(value) && !params.has(value.param)) errors.push(`${where} uses param "${value.param}", which no control defines.`);
    };
    layers.forEach(layer => {
        checkRef(layer.color?.field, `${layer.id}.color.field`);
        checkRef(layer.size?.field, `${layer.id}.size.field`);
        (layer.filter ?? []).forEach(filter => { checkRef(filter.field, `${layer.id}.filter`); checkRef(filter.value, `${layer.id}.filter`); });
    });

    if (!layers.length && !errors.length) warnings.push('The map has no layers; it shows only the basemap.');
    const spec: MapSpec = {
        version: 1,
        ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
        ...(typeof raw.subtitle === 'string' ? { subtitle: raw.subtitle } : {}),
        ...(typeof raw.source === 'string' ? { source: raw.source } : {}),
        view: view as MapView,
        data,
        layers,
        controls,
        fields,
    };
    return { spec: errors.length ? null : spec, errors, warnings, ...(template ? { template } : {}) };
}

/** Serialize a spec edited in the style panel, keeping the file readable. */
export const stringifyMapSpec = (spec: unknown): string => `${JSON.stringify(spec, null, 2)}\n`;
