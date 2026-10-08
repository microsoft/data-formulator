import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { SimpleChartRecBox } from '../../../../src/views/SimpleChartRecBox';
import { buildTableRefChip } from '../../../../src/views/DataThreadCards';
import { apiRequest, streamRequest } from '../../../../src/app/apiClient';

vi.mock('../../../../src/app/apiClient', () => ({
    apiRequest: vi.fn(),
    streamRequest: vi.fn(),
}));

vi.mock('../../../../src/views/AgentPausePanel', () => ({
    ClarificationPanel: ({ onSubmit }: { onSubmit: (responses: any[]) => void }) => (
        <button onClick={() => onSubmit([{ question_index: 0, answer: 'Revenue', value: 'plan', source: 'option' }])}>Submit clarification</button>
    ),
    ExplanationPanel: ({ content, executions, codeExecutions, onClose }: { content: string; executions?: { id: string }[]; codeExecutions?: { id: string }[]; onClose: () => void }) =>
        <div data-testid="explanation-panel" data-terminal-calls={executions?.map(execution => execution.id).join(',')}
            data-code-calls={codeExecutions?.map(execution => execution.id).join(',')}>{content}<button aria-label="Close explanation" onClick={onClose} /></div>,
    ToolActivityPanel: ({ execution, onClose }: { execution: any; onClose: () => void }) =>
        <div data-testid="tool-activity-panel" data-terminal-calls={'code' in execution ? '' : execution.id}
            data-code-calls={'code' in execution ? execution.id : ''}>
            {JSON.stringify(execution)}<button onClick={onClose}>Close tool activity</button>
        </div>,
    FailedDraftPanel: ({ prompt, onRetry, retryDisabled }: { prompt?: string; onRetry: () => void; retryDisabled?: boolean }) =>
        <div>{prompt}<button disabled={retryDisabled} onClick={onRetry}>Retry</button></div>,
}));

