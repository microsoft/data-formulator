import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import bridgeSource from '../../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import { createDfTheme } from '../../../../../src/app/theme';
import { FlintChart, annotationLayers, chartErrorMessage, chartFilters, explicitChannelSorts, fitChartToWidth, hideLayers, flintChartInput, focusLayers, inFieldTerms, resolveChartProps, selectPreset, selectionFocus, surfaceBehind, viewLayers } from '../../../../../src/app/reactApp/runtime/chart';
import { pageLook } from '../../../../../src/app/reactApp/runtime/appTheme';
import { clearQueryCache, useQuery } from '../../../../../src/app/reactApp/runtime/data';
import { mount, requireModule } from '../../../../../src/app/reactApp/runtime/index';
import * as MUI from '@mui/material';
import { DataTable } from '../../../../../src/app/reactApp/runtime/table';
import { QueryView } from '../../../../../src/app/reactApp/runtime/states';
import { AppThemeProvider } from '../../../../../src/app/reactApp/runtime/appTheme';

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
    // jsdom draws SVG without layout; Flint falls back to Vega's origin when an element has no CTM.
    (SVGElement.prototype as any).getCTM ??= () => null;
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

    it('DataTable groups rows under subtotals, with a grand total, and folds a group', () => {
        installBridge();
        const rows = [
            { region: 'East', category: 'A', revenue: 10 }, { region: 'West', category: 'A', revenue: 5 },
            { region: 'East', category: 'B', revenue: 30 },
        ];
        renderThemed(<DataTable data={rows} groupBy="region" sortable={false}
            columns={[{ field: 'region', label: 'Region' }, { field: 'category' }, { field: 'revenue', total: 'sum', heat: true }]} />);
        const text = () => screen.getAllByRole('row').slice(1).map(row => row.textContent);
        expect(text()).toEqual(['▶East(2)40', 'A10', 'B30', '▶West(1)5', 'A5', 'Total45']);
        fireEvent.click(screen.getByText('East'));
        expect(text()).toEqual(['▶East(2)40', '▶West(1)5', 'A5', 'Total45']);
    });

    it('AppTheme gives the page its inks and its charts the theme', () => {
        installBridge();
        const look = pageLook('powerbi');
        expect(look).toMatchObject({ dark: true, page: '#252423', tile: '#1b1a19', text: '#f3f2f1' });
        expect(look.vars).toMatchObject({ '--df-canvas': '#252423', '--df-surface': '#1b1a19', '--df-text': '#f3f2f1' });
        // A dark page's scrollbars are light on dark; a light page keeps the runtime's muted dark ones.
        expect(look.vars['--df-scrollbar']).toBe('rgba(255, 255, 255, 0.16)');
        expect(pageLook('nyt').vars['--df-scrollbar']).toBeUndefined();
        // A theme that draws on the host's page keeps DF's surfaces.
        expect(pageLook('nyt').vars['--df-canvas']).toBeUndefined();
        expect(pageLook({ extends: 'nyt', ink: { text: { primary: '#111111' } } }).text).toBe('#111111');
        // A saved theme is used by its id; an id that names nothing draws with defaults, and is reported.
        (window as any).__DF_APP_CONFIG__ = { themes: { acme: { id: 'acme', extends: 'powerbi', ink: { text: { primary: '#eeeeee' } } } } };
        expect(pageLook('acme')).toMatchObject({ dark: true, text: '#eeeeee', page: '#252423' });
        const bridge = installBridge();
        expect(pageLook('nope').vars).toEqual({});
        expect(bridge.reportError).toHaveBeenCalledWith(expect.stringContaining('Theme "nope" is not a Flint preset'), false);
        (window as any).__DF_APP_CONFIG__ = {};
        renderThemed(<AppThemeProvider theme="powerbi"><span>x</span></AppThemeProvider>);
        expect(getComputedStyle(document.documentElement).getPropertyValue('--df-canvas')).toBe('#252423');
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

    it('passes the chart\'s own headline, deck, kicker and source to Flint', () => {
        const input = flintChartInput({ chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' }, title: 'West sold the most',
            subtitle: 'Revenue by region, USD', kicker: 'Sales', source: 'sales table' }, [{ region: 'West', revenue: 1 }], 400) as any;
        expect(input.chart_spec).toMatchObject({ title: 'West sold the most', subtitle: 'Revenue by region, USD', label: 'Sales', source: 'sales table' });
    });

    // Flint's first mount loads its renderer, which takes a second or more under jsdom.
    it('draws with Flint into its card', async () => {
        const bridge = installBridge();
        const { container } = renderThemed(<FlintChart chartType="Bar Chart" data={[{ region: 'East', revenue: 3 }, { region: 'West', revenue: 5 }]}
            encodings={{ x: 'region', y: 'revenue' }} interactions={['click-highlight']} />);
        await waitFor(() => expect(container.querySelector('[data-flint-chart] svg')).not.toBeNull(), { timeout: 10000 });
        expect(bridge.reportError).not.toHaveBeenCalled();
    }, 15000);

    it('takes its column\'s width, and with height="fill" its container\'s height, through a query too', async () => {
        installBridge();
        const rows = [{ region: 'East', revenue: 3 }, { region: 'West', revenue: 5 }];
        const { container } = renderThemed(<FlintChart chartType="Bar Chart" height="fill" encodings={{ x: 'region', y: 'revenue' }}
            query={{ rows, totalRowCount: 2, loading: false, error: null, truncated: false }} />);
        const box = container.querySelector('[data-flint-chart]') as HTMLElement;
        // Its drawing never widens or heightens its container…
        expect(getComputedStyle(box).contain).toBe('size');
        // …and the query's wrapper passes the container's room on.
        expect(getComputedStyle(box.parentElement!).height).toBe('100%');
        await waitFor(() => expect(container.querySelector('[data-flint-chart] svg')).not.toBeNull(), { timeout: 10000 });
        // The 300 px the container gives it, to the nearest few pixels.
        expect(container.querySelector('[data-flint-chart] svg')?.closest('div[style*="height"]')?.getAttribute('style')).toContain('height: 300px');
    }, 15000);

    it('shows and reports an unknown chart type', async () => {
        const bridge = installBridge();
        renderThemed(<FlintChart chartType="Nope Chart" data={[{ a: 1 }]} encodings={{ x: 'a' }} />);
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Chart unavailable'));
        expect(bridge.reportError).toHaveBeenCalledWith(expect.stringContaining('FlintChart'), false);
    });

    it('draws a session chart by id, over which the app props apply', () => {
        const charts = { 'chart-1': { chart_type: 'Bar Chart', table: 'sales', title: 'Revenue by region', theme: 'economist',
            encodings: { x: { field: 'region' }, y: { field: 'revenue', aggregate: 'sum' }, color: { field: 'region' } }, config: { cornerRadius: 2 } } };
        const resolved = resolveChartProps({ chart: 'chart-1', height: 200, encodings: { color: null }, chartProperties: { barWidth: 0.5 } }, undefined, charts) as any;
        expect(resolved).toMatchObject({ chartType: 'Bar Chart', table: 'sales', title: 'Revenue by region', theme: 'economist', height: 200,
            chartProperties: { cornerRadius: 2, barWidth: 0.5 } });
        expect(resolved.encodings).toEqual({ x: { field: 'region' }, y: { field: 'revenue', aggregate: 'sum' } });
        // The page's theme comes before the chart's own; the app's title (even none) before the chart's.
        expect(resolveChartProps({ chart: 'chart-1', title: '' }, 'nyt', charts)).toMatchObject({ theme: 'nyt', title: '' });
        expect(resolveChartProps({ spec: charts['chart-1'], theme: 'powerbi' }, 'nyt')).toMatchObject({ theme: 'powerbi', chartType: 'Bar Chart' });
        expect(resolveChartProps({ chart: 'missing' }, undefined, charts)).toBe('No chart "missing" in this session; its charts are "chart-1".');
        expect(resolveChartProps({ encodings: { x: 'a' } })).toMatch(/needs a chartType/);
    });

    it('reads a referenced chart\'s table itself, asking for the columns it draws', async () => {
        (window as any).__DF_APP_CONFIG__ = { charts: { c1: { chart_type: 'Bar Chart', table: 'sales', encodings: { x: { field: 'region' }, y: { field: 'revenue' } } } } };
        const bridge = installBridge({ query: vi.fn(async () => ({ rows: [{ region: 'East', revenue: 3 }], totalRowCount: 1 })) });
        const { container } = renderThemed(<FlintChart chart="c1" />);
        await waitFor(() => expect(bridge.query).toHaveBeenCalledWith('sales', { columns: ['region', 'revenue'], limit: 50000 }));
        await waitFor(() => expect(container.querySelector('[data-flint-chart]')).not.toBeNull());
        delete (window as any).__DF_APP_CONFIG__.charts;
    });

    it('hides an axis title given an empty label', () => {
        const input = flintChartInput({ chartType: 'Bar Chart', encodings: { x: 'region', y: 'revenue' }, labels: { region: '', revenue: 'Revenue' } },
            [{ region: 'East', revenue: 3 }], 800) as any;
        expect(input.field_display_names).toMatchObject({ region: ' ', revenue: 'Revenue' });
    });

    it('draws annotations as notes, lines and bands through the chart\'s scales', () => {
        const rows = [{ year: 2019, value: 1 }, { year: 2021, value: 4 }, { year: 2020, value: 2 }];
        const ops = (annotationLayers([
            { y: 2, text: 'Target', dashed: true },
            { x: [2019, 2020], text: 'Recession' },
            { at: { year: 2021 }, text: 'Peak' },
        ], rows, { x: 'year', y: 'value' }) as any[]).flatMap(layer => layer.ops);
        expect(ops[0]).toMatchObject({ op: 'set-overlay', value: { mark: 'rule', data: { values: [{ y: 2 }] }, style: { strokeDash: [4, 3] } } });
        // A horizontal line's label sits at the plot's far end; a band's at the top, beside its start.
        expect(ops[1]).toMatchObject({ value: { mark: 'text', data: { values: [{ x: 2021, y: 2, text: 'Target' }] }, style: { textAlign: 'end' } } });
        expect(ops[2]).toMatchObject({ value: { mark: 'rect', data: { values: [{ x: 2019, x2: 2020 }] } } });
        expect(ops[3]).toMatchObject({ value: { mark: 'text', data: { values: [{ x: 2019, y: 4, text: 'Recession' }] } } });
        expect(ops[4]).toEqual({ op: 'set-annotation', target: { select: { key: { year: 2021 } } }, value: { text: 'Peak' } });
        expect(annotationLayers([], rows, { x: 'year' })).toEqual([]);
        // Each annotation is its own update, so one that misses does not drop the others.
        expect(annotationLayers([{ y: 1 }, { y: 2 }], rows, { x: 'year', y: 'value' }).map(layer => layer.id)).toEqual(['df-annotation-0', 'df-annotation-1']);
    });

    it('notes a point inside a line with an overlay, and its last point with a Flint note', () => {
        const rows = [{ year: 2000, s: 'a', v: 1 }, { year: 2001, s: 'a', v: 3 }, { year: 2000, s: 'b', v: 2 }];
        const encodings = { x: 'year', y: 'v', color: 's' };
        const [inside] = annotationLayers([{ at: { year: 2000, s: 'a' }, text: 'Start' }], rows, encodings, 'Line Chart') as any[];
        expect(inside.ops[0]).toMatchObject({ op: 'set-overlay', value: { mark: 'point', data: { values: [{ x: 2000, y: 1 }] } } });
        expect(inside.ops[1]).toMatchObject({ op: 'set-overlay', value: { mark: 'text', data: { values: [{ x: 2000, y: 1, text: 'Start' }] } } });
        const [end] = annotationLayers([{ at: { year: 2001, s: 'a' }, text: 'End' }], rows, encodings, 'Line Chart') as any[];
        expect(end.ops).toEqual([{ op: 'set-annotation', target: { select: { key: { year: 2001, s: 'a' } } }, value: { text: 'End', anchor: 'point' } }]);
    });

    it('hides the marks hide names, on the fields the rows carry', () => {
        const rows = [{ source: 'Coal', share: 1 }];
        expect(hideLayers({ source: ['Coal', 'Gas'], other: 1 }, rows)).toEqual([{ id: 'df-hide',
            ops: [{ op: 'set-style', targets: [{ select: { where: { source: { in: ['Coal', 'Gas'] } } } }], value: { visible: false } }] }]);
        expect(hideLayers(undefined, rows)).toEqual([]);
    });

    it('reads the surface behind a chart, blending a tint over what is behind it', () => {
        const page = document.createElement('div');
        page.style.backgroundColor = 'rgb(255, 241, 229)';
        const card = document.createElement('div');
        card.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        const chart = document.createElement('div');
        page.appendChild(card);
        card.appendChild(chart);
        document.body.appendChild(page);
        expect(surfaceBehind(chart)).toBe('#807973');
        card.style.backgroundColor = 'transparent';
        expect(surfaceBehind(chart)).toBe('#fff1e5');
        page.remove();
        expect(surfaceBehind(null)).toBe('#ffffff');
    });

    it('keeps a long discrete axis at its step, scrolling inside the card', () => {
        const rows = Array.from({ length: 200 }, (_, index) => ({ name: `item ${index}`, value: index }));
        const spec = { mark: 'bar', width: { step: 20 }, encoding: {} };
        expect(fitChartToWidth(spec, 800, rows, 'name')).toBe(spec);
        expect(fitChartToWidth(spec, 800, rows.slice(0, 30), 'name')).toMatchObject({ width: 800, autosize: { type: 'fit-x' } });
    });
});

