import { afterEach, describe, expect, it, vi } from 'vitest';

import runtimeSource from '../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import {
    APP_CSP,
    CONTAINER_CSP,
    CONTAINER_DOCUMENT,
    DEFAULT_QUERY_ROWS,
    MAX_QUERY_ROWS,
    buildAppDocument,
    normalizeAppQuery,
    parseAppManifest,
    stripRowIds,
    type HtmlAppTheme,
} from '../../../../src/app/htmlApp/htmlAppDocument';

const theme: HtmlAppTheme = {
    font: 'Segoe UI, sans-serif', fontMono: 'monospace', text: '#111', muted: '#666', bg: '#fff',
    canvas: '#f6f7f9', surface: '#fafafa', border: '#ddd', primary: '#0067b8', primarySoft: '#e5f0f8', primaryText: '#005a9e',
    secondary: '#8764b8', accent: '#c85a17', positive: '#2e7d32', negative: '#d32f2f', warning: '#ed6c02',
    textSize: { xxs: 10, xs: 11, sm: 12, md: 13, lg: 14, xl: 16, xxl: 18 }, palette: ['#4c78a8'],
};
const manifest = { version: 1, title: 'Sales', tables: ['sales'] };

describe('parseAppManifest', () => {
    it('reads declared tables and ignores invalid entries', () => {
        const html = '<html><head><script type="application/json" id="df-app-manifest">'
            + '{"title":"Sales","tables":["sales",3,"","sales","orders"]}</script></head></html>';
        expect(parseAppManifest(html)).toEqual({ version: 1, title: 'Sales', tables: ['sales', 'orders'] });
    });

    it('falls back to no tables when the manifest is missing or malformed', () => {
        expect(parseAppManifest('<p>hi</p>').tables).toEqual([]);
        expect(parseAppManifest('<script id="df-app-manifest" type="application/json">{oops</script>').tables).toEqual([]);
    });
});

describe('buildAppDocument', () => {
    const build = (html: string, runtimeScripts = ['window.rt = 1;']) =>
        buildAppDocument(html, { runtimeScripts, theme, config: { channel: 'c<1>', manifest } });

    it('places the CSP before every script and author element', () => {
        const output = build('<!doctype html><html lang="en"><head><script>window.author = 1</script></head><body class="x"><h1>Hi</h1></body></html>');
        const cspIndex = output.indexOf('http-equiv="Content-Security-Policy"');
        expect(cspIndex).toBeGreaterThan(0);
        expect(cspIndex).toBeLessThan(output.indexOf('<script'));
        expect(output.indexOf('window.rt = 1')).toBeLessThan(output.indexOf('window.author = 1'));
        expect(output).toContain(`content="${APP_CSP}"`);
        expect(output).toContain('<html lang="en">');
        expect(output).toContain('<body class="x"><h1>Hi</h1></body>');
    });

    it('drops author CSP, refresh, and base overrides', () => {
        const output = build('<head><meta http-equiv="Content-Security-Policy" content="default-src *">'
            + '<meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com/"></head><body></body>');
        expect(output).not.toContain('default-src *');
        expect(output).not.toContain('url=https://example.com');
        expect(output).not.toContain('<base');
        expect(output.match(/Content-Security-Policy/g)).toHaveLength(1);
    });

    it('escapes closing script tags in runtime code and config', () => {
        const output = build('<p></p>', ['var s = "</script><script>alert(1)</script>";']);
        expect(output).not.toContain('"</script><script>alert(1)');
        expect(output).toContain('<\\/script>');
        expect(output).toContain('"channel":"c\\u003c1>"');
    });

    it('exposes design tokens and injects the kit stylesheet before author styles', () => {
        const output = buildAppDocument('<head><style>.author{}</style></head><body></body>', {
            runtimeScripts: [], theme, config: {}, kitStylesheet: '.df-card{}',
        });
        expect(output).toContain('--df-primary-text:#005a9e');
        expect(output).toContain('--df-text-md:13px');
        expect(output).toContain('--df-palette-1:#4c78a8');
        expect(output).toContain('--df-canvas:#f6f7f9');
        expect(output.indexOf('.df-card{}')).toBeGreaterThan(output.indexOf('--df-primary'));
        expect(output.indexOf('.df-card{}')).toBeLessThan(output.indexOf('.author{}'));
    });

    it('blocks network access and keeps the container from framing external pages', () => {
        expect(APP_CSP).toContain("connect-src 'none'");
        expect(APP_CSP).toContain("default-src 'none'");
        expect(APP_CSP).toContain("form-action 'none'");
        expect(CONTAINER_CSP).toContain("frame-src 'none'");
        expect(CONTAINER_DOCUMENT).toContain(CONTAINER_CSP);
    });
});

