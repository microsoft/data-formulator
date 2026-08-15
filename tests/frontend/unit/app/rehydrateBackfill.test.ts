import { describe, expect, it } from 'vitest';
import { REHYDRATE } from 'redux-persist';

import { dataFormulatorReducer } from '../../../../src/app/dfSlice';

/**
 * The slice's REHYDRATE case mutates the persisted payload in place, and
 * `persistReducer` then merges that payload into state — so the backfill is
 * asserted on the payload itself.
 */
function rehydrate(payload: Record<string, any>) {
    const action = { type: REHYDRATE, payload };
    dataFormulatorReducer(undefined, action as any);
    return action.payload;
}

describe('rehydrating a payload that predates a collection', () => {
    it('backfills a missing array so consumers can read .length', () => {
        // Reproduces the desktop first-open crash: `draftNodes.length` in
        // useWorkspaceAutoName threw on a payload saved without the field.
        const payload = rehydrate({ __stateVersion: 4, inputTables: [], derivedTables: [] });

        expect(payload.draftNodes).toEqual([]);
        expect(payload.textTurns).toEqual([]);
    });

    it('leaves existing collections untouched', () => {
        const draft = { id: 'draft-1', parentNodeId: 'tbl' };
        const payload = rehydrate({
            __stateVersion: 4,
            inputTables: [],
            derivedTables: [],
            draftNodes: [draft],
        });

        expect(payload.draftNodes).toHaveLength(1);
        expect(payload.draftNodes[0].id).toBe('draft-1');
    });

    it('replaces a non-array value with an empty array', () => {
        const payload = rehydrate({
            __stateVersion: 4,
            inputTables: [],
            derivedTables: [],
            draftNodes: null,
        });

        expect(payload.draftNodes).toEqual([]);
    });
});