describe('controls steer a chart in place', () => {
    const rows = [
        { date: '2020-01-06', grade: 'Regular', price: 2 }, { date: '2021-06-07', grade: 'Premium', price: 3 },
        { date: '2024-12-30', grade: 'Regular', price: 4 },
    ];
    const encodings = { x: 'date', y: 'price', color: 'grade' };

    it('frames a view on the axis its field is drawn on, open ends at the data\'s extent', () => {
        expect(viewLayers({ date: ['2021-01-01', '2022-12-31'] }, rows, encodings)).toEqual([{ id: 'df-view',
            ops: [{ op: 'set-viewport', axes: 'x', value: { x: ['2021-01-01', '2022-12-31'] } }] }]);
        expect(viewLayers({ date: { range: [null, '2022-12-31'] } }, rows, encodings)[0].ops[0]).toMatchObject({ value: { x: ['2020-01-06', '2022-12-31'] } });
        // No range, or a field the chart does not draw on an axis: nothing to frame.
        expect(viewLayers({ date: null }, rows, encodings)).toEqual([]);
        expect(viewLayers({ grade: ['A', 'B'] }, rows, encodings)).toEqual([]);
    });

    it('turns what the controls hold into filters, leaving out empty ones', () => {
        expect(chartFilters({ grade: ['Premium'], date: { range: ['2021-01-01', null] }, region: 'West', price: [], none: '' }, rows))
            .toEqual({ grade: { in: ['Premium'] }, date: { range: ['2021-01-01', null] } });
        expect(chartFilters({ grade: 'Regular', date: { range: null } }, rows)).toEqual({ grade: { in: ['Regular'] } });
    });

    it('writes a zoomed range the way the rows write the field', () => {
        const at = '2013-03-30T10:48:16.149Z';
        expect(inFieldTerms(at, '2020-01-06')).toBe('2013-03-30');
        expect(inFieldTerms(at, '2020-01')).toBe('2013-03');
        expect(inFieldTerms(new Date(at), 2020)).toBe(2013);
        expect(inFieldTerms(12.6, 10)).toBe(13);
        expect(inFieldTerms(12.6, 10.5)).toBe(12.6);
    });

    it('does not frame small multiples (Flint cannot move them); their view narrows rows instead', () => {
        expect(viewLayers({ date: ['2021-01-01', '2022-12-31'] }, rows, { ...encodings, column: 'grade' })).toEqual([]);
        const input = flintChartInput({ chartType: 'Line Chart', encodings: { x: 'date', y: 'price', column: 'grade' }, view: { date: null } }, rows, 600) as any;
        expect(input.interaction_spec).toBeUndefined();
    });

    it('turns a sort by another channel into the explicit order it means (a layered theme cannot compile "-x")', () => {
        const bars = [{ series: 'A', rate: 2 }, { series: 'B', rate: 5 }, { series: 'C', rate: 1 }];
        const sorted = explicitChannelSorts({ x: { field: 'rate' }, y: { field: 'series', sortBy: 'x', sortOrder: 'descending' } }, bars);
        expect(sorted.y).toEqual({ field: 'series', sortBy: JSON.stringify(['C', 'A', 'B']), sortOrder: 'descending' });
        // A sort by a field, or no sort, is left alone.
        expect(explicitChannelSorts({ x: { field: 'rate' }, y: { field: 'series' } }, bars).y).toEqual({ field: 'series' });
    });

    it('names the chart and its encodings in an error, and says how to isolate an engine failure', () => {
        const message = chartErrorMessage({ chartType: 'Bar Chart', title: 'Increase',
            encodings: { x: 'rate', y: { field: 'series', sortBy: 'x' } } }, "Cannot destructure property 'aggregate' of 'i' as it is undefined.");
        expect(message).toContain('FlintChart "Increase" (Bar Chart; x: rate, y: series (sortBy x))');
        expect(message).toContain('change this chart\'s props one at a time');
        expect(chartErrorMessage({ chartType: 'Line Chart', encodings: { x: 'date' } }, 'No rows.')).toBe('FlintChart Line Chart (x: date): No rows.');
    });

    it('mounts the zoom a view needs and the filter controls a filter drives', () => {
        const input = flintChartInput({ chartType: 'Line Chart', encodings: { x: 'date', y: 'price' }, view: { date: null },
            interactions: undefined }, rows, 600) as any;
        expect(input.interaction_spec.interactions).toEqual([{ type: 'brush-zoom', options: { axes: 'x', reset: ['double-click', 'escape'] } }]);
        // With select taking the drag, a view only frames.
        const selecting = flintChartInput({ chartType: 'Line Chart', encodings: { x: 'date', y: 'price' }, view: { date: null }, select: 'range' }, rows, 600) as any;
        expect(selecting.interaction_spec.interactions.map((entry: any) => entry.type)).toEqual(['brush-x', 'navigate']);
    });
});

