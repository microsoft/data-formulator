import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { readFileSync, writeFileSync } from 'node:fs';
import { agentSessionState, applySessionUpdate, chartFileSpec } from '../../../../src/app/sessionFiles';

const table = (id: string, extra: any = {}) => ({
    kind: 'table', id, displayId: id.toUpperCase(), names: ['region', 'sales', 'month'], metadata: {}, rows: [{ region: 'N', sales: 1, month: 1 }],
    virtual: { tableId: `ws_${id}`, rowCount: 3 }, ...extra,
}) as any;
const fields = ['region', 'sales', 'month'].map(name => ({ id: `f-${name}`, name, source: 'original', tableRef: 'sales' })) as any;
const chart = {
    id: 'chart-1', chartType: 'Bar Chart', tableRef: 'by_region', source: 'user', title: 'Sales by region',
    encodingMap: { x: { fieldID: 'f-region' }, y: { fieldID: 'f-sales', aggregate: 'sum' } }, config: { cornerRadius: 2 },
} as any;

describe('session files', () => {
    it('sends the allow-listed state without preview rows', () => {
        const state = { ...dataFormulatorReducer(undefined, { type: 'init' }),
            derivedTables: [table('by_region')], charts: [chart], viewMode: 'report',
            activeWorkspace: { id: 'w1', displayName: 'Sales study', provisional: true } } as any;
        const sent = agentSessionState(state);
        expect((sent.derivedTables as any[])[0]).not.toHaveProperty('rows');
        expect((sent.derivedTables as any[])[0]).toMatchObject({ id: 'by_region', names: ['region', 'sales', 'month'] });
        expect(sent.charts).toEqual([chart]);
        expect(sent.activeWorkspace).toEqual({ id: 'w1', displayName: 'Sales study' });
        expect(sent).not.toHaveProperty('viewMode');
        expect(sent).not.toHaveProperty('models');
    });

    it('renders charts like the server does (shared fixture)', () => {
        const fixture = JSON.parse(readFileSync('tests/fixtures/session_layer/charts.json', 'utf-8'));
        const specs = Object.fromEntries(fixture.charts.map((item: any) =>
            [item.id, chartFileSpec(item, fixture.tables.find((candidate: any) => candidate.id === item.tableRef), fixture.fields)]));
        if (process.env.UPDATE_FIXTURES) {
            fixture.expected = specs;
            writeFileSync('tests/fixtures/session_layer/charts.json', JSON.stringify(fixture, null, 2) + '\n');
        } else {
            expect(specs).toEqual(fixture.expected);
        }
    });

    it('applies an accepted chart or report edit to the store', () => {
        const store = configureStore({
            reducer: dataFormulatorReducer,
            preloadedState: { ...dataFormulatorReducer(undefined, { type: 'init' }), derivedTables: [table('by_region', {
                derive: { source: [], code: '', dialog: [], trigger: { tableId: 'x', resultTableId: 'by_region' } } })],
                charts: [chart], conceptShelfItems: fields.slice(0, 2),
                generatedReports: [{ id: 'report-1', title: 'Findings', content: '# Findings', selectedChartIds: [], createdAt: 1 }] as any },
            middleware: getDefaultMiddleware => getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }),
        });
        // An edit made against an older version is not applied over the user's newer change.
        const base = { chart_type: 'Bar Chart', table: 'ws_by_region', title: 'Sales by region', config: { cornerRadius: 2 },
            encodings: { x: { field: 'region' }, y: { field: 'sales', aggregate: 'sum' } } };
        expect(applySessionUpdate({ kind: 'chart', id: 'chart-1', base: { ...base, title: 'Older title' },
            spec: { ...base, chart_type: 'Line Chart' } }, store.dispatch, store.getState))
            .toEqual({ applied: false, name: 'Sales by region', reason: 'changed' });
        expect(store.getState().charts[0].chartType).toBe('Bar Chart');
        expect(applySessionUpdate({ kind: 'report', id: 'report-1', base: '# Older', content: '# New' }, store.dispatch, store.getState))
            .toEqual({ applied: false, name: 'Findings', reason: 'changed' });

        const result = applySessionUpdate({ kind: 'chart', id: 'chart-1', base, spec: {
            chart_type: 'Line Chart', table: 'ws_by_region', title: 'Monthly sales', theme: 'economist',
            encodings: { x: { field: 'month', type: 'ordinal' }, y: { field: 'sales', aggregate: 'average' }, color: { field: 'region' } },
            config: { interpolate: 'monotone' },
        } }, store.dispatch, store.getState);
        expect(result).toEqual({ applied: true, name: 'Monthly sales' });
        const edited = store.getState().charts[0];
        const month = store.getState().conceptShelfItems.find(field => field.name === 'month');
        // A column without a concept gets one, so its encoding resolves.
        expect(month).toBeDefined();
        expect(edited).toMatchObject({ id: 'chart-1', chartType: 'Line Chart', title: 'Monthly sales', themeId: 'economist',
            config: { interpolate: 'monotone' } });
        expect(edited.encodingMap.x).toEqual({ fieldID: month!.id, dtype: 'ordinal' });
        expect(edited.encodingMap.y).toEqual({ fieldID: 'f-sales', aggregate: 'average' });
        expect(edited.encodingMap.color).toEqual({ fieldID: 'f-region' });
        expect(edited.titleKey).toBeTruthy();
        // A second edit in the same run is made against the first one's result, which is what the store now holds.
        const first = { chart_type: 'Line Chart', table: 'ws_by_region', title: 'Monthly sales', theme: 'economist',
            encodings: { x: { field: 'month', type: 'ordinal' }, y: { field: 'sales', aggregate: 'average' }, color: { field: 'region' } },
            config: { interpolate: 'monotone' } };
        expect(applySessionUpdate({ kind: 'chart', id: 'chart-1', base: first, spec: { ...first, subtitle: 'Average per month' } },
            store.dispatch, store.getState)).toEqual({ applied: true, name: 'Monthly sales' });
        expect(store.getState().charts[0].subtitle).toBe('Average per month');

        expect(applySessionUpdate({ kind: 'report', id: 'report-1', base: '# Findings', content: '# Regional findings\nMore.' },
            store.dispatch, store.getState)).toEqual({ applied: true, name: 'Regional findings' });
        expect(store.getState().generatedReports[0]).toMatchObject({ title: 'Regional findings', content: '# Regional findings\nMore.' });
        store.dispatch(dfActions.deleteChartById('chart-1'));
        expect(applySessionUpdate({ kind: 'chart', id: 'chart-1', spec: { chart_type: 'Bar Chart', table: 'x', encodings: {} } },
            store.dispatch, store.getState)).toEqual({ applied: false, reason: 'missing' });
    });
});
