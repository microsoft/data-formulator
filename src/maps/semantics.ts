// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Semantic defaults for map encodings, from Flint's type system (the same one charts use).
 *
 * A field's semantic type comes from the map's `fields` block, else the session's table semantics,
 * else a guess from its name. Flint then resolves what the type implies: number format and unit,
 * aggregation (additive measures sum, rates average), and colour (sequential, or diverging around
 * a midpoint for signed measures and declared pivots). Anything the spec states wins.
 */

import { getRecommendedColorScheme, getRegistryEntry, resolveColorSchemeHint, resolveFieldSemantics } from 'flint-chart';

import type { Aggregate, ColorEncoding, SizeEncoding } from './spec';

export interface FieldAnnotation {
    semanticType?: string;
    unit?: string;
    intrinsicDomain?: [number, number];
    divergingMidpoint?: number;
    displayName?: string;
}

export interface FormatSpec { pattern?: string; prefix?: string; suffix?: string }

/** Words a column name implies about its type, most specific first. */
const NAME_HINTS: [RegExp, FieldAnnotation][] = [
    [/(^|_|\b)(change|growth|delta|diff|margin|swing|anomal)/i, { semanticType: 'PercentageChange' }],
    [/(pct|percent|share|rate|ratio|proportion)(_|\b|$)|%/i, { semanticType: 'Percentage' }],
    [/temp(erature)?(_|\b|$)/i, { semanticType: 'Temperature' }],
    [/(usd|price|cost|revenue|sales|income|gdp|salary|wage|spend|profit|budget|dollar)/i, { semanticType: 'Amount' }],
    [/(^|_)(count|num|number|population|pop|total|cases|deaths|visits|trips|orders|units)(_|\b|$)/i, { semanticType: 'Count' }],
    [/(score|rating|index)(_|\b|$)/i, { semanticType: 'Score' }],
    [/(^|_)(year)(_|$)/i, { semanticType: 'Year' }],
];

/** Units a column name carries: `gdp_usd`, `emissions_kt`, `price_eur`. */
const NAME_UNITS: [RegExp, string][] = [
    [/(^|_)usd($|_)|\$/i, 'USD'], [/(^|_)eur($|_)|€/i, 'EUR'], [/(^|_)gbp($|_)|£/i, 'GBP'],
];

const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** A field's annotation: declared, else guessed from its name and values. */
export function annotateField(field: string, values: unknown[], declared?: FieldAnnotation): FieldAnnotation {
    if (declared?.semanticType) return declared;
    const numeric = values.length > 0 && values.filter(value => value !== null && value !== undefined && value !== '').every(isNumber);
    const guess = numeric ? NAME_HINTS.find(([pattern]) => pattern.test(field))?.[1] : undefined;
    const unit = declared?.unit ?? NAME_UNITS.find(([pattern]) => pattern.test(field))?.[1];
    const semanticType = guess?.semanticType ?? (numeric ? 'Number' : 'Category');
    const annotation: FieldAnnotation = { ...declared, semanticType, ...(unit ? { unit } : {}) };
    // A percentage stored as 0–1 needs its domain to format as %.
    if (semanticType === 'Percentage' && !annotation.intrinsicDomain) {
        const numbers = values.filter(isNumber) as number[];
        if (numbers.length && numbers.every(value => value >= 0 && value <= 1)) annotation.intrinsicDomain = [0, 1];
    }
    return annotation;
}

/** `life_expectancy` → "Life expectancy". */
export const humanize = (field: string): string => {
    const words = field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : field;
};

export interface ResolvedField {
    /** Legend and tooltip label: display name, else the humanized field, with its unit. */
    label: string;
    format?: FormatSpec;
    aggregate?: Aggregate;
    colorType: 'sequential' | 'diverging' | 'categorical';
    midpoint?: number;
    /** Flint's recommended (Vega) scheme name, used when no theme sets the ramps. */
    scheme?: string;
    /** Additive measures (counts, amounts) make misleading choropleths; rates do not. */
    additive: boolean;
}

const UNIT_LABELS: Record<string, string> = { USD: 'US$', EUR: '€', GBP: '£' };

