import { describe, it, expect } from 'vitest';
import {
    isLeafDerivedTable,
    buildExperienceContext,
} from '../../../../src/views/SaveExperienceButton';
import type { DictTable } from '../../../../src/components/ComponentType';

function makeTable(id: string, overrides?: Partial<DictTable>): DictTable {
    return {
        kind: 'table',
        id,
        displayId: id,
        names: ['col1'],
        metadata: { col1: { type: 'string' } },
        rows: [{ col1: 'a' }],
        virtual: { tableId: id, rowCount: 1 },
        anchored: false,
        attachedMetadata: '',
        ...overrides,
    } as DictTable;
}

function makeDerived(
    id: string,
    parentId: string,
    opts?: {
        interaction?: any[];
        executionAttempts?: any[];
        dialog?: any[];
        anchored?: boolean;
    },
): DictTable {
    return makeTable(id, {
        anchored: opts?.anchored ?? false,
        derive: {
            source: [parentId],
            code: 'df = ...',
            outputVariable: 'result_df',
            dialog: opts?.dialog ?? [],
            executionAttempts: opts?.executionAttempts,
            trigger: {
                tableId: parentId,
                resultTableId: id,
                interaction: opts?.interaction ?? [],
            },
        },
    });
}

// ── isLeafDerivedTable ──────────────────────────────────────────────────────

describe('isLeafDerivedTable', () => {
    it('returns true for a derived table with no children', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root');
        expect(isLeafDerivedTable(t1, [root, t1])).toBe(true);
    });

    it('returns false for a derived table that has un-anchored children', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root');
        const t2 = makeDerived('t2', 't1');
        expect(isLeafDerivedTable(t1, [root, t1, t2])).toBe(false);
        expect(isLeafDerivedTable(t2, [root, t1, t2])).toBe(true);
    });

    it('returns true when children are all anchored', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root');
        const t2 = makeDerived('t2', 't1', { anchored: true });
        expect(isLeafDerivedTable(t1, [root, t1, t2])).toBe(true);
    });

    it('returns false for non-derived tables', () => {
        const root = makeTable('root');
        expect(isLeafDerivedTable(root, [root])).toBe(false);
    });
});

// ── buildExperienceContext ───────────────────────────────────────────────────

describe('buildExperienceContext', () => {
    const userPrompt = {
        from: 'user' as const,
        to: 'data-agent' as const,
        role: 'prompt' as const,
        content: 'Show sales trend',
    };
    const agentInstruction = {
        from: 'data-agent' as const,
        to: 'datarec-agent' as const,
        role: 'instruction' as const,
        content: 'create line chart',
        displayContent: 'Line chart of sales',
    };

    it('returns null for non-derived table', () => {
        const root = makeTable('root');
        expect(buildExperienceContext(root, [root])).toBeNull();
    });

    it('returns null when no user prompt exists in chain', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [agentInstruction],
        });
        expect(buildExperienceContext(t1, [root, t1])).toBeNull();
    });

    it('builds context from single-step chain', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt, agentInstruction],
            dialog: [{ role: 'system', content: 'sys' }],
        });
        const ctx = buildExperienceContext(t1, [root, t1]);
        expect(ctx).not.toBeNull();
        expect(ctx!.user_question).toBe('Show sales trend');
        expect(ctx!.context_id).toBe('t1');
        expect(ctx!.dialog).toHaveLength(1);
        expect(ctx!.interaction).toHaveLength(2);
    });

    it('merges interaction/dialog from multi-step chain', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt, agentInstruction],
            dialog: [{ role: 'system', content: 'd1' }],
        });
        const step2Instruction = {
            from: 'data-agent' as const,
            to: 'datarec-agent' as const,
            role: 'instruction' as const,
            content: 'refine chart',
        };
        const t2 = makeDerived('t2', 't1', {
            interaction: [step2Instruction],
            dialog: [{ role: 'system', content: 'd2' }],
        });
        const ctx = buildExperienceContext(t2, [root, t1, t2]);
        expect(ctx).not.toBeNull();
        expect(ctx!.user_question).toBe('Show sales trend');
        expect(ctx!.context_id).toBe('t2');
        expect(ctx!.interaction).toHaveLength(3);
        expect(ctx!.dialog).toHaveLength(2);
    });

    it('skips deleted middle table (chain re-parented)', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt, agentInstruction],
            dialog: [{ role: 'system', content: 'd1' }],
        });
        const t2 = makeDerived('t2', 't1', {
            interaction: [{ from: 'data-agent', to: 'datarec-agent', role: 'instruction', content: 'step2' }],
            dialog: [{ role: 'system', content: 'd2' }],
        });
        const t3 = makeDerived('t3', 't2', {
            interaction: [{ from: 'data-agent', to: 'datarec-agent', role: 'instruction', content: 'step3' }],
            dialog: [{ role: 'system', content: 'd3' }],
            executionAttempts: [{ kind: 'visualize', status: 'ok', summary: 'ok' }],
        });

        // Simulate deleting t2: re-parent t3 to t1
        const t3AfterDelete = makeDerived('t3', 't1', {
            interaction: t3.derive!.trigger.interaction,
            dialog: t3.derive!.dialog,
            executionAttempts: t3.derive!.executionAttempts,
        });
        const tablesAfterDelete = [root, t1, t3AfterDelete];

        const ctx = buildExperienceContext(t3AfterDelete, tablesAfterDelete);
        expect(ctx).not.toBeNull();
        // t2's dialog should NOT be included (deleted)
        expect(ctx!.dialog).toHaveLength(2); // d1 + d3
        expect(ctx!.dialog.map((d: any) => d.content)).toEqual(['d1', 'd3']);
        // t3's own execution_attempts preserved
        expect(ctx!.execution_attempts).toHaveLength(1);
        expect(ctx!.execution_attempts![0].summary).toBe('ok');
    });

    it('preserves leaf execution_attempts (failure/repair)', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt, agentInstruction],
            executionAttempts: [
                { kind: 'visualize', attempt: 1, status: 'error', summary: 'failed', error: 'TypeError' },
                { kind: 'repair', attempt: 2, status: 'ok', summary: 'fixed' },
            ],
        });
        const ctx = buildExperienceContext(t1, [root, t1]);
        expect(ctx).not.toBeNull();
        expect(ctx!.execution_attempts).toHaveLength(2);
        expect(ctx!.execution_attempts![0].status).toBe('error');
        expect(ctx!.execution_attempts![1].status).toBe('ok');
    });
});