describe('normalizeAppQuery', () => {
    it('rejects tables outside the manifest', () => {
        expect(() => normalizeAppQuery('secrets', {}, manifest)).toThrow(/not declared/);
    });

    it('maps runtime options onto the sample-table request', () => {
        expect(normalizeAppQuery('sales', {
            columns: ['region'], aggregates: [{ op: 'COUNT' }, { op: 'avg', field: 'amount' }],
            filters: [{ field: 'region', op: 'in', values: ['a', null] }, { field: 'amount', op: 'range', min: 1 }],
            orderBy: ['region'], descending: true, limit: 10, offset: 5, search: 'x',
        }, manifest)).toEqual({
            table: 'sales', size: 10, offset: 5, method: 'bottom',
            select_fields: ['region'],
            aggregate_fields_and_functions: [[null, 'count'], ['amount', 'avg']],
            order_by_fields: ['region'],
            filters: [{ field: 'region', op: 'in', values: ['a', null] }, { field: 'amount', op: 'range', min: 1 }],
            search: 'x',
        });
    });

    it('accepts orderBy as a column, a list, or {field, descending} entries', () => {
        const order = (options: Record<string, unknown>) => {
            const request = normalizeAppQuery('sales', options, manifest);
            return [request.order_by_fields, request.method];
        };
        expect(order({ orderBy: 'year' })).toEqual([['year'], 'head']);
        expect(order({ orderBy: 'year', descending: true })).toEqual([['year'], 'bottom']);
        expect(order({ orderBy: [{ field: 'Year', descending: false }] })).toEqual([['Year'], 'head']);
        expect(order({ orderBy: [{ field: 'amount_sum', descending: true }, 'region'], descending: true }))
            .toEqual([['amount_sum', 'region'], 'bottom']);
        expect(order({ orderBy: [{ field: 'amount', order: 'DESC' }] })).toEqual([['amount'], 'bottom']);
        expect(() => order({ orderBy: [{ field: 'a', descending: true }, 'b'] })).toThrow(/same direction/);
        expect(() => order({ orderBy: [3] })).toThrow(/orderBy must be/);
        expect(() => order({ orderBy: 'a', descending: 'yes' })).toThrow(/descending/);
    });

    it('rejects unknown options with the list of supported ones', () => {
        expect(() => normalizeAppQuery('sales', { sort: 'year', where: {} }, manifest))
            .toThrow('Unknown DF.query option "sort", "where"; use columns, aggregates, filters, search, orderBy, descending, limit, offset.');
        expect(() => normalizeAppQuery('sales', 'year', manifest)).toThrow(/must be an object/);
    });

    it('applies default and maximum row limits', () => {
        expect(normalizeAppQuery('sales', undefined, manifest)).toMatchObject({ size: DEFAULT_QUERY_ROWS, method: 'head' });
        expect(() => normalizeAppQuery('sales', { limit: MAX_QUERY_ROWS + 1 }, manifest)).toThrow(/limit/);
        expect(() => normalizeAppQuery('sales', { limit: 1.5 }, manifest)).toThrow(/limit/);
    });

    it('rejects malformed aggregates and filters', () => {
        expect(() => normalizeAppQuery('sales', { aggregates: [{ op: 'median', field: 'x' }] }, manifest)).toThrow(/Aggregate op/);
        expect(() => normalizeAppQuery('sales', { aggregates: [{ op: 'sum' }] }, manifest)).toThrow(/needs a field/);
        expect(() => normalizeAppQuery('sales', { filters: [{ field: 'x', op: 'sql', value: '1=1' }] }, manifest)).toThrow(/op/);
        expect(() => normalizeAppQuery('sales', { filters: [{ field: 'x', op: 'in', values: [{}] }] }, manifest)).toThrow(/scalars/);
        expect(() => normalizeAppQuery('sales', { columns: 'region' }, manifest)).toThrow(/columns/);
    });
});

