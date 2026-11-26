import { afterEach, describe, expect, it, vi } from 'vitest';

import runtimeSource from '../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import {
    APP_CSP,
    CONTAINER_CSP,
    CONTAINER_DOCUMENT,
    DEFAULT_QUERY_ROWS,
    MAX_QUERY_ROWS,
    buildAppDocument,
    collectLinks,
    collectRowLinks,
    normalizeAppQuery,
    parseAppManifest,
    stripRowIds,
    webLink,
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

    it("applies the host look's variables after the kit and before author styles, keeping only --df- names", () => {
        const output = buildAppDocument('<head><style>.author{}</style></head><body></body>', {
            runtimeScripts: [], config: {}, kitStylesheet: ':root{--df-radius-md:8px}',
            theme: { ...theme, lookVars: { '--df-radius-md': '2px', 'color': 'red', '--df-shadow-sm': 'none;}body{x:1' } },
        });
        const look = output.indexOf('--df-radius-md:2px');
        expect(look).toBeGreaterThan(output.indexOf('--df-radius-md:8px'));
        expect(look).toBeLessThan(output.indexOf('.author{}'));
        expect(output).not.toContain('color:red');
        expect(output).not.toContain('}body{');
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

describe('app link addresses', () => {
    it('collects literal web addresses from code and data, but not templated or unsafe ones', () => {
        const links = new Set<string>();
        collectLinks('<a href="https://neurips.cc/virtual/2026?a=1&amp;b=2">x</a> see (https://en.wikipedia.org/wiki/A_(b)).'
            + ' `https://arxiv.org/abs/${id}` https://user:pw@example.com/ ftp://example.com/', links);
        collectRowLinks([{ url: 'https://openreview.net/forum?id=abc', n: 3 }, 'https://ignored.example/'], links);
        expect([...links]).toEqual(expect.arrayContaining([
            'https://neurips.cc/virtual/2026?a=1&b=2',
            'https://en.wikipedia.org/wiki/A_(b)',
            'https://openreview.net/forum?id=abc',
        ]));
        expect(links.has('https://arxiv.org/abs/123')).toBe(false);
        expect([...links].some(link => link.includes('user') || link.includes('ignored'))).toBe(false);
        expect(webLink('https://user:pw@example.com/')).toBeNull();
        expect(webLink('HTTPS://Example.com')?.href).toBe('https://example.com/');
    });
});

describe('DF app runtime', () => {
    const originalOpen = window.open;
    afterEach(() => {
        for (const [type, listener, options] of vi.mocked(window.addEventListener).mock.calls) {
            window.removeEventListener(type, listener, options);
        }
        window.open = originalOpen;
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        delete (window as any).DF;
        delete (window as any).__DF_APP_CONFIG__;
        vi.restoreAllMocks();
    });

    const load = () => {
        const posted: any[] = [];
        vi.spyOn(window, 'addEventListener');
        vi.spyOn(window, 'postMessage').mockImplementation((message: any) => { posted.push(message); });
        (window as any).__DF_APP_CONFIG__ = { channel: 'chan', manifest, theme, hostOrigin: '*' };
        new Function(runtimeSource)();
        const deliver = (data: unknown, source: unknown = window) =>
            window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
        return { DF: (window as any).DF, posted, deliver };
    };

    it('keeps fragment links inside the app, including nested link content and encoded section IDs', () => {
        load();
        const section = document.createElement('section');
        section.id = 'all papers';
        section.scrollIntoView = vi.fn();
        const link = document.createElement('a');
        link.href = '#all%20papers';
        link.innerHTML = '<span>All papers</span>';
        document.body.append(link, section);
        try {
            const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
            link.firstElementChild!.dispatchEvent(click);
            expect(click.defaultPrevented).toBe(true);
            expect(window.location.hash).toBe('#all%20papers');
            expect(section.scrollIntoView).toHaveBeenCalledOnce();
        } finally {
            link.remove();
            section.remove();
        }
    });

    it('supports hash routes without section elements and leaves app-handled clicks alone', () => {
        load();
        const link = document.createElement('a');
        link.href = '#/papers/42';
        document.body.append(link);
        try {
            link.click();
            expect(window.location.hash).toBe('#/papers/42');
            link.href = '#/papers/43';
            link.onclick = event => event.preventDefault();
            link.click();
            expect(window.location.hash).toBe('#/papers/42');
        } finally {
            link.remove();
        }
    });

    it('reports malformed fragments instead of attempting navigation', () => {
        const { posted } = load();
        const link = document.createElement('a');
        link.href = '#%zz';
        document.body.append(link);
        try {
            const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
            link.dispatchEvent(click);
            expect(click.defaultPrevented).toBe(true);
            expect(posted).toContainEqual({ dfApp: 'chan', type: 'error', message: 'Cannot navigate to an invalid section link: #%zz' });
        } finally {
            link.remove();
        }
    });

    it.each(['click', 'auxclick'])('does not forward scripted external-link %s events', type => {
        const { posted } = load();
        const link = document.createElement('a');
        link.href = 'https://neurips.cc/virtual/2026';
        document.body.append(link);
        try {
            const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'click' ? 0 : 1 });
            link.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            expect(posted.some(message => message.type === 'openExternal')).toBe(false);
            expect(posted).toContainEqual({ dfApp: 'chan', type: 'error', message: 'External links must be opened by a user click.' });
        } finally {
            link.remove();
        }
    });

    it.each(['data:text/html,test', 'file:///tmp/test.html', './papers.html'])('prevents unsupported link navigation: %s', href => {
        const { posted } = load();
        const link = document.createElement('a');
        link.href = href;
        document.body.append(link);
        try {
            const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
            link.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            expect(posted.some(message => message.type === 'openExternal')).toBe(false);
            expect(posted.some(message => message.type === 'error')).toBe(true);
        } finally {
            link.remove();
        }
    });

    it('leaves javascript: links and middle clicks on section links to the browser', () => {
        const { posted } = load();
        const link = document.createElement('a');
        link.href = 'javascript:void(0)';
        document.body.append(link);
        try {
            const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
            link.dispatchEvent(click);
            link.href = '#library';
            const middle = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
            link.dispatchEvent(middle);
            expect(click.defaultPrevented).toBe(false);
            expect(middle.defaultPrevented).toBe(false);
            expect(window.location.hash).toBe('');
            expect(posted.some(message => message.type === 'error')).toBe(false);
        } finally {
            link.remove();
        }
    });

    it('keeps links in the app when an app handler stops propagation, unless it prevents the default', async () => {
        load();
        const card = document.createElement('div');
        const link = document.createElement('a');
        link.href = '#/papers/42';
        card.append(link);
        document.body.append(card);
        let prevent = false;
        card.addEventListener('click', event => {
            event.stopPropagation();
            if (prevent) event.preventDefault();
        });
        try {
            const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
            link.dispatchEvent(click);
            expect(click.defaultPrevented).toBe(true);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(window.location.hash).toBe('#/papers/42');
            prevent = true;
            link.href = '#/papers/43';
            link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(window.location.hash).toBe('#/papers/42');
        } finally {
            card.remove();
        }
    });

    it('opens window.open web pages through the host and reports unsupported addresses', () => {
        const { posted } = load();
        expect(window.open(' https://openreview.net/forum?id=abc ', '_blank')).toBeNull();
        expect(posted).toContainEqual({ dfApp: 'chan', type: 'openExternal', url: 'https://openreview.net/forum?id=abc' });
        window.open('javascript:alert(1)');
        expect(posted).toContainEqual({ dfApp: 'chan', type: 'error', message: 'Only HTTP(S) web links without embedded credentials can be opened.' });
    });

    it('reports download links, which the sandbox cannot save', () => {
        const { posted } = load();
        const link = document.createElement('a');
        link.href = 'https://example.com/papers.csv';
        link.setAttribute('download', '');
        document.body.append(link);
        try {
            link.click();
            expect(posted).toContainEqual({ dfApp: 'chan', type: 'error', message: 'Downloads are not available in apps.' });
            expect(posted.some(message => message.type === 'openExternal')).toBe(false);
        } finally {
            link.remove();
        }
    });

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

    it('never runs code sent in a capture request; the capture library comes with the document', () => {
        const { posted, deliver } = load();
        deliver({ dfApp: 'chan', type: 'capture', id: 'shot', script: 'window.__ranFromMessage = true' });
        expect((window as any).__ranFromMessage).toBeUndefined();
        expect(posted).toContainEqual(expect.objectContaining({ type: 'captured', id: 'shot', error: 'The capture library did not load.' }));
    });
});
