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
    surface: '#fafafa', border: '#ddd', primary: '#0067b8', palette: ['#4c78a8'],
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
