// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Map templates: a named kind of map (choropleth, bubble map, flow map…) bound to columns, with a
 * few properties, compiled into the layer spec the renderer draws. Like Flint's chart templates:
 * the agent picks a template and binds channels; the look comes from the style and theme, and
 * everything else from the fields' semantics. Multi-layer maps keep using `layers` directly.
 *
 *   { "template": "choropleth", "data": {"table": "indicators"},
 *     "encoding": {"region": "country", "color": "life_expectancy", "time": "year"},
 *     "properties": {"classes": 5} }
 *
 * The agent decides where marks go (region, lat/lon, …). For the choice channels it may offer several
 * columns — `"color": ["life_expectancy", "gdp_per_capita"]` (the first is shown) or
 * `{"field": …, "options": […]}` — and people pick among them: measures get a switch on the map,
 * and the Style panel offers only those columns (with None for optional channels such as time).
 */

import * as d3 from 'd3';

import type { Control, DataSource, FieldRef, FlowDirection, Layer, LayerType, MapView } from './spec';

export const TEMPLATES = ['choropleth', 'bubbles', 'points', 'density', 'spikes', 'flows', 'tracks', 'bivariate', 'cartogram', 'vectors'] as const;
export type TemplateName = typeof TEMPLATES[number];

export const CHANNELS = ['region', 'lat', 'lon', 'color', 'color2', 'size', 'label', 'time', 'filter', 'weight',
    'origin', 'destination', 'originLat', 'originLon', 'destinationLat', 'destinationLon', 'group', 'order', 'angle', 'u', 'v'] as const;
export type Channel = typeof CHANNELS[number];

/** A column, a list of columns to choose among (the first is shown), or a choice with no column shown (`field` absent). */
export type ChannelValue = string | string[] | { field?: string | null; options: string[] };
export type Encoding = Partial<Record<Channel, ChannelValue>> & { tooltip?: string[] };

/** Channels people choose among the agent's options; the others (where marks go) the agent fixes. */
export const CHOICE_CHANNELS: Channel[] = ['color', 'color2', 'size', 'weight', 'label', 'time', 'filter'];
/** Measures that get a switch on the map when offered several columns. */
const SWITCH_CHANNELS: Channel[] = ['color', 'size', 'color2'];

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** A channel's shown column and the columns offered for it. */
export function channelBinding(value: unknown): { field?: string; options: string[] } {
    if (isText(value)) return { field: value, options: [value] };
    if (Array.isArray(value)) {
        const options = value.filter(isText);
        return { field: options[0], options };
    }
    if (isRecord(value)) {
        const options = Array.isArray(value.options) ? value.options.filter(isText) : [];
        const field = isText(value.field) ? value.field : undefined;
        return { field, options: field && !options.includes(field) ? [field, ...options] : options };
    }
    return { options: [] };
}

/** The column a channel shows, if any. */
export const boundField = (encoding: Encoding, channel: Channel): string | undefined => channelBinding(encoding[channel]).field;

/** The compact way to write a binding: a column, a list led by the shown column, or `{field, options}`. */
export function bindChannel(options: string[], field?: string): ChannelValue | undefined {
    if (!options.length) return field || undefined;
    if (field && field === options[0]) return options.length === 1 ? field : options;
    return field ? { field, options } : { options };
}

export interface TemplateProperties {
    /** Boundaries regions join: world, US states or counties, or a workspace GeoJSON (`files/…`). */
    geography?: string;
    /** The feature property a custom geography's regions are keyed by. */
    featureKey?: string;
    keyType?: Layer['keyType'];
    classes?: number;
    method?: NonNullable<Layer['color']>['method'];
    scheme?: string;
    /** One colour (any CSS colour) for every mark when no colour column is bound; else the theme's. */
    color?: string;
    /** Largest bubble radius, spike height, or flow width. */
    sizeMax?: number;
    opacity?: number;
    /** Density: hexagon bins or a smooth heatmap; their radius. */
    density?: 'hexbin' | 'heatmap';
    radius?: number;
    curve?: Layer['curve'];
    /** Flows and tracks: arrowheads, a taper from origin to destination, moving dashes, or none. */
    direction?: FlowDirection;

    /** Interaction kit. */
    search?: boolean;
    details?: boolean;
    stats?: boolean;
    play?: boolean;
}

export interface TemplateSpec {
    template: TemplateName;
    data: DataSource;
    encoding: Encoding;
    properties?: TemplateProperties;
}

interface TemplateDef {
    label: string;
    /** Each inner list is one way to satisfy a requirement (e.g. region, or lat and lon). */
    requires: Channel[][];
    channels: Channel[];
    /** The layer type the template draws. */
    layer: LayerType;
}

