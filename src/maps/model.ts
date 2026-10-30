// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Turn a map spec plus loaded rows into drawable marks: filter rows by layer filters and
 * control params, place them by region key or coordinates, aggregate rows that share a
 * place, and build each layer's colour and size scales. Pure: no DOM, no projection.
 */

import * as d3 from 'd3';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

import { countryId, layerGeoSet, regionId, type GeoSet, type RegionFeature } from './geography';
import { aggregate, CATEGORICAL_SCHEMES, colorScale, DIVERGING_SCHEMES, formatter, SEQUENTIAL_SCHEMES, sizeScale, toNumber,
    type ColorScale, type Palette, type SizeScale } from './scales';
import { colorDefaults, resolveField as resolveSemantics, schemeFromFlint, sizeDefaults, type FieldAnnotation, type ResolvedField } from './semantics';
import { isParamRef, type Control, type Filter, type Layer, type Location, type MapSpec, type Row } from './spec';

export type Params = Record<string, unknown>;
export type LonLat = [number, number];

export interface Mark {
    /** Stable within the layer: region id, row index, or group value. */
    key: string;
    rows: Row[];
    label: string;
    regionId?: string;
    feature?: RegionFeature;
    at?: LonLat;
    to?: LonLat;
    line?: LonLat[];
    colorValue?: unknown;
    sizeValue?: unknown;
    text?: string;
    weight?: number;
    /** Flows: the names of the origin and destination, when the data names them. */
    ends?: [string, string];
    /** Vectors: the heading, in degrees clockwise from north. */
    angle?: number;
}

export interface LayerModel {
    layer: Layer;
    marks: Mark[];
    color: ColorScale;
    size: SizeScale;
    colorField: string;
    /** Bivariate colour: the second field. */
    colorField2?: string;
    sizeField: string;
    /** A field's label and value format for tooltips and panels, from its semantics. */
    describe: (field: string) => { label: string; format: (value: unknown) => string };
    /** Rows that could not be placed (unknown region, missing coordinates). */
    unplaced: Row[];
    /** Rows naming a known region these boundaries do not draw (e.g. Antarctica on the world map). */
    undrawn: Row[];
    geoSet?: GeoSet;
}

export const resolveField = (field: unknown, params: Params): string | undefined => {
    if (typeof field === 'string') return field;
    if (isParamRef(field)) {
        const value = params[field.param];
        return typeof value === 'string' ? value : value === undefined || value === null ? undefined : String(value);
    }
    return undefined;
};

const resolveValue = (value: unknown, params: Params): unknown => isParamRef(value) ? params[value.param] : value;

const comparable = (value: unknown): number | string | null => {
    if (value === null || value === undefined || value === '') return null;
    const number = toNumber(value);
    if (number !== null && typeof value !== 'boolean') return number;
    if (typeof value === 'string') {
        const time = Date.parse(value);
        if (/^\d{4}-\d{2}/.test(value) && Number.isFinite(time)) return time;
    }
    return String(value);
};

const same = (a: unknown, b: unknown) => {
    const left = comparable(a);
    const right = comparable(b);
    return left !== null && right !== null && (left === right || String(a) === String(b));
};

export function matchesFilter(row: Row, filter: Filter, params: Params): boolean {
    const field = resolveField(filter.field, params);
    if (!field) return true;
    const value = resolveValue(filter.value, params);
    // An unset param (e.g. "All" in a select) does not filter.
    if (value === undefined || value === null) return true;
    const cell = row[field];
    const op = filter.op ?? (Array.isArray(value) ? 'in' : '==');
    switch (op) {
        case '==': return same(cell, value);
        case '!=': return !same(cell, value);
        case 'in': return Array.isArray(value) && value.some(item => same(cell, item));
        case 'contains': return String(cell ?? '').toLowerCase().includes(String(value).toLowerCase());
        case 'between': {
            if (!Array.isArray(value) || value.length < 2) return true;
            const number = comparable(cell);
            const [low, high] = [comparable(value[0]), comparable(value[1])];
            if (number === null) return false;
            return (low === null || number >= low) && (high === null || number <= high);
        }
        default: {
            const left = comparable(cell);
            const right = comparable(value);
            if (left === null || right === null) return false;
            return op === '>' ? left > right : op === '>=' ? left >= right : op === '<' ? left < right : left <= right;
        }
    }
}

