import { describe, expect, it } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { createDictTable } from '../../../../src/components/ComponentType';
import { findTableByName, isDrawableTarget, itemFocus, parseItemName, workspaceFileName } from '../../../../src/app/itemNames';

describe('parseItemName', () => {
    it('reads the new names and their old forms as the same item', () => {
        const same: [string[], unknown][] = [
            [['session://charts/c12', 'session/charts/c12.json', 'session/charts/c12', 'chart://c12'], { kind: 'chart', id: 'c12' }],
            [['session://tables/sales', 'session/tables/sales.json'], { kind: 'table', name: 'sales' }],
            [['session://reports/r3', 'session/reports/r3.md'], { kind: 'report', id: 'r3' }],
            [['session://threads/2', 'session/threads/2.md'], { kind: 'thread', number: 2 }],
            [['session://references/ref-1', 'session/references/ref-1.json'], { kind: 'reference', id: 'ref-1' }],
            [['files/orgs.map.json', 'map://files/orgs.map.json', './files/orgs.map.json'], { kind: 'file', path: 'files/orgs.map.json' }],
            [['scratch/a b.md', 'scratch/a%20b.md', './scratch/a%20b.md', '/api/agent/workspace/scratch/a%20b.md',
                '/api/workspace/scratch/a%20b.md', '/api/workspace/files/scratch/a%20b.md'], { kind: 'file', path: 'scratch/a b.md' }],
            [['/api/workspace/files/notes/plan.md', 'files/notes/plan.md?x=1#top'], { kind: 'file', path: 'files/notes/plan.md' }],
            [['https://example.com/a.png'], { kind: 'web', url: 'https://example.com/a.png' }],
        ];
        for (const [names, target] of same) {
            for (const name of names) expect(parseItemName(name), name).toEqual(target);
        }
    });

    it('rejects unsafe paths and names it does not know', () => {
        for (const name of ['', 'javascript:alert(1)', 'data:image/png;base64,x', 'blob:http://x/y', 'session://index',
            'session://charts/', 'session://charts/a/b', 'session://charts/..', 'session://threads/x', 'session://threads/0',
            'session://tables/a%0Ab', 'session/widgets/x.json', 'sources://kusto/db/t', 'workflows://w2', 'data/sales.parquet',
            'files/../x', 'scratch/%2E%2E/a.md', 'scratch/a\\b', 'scratch/%zz', 'files/', 'map://data/x.map.json', 'notes.md']) {
            expect(parseItemName(name), name).toBeNull();
        }
    });

    it('names files as the app does and tells what draws in place', () => {
        expect(workspaceFileName('files/notes/plan.md')).toBe('notes/plan.md');
        expect(workspaceFileName('scratch/x.json')).toBe('scratch/x.json');
        expect(['session://charts/c1', 'session://tables/t', 'files/m.map.json', 'files/p.png', 'https://a.b/c.png']
            .every(name => isDrawableTarget(parseItemName(name)))).toBe(true);
        expect(['session://reports/r', 'session://threads/1', 'files/app.app.jsx', 'files/page.html', 'scratch/x.json']
            .some(name => isDrawableTarget(parseItemName(name)))).toBe(false);
    });
});

describe('itemFocus', () => {
    const stateWith = () => {
        let state = dataFormulatorReducer(undefined, { type: '@@init' });
        const sales = createDictTable('sales-table', [{ region: 'North', cost: 4 }], undefined, { tableId: 'sales', rowCount: 1 });
        state = dataFormulatorReducer(state, dfActions.insertDerivedTables(sales));
        state = dataFormulatorReducer(state, dfActions.addTextTurn({ kind: 'text', id: 'turn-1', displayId: 'turn-1', textKind: 'explain',
            parentNodeId: 'root', content: 'Hello', createdAt: 1 } as any));
        return state;
    };

    it('opens what a name refers to, and nothing for names the session does not have', () => {
        const state = stateWith();
        const context = { tables: dfSelectors.getAllTables(state), charts: [{ id: 'c1' }], reports: [{ id: 'r1' }],
            references: [{ id: 'ref-1' }], graph: dfSelectors.getThreadGraph(state) };
        expect(findTableByName(context.tables, 'sales')?.id).toBe('sales-table');
        expect(itemFocus(parseItemName('session://tables/sales'), context)).toEqual({ type: 'table', tableId: 'sales-table' });
        expect(itemFocus(parseItemName('session/tables/sales-table.json'), context)).toEqual({ type: 'table', tableId: 'sales-table' });
        expect(itemFocus(parseItemName('session://charts/c1'), context)).toEqual({ type: 'chart', chartId: 'c1' });
        expect(itemFocus(parseItemName('session://reports/r1'), context)).toEqual({ type: 'report', reportId: 'r1' });
        expect(itemFocus(parseItemName('session://references/ref-1'), context)).toEqual({ type: 'external-table', referenceId: 'ref-1' });
        expect(itemFocus(parseItemName('files/notes.md'), context)).toEqual({ type: 'file', fileName: 'notes.md' });
        const thread = itemFocus(parseItemName('session://threads/1'), context);
        expect(thread).toMatchObject({ type: 'conversation' });
        expect((thread as { nodeIds: string[] }).nodeIds).toContain('turn-1');
        for (const name of ['session://tables/nope', 'session://charts/c9', 'session://reports/r9', 'session://threads/9', 'https://a.b']) {
            expect(itemFocus(parseItemName(name), context), name).toBeUndefined();
        }
    });
});