/** Placed by region or by lat/lon (checked as a pair). */
const WHERE_ANY: Channel[] = ['region', 'lat', 'lon'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const TEMPLATE_DEFS: Record<TemplateName, TemplateDef> = {
    choropleth: { label: 'Choropleth', requires: [['region'], ['color']], channels: ['region', 'color', 'label', 'time', 'filter'], layer: 'regions' },
    bubbles: { label: 'Bubble map', requires: [WHERE_ANY, ['size']], channels: ['region', 'lat', 'lon', 'size', 'color', 'label', 'time', 'filter'], layer: 'bubbles' },
    points: { label: 'Point map', requires: [['lat', 'lon']], channels: ['lat', 'lon', 'color', 'size', 'label', 'time', 'filter'], layer: 'points' },
    density: { label: 'Density', requires: [['lat', 'lon']], channels: ['lat', 'lon', 'weight', 'time', 'filter'], layer: 'hexbin' },
    spikes: { label: 'Spike map', requires: [WHERE_ANY, ['size']], channels: ['region', 'lat', 'lon', 'size', 'color', 'label', 'time', 'filter'], layer: 'spikes' },
    flows: { label: 'Flow map', requires: [['origin', 'originLat'], ['destination', 'destinationLat']],
        channels: ['origin', 'destination', 'originLat', 'originLon', 'destinationLat', 'destinationLon', 'size', 'color', 'time', 'filter'], layer: 'flows' },
    tracks: { label: 'Track map', requires: [['lat', 'lon'], ['group']], channels: ['lat', 'lon', 'group', 'order', 'color', 'size', 'time', 'filter'], layer: 'paths' },
    bivariate: { label: 'Bivariate choropleth', requires: [['region'], ['color'], ['color2']], channels: ['region', 'color', 'color2', 'label', 'time', 'filter'], layer: 'regions' },
    cartogram: { label: 'Cartogram', requires: [['region'], ['size']], channels: ['region', 'size', 'color', 'label', 'time', 'filter'], layer: 'bubbles' },
    vectors: { label: 'Vector map', requires: [['lat', 'lon'], ['angle', 'u']], channels: ['lat', 'lon', 'angle', 'u', 'v', 'size', 'color', 'time', 'filter'], layer: 'vectors' },
};


/** What is missing or wrong in a template spec, as sentences the agent can act on. */
export function templateErrors(raw: Record<string, unknown>): string[] {
    const errors: string[] = [];
    const name = raw.template;
    if (typeof name !== 'string' || !(TEMPLATES as readonly string[]).includes(name)) {
        return [`template must be one of ${TEMPLATES.join(', ')}.`];
    }
    const def = TEMPLATE_DEFS[name as TemplateName];
    if (!isRecord(raw.data)) errors.push('A template map needs data: a table, sql with tables, or inline values.');
    const encoding = isRecord(raw.encoding) ? raw.encoding : {};
    if (!isRecord(raw.encoding)) errors.push('A template map needs encoding: the columns it maps.');
    for (const [channel, value] of Object.entries(encoding)) {
        if (channel === 'tooltip') {
            if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) errors.push('encoding.tooltip must list column names.');
        } else if (!(CHANNELS as readonly string[]).includes(channel)) {
            errors.push(`encoding.${channel} is not a channel; ${name} takes ${def.channels.join(', ')}.`);
        } else if (isText(value)) {
            continue;
        } else if (!CHOICE_CHANNELS.includes(channel as Channel)) {
            errors.push(`encoding.${channel} must be one column name; only ${CHOICE_CHANNELS.join(', ')} take a list of options.`);
        } else {
            const options = Array.isArray(value) ? value : isRecord(value) ? value.options : undefined;
            const field = isRecord(value) ? value.field : undefined;
            if (!Array.isArray(options) || !options.length || !options.every(isText)) {
                errors.push(`encoding.${channel} must be a column name, a list of column names, or {"field", "options"} with options listing column names.`);
            } else if (field !== undefined && field !== null && !(isText(field) && options.includes(field))) {
                errors.push(`encoding.${channel}.field must be one of its options.`);
            }
        }
    }
    const has = (channel: Channel) => !!boundField(encoding as Encoding, channel);
    for (const options of def.requires) {
        if (options === WHERE_ANY) continue;
        if (!options.some(has)) errors.push(`${def.label} needs encoding.${options.join(' or encoding.')}.`);
    }
    if (def.requires.includes(WHERE_ANY) && !has('region') && !(has('lat') && has('lon'))) {
        errors.push(`${def.label} needs encoding.region, or encoding.lat and encoding.lon.`);
    }
    if ((has('lat') !== has('lon')) && def.channels.includes('lat')) errors.push('encoding.lat and encoding.lon go together.');
    if (name === 'vectors' && has('u') !== has('v')) errors.push('encoding.u and encoding.v go together (east and north components).');
    const properties = isRecord(raw.properties) ? raw.properties : {};
    if (properties.color !== undefined && !(typeof properties.color === 'string' && d3.color(properties.color))) {
        errors.push('properties.color must be a CSS colour, such as "#4e79a7" or "darkslategray".');
    }
    if (name === 'flows') {
        if (has('originLat') !== has('originLon')) errors.push('encoding.originLat and originLon go together.');
        if (has('destinationLat') !== has('destinationLon')) errors.push('encoding.destinationLat and destinationLon go together.');
    }
    return errors;
}

