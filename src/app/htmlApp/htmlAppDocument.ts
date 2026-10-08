// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Host-side helpers for agent-generated HTML apps.
 *
 * Apps are untrusted: they render in a double iframe. A same-origin container
 * document carries `frame-src 'none'`, which blocks the app frame from
 * navigating itself to an external URL (a data-exfiltration channel the app's
 * own CSP cannot close). Inside it, the app runs with `sandbox="allow-scripts"`
 * (opaque origin: no cookies, storage, or DOM access to Data Formulator) and a
 * CSP that blocks all network access. Data reaches the app only through
 * validated bridge queries for tables declared in its manifest.
 */

export const APP_MANIFEST_ID = 'df-app-manifest';
export const APP_SANDBOX = 'allow-scripts';
export const APP_CSP = [
    "default-src 'none'",
    // Vega compiles expressions with Function(); the app already runs arbitrary
    // inline script, so eval adds no capability beyond the sandbox.
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
].join('; ');
export const CONTAINER_CSP = "frame-src 'none'; child-src 'none'";
export const CONTAINER_DOCUMENT = '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${CONTAINER_CSP}">`
    + '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}'
    + 'iframe{display:block;border:0;width:100%;height:100%}</style></head><body></body></html>';

export const DEFAULT_QUERY_ROWS = 5000;
export const MAX_QUERY_ROWS = 50000;
const MAX_LIST_ITEMS = 200;
const MAX_FILTER_VALUES = 1000;
const AGGREGATE_OPS = new Set(['count', 'sum', 'avg', 'min', 'max']);
const FILTER_OPS = new Set(['in', 'range', 'contains']);
const QUERY_OPTIONS = ['columns', 'aggregates', 'filters', 'search', 'orderBy', 'descending', 'limit', 'offset'];

export interface HtmlAppManifest {
    version: number;
    title: string;
    tables: string[];
}