describe('Analyst landing attachment handoff', () => {
    beforeEach(() => {
        vi.mocked(apiRequest).mockReset();
        vi.mocked(streamRequest).mockReset();
        vi.mocked(streamRequest).mockImplementation(async function* () {});
    });

    const mountTask = (task?: { text: string; images: string[]; attachments: string[] }) => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        const dispatchSpy = vi.spyOn(store, 'dispatch');
        if (task) store.dispatch(dfActions.queueAnalystTask(task));
        const { container } = render(<StrictMode><Provider store={store}><SimpleChartRecBox /></Provider></StrictMode>);
        return { store, dispatchSpy, container };
    };

    const requestBody = (index = 0) => JSON.parse(
        vi.mocked(streamRequest).mock.calls[index][1].body as string,
    );

    it('retries an interrupted later step with the request that started its run', async () => {
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'life', displayId: 'Life', names: [],
                metadata: {}, rows: [], virtual: { tableId: 'life', rowCount: 0 } } as any));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'loaded', displayId: 'Loaded', textKind: 'explain',
                content: 'Added three datasets.', parentNodeId: 'conversation-root:test', createdAt: 1,
                answered: true, answer: 'Explain them together' }));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'step-1', displayId: 'Step', textKind: 'explain',
                content: 'Compare the datasets', parentNodeId: 'loaded', actionId: 'run', createdAt: 2,
                codeExecutions: [{ id: 'step-1', tool: 'execute_python_script', code: 'print(1)', purpose: 'Compare', status: 'completed' }] }));
            store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'chart-data', displayId: 'Chart data', names: [],
                metadata: {}, rows: [], parentNodeId: 'step-1', derive: { source: ['life'], code: '', dialog: [],
                    trigger: { tableId: 'life', resultTableId: 'chart-data', interaction: [
                        { from: 'data-agent', to: 'datarec-agent', role: 'instruction', content: 'Exploration step 1' }] } } } as any));
            store.dispatch(dfActions.createDraftNode({ id: 'next-step', displayId: 'Next', parentNodeId: 'chart-data',
                parentTableId: 'chart-data', source: ['life'], interaction: [], actionId: 'run' }));
            store.dispatch(dfActions.updateDeriveStatus({ nodeId: 'next-step', status: 'interrupted' }));
            store.dispatch(dfActions.setFocused({ type: 'draft', draftId: 'next-step' }));
        });
        expect(screen.getByText('Explain them together')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody().user_question).toBe('Explain them together');
    });

    it.each(['Write a report', 'Create an app', 'Create a workflow'])('starts %s as a visible user prompt requesting suggestions', async label => {
        const { dispatchSpy } = mountTask();
        fireEvent.click(screen.getByRole('button', { name: 'Quick actions' }));
        expect(streamRequest).not.toHaveBeenCalled();
        expect(screen.getAllByRole('menuitem')).toHaveLength(3);
        fireEvent.click(screen.getByRole('menuitem', { name: label }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody()).not.toHaveProperty('max_iterations');
        const prompt = requestBody().user_question;
        expect(prompt).toContain({ 'Write a report': 'write a report', 'Create an app': 'build an interactive app',
            'Create a workflow': 'create a workflow' }[label]);
        expect(prompt).toContain('Suggest a few useful directions');
        const draftAction = dispatchSpy.mock.calls.map(([action]) => action as any)
            .find(action => action.type === dfActions.createDraftNode.type);
        expect(draftAction.payload.interaction).toEqual(expect.arrayContaining([
            expect.objectContaining({ from: 'user', role: 'prompt', content: prompt }),
        ]));
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/message', expect.anything());
    });

    it('routes the workflow shortcut to analyst chat even when a paused execution is focused', async () => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'paused-run', displayId: 'Paused run', textKind: 'explain',
            content: 'Waiting for inputs', parentNodeId: 'conversation-root:run', createdAt: 1,
            workflow: { runId: 'run', status: 'paused', stepId: 'inspect', calls: 1, steps: [], outputVersions: {} } }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-workflow-card-run', displayId: 'Workflow',
            textKind: 'explain', content: '', parentNodeId: 'paused-run', createdAt: 2, workflowCardFor: 'paused-run' }));
        const proposal = { content: 'name: New workflow', definition: { name: 'New workflow' } };
        const form = { kind: 'workflow', title: 'New workflow', workflow: proposal };
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'completion', status: 'success', content: { summary: 'A new proposal.', form } };
        });
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'paused-run' }));
        store.dispatch(dfActions.queueAnalystTask({ text: 'I want to create a workflow from this analysis.',
            images: [], attachments: [], intent: 'workflow-authoring' }));
        render(<StrictMode><Provider store={store}><SimpleChartRecBox /></Provider></StrictMode>);
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(String(vi.mocked(streamRequest).mock.calls[0][0])).not.toContain('/workflows/run');
        expect(requestBody().user_question).toContain('create a workflow');
        expect(requestBody().focused_thread).toEqual(expect.arrayContaining([expect.objectContaining({
            workflow: expect.objectContaining({ run_id: 'run' }),
        })]));
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/message', expect.anything());
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.form?.kind === 'workflow')).toBeDefined());
        expect(store.getState().textTurns.find(turn => turn.form?.kind === 'workflow')).toMatchObject({
            parentNodeId: 'textTurn-workflow-card-run', prompt: 'I want to create a workflow from this analysis.',
            form,
        });
        expect(store.getState().textTurns.find(turn => turn.id === 'paused-run')?.workflow?.status).toBe('paused');
    });

    it.each(['running', 'paused'] as const)('sends chat to the analyst while a %s workflow is focused', async status => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        const workflow = { runId: 'run', status, stepId: 'inspect', calls: 1, steps: [], outputVersions: {} };
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'active-run', displayId: 'Active run', textKind: 'explain',
            content: 'Inspecting data', parentNodeId: 'conversation-root:run', createdAt: 1, workflow }));
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'active-run' }));
        render(<Provider store={store}><SimpleChartRecBox /></Provider>);
        expect(screen.queryByRole('button', { name: 'Message workflow agent' })).not.toBeInTheDocument();
        expect(screen.queryByText('Message to:')).not.toBeInTheDocument();
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Create a new workflow organized around analytical goals.' } });
        if (status === 'running') fireEvent.keyDown(input, { key: 'Enter' });
        else fireEvent.click(screen.getByRole('button', { name: 'Explore' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(String(vi.mocked(streamRequest).mock.calls[0][0])).not.toContain('/workflows/');
        expect(requestBody().user_question).toContain('Create a new workflow');
        expect(requestBody().focused_thread).toEqual(expect.arrayContaining([expect.objectContaining({
            workflow: expect.objectContaining({ run_id: 'run' }),
        })]));
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/message', expect.anything());
        expect(store.getState().textTurns.find(turn => turn.id === 'active-run')).toMatchObject({ workflow });
        expect(store.getState().textTurns.find(turn => turn.id === 'active-run')?.answered).not.toBe(true);
    });

    it('keeps unrelated chat with the analyst while another workflow is running', async () => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'active-run', displayId: 'Active run', textKind: 'explain',
            content: '', parentNodeId: 'conversation-root:run', createdAt: 1,
            workflow: { runId: 'run', status: 'running', stepId: 'inspect', calls: 1, steps: [], outputVersions: {} } }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'other-chat', displayId: 'Other chat', textKind: 'explain',
            content: 'Previous analysis', parentNodeId: 'conversation-root:other', createdAt: 2 }));
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'other-chat' }));
        render(<Provider store={store}><SimpleChartRecBox /></Provider>);
        expect(screen.queryByRole('button', { name: 'Message workflow agent' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain this analysis' } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody().user_question).toContain('Explain this analysis');
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/message', expect.anything());
    });

    it('publishes workflow proposals in chat and carries the full definition into refinements', async () => {
        const proposal = { content: 'version: 1\nname: Daily trip review\noverview: Compare the previous day\ndeliverables: [Hourly chart]',
            definition: { name: 'Daily trip review', overview: 'Compare the previous day', deliverables: ['Hourly chart'] } };
        vi.mocked(apiRequest).mockResolvedValue({ data: { result: [], statistics: {} } } as any);
        const workflowForm = (workflow: typeof proposal) => ({ kind: 'workflow', title: workflow.definition.name, workflow });
        const workflowOf = (turn: any) => turn.form?.kind === 'workflow' ? turn.form.workflow : undefined;
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'completion', status: 'success', content: { summary: 'Review the proposed workflow.', form: workflowForm(proposal) } };
        });
        const { store } = mountTask({ text: 'Create a daily trip workflow from this analysis', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns.find(workflowOf)).toBeDefined());
        const turn = store.getState().textTurns.find(workflowOf)!;
        expect(turn.form).toEqual(workflowForm(proposal));
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: turn.id });
        expect(screen.queryByRole('region', { name: 'Workflow definition' })).toBeNull();
        expect(store.getState().fileNodes).toHaveLength(0);
        const revised = { content: `${proposal.content}\nparameters:\n  - name: target_date\n    type: text\n    required: true`,
            definition: { ...proposal.definition, parameters: [{ name: 'target_date', type: 'text', required: true }] } };
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'completion', status: 'success', content: { summary: 'Added the target date parameter.', form: workflowForm(revised) } };
        });
        act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Parameterize the target date', images: [], attachments: [] })));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(2));
        expect(requestBody(1).focused_thread).toEqual(expect.arrayContaining([expect.objectContaining({
            workflow_definition: proposal.content, agent_response: 'Review the proposed workflow.',
        })]));
        await waitFor(() => expect(store.getState().textTurns.filter(workflowOf)).toHaveLength(2));
        const revisionTurn = store.getState().textTurns.find(item => workflowOf(item)?.content === revised.content)!;
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: revisionTurn.id });
        expect(workflowOf(store.getState().textTurns.find(item => item.id === turn.id))).toEqual(proposal);
        act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Now add explicit source loading', images: [], attachments: [] })));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(3));
        expect(requestBody(2).focused_thread.filter((step: any) => step.workflow_definition)
            .map((step: any) => step.workflow_definition)).toEqual([proposal.content, revised.content]);
        expect(vi.mocked(streamRequest).mock.calls.every(([url]) => !String(url).includes('/workflows/run'))).toBe(true);
    });

    it.each([false, true])('keeps agent loading cards until the published table is registered (source: %s)', async includeSource => {
        const sourceReference = { kind: 'external-table-reference', id: 'external:warehouse:orders',
            connectorId: 'warehouse', tableKey: 'orders', sourceTable: { id: 'orders', name: 'All orders' },
            displayName: 'All orders', capturedAt: '2026-09-20T00:00:00Z', summary: { columns: [], rowCount: 2000000 } };
        let finishLoad!: () => void;
        const loading = new Promise<void>(resolve => { finishLoad = resolve; });
        let publish!: (value: any) => void;
        const listing = new Promise<any>(resolve => { publish = resolve; });
        vi.mocked(apiRequest).mockImplementation(async url => String(url).includes('list-tables')
            ? listing : { data: { result: [], statistics: {} } } as any);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'load_data', args: { tables: ['folder/orders.csv'] } };
            await loading;
            yield { type: 'tool_result', tool: 'load_data', status: 'ok' };
            yield { type: 'data_operation_result', operation: {
                schema_version: 1, id: 'operation', status: 'loaded', reason: 'Load orders',
                plans: [{ id: 'plan', hash: 'a'.repeat(64), label: 'Orders', summary: '',
                    steps: [{ kind: 'connector_query', display_name: 'Orders' }] }],
                result_table_ids: ['orders'],
                result_references: includeSource ? [sourceReference] : [],
            } };
        });
        const { store } = mountTask({ text: 'Load orders', images: [], attachments: [] });
        try {
            await waitFor(() => expect(store.getState().pendingTableLoads[0]?.names).toEqual(['orders.csv']));
            await act(async () => { finishLoad(); });
            await waitFor(() => expect(apiRequest).toHaveBeenCalled());
            expect(store.getState().pendingTableLoads).toHaveLength(1);
            expect(store.getState().inputTables).toHaveLength(0);
        } finally {
            await act(async () => { finishLoad(); publish({ data: { tables: [{ name: 'orders', columns: [], row_count: 5, sample_rows: [] }] } }); });
        }
        await waitFor(() => expect(store.getState().inputTables).toHaveLength(1));
        expect(store.getState().externalTableReferences).toEqual(includeSource ? [sourceReference] : []);
        expect(store.getState().pendingTableLoads).toEqual([]);
    });

    it('continues an approved load through chart creation and completion in the same stream', async () => {
        let finishAnalysis!: () => void;
        const analyzing = new Promise<void>(resolve => { finishAnalysis = resolve; });
        const operation = {
            schema_version: 1, id: 'operation', status: 'awaiting_selection', reason: 'Choose orders',
            plans: [{ id: 'plan', hash: 'a'.repeat(64), label: 'Revenue', summary: '',
                steps: [{ kind: 'connector_query', display_name: 'Orders' }] }],
            result_table_ids: [] as string[],
        };
        const trajectory = [{ role: 'user', content: 'Find orders and show revenue by year' }];
        vi.mocked(apiRequest).mockResolvedValue({ data: {
            tables: [{ name: 'orders', columns: [{ name: 'revenue', type: 'FLOAT' }],
                row_count: 1, sample_rows: [{ revenue: 30 }] }], result: [], statistics: {},
        } } as any);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'interact', data_operation: operation, trajectory, completed_step_count: 1,
                questions: [{ text: 'Use these orders?', responseType: 'single_choice', required: true,
                    options: [{ label: 'Revenue', value: 'plan' }] }] };
        }).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'load_data', args: { tables: ['Orders'] } };
            yield { type: 'tool_result', tool: 'load_data', status: 'ok' };
            yield { type: 'data_operation_result', operation: { ...operation,
                status: 'loaded', result_table_ids: ['orders'] } };
            await analyzing;
            yield { type: 'action', action: 'visualize', input_tables: ['orders'] };
            yield { type: 'result', status: 'success', content: { result: {
                status: 'ok', content: { rows: [{ year: 2025, revenue: 30 }],
                    virtual: { table_name: 'yearly_orders', row_count: 1 } },
                refined_goal: { output_variable: 'result', display_name: 'Yearly revenue',
                    field_metadata: { year: 'year', revenue: { semantic_type: 'quantitative', currency: 'USD' } },
                    field_display_names: { revenue: 'Revenue' } },
            } } };
            yield { type: 'completion', status: 'success', content: { summary: 'Revenue was 30 in 2025.' } };
        });
        const { store } = mountTask({ text: trajectory[0].content, images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(1));
        const proposalId = store.getState().textTurns[0].id;
        try {
            fireEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
            await waitFor(() => expect(store.getState().loadedTableNodes).toHaveLength(1));
            expect(requestBody(1).interaction_response).toEqual({ operation_id: 'operation', plan_id: 'plan' });
            expect(requestBody(1).trajectory).toEqual(trajectory);
            expect(store.getState().textTurns[0]).toMatchObject({ answered: true, dataOperation: { status: 'loaded' } });
            expect(store.getState().loadedTableNodes[0]).toMatchObject({ tableId: 'orders', parentNodeId: proposalId });
            expect(store.getState().draftNodes).toHaveLength(1);
            expect(store.getState().pendingTableLoads).toHaveLength(0);
        } finally {
            await act(async () => { finishAnalysis(); });
        }
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(2));
        expect(streamRequest).toHaveBeenCalledTimes(2);
        expect(store.getState().derivedTables[0]).toMatchObject({ id: 'yearly_orders', parentNodeId: proposalId });
        // Agent annotations are normalized: 'year' becomes Year, the encoding word is dropped, currency becomes the unit.
        expect(store.getState().tableSemantics.find(info => info.tableId === 'yearly_orders')?.fields).toMatchObject({
            year: { semanticType: 'Year' },
            revenue: { unit: 'USD', displayName: 'Revenue' },
        });
        expect(store.getState().textTurns[1]).toMatchObject({ parentNodeId: 'yearly_orders', content: 'Revenue was 30 in 2025.' });
        expect(store.getState().draftNodes).toHaveLength(0);
    });

    it('registers agent virtual sources without requesting local tables', async () => {
        const reference = { kind: 'external-table-reference', id: 'external:warehouse:orders',
            connectorId: 'warehouse', tableKey: 'orders', sourceTable: { id: 'orders', name: 'Orders' },
            displayName: 'Orders', capturedAt: '2026-09-20T00:00:00Z', summary: { columns: [], rowCount: 2000000 } };
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'data_operation_result', operation: {
                schema_version: 1, id: 'virtual-operation', status: 'loaded', reason: '',
                plans: [{ id: 'plan', hash: 'a'.repeat(64), label: 'Add orders', summary: '',
                    steps: [{ kind: 'connector_query', display_name: 'Orders' }] }], result_references: [reference],
            } };
            yield { type: 'completion', status: 'success', content: { summary: 'Added orders as a workspace reference.' } };
        });
        const { store } = mountTask({ text: 'Add orders', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().externalTableReferences).toEqual([reference]));
        expect(store.getState().inputTables).toEqual([]);
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(1));
        expect(store.getState().loadedTableNodes).toEqual([expect.objectContaining({ tableId: reference.id, external: true,
            parentNodeId: store.getState().textTurns[0].id })]);
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => String(url).includes('list-tables'))).toBe(false);
        expect(store.getState().pendingTableLoads).toEqual([]);
    });

    it.each(['cancel', 'error', 'disconnect'])('clears pending agent loads on %s', async outcome => {
        let finishRun!: () => void;
        const running = new Promise<void>(resolve => { finishRun = resolve; });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'load_data', args: { tables: ['Orders'] } };
            await running;
            if (outcome === 'error') yield { type: 'tool_result', tool: 'load_data', status: 'error' };
        });
        const { store } = mountTask({ text: 'Load orders', images: [], attachments: [] });
        try {
            await waitFor(() => expect(store.getState().pendingTableLoads).toHaveLength(1));
            if (outcome === 'cancel') {
                fireEvent.click(screen.getByTestId('StopIcon').closest('button')!);
                expect(store.getState().pendingTableLoads).toEqual([]);
            }
        } finally {
            await act(async () => { finishRun(); });
        }
        await waitFor(() => expect(store.getState().pendingTableLoads).toEqual([]));
    });

    it.each([['button', true], ['enter', true], ['button', false], ['enter', false]])(
        'submits a query from a focused reference via %s with loaded tables: %s', async (method, hasLoadedTables) => {
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'result', status: 'success', content: { result: {
                status: 'ok', content: { rows: [{ count: 10 }], virtual: { table_name: 'event_totals', row_count: 1 } },
                refined_goal: { output_variable: 'result', display_name: 'Event Totals' },
            } } };
            yield { type: 'completion', status: 'success', content: { summary: 'Review the event sources.' } };
        });
        const { store } = mountTask();
        const reference = {
            kind: 'external-table-reference' as const, id: 'external:adx:events',
            connectorId: 'adx', tableKey: 'events', sourceTable: { id: 'events', name: 'events' },
            displayName: 'Events', capturedAt: '2026-01-01T00:00:00Z',
            summary: { columns: [{ name: 'timestamp', type: 'datetime' }], rowCount: 20_000_000 },
        };
        act(() => {
            if (hasLoadedTables) store.dispatch(dfActions.loadState({ ...store.getState(), inputTables: [{
                kind: 'input-table', id: 'local', displayId: 'Local', description: '', addedAt: 1,
                source: { type: 'file' }, snapshot: { columns: [], rowCount: 0, capturedAt: 1 },
            }] }));
            store.dispatch(dfActions.upsertExternalTableReference(reference));
            store.dispatch(dfActions.setFocused({ type: 'external-table', referenceId: reference.id }));
        });
        expect(screen.getByRole('button', { name: 'Get idea suggestions' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Quick actions' })).toBeEnabled();
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Count events by region' } });
        expect(screen.getByRole('button', { name: 'Explore' })).toBeEnabled();
        if (method === 'enter') fireEvent.keyDown(input, { key: 'Enter' });
        else fireEvent.click(screen.getByRole('button', { name: 'Explore' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody().external_references).toEqual([reference]);
        expect(requestBody().focused_external_reference).toBe(reference.id);
        expect(requestBody().input_tables).toHaveLength(hasLoadedTables ? 1 : 0);
        expect(requestBody().input_tables.some((table: { id: string }) => table.id === reference.id)).toBe(false);
        expect(requestBody().focused_file).toBeUndefined();
        expect(store.getState().fileNodes).toEqual([]);
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(1));
        const reply = store.getState().textTurns[0];
        expect(reply.externalReferenceId).toBe(reference.id);
        const derived = store.getState().derivedTables[0];
        expect(derived.derive?.trigger.externalReferenceId).toBe(reference.id);
        act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: reply.id })));
        fireEvent.change(input, { target: { value: 'Show the ten most recent events' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(2));
        expect(requestBody(1).focused_external_reference).toBe(reference.id);
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(2));
        act(() => store.dispatch(dfActions.setFocused({ type: 'table', tableId: derived.id })));
        fireEvent.change(input, { target: { value: 'Show the source events for this result' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(3));
        expect(requestBody(2).focused_external_reference).toBe(reference.id);
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(3));
        act(() => {
            store.dispatch(dfActions.removeExternalTableReference(reference.id));
            store.dispatch(dfActions.setFocused({ type: 'table', tableId: derived.id }));
        });
        fireEvent.change(input, { target: { value: 'Describe the existing result' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(4));
        expect(requestBody(3).focused_external_reference).toBeUndefined();
        expect(requestBody(3).external_references).toEqual([]);
    });

    it.each([false, true])('suggests questions for a reference without loading it (loaded context: %s)', async hasLoadedTables => {
        vi.mocked(apiRequest).mockResolvedValue({ data: { result: ['Compare trips by vendor', 'Compare fares by vendor'] } } as any);
        const { store } = mountTask();
        const reference = {
            kind: 'external-table-reference' as const, id: 'external:taxi:trips', connectorId: 'taxi',
            tableKey: 'trips', sourceTable: { id: 'trips', name: 'trips' }, displayName: 'Trips',
            capturedAt: '2026-09-19T00:00:00Z',
            summary: { columns: [{ name: 'vendor', type: 'string' }, { name: 'fare', type: 'number' }],
                description: 'Taxi trips', rowCount: 20_000_000, sampleRows: [{ vendor: 'A', fare: 12 }],
                inspection: { sample_method: 'head', schema_complete: true } },
        };
        act(() => {
            if (hasLoadedTables) store.dispatch(dfActions.loadState({ ...store.getState(), inputTables: [{
                kind: 'input-table', id: 'local', displayId: 'Local', description: '', addedAt: 1,
                source: { type: 'file' }, snapshot: { columns: [], rowCount: 0, capturedAt: 1 },
            }] }));
            store.dispatch(dfActions.upsertExternalTableReference(reference));
            store.dispatch(dfActions.setFocused({ type: 'external-table', referenceId: reference.id }));
        });
        await screen.findByText('Compare trips by vendor', {}, { timeout: 2000 });
        const calls = vi.mocked(apiRequest).mock.calls.filter(([url]) => String(url).includes('derive-starter-questions'));
        expect(calls).toHaveLength(1);
        const body = JSON.parse(calls[0][1]!.body as string);
        expect(body.primary_table).toBe(reference.id);
        expect(body.input_tables).toHaveLength(hasLoadedTables ? 1 : 0);
        expect(body.external_references).toEqual([reference]);
        expect(store.getState().inputTables).toHaveLength(hasLoadedTables ? 1 : 0);
        expect(store.getState().derivedTables).toEqual([]);
        const signature = store.getState().starterQuestions[reference.id].signature;
        act(() => store.dispatch(dfActions.setFocused(undefined)));
        act(() => store.dispatch(dfActions.setFocused({ type: 'external-table', referenceId: reference.id })));
        expect(store.getState().starterQuestions[reference.id].signature).toBe(signature);
        const refreshed = { ...reference, summary: { ...reference.summary, sampleRows: [{ vendor: 'B', fare: 20 }] } };
        act(() => store.dispatch(dfActions.upsertExternalTableReference(refreshed)));
        await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => String(url).includes('derive-starter-questions')))
            .toHaveLength(2), { timeout: 2000 });
        expect(store.getState().starterQuestions[reference.id].signature).not.toBe(signature);
        fireEvent.click(await screen.findByText('Compare trips by vendor'));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody().focused_external_reference).toBe(reference.id);
        expect(requestBody().external_references).toEqual([refreshed]);
        act(() => store.dispatch(dfActions.removeExternalTableReference(reference.id)));
        expect(store.getState().starterQuestions[reference.id]).toBeUndefined();
        expect(store.getState().starterQuestionsStatus[reference.id]).toBeUndefined();
        act(() => store.dispatch(dfActions.setStarterQuestions({ tableId: reference.id,
            signature, questions: ['Stale question'] })));
        expect(store.getState().starterQuestions[reference.id]).toBeUndefined();
    });

    it('registers agent data and refreshes it under the same table and reference IDs', async () => {
        let value = 1;
        let finishRun!: () => void;
        const running = new Promise<void>(resolve => { finishRun = resolve; });
        vi.mocked(apiRequest).mockImplementation(async () => ({ data: {
            tables: [{ name: 'measurements', columns: [{ name: 'value', type: 'INTEGER' }],
                row_count: 1, sample_rows: [{ value }], content_hash: `hash-${value}`,
                origin: 'agent', role: 'source', edit_policy: 'agent_editable', input_sources: [] }],
            result: [], statistics: {},
        } }) as any);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_result', tool: 'create_data', status: 'ok',
                stdout: JSON.stringify({ table_name: 'measurements', display_name: 'Measurements' }) };
            value = 2;
            yield { type: 'tool_result', tool: 'update_data', status: 'ok',
                stdout: JSON.stringify({ table_name: 'measurements', display_name: 'Measurements' }) };
            yield { type: 'action', action: 'visualize', input_sources: [
                { id: 'data:hash-2:measurements', kind: 'data', display_name: 'measurements' },
            ] };
            yield { type: 'result', status: 'success', content: { result: {
                status: 'ok', content: { rows: [{ value: 4 }],
                    virtual: { table_name: 'doubled', row_count: 1 } },
                refined_goal: { output_variable: 'result', display_name: 'Doubled Measurements' },
            } } };
            await running;
        });
        const { store, dispatchSpy } = mountTask({ text: 'Create and revise measurements', images: [], attachments: [] });
        try {
            await waitFor(() => expect(dfSelectors.getAllTables(store.getState())[0]?.rows).toEqual([{ value: 2 }]));
            expect(store.getState().inputTables).toHaveLength(1);
            expect(store.getState().loadedTableNodes).toHaveLength(1);
            expect(store.getState().loadedTableNodes[0].parentNodeId).toMatch(/^conversation-root:/);
            expect(store.getState().inputTables[0].dataProvenance?.editPolicy).toBe('agent_editable');
            await waitFor(() => expect(store.getState().derivedTables).toHaveLength(1));
            expect(dispatchSpy.mock.calls.map(([action]) => action)
                .filter(dfActions.updateDraftSources.match).at(-1)?.payload.source).toEqual(['measurements']);
            const derived = dfSelectors.getAllTables(store.getState()).find(table => table.id === 'doubled');
            expect(derived?.displayId).toBe('Doubled Measurements');
            expect(derived?.derive?.source).toEqual(['measurements']);
            expect(derived?.derive?.trigger.tableId).toBe('measurements');
            expect(derived?.derive?.trigger.interaction?.at(-1)?.inputTableNames).toEqual(['Measurements']);
            expect(store.getState().fileNodes).toEqual([]);
        } finally {
            await act(async () => { finishRun(); });
        }
    });

    it('keeps newly created data after its request in an initially empty conversation', async () => {
        let finishRun!: () => void;
        const running = new Promise<void>(resolve => { finishRun = resolve; });
        vi.mocked(apiRequest).mockResolvedValue({ data: {
            tables: [{ name: 'retail_sales', columns: [{ name: 'revenue', type: 'INTEGER' }],
                row_count: 1, sample_rows: [{ revenue: 1200 }], content_hash: 'retail-hash',
                origin: 'agent', role: 'source', edit_policy: 'agent_editable', input_sources: [] }],
            result: [], statistics: {},
        } } as any);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_result', tool: 'create_data', status: 'ok',
                stdout: JSON.stringify({ table_name: 'retail_sales', display_name: 'Retail Sales' }) };
            await running;
            yield { type: 'completion', status: 'success', content: { summary: 'Created Retail Sales.' } };
        });
        const { store } = mountTask({ text: 'Create a demo dataset', images: [], attachments: [] });
        let rootId: string | undefined;
        try {
            await waitFor(() => expect(store.getState().loadedTableNodes).toHaveLength(1));
            const draft = store.getState().draftNodes[0];
            rootId = draft.parentNodeId;
            expect(rootId).toMatch(/^conversation-root:/);
            expect(store.getState().loadedTableNodes[0].parentNodeId).toBe(draft.id);
        } finally {
            await act(async () => { finishRun(); });
        }
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(1));
        const response = store.getState().textTurns[0];
        expect(response.parentNodeId).toBe(rootId);
        expect(response.prompt).toBe('Create a demo dataset');
        expect(store.getState().loadedTableNodes[0].parentNodeId).toBe(response.id);
        expect(store.getState().draftNodes).toHaveLength(0);
        act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: response.id })));
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'table', tableId: 'retail_sales' });
    });

    it('attaches automatically loaded data to its fresh conversation through completion', async () => {
        let finishRun!: () => void;
        const running = new Promise<void>(resolve => { finishRun = resolve; });
        vi.mocked(apiRequest).mockResolvedValue({ data: {
            tables: [{ name: 'consumer_prices', columns: [{ name: 'price', type: 'FLOAT' }],
                row_count: 241, sample_rows: [{ price: 12 }] }], result: [], statistics: {},
        } } as any);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'data_operation_result', operation: {
                schema_version: 1, id: 'operation', status: 'loaded', reason: 'Load consumer prices',
                plans: [{ id: 'plan', hash: 'a'.repeat(64), label: 'Consumer prices', summary: '',
                    steps: [{ kind: 'connector_query', display_name: 'Consumer prices' }] }],
                result_table_ids: ['consumer_prices'],
            } };
            await running;
            yield { type: 'completion', status: 'success', content: { summary: 'Loaded consumer prices.' } };
        });
        const { store } = mountTask({ text: 'Load consumer price data', images: [], attachments: [] });
        try {
            await waitFor(() => expect(store.getState().loadedTableNodes).toHaveLength(1));
            expect(store.getState().inputTables).toHaveLength(1);
            expect(store.getState().loadedTableNodes[0].parentNodeId).toBe(store.getState().draftNodes[0].id);
        } finally {
            await act(async () => { finishRun(); });
        }
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(1));
        const response = store.getState().textTurns[0];
        expect(response.prompt).toBe('Load consumer price data');
        expect(store.getState().loadedTableNodes[0]).toMatchObject({ tableId: 'consumer_prices', parentNodeId: response.id });
        expect(store.getState().draftNodes).toHaveLength(0);
        act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: response.id })));
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'table', tableId: 'consumer_prices' });
    });

    it('keeps successive loads after the latest chart without overwriting the opening response', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ data: {
            tables: ['daily', 'regional'].map(name => ({ name, columns: [{ name: 'value', type: 'FLOAT' }],
                row_count: 1, sample_rows: [{ value: 12 }] })), result: [], statistics: {},
        } } as any);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            for (const name of ['daily', 'regional']) {
                yield { type: 'data_operation_result', operation: {
                    schema_version: 1, id: `operation-${name}`, status: 'loaded', reason: `Load ${name}`,
                    plans: [{ id: 'plan', hash: 'a'.repeat(64), label: name, summary: '',
                        steps: [{ kind: 'connector_query', display_name: name }] }],
                    result_table_ids: [name],
                } };
                yield { type: 'tool_start', tool: 'inspect_source_data', tool_call_id: `inspect-${name}`, table_names: [name] } as any;
                yield { type: 'tool_result', tool: 'inspect_source_data', tool_call_id: `inspect-${name}`, status: 'ok' } as any;
                yield { type: 'action', action: 'visualize', input_tables: [name] };
                yield { type: 'result', status: 'success', content: { result: {
                    status: 'ok', content: { rows: [{ value: 12 }],
                        virtual: { table_name: `${name}_chart`, row_count: 1 } },
                    refined_goal: { output_variable: 'result', display_name: `${name} chart` },
                } } };
            }
            yield { type: 'completion', status: 'success', content: { summary: 'Created both charts.' } };
        });
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-opening', displayId: 'Opening',
                textKind: 'explain', content: 'Previous analysis.', parentNodeId: 'conversation-root:sales', createdAt: 1 }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: 'textTurn-opening' }));
        });
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explore daily and regional sales' } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(2));
        const state = store.getState();
        expect(state.derivedTables).toHaveLength(2);
        expect(state.loadedTableNodes.map(node => [node.tableId, node.parentNodeId])).toEqual([
            ['daily', 'textTurn-opening'], ['regional', 'daily_chart'],
        ]);
        expect(state.derivedTables.map(table => [table.id, table.parentNodeId])).toEqual([
            ['daily_chart', 'textTurn-opening'], ['regional_chart', 'daily_chart'],
        ]);
        state.derivedTables.forEach((table, index) => {
            const instruction = table.derive!.trigger.interaction!.find(entry => entry.role === 'instruction')!;
            expect(instruction.progressSteps).toMatchObject([
                { kind: 'tool', toolCallId: `inspect-${['daily', 'regional'][index]}`, status: 'completed' },
                { kind: 'chart', status: 'completed' },
            ]);
            expect(instruction.progressSteps).toHaveLength(2);
            expect(typeof instruction.plan).toBe('string');
        });
        expect(state.textTurns[0].dataOperation).toBeUndefined();
        expect(state.textTurns[0].content).toBe('Previous analysis.');
        expect(state.textTurns[1].parentNodeId).toBe('regional_chart');
        expect(state.draftNodes).toHaveLength(0);
    });

    it('focuses a loaded-table reference and continues its conversation', async () => {
        let finishRun!: () => void;
        const running = new Promise<void>(resolve => { finishRun = resolve; });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () { await running; });
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({
                kind: 'text', id: 'loaded-reply', displayId: 'loaded-reply', textKind: 'explain',
                parentNodeId: 'conversation-root:college', content: 'Loaded college majors.', createdAt: 1,
            }));
            store.dispatch(dfActions.addLoadedTableNode({
                kind: 'loaded-table', id: 'college-reference', tableId: 'college-majors',
                parentNodeId: 'loaded-reply', createdAt: 2,
            }));
        });
        const reference = render(buildTableRefChip({
            tableId: 'college-majors', loadedTableNodeId: 'college-reference',
            table: undefined, focused: false, dispatch: store.dispatch,
        }));
        fireEvent.click(reference.getByRole('button', { name: 'college-majors' }));
        expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'college-reference' });
        expect(reference.container.querySelector('.selected-artifact-card')).toBeNull();
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'table', tableId: 'college-majors' });
        expect(dfSelectors.getEffectiveTableId(store.getState())).toBe('college-majors');
        try {
            act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Which majors pay most?', images: [], attachments: [] })));
            await waitFor(() => expect(store.getState().draftNodes).toHaveLength(1));
            expect(store.getState().draftNodes[0].parentNodeId).toBe('loaded-reply');
            expect(store.getState().textTurns[0].answered).not.toBe(true);
        } finally {
            await act(async () => { finishRun(); });
        }
    });

    it('adds and opens an HTML app when the agent writes one', async () => {
        const refreshed = vi.fn();
        window.addEventListener('df:workspace-files-changed', refreshed);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'action', action: 'write_html_app', file: {
                name: 'sales_app.html', path: 'files/sales_app.html', display_name: 'Sales explorer',
                content_hash: 'app-hash', url: '/api/workspace/files/sales_app.html',
            } };
            yield { type: 'completion', status: 'success', content: { summary: 'The app compares revenue by region.' } };
        });
        try {
            const { store } = mountTask({ text: 'Build an interactive sales dashboard', images: [], attachments: [] });
            await waitFor(() => expect(store.getState().fileNodes).toHaveLength(1));
            expect(refreshed).toHaveBeenCalled();
            expect(store.getState().fileNodes[0]).toMatchObject({
                path: 'sales_app.html', displayName: 'Sales explorer', contentHash: 'app-hash',
            });
            await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
            await waitFor(() => expect(dfSelectors.selectCanvasTarget(store.getState()))
                .toEqual({ type: 'file', fileName: 'sales_app.html' }));
            expect(store.getState().inputTables).toHaveLength(0);

            // Closing the run's explanation keeps the app it explains on the canvas.
            await waitFor(() => expect(store.getState().textTurns.some(turn => turn.textKind === 'explain')).toBe(true));
            const explanation = store.getState().textTurns.find(turn => turn.textKind === 'explain')!;
            act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: explanation.id })));
            expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: 'sales_app.html' });
            fireEvent.click(await screen.findByRole('button', { name: /^Close/ }));
            expect(store.getState().focusedId).toEqual({ type: 'file', fileName: 'sales_app.html' });
        } finally {
            window.removeEventListener('df:workspace-files-changed', refreshed);
        }
    });

    it('brings an app into view after the agent revises it with edit_file', async () => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_result', tool: 'edit_file', status: 'ok', stdout: JSON.stringify({
                path: 'files/sales.app.jsx', name: 'sales.app.jsx', display_name: 'Sales explorer',
                content_hash: 'revised-hash', available_in_workspace: true, app: true, tables: ['sales'], warnings: [],
            }) };
            yield { type: 'completion', status: 'success', content: { summary: 'Added a units chart.' } };
        });
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'built', displayId: 'Built', textKind: 'explain',
                content: 'Built the dashboard.', parentNodeId: 'conversation-root:test', createdAt: 1 }));
            store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'file-sales.app.jsx', path: 'sales.app.jsx',
                displayName: 'Sales explorer', contentHash: 'old-hash', parentNodeId: 'built', createdAt: 1 }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'Add a units chart to the dashboard', images: [], attachments: [] }));
        });
        await waitFor(() => expect(store.getState().fileNodes[0]).toMatchObject({ contentHash: 'revised-hash', parentNodeId: 'built' }));
        // The run's explanation keeps the revised app on the canvas, though the app's node lives in an older turn.
        await waitFor(() => expect(store.getState().textTurns.some(turn => turn.content === 'Added a units chart.')).toBe(true));
        const explanation = store.getState().textTurns.find(turn => turn.content === 'Added a units chart.')!;
        expect(explanation.revisedFile).toBe('sales.app.jsx');
        act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: explanation.id })));
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: 'sales.app.jsx' });
    });

    it.each(['create_file', 'edit_file'])('refreshes artifacts immediately after %s without adding a durable table', async tool => {
        const refreshed = vi.fn();
        let finishRun!: () => void;
        const running = new Promise<void>(resolve => { finishRun = resolve; });
        window.addEventListener('df:workspace-files-changed', refreshed);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_result', tool, status: 'ok', stdout: JSON.stringify({
                path: 'files/summary.md', name: 'summary.md', display_name: 'Summary',
                content_hash: 'current-hash', available_in_workspace: true,
            }) };
            await running;
        });
        try {
            const { store } = mountTask({ text: 'Revise the summary draft', images: [], attachments: [] });
            await waitFor(() => expect(refreshed).toHaveBeenCalled());
            expect(store.getState().inputTables).toHaveLength(0);
            expect(store.getState().fileNodes).toHaveLength(1);
            expect(store.getState().fileNodes[0]).toMatchObject({ path: 'summary.md', displayName: 'Summary' });
            // Only app revisions take over the canvas.
            expect(store.getState().focusedId).not.toEqual({ type: 'file', fileName: 'summary.md' });
            act(() => store.dispatch(dfActions.setFocused({ type: 'reference', referenceId: store.getState().fileNodes[0].id })));
            expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: 'summary.md' });
        } finally {
            await act(async () => { finishRun(); });
            window.removeEventListener('df:workspace-files-changed', refreshed);
        }
    });

    it.each([
        { submission: 'panel', target: 'chart' },
        { submission: 'chat', target: 'chart' },
        { submission: 'panel', target: 'none' },
        { submission: 'panel', target: 'self' },
    ])(
        'preserves the canvas when submitting via $submission with $target target', async ({ submission, target }) => {
            let finishRun!: () => void;
            const running = new Promise<void>(resolve => { finishRun = resolve; });
            vi.mocked(streamRequest).mockImplementationOnce(async function* () { await running; });
            const { store, dispatchSpy } = mountTask();
            act(() => {
                store.dispatch(dfActions.addChart({ id: 'original-chart', chartType: 'Bar Chart', tableRef: 'orders', source: 'user', encodingMap: {} } as any));
                store.dispatch(dfActions.addChart({ id: 'newer-chart', chartType: 'Bar Chart', tableRef: 'orders', source: 'user', encodingMap: {} } as any));
                store.dispatch(dfActions.addTextTurn({
                    kind: 'text', id: 'question', displayId: 'question', textKind: 'clarify', content: 'Which metric?', createdAt: 2,
                    parentNodeId: 'conversation-root:test',
                    options: [{ text: 'Which metric?', responseType: 'single_choice', options: [{ label: 'Revenue' }] }],
                    ...(target === 'chart' ? { sourceChartId: 'original-chart' } : {}),
                    ...(target === 'self' ? { form: { kind: 'connector' as const, title: 'Connect', connector: { sourceType: 'mysql' } } } : {}),
                }));
                store.dispatch(dfActions.setFocused({ type: 'text', textId: 'question' }));
            });
            const previousCanvas = dfSelectors.selectCanvasTarget(store.getState());
            if (target === 'chart') expect(previousCanvas).toEqual({ type: 'chart', chartId: 'original-chart' });
            if (submission === 'panel') fireEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
            else act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Revenue', images: [], attachments: [] })));
            await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
            expect(store.getState().focusedId).toEqual(previousCanvas);
            expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual(previousCanvas);
            expect(screen.queryByTestId('explanation-panel')).toBeNull();
            expect(store.getState().textTurns.find(turn => turn.id === 'question')).toMatchObject({ answered: true, answer: 'Revenue' });
            const draft = dispatchSpy.mock.calls.map(([action]) => action).find(dfActions.createDraftNode.match);
            expect(draft?.payload.parentNodeId).toBe('question');
            act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: 'question' })));
            if (target === 'self') expect(screen.getByTestId('explanation-panel').textContent).toBe('Which metric?');
            else {
                expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual(previousCanvas);
                expect(screen.getByTestId('explanation-panel').textContent).toBe('Which metric?');
            }
            await act(async () => { finishRun(); });
        },
    );

    it.each([undefined, 'long_response'])('reserves the document canvas for explicit long responses: %s', async (presentation) => {
        const content = presentation ? 'An explicitly expanded answer.' : 'A normal answer. '.repeat(200);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'completion', status: 'success', content: { summary: content, presentation } };
        });
        const { store } = mountTask({ text: 'Answer my question', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(1));
        const turn = store.getState().textTurns[0];
        expect(turn.textKind).toBe('explain');
        expect(turn.presentation).toBe(presentation);
        expect(turn.form).toBeUndefined();
        expect(store.getState().generatedReports).toHaveLength(0);
        if (presentation) {
            expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: turn.id });
            expect(screen.queryByTestId('explanation-panel')).toBeNull();
        } else {
            expect(dfSelectors.selectCanvasTarget(store.getState())?.type).not.toBe('text');
            expect(screen.getByTestId('explanation-panel').textContent).toBe(content);
        }
    });

    it.each(['clarify', 'terminal'])('settles a written report when the run then pauses (%s)', async pause => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'action', action: 'write_report' };
            yield { type: 'text_delta', channel: 'report', content: '# SupportInsights\n\nThree big ideas.' };
            if (pause === 'clarify') {
                yield { type: 'clarify', questions: [{ text: 'Add a forecast?', options: ['Yes', 'No'] }],
                    trajectory: [{ role: 'user', content: 'Write a final report' }] } as any;
            } else {
                yield { type: 'interact', terminal_request: { id: 'run-1', argv: ['python', 'check.py'], cwd: '.',
                    purpose: 'Check figures' }, trajectory: [{ role: 'user', content: 'Write a final report' }],
                    completed_step_count: 2 } as any;
            }
        });
        const { store } = mountTask({ text: 'Write a final report', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().generatedReports[0]?.status).toBe('completed'));
        const [report] = store.getState().generatedReports;
        expect(report).toMatchObject({ title: 'SupportInsights', content: '# SupportInsights\n\nThree big ideas.' });
        // The pause turn closes the request; no empty closing turn is added for the report.
        expect(store.getState().textTurns.filter(turn => turn.textKind === 'explain' && !turn.content
            && !turn.executions?.length)).toHaveLength(0);
    });

    it.each(['success', 'empty-summary', 'error', 'disconnect', 'cancel', 'end'])('keeps report request and output together after %s', async outcome => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'action', action: 'write_report' };
            yield { type: 'text_delta', channel: 'report', content: '# Findings\n\nVerified observations.' };
            if (outcome === 'error') yield { type: 'error', message: 'LLM API error' };
            else if (outcome === 'disconnect') throw new Error('Connection lost');
            else if (outcome === 'cancel') throw new DOMException('Cancelled', 'AbortError');
            else if (outcome !== 'end') yield { type: 'completion', status: 'success',
                content: { summary: outcome === 'success' ? 'Report ready.' : '' } };
        });
        const { store } = mountTask({ text: 'Write a report for this analysis', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().generatedReports[0]?.status).toBe(
            ['success', 'empty-summary'].includes(outcome) ? 'completed' : 'error'));
        const report = store.getState().generatedReports[0];
        const owner = store.getState().textTurns.find(turn => turn.id === report.parentNodeId);
        expect(owner).toMatchObject({
            prompt: 'Write a report for this analysis',
            content: outcome === 'success' ? 'Report ready.' : '',
        });
        expect(report.content).toBe('# Findings\n\nVerified observations.');
        expect(store.getState().draftNodes).toHaveLength(0);
    });

    it.each([false, true])('keeps report ownership on the selected branch with answered=%s', async answered => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'text_delta', channel: 'report', content: '# Branch findings' };
            yield { type: 'error', message: 'LLM API error' };
        });
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-origin', displayId: 'Origin',
                textKind: 'explain', content: 'Earlier analysis', parentNodeId: 'conversation-root:original',
                createdAt: 1, answered, ...(answered ? { answer: 'Continue analysis' } : {}) }));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-newer', displayId: 'Later',
                textKind: 'explain', content: 'Later analysis', parentNodeId: 'textTurn-origin', createdAt: 2 }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: 'textTurn-origin' }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'Report on the earlier analysis', images: [], attachments: [] }));
        });
        await waitFor(() => expect(store.getState().generatedReports[0]?.status).toBe('error'));
        const report = store.getState().generatedReports[0];
        const owner = store.getState().textTurns.find(turn => turn.id === report.parentNodeId)!;
        expect(owner.parentNodeId).toBe('textTurn-origin');
        expect(owner.prompt).toBe(answered ? 'Report on the earlier analysis' : undefined);
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-origin')?.answer)
            .toBe(answered ? 'Continue analysis' : 'Report on the earlier analysis');
        expect(store.getState().draftNodes).toHaveLength(0);
    });

    it('keeps a form-associated chat turn focused when clicking outside the composer', async () => {
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({
                kind: 'text', id: 'form-owner', displayId: 'form-owner', textKind: 'explain',
                content: 'Connect MySQL', createdAt: 1, parentNodeId: 'conversation-root:test',
                form: { kind: 'connector', title: 'MySQL', connector: { sourceType: 'mysql' } },
            }));
            store.dispatch(dfActions.addTextTurn({
                kind: 'text', id: 'form-followup', displayId: 'form-followup', textKind: 'explain',
                content: 'Review the updated host.', sourceFormId: 'form-owner', parentNodeId: 'form-owner', createdAt: 2,
            }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: 'form-followup' }));
        });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        fireEvent.mouseDown(document.body);
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'form-followup' });
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: 'form-owner' });
        act(() => {
            store.dispatch(dfActions.addTextTurn({
                kind: 'text', id: 'ordinary-explanation', displayId: 'ordinary-explanation', textKind: 'explain',
                content: 'An unrelated answer.', createdAt: 3, parentNodeId: 'conversation-root:test',
            }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: 'ordinary-explanation' }));
        });
        fireEvent.mouseDown(document.body);
        expect(store.getState().focusedId).toBeUndefined();
    });

    it('opens a persistent form and updates that artifact from a sanitized follow-up snapshot', async () => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'interact', form: { kind: 'connector', title: 'MySQL connection',
                response: 'Review the connection form.', connector: { source_type: 'mysql' } } };
        });
        const { store } = mountTask({ text: 'Connect MySQL', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns.some(turn => turn.form)).toBe(true));
        const formId = store.getState().textTurns.find(turn => turn.form)!.id;
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: formId });
        act(() => {
            store.dispatch(dfActions.initializeConnectorDraft({ id: formId, fields: ['host'] }));
            store.dispatch(dfActions.updateDataLoaderConnectParams({ dataLoaderType: `connector-form:${formId}`,
                params: { host: 'user.example', password: 'never-send', unknown: 'hidden' } }));
        });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'interact', form: { kind: 'connector', form_id: formId, revision: 1,
                patch: { host: 'agent.example' }, response: 'Review the suggested host.' } };
        });
        act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Change the host', images: [], attachments: [] })));
        await waitFor(() => expect(store.getState().textTurns.some(turn => turn.sourceFormId === formId)).toBe(true));
        expect(requestBody(1).connector_form).toEqual({ form_id: formId, source_type: 'mysql',
            status: 'pending', revision: 1, values: { host: 'user.example' } });
        expect(JSON.stringify(requestBody(1))).not.toContain('never-send');
        expect(store.getState().dataLoaderConnectParams[`connector-form:${formId}`].host).toBe('agent.example');
        expect(store.getState().textTurns.filter(turn => turn.form)).toHaveLength(1);
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: formId });
    });

    it.each([['approve', false], ['reject', false], ['approve', true], ['reject', true]] as const)('resumes a terminal proposal only after explicit %s (bypass: %s) and records its outcome', async (decision, unsandboxed) => {
        const proposal = { id: 'terminal-request', argv: ['find', '/data', '-name', '*.csv'],
            cwd: '/data', purpose: 'Find CSV data', timeout_seconds: 60, dangerouslyDisableSandbox: unsandboxed,
            sandboxDisablingReason: unsandboxed ? 'Client needs host state' : '' };
        const trajectory = [{ role: 'user', content: 'Find local data' }];
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'interact', terminal_request: proposal, trajectory, completed_step_count: 2 } as any;
        });
        const { store } = mountTask({ text: 'Find local data', images: [], attachments: [] });
        if (unsandboxed) act(() => { store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, TERMINAL_MODE: 'auto' })); });
        await screen.findByRole('dialog');
        expect(streamRequest).toHaveBeenCalledTimes(1);
        const originalConversation = requestBody().conversation_id;
        expect(store.getState().textTurns).toHaveLength(1);
        const intentId = store.getState().textTurns[0].id;
        expect(store.getState().textTurns[0]).toMatchObject({
            content: proposal.purpose,
            executions: [{ id: proposal.id, status: 'awaiting_approval', argv: proposal.argv,
                dangerouslyDisableSandbox: unsandboxed, sandboxDisablingReason: proposal.sandboxDisablingReason }],
        });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            if (decision === 'approve') yield { type: 'tool_start', tool: 'run_terminal', tool_call_id: proposal.id,
                purpose: proposal.purpose, args: { purpose: proposal.purpose } } as any;
            yield { type: 'terminal_running' };
            if (decision === 'approve') {
                expect(store.getState().draftNodes.at(-1)?.derive.runningPlan).toContain(proposal.purpose);
                expect(store.getState().draftNodes.at(-1)?.derive.progressSteps).toMatchObject([
                    { tool: 'run_terminal', toolCallId: proposal.id, executionId: proposal.id, status: 'running' },
                ]);
                expect(store.getState().draftNodes.at(-1)?.derive.progressSteps).toHaveLength(1);
            }
            yield { type: 'terminal_result', request: proposal,
                result: decision === 'approve' ? { exit_code: 0, output: '/data/sales.csv' } : { rejected: true } } as any;
            yield { type: 'interact', form: { kind: 'connector', title: 'Local data',
                response: 'Review the discovered folder.', connector: { source_type: 'local_folder' } } } as any;
        });
        fireEvent.click(screen.getByRole('button', { name: decision === 'approve' ? unsandboxed ? 'Run outside sandbox' : 'Run once' : 'Reject' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(2));
        expect(requestBody(1)).toMatchObject({
            conversation_id: originalConversation, trajectory, completed_step_count: 2,
            terminal_response: { request_id: proposal.id, decision },
        });
        expect(requestBody(1).terminal_response).not.toHaveProperty('argv');
        expect(requestBody(1).terminal_response).not.toHaveProperty('dangerouslyDisableSandbox');
        expect(requestBody(1).terminal_response).not.toHaveProperty('sandboxDisablingReason');
        await waitFor(() => expect(store.getState().textTurns.some(turn => turn.form)).toBe(true));
        expect(store.getState().textTurns).toHaveLength(2);
        expect(store.getState().textTurns[0]).toMatchObject({
            id: intentId, content: proposal.purpose,
            executions: [{ id: proposal.id, status: decision === 'approve' ? 'completed' : 'rejected',
                dangerouslyDisableSandbox: unsandboxed, sandboxDisablingReason: proposal.sandboxDisablingReason,
                result: decision === 'approve' ? { exit_code: 0, output: '/data/sales.csv' } : { rejected: true } }],
        });
        expect(store.getState().textTurns[1].parentNodeId).toBe(intentId);
        if (decision === 'approve') expect(store.getState().textTurns[0].progressSteps).toMatchObject([
            { tool: 'run_terminal', toolCallId: proposal.id, executionId: proposal.id, status: 'completed' },
        ]);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each(['completed', 'interrupted'] as const)('records Auto terminal commands as %s without an approval dialog', async outcome => {
        const proposal = { id: 'auto-command', argv: ['find', '/data'], cwd: '/data', purpose: 'Find local data', timeout_seconds: 60 };
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'terminal_started', request: proposal } as any;
            yield { type: 'terminal_running' } as any;
            if (outcome === 'interrupted') throw new Error('Connection lost');
            yield { type: 'terminal_result', request: proposal, result: { exit_code: 0, output: '/data/sales.csv' } } as any;
        });
        const { store } = mountTask({ text: 'Find local data', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns[0]?.executions?.[0].status).toBe(outcome));
        expect(store.getState().textTurns[0]).toMatchObject({ content: proposal.purpose,
            executions: [{ id: proposal.id, argv: proposal.argv, cwd: proposal.cwd }] });
        expect(streamRequest).toHaveBeenCalledTimes(1);
        expect(requestBody().terminal_response).toBeUndefined();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps one prompt owner while an Auto terminal command continues', async () => {
        const proposal = { id: 'auto-prompt-owner', argv: ['az', 'account', 'show'], cwd: '/data',
            purpose: 'Discover accessible Azure account context', timeout_seconds: 60 };
        let resumeStream!: () => void;
        const continuation = new Promise<void>(resolve => { resumeStream = resolve; });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'terminal_started', request: proposal } as any;
            await continuation;
            yield { type: 'terminal_result', request: proposal, result: { exit_code: 0, output: 'Account available' } } as any;
            yield { type: 'completion', content: { summary: 'Account inspected.' } } as any;
        });
        const { store } = mountTask({ text: 'Analyze Azure usage', images: [], attachments: [] });
        try {
            await waitFor(() => expect(store.getState().textTurns[0]?.executions?.[0].status).toBe('running'));
            const state = store.getState();
            const terminalTurn = state.textTurns[0];
            expect(terminalTurn.prompt).toBe('Analyze Azure usage');
            expect(state.draftNodes).toHaveLength(1);
            expect(state.draftNodes[0].derive.trigger.interaction?.filter(entry => entry.role === 'prompt')).toHaveLength(0);
            expect(state.draftNodes[0].parentNodeId).toBe(terminalTurn.id);
            expect(state.draftNodes[0].derive.runningPlan).toContain(proposal.purpose);
            expect(state.draftNodes[0].derive.progressSteps).toMatchObject([
                { kind: 'tool', tool: 'run_terminal', toolCallId: proposal.id, executionId: proposal.id, status: 'running' },
            ]);
            expect(streamRequest).toHaveBeenCalledTimes(1);
            expect(requestBody().user_question).toBe('Analyze Azure usage');
        } finally {
            await act(async () => { resumeStream(); });
        }
        await waitFor(() => expect(store.getState().draftNodes).toHaveLength(0));
        expect(store.getState().textTurns.filter(turn => turn.prompt === 'Analyze Azure usage')).toHaveLength(1);
    });

    it.each(['completed', 'failed', 'interrupted'] as const)('retains Python code and its %s result on a clickable step', async outcome => {
        let continueStream!: () => void;
        const continuation = new Promise<void>(resolve => { continueStream = resolve; });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'execute_python_script', code: 'print(42)', purpose: 'Calculate total' } as any;
            await continuation;
            if (outcome === 'interrupted') throw new Error('Connection lost');
            yield { type: 'tool_result', tool: 'execute_python_script', status: outcome === 'failed' ? 'error' : 'ok',
                stdout: '42', error: outcome === 'failed' ? 'Calculation failed' : undefined } as any;
            yield { type: 'completion', content: { summary: 'Calculation finished.' } } as any;
        });
        const { store } = mountTask({ text: 'Calculate a total', images: [], attachments: [] });
        try {
            await waitFor(() => expect(store.getState().textTurns[0]?.codeExecutions?.[0].status).toBe('running'));
            expect(store.getState().draftNodes[0].derive.runningPlan).toContain('Calculate total');
            expect(store.getState().textTurns.filter(turn => turn.prompt)).toHaveLength(1);
        } finally {
            await act(async () => { continueStream(); });
        }
        await waitFor(() => expect(store.getState().textTurns[0]?.codeExecutions?.[0].status).toBe(outcome));
        const step = store.getState().textTurns[0];
        expect(step.progressSteps).toMatchObject([{ kind: 'tool', tool: 'execute_python_script',
            status: outcome, executionId: step.codeExecutions![0].id }]);
        expect(step.codeExecutions![0].code).toBe('print(42)');
        if (outcome !== 'interrupted') expect(step.codeExecutions![0].output).toBe('42');
        if (outcome === 'failed') expect(step.codeExecutions![0].error).toBe('Calculation failed');
        const focus = store.getState().focusedId;
        act(() => { window.dispatchEvent(new CustomEvent('df-view-tool-activity', { detail: {
            nodeId: step.id, execution: step.codeExecutions![0],
        } })); });
        await waitFor(() => expect(screen.getByTestId('tool-activity-panel')).toHaveAttribute('data-code-calls', step.codeExecutions![0].id));
        expect(screen.queryByTestId('explanation-panel')).toBeNull();
        expect(store.getState().focusedId).toEqual(focus);
        fireEvent.click(screen.getByRole('button', { name: 'Close tool activity' }));
        expect(screen.queryByTestId('tool-activity-panel')).toBeNull();
    });

    it.each(['chart', 'answer', 'long_response'] as const)('opens chart-step explanations above the composer without replacing the selected %s', target => {
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addChart({ id: 'original-chart', chartType: 'Bar Chart', tableRef: 'orders', source: 'user', encodingMap: {} } as any));
            store.dispatch(dfActions.addChart({ id: 'other-chart', chartType: 'Bar Chart', tableRef: 'orders', source: 'user', encodingMap: {} } as any));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'answer', displayId: 'Answer', textKind: 'explain',
                content: 'Existing answer', createdAt: 1, sourceChartId: 'original-chart', parentNodeId: 'conversation-root:test',
                ...(target === 'long_response' ? { presentation: 'long_response' as const } : {}) }));
            store.dispatch(dfActions.setFocused(target === 'chart'
                ? { type: 'chart', chartId: 'original-chart' } : { type: 'text', textId: 'answer' }));
        });
        const focus = store.getState().focusedId;
        const canvas = dfSelectors.selectCanvasTarget(store.getState());
        const openExplanation = () => act(() => {
            window.dispatchEvent(new CustomEvent('df-view-explanation', { detail: {
                content: 'Compare storage accounts', sourceTableId: 'orders', timestamps: [123],
            } }));
        });
        openExplanation();
        expect(screen.getByTestId('explanation-panel').textContent).toBe('Compare storage accounts');
        expect(screen.queryByTestId('tool-activity-panel')).toBeNull();
        expect(store.getState().focusedId).toEqual(focus);
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual(canvas);
        fireEvent.click(screen.getByRole('button', { name: 'Close explanation' }));
        expect(screen.queryByText('Compare storage accounts')).toBeNull();
        expect(store.getState().focusedId).toEqual(focus);
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual(canvas);
        openExplanation();
        act(() => store.dispatch(dfActions.setFocused({ type: 'chart', chartId: 'other-chart' })));
        expect(screen.queryByText('Compare storage accounts')).toBeNull();
    });

    it('keeps only the selected execution in the panel, refreshes it, and dismisses on navigation', async () => {
        const { store } = mountTask();
        const calls = [
            { id: 'first-call', tool: 'execute_python_script', purpose: 'First check', code: 'print(1)', status: 'running' as const },
            { id: 'second-call', tool: 'execute_python_script', purpose: 'Second check', code: 'print(2)', status: 'completed' as const },
        ];
        act(() => store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'activity-owner', displayId: 'Activity', textKind: 'explain',
            content: 'Response stays separate', parentNodeId: 'conversation-root:test', createdAt: 1, codeExecutions: calls })));
        const focus = store.getState().focusedId;
        act(() => { window.dispatchEvent(new CustomEvent('df-view-tool-activity', { detail: { nodeId: 'activity-owner', execution: calls[0] } })); });
        expect(screen.getByTestId('tool-activity-panel')).toHaveAttribute('data-code-calls', 'first-call');
        expect(screen.getByTestId('tool-activity-panel').textContent).not.toContain('second-call');
        expect(screen.getByTestId('tool-activity-panel').textContent).not.toContain('Response stays separate');
        expect(store.getState().focusedId).toEqual(focus);
        act(() => store.dispatch(dfActions.updateTextTurn({ id: 'activity-owner', codeExecutions: [
            { ...calls[0], status: 'completed', output: 'Fresh result' }, calls[1],
        ] })));
        expect(screen.getByTestId('tool-activity-panel').textContent).toContain('Fresh result');
        act(() => { window.dispatchEvent(new CustomEvent('df-view-tool-activity', { detail: { nodeId: 'activity-owner', execution: calls[1] } })); });
        expect(screen.getByTestId('tool-activity-panel')).toHaveAttribute('data-code-calls', 'second-call');
        expect(screen.getByTestId('tool-activity-panel').textContent).not.toContain('Fresh result');
        act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: 'activity-owner' })));
        expect(screen.queryByTestId('tool-activity-panel')).toBeNull();
    });

    it('correlates repeated Python calls by ID through out-of-order results and save/load', async () => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'execute_python_script', tool_call_id: 'first', code: 'print(1)', purpose: 'Inspect first' } as any;
            yield { type: 'tool_start', tool: 'execute_python_script', tool_call_id: 'second', code: 'print(2)', purpose: 'Inspect second' } as any;
            yield { type: 'tool_result', tool: 'execute_python_script', tool_call_id: 'unknown', status: 'ok', stdout: 'Wrong call' } as any;
            expect(store.getState().textTurns.map(turn => turn.codeExecutions?.[0].status)).toEqual(['running', 'running']);
            yield { type: 'tool_result', tool: 'execute_python_script', tool_call_id: 'second', status: 'error', stdout: 'second output', error: 'second failed' } as any;
            expect(store.getState().textTurns.map(turn => turn.codeExecutions?.[0].status)).toEqual(['running', 'failed']);
            yield { type: 'context_info', rules_injected: ['Additional context'] } as any;
            yield { type: 'tool_result', tool: 'execute_python_script', tool_call_id: 'first', status: 'ok', stdout: 'first output' } as any;
            yield { type: 'completion', content: { summary: 'Finished both calls.' } } as any;
        });
        const { store } = mountTask({ text: 'Run both checks', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns.at(-1)?.content).toBe('Finished both calls.'));
        const turns = store.getState().textTurns;
        expect(turns[0].codeExecutions![0]).toMatchObject({ code: 'print(1)', output: 'first output', status: 'completed' });
        expect(turns[1].codeExecutions![0]).toMatchObject({ code: 'print(2)', output: 'second output', status: 'failed' });
        expect(turns[0].progressSteps![0]).toMatchObject({ toolCallId: 'first', status: 'completed', executionId: turns[0].codeExecutions![0].id });
        expect(turns[1].progressSteps![0]).toMatchObject({ toolCallId: 'second', status: 'failed', executionId: turns[1].codeExecutions![0].id });
        expect(turns[0].progressSteps![0].id).not.toBe(turns[1].progressSteps![0].id);
        expect(turns[2].progressSteps!.filter(step => step.kind === 'tool')).toMatchObject([
            { toolCallId: 'first', status: 'completed' }, { toolCallId: 'second', status: 'failed' },
        ]);
        const restored = dataFormulatorReducer(undefined, dfActions.loadState(JSON.parse(JSON.stringify(store.getState()))));
        expect(restored.textTurns.map(turn => turn.progressSteps)).toEqual(turns.map(turn => turn.progressSteps));
    });

    it('does not guess which concurrent ID-less call an uncorrelated result belongs to', async () => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'execute_python_script', code: 'print(1)' } as any;
            yield { type: 'tool_start', tool: 'execute_python_script', code: 'print(2)' } as any;
            yield { type: 'tool_result', tool: 'execute_python_script', status: 'ok', stdout: 'Ambiguous output' } as any;
            yield { type: 'completion', content: { summary: 'Stream ended.' } } as any;
        });
        const { store } = mountTask({ text: 'Run legacy checks', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns.at(-1)?.content).toBe('Stream ended.'));
        expect(store.getState().textTurns.slice(0, 2).map(turn => turn.progressSteps![0].status)).toEqual(['interrupted', 'interrupted']);
        expect(store.getState().textTurns.slice(0, 2).map(turn => turn.codeExecutions![0].output)).toEqual([undefined, undefined]);
    });

    it('preserves progress across a clarification without mixing it into the resumed stage', async () => {
        const trajectory = [{ role: 'user', content: 'Choose a metric' }];
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'inspect_source_data', tool_call_id: 'before-pause' } as any;
            yield { type: 'tool_result', tool: 'inspect_source_data', tool_call_id: 'before-pause', status: 'ok' } as any;
            yield { type: 'clarify', questions: [{ text: 'Which metric?', options: ['Revenue'] }], trajectory } as any;
        });
        const { store } = mountTask({ text: 'Choose a metric', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns[0]?.textKind).toBe('clarify'));
        expect(store.getState().textTurns[0].progressSteps).toMatchObject([{ toolCallId: 'before-pause', status: 'completed' }]);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'inspect_source_data', tool_call_id: 'after-pause' } as any;
            yield { type: 'tool_result', tool: 'inspect_source_data', tool_call_id: 'after-pause', status: 'ok' } as any;
            yield { type: 'completion', content: { summary: 'Revenue inspected.' } } as any;
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
        await waitFor(() => expect(store.getState().textTurns.at(-1)?.content).toBe('Revenue inspected.'));
        expect(requestBody(1).trajectory).toEqual(trajectory);
        expect(store.getState().textTurns[0].progressSteps).toMatchObject([{ toolCallId: 'before-pause', status: 'completed' }]);
        expect(store.getState().textTurns[1].progressSteps).toMatchObject([{ toolCallId: 'after-pause', status: 'completed' }]);
        expect(store.getState().textTurns[1].progressSteps).toHaveLength(1);
    });

    it('marks a command interrupted if its stream ends before a result', async () => {
        const proposal = { id: 'dropped-command', argv: ['find', '/data'], cwd: '/data',
            purpose: 'Find local data', timeout_seconds: 60 };
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'interact', terminal_request: proposal, trajectory: [], completed_step_count: 1 } as any;
        });
        const { store } = mountTask({ text: 'Find local data', images: [], attachments: [] });
        await screen.findByRole('dialog');
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'terminal_running' } as any;
            throw new Error('Connection lost');
        });
        fireEvent.click(screen.getByRole('button', { name: 'Run once' }));
        await waitFor(() => expect(store.getState().textTurns[0].executions?.[0].status).toBe('interrupted'));
        expect(store.getState().textTurns).toHaveLength(1);
    });

    it('sends queued images and uploaded scratch paths and labels the prompt', async () => {
        const image = 'data:image/png;base64,aW1hZ2U=';
        const { store, dispatchSpy } = mountTask({
            text: 'Extract data and show',
            images: [image],
            attachments: ['sales_ab12.csv'],
        });

        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody()).toMatchObject({
            user_question: 'Extract data and show',
            attached_images: [image],
            scratch_files: ['scratch/sales_ab12.csv'],
        });
        expect(store.getState().analystChatPending).toBeNull();
        const draftAction = dispatchSpy.mock.calls.map(([action]) => action)
            .find(dfActions.createDraftNode.match);
        expect(draftAction?.payload.interaction[0]).toMatchObject({
            content: 'Extract data and show',
            attachments: ['sales_ab12.csv', 'image'],
        });
    });

    it.each([
        { text: '', images: ['data:image/png;base64,aW1hZ2U='], attachments: [] },
        { text: '', images: [], attachments: ['sales_ab12.csv'] },
    ])('sends an attachment-only task: %j', async task => {
        mountTask(task);
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody().user_question).toBe('');
        if (task.images.length) expect(requestBody().attached_images).toEqual(task.images);
        if (task.attachments.length) expect(requestBody().scratch_files).toEqual(['scratch/sales_ab12.csv']);
    });

    it('allows the same prompt again with different attachments', async () => {
        const { store } = mountTask({ text: 'Extract data', images: [], attachments: ['first.csv'] });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));

        act(() => {
            store.dispatch(dfActions.queueAnalystTask({
                text: 'Extract data', images: [], attachments: ['second.csv'],
            }));
        });

        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(2));
        expect(requestBody(1).scratch_files).toEqual(['scratch/second.csv']);
    });

    it('keeps text-only requests free of attachment fields', async () => {
        mountTask({ text: 'Find data', images: [], attachments: [] });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody()).not.toHaveProperty('attached_images');
        expect(requestBody()).not.toHaveProperty('scratch_files');
    });

    it.each(['scratch/computed.parquet', 'notes.md'])('sends the focused file independently of attachments: %s', async fileName => {
        const { store } = mountTask();
        act(() => store.dispatch(dfActions.setFocused({ type: 'file', fileName })));
        act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Analyze this file', images: [], attachments: [] })));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody().focused_file).toBe(fileName);
        expect(requestBody()).not.toHaveProperty('scratch_files');
        await waitFor(() => expect(store.getState().draftNodes.every(draft => draft.derive.status !== 'running')).toBe(true));
        act(() => store.dispatch(dfActions.setFocused(undefined)));
        act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Next question', images: [], attachments: [] })));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(2));
        expect(requestBody(1)).not.toHaveProperty('focused_file');
    });

    it.each([
        { name: 'table.png', type: 'image/png', path: 'scratch/table_ab12.png' },
        { name: 'table.csv', type: 'text/csv', path: 'scratch/table_ab12.csv' },
    ])('uploads a main-chat attachment before sending: $name', async ({ name, type, path }) => {
        let finishUpload!: (value: { data: { path: string } }) => void;
        vi.mocked(apiRequest).mockReturnValue(new Promise(resolve => { finishUpload = resolve; }));
        const { container } = mountTask();
        const file = new File(['test-data'], name, { type });
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Extract data' } });

        await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
        const [url, options] = vi.mocked(apiRequest).mock.calls[0];
        expect(url).toBe('/api/agent/workspace/scratch/upload');
        expect((options?.body as FormData).get('file')).toBe(file);
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(streamRequest).not.toHaveBeenCalled();

        await act(async () => { finishUpload({ data: { path } }); });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody().scratch_files).toEqual([path]);
        if (type.startsWith('image/')) {
            expect(requestBody().attached_images).toEqual([expect.stringMatching(/^data:image\/png;base64,/)]);
        } else {
            expect(requestBody()).not.toHaveProperty('attached_images');
        }
    });

    it('sends an uploaded image without requiring text', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ data: { path: 'scratch/table_ab12.png' } });
        const { container } = mountTask();
        fireEvent.change(container.querySelector('input[type="file"]')!, {
            target: { files: [new File(['image'], 'table.png', { type: 'image/png' })] },
        });
        await screen.findByText('image');
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody().scratch_files).toEqual(['scratch/table_ab12.png']);
        expect(requestBody().user_question).toBe('');
    });

    it('removes both the image and its scratch reference when detached', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ data: { path: 'scratch/table_ab12.png' } });
        const { container } = mountTask();
        fireEvent.change(container.querySelector('input[type="file"]')!, {
            target: { files: [new File(['image'], 'table.png', { type: 'image/png' })] },
        });
        const chip = (await screen.findByText('image')).closest('.MuiChip-root')!;
        fireEvent.click(chip.querySelector('.MuiChip-deleteIcon')!);
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Find data' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody()).not.toHaveProperty('scratch_files');
        expect(requestBody()).not.toHaveProperty('attached_images');
    });

    it('reports failed uploads without attaching an unsaved image', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            vi.mocked(apiRequest).mockRejectedValue(new Error('Upload failed'));
            const { container, dispatchSpy } = mountTask();
            fireEvent.change(container.querySelector('input[type="file"]')!, {
                target: { files: [new File(['image'], 'table.png', { type: 'image/png' })] },
            });
            await waitFor(() => expect(dispatchSpy.mock.calls.some(([action]) => dfActions.addMessages.match(action))).toBe(true));
            expect(screen.queryByText('image')).not.toBeInTheDocument();
            const input = screen.getByRole('textbox');
            fireEvent.change(input, { target: { value: 'Find data' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
            expect(requestBody()).not.toHaveProperty('scratch_files');
            expect(requestBody()).not.toHaveProperty('attached_images');
        } finally {
            consoleSpy.mockRestore();
        }
    });
});