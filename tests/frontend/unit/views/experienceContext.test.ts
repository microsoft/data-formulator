import { describe, it, expect } from 'vitest';
import {
    isLeafDerivedTable,
    buildLeafEvents,
    buildDistillModelConfig,
} from '../../../../src/views/experienceContext';
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
        description: '',
        ...overrides,
    } as DictTable;
}

function makeDerived(
    id: string,
    parentId: string,
    opts?: {
        interaction?: any[];
        dialog?: any[];
        anchored?: boolean;
        chart?: any;
        names?: string[];
        rows?: any[];
        rowCount?: number;
        code?: string;
    },
): DictTable {
    return makeTable(id, {
        anchored: opts?.anchored ?? false,
        names: opts?.names ?? ['col1'],
        rows: opts?.rows ?? [{ col1: 'a' }],
        virtual: { tableId: id, rowCount: opts?.rowCount ?? (opts?.rows ? opts.rows.length : 1) },
        derive: {
            source: [parentId],
            code: opts?.code ?? 'df = ...',
            outputVariable: 'result_df',
            dialog: opts?.dialog ?? [],
            trigger: {
                tableId: parentId,
                resultTableId: id,
                interaction: opts?.interaction ?? [],
                ...(opts?.chart ? { chart: opts.chart } : {}),
            },
        },
    });
}