/** Design tokens exposed to apps as `--df-*` CSS variables and `DF.theme`. */
export interface HtmlAppTheme {
    font: string;
    fontMono: string;
    text: string;
    muted: string;
    bg: string;
    /** Page background behind raised tiles. */
    canvas: string;
    surface: string;
    border: string;
    primary: string;
    primarySoft: string;
    primaryText: string;
    secondary: string;
    accent: string;
    positive: string;
    negative: string;
    warning: string;
    /** Density-aware type ramp in px, mirroring the host's `--df-text-*`. */
    textSize: { xxs: number; xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
    palette: string[];
}

export interface SampleTableRequest {
    table: string;
    size: number;
    offset: number;
    method: 'head' | 'bottom';
    select_fields: string[];
    aggregate_fields_and_functions: [string | null, string][];
    order_by_fields: string[];
    filters: Record<string, unknown>[];
    search?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseAppManifest(html: string): HtmlAppManifest {
    const empty = { version: 1, title: '', tables: [] };
    const node = new DOMParser().parseFromString(html, 'text/html').getElementById(APP_MANIFEST_ID);
    if (!node) return empty;
    try {
        const parsed = JSON.parse(node.textContent || '{}');
        if (!isRecord(parsed)) return empty;
        const tables = Array.isArray(parsed.tables)
            ? Array.from(new Set(parsed.tables.filter((table): table is string => typeof table === 'string' && table.length > 0)))
            : [];
        return { version: 1, title: typeof parsed.title === 'string' ? parsed.title : '', tables };
    } catch {
        return empty;
    }
}

const cssValue = (value: string) => value.replace(/[<>{};\\]/g, '');
const escapeInlineScript = (source: string) => source.replace(/<\/(script)/gi, '<\\/$1');

export function themeStylesheet(theme: HtmlAppTheme): string {
    const variables: [string, string][] = [
        ['font', theme.font], ['font-mono', theme.fontMono], ['text', theme.text], ['muted', theme.muted],
        ['bg', theme.bg], ['canvas', theme.canvas], ['surface', theme.surface], ['border', theme.border], ['primary', theme.primary],
        ['primary-soft', theme.primarySoft], ['primary-text', theme.primaryText], ['secondary', theme.secondary],
        ['accent', theme.accent], ['positive', theme.positive], ['negative', theme.negative], ['warning', theme.warning],
        ...Object.entries(theme.textSize).map(([step, size]): [string, string] => [`text-${step}`, `${Number(size) || 13}px`]),
        ...theme.palette.slice(0, 10).map((color, index): [string, string] => [`palette-${index + 1}`, color]),
    ];
    return `:root{${variables.map(([name, value]) => `--df-${name}:${cssValue(value)}`).join(';')};color-scheme:light}`;
}

/** Assemble the sandboxed app document; the CSP precedes all author content. */
export function buildAppDocument(html: string, options: {
    runtimeScripts: string[];
    theme: HtmlAppTheme;
    config: Record<string, unknown>;
    /** Base stylesheet (the DF app kit); author styles come after it and win ties. */
    kitStylesheet?: string;
}): string {
    const author = new DOMParser().parseFromString(html, 'text/html');
    author.querySelectorAll('meta[http-equiv], base').forEach(node => node.remove());
    const root = author.documentElement;
    const rootAttributes = ['lang', 'dir', 'class']
        .filter(name => root.hasAttribute(name))
        .map(name => ` ${name}="${(root.getAttribute(name) || '').replace(/[&"<>]/g, character => `&#${character.charCodeAt(0)};`)}"`)
        .join('');
    const config = JSON.stringify(options.config).replace(/</g, '\\u003c');
    const runtime = options.runtimeScripts.map(source => `<script>${escapeInlineScript(source)}</script>`).join('');
    return `<!doctype html><html${rootAttributes}><head><meta charset="utf-8">`
        + `<meta http-equiv="Content-Security-Policy" content="${APP_CSP}">`
        + '<meta http-equiv="x-dns-prefetch-control" content="off">'
        + '<meta name="referrer" content="no-referrer">'
        + `<style>${themeStylesheet(options.theme)}</style>`
        + (options.kitStylesheet ? `<style>${options.kitStylesheet.replace(/<\/(style)/gi, '<\\/$1')}</style>` : '')
        + `<script>window.__DF_APP_CONFIG__=${config};</script>`
        + runtime
        + author.head.innerHTML
        + `</head>${author.body.outerHTML}</html>`;
}

const stringList = (value: unknown, label: string): string[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
        throw new Error(`${label} must be a list of column names.`);
    }
    if (value.length > MAX_LIST_ITEMS) throw new Error(`${label} accepts at most ${MAX_LIST_ITEMS} columns.`);
    return Array.from(new Set(value as string[]));
};

const integer = (value: unknown, label: string, fallback: number, min: number, max: number): number => {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${label} must be an integer from ${min} to ${max}.`);
    }
    return value;
};

const scalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

function normalizeFilter(filter: unknown): Record<string, unknown> {
    if (!isRecord(filter) || typeof filter.field !== 'string' || !filter.field || !FILTER_OPS.has(String(filter.op))) {
        throw new Error('Each filter needs a field and an op of "in", "range", or "contains".');
    }
    const normalized: Record<string, unknown> = { field: filter.field, op: filter.op };
    if (filter.op === 'in') {
        if (!Array.isArray(filter.values) || filter.values.length > MAX_FILTER_VALUES || !filter.values.every(scalar)) {
            throw new Error(`An "in" filter needs a values list of at most ${MAX_FILTER_VALUES} scalars.`);
        }
        normalized.values = filter.values;
    } else if (filter.op === 'range') {
        for (const bound of ['min', 'max'] as const) {
            if (filter[bound] === undefined) continue;
            if (!scalar(filter[bound])) throw new Error(`A range filter ${bound} must be a scalar.`);
            normalized[bound] = filter[bound];
        }
        if (filter.include_nulls !== undefined) normalized.include_nulls = filter.include_nulls === true;
    } else {
        if (typeof filter.value !== 'string') throw new Error('A "contains" filter needs a text value.');
        normalized.value = filter.value;
    }
    return normalized;
}

/** Accept `orderBy` as a column, a list of columns, or `{field, descending}` entries. */
function normalizeOrderBy(value: unknown, descending: unknown): { fields: string[]; descending: boolean } {
    if (descending !== undefined && descending !== null && typeof descending !== 'boolean') {
        throw new Error('descending must be true or false.');
    }
    const items = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
    if (items.length > MAX_LIST_ITEMS) throw new Error(`orderBy accepts at most ${MAX_LIST_ITEMS} columns.`);
    const directions = new Set<boolean>();
    const fields = items.map(item => {
        if (typeof item === 'string' && item) {
            directions.add(descending === true);
            return item;
        }
        if (isRecord(item) && typeof item.field === 'string' && item.field) {
            const itemDescending = item.descending ?? (typeof item.order === 'string' ? item.order.toLowerCase() === 'desc' : descending);
            directions.add(itemDescending === true);
            return item.field;
        }
        throw new Error('orderBy must be a column name, a list of column names, or {field, descending} entries.');
    });
    if (directions.size > 1) throw new Error('All orderBy columns must sort in the same direction.');
    return { fields: Array.from(new Set(fields)), descending: directions.has(true) };
}

/** Validate an app's DF.query request and map it onto the sample-table API. */
export function normalizeAppQuery(table: unknown, options: unknown, manifest: HtmlAppManifest): SampleTableRequest {
    if (typeof table !== 'string' || !manifest.tables.includes(table)) {
        throw new Error(`Table "${String(table)}" is not declared in the app manifest.`);
    }
    if (options !== undefined && options !== null && !isRecord(options)) throw new Error('DF.query options must be an object.');
    const input = isRecord(options) ? options : {};
    const unknown = Object.keys(input).filter(key => !QUERY_OPTIONS.includes(key));
    if (unknown.length) {
        throw new Error(`Unknown DF.query option ${unknown.map(key => `"${key}"`).join(', ')}; use ${QUERY_OPTIONS.join(', ')}.`);
    }
    const columns = stringList(input.columns, 'columns');
    const order = normalizeOrderBy(input.orderBy, input.descending);
    const aggregates = input.aggregates === undefined || input.aggregates === null ? [] : input.aggregates;
    if (!Array.isArray(aggregates) || aggregates.length > 50) throw new Error('aggregates must be a list of at most 50 entries.');
    const aggregateFields = aggregates.map((aggregate): [string | null, string] => {
        const op = isRecord(aggregate) ? String(aggregate.op || '').toLowerCase() : '';
        const field = isRecord(aggregate) && typeof aggregate.field === 'string' && aggregate.field ? aggregate.field : null;
        if (!AGGREGATE_OPS.has(op)) throw new Error('Aggregate op must be count, sum, avg, min, or max.');
        if (op !== 'count' && !field) throw new Error(`The ${op} aggregate needs a field.`);
        return [field, op];
    });
    const filters = input.filters === undefined || input.filters === null ? [] : input.filters;
    if (!Array.isArray(filters) || filters.length > 50) throw new Error('filters must be a list of at most 50 entries.');
    if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) {
        throw new Error('search must be text of at most 200 characters.');
    }
    return {
        table,
        size: integer(input.limit, 'limit', DEFAULT_QUERY_ROWS, 1, MAX_QUERY_ROWS),
        offset: integer(input.offset, 'offset', 0, 0, 10_000_000),
        method: order.fields.length && order.descending ? 'bottom' : 'head',
        select_fields: columns,
        aggregate_fields_and_functions: aggregateFields,
        order_by_fields: order.fields,
        filters: filters.map(normalizeFilter),
        ...(typeof input.search === 'string' && input.search.trim() ? { search: input.search } : {}),
    };
}

export function stripRowIds(rows: unknown): Record<string, unknown>[] {
    if (!Array.isArray(rows)) return [];
    return rows.filter(isRecord).map(row => {
        if (!('#rowId' in row)) return row;
        const { ['#rowId']: _rowId, ...rest } = row;
        return rest;
    });
}
