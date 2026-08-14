import { describe, expect, it } from 'vitest';

import { DF_STATE_VERSION, migrateState } from '../../../../src/app/stateMigrations';

describe('state migrations', () => {
    it('applies the single v3 split, semantic extraction, and legacy cleanup', () => {
        const migrated = migrateState({
            __stateVersion: 1,
            tables: [
                {
                    id: 'source', displayId: 'Source', anchored: true,
                    names: ['amount'], rows: [{ amount: 2 }],
                    metadata: { amount: { type: 'number', semanticType: 'Currency', unit: 'USD', levels: [] } },
                    virtual: { tableId: 'source_workspace', rowCount: 1 },
                },
                {
                    id: 'derived', displayId: 'Derived', anchored: false,
                    names: ['amount'], rows: [{ amount: 2 }],
                    metadata: { amount: { type: 'number', semanticType: 'Currency', levels: ['low', 'high'] } },
                    virtual: { tableId: 'derived_workspace', rowCount: 1 },
                    derive: { source: ['source'], trigger: { tableId: 'source' } },
                },
            ],
            draftNodes: [{ id: 'draft', anchored: true }],
        });

        expect(DF_STATE_VERSION).toBe(4);
        expect(migrated.__stateVersion).toBe(4);
        expect(migrated).not.toHaveProperty('tables');
        expect(migrated.inputTables).toEqual([
            expect.objectContaining({ id: 'source', source: { kind: 'workspace', tableId: 'source_workspace' } }),
        ]);
        expect(migrated.inputTables[0]).not.toHaveProperty('rows');
        expect(migrated.inputTables[0].snapshot.columns[0]).toEqual({ name: 'amount', type: 'number', levels: [] });
        expect(migrated.derivedTables).toEqual([
            expect.objectContaining({
                id: 'derived',
                derive: expect.any(Object),
                metadata: { amount: { type: 'number', levels: [] } },
            }),
        ]);
        expect(migrated.tableSemantics).toEqual([
            { tableId: 'source', fields: { amount: { semanticType: 'Currency', unit: 'USD' } } },
            { tableId: 'derived', fields: { amount: { semanticType: 'Currency', sortOrder: ['low', 'high'] } } },
        ]);
        expect(migrated.draftNodes).toEqual([{
            id: 'draft',
            parentNodeId: '__rootless_thread__',
        }]);
    });

    it('normalizes partial pre-release states into v3 without duplicates', () => {
        const input = { kind: 'input-table', id: 'source', snapshot: { columns: [] } };
        const derived = { id: 'derived', derive: { source: ['source'] } };
        const semantics = { tableId: 'source', fields: { amount: { semanticType: 'Currency' } } };
        const migrated = migrateState({
            __stateVersion: 4,
            inputTables: [input],
            derivedTables: [derived],
            tableSemantics: [semantics],
            tables: [{ id: 'source' }, { id: 'derived', derive: {} }],
        });

        expect(migrated.inputTables).toEqual([input]);
        expect(migrated.derivedTables).toEqual([derived]);
        expect(migrated.tableSemantics).toEqual([semantics]);
        expect(migrated).not.toHaveProperty('tables');
        expect(migrated.__stateVersion).toBe(4);
    });

    it('upgrades an already split pre-release state to v4', () => {
        const migrated = migrateState({
            __stateVersion: 5,
            inputTables: [{ kind: 'input-table', id: 'source' }],
            derivedTables: [],
            tableSemantics: [],
        });

        expect(migrated.__stateVersion).toBe(4);
        expect(migrated.inputTables).toEqual([{ kind: 'input-table', id: 'source' }]);
        expect(migrated.loadedTableNodes).toEqual([]);
    });

    it('moves loaded-table thread edges into reference nodes', () => {
        const migrated = migrateState({
            __stateVersion: 3,
            inputTables: [{
                kind: 'input-table',
                id: 'loaded-orders',
                displayId: 'Loaded orders',
                snapshot: { columns: [] },
                threadParentId: 'textTurn-load',
                addedAt: 42,
            }],
            derivedTables: [],
        });

        expect(migrated.inputTables[0]).not.toHaveProperty('threadParentId');
        expect(migrated.loadedTableNodes).toEqual([{
            kind: 'loaded-table',
            id: 'loaded-table-loaded-orders',
            tableId: 'loaded-orders',
            parentNodeId: 'textTurn-load',
            createdAt: 42,
        }]);
    });

    it('unifies authored table, draft, and report edges on parentNodeId', () => {
        const migrated = migrateState({
            __stateVersion: 4,
            inputTables: [],
            loadedTableNodes: [],
            derivedTables: [{
                id: 'result',
                threadParentId: 'textTurn-answer',
                derive: { trigger: { tableId: 'source' } },
            }],
            draftNodes: [{
                id: 'draft',
                derive: { trigger: { tableId: 'source' } },
            }],
            generatedReports: [{ id: 'report', triggerTableId: 'result' }],
        });

        expect(migrated.derivedTables[0]).toMatchObject({
            id: 'result',
            parentNodeId: 'textTurn-answer',
        });
        expect(migrated.derivedTables[0]).not.toHaveProperty('threadParentId');
        expect(migrated.draftNodes[0].parentNodeId).toBe('source');
        expect(migrated.generatedReports[0].parentNodeId).toBe('result');
        expect(migrated.__stateVersion).toBe(4);
    });
});