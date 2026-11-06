import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import bridgeSource from '../../../../../src/app/htmlApp/dfAppRuntime.js?raw';
import { createDfTheme } from '../../../../../src/app/theme';
import { clearQueryCache } from '../../../../../src/app/reactApp/runtime/data';
import { densityTheme } from '../../../../../src/app/reactApp/runtime/density';
import { AppThemeProvider } from '../../../../../src/app/reactApp/runtime/appTheme';
import {
    AppHeader, BarList, DateRange, FilterBar, filterSummary, headerRange, FocusChips, NumberRange, Segmented, TargetBar, ValueChips, ValueSelect, dateBound, dateFormatOf, inFocus, periodsBetween, queryFilters,
} from '../../../../../src/app/reactApp/runtime/controls';

let format: unknown;
const themed = (node: React.ReactNode) => render(<ThemeProvider theme={createDfTheme('fluent')}>{node}</ThemeProvider>);
const installBridge = (query = vi.fn()) => {
    (window as any).DF = { ready: Promise.resolve(), manifest: { tables: ['sales'] }, theme: {}, query, format, reportError: vi.fn() };
    return query;
};

beforeAll(() => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    (window as any).__DF_APP_CONFIG__ = { channel: 'test', manifest: { tables: ['sales'] }, theme: {} };
    new Function(bridgeSource)();
    format = (window as any).DF.format;
    vi.restoreAllMocks();
});
afterEach(() => { clearQueryCache(); delete (window as any).DF; });

describe('queryFilters and inFocus', () => {
    it('turn what controls hold into filters, leaving out empty controls', () => {
        expect(queryFilters({ region: 'West', product: ['A', 'B'], all: '', none: [], nothing: null,
            date: { range: ['2024-01', null] }, price: { range: [1, 5] }, open: { range: [null, null] }, focus: { in: ['x'] } })).toEqual([
            { field: 'region', op: 'in', values: ['West'] },
            { field: 'product', op: 'in', values: ['A', 'B'] },
            { field: 'date', op: 'range', min: '2024-01' },
            { field: 'price', op: 'range', min: 1, max: 5 },
            { field: 'focus', op: 'in', values: ['x'] },
        ]);
        const row = { region: 'West', price: 3, date: '2024-03' };
        expect(inFocus(row, { region: 'West', price: { range: [1, 5] }, date: { range: ['2024-01', '2024-12'] } })).toBe(true);
        expect(inFocus(row, { region: { in: ['East'] } })).toBe(false);
        expect(inFocus(row, null)).toBe(true);
    });
});

