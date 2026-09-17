import { describe, expect, it } from 'vitest';

import { DF_STATE_VERSION, migrateState } from '../../../../src/app/stateMigrations';

describe('state migrations', () => {
    it('migrates legacy terminal records once without mutating the saved payload', () => {
        const content = 'Inspect.\n\n**Command**\n\n```bash\naz account show\n```\n\n**Working directory:** `/workspace`';
        const saved = { __stateVersion: 6, textTurns: [{ id: 'legacy', content }] };
        const migrated = migrateState(saved);
        expect(saved.textTurns[0].content).toBe(content);
        expect(migrated.textTurns[0]).toMatchObject({ content: 'Inspect.', executions: [{
            argv: [], commandText: 'az account show', cwd: '/workspace', status: 'unknown',
        }] });
        expect(migrateState(migrated)).toBe(migrated);
        expect(migrateState({ ...migrated, __stateVersion: 6 }).textTurns).toEqual(migrated.textTurns);
        expect(migrateState({ ...saved, __stateVersion: 99 }).textTurns[0].content).toBe(content);
    });

    it('matches mixed records one-to-one while retaining distinct executions and outcomes', () => {
        const execution = { id: 'first', argv: ['pwd'], cwd: '/', purpose: '', status: 'completed', result: { exit_code: 0, output: '/' } };
        const content = '```json\n' + JSON.stringify({ argv: execution.argv, cwd: execution.cwd, result: execution.result }) + '\n```';
        const migrated = migrateState({ __stateVersion: 6, textTurns: [
            { id: 'mixed', content, executions: [execution, { ...execution, id: 'second' }] },
            { id: 'repeated', content: content + '\n' + content },
            { id: 'different', content, executions: [{ ...execution, result: { output: 'Different run' } }] },
        ] });
        expect(migrated.textTurns[0].executions).toEqual([execution, { ...execution, id: 'second' }]);
        expect(migrated.textTurns[0].content).toBe('');
        expect(migrated.textTurns[1].executions).toHaveLength(2);
        expect(new Set(migrated.textTurns[1].executions.map((item: any) => item.id)).size).toBe(2);
        expect(migrated.textTurns[2].executions).toHaveLength(2);
    });

    it('preserves ordinary JSON and migrates agent-owned table history without changing user messages', () => {
        const content = '```json\n{"argv":["pwd"],"cwd":"/","result":{"exit_code":1,"stderr":"Denied"}}\n```';
        const ordinary = ['```json\n{"status":"ok"}\n```', '```json\n{bad}\n```', '```json\n{"argv":[1],"cwd":"/"}\n```'];
        const migrated = migrateState({ __stateVersion: 6,
            textTurns: ordinary.map((text, index) => ({ id: String(index), content: text })),
            derivedTables: [{ id: 'table', derive: { trigger: { interaction: [
                { from: 'data-agent', content }, { from: 'user', content },
            ] } } }],
        });
        expect(migrated.textTurns.map((turn: any) => turn.content)).toEqual(ordinary);
        const entries = migrated.derivedTables[0].derive.trigger.interaction;
        expect(entries[0]).toMatchObject({ content: '', executions: [{ argv: ['pwd'], status: 'failed', result: { stderr: 'Denied' } }] });
        expect(entries[1]).toEqual({ from: 'user', content });
    });
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

        expect(DF_STATE_VERSION).toBe(8);
        expect(migrated.__stateVersion).toBe(8);
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
            parentNodeId: 'conversation-root:draft',
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
        expect(migrated.derivedTables).toEqual([{ ...derived, parentNodeId: 'conversation-root:derived' }]);
        expect(migrated.tableSemantics).toEqual([semantics]);
        expect(migrated).not.toHaveProperty('tables');
        expect(migrated.__stateVersion).toBe(8);
    });

    it('upgrades an already split pre-release state to the current version', () => {
        const migrated = migrateState({
            __stateVersion: 5,
            inputTables: [{ kind: 'input-table', id: 'source' }],
            derivedTables: [],
            tableSemantics: [],
        });

        expect(migrated.__stateVersion).toBe(8);
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
        expect(migrated.__stateVersion).toBe(8);
    });

    it('preserves table labels when upgrading past the removed display-name migration', () => {
        const migrated = migrateState({
            __stateVersion: 4,
            inputTables: [
                { kind: 'input-table', id: 'movies', displayId: 'movies' },
                { kind: 'input-table', id: 'renamed', displayId: 'My movies' },
            ],
            derivedTables: [],
            tableSemantics: [
                { tableId: 'movies', displayName: 'Movies', fields: { year: { semanticType: 'Year' } } },
                { tableId: 'renamed', displayName: 'Suggested movies', fields: {} },
            ],
        });

        expect(migrated.inputTables[0].displayId).toBe('movies');
        expect(migrated.inputTables[1].displayId).toBe('My movies');
        expect(migrated.tableSemantics).toEqual([
            { tableId: 'movies', displayName: 'Movies', fields: { year: { semanticType: 'Year' } } },
            { tableId: 'renamed', displayName: 'Suggested movies', fields: {} },
        ]);
        expect(migrated.__stateVersion).toBe(8);
    });
});