describe('selectionFocus', () => {
    const regions = [{ region: 'East', countries: 3 }, { region: 'West', countries: 5 }];
    const points = [
        { country: 'Japan', region: 'Asia', gdp: 42, life: 84.6 },
        { country: 'Kenya', region: 'Africa', gdp: 5, life: 61.4 },
    ];
    const series = [{ year: 2019, source: 'Wind', share: 10 }, { year: 2020, source: 'Wind', share: 14 }];

    it('turns a click into the categories the marks belong to', () => {
        expect(selectionFocus([regions[1]], 'Bar Chart', { x: 'region', y: 'countries' }, true)).toEqual({ region: { in: ['West'] } });
        expect(selectionFocus(points.slice(0, 1), 'Scatter Plot', { x: 'gdp', y: 'life', color: 'region', detail: 'country' }, true))
            .toEqual({ region: { in: ['Asia'] }, country: { in: ['Japan'] } });
        expect(selectionFocus(series, 'Line Chart', { x: 'year', y: 'share', color: 'source' }, true)).toEqual({ source: { in: ['Wind'] } });
    });

    it('turns a drag into the span it covers, and a cleared selection into null', () => {
        expect(selectionFocus(series, 'Line Chart', { x: 'year', y: 'share', color: 'source' }, 'range')).toEqual({ year: { range: [2019, 2020] } });
        expect(selectionFocus(points, 'Scatter Plot', { x: 'gdp', y: 'life' }, 'range'))
            .toEqual({ gdp: { range: [5, 42] }, life: { range: [61.4, 84.6] } });
        expect(selectionFocus([], 'Bar Chart', { x: 'region', y: 'countries' }, true)).toBeNull();
    });
});