describe('dates', () => {
    it('write a picked period in the column\'s own format, its whole span', () => {
        expect(dateFormatOf(2024)).toBe('year');
        expect(dateFormatOf('2024-03')).toBe('month');
        expect(dateFormatOf('2024-03-15')).toBe('day');
        expect(dateBound('2024-02', 'month', true, 'day')).toBe('2024-02-29');
        expect(dateBound('2024-02', 'month', false, 'day')).toBe('2024-02-01');
        expect(dateBound('2024', 'year', true, 'month')).toBe('2024-12');
        expect(dateBound('2024-07-04', 'day', false, 'year')).toBe(2024);
    });

    it('lists the data\'s own periods', () => {
        expect(periodsBetween('2023-11-06', '2024-02-26', 'month')).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
        expect(periodsBetween(2021, 2023, 'year')).toEqual(['2021', '2022', '2023']);
    });

    it('DateRange is a slider over the data\'s months, its label showing the period', async () => {
        installBridge(vi.fn(async () => ({ rows: [{ date_min: '2022-01-03', date_max: '2024-06-24' }], totalRowCount: 1 })));
        const onChange = vi.fn();
        const { rerender } = themed(<DateRange table="sales" column="date" value={null} onChange={onChange} />);
        await waitFor(() => expect(screen.getByText('All (Jan 2022 – Jun 2024)')).toBeInTheDocument());
        const [start] = screen.getAllByRole('slider');
        fireEvent.keyDown(start, { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith(['2022-02-01', '2024-06-30']);
        rerender(<ThemeProvider theme={createDfTheme('fluent')}><DateRange table="sales" column="date" value={['2023-02-01', null]} onChange={onChange} /></ThemeProvider>);
        expect(screen.getByText('Feb 2023 – Jun 2024')).toBeInTheDocument();
    });
});

describe('controls and displays', () => {
    it('ValueSelect is a dropdown of a column\'s values, with an All choice', async () => {
        installBridge(vi.fn(async () => ({ rows: [{ region: 'East', _count: 1 }, { region: 'West', _count: 2 }], totalRowCount: 2 })));
        const onChange = vi.fn();
        themed(<ValueSelect table="sales" column="region" label="Region" value="" onChange={onChange} />);
        fireEvent.mouseDown(screen.getByRole('combobox'));
        fireEvent.click(await screen.findByRole('option', { name: 'West' }));
        expect(onChange).toHaveBeenCalledWith('West');
    });

    it('ValueChips toggles a few values as chips, and offers type-ahead for many', () => {
        installBridge();
        const onChange = vi.fn();
        const { unmount } = themed(<ValueChips label="Category" options={['A', 'B']} value={['A']} onChange={onChange} />);
        fireEvent.click(screen.getByText('B'));
        expect(onChange).toHaveBeenCalledWith(['A', 'B']);
        fireEvent.click(screen.getByText('A'));
        expect(onChange).toHaveBeenLastCalledWith([]);
        unmount();
        themed(<ValueChips label="Country" options={['a', 'b', 'c', 'd', 'e', 'f', 'g']} value={[]} onChange={onChange} />);
        expect(screen.getByPlaceholderText('All')).toBeInTheDocument();
    });

    it('Segmented picks one of a few choices', () => {
        installBridge();
        const onChange = vi.fn();
        themed(<Segmented label="Measure" options={[{ value: 'revenue', label: 'Revenue' }, { value: 'profit', label: 'Profit' }]} value="revenue" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Profit' }));
        expect(onChange).toHaveBeenCalledWith('profit');
    });

    it('NumberRange is a slider whose label shows the range, null when it spans everything', () => {
        installBridge();
        const onChange = vi.fn();
        themed(<NumberRange label="Price" min={0} max={100} value={[10, 50]} onChange={onChange} />);
        expect(screen.getByText(/10 – 50/)).toBeInTheDocument();
        const [, end] = screen.getAllByRole('slider');
        fireEvent.keyDown(end, { key: 'End' });
        expect(onChange).toHaveBeenCalledWith([10, 100]);
    });

    it('BarList ranks rows and sets and clears a focus on click', () => {
        installBridge();
        const onFocus = vi.fn();
        const { rerender } = themed(<BarList data={[{ r: 'East', v: 3 }, { r: 'West', v: 9 }]} label="r" value="v" onFocus={onFocus} />);
        const rows = screen.getAllByRole('button');
        expect(rows.map(row => row.textContent)).toEqual(['West9', 'East3']);
        fireEvent.click(rows[0]);
        expect(onFocus).toHaveBeenCalledWith({ r: { in: ['West'] } });
        rerender(<ThemeProvider theme={createDfTheme('fluent')}>
            <BarList data={[{ r: 'East', v: 3 }, { r: 'West', v: 9 }]} label="r" value="v" onFocus={onFocus} focus={{ r: { in: ['West'] } }} />
        </ThemeProvider>);
        fireEvent.click(screen.getAllByRole('button')[0]);
        expect(onFocus).toHaveBeenLastCalledWith(null);
    });

    it('BarList keeps to a short tile: the rows that fit, and "+N more" for the rest', () => {
        installBridge();
        // jsdom has no layout: the list is given 120px (room for two rows and the "more" line, not four rows).
        const height = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;
        Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true,
            get(this: Element) { return this.hasAttribute('data-bar-list') ? 120 : height.get!.call(this); } });
        try {
            const data = [{ r: 'A', v: 4 }, { r: 'B', v: 3 }, { r: 'C', v: 2 }, { r: 'D', v: 1 }];
            themed(<BarList data={data} label="r" value="v" />);
            expect(screen.getByText('A')).toBeInTheDocument();
            expect(screen.getByText('B')).toBeInTheDocument();
            expect(screen.queryByText('C')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
            expect(screen.getByText('D')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
            expect(screen.queryByText('D')).toBeNull();
        } finally {
            Object.defineProperty(Element.prototype, 'clientHeight', height);
        }
    });

    it('TargetBar and FocusChips', () => {
        installBridge();
        const onChange = vi.fn();
        themed(<>
            <TargetBar value={90} target={120} label="$120" />
            <FocusChips focus={{ region: { in: ['West'] }, gdp: { range: [10, 20] } }} onChange={onChange} labels={{ gdp: 'GDP' }} />
        </>);
        expect(screen.getByText(/of target \$120/)).toHaveTextContent('75% of target $120');
        expect(screen.getByText(/GDP:/)).toHaveTextContent('GDP: 10 – 20');
        fireEvent.click(screen.getByText('Clear all'));
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('sizes the page and the controls by the density, compact unless the app says normal', () => {
        installBridge();
        const compact = densityTheme(createDfTheme('fluent'), 'compact');
        expect(compact.spacing(2)).toBe('12px');
        expect((compact as any).dfDensity).toBe('compact');
        expect(densityTheme(createDfTheme('fluent'), 'normal').spacing(2)).toBe('16px');
        const bar = () => document.querySelector('[data-df-filterbar]') as HTMLElement;
        const { unmount } = render(<ThemeProvider theme={compact}><FilterBar><Segmented label="Measure" options={['a', 'b']} value="a" onChange={() => {}} /></FilterBar></ThemeProvider>);
        expect(getComputedStyle(bar()).padding).toBe('8px 12px');
        unmount();
        // An app can switch back to MUI's own scale.
        render(<ThemeProvider theme={compact}><AppThemeProvider density="normal"><FilterBar><Segmented label="Measure" options={['a', 'b']} value="a" onChange={() => {}} /></FilterBar></AppThemeProvider></ThemeProvider>);
        expect(getComputedStyle(bar()).padding).toBe('12px 16px');
        // …and its type: a normal page inside a compact app gets MUI's own scale back.
        expect(densityTheme(compact, 'normal').typography.body1.fontSize).toBe('1rem');
        expect(compact.typography.body1.fontSize).toBe('0.90625rem');
    });

    it('AppHeader says what the page shows: period, as-of, count, source, and what the controls hold', () => {
        installBridge();
        expect(headerRange('2023-01', '2024-06')).toBe('Jan 2023 – Jun 2024');
        expect(headerRange('2024-03-04', '2024-03-04')).toBe('Mar 4, 2024');
        expect(filterSummary({ region: 'West', category: ['Office', 'Technology'], month: { range: ['2023-01', null] }, none: '' },
            { region: 'Region' })).toBe('Region: West · category: Office, Technology · month: from Jan 2023');
        themed(<AppHeader kicker="Sales" title="West led the year" deck="Revenue by region, USD" period={['2023-01', '2024-12']}
            asOf="2025-01-15" count={{ value: 1234, noun: 'orders' }} source="sales table" where={{ region: 'West' }} labels={{ region: 'Region' }}>
            <span>controls</span>
        </AppHeader>);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('West led the year');
        const meta = document.querySelector('[data-df-header-meta]')!;
        expect(meta.textContent).toBe(`Jan 2023 – Dec 2024 · As of Jan 15, 2025 · ${format.number(1234)} orders · Source: sales table · Showing Region: West`);
        expect(screen.getByText('controls')).toBeInTheDocument();
    });
});
