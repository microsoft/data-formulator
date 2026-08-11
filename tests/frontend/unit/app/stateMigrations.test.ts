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

        expect(DF_STATE_VERSION).toBe(3);
        expect(migrated.__stateVersion).toBe(3);
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
        expect(migrated.draftNodes).toEqual([{ id: 'draft' }]);
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
        expect(migrated.__stateVersion).toBe(3);
    });

    it('retags an already split pre-release state as v3', () => {
        const migrated = migrateState({
            __stateVersion: 5,
            inputTables: [{ kind: 'input-table', id: 'source' }],
            derivedTables: [],
            tableSemantics: [],
        });

        expect(migrated.__stateVersion).toBe(3);
        expect(migrated.inputTables).toEqual([{ kind: 'input-table', id: 'source' }]);
    });
});