/** Controls bound to a field act as filters on the layers reading their data. */
export function controlFilters(controls: Control[], layer: Layer, rows: Row[]): Filter[] {
    return controls.flatMap(control => {
        if (!control.field || control.filter === false || !control.param) return [];
        if (!['slider', 'select', 'checkboxes', 'range'].includes(control.type)) return [];
        if (control.data ? control.data !== layer.data : !rows.some(row => control.field! in row)) return [];
        const op = control.type === 'checkboxes' ? 'in' : control.type === 'range' ? 'between' : '==';
        return [{ field: control.field, op, value: { param: control.param } } as Filter];
    });
}

/** The values a control offers, from its options or the distinct values of its field. */
export function controlDomain(control: Control, data: Record<string, Row[]>): unknown[] {
    if (control.options?.length) return control.options.map(option => option.value);
    if (!control.field) return [];
    const sources = control.data ? [data[control.data] ?? []] : Object.values(data).filter(rows => rows.some(row => control.field! in row));
    const values = new Map<string, unknown>();
    for (const rows of sources) {
        for (const row of rows) {
            const value = row[control.field];
            if (value === null || value === undefined || value === '') continue;
            if (!values.has(String(value))) values.set(String(value), value);
        }
    }
    const list = Array.from(values.values());
    const numeric = list.every(value => toNumber(value) !== null);
    return list.sort((a, b) => numeric ? (toNumber(a)! - toNumber(b)!) : String(a).localeCompare(String(b), undefined, { numeric: true }));
}

/** Initial params: each control's `value`, else a sensible default for its type. */
export function initialParams(controls: Control[], data: Record<string, Row[]>): Params {
    const params: Params = {};
    for (const control of controls) {
        if (!control.param) continue;
        if (control.value !== undefined) { params[control.param] = control.value; continue; }
        const domain = controlDomain(control, data);
        if (control.type === 'slider') {
            const numbers = domain.map(toNumber).filter((value): value is number => value !== null);
            params[control.param] = control.field ? domain[domain.length - 1] ?? control.max ?? null
                : control.min ?? (numbers.length ? numbers[0] : 0);
        } else if (control.type === 'select') {
            params[control.param] = control.options?.length ? control.options[0].value : null;
        } else if (control.type === 'checkboxes') {
            params[control.param] = domain;
        } else if (control.type === 'range') {
            const numbers = domain.map(toNumber).filter((value): value is number => value !== null);
            params[control.param] = numbers.length ? [control.min ?? d3.min(numbers), control.max ?? d3.max(numbers)] : null;
        }
    }
    return params;
}

const anchors = new WeakMap<object, LonLat>();

/** A label/bubble anchor inside a region: the centroid of its largest polygon. */
export function featureAnchor(feature: Feature): LonLat {
    const cached = anchors.get(feature);
    if (cached) return cached;
    let target: Feature = feature;
    if (feature.geometry?.type === 'MultiPolygon') {
        const polygons = (feature.geometry as MultiPolygon).coordinates.map(coordinates =>
            ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } as Polygon }) as Feature);
        target = polygons.reduce((best, item) => d3.geoArea(item) > d3.geoArea(best) ? item : best, polygons[0]);
    }
    const anchor = d3.geoCentroid(target) as LonLat;
    anchors.set(feature, anchor);
    return anchor;
}

/** A vector's heading (degrees clockwise from north) and, from u/v, its length. */
function vectorHeading(layer: Layer, row: Row): { angle: number; length?: number } | null {
    if (layer.angle) {
        const angle = toNumber(row[layer.angle]);
        return angle === null ? null : { angle: ((angle % 360) + 360) % 360 };
    }
    const u = layer.u ? toNumber(row[layer.u]) : null;
    const v = layer.v ? toNumber(row[layer.v]) : null;
    if (u === null || v === null) return null;
    return { angle: ((Math.atan2(u, v) * 180 / Math.PI) + 360) % 360, length: Math.hypot(u, v) };
}

const coordinate = (row: Row, lon?: string, lat?: string): LonLat | null => {
    if (!lon || !lat) return null;
    const x = toNumber(row[lon]);
    const y = toNumber(row[lat]);
    return x === null || y === null || Math.abs(y) > 90 || Math.abs(x) > 540 ? null : [x, y];
};

type GeoSets = Record<string, GeoSet | undefined>;