describe('FlintChart updates', () => {
    beforeEach(() => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 300 } as DOMRect);
    });

    it("reports updates Flint cannot apply, once each, when the app loads Flint's validators", async () => {
        const { validateChart } = await import('flint-chart/validate');
        (window as any).__DF_OPTIONAL_MODULES__ = { 'flint-links': { validateChart } };
        const bridge = installBridge();
        const rows = [{ month: '2024-01', revenue: 3 }, { month: '2024-02', revenue: 5 }];
        const updates = [
            { id: 'note', ops: [{ op: 'set-annotation', target: { select: { key: { month: '2024-02' } } }, value: { text: 'High' } }] },
            { id: 'zoom', ops: [{ op: 'set-viewport', axes: 'x', value: { x: ['2024-01', '2024-02'] } }] },
        ] as any;
        const view = renderThemed(<FlintChart chartType="Line Chart" title="Revenue" data={rows} encodings={{ x: 'month', y: 'revenue' }}
            semanticTypes={{ month: 'YearMonth' }} updates={updates} />);
        await waitFor(() => expect(bridge.reportError).toHaveBeenCalledWith(
            expect.stringMatching(/^FlintChart "Revenue": update "zoom" .* cannot apply: .*navigate/), false), { timeout: 5000 });
        const updateReports = () => bridge.reportError.mock.calls.filter(([message]) => String(message).includes(': update '));
        expect(updateReports()).toHaveLength(1);
        view.rerender(<ThemeProvider theme={createDfTheme('fluent')}><FlintChart chartType="Line Chart" title="Revenue" data={rows}
            encodings={{ x: 'month', y: 'revenue' }} semanticTypes={{ month: 'YearMonth' }} updates={[...updates]} interactions={['navigate']} /></ThemeProvider>);
        await new Promise(resolve => setTimeout(resolve, 600));
        expect(updateReports()).toHaveLength(1);
        delete (window as any).__DF_OPTIONAL_MODULES__;
    }, 15000);
});