describe('stripRowIds', () => {
    it('removes the sample-table row id column', () => {
        expect(stripRowIds([{ '#rowId': 1, a: 2 }, { b: 3 }, 4])).toEqual([{ a: 2 }, { b: 3 }]);
    });
});

describe('DF app runtime', () => {
    afterEach(() => {
        delete (window as any).DF;
        delete (window as any).__DF_APP_CONFIG__;
        vi.restoreAllMocks();
    });

    const load = () => {
        const posted: any[] = [];
        vi.spyOn(window, 'postMessage').mockImplementation((message: any) => { posted.push(message); });
        (window as any).__DF_APP_CONFIG__ = { channel: 'chan', manifest, theme, hostOrigin: '*' };
        new Function(runtimeSource)();
        const deliver = (data: unknown, source: unknown = window) =>
            window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
        return { DF: (window as any).DF, posted, deliver };
    };

    it('handshakes, sends declared queries, and resolves results', async () => {
        const { DF, posted, deliver } = load();
        expect(posted[0]).toEqual({ dfApp: 'chan', type: 'hello' });
        const pending = DF.query('sales', { limit: 2 });
        deliver({ dfApp: 'chan', type: 'init' });
        await DF.ready;
        await Promise.resolve();
        const request = posted.find(message => message.type === 'query');
        expect(request).toMatchObject({ dfApp: 'chan', table: 'sales', options: { limit: 2 } });
        deliver({ dfApp: 'chan', type: 'result', id: request.id, rows: [{ a: 1 }], totalRowCount: 9 });
        await expect(pending).resolves.toEqual({ rows: [{ a: 1 }], totalRowCount: 9 });
    });

    it('rejects undeclared tables and ignores messages from other sources or channels', async () => {
        const { DF, posted, deliver } = load();
        await expect(DF.query('other')).rejects.toThrow(/not declared/);
        deliver({ dfApp: 'chan', type: 'init' }, null);
        deliver({ dfApp: 'wrong', type: 'init' });
        const settled = vi.fn();
        DF.ready.then(settled);
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        expect(posted.filter(message => message.type === 'query')).toHaveLength(0);
        expect(Object.isFrozen(DF)).toBe(true);
    });

    it('formats numbers, percents, deltas, and missing values', () => {
        const { DF } = load();
        expect(DF.format.number(1234.567)).toBe(new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(1235));
        expect(DF.format.number(3.14159, 2)).toBe(new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(3.14));
        expect(DF.format.percent(0.256)).toBe(new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(0.256));
        expect(DF.format.delta(-1.5, 1)).toBe('\u2212' + new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1.5));
        expect(DF.format.delta(2, 0)).toBe('+2');
        for (const missing of [null, undefined, NaN, '', 'n/a']) expect(DF.format.number(missing)).toBe('\u2014');
        expect(DF.format.compact('1500')).toBe(new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(1500));
        expect(DF.format.date('2021-05-01')).toBe(new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
            .format(new Date(Date.UTC(2021, 4, 1))));
    });

    it('validates sparkline fields before rendering', async () => {
        const { DF } = load();
        await expect(DF.sparkline('#spark', [], { x: 'year' })).rejects.toThrow(/needs \{x, y\}/);
        await expect(DF.sparkline('#missing', [], { x: 'year', y: 'value' })).rejects.toThrow(/target not found/);
    });

    it('reports undeclared table queries to the host', async () => {
        const { DF, posted } = load();
        await expect(DF.query('other')).rejects.toThrow(/not declared/);
        expect(posted).toContainEqual({ dfApp: 'chan', type: 'error', message: 'DF.query: Table "other" is not declared in the app manifest.' });
    });

    it('reports host query errors to the caller', async () => {
        const { DF, posted, deliver } = load();
        deliver({ dfApp: 'chan', type: 'init' });
        const pending = DF.table('sales');
        await DF.ready;
        await Promise.resolve();
        const request = posted.find(message => message.type === 'query');
        deliver({ dfApp: 'chan', type: 'result', id: request.id, error: 'boom' });
        await expect(pending).rejects.toThrow('boom');
    });
});