/** Where a row sits; `'undrawn'` for a real region the boundary set does not include. */
const locate = (row: Row, location: Location, set: GeoSet | undefined): { at: LonLat; regionId?: string; feature?: RegionFeature } | 'undrawn' | null => {
    if (location.key) {
        if (!set) return null;
        const id = regionId(row[location.key], set, location.keyType);
        const feature = id ? set.byId.get(id) : undefined;
        if (feature) return { at: featureAnchor(feature), regionId: id!, feature };
        return set.name.startsWith('countries') && countryId(row[location.key], location.keyType) ? 'undrawn' : null;
    }
    const at = coordinate(row, location.lon, location.lat);
    return at ? { at } : null;
};

const tooltipName = (layer: Layer, rows: Row[], fallback: string) => {
    // Without a text or key field, the first text-valued tooltip field names the mark.
    const named = Array.isArray(layer.tooltip) ? layer.tooltip.map(item => typeof item === 'string' ? item : item.field)
        .find(name => typeof rows[0]?.[name] === 'string') : undefined;
    const field = layer.text ?? layer.key ?? named;
    const value = field ? rows[0]?.[field] : undefined;
    return value === undefined || value === null || value === '' ? fallback : String(value);
};

/**
 * The geo set name a location joins against (`files/…` names are loaded by the caller).
 */
export const locationGeoSet = (location: Location | undefined, basemap: MapSpec['view']['basemap']) =>
    location?.key ? geoSetName(layerGeoSet(location.geo, location.keyType, basemap ?? 'world'), location.featureKey) : undefined;

/** Custom files are keyed by file and feature property, since layers may join one file on different properties. */
export const geoSetName = (geo: string, featureKey?: string) => geo.startsWith('files/') && featureKey ? `${geo}#${featureKey}` : geo;

/** A param-driven field's label: the select option that chose it. */
function paramFieldLabel(spec: MapSpec, field: unknown, resolved: string): string | undefined {
    if (!isParamRef(field)) return undefined;
    const control = spec.controls.find(item => item.param === field.param);
    const option = control?.options?.find(item => String(item.value) === resolved);
    return option?.label;
}

/** The selection another layer can filter by: the selected layer and its selected marks' rows. */
export interface SelectionRows { layerId: string; rows: Row[] }

const filterRows = (spec: MapSpec, layer: Layer, allRows: Row[], params: Params, selection?: SelectionRows | null) => {
    const filters = [...(layer.filter ?? []), ...controlFilters(spec.controls, layer, allRows)];
    let rows = filters.length ? allRows.filter(row => filters.every(filter => matchesFilter(row, filter, params))) : allRows;
    const link = layer.selectionFilter;
    if (link && selection && selection.layerId === link.layer && selection.rows.length) {
        const values = new Set(selection.rows.map(row => String(row[link.by ?? link.field] ?? '')));
        rows = rows.filter(row => values.has(String(row[link.field] ?? '')));
    }
    return rows;
};

