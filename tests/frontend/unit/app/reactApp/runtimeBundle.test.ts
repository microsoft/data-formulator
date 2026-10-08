import fs from 'fs';
import path from 'path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import runtimeBundle from 'virtual:df-react-runtime';
import bridgeSource from '../../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import { compileReactApp, mountScript } from '../../../../../src/app/reactApp/compile';

// The starter app the html_app skill teaches the agent, run through the real
// host compiler and the bundled sandbox runtime.
const skill = fs.readFileSync(path.resolve(__dirname, '../../../../../py-src/data_formulator/analyst/skills/html_app/SKILL.md'), 'utf8');
const starter = skill.split('```jsx')[1].split('```')[0];

const sales = [
    { month: '2024-01', region: 'East', product: 'Tea', revenue: 120, orders: 4 },
    { month: '2024-02', region: 'East', product: 'Coffee', revenue: 180, orders: 6 },
    { month: '2024-03', region: 'West', product: 'Tea', revenue: 150, orders: 5 },
];

function answer(options: any) {
    const filtered = sales.filter(row => (options.filters ?? []).every((filter: any) => filter.values.includes(row[filter.field])));
    const [key] = options.columns;
    const groups = new Map<string, any[]>();
    for (const row of filtered) groups.set(row[key], [...(groups.get(row[key]) ?? []), row]);
    const rows = [...groups].map(([value, items]) => {
        const out: any = { [key]: value, _count: items.length };
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
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 900, height: 300 } as DOMRect);
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    (window as any).__DF_APP_CONFIG__ = { channel: 'test', manifest: { tables: ['sales'] }, theme: {}, paletteKey: 'fluent' };
    new Function(bridgeSource)();
    const format = (window as any).DF.format;
    query = vi.fn(async (_table: string, options: any) => answer(options));
    chart = vi.fn(async () => ({ finalize: vi.fn() }));
    (window as any).DF = { ready: Promise.resolve(), manifest: { tables: ['sales'] }, theme: { palette: ['#4c78a8'] },
        query, chart, sparkline: vi.fn(async () => ({ finalize: vi.fn() })), format, reportError: vi.fn() };
    new Function(runtimeBundle)();
});

afterAll(() => { vi.restoreAllMocks(); delete (window as any).DF; delete (window as any).__DF_REACT__; });

it('runs the skill starter app end to end in the bundled runtime', async () => {
    const compiled = compileReactApp(starter);
    expect(compiled).toMatchObject({ ok: true });
    if (!compiled.ok) return;
    const root = document.createElement('div');
    root.id = 'df-app-root';
    document.body.appendChild(root);
    const appRoot = new Function(`return ${mountScript(compiled.code)}`)();

    await waitFor(() => expect(screen.getByText('Revenue grew through the year')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Coffee')).toBeInTheDocument());
    expect(screen.getAllByText('Total')).toHaveLength(2);
    expect(query).toHaveBeenCalledWith('sales', expect.objectContaining({ columns: ['month'], aggregates: [{ op: 'sum', field: 'revenue' }] }));
    await waitFor(() => expect(chart).toHaveBeenCalled());
    expect((window as any).DF.reportError).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    await waitFor(() => expect(query).toHaveBeenCalledWith('sales', expect.objectContaining({ aggregates: [{ op: 'sum', field: 'orders' }] })));
    appRoot.unmount();
});

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
