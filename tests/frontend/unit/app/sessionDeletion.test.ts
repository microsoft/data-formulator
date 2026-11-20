import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, type DataFormulatorState } from '../../../../src/app/dfSlice';
import { applySessionDeletion } from '../../../../src/app/sessionDeletion';
import { deleteTablesFromWorkspace } from '../../../../src/app/workspaceService';

vi.mock('../../../../src/app/workspaceService', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../src/app/workspaceService')>()),
    deleteTablesFromWorkspace: vi.fn(),
}));

const loaded = (id: string, extra: any = {}) => ({
    kind: 'table', id, displayId: id.toUpperCase(), names: [], metadata: {}, rows: [], virtual: { tableId: `ws_${id}`, rowCount: 1 }, ...extra,
}) as any;
const derived = (id: string, source: string[], extra: any = {}) => loaded(id, {
    parentNodeId: source[0], createdAt: 1,
    derive: { source, code: '', dialog: [], trigger: { tableId: source[0], resultTableId: id } }, ...extra,
});
const chart = (id: string, tableRef: string, extra: any = {}) =>
    ({ id, chartType: 'Bar Chart', encodingMap: {}, tableRef, source: 'user', ...extra }) as any;
const reference = (id: string) => ({ kind: 'external-table-reference', id, connectorId: 'pg', tableKey: id, displayName: `Ref ${id}`,
    sourceTable: { id, name: id }, capturedAt: '', summary: { columns: [] } }) as any;

const makeStore = ({ inputTables = [], ...state }: Partial<Omit<DataFormulatorState, 'inputTables'>> & { inputTables?: any[] }) => {
    const store = configureStore({
        reducer: dataFormulatorReducer,
        preloadedState: { ...dataFormulatorReducer(undefined, { type: 'init' }), ...state },
        middleware: getDefaultMiddleware => getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }),
    });
    inputTables.forEach(table => store.dispatch(dfActions.addTableToStore(table)));
    return store;
};

describe('session deletion', () => {
    beforeEach(() => vi.mocked(deleteTablesFromWorkspace).mockClear());

    it('deletes what the server planned, with what goes along, and names it', () => {
        const store = makeStore({
            inputTables: [loaded('sales')],
            derivedTables: [derived('region', ['sales']), derived('mix', ['sales'])],
            charts: [chart('chart-sales', 'sales'), chart('chart-region', 'region'), chart('chart-mix-1', 'mix'), chart('chart-mix-2', 'mix')],
            externalTableReferences: [reference('ref-orders')],
        });
        const names = applySessionDeletion({
            tables: [{ id: 'ws_region', node_id: 'region', name: 'REGION' }],
            charts: [
                { id: 'chart-region', name: 'Region chart', table: 'region', because: 'chart of REGION' },
                { id: 'chart-mix-1', name: 'Mix 1', table: 'mix' },
            ],
            references: [{ id: 'ref-orders', name: 'Orders' }],
        }, store.dispatch, store.getState);
        const state = store.getState();
        expect(names).toEqual(['Orders', 'Mix 1', 'REGION']);
        expect(state.derivedTables.map(table => table.id)).toEqual(['mix']);
        expect(state.charts.map(item => item.id)).toEqual(['chart-sales', 'chart-mix-2']);
        expect(state.externalTableReferences).toEqual([]);
        expect(deleteTablesFromWorkspace).toHaveBeenCalledWith(['ws_region']);
    });

    it('names a derived table that went with its last chart', () => {
        const store = makeStore({
            inputTables: [loaded('sales')],
            derivedTables: [derived('mix', ['sales'])],
            charts: [chart('chart-mix', 'mix')],
        });
        const names = applySessionDeletion({
            tables: [{ id: 'ws_mix', node_id: 'mix', name: 'MIX', because: 'nothing is left built on it' }],
            charts: [{ id: 'chart-mix', name: 'Mix chart', table: 'mix' }],
            references: [],
        }, store.dispatch, store.getState);
        expect(names).toEqual(['Mix chart', 'MIX']);
        expect(store.getState().derivedTables).toEqual([]);
        expect(store.getState().inputTables.map(table => table.id)).toEqual(['sales']);
    });
});