function buildMarks(spec: MapSpec, layer: Layer, rows: Row[], params: Params, geoSets: GeoSets) {
    const basemap = spec.view.basemap ?? 'world';
    const colorField = resolveField(layer.color?.field, params) ?? '';
    const colorField2 = layer.color?.type === 'bivariate' ? resolveField(layer.color.field2, params) ?? '' : '';
    const sizeField = resolveField(layer.size?.field, params) ?? '';
    const colorAggregate = layer.color?.aggregate ?? 'mean';
    const sizeAggregate = layer.size?.aggregate ?? 'sum';
    const unplaced: Row[] = [];
    const undrawn: Row[] = [];
    let marks: Mark[] = [];
    // Bivariate marks carry both values as a pair.
    const colorOf = (groupRows: Row[]) => colorField2
        ? [aggregate(groupRows.map(row => row[colorField]), colorAggregate), aggregate(groupRows.map(row => row[colorField2]), colorAggregate)]
        : aggregate(groupRows.map(row => row[colorField]), colorAggregate);
    const set = layer.type === 'shapes' ? geoSets[geoSetName(layer.geo ?? '', layer.featureKey)] : geoSets[locationGeoSet(layer, basemap) ?? ''];

    const grouped = (placed: { row: Row; at: LonLat; regionId?: string; feature?: RegionFeature }[]) => {
        const groups = d3.group(placed, item => item.regionId ?? `${item.at[0]},${item.at[1]}`);
        return Array.from(groups, ([key, items]) => {
            const groupRows = items.map(item => item.row);
            const first = items[0];
            return {
                key, rows: groupRows, at: first.at, regionId: first.regionId, feature: first.feature,
                label: first.feature?.properties.name ?? tooltipName(layer, groupRows, key),
                colorValue: colorField ? colorOf(groupRows) : undefined,
                sizeValue: sizeField ? aggregate(groupRows.map(row => row[sizeField]), sizeAggregate) : undefined,
                text: layer.text ? String(groupRows[0][layer.text] ?? '') : undefined,
            } as Mark;
        });
    };

    if (layer.type === 'shapes') {
        marks = (set?.features ?? []).map(feature => ({
            key: feature.properties.id, rows: [feature.properties as Row], label: feature.properties.name, regionId: feature.properties.id, feature,
            colorValue: colorField ? feature.properties[colorField] : undefined,
        }));
    } else if (layer.type === 'flows') {
        const fromSet = geoSets[locationGeoSet(layer.from, basemap) ?? ''];
        const toSet = geoSets[locationGeoSet(layer.to, basemap) ?? ''];
        rows.forEach((row, index) => {
            const from = layer.from && locate(row, layer.from, fromSet);
            const to = layer.to && locate(row, layer.to, toSet);
            if (from === 'undrawn' || to === 'undrawn') { undrawn.push(row); return; }
            if (!from || !to) { unplaced.push(row); return; }
            const field = (location?: Location) => location?.label ?? location?.key;
            const name = (location?: Location) => field(location) ? String(row[field(location)!] ?? '') : '';
            // Region keys name places by the region's own name (FRA → France).
            const placeName = (location: Location | undefined, where: { feature?: RegionFeature }) => where.feature?.properties.name ?? name(location);
            marks.push({
                key: String(index), rows: [row], at: from.at, to: to.at,
                ends: [placeName(layer.from, from), placeName(layer.to, to)],
                label: [name(layer.from), name(layer.to)].every(Boolean) ? `${name(layer.from)} → ${name(layer.to)}` : tooltipName(layer, [row], `#${index + 1}`),
                colorValue: colorField ? colorOf([row]) : undefined, sizeValue: sizeField ? row[sizeField] : undefined,
            });
        });
    } else if (layer.type === 'paths') {
        const groups = d3.group(rows, row => layer.group ? String(row[layer.group] ?? '') : '');
        for (const [group, groupRows] of groups) {
            const ordered = layer.order ? groupRows.slice().sort((a, b) => {
                const left = comparable(a[layer.order!]);
                const right = comparable(b[layer.order!]);
                return left === null ? 1 : right === null ? -1 : left < right ? -1 : left > right ? 1 : 0;
            }) : groupRows;
            const line = ordered.map(row => coordinate(row, layer.lon, layer.lat)).filter((point): point is LonLat => !!point);
            if (line.length < 2) { unplaced.push(...groupRows); continue; }
            marks.push({ key: group, rows: ordered, line, at: line[line.length - 1], label: group || layer.name || 'Path',
                colorValue: colorField ? aggregate(ordered.map(row => row[colorField]), colorAggregate === 'mean' && !layer.color?.aggregate ? 'first' : colorAggregate) : undefined,
                sizeValue: sizeField ? aggregate(ordered.map(row => row[sizeField]), sizeAggregate) : undefined });
        }
    } else {
        const placed: { row: Row; at: LonLat; regionId?: string; feature?: RegionFeature }[] = [];
        for (const row of rows) {
            const where = locate(row, layer, set);
            if (where === 'undrawn') undrawn.push(row);
            else if (where) placed.push({ row, ...where });
            else unplaced.push(row);
        }
        if (layer.key) marks = grouped(placed);
        else {
            marks = placed.map((item, index) => ({
                key: String(index), rows: [item.row], at: item.at, label: tooltipName(layer, [item.row], `#${index + 1}`),
                colorValue: colorField ? colorOf([item.row]) : undefined,
                sizeValue: sizeField ? item.row[sizeField] : undefined,
                text: layer.text ? String(item.row[layer.text] ?? '') : undefined,
                weight: layer.weight ? toNumber(item.row[layer.weight]) ?? 0 : 1,
            }));
            if (layer.type === 'vectors') {
                marks = marks.flatMap(mark => {
                    const heading = vectorHeading(layer, mark.rows[0]);
                    if (!heading) { unplaced.push(mark.rows[0]); return []; }
                    return [{ ...mark, angle: heading.angle, sizeValue: sizeField ? mark.sizeValue : heading.length }];
                });
            }
        }
        if (layer.type === 'regions') marks = marks.filter(mark => mark.feature);
    }

    return { marks, unplaced, undrawn, set, colorField, colorField2, sizeField };
}

