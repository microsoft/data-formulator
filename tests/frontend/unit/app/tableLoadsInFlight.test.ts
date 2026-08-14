import { describe, expect, it } from 'vitest';

import { dataFormulatorReducer } from '../../../../src/app/dfSlice';
import { loadTable } from '../../../../src/app/tableThunks';

/**
 * The slice matches the load lifecycle by action-type string to avoid an
 * import cycle, so these assert against the real thunk's action creators —
 * renaming the thunk prefix must fail here rather than silently regress the
 * thread into showing "no data" while an import is still running.
 */
const initial = dataFormulatorReducer(undefined, { type: '@@INIT' });

const pending = (requestId: string) =>
    loadTable.pending(requestId, { table: { id: 't' } } as any);

describe('tableLoadsInFlight', () => {
    it('starts at zero', () => {
        expect(initial.tableLoadsInFlight).toBe(0);
    });

    it('counts a load as in flight until it settles', () => {
        const loading = dataFormulatorReducer(initial, pending('req-1'));
        expect(loading.tableLoadsInFlight).toBe(1);

        const settled = dataFormulatorReducer(
            loading,
            loadTable.fulfilled({ table: { id: 't' } } as any, 'req-1', { table: { id: 't' } } as any),
        );
        expect(settled.tableLoadsInFlight).toBe(0);
    });

    it('clears the counter when a load fails', () => {
        const loading = dataFormulatorReducer(initial, pending('req-1'));
        const failed = dataFormulatorReducer(
            loading,
            loadTable.rejected(new Error('boom'), 'req-1', { table: { id: 't' } } as any),
        );
        expect(failed.tableLoadsInFlight).toBe(0);
    });

    it('tracks concurrent loads independently', () => {
        let state = dataFormulatorReducer(initial, pending('req-1'));
        state = dataFormulatorReducer(state, pending('req-2'));
        expect(state.tableLoadsInFlight).toBe(2);

        state = dataFormulatorReducer(
            state,
            loadTable.fulfilled({ table: { id: 't' } } as any, 'req-1', { table: { id: 't' } } as any),
        );
        expect(state.tableLoadsInFlight).toBe(1);
    });

    it('never drops below zero when a settle arrives after a state reset', () => {
        const state = dataFormulatorReducer(
            initial,
            loadTable.fulfilled({ table: { id: 't' } } as any, 'req-1', { table: { id: 't' } } as any),
        );
        expect(state.tableLoadsInFlight).toBe(0);
    });
});