export function resolveField(field: string, values: unknown[], declared?: FieldAnnotation): ResolvedField {
    const annotation = annotateField(field, values, declared);
    const type = annotation.semanticType ?? 'Unknown';
    let semantics: ReturnType<typeof resolveFieldSemantics> | null = null;
    try { semantics = resolveFieldSemantics(annotation as never, field, values as never[]); } catch { semantics = null; }
    const entry = getRegistryEntry(type);
    const numeric = (entry?.visEncodings ?? []).includes('quantitative') && values.some(isNumber);
    let colorType: ResolvedField['colorType'] = numeric ? 'sequential' : 'categorical';
    let midpoint: number | undefined;
    if (numeric) {
        try {
            const hint = resolveColorSchemeHint(type, annotation as never, values as never[]);
            if (hint.type === 'diverging') { colorType = 'diverging'; midpoint = hint.divergingMidpoint; }
        } catch { /* keep sequential */ }
    }
    let scheme: string | undefined;
    try {
        const distinct = new Set(values.map(String)).size;
        scheme = getRecommendedColorScheme(type, numeric ? 'quantitative' : 'nominal', distinct, field, values as never[],
            { type: colorType }).scheme;
    } catch { scheme = undefined; }
    const aggregation = semantics?.aggregationDefault;
    const unit = annotation.unit && !['USD', 'EUR', 'GBP'].includes(annotation.unit.toUpperCase()) ? annotation.unit : undefined;
    // A guessed name drops a trailing unit word ("Nuclear electricity twh") since the unit follows in parentheses.
    const unitWord = annotation.unit?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const name = annotation.displayName ?? (unitWord ? humanize(field).replace(new RegExp(`\\s+${unitWord}$`, 'i'), '') : humanize(field));
    const currency = annotation.unit ? UNIT_LABELS[annotation.unit.toUpperCase()] : undefined;
    return {
        label: unit && !name.toLowerCase().includes(unit.toLowerCase()) ? `${name} (${unit})` : currency && !/\$|€|£/.test(name) ? `${name} (${currency})` : name,
        format: semantics?.tooltipFormat ?? semantics?.format,
        aggregate: aggregation === 'sum' ? 'sum' : aggregation === 'average' ? 'mean' : undefined,
        colorType, midpoint, scheme,
        additive: entry?.aggRole === 'additive' || entry?.aggRole === 'signed-additive',
    };
}

/** Flint (Vega) scheme names → this renderer's d3 schemes. */
const SCHEME_NAMES: Record<string, string> = {
    blues: 'blues', reds: 'reds', oranges: 'oranges', purples: 'purples', greens: 'greens', greys: 'greys', viridis: 'viridis',
    goldgreen: 'ylGn', yelloworangebrown: 'ylOrBr', yelloworangered: 'ylOrRd', redblue: 'rdBu', blueorange: 'blueOrange',
    tableau10: 'tableau10', tableau20: 'tableau10', set2: 'set2', set3: 'set3', category10: 'category10',
};
export const schemeFromFlint = (name: string | undefined) => name ? SCHEME_NAMES[name.toLowerCase()] : undefined;

/**
 * Flint's unit (prefix/suffix) and percent pattern; other patterns (`,d`, `,.2f`) give way to the
 * map's compact numbers, which keep legends short ("$1.2M").
 */
function semanticFormat(encoding: { prefix?: string; suffix?: string }, resolved: ResolvedField) {
    const format = resolved.format;
    if (!format) return {};
    return {
        ...(format.pattern?.includes('%') ? { format: format.pattern } : {}),
        prefix: encoding.prefix ?? format.prefix,
        suffix: encoding.suffix ?? format.suffix,
    };
}

/** Fill in what the spec leaves unsaid about a colour encoding. */
export function colorDefaults(encoding: ColorEncoding, resolved: ResolvedField): ColorEncoding {
    const diverging = encoding.type === undefined && resolved.colorType === 'diverging';
    return {
        ...encoding,
        ...(diverging ? { type: 'diverging' as const, midpoint: encoding.midpoint ?? resolved.midpoint } : {}),
        ...(encoding.type === undefined && resolved.colorType === 'categorical' ? { type: 'categorical' as const } : {}),
        aggregate: encoding.aggregate ?? resolved.aggregate,
        title: encoding.title ?? resolved.label,
        ...(encoding.format === undefined ? semanticFormat(encoding, resolved) : {}),
    };
}

export function sizeDefaults(encoding: SizeEncoding, resolved: ResolvedField): SizeEncoding {
    return {
        ...encoding,
        aggregate: encoding.aggregate ?? resolved.aggregate,
        title: encoding.title ?? resolved.label,
        ...(encoding.format === undefined ? semanticFormat(encoding, resolved) : {}),
    };
}
