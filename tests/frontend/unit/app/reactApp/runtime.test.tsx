import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import bridgeSource from '../../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import { createDfTheme } from '../../../../../src/app/theme';
import { FlintChart } from '../../../../../src/app/reactApp/runtime/chart';
import { clearQueryCache, useQuery } from '../../../../../src/app/reactApp/runtime/data';
import { mount } from '../../../../../src/app/reactApp/runtime/index';
import { DataTable, Kpi, QueryView, Select } from '../../../../../src/app/reactApp/runtime/ui';

let realFormat: unknown;
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const installBridge = (overrides: Record<string, unknown> = {}) => {
    const fake = {
        ready: Promise.resolve(), manifest: { version: 2, title: '', tables: ['sales'] }, theme: { palette: ['#4c78a8'], primary: '#0078d4' },
        query: vi.fn(), chart: vi.fn(async () => ({ finalize: vi.fn() })), sparkline: vi.fn(async () => ({ finalize: vi.fn() })),
        format: realFormat, reportError: vi.fn(), ...overrides,
    };
    (window as any).DF = fake;
    return fake;
};

const renderThemed = (node: React.ReactNode) => render(<ThemeProvider theme={createDfTheme('fluent')}>{node}</ThemeProvider>);

beforeAll(() => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    (window as any).__DF_APP_CONFIG__ = { channel: 'test', manifest: { tables: ['sales'] }, theme: {} };
    new Function(bridgeSource)();
    realFormat = (window as any).DF.format;
    vi.restoreAllMocks();
});

beforeEach(() => clearQueryCache());
afterEach(() => { delete (window as any).DF; vi.restoreAllMocks(); });

describe('useQuery', () => {
    const Probe = ({ region, label }: { region: string; label: string }) => {
        const result = useQuery('sales', { filters: [{ field: 'region', op: 'in', values: [region] }] });
        return <div data-testid={label}>{result.loading ? 'loading' : result.error ?? result.rows.map(row => row.n).join(',')}</div>;
    };

    it('shares identical requests and ignores responses for superseded options', async () => {
        const slow = deferred<any>();
        const fast = deferred<any>();
        const bridge = installBridge({ query: vi.fn((_table, options: any) => options.filters[0].values[0] === 'a' ? slow.promise : fast.promise) });
        const { rerender } = render(<><Probe region="a" label="one" /><Probe region="a" label="two" /></>);
        expect(bridge.query).toHaveBeenCalledTimes(1);
        rerender(<><Probe region="b" label="one" /><Probe region="b" label="two" /></>);
        await act(async () => fast.resolve({ rows: [{ n: 2 }], totalRowCount: 1 }));
        await act(async () => slow.resolve({ rows: [{ n: 1 }], totalRowCount: 1 }));
        expect(screen.getByTestId('one')).toHaveTextContent('2');
        expect(screen.getByTestId('two')).toHaveTextContent('2');
        expect(bridge.query).toHaveBeenCalledTimes(2);
    });

    it('reports query errors to the component', async () => {
        installBridge({ query: vi.fn(() => Promise.reject(new Error('Unknown DF.query option "sort"'))) });
        render(<Probe region="a" label="one" />);
        await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('Unknown DF.query option "sort"'));
    });
});

describe('QueryView', () => {
    const query = (overrides: object) => ({ rows: [], totalRowCount: 0, loading: false, error: null, truncated: false, ...overrides });

    it('renders loading, empty, error, and data states', () => {
        installBridge();
        const view = (q: object) => <QueryView query={query(q)} empty="Nothing here">{rows => <span>{rows.length} rows</span>}</QueryView>;
        const { rerender, container } = renderThemed(view({ loading: true }));
        expect(container.querySelector('.MuiSkeleton-root')).not.toBeNull();
        rerender(<ThemeProvider theme={createDfTheme('fluent')}>{view({})}</ThemeProvider>);
        expect(screen.getByText('Nothing here')).toBeInTheDocument();
        rerender(<ThemeProvider theme={createDfTheme('fluent')}>{view({ error: 'boom' })}</ThemeProvider>);
        // Muted in place; the host banner is the only alert.
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Data unavailable');
        expect(screen.getByRole('status')).toHaveAttribute('title', 'boom');
        rerender(<ThemeProvider theme={createDfTheme('fluent')}>{view({ rows: [{}, {}] })}</ThemeProvider>);
        expect(screen.getByText('2 rows')).toBeInTheDocument();
    });
});

