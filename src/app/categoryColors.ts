// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Session category colours: a value of a category (a country, a party, a product) keeps one colour
 * across the session's charts and maps, so a follow-up chart that adds values does not recolour the
 * ones readers have already learned (China stays blue when Japan joins it).
 *
 * - Pinned colours (a field's `colors`, for values with an intrinsic colour such as a party's) win, and
 *   apply wherever the same kind of field appears in the session, in any table.
 * - Other values take a palette slot the first time they are drawn; the session registry keeps it.
 * - Slots come from the theme's strong colours only (no greys, nothing too close to the surface or to a
 *   stronger slot), so a value arriving late never gets a washed-out colour. When every slot has an
 *   owner, values that are not drawn together share one; in a chart where two owners meet, the later
 *   one takes a free slot for that chart.
 */

import * as d3 from 'd3';

/** Per kind of field, each value's slot and the order it was registered in. */
export type CategoryColorRegistry = Record<string, Record<string, { slot: number; seq: number }>>;

/** Pinned colours by kind, and value pins that are the same wherever they were set. */
export interface SessionPins {
    byKind: Record<string, Record<string, string>>;
    byValue: Record<string, string>;
}

export interface SessionCategoryColors {
    registry: CategoryColorRegistry;
    pins: SessionPins;
}

export interface CategoryRegistration {
    kind: string;
    entries: Record<string, number>;
}

/** The parts of a field annotation that decide its colours. */
export interface CategoryAnnotation {
    semanticType?: string;
    sortOrder?: unknown[];
    colors?: Record<string, string>;
}

/** Vega's categorical palette: what a chart without a theme draws with. */
export const DEFAULT_CATEGORY_PALETTE = ['#4c78a8', '#f58518', '#e45756', '#72b7b2', '#54a24b', '#eeca3b', '#b279a2', '#ff9da6', '#9d755d', '#bab0ac'];

/** Fields that name the same kind of thing in any table share colours; other fields by their column name. */
const ENTITY_TYPES = new Set(['Country', 'State', 'City', 'Region', 'Address', 'ZipCode']);

/** Types whose values are amounts, times or ranks: coloured by ramps, not identities. */
const NOT_IDENTITIES = new Set([
    'DateTime', 'Date', 'Time', 'Timestamp', 'Year', 'Quarter', 'Month', 'Week', 'Day', 'Hour', 'YearMonth', 'YearQuarter',
    'YearWeek', 'Decade', 'Duration', 'Quantity', 'Count', 'Amount', 'Price', 'Percentage', 'Temperature', 'Profit',
    'PercentageChange', 'Sentiment', 'Correlation', 'Rank', 'ID', 'Score', 'Latitude', 'Longitude', 'Range', 'Number',
]);

/** Values charts colour by their role (other, total, missing): never given an identity colour. */
const ROLE_VALUES = new Set(['other', 'others', 'all other', 'all others', 'rest of world', 'rest of the world', 'remainder',
    'total', 'grand total', 'missing', 'unknown', 'no data', 'n/a', 'not available', 'not classified', 'unclassified']);

export const valueKey = (value: unknown) => String(value).trim().toLowerCase();

export function categoryKind(field: string, semanticType?: string): string {
    return semanticType && ENTITY_TYPES.has(semanticType) ? semanticType : `field:${field.trim().toLowerCase()}`;
}

const isCssColor = (color: unknown): color is string => typeof color === 'string' && !!d3.color(color);

/** Every pinned colour in the session's field annotations, by kind and (where unambiguous) by value. */
export function sessionPins(tables: { fields?: Record<string, CategoryAnnotation & { authored?: CategoryAnnotation }> }[]): SessionPins {
    const byKind: Record<string, Record<string, string>> = {};
    const seen: Record<string, Set<string>> = {};
    for (const table of tables) {
        for (const [field, info] of Object.entries(table.fields ?? {})) {
            const merged = { ...info, ...info.authored };
            if (!merged.colors) continue;
            const kind = categoryKind(field, merged.semanticType);
            for (const [value, color] of Object.entries(merged.colors)) {
                if (!isCssColor(color)) continue;
                const key = valueKey(value);
                (byKind[kind] ??= {})[key] = color;
                (seen[key] ??= new Set()).add(d3.color(color)!.formatHex());
            }
        }
    }
    const byValue: Record<string, string> = {};
    for (const [key, colors] of Object.entries(seen)) if (colors.size === 1) byValue[key] = [...colors][0];
    return { byKind, byValue };
}

const deltaE = (a: string, b: string) => {
    const [x, y] = [d3.lab(a), d3.lab(b)];
    return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
};

/**
 * The palette's slots that can carry an identity: coloured (not grey), clear of the surface, and
 * distinct from every stronger slot before them.
 */
export function colorPool(palette: readonly string[], surface = '#ffffff'): { slot: number; color: string }[] {
    const ground = d3.lab(surface);
    const pool: { slot: number; color: string }[] = [];
    palette.forEach((color, slot) => {
        if (!isCssColor(color)) return;
        const hcl = d3.hcl(color);
        if (!(hcl.c >= 20) || Math.abs(hcl.l - ground.l) < 18) return;
        if (pool.some(item => deltaE(item.color, color) < 18)) return;
        pool.push({ slot, color });
    });
    return pool;
}

/**
 * Colours for a categorical field's values, and the new values to register. Undefined colours when
 * the field is not an identity (amounts, times, ordered levels) and nothing is pinned.
 */