describe('focus', () => {
    const rows = [
        { year: 2019, source: 'Coal', share: 40 }, { year: 2020, source: 'Coal', share: 38 },
        { year: 2019, source: 'Wind', share: 10 }, { year: 2020, source: 'Wind', share: 14 },
    ];
    it('emphasizes the marks it names on the fields a chart carries, and labels one line by its last value', () => {
        const layers = focusLayers({ source: 'Wind', region: 'West' }, rows, 'Line Chart', { x: 'year', y: 'share', color: 'source' }) as any[];
        expect(layers[0].ops[0]).toMatchObject({ op: 'set-style', targets: [{ select: { where: { source: { in: ['Wind'] } } } }] });
        expect(layers[1].ops[0]).toMatchObject({ op: 'set-annotation', target: { select: { key: { year: 2020, source: 'Wind' } } }, value: { text: '14' } });
        expect(focusLayers({ region: 'West' }, rows, 'Line Chart', { x: 'year', y: 'share', color: 'source' })).toEqual([]);
        expect(focusLayers({ year: { range: [2019, 2020] } }, rows, 'Line Chart', { x: 'year', y: 'share', color: 'source' })).toHaveLength(1);
    });

    it('stands for one interaction per kind of chart', () => {
        expect(selectPreset('Bar Chart', { x: 'a', y: 'b' }, true)).toBe('click-highlight');
        expect(selectPreset('Line Chart', { x: 'a', y: 'b', color: 'c' }, true)).toBe('click-group-focus');
        expect(selectPreset('Line Chart', { x: 'a', y: 'b' }, 'range')).toBe('brush-x');
        expect(selectPreset('Scatter Plot', { x: 'a', y: 'b' }, 'range')).toBe('select');
        expect(selectPreset('Scatter Plot', { x: 'a', y: 'b' }, undefined)).toBeUndefined();
    });
});

describe('requireModule', () => {
    it('resolves paths into MUI as its docs write them', () => {
        expect((requireModule('@mui/material/Box') as any).default).toBe(MUI.Box);
        expect((requireModule('@mui/material/styles') as any).alpha).toBe(MUI.alpha);
        expect(() => requireModule('@mui/material/NoSuchThing')).toThrow(/Cannot import/);
        expect(() => requireModule('@df/ui')).toThrow(/Cannot import "@df\/ui"/);
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
