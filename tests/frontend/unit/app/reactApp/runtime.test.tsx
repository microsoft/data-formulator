import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import bridgeSource from '../../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import { createDfTheme } from '../../../../../src/app/theme';
import { ChartLink, FlintChart, fitChartToWidth, flintChartInput, useChartLink } from '../../../../../src/app/reactApp/runtime/chart';
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

    it('gives Flint the rows, the table semantics and display names, and the interactions', () => {
        (window as any).__DF_APP_CONFIG__ = { semantics: { sales: { month: { semanticType: 'YearMonth', displayName: 'Month' } } } };
        const input = flintChartInput({ chartType: 'Line Chart', table: 'sales', encodings: { x: 'month', y: 'revenue' },
            labels: { revenue: 'Revenue (USD)' }, theme: 'economist', title: 'Revenue', interactions: ['inspect-index', { type: 'brush-x', options: { mode: 'stateful' } }] },
            [{ month: '2024-01', revenue: 3 }], 800) as any;
        expect(input.data.values).toHaveLength(1);
        expect(input.semantic_types).toEqual({ month: 'YearMonth' });
        expect(input.field_display_names).toEqual({ month: 'Month', revenue: 'Revenue (USD)' });
        expect(input.chart_spec).toMatchObject({ chartType: 'Line Chart', encodings: { x: { field: 'month' }, y: { field: 'revenue' } },
            title: 'Revenue', baseSize: { width: 800, height: 260 } });
        expect(input.theme_spec).toBe('economist');
        expect(input.interaction_spec).toEqual({ interactions: [{ type: 'inspect-index' }, { type: 'brush-x', options: { mode: 'stateful' } }] });
    });

    // Flint's first mount loads its renderer, which takes a second or more under jsdom.
    it('draws with Flint into its card', async () => {
        const bridge = installBridge();
        const { container } = renderThemed(<FlintChart chartType="Bar Chart" data={[{ region: 'East', revenue: 3 }, { region: 'West', revenue: 5 }]}
            encodings={{ x: 'region', y: 'revenue' }} interactions={['click-highlight']} />);
        await waitFor(() => expect(container.querySelector('[data-flint-chart] svg')).not.toBeNull(), { timeout: 10000 });
        expect(bridge.reportError).not.toHaveBeenCalled();
    }, 15000);

    it('shows and reports an unknown chart type', async () => {
        const bridge = installBridge();
        renderThemed(<FlintChart chartType="Nope Chart" data={[{ a: 1 }]} encodings={{ x: 'a' }} />);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Chart unavailable'));
        expect(bridge.reportError).toHaveBeenCalledWith(expect.stringContaining('FlintChart'), false);
    });

    it('keeps a long discrete axis at its step, scrolling inside the card', () => {
        const rows = Array.from({ length: 200 }, (_, index) => ({ name: `item ${index}`, value: index }));
        const spec = { mark: 'bar', width: { step: 20 }, encoding: {} };
        expect(fitChartToWidth(spec, 800, rows, 'name')).toBe(spec);
        expect(fitChartToWidth(spec, 800, rows.slice(0, 30), 'name')).toMatchObject({ width: 800, autosize: { type: 'fit-x' } });
    });

    it('shares a selection across linked charts, and lets a control or table read and set it', async () => {
        installBridge();
        const rows = [{ region: 'East', revenue: 3 }, { region: 'West', revenue: 5 }];
        let link: ReturnType<typeof useChartLink> | undefined;
        const Probe = () => { link = useChartLink(); return <p data-testid="linked">{rows.filter(link.matches).map(row => row.region).join(',') || 'none'}</p>; };
        renderThemed(<ChartLink fields={['region']}>
            <FlintChart chartType="Bar Chart" data={rows} encodings={{ x: 'region', y: 'revenue' }} interactions={['click-highlight']} />
            <Probe />
        </ChartLink>);
        const linked = () => screen.getByTestId('linked').textContent;
        expect(linked()).toBe('East,West');
        // The link validator loads lazily; a selection before it arrives is not kept.
        await waitFor(() => {
            act(() => link!.select({ region: { in: ['West'] } }));
            expect(linked()).toBe('West');
        }, { timeout: 10000 });
        expect(link!.active).toBe(true);
        act(() => link!.clear());
        await waitFor(() => expect(linked()).toBe('East,West'));
        expect(link!.active).toBe(false);
    }, 15000);
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
        await act(async () => { mount(require => { require('moment'); }, broken); });
        expect(broken).toHaveTextContent('Cannot import "moment"');
        expect(bridge.reportError).toHaveBeenCalledWith(expect.stringContaining('Cannot import "moment"'), true);
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
        expect(bridge.reportError).toHaveBeenCalledWith('App crashed: bad render', true);
    });
});
