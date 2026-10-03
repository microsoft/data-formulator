import { describe, expect, it } from 'vitest';
import { REHYDRATE } from 'redux-persist';

import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';

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
    it.each(['rehydrate', 'load'] as const)('interrupts live metadata but preserves history and legacy text on %s', mode => {
        const steps = [
            { id: 'done', kind: 'tool', tool: 'run_terminal', label: 'Finished', status: 'completed', executionId: 'terminal' },
            { id: 'pending', kind: 'tool', tool: 'execute_python_script', label: 'Calculate', status: 'running', executionId: 'python' },
        ];
        const state = { textTurns: [{ kind: 'text', id: 'turn', textKind: 'explain', content: 'Keep this context',
            parentNodeId: 'conversation-root:test', progressSteps: steps,
            codeExecutions: [{ id: 'python', tool: 'execute_python_script', purpose: 'Calculate', code: 'print(1)', status: 'running' }],
            executions: [{ id: 'terminal', argv: ['pwd'], cwd: '/tmp', purpose: 'Finished', status: 'completed' }],
        }], draftNodes: [{ kind: 'draft', id: 'draft', parentNodeId: 'turn', derive: { status: 'running',
            progressSteps: steps, trigger: { interaction: [{ from: 'data-agent', to: 'user', role: 'instruction',
                content: 'History', plan: '✓ Creating chart\x1ERunning code' }] } } }] };
        const saved = JSON.parse(JSON.stringify(state));
        const restored = mode === 'rehydrate' ? rehydrate(saved) : dataFormulatorReducer(undefined, dfActions.loadState(saved));
        expect(restored.textTurns[0].progressSteps.map((step: any) => step.status)).toEqual(['completed', 'interrupted']);
        expect(restored.textTurns[0].content).toBe('Keep this context');
        expect(restored.textTurns[0].codeExecutions[0]).toMatchObject({ code: 'print(1)', status: 'interrupted' });
        expect(restored.textTurns[0].executions[0].status).toBe('completed');
        expect(restored.draftNodes[0].derive.progressSteps[1].status).toBe('interrupted');
        expect(restored.draftNodes[0].derive.trigger.interaction[0].plan).toBe('✓ Creating chart\x1ERunning code');
    });

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
