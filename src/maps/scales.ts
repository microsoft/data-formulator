// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Colour and size scales for map layers, their legends, aggregation, and value formats. */

import * as d3 from 'd3';

import type { Aggregate, ClassMethod, ColorEncoding, SizeEncoding } from './spec';

export const SEQUENTIAL_SCHEMES: Record<string, (t: number) => string> = {
    blues: d3.interpolateBlues, greens: d3.interpolateGreens, oranges: d3.interpolateOranges, reds: d3.interpolateReds,
    purples: d3.interpolatePurples, greys: d3.interpolateGreys, viridis: d3.interpolateViridis, magma: d3.interpolateMagma,
    inferno: d3.interpolateInferno, plasma: d3.interpolatePlasma, cividis: d3.interpolateCividis, turbo: d3.interpolateTurbo,
    ylOrRd: d3.interpolateYlOrRd, ylOrBr: d3.interpolateYlOrBr, ylGnBu: d3.interpolateYlGnBu, ylGn: d3.interpolateYlGn,
    buGn: d3.interpolateBuGn, buPu: d3.interpolateBuPu, gnBu: d3.interpolateGnBu, orRd: d3.interpolateOrRd, puBuGn: d3.interpolatePuBuGn,
    puRd: d3.interpolatePuRd, rdPu: d3.interpolateRdPu, warm: d3.interpolateWarm, cool: d3.interpolateCool,
};
export const DIVERGING_SCHEMES: Record<string, (t: number) => string> = {
    blueOrange: d3.piecewise(d3.interpolateLab, ['#2166ac', '#92c5de', '#f7f7f7', '#fdb863', '#b35806']),
    rdBu: d3.interpolateRdBu, rdYlBu: d3.interpolateRdYlBu, rdYlGn: d3.interpolateRdYlGn, brBG: d3.interpolateBrBG,
    piYG: d3.interpolatePiYG, puOr: d3.interpolatePuOr, prGn: d3.interpolatePRGn, spectral: d3.interpolateSpectral, rdGy: d3.interpolateRdGy,
};
export const CATEGORICAL_SCHEMES: Record<string, readonly string[]> = {
    tableau10: d3.schemeTableau10, category10: d3.schemeCategory10, observable10: d3.schemeObservable10 ?? d3.schemeTableau10,
    set1: d3.schemeSet1, set2: d3.schemeSet2, set3: d3.schemeSet3, dark2: d3.schemeDark2, paired: d3.schemePaired,
    pastel1: d3.schemePastel1, pastel2: d3.schemePastel2, accent: d3.schemeAccent,
};
const schemeKey = (scheme: string | undefined) => {
    if (!scheme) return undefined;
    const all = [...Object.keys(SEQUENTIAL_SCHEMES), ...Object.keys(DIVERGING_SCHEMES), ...Object.keys(CATEGORICAL_SCHEMES)];
    return all.find(name => name.toLowerCase() === scheme.toLowerCase());
};

export const NO_DATA_COLOR = '#e3e3e3';
export const DEFAULT_MARK_COLOR = '#4e79a7';

export const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const number = Number(value.replace(/,/g, ''));
        return Number.isFinite(number) ? number : null;
    }
    if (value instanceof Date) return value.getTime();
    return null;
};

export function aggregate(values: unknown[], how: Aggregate = 'mean'): unknown {
    if (how === 'count') return values.length;
    if (how === 'first') return values[0];
    const numbers = values.map(toNumber).filter((value): value is number => value !== null);
    if (!numbers.length) return values.find(value => value !== null && value !== undefined) ?? null;
    switch (how) {
        case 'sum': return d3.sum(numbers);
        case 'median': return d3.median(numbers) ?? null;
        case 'min': return d3.min(numbers) ?? null;
        case 'max': return d3.max(numbers) ?? null;
        default: return d3.mean(numbers) ?? null;
    }
}