const frameCache = new WeakMap<Row[], Map<string, { colorValues: unknown[]; sizeValues: unknown[] } | null>>();

/** Frames of a slider (e.g. years) that filters this layer: the colour and size domains span all of them. Cached per rows. */
function frameDomains(spec: MapSpec, layer: Layer, allRows: Row[], data: Record<string, Row[]>, params: Params, geoSets: GeoSets, selection?: SelectionRows | null) {
    const stepped = frameSlider(spec, layer, allRows)?.param;
    const otherParams = Object.entries(params).filter(([name]) => name !== stepped);
    const key = JSON.stringify([layer, spec.controls, spec.view.basemap, otherParams, Object.keys(geoSets),
        selection ? [selection.layerId, selection.rows.length, selection.rows.slice(0, 20)] : null]);
    let cache = frameCache.get(allRows);
    if (!cache) { cache = new Map(); frameCache.set(allRows, cache); }
    if (!cache.has(key)) {
        if (cache.size > 50) cache.clear();
        cache.set(key, computeFrameDomains(spec, layer, allRows, data, params, geoSets, selection));
    }
    return cache.get(key)!;
}

/** The slider whose frames share one colour domain: the first one that filters this layer. */
function frameSlider(spec: MapSpec, layer: Layer, allRows: Row[]) {
    return spec.controls.find(control => control.type === 'slider' && control.field && control.param && control.filter !== false
        && controlFilters([control], layer, allRows).length > 0);
}

function computeFrameDomains(spec: MapSpec, layer: Layer, allRows: Row[], data: Record<string, Row[]>, params: Params, geoSets: GeoSets, selection?: SelectionRows | null) {
    const slider = frameSlider(spec, layer, allRows);
    if (!slider) return null;
    const frames = controlDomain(slider, data);
    if (frames.length < 2) return null;
    const step = Math.max(1, Math.ceil(frames.length / 60));
    const colorValues: unknown[] = [];
    const sizeValues: unknown[] = [];
    for (let index = 0; index < frames.length; index += step) {
        const frameParams = { ...params, [slider.param!]: frames[index] };
        const built = buildMarks(spec, layer, filterRows(spec, layer, allRows, frameParams, selection), frameParams, geoSets);
        for (const mark of built.marks) { colorValues.push(mark.colorValue); sizeValues.push(mark.sizeValue); }
    }
    return { colorValues, sizeValues };
}

export interface BuildContext {
    /** Semantic annotations for the map's fields (the session's table semantics); the spec's `fields` win. */
    annotations?: Record<string, FieldAnnotation>;
    /** The theme's colours and ramps. */
    palette?: Palette;
}

const sample = (rows: Row[], field: string) => {
    const step = Math.max(1, Math.floor(rows.length / 2000));
    const values: unknown[] = [];
    for (let index = 0; index < rows.length; index += step) values.push(rows[index][field]);
    return values;
};

/**
 * Fill in the layer's encodings from what its fields are (Flint semantics): aggregation, diverging
 * midpoint, legend titles, units. Returns the effective layer and the semantic colour scheme.
 */
function withSemantics(spec: MapSpec, layer: Layer, allRows: Row[], params: Params, annotations: Record<string, FieldAnnotation>) {
    const colorField = resolveField(layer.color?.field, params);
    const sizeField = resolveField(layer.size?.field, params);
    let color = layer.color;
    let size = layer.size;
    let resolvedColor: ResolvedField | undefined;
    if (color && colorField && color.type !== 'bivariate' && layer.type !== 'shapes') {
        resolvedColor = resolveSemantics(colorField, sample(allRows, colorField), annotations[colorField]);
        color = colorDefaults({ ...color, title: color.title ?? paramFieldLabel(spec, color.field, colorField) }, resolvedColor);
    }
    if (size && sizeField) {
        const resolved = resolveSemantics(sizeField, sample(allRows, sizeField), annotations[sizeField]);
        size = sizeDefaults({ ...size, title: size.title ?? paramFieldLabel(spec, size.field, sizeField) }, resolved);
    }
    return { layer: color === layer.color && size === layer.size ? layer : { ...layer, color, size }, resolvedColor };
}

