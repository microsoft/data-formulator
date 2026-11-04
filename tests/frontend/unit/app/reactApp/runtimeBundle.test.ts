import fs from 'fs';
import path from 'path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import * as vega from 'vega';
import * as vegaLite from 'vega-lite';
import runtimeBundle from 'virtual:df-react-runtime';
import flintLinksBundle from 'virtual:df-react-runtime/flint-links';
import bridgeSource from '../../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import { compileReactApp, mountScript } from '../../../../../src/app/reactApp/compile';

// The apps the html_app skill teaches the agent (its complete examples), run through the real
// host compiler and the bundled sandbox runtime.
const skill = fs.readFileSync(path.resolve(__dirname, '../../../../../py-src/data_formulator/analyst/skills/html_app/SKILL.md'), 'utf8');
const examples = skill.split('```jsx').slice(1).map(block => block.split('```')[0]).filter(code => code.includes('export default'));
const [starter, story] = examples;

const sales = [
    { month: '2024-01', region: 'East', product: 'Tea', revenue: 120, orders: 4 },
    { month: '2024-02', region: 'East', product: 'Coffee', revenue: 180, orders: 6 },
    { month: '2024-03', region: 'West', product: 'Tea', revenue: 150, orders: 5 },
];

function answer(options: any) {
    const filtered = sales.filter(row => (options.filters ?? []).every((filter: any) => filter.values.includes(row[filter.field])));
    const keys: string[] = options.columns;
    const groups = new Map<string, any[]>();
    for (const row of filtered) {
        const id = JSON.stringify(keys.map(key => row[key]));
        groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    const rows = [...groups.values()].map(items => {
        const out: any = { ...Object.fromEntries(keys.map(key => [key, items[0][key]])), _count: items.length };
        for (const aggregate of options.aggregates ?? []) {
            if (aggregate.op === 'sum') out[`${aggregate.field}_sum`] = items.reduce((sum, item) => sum + item[aggregate.field], 0);
        }
        return out;
    });
    return { rows: rows.slice(0, options.limit ?? 5000), totalRowCount: rows.length };
}

let query: ReturnType<typeof vi.fn>;
let chart: ReturnType<typeof vi.fn>;

beforeAll(() => {
    // jsdom draws SVG without layout; Flint falls back to Vega's origin when an element has no CTM.
    (SVGElement.prototype as any).getCTM ??= () => null;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 300 } as DOMRect);
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    (window as any).__DF_APP_CONFIG__ = { channel: 'test', manifest: { tables: ['sales'] }, theme: {}, paletteKey: 'fluent' };
    new Function(bridgeSource)();
    const format = (window as any).DF.format;
    query = vi.fn(async (_table: string, options: any) => answer(options));
    chart = vi.fn(async () => ({ finalize: vi.fn() }));
    (window as any).DF = { ready: Promise.resolve(), manifest: { tables: ['sales'] }, theme: { palette: ['#4c78a8'] },
        query, chart, sparkline: vi.fn(async () => ({ finalize: vi.fn() })), format, reportError: vi.fn() };
    // The app frame loads vega and vega-lite as scripts before the runtime; Flint draws with them.
    Object.assign(window, { vega, vegaLite });
    new Function(runtimeBundle)();
});

afterAll(() => { vi.restoreAllMocks(); for (const name of ['DF', '__DF_REACT__', 'vega', 'vegaLite']) delete (window as any)[name]; });

it('runs the skill starter app end to end in the bundled runtime', async () => {
    const compiled = compileReactApp(starter);
    expect(compiled).toMatchObject({ ok: true });
    if (!compiled.ok) return;
    const root = document.createElement('div');
    root.id = 'df-app-root';
    document.body.appendChild(root);
    const appRoot = new Function(`return ${mountScript(compiled.code)}`)();

    // The header: a title from the data (the period's growth, or the topic) and a context line with its source.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Revenue grew|Monthly sales/));
    await waitFor(() => expect(document.querySelector('[data-df-header-meta]')?.textContent).toContain('Source: sales table'));
    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
    expect(screen.getAllByText('Total')).toHaveLength(2);
    expect(query).toHaveBeenCalledWith('sales', expect.objectContaining({ columns: ['month'], aggregates: [{ op: 'sum', field: 'revenue' }] }));
    // Flint draws the chart itself, with the frame's vega.
    await waitFor(() => expect(document.querySelector('[data-flint-chart] svg')).not.toBeNull());
    expect((window as any).DF.reportError).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await waitFor(() => expect(query).toHaveBeenCalledWith('sales', expect.objectContaining({ aggregates: [{ op: 'sum', field: 'orders' }] })));
    appRoot.unmount();
});

it('teaches complete apps: a starter dashboard and a story', () => {
    expect(examples).toHaveLength(2);
    expect(story).toContain('function Step');
});

it('runs the skill story example: each step its text beside its own chart', async () => {
    // The host injects Flint's validators into an app that sets a chart's focus, so it is checked.
    new Function(flintLinksBundle)();
    const compiled = compileReactApp(story);
    expect(compiled).toMatchObject({ ok: true, optionalModules: ['flint-links'] });
    if (!compiled.ok) return;
    (window as any).DF.reportError.mockClear();
    document.getElementById('df-app-root')?.remove();
    const root = document.createElement('div');
    root.id = 'df-app-root';
    document.body.appendChild(root);
    const appRoot = new Function(`return ${mountScript(compiled.code)}`)();

    await waitFor(() => expect(screen.getByText('East led the year')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Start with East')).toBeInTheDocument());
    // Five steps, each a title and text beside its own chart.
    const titles = [...document.querySelectorAll('h2')].map(heading => heading.textContent);
    expect(titles.slice(0, 5)).toEqual(['Start with East', 'Against the other regions', 'East pulled ahead late in the year',
        'Over the whole year', 'Explore it']);
    await waitFor(() => expect(document.querySelector('[data-flint-chart] svg')).not.toBeNull(), { timeout: 10000 });
    await new Promise(resolve => setTimeout(resolve, 800));
    expect((window as any).DF.reportError).not.toHaveBeenCalled();
    appRoot.unmount();
}, 30000);

it('defers mounting until the app root exists, as when runtime scripts run in <head>', async () => {
    const compiled = compileReactApp("export default function App() { return <p>Deferred app</p>; }");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    document.getElementById('df-app-root')?.remove();
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    new Function(mountScript(compiled.code))();
    expect((window as any).DF.reportError).not.toHaveBeenCalled();
    readyState.mockRestore();
    const root = document.createElement('div');
    root.id = 'df-app-root';
    document.body.appendChild(root);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await waitFor(() => expect(root).toHaveTextContent('Deferred app'));
});