/** Natural breaks (Jenks): `classes` groups that minimize within-group variance. */
export function jenksBreaks(input: number[], classes: number): number[] {
    const values = input.length > 2000
        ? d3.range(2000).map(index => input[Math.floor(index * input.length / 2000)]) : input.slice();
    values.sort((a, b) => a - b);
    const n = values.length;
    const k = Math.min(classes, new Set(values).size);
    if (k < 2) return [];
    const lower = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0));
    const variance = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(Infinity));
    for (let j = 1; j <= k; j++) { lower[1][j] = 1; variance[1][j] = 0; }
    for (let l = 2; l <= n; l++) {
        let sum = 0, sumSquares = 0, w = 0, v = 0;
        for (let m = 1; m <= l; m++) {
            const index = l - m + 1;
            const value = values[index - 1];
            sumSquares += value * value; sum += value; w += 1;
            v = sumSquares - (sum * sum) / w;
            if (index > 1) {
                for (let j = 2; j <= k; j++) {
                    if (variance[l][j] >= v + variance[index - 1][j - 1]) {
                        lower[l][j] = index;
                        variance[l][j] = v + variance[index - 1][j - 1];
                    }
                }
            }
        }
        lower[l][1] = 1;
        variance[l][1] = v;
    }
    const breaks: number[] = [];
    let end = n;
    for (let j = k; j >= 2; j--) {
        const index = lower[end][j] - 1;
        breaks.unshift(values[index]);
        end = index;
    }
    return breaks;
}

export type LegendModel =
    | { kind: 'gradient'; title: string; stops: string[]; domain: [number, number]; format: (value: number) => string; midpoint?: number }
    | { kind: 'classes'; title: string; items: { color: string; label: string; from?: number; to?: number; tick: string }[] }
    | { kind: 'categories'; title: string; items: { color: string; label: string; value: string }[] }
    | { kind: 'sizes'; title: string; items: { radius: number; label: string }[]; shape: SizeShape }
    | { kind: 'bivariate'; title: string; title2: string; colors: string[][]; ticks: string[]; ticks2: string[] };

/** Joshua Stevens' 3×3 bivariate palettes, rows by the second field (low → high), columns by the first. */
export const BIVARIATE_SCHEMES: Record<string, string[][]> = {
    blueRed: [['#e8e8e8', '#e4acac', '#c85a5a'], ['#b0d5df', '#ad9ea5', '#985356'], ['#64acbe', '#627f8c', '#574249']],
    purpleGold: [['#e8e8e8', '#e4d9ac', '#c8b35a'], ['#cbb8d7', '#c8ada0', '#af8e53'], ['#9972af', '#976b82', '#804d36']],
    greenPink: [['#e8e8e8', '#ace4e4', '#5ac8c8'], ['#dfb0d6', '#a5add3', '#5698b9'], ['#be64ac', '#8c62aa', '#3b4994']],
};

export interface ColorScale {
    color: (value: unknown) => string;
    legend: LegendModel | null;
    categorical: boolean;
}

/** A value formatter from a d3-format string, or a compact default. */
export function formatter(format?: string, prefix = '', suffix = ''): (value: unknown) => string {
    let numeric: ((value: number) => string) | null = null;
    if (format) {
        try { numeric = d3.format(format); } catch { numeric = null; }
    }
    const plain = (number: number) => {
        if (numeric) return numeric(number);
        if (Number.isInteger(number) && Math.abs(number) < 1e4 && Math.abs(number) >= 1000 && /^(1[5-9]|20)\d\d$/.test(String(number))) return String(number);
        if (Math.abs(number) >= 1e4) return d3.format('.3~s')(number).replace('G', 'B');
        if (Math.abs(number) >= 100) return d3.format(',.0f')(number);
        return d3.format('.3~g')(number);
    };
    return (value: unknown) => {
        if (value === null || value === undefined || value === '') return '—';
        const number = typeof value === 'number' ? value : null;
        if (number === null) return String(value);
        if (!prefix && !suffix) return plain(number);
        // The sign goes before a currency: −$1.2M.
        const text = plain(Math.abs(number));
        return `${number < 0 ? '−' : ''}${prefix}${text}${suffix}`;
    };
}