export function sessionValueColors(session: SessionCategoryColors | undefined, field: string, annotation: CategoryAnnotation | undefined,
    values: unknown[], palette: readonly string[] | undefined, surface?: string,
): { colors?: Record<string, string>; register?: CategoryRegistration } {
    if (!session) return {};
    const kind = categoryKind(field, annotation?.semanticType);
    const domain = new Map<string, string>();
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const key = valueKey(value);
        if (key && !domain.has(key)) domain.set(key, String(value));
    }
    if (!domain.size) return {};
    const own = Object.fromEntries(Object.entries(annotation?.colors ?? {}).map(([value, color]) => [valueKey(value), color]));
    const kindPins = session.pins.byKind[kind] ?? {};
    const colors: Record<string, string> = {};
    const used: string[] = [];
    const open: string[] = [];
    for (const [key, value] of domain) {
        const pinned = [own[key], kindPins[key], session.pins.byValue[key]].find(isCssColor);
        if (pinned) { colors[value] = pinned; used.push(pinned); }
        else if (!ROLE_VALUES.has(key)) open.push(key);
    }
    const identity = !(annotation?.semanticType && NOT_IDENTITIES.has(annotation.semanticType))
        && !(Array.isArray(annotation?.sortOrder) && annotation!.sortOrder.length > 0)
        && ![...domain.values()].every(value => value.trim() !== '' && Number.isFinite(Number(value)));
    const pool = identity ? colorPool(palette?.length ? palette : DEFAULT_CATEGORY_PALETTE, surface) : [];
    if (!open.length || !pool.length || open.length > pool.length) return Object.keys(colors).length ? { colors } : {};

    const registry = session.registry[kind] ?? {};
    const owned = new Set(Object.values(registry).map(entry => entry.slot));
    const taken = new Set<number>();
    // A slot close to a pinned colour (in this chart, or for this kind anywhere in the session) would read as that value.
    const avoid = [...used, ...Object.values(kindPins).filter(isCssColor)];
    const clear = (item: { slot: number; color: string }) => !taken.has(item.slot) && avoid.every(color => deltaE(color, item.color) >= 15);
    const give = (key: string, item: { slot: number; color: string }) => { colors[domain.get(key)!] = item.color; taken.add(item.slot); };

    const registered = open.filter(key => registry[key]).sort((a, b) => registry[a].seq - registry[b].seq);
    const unplaced: string[] = [];
    for (const key of registered) {
        const item = pool.find(candidate => candidate.slot === registry[key].slot);
        if (item && clear(item)) give(key, item); else unplaced.push(key);
    }
    const entries: Record<string, number> = {};
    const fresh = open.filter(key => !registry[key]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const key of [...fresh, ...unplaced]) {
        const candidates = pool.filter(clear);
        const item = candidates.find(candidate => !owned.has(candidate.slot)) ?? candidates[0] ?? pool.find(candidate => !taken.has(candidate.slot));
        if (!item) continue;
        give(key, item);
        if (!registry[key]) { entries[key] = item.slot; owned.add(item.slot); }
    }
    return { colors, ...(Object.keys(entries).length ? { register: { kind, entries } } : {}) };
}

/** Registry and pins aside, a palette and surface from a chart theme (or Vega's defaults for none). */
export function themeCategoryPalette(theme: Record<string, any> | undefined): { palette: string[]; surface: string } {
    const series = theme?.ink?.series ?? {};
    const palette = (series.categoricalExtended ?? series.categorical) as string[] | undefined;
    const surface = theme?.ink?.surface?.plot ?? theme?.ink?.surface?.canvas;
    return { palette: palette?.length ? palette : DEFAULT_CATEGORY_PALETTE, surface: isCssColor(surface) ? surface : '#ffffff' };
}

/** The channels a chart colours series by, in the order Flint reads them. */
export const CHART_COLOR_CHANNELS = ['color', 'group'] as const;

/**
 * A chart's session colours: for the field on its colour (or group) channel, when that field names
 * categories and the chart does not pick its own scheme.
 */
export function chartCategoryColors(session: SessionCategoryColors | undefined,
    encodingMap: Record<string, { fieldID?: string; dtype?: string; scheme?: string } | undefined>,
    fields: { id: string; name: string }[], rows: Record<string, unknown>[],
    fieldSemantics: Record<string, CategoryAnnotation & { authored?: CategoryAnnotation }> | undefined, theme: Record<string, any> | undefined,
): { colors?: Record<string, string>; register?: CategoryRegistration } {
    const channel = CHART_COLOR_CHANNELS.find(name => encodingMap[name]?.fieldID);
    const encoding = channel ? encodingMap[channel] : undefined;
    const field = encoding && fields.find(item => item.id === encoding.fieldID)?.name;
    if (!session || !encoding || !field || (encoding.scheme && encoding.scheme !== 'default')
        || encoding.dtype === 'quantitative' || encoding.dtype === 'temporal') return {};
    const info = fieldSemantics?.[field];
    const annotation = info ? { ...info, ...info.authored } : undefined;
    const { palette, surface } = themeCategoryPalette(theme);
    return sessionValueColors(session, field, annotation, rows.map(row => row[field]), palette, surface);
}

/** Add newly drawn values to the registry; values already there keep their slot. */
export function registerCategoryColors(registry: CategoryColorRegistry, { kind, entries }: CategoryRegistration): CategoryColorRegistry {
    const current = registry[kind] ?? {};
    const added = Object.entries(entries).filter(([key, slot]) => !current[key] && Number.isInteger(slot) && slot >= 0);
    if (!added.length) return registry;
    let seq = Object.keys(current).length;
    return { ...registry, [kind]: { ...current, ...Object.fromEntries(added.map(([key, slot]) => [key, { slot, seq: seq++ }])) } };
}