describe('components', () => {
    it('DataTable formats, sorts, and notes truncation', () => {
        installBridge();
        renderThemed(<DataTable query={{ rows: [{ name: 'b', value: 1500 }, { name: 'a', value: 25000 }], totalRowCount: 10, loading: false, error: null, truncated: true }}
            columns={[{ field: 'name', label: 'Name' }, { field: 'value', label: 'Value', format: 'compact', bar: true }]} />);
        const firstCells = () => screen.getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[0].textContent);
        expect(firstCells()).toEqual(['b', 'a']);
        expect(screen.getAllByRole('row')[1]).toHaveTextContent(new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(1500));
        fireEvent.click(screen.getByText('Value'));
        expect(firstCells()).toEqual(['a', 'b']);
        expect(screen.getByText(/Showing 2 of 10 rows/)).toBeInTheDocument();
    });

    it('Select returns the original option value', () => {
        installBridge();
        const onChange = vi.fn();
        renderThemed(<Select label="Year" value={2020} onChange={onChange} options={[2020, 2021]} />);
        fireEvent.mouseDown(screen.getByRole('combobox'));
        fireEvent.click(screen.getByRole('option', { name: '2021' }));
        expect(onChange).toHaveBeenCalledWith(2021);
    });

    it('Kpi marks a drop as good when lower is better', () => {
        installBridge();
        renderThemed(<Kpi label="Cost" value="$12" delta={-0.25} deltaFormat={value => `${value * 100}%`} goodDirection="down" />);
        const chip = screen.getByText('-25%');
        expect(chip).toHaveTextContent('▼-25%');
        expect(chip).toHaveStyle({ color: createDfTheme('fluent').palette.success.main });
    });
});

describe('FlintChart', () => {
    beforeEach(() => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 300 } as DOMRect);
    });

    it('compiles semantic encodings with the table semantics and renders through the bridge', async () => {
        const bridge = installBridge();
        (window as any).__DF_APP_CONFIG__ = { semantics: { sales: { month: { semanticType: 'YearMonth', displayName: 'Month' } } } };
        renderThemed(<FlintChart chartType="Line Chart" table="sales" data={[{ month: '2024-01', revenue: 3 }, { month: '2024-02', revenue: 5 }]}
            encodings={{ x: 'month', y: 'revenue' }} labels={{ revenue: 'Revenue (USD)' }} />);
        await waitFor(() => expect(bridge.chart).toHaveBeenCalled());
        const spec = bridge.chart.mock.calls[0][1] as any;
        expect(spec.data.values).toHaveLength(2);
        expect(spec.encoding.x).toMatchObject({ field: 'month', type: 'temporal', title: 'Month' });
        expect(spec.encoding.y.title).toBe('Revenue (USD)');
        // The whole chart, legend included, fits the 800px container.
        expect(spec).toMatchObject({ width: 800, autosize: { type: 'fit-x', contains: 'padding' } });
    });

    it('shows and reports an unknown chart type', async () => {
        const bridge = installBridge();
        renderThemed(<FlintChart chartType="Nope Chart" data={[{ a: 1 }]} encodings={{ x: 'a' }} />);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Chart unavailable'));
        expect(bridge.reportError).toHaveBeenCalledWith(expect.stringContaining('FlintChart'));
    });
});

describe('mount', () => {
    it('renders the default export and reports apps that cannot start', async () => {
        const bridge = installBridge();
        const container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            mount((require, module) => {
                const { jsx } = require('react/jsx-runtime') as any;
                module.exports.default = () => jsx('h1', { children: 'Hello app' });
            }, container);
        });
        expect(container).toHaveTextContent('Hello app');

        const broken = document.createElement('div');
        document.body.appendChild(broken);
        await act(async () => { mount(require => { require('lodash'); }, broken); });
        expect(broken).toHaveTextContent('Cannot import "lodash"');
        expect(bridge.reportError).toHaveBeenCalledWith(expect.stringContaining('Cannot import "lodash"'));
    });

    it('catches render errors in an error boundary', async () => {
        const bridge = installBridge();
        const container = document.createElement('div');
        document.body.appendChild(container);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await act(async () => {
            mount((_require, module) => { module.exports.default = () => { throw new Error('bad render'); }; }, container);
        });
        expect(container).toHaveTextContent('bad render');
        expect(bridge.reportError).toHaveBeenCalledWith('App crashed: bad render');
    });
});