/** Ramps and colours a theme (or a field's semantics) supplies when the spec names no scheme. */
export interface Palette {
    single?: string;
    categorical?: readonly string[];
    sequential?: (t: number) => string;
    diverging?: (t: number) => string;
    /** The theme's ramp is designed end to end: do not trim its light end. */
    designed?: boolean;
    /** The theme quantizes into this many classes by default. */
    classes?: number;
    /** Fill for places without a value (the map style's). */
    noData?: string;
}

const isNumericField = (values: unknown[]) => {
    const present = values.filter(value => value !== null && value !== undefined && value !== '');
    return present.length > 0 && present.every(value => toNumber(value) !== null && typeof value !== 'boolean');
};

/**
 * A colour scale over `values` (the layer's mark values after aggregation). Numbers get a
 * sequential (or diverging) scale classed by `method`; anything else is categorical.
 */
function bivariateScale(encoding: ColorEncoding, values: unknown[], title: string, title2: string, noData = NO_DATA_COLOR): ColorScale {
    const pairs = values.filter(Array.isArray) as unknown[][];
    const tertiles = (index: number) => {
        const sorted = pairs.map(pair => toNumber(pair[index])).filter((value): value is number => value !== null).sort((a, b) => a - b);
        return sorted.length ? [d3.quantileSorted(sorted, 1 / 3)!, d3.quantileSorted(sorted, 2 / 3)!] : [0, 0];
    };
    const [x, y] = [tertiles(0), tertiles(1)];
    const schemeName = Object.keys(BIVARIATE_SCHEMES).find(name => name.toLowerCase() === encoding.scheme?.toLowerCase()) ?? 'blueRed';
    const colors = BIVARIATE_SCHEMES[schemeName];
    const bin = (value: number, cuts: number[]) => value < cuts[0] ? 0 : value < cuts[1] ? 1 : 2;
    const format = formatter(encoding.format);
    return {
        color: value => {
            if (!Array.isArray(value)) return noData;
            const [a, b] = [toNumber(value[0]), toNumber(value[1])];
            return a === null || b === null ? noData : colors[bin(b, y)][bin(a, x)];
        },
        legend: { kind: 'bivariate', title, title2, colors, ticks: x.map(value => format(value)), ticks2: y.map(value => format(value)) },
        categorical: false,
    };
}