const geoOf = (properties: TemplateProperties): Pick<Layer, 'geo' | 'featureKey' | 'keyType'> => {
    const geography = properties.geography;
    const builtIn = geography === 'world' ? 'countries' : geography === 'us-states' || geography === 'us-counties' ? geography : undefined;
    return {
        ...(builtIn ? { geo: builtIn } : geography?.startsWith('files/') ? { geo: geography } : {}),
        ...(properties.featureKey ? { featureKey: properties.featureKey } : {}),
        ...(properties.keyType ? { keyType: properties.keyType } : {}),
    };
};

/** The basemap a template's geography implies (view.basemap still wins). */
const basemapOf = (geography: string | undefined): MapView['basemap'] | undefined =>
    geography === 'world' ? 'world' : geography === 'us-states' ? 'us-states' : geography === 'us-counties' ? 'us-counties'
        : geography?.startsWith('files/') ? 'none' : undefined;

/** Compile a template spec into the layer spec's data, layers, controls, and view defaults. */
export function compileTemplate(spec: TemplateSpec): { data: Record<string, DataSource>; layers: Layer[]; controls: Control[]; view: MapView } {
    const { template } = spec;
    const properties = spec.properties ?? {};
    const def = TEMPLATE_DEFS[template];
    const bound = (channel: Channel) => def.channels.includes(channel) ? boundField(spec.encoding, channel) : undefined;
    const encoding = Object.fromEntries(CHANNELS.map(channel => [channel, bound(channel)])) as Partial<Record<Channel, string>>;

    // A measure offered several columns gets a switch; color and size offered the same columns share one.
    const switches: Control[] = [];
    const refs: Partial<Record<Channel, FieldRef>> = {};
    for (const channel of SWITCH_CHANNELS) {
        const { field, options } = channelBinding(spec.encoding[channel]);
        if (!encoding[channel] || options.length < 2) continue;
        const same = switches.find(control => control.value === field && control.options?.length === options.length
            && control.options.every((option, index) => option.value === options[index]));
        if (same) { refs[channel] = { param: same.param! }; continue; }
        switches.push({ type: 'select', param: channel, options: options.map(value => ({ value })), value: field });
        refs[channel] = { param: channel };
    }
    const fieldOf = (channel: Channel): FieldRef | undefined => refs[channel] ?? encoding[channel];

    const layer: Layer = { id: 'main', type: def.layer, data: 'main' };
    const where = encoding.region ? { key: encoding.region, ...geoOf(properties) } : { lon: encoding.lon, lat: encoding.lat };

    if (template === 'flows') {
        // Coordinates place an end exactly; a name alongside them labels it (a city, not its country).
        layer.from = encoding.originLat ? { lon: encoding.originLon, lat: encoding.originLat, ...(encoding.origin ? { label: encoding.origin } : {}) }
            : { key: encoding.origin, ...geoOf(properties) };
        layer.to = encoding.destinationLat ? { lon: encoding.destinationLon, lat: encoding.destinationLat, ...(encoding.destination ? { label: encoding.destination } : {}) }
            : { key: encoding.destination, ...geoOf(properties) };
        if (properties.curve) layer.curve = properties.curve;
    } else if (template === 'tracks') {
        Object.assign(layer, { lon: encoding.lon, lat: encoding.lat, group: encoding.group, ...(encoding.order ? { order: encoding.order } : {}) });
    } else {
        Object.assign(layer, where);
    }
    // Lines show which way they go with arrowheads, the cue readers decode best (Jenny et al. 2017).
    if (template === 'flows' || template === 'tracks') layer.direction = properties.direction ?? 'arrow';
    if (template === 'vectors') Object.assign(layer, encoding.angle ? { angle: encoding.angle } : { u: encoding.u, v: encoding.v });
    if (template === 'density') {
        layer.type = properties.density ?? 'hexbin';
        if (encoding.weight) layer.weight = encoding.weight;
        if (properties.radius) layer.radius = properties.radius;
    }
    if (template === 'cartogram') layer.layout = 'dorling';
    if (template === 'tracks' && !encoding.color && !properties.color) layer.color = { field: encoding.group };

    if (template === 'bivariate') {
        layer.color = { type: 'bivariate', field: fieldOf('color'), field2: fieldOf('color2'), ...(properties.scheme ? { scheme: properties.scheme } : {}) };
    } else if (encoding.color) {
        layer.color = {
            field: fieldOf('color'),
            ...(properties.classes ? { classes: properties.classes } : {}),
            ...(properties.method ? { method: properties.method } : {}),
            ...(properties.scheme ? { scheme: properties.scheme } : {}),
        };
    } else if (properties.color && template !== 'density') {
        layer.color = { value: properties.color };
    } else if (properties.scheme && template === 'density') {
        // Hexbins and heatmaps colour by count: the scheme sets their ramp.
        layer.color = { scheme: properties.scheme };
    }
    if (encoding.size) layer.size = { field: fieldOf('size'), ...(properties.sizeMax ? { max: properties.sizeMax } : {}) };
    else if (properties.sizeMax && template !== 'choropleth') layer.size = { value: properties.sizeMax };
    if (encoding.label) layer.text = encoding.label;
    // A cartogram names its circles by region unless told otherwise.
    if (template === 'cartogram' && !encoding.label && encoding.region) layer.text = encoding.region;
    if (properties.opacity !== undefined) layer.opacity = properties.opacity;
    // Tooltips list every measure a switch can show, so switching never hides a value.
    const measures = (['color', 'color2', 'size', 'weight'] as Channel[]).flatMap(channel =>
        !encoding[channel] ? [] : refs[channel] ? channelBinding(spec.encoding[channel]).options : [encoding[channel]!]);
    // Listed tooltip fields come first; the shown measures always follow, so changing the measure keeps it in view.
    const headings = template === 'vectors' ? [encoding.angle, encoding.u, encoding.v].filter((field): field is string => !!field) : [];
    const tooltip = [...(spec.encoding.tooltip ?? []), ...measures, ...headings];
    if (tooltip.length) layer.tooltip = Array.from(new Set(tooltip));

    const controls: Control[] = [...switches];
    if (encoding.time) controls.push({ type: 'slider', field: encoding.time, data: 'main', play: properties.play !== false });
    if (encoding.filter) controls.push({ type: 'checkboxes', field: encoding.filter, data: 'main' });
    const named = !!(encoding.region || encoding.label);
    if (properties.search ?? (named && template !== 'flows' && template !== 'density')) controls.push({ type: 'search', layer: 'main' });
    if (properties.details ?? template !== 'density') controls.push({ type: 'details', layer: 'main' });
    if (properties.stats) controls.push({ type: 'stats', layer: 'main' });

    const basemap = basemapOf(properties.geography);
    return { data: { main: spec.data }, layers: [layer], controls, view: basemap ? { basemap } : {} };
}