/** The semantic scheme as a palette, beneath the theme's. */
function semanticPalette(resolved: ResolvedField | undefined): Palette {
    const name = schemeFromFlint(resolved?.scheme);
    if (!name) return {};
    if (name in DIVERGING_SCHEMES) return { diverging: DIVERGING_SCHEMES[name] };
    if (name in SEQUENTIAL_SCHEMES) return { sequential: SEQUENTIAL_SCHEMES[name] };
    if (name in CATEGORICAL_SCHEMES) return { categorical: CATEGORICAL_SCHEMES[name] };
    return {};
}

const definedOnly = (palette: Palette | undefined): Palette =>
    Object.fromEntries(Object.entries(palette ?? {}).filter(([, value]) => value !== undefined)) as Palette;

export function buildLayer(spec: MapSpec, sourceLayer: Layer, data: Record<string, Row[]>, params: Params, geoSets: GeoSets,
    selection?: SelectionRows | null, context: BuildContext = {}): LayerModel {
    const allRows = sourceLayer.data ? data[sourceLayer.data] ?? [] : [];
    const annotations = { ...context.annotations, ...spec.fields };
    const { layer, resolvedColor } = withSemantics(spec, sourceLayer, allRows, params, annotations);
    const rows = filterRows(spec, layer, allRows, params, selection);
    const { marks, unplaced, undrawn, set, colorField, colorField2, sizeField } = buildMarks(spec, layer, rows, params, geoSets);
    // A time slider keeps one colour scale across frames, so changes over time are comparable.
    const frames = layer.color?.domain || layer.type === 'shapes' ? null : frameDomains(spec, layer, allRows, data, params, geoSets, selection);
    const shape = layer.type === 'spikes' ? 'spike' : layer.type === 'flows' || layer.type === 'paths' ? 'line' : layer.type === 'vectors' ? 'arrow' : 'circle';
    const sizeDefaults = layer.type === 'spikes' ? { min: 0, max: 120, value: 20 }
        : layer.type === 'vectors' ? { min: 4, max: 28, value: 14 }
        : layer.type === 'flows' ? { min: 0.5, max: 10, value: 1.5 }
        : layer.type === 'paths' ? { min: 1, max: 10, value: 2.5 }
        : layer.type === 'points' ? { min: 1, max: 12, value: 3 } : { min: 1.5, max: 32, value: 6 };
    const palette = { ...semanticPalette(resolvedColor), ...definedOnly(context.palette) };
    const described = new Map<string, { label: string; format: (value: unknown) => string }>();
    const describe = (field: string) => {
        let entry = described.get(field);
        if (!entry) {
            const resolved = resolveSemantics(field, sample(allRows, field), annotations[field]);
            const format = resolved.format;
            entry = { label: resolved.label, format: formatter(format?.pattern?.includes('%') ? format.pattern : undefined, format?.prefix, format?.suffix) };
            described.set(field, entry);
        }
        return entry;
    };
    return {
        layer, marks, unplaced, undrawn, geoSet: set, colorField, colorField2, sizeField, describe,
        color: colorScale(layer.color, frames?.colorValues ?? marks.map(mark => mark.colorValue), paramFieldLabel(spec, layer.color?.field, colorField) ?? colorField,
            colorField2 ? paramFieldLabel(spec, layer.color?.field2, colorField2) ?? describe(colorField2).label : undefined, palette),
        size: sizeScale(layer.size, frames?.sizeValues ?? marks.map(mark => mark.sizeValue), paramFieldLabel(spec, layer.size?.field, sizeField) ?? sizeField, shape, sizeDefaults),
    };
}

/** Every geo set the spec needs: the basemap's and each layer's (built-in names and `files/…`). */
export function requiredGeoSets(spec: MapSpec): string[] {
    const basemap = spec.view.basemap ?? 'world';
    const names = new Set<string>();
    const base = basemap === 'world' ? 'countries' : basemap === 'world-detailed' ? 'countries-detailed' : basemap === 'none' ? null : basemap;
    if (base) names.add(base);
    for (const layer of spec.layers) {
        if (layer.type === 'shapes' && layer.geo) names.add(geoSetName(layer.geo, layer.featureKey));
        for (const location of [layer, layer.from, layer.to]) {
            const name = locationGeoSet(location, basemap);
            if (name) names.add(name);
        }
    }
    return Array.from(names);
}