// Helper: filter events by type
function eventsOfType(events: Array<Record<string, any>> | null, type: string) {
    return (events ?? []).filter(e => e.type === type);
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


// ── buildLeafEvents ───────────────────────────────────────────────────

describe('buildLeafEvents', () => {
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
    };

    it('returns null for non-derived table', () => {
        const root = makeTable('root');
        expect(buildLeafEvents(root, [root])).toBeNull();
    });

    it('returns null when no user-originated message exists in chain', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [agentInstruction],
        });
        expect(buildLeafEvents(t1, [root, t1])).toBeNull();
    });

    it('builds a flat event timeline from a single-step chain', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt, agentInstruction],
            // Only [tool: ...] dialog content becomes a tool_call event;
            // the rest is dropped (raw assistant snippets aren't useful).
            dialog: [
                { role: 'assistant', content: '[tool: explore]\n```python\n...```' },
                { role: 'system', content: 'system prompt' },
            ],
        });
        const ctx = buildLeafEvents(t1, [root, t1]);
        expect(ctx).not.toBeNull();

        const messages = eventsOfType(ctx, 'message');
        // 2 from interaction + 1 synthesized tool_call.
        // Order within a step: user input → tool calls → agent reply.
        expect(messages).toHaveLength(3);
        expect(messages[0]).toMatchObject({
            type: 'message',
            from: 'user',
            to: 'data-agent',
            role: 'prompt',
            content: 'Show sales trend',
        });
        expect(messages[1]).toMatchObject({
            from: 'data-agent',
            to: 'data-agent',
            role: 'tool_call',
            content: 'explore',
        });
        expect(messages[2]).toMatchObject({
            from: 'data-agent',
            to: 'datarec-agent',
            role: 'instruction',
        });

        // Each derived step always emits one create_table.
        const tables = eventsOfType(ctx, 'create_table');
        expect(tables).toHaveLength(1);
        expect(tables[0]).toMatchObject({
            type: 'create_table',
            table_id: 't1',
            source_tables: ['root'],
        });
    });

    it('emits one create_table per derived step in a multi-step chain', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt, agentInstruction],
        });
        const step2Instruction = {
            from: 'user' as const,
            to: 'data-agent' as const,
            role: 'instruction' as const,
            content: 'refine chart',
        };
        const t2 = makeDerived('t2', 't1', {
            interaction: [step2Instruction],
        });
        const ctx = buildLeafEvents(t2, [root, t1, t2]);
        expect(ctx).not.toBeNull();

        const tables = eventsOfType(ctx, 'create_table');
        expect(tables.map(e => e.table_id)).toEqual(['t1', 't2']);

        const messages = eventsOfType(ctx, 'message');
        // userPrompt + agentInstruction + step2Instruction
        expect(messages.map(m => m.content)).toEqual([
            'Show sales trend', 'create line chart', 'refine chart',
        ]);
    });

    it('skips the deleted middle table (chain re-parented)', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt, agentInstruction],
        });
        // Simulate t2 deleted: t3 re-parented directly to t1.
        const t3 = makeDerived('t3', 't1', {
            interaction: [{
                from: 'user', to: 'data-agent', role: 'instruction', content: 'step3',
            }],
        });
        const ctx = buildLeafEvents(t3, [root, t1, t3]);
        expect(ctx).not.toBeNull();
        const tables = eventsOfType(ctx, 'create_table');
        expect(tables.map(e => e.table_id)).toEqual(['t1', 't3']);
    });

    it('emits create_chart paired with create_table when the step has a chart', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt],
            chart: {
                chartType: 'bar',
                encodingMap: {
                    x: { fieldID: 'region', dtype: 'nominal' },
                    y: { fieldID: 'revenue', dtype: 'quantitative', aggregate: 'sum' },
                },
            },
        });
        const ctx = buildLeafEvents(t1, [root, t1]);
        expect(ctx).not.toBeNull();
        const types = ctx!.map(e => e.type);
        // create_table immediately followed by create_chart for the same step.
        const tIdx = types.indexOf('create_table');
        expect(types[tIdx + 1]).toBe('create_chart');
        const chart = ctx![tIdx + 1];
        expect(chart).toMatchObject({
            type: 'create_chart',
            related_table_id: 't1',
            mark_or_type: 'bar',
        });
        expect(chart.encoding_summary).toContain('x=region(nominal)');
        expect(chart.encoding_summary).toContain('y=revenue(quantitative) [sum]');
    });

    it('drops error-role and empty interaction entries', () => {
        const root = makeTable('root');
        const t1 = makeDerived('t1', 'root', {
            interaction: [
                userPrompt,
                { from: 'user', to: 'data-agent', role: 'instruction', content: '' },
                { from: 'user', to: 'data-agent', role: 'error', content: 'boom' },
            ],
        });
        const ctx = buildLeafEvents(t1, [root, t1]);
        const messages = eventsOfType(ctx, 'message');
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe('Show sales trend');
    });

    it('sends raw code (not a code shape summary)', () => {
        const root = makeTable('root');
        const code = "result_df = df.groupby('region').sum()";
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt],
            code,
        });
        const ctx = buildLeafEvents(t1, [root, t1]);
        const tables = eventsOfType(ctx, 'create_table');
        expect(tables[0].code).toBe(code);
        expect(tables[0]).not.toHaveProperty('code_shape');
    });

    it('includes columns, row_count, and sample_rows on create_table', () => {
        const root = makeTable('root');
        const rows = Array.from({ length: 8 }, (_, i) => ({ region: `R${i}`, revenue: i * 10 }));
        const t1 = makeDerived('t1', 'root', {
            interaction: [userPrompt],
            names: ['region', 'revenue'],
            rows,
            rowCount: rows.length,
        });
        const ctx = buildLeafEvents(t1, [root, t1]);
        const tables = eventsOfType(ctx, 'create_table');
        expect(tables[0].columns).toEqual(['region', 'revenue']);
        expect(tables[0].row_count).toBe(8);
        // Sample is capped at 5 rows.
        expect(tables[0].sample_rows).toHaveLength(5);
        expect(tables[0].sample_rows[0]).toEqual({ region: 'R0', revenue: 0 });
    });
});

describe('buildDistillModelConfig', () => {
    it('preserves global model identity so the backend can resolve server credentials', () => {
        const config = buildDistillModelConfig({
            id: 'global-openai-gpt-4o',
            endpoint: 'openai',
            model: 'gpt-4o',
            api_base: 'https://proxy.example.com/v1',
            api_version: '2025-04-01-preview',
            is_global: true,
        });

        expect(config).toMatchObject({
            id: 'global-openai-gpt-4o',
            endpoint: 'openai',
            model: 'gpt-4o',
            api_base: 'https://proxy.example.com/v1',
            api_version: '2025-04-01-preview',
            is_global: true,
        });
    });

    it('preserves user model api_base for custom endpoints', () => {
        const config = buildDistillModelConfig({
            id: 'custom-model',
            endpoint: 'openai',
            model: 'qwen',
            api_key: 'test-key',
            api_base: 'https://dashscope.example.com/compatible-mode/v1',
        });

        expect(config).toMatchObject({
            id: 'custom-model',
            endpoint: 'openai',
            model: 'qwen',
            api_key: 'test-key',
            api_base: 'https://dashscope.example.com/compatible-mode/v1',
        });
    });
});