export function colorScale(encoding: ColorEncoding | undefined, values: unknown[], fieldName: string, fieldName2?: string, palette: Palette = {}): ColorScale {
    const noData = palette.noData ?? NO_DATA_COLOR;
    if (encoding?.type === 'bivariate' && encoding.field !== undefined) {
        return bivariateScale(encoding, values, encoding.title ?? fieldName, fieldName2 ?? '', noData);
    }
    if (!encoding || (encoding.field === undefined && encoding.value !== undefined) || encoding.field === undefined) {
        const fixed = encoding?.value ?? palette.single ?? DEFAULT_MARK_COLOR;
        return { color: () => fixed, legend: null, categorical: false };
    }
    const title = encoding.title ?? fieldName;
    const scheme = schemeKey(encoding.scheme);
    const categorical = encoding.type === 'categorical' || (encoding.type === undefined && !isNumericField(values))
        || (!!scheme && scheme in CATEGORICAL_SCHEMES);
    if (categorical) {
        const domain = (encoding.domain?.map(String) ?? Array.from(new Set(values.filter(value => value !== null && value !== undefined && value !== '').map(String)))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
        const colors = scheme && scheme in CATEGORICAL_SCHEMES ? CATEGORICAL_SCHEMES[scheme] : palette.categorical ?? CATEGORICAL_SCHEMES.tableau10;
        const ordinal = d3.scaleOrdinal<string, string>().domain(domain).range(colors as string[]);
        return {
            color: value => value === null || value === undefined || value === '' ? noData : ordinal(String(value)),
            legend: { kind: 'categories', title, items: domain.slice(0, 24).map(value => ({ value, label: value, color: ordinal(value) })) },
            categorical: true,
        };
    }
    const numbers = values.map(toNumber).filter((value): value is number => value !== null);
    const format = formatter(encoding.format, encoding.prefix, encoding.suffix);
    const fmt = (value: number) => format(value);
    if (!numbers.length) return { color: () => noData, legend: null, categorical: false };
    const diverging = encoding.type === 'diverging' || (!!scheme && scheme in DIVERGING_SCHEMES);
    const named = diverging ? (scheme && scheme in DIVERGING_SCHEMES ? DIVERGING_SCHEMES[scheme] : undefined)
        : (scheme && scheme in SEQUENTIAL_SCHEMES ? SEQUENTIAL_SCHEMES[scheme] : undefined);
    const themed = named ? undefined : diverging ? palette.diverging : palette.sequential;
    const interpolate = named ?? themed ?? (diverging ? DIVERGING_SCHEMES.rdBu : SEQUENTIAL_SCHEMES.blues);
    const ramp = (t: number) => interpolate(encoding.reverse ? 1 - t : t);
    // Built-in sequential ramps skip their near-white start so light classes stay visible on the basemap.
    const trim = !diverging && !(themed && palette.designed);
    const sequential = (t: number) => ramp(trim ? 0.12 + 0.88 * t : t);
    const [min, max] = encoding.domain && encoding.domain.length >= 2
        ? [Number(encoding.domain[0]), Number(encoding.domain[encoding.domain.length - 1])]
        : (d3.extent(numbers) as [number, number]);
    const method: ClassMethod = encoding.method ?? (encoding.thresholds ? 'threshold' : diverging ? 'continuous' : 'quantile');

    if (diverging || method === 'continuous' || method === 'log') {
        let scale: (value: number) => number;
        let legendDomain: [number, number] = [min, max];
        let midpoint: number | undefined;
        if (diverging) {
            const mid = encoding.midpoint ?? (min < 0 && max > 0 ? 0 : (min + max) / 2);
            const extent = Math.max(Math.abs(max - mid), Math.abs(mid - min)) || 1;
            scale = value => 0.5 + (value - mid) / (2 * extent);
            // The ramp is symmetric around the midpoint, so the legend is too.
            legendDomain = [mid - extent, mid + extent];
            midpoint = mid;
        } else if (method === 'log' && min > 0) {
            const log = d3.scaleLog().domain([min, max === min ? min * 10 : max]).clamp(true);
            scale = value => value > 0 ? log(value) : 0;
        } else {
            const linear = d3.scaleLinear().domain([min, max === min ? min + 1 : max]).clamp(true);
            scale = linear;
        }
        const color = (value: unknown) => {
            const number = toNumber(value);
            return number === null ? noData : sequential(Math.max(0, Math.min(1, scale(number))));
        };
        return {
            color,
            legend: { kind: 'gradient', title, stops: d3.range(0, 1.0001, 0.1).map(sequential), domain: legendDomain, format: fmt, midpoint },
            categorical: false,
        };
    }

    const classes = Math.max(2, Math.min(9, encoding.classes ?? palette.classes ?? 5));
    let breaks: number[];
    if (method === 'threshold' && encoding.thresholds?.length) breaks = encoding.thresholds.slice().sort((a, b) => a - b);
    else if (method === 'equal') breaks = d3.range(1, classes).map(index => min + (max - min) * index / classes);
    else if (method === 'jenks') breaks = jenksBreaks(numbers, classes);
    else {
        const sorted = numbers.slice().sort((a, b) => a - b);
        breaks = d3.range(1, classes).map(index => d3.quantileSorted(sorted, index / classes) as number);
    }
    breaks = Array.from(new Set(breaks)).filter(value => Number.isFinite(value));
    const count = breaks.length + 1;
    const colors = d3.range(count).map(index => sequential(count === 1 ? 0.5 : index / (count - 1)));
    const threshold = d3.scaleThreshold<number, string>().domain(breaks).range(colors);
    const bounds = [min, ...breaks, max];
    return {
        color: value => {
            const number = toNumber(value);
            return number === null ? noData : threshold(number);
        },
        legend: {
            kind: 'classes', title, items: colors.map((color, index) => ({
                color, from: bounds[index], to: bounds[index + 1], tick: fmt(bounds[index]),
                label: index === 0 ? `< ${fmt(bounds[1])}` : index === count - 1 ? `≥ ${fmt(bounds[index])}` : `${fmt(bounds[index])} – ${fmt(bounds[index + 1])}`,
            })),
        },
        categorical: false,
    };
}

export interface SizeScale {
    size: (value: unknown) => number;
    legend: LegendModel | null;
}

/** Area-true radius (bubbles) or linear length (spikes, flows) over the layer's values. */
/** An arrow from (x0, y0) to (x1, y1) with an open head, sized to its length. */
export const arrowPath = (x0: number, y0: number, x1: number, y1: number) => {
    const length = Math.hypot(x1 - x0, y1 - y0) || 1;
    const [ux, uy] = [(x1 - x0) / length, (y1 - y0) / length];
    const head = Math.min(6, Math.max(2.5, length * 0.32));
    const wing = head * 0.6;
    return `M${x0},${y0}L${x1},${y1}M${x1 - ux * head - uy * wing},${y1 - uy * head + ux * wing}L${x1},${y1}L${x1 - ux * head + uy * wing},${y1 - uy * head - ux * wing}`;
};

/** How a size reads: a circle's radius, a spike's height, a line's width, or an arrow's length. */
export type SizeShape = 'circle' | 'spike' | 'line' | 'arrow';

export function sizeScale(encoding: SizeEncoding | undefined, values: unknown[], fieldName: string,
    shape: SizeShape, defaults: { min: number; max: number; value: number }): SizeScale {
    if (!encoding || encoding.field === undefined) {
        const fixed = encoding?.value ?? defaults.value;
        return { size: () => fixed, legend: null };
    }
    const numbers = values.map(toNumber).filter((value): value is number => value !== null && value >= 0);
    const max = d3.max(numbers) ?? 1;
    const minSize = encoding.min ?? defaults.min;
    const maxSize = encoding.max ?? defaults.max;
    const scale = shape === 'circle'
        ? d3.scaleSqrt().domain([0, max || 1]).range([0, maxSize]).clamp(true)
        : d3.scaleLinear().domain([0, max || 1]).range([minSize, maxSize]).clamp(true);
    const size = (value: unknown) => {
        const number = toNumber(value);
        if (number === null || number < 0) return 0;
        return Math.max(shape === 'circle' && number > 0 ? minSize : 0, scale(number));
    };
    const custom = formatter(encoding.format, encoding.prefix, encoding.suffix);
    const compact = formatter(undefined, encoding.prefix, encoding.suffix);
    // Legend ticks are round numbers: keep the spec's format unless it makes them long.
    const format = (value: number) => { const label = custom(value); return label.length > 7 ? compact(value) : label; };
    const ticks = max > 0 ? niceSizeTicks(max) : [];
    return {
        size,
        legend: ticks.length ? { kind: 'sizes', title: encoding.title ?? fieldName, shape, items: ticks.map(value => ({ radius: size(value), label: format(value) })) } : null,
    };
}

/** Two or three round values up to `max` for a size legend. */
function niceSizeTicks(max: number): number[] {
    const top = Number(d3.format('.1~r')(max));
    const nice = top > max ? Number(d3.format('.2~r')(max)) : top;
    return Array.from(new Set([nice / 10, nice / 2, nice].map(value => Number(d3.format('.2~r')(value))))).filter(value => value > 0);
}