/** Channels to carry over when switching templates: color and size trade places as the new template needs. */
export function switchTemplate(encoding: Encoding, to: TemplateName): Encoding {
    const next: Encoding = { ...encoding };
    const wants = TEMPLATE_DEFS[to].channels;
    const has = (channel: Channel) => !!boundField(next, channel);
    if (wants.includes('size') && !has('size') && TEMPLATE_DEFS[to].requires.some(options => options.includes('size')) && has('color')) next.size = next.color;
    if (to === 'choropleth' && !has('color') && has('size')) next.color = next.size;
    for (const channel of Object.keys(next) as Channel[]) {
        if (channel !== ('tooltip' as Channel) && !wants.includes(channel)) delete next[channel];
    }
    return next;
}

/** Templates a set of bound channels can switch to without new columns. */
export function compatibleTemplates(encoding: Encoding): TemplateName[] {
    const has = (channel: Channel) => !!boundField(encoding, channel);
    const hasRegion = has('region');
    const hasPoint = has('lat') && has('lon');
    const hasFlow = has('origin') || has('originLat');
    if (hasFlow) return ['flows'];
    const measure = has('color') || has('size');
    return TEMPLATES.filter(name => {
        if (name === 'flows') return false;
        if (name === 'tracks') return hasPoint && has('group');
        if (name === 'bivariate') return hasRegion && has('color') && has('color2');
        if (name === 'choropleth' || name === 'cartogram') return hasRegion && measure;
        if (name === 'points' || name === 'density') return hasPoint;
        if (name === 'vectors') return hasPoint && (has('angle') || has('u'));
        return (hasRegion || hasPoint) && measure;
    });
}
