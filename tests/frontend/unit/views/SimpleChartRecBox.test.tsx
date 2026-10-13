import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildThreads } from '../../../../src/app/threadGraph';
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
    // The thread chain above a node, nearest first (design-docs/58).
    const chainAbove = (store: { getState: () => any }, id: string) =>
        dfSelectors.getThreadGraph(store.getState()).ancestors(id);
    const turnWith = (store: { getState: () => any }, predicate: (turn: any) => boolean) =>
        store.getState().textTurns.find(predicate);

    it('retries an interrupted later step with the request that started its run', async () => {
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'life', displayId: 'Life', names: [],
                metadata: {}, rows: [], virtual: { tableId: 'life', rowCount: 0 } } as any));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'loaded', displayId: 'Loaded', textKind: 'explain',
                content: 'Added three datasets.', parentNodeId: 'conversation-root:test', createdAt: 1, answered: true }));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'reply', displayId: 'Reply', textKind: 'explain',
                content: '', prompt: 'Explain them together', parentNodeId: 'loaded', createdAt: 1.5 }));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'step-1', displayId: 'Step', textKind: 'explain',
                content: 'Compare the datasets', parentNodeId: 'reply', actionId: 'run', createdAt: 2,
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
        // The retry runs in place of the failed step: no second copy of the message, no new thread.
        await waitFor(() => expect(store.getState().draftNodes.some(draft => draft.id === 'next-step')).toBe(false));
        expect(store.getState().textTurns.filter(turn => turn.prompt === 'Explain them together')).toHaveLength(1);
        expect(buildThreads(dfSelectors.getThreadGraph(store.getState())).some(thread => thread.branchFromId)).toBe(false);
    });

    it.each([
        ['the message before it', 'answer'],
        ['the stopped message itself', 'stopped'],
    ])('replaces a message a stopped run left unanswered when sending from %s', async (_label, focusTextId) => {
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'answer', displayId: 'Answer', textKind: 'explain',
                content: 'Updated all five charts.', parentNodeId: 'conversation-root:test', createdAt: 1 }));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'stopped', displayId: 'Stopped', textKind: 'explain',
                content: '', prompt: 'Update the app', parentNodeId: 'answer', createdAt: 2 }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: focusTextId }));
        });
        act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Update the app', images: [], attachments: [] })));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        const prompts = store.getState().textTurns.filter(turn => turn.prompt === 'Update the app');
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toMatchObject({ parentNodeId: 'answer' });
        expect(prompts[0].id).not.toBe('stopped');
        expect(buildThreads(dfSelectors.getThreadGraph(store.getState())).some(thread => thread.branchFromId)).toBe(false);
    });

    it('starts a quick action as a visible user prompt requesting suggestions', async () => {
        const { dispatchSpy } = mountTask();
        fireEvent.click(screen.getByRole('button', { name: 'Quick actions' }));
        expect(streamRequest).not.toHaveBeenCalled();
        expect(screen.getAllByRole('menuitem')).toHaveLength(3);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Write a report' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(requestBody()).not.toHaveProperty('max_iterations');
        const prompt = requestBody().user_question;
        expect(prompt).toContain('write a report');
        expect(prompt).toContain('Suggest a few useful directions');
        // The user's message is its own node in the thread (design-docs/58).
        const promptAction = dispatchSpy.mock.calls.map(([action]) => action as any)
            .find(action => action.type === dfActions.addTextTurn.type && action.payload.prompt);
        expect(promptAction.payload).toMatchObject({ prompt, content: '' });
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/message', expect.anything());
    });

    it('continues a focused workflow report after its run\'s completed record, without branching', async () => {
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.saveGeneratedReport({ id: 'workflow-report', content: '# Findings', title: 'Findings',
                selectedChartIds: [], createdAt: 1, parentNodeId: 'conversation-root:test', status: 'completed' }));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'workflow-record', displayId: 'Run', textKind: 'explain',
                content: 'Run complete.', parentNodeId: 'workflow-report', createdAt: 2,
                workflow: { runId: 'run', status: 'completed', stepId: 'done', calls: 3, steps: [], outputVersions: {} } } as any));
            store.dispatch(dfActions.setFocused({ type: 'report', reportId: 'workflow-report' }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'Create an app', images: [], attachments: [] }));
        });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(turnWith(store, turn => turn.prompt === 'Create an app').parentNodeId).toBe('workflow-record');
        expect(turnWith(store, turn => turn.id === 'workflow-record').answered).toBeUndefined();
        expect(buildThreads(dfSelectors.getThreadGraph(store.getState())).some(thread => thread.branchFromId)).toBe(false);
    });

    it('routes the workflow shortcut to analyst chat even when a paused execution is focused', async () => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'paused-run', displayId: 'Paused run', textKind: 'explain',
            content: 'Waiting for inputs', parentNodeId: 'conversation-root:run', createdAt: 1,
            workflow: { runId: 'run', status: 'paused', stepId: 'inspect', calls: 1, steps: [], outputVersions: {} } }));
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
        // The run the user is looking at reaches the agent through the session state (design-docs/61).
        expect(requestBody().session_state.textTurns).toEqual(expect.arrayContaining([expect.objectContaining({
            workflow: expect.objectContaining({ runId: 'run' }),
        })]));
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/message', expect.anything());
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.form?.kind === 'workflow')).toBeDefined());
        const request = store.getState().textTurns.find(turn => turn.prompt === 'I want to create a workflow from this analysis.');
        expect(request).toMatchObject({ parentNodeId: 'paused-run', content: '' });
        expect(store.getState().textTurns.find(turn => turn.form?.kind === 'workflow')).toMatchObject({
            parentNodeId: request!.id, form,
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
        // The run the user is looking at reaches the agent through the session state (design-docs/61).
        expect(requestBody().session_state.textTurns).toEqual(expect.arrayContaining([expect.objectContaining({
            workflow: expect.objectContaining({ runId: 'run' }),
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
        expect(requestBody(1).session_state.textTurns).toEqual(expect.arrayContaining([expect.objectContaining({
            content: 'Review the proposed workflow.', form: expect.objectContaining({ workflow: expect.objectContaining({ content: proposal.content }) }),
        })]));
        await waitFor(() => expect(store.getState().textTurns.filter(workflowOf)).toHaveLength(2));
        const revisionTurn = store.getState().textTurns.find(item => workflowOf(item)?.content === revised.content)!;
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: revisionTurn.id });
        expect(workflowOf(store.getState().textTurns.find(item => item.id === turn.id))).toEqual(proposal);
        act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Now add explicit source loading', images: [], attachments: [] })));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(3));
        expect(requestBody(2).session_state.textTurns.filter((item: any) => item.form?.kind === 'workflow')
            .map((item: any) => item.form.workflow.content)).toEqual([proposal.content, revised.content]);
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
            yield { type: 'tool_start', tool: 'load_data', args: { tables: ['Recent orders'] } };
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
            await waitFor(() => expect(store.getState().pendingTableLoads[0]?.names).toEqual(['Recent orders']));
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

    it('groups one load into a set of its tables, leaving the sources they were queried from on the shelf', async () => {
        const reference = (tableKey: string) => ({ kind: 'external-table-reference', id: `external:kusto:${tableKey}`,
            connectorId: 'kusto', tableKey, sourceTable: { id: tableKey, name: tableKey }, displayName: tableKey,
            capturedAt: '2026-10-11T00:00:00Z', summary: { columns: [], rowCount: 100 } });
        vi.mocked(apiRequest).mockImplementation(async url => String(url).includes('list-tables')
            ? { data: { tables: ['Beats', 'Titan'].map(key => ({ name: `${key.toLowerCase()}_alerts`, columns: [], row_count: 5,
                sample_rows: [], imported_from: { source_id: 'kusto', table_key: key } })) } }
            : { data: { result: [], statistics: {} } } as any);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'data_operation_result', operation: {
                schema_version: 1, id: 'operation', status: 'loaded', reason: 'Load alerts',
                plans: [{ id: 'plan', hash: 'a'.repeat(64), label: 'Alerts', summary: '',
                    steps: [{ kind: 'connector_query', display_name: 'Alerts' }] }],
                result_table_ids: ['beats_alerts', 'titan_alerts'],
                // Two sources the tables were queried from, and one connected as a reference only.
                result_references: [reference('Beats'), reference('Titan'), reference('Walker')],
            } };
            yield { type: 'completion', content: { summary: 'Loaded.' } };
        });
        const { store } = mountTask({ text: 'Load the alerts', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns.at(-1)?.content).toBe('Loaded.'));
        const state = store.getState();
        expect(state.externalTableReferences.map(item => item.tableKey)).toEqual(['Beats', 'Titan', 'Walker']);
        expect(state.artifactSets).toHaveLength(1);
        const members = state.artifactSets[0].memberIds.map(id => state.loadedTableNodes.find(node => node.id === id));
        expect(members.map(node => [node?.tableId, !!node?.external])).toEqual([
            ['external:kusto:Walker', true], ['beats_alerts', false], ['titan_alerts', false],
        ]);
        expect(state.loadedTableNodes).toHaveLength(3);
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
        await waitFor(() => expect(turnWith(store, turn => turn.dataOperation)).toBeDefined());
        const proposalId = turnWith(store, turn => turn.dataOperation).id;
        try {
            fireEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
            await waitFor(() => expect(store.getState().loadedTableNodes).toHaveLength(1));
            expect(requestBody(1).interaction_response).toEqual({ operation_id: 'operation', plan_id: 'plan' });
            expect(requestBody(1).trajectory).toEqual(trajectory);
            expect(turnWith(store, turn => turn.id === proposalId)).toMatchObject({ answered: true, dataOperation: { status: 'loaded' } });
            // The loaded table follows the user's choice in the chain, and the live draft follows the table.
            const loaded = store.getState().loadedTableNodes[0];
            expect(loaded).toMatchObject({ tableId: 'orders' });
            expect(chainAbove(store, loaded.id)).toContain(proposalId);
            expect(store.getState().draftNodes).toEqual([expect.objectContaining({ parentNodeId: loaded.id })]);
            expect(store.getState().pendingTableLoads).toHaveLength(0);
        } finally {
            await act(async () => { finishAnalysis(); });
        }
        await waitFor(() => expect(turnWith(store, turn => turn.content === 'Revenue was 30 in 2025.')).toBeDefined());
        expect(streamRequest).toHaveBeenCalledTimes(2);
        expect(store.getState().derivedTables[0]).toMatchObject({ id: 'yearly_orders' });
        expect(chainAbove(store, 'yearly_orders')).toContain(store.getState().loadedTableNodes[0].id);
        // Agent annotations are normalized: 'year' becomes Year, the encoding word is dropped, currency becomes the unit.
        expect(store.getState().tableSemantics.find(info => info.tableId === 'yearly_orders')?.fields).toMatchObject({
            year: { semanticType: 'Year' },
            revenue: { unit: 'USD', displayName: 'Revenue' },
        });
        expect(turnWith(store, turn => turn.content === 'Revenue was 30 in 2025.')).toMatchObject({ parentNodeId: 'yearly_orders' });
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
        await waitFor(() => expect(turnWith(store, turn => turn.content === 'Added orders as a workspace reference.')).toBeDefined());
        // prompt → virtual reference → closing answer
        const prompt = turnWith(store, turn => turn.prompt === 'Add orders');
        expect(store.getState().loadedTableNodes).toEqual([expect.objectContaining({ tableId: reference.id, external: true,
            parentNodeId: prompt.id })]);
        expect(turnWith(store, turn => turn.content === 'Added orders as a workspace reference.').parentNodeId)
            .toBe(store.getState().loadedTableNodes[0].id);
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

    it.each([['button', true], ['enter', false]])(
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
        expect(requestBody().session_state.focusedId).toEqual({ type: 'external-table', referenceId: reference.id });
        expect(requestBody().input_tables).toHaveLength(hasLoadedTables ? 1 : 0);
        expect(requestBody().input_tables.some((table: { id: string }) => table.id === reference.id)).toBe(false);
        expect(requestBody()).not.toHaveProperty('focused_file');
        expect(store.getState().fileNodes).toEqual([]);
        const closingReplies = () => store.getState().textTurns.filter(turn => turn.content === 'Review the event sources.');
        await waitFor(() => expect(closingReplies()).toHaveLength(1));
        const reply = closingReplies()[0];
        expect(reply.externalReferenceId).toBe(reference.id);
        const derived = store.getState().derivedTables[0];
        expect(derived.derive?.trigger.externalReferenceId).toBe(reference.id);
        act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: reply.id })));
        fireEvent.change(input, { target: { value: 'Show the ten most recent events' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(2));
        expect(requestBody(1).session_state.focusedId).toEqual({ type: 'text', textId: reply.id });
        await waitFor(() => expect(closingReplies()).toHaveLength(2));
        act(() => store.dispatch(dfActions.setFocused({ type: 'table', tableId: derived.id })));
        fireEvent.change(input, { target: { value: 'Show the source events for this result' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(3));
        expect(requestBody(2).session_state.focusedId).toEqual({ type: 'table', tableId: derived.id });
        await waitFor(() => expect(closingReplies()).toHaveLength(3));
        act(() => {
            store.dispatch(dfActions.removeExternalTableReference(reference.id));
            store.dispatch(dfActions.setFocused({ type: 'table', tableId: derived.id }));
        });
        fireEvent.change(input, { target: { value: 'Describe the existing result' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(4));
        expect(requestBody(3).session_state.externalTableReferences).toEqual([]);
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
        expect(requestBody().session_state.externalTableReferences).toEqual([refreshed]);
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
            // A refresh keeps the item where it is: one reference, right after the request.
            expect(store.getState().loadedTableNodes).toHaveLength(1);
            expect(store.getState().loadedTableNodes[0].parentNodeId).toBe(turnWith(store, turn => turn.prompt === 'Create and revise measurements').id);
            expect(store.getState().inputTables[0].dataProvenance?.editPolicy).toBe('agent_editable');
            await waitFor(() => expect(store.getState().derivedTables).toHaveLength(1));
            expect(dispatchSpy.mock.calls.map(([action]) => action)
                .filter(dfActions.updateDraftSources.match).at(-1)?.payload.source).toEqual(['measurements']);
            const derived = dfSelectors.getAllTables(store.getState()).find(table => table.id === 'doubled');
            expect(derived?.displayId).toBe('Doubled Measurements');
            expect(derived?.derive?.source).toEqual(['measurements']);
            expect(derived?.derive?.trigger.tableId).toBe('measurements');
            // The step that made the table is the agent message right before it. The agent gave no
            // instruction, so none is stored (the thread reads it from the table's chart), and the
            // table keeps its own code rather than listing it as a call.
            const step = turnWith(store, turn => turn.id === derived?.parentNodeId);
            expect(step.content).toBe('');
            expect(step.codeExecutions ?? []).toEqual([]);
            expect(derived?.derive?.code).toBeTruthy();
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
        const request = () => turnWith(store, turn => turn.prompt === 'Create a demo dataset');
        try {
            await waitFor(() => expect(store.getState().loadedTableNodes).toHaveLength(1));
            // request → new data, and the run's live draft follows the data.
            expect(request().parentNodeId).toMatch(/^conversation-root:/);
            expect(store.getState().loadedTableNodes[0].parentNodeId).toBe(request().id);
            expect(store.getState().draftNodes[0].parentNodeId).toBe(store.getState().loadedTableNodes[0].id);
        } finally {
            await act(async () => { finishRun(); });
        }
        await waitFor(() => expect(turnWith(store, turn => turn.content === 'Created Retail Sales.')).toBeDefined());
        const response = turnWith(store, turn => turn.content === 'Created Retail Sales.');
        expect(response.parentNodeId).toBe(store.getState().loadedTableNodes[0].id);
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
            expect(store.getState().loadedTableNodes[0].parentNodeId).toBe(turnWith(store, turn => turn.prompt === 'Load consumer price data').id);
        } finally {
            await act(async () => { finishRun(); });
        }
        await waitFor(() => expect(turnWith(store, turn => turn.content === 'Loaded consumer prices.')).toBeDefined());
        const response = turnWith(store, turn => turn.content === 'Loaded consumer prices.');
        expect(response.parentNodeId).toBe(store.getState().loadedTableNodes[0].id);
        expect(store.getState().loadedTableNodes[0]).toMatchObject({ tableId: 'consumer_prices' });
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
        await waitFor(() => expect(turnWith(store, turn => turn.content === 'Created both charts.')).toBeDefined());
        const state = store.getState();
        const request = turnWith(store, turn => turn.prompt === 'Explore daily and regional sales');
        expect(request.parentNodeId).toBe('textTurn-opening');
        expect(state.derivedTables).toHaveLength(2);
        // request → daily → step → daily_chart → regional → step → regional_chart → closing answer
        expect(state.loadedTableNodes.map(node => [node.tableId, node.parentNodeId])).toEqual([
            ['daily', request.id], ['regional', 'daily_chart'],
        ]);
        state.derivedTables.forEach((table, index) => {
            const name = ['daily', 'regional'][index];
            const step = turnWith(store, turn => turn.id === table.parentNodeId);
            expect(step.parentNodeId).toBe(state.loadedTableNodes[index].id);
            expect(step.progressSteps).toMatchObject([
                { kind: 'tool', toolCallId: `inspect-${name}`, status: 'completed' },
                { kind: 'chart', status: 'completed' },
            ]);
            expect(step.progressSteps).toHaveLength(2);
        });
        expect(turnWith(store, turn => turn.id === 'textTurn-opening')).toMatchObject({ content: 'Previous analysis.' });
        expect(turnWith(store, turn => turn.content === 'Created both charts.').parentNodeId).toBe('regional_chart');
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
            // A follow-up on an item continues from that item (design-docs/58, rule 3).
            const request = turnWith(store, turn => turn.prompt === 'Which majors pay most?');
            expect(request.parentNodeId).toBe('college-reference');
            expect(store.getState().draftNodes[0].parentNodeId).toBe(request.id);
            expect(turnWith(store, turn => turn.id === 'loaded-reply').answered).not.toBe(true);
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
            await waitFor(() => expect(turnWith(store, turn => turn.content === 'The app compares revenue by region.')).toBeDefined());
            const explanation = turnWith(store, turn => turn.content === 'The app compares revenue by region.');
            act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: explanation.id })));
            expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: 'sales_app.html' });
            fireEvent.click(await screen.findByRole('button', { name: /^Close/ }));
            expect(store.getState().focusedId).toEqual({ type: 'file', fileName: 'sales_app.html' });
        } finally {
            window.removeEventListener('df:workspace-files-changed', refreshed);
        }
    });

    it('updates an edited app in place, where it is in the thread (design-docs/58, rule 8)', async () => {
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
            store.dispatch(dfActions.setFocused({ type: 'file', fileName: 'sales.app.jsx' }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'Add a units chart to the dashboard', images: [], attachments: [] }));
        });
        await waitFor(() => expect(turnWith(store, turn => turn.content === 'Added a units chart.')).toBeDefined());
        // app → request → closing answer; the app keeps its place and shows the revision.
        const request = turnWith(store, turn => turn.prompt === 'Add a units chart to the dashboard');
        expect(request.parentNodeId).toBe('file-sales.app.jsx');
        expect(store.getState().fileNodes).toEqual([
            expect.objectContaining({ id: 'file-sales.app.jsx', contentHash: 'revised-hash', parentNodeId: 'built' }),
        ]);
        const explanation = turnWith(store, turn => turn.content === 'Added a units chart.');
        expect(explanation.parentNodeId).toBe(request.id);
        act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: explanation.id })));
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: 'sales.app.jsx' });
    });

    describe('replacing an artifact the user wants fixed', () => {
        const seedTable = (store: any) => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'Ask', textKind: 'explain',
                content: '', prompt: 'Chart the trend', parentNodeId: 'conversation-root:test', createdAt: 1 }));
            store.dispatch(dfActions.insertDerivedTables({ kind: 'table', id: 'd_old', displayId: 'Old trend', names: ['a'], metadata: {},
                rows: [{ a: 1 }], parentNodeId: 'ask', createdAt: 2, virtual: { tableId: 'd_old', rowCount: 1 },
                derive: { source: [], code: '', dialog: [], trigger: { tableId: 'conversation-root:test', resultTableId: 'd_old' } } } as any));
            store.dispatch(dfActions.addChart({ id: 'chart-old', chartType: 'Bar Chart', encodingMap: {}, tableRef: 'd_old', source: 'user' } as any));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'old-closing', displayId: 'Closing', textKind: 'explain',
                content: 'Here is the trend.', parentNodeId: 'd_old', createdAt: 3, answered: true }));
        };

        it('deletes the old table and chart and puts the fix after the request', async () => {
            vi.mocked(streamRequest).mockImplementationOnce(async function* () {
                yield { type: 'action', action: 'visualize', input_tables: [] };
                yield { type: 'result', status: 'success', content: {
                    replaces: { id: 'd_old', node_id: 'd_old', kind: 'table', name: 'Old trend' },
                    result: { status: 'ok', chart_id: 'chart-fixed', content: { rows: [{ a: 2 }], virtual: { table_name: 'd_fixed', row_count: 1 } },
                        refined_goal: { output_variable: 'df', display_name: 'Fixed trend' } } } };
                yield { type: 'completion', status: 'success', content: { summary: 'Fixed the trend.' } };
            });
            const { store } = mountTask();
            act(() => {
                seedTable(store);
                store.dispatch(dfActions.setFocused({ type: 'chart', chartId: 'chart-old' }));
                store.dispatch(dfActions.queueAnalystTask({ text: 'The trend is wrong, fix it', images: [], attachments: [] }));
            });
            await waitFor(() => expect(turnWith(store, turn => turn.content === 'Fixed the trend.')).toBeDefined());
            const state = store.getState();
            expect(state.derivedTables.map((table: any) => table.id)).toEqual(['d_fixed']);
            expect(state.derivedTables[0].replaced).toEqual({ id: 'd_old', name: 'Old trend' });
            expect(dfSelectors.getAllCharts(state).some((chart: any) => chart.tableRef === 'd_old')).toBe(false);
            // The fix follows the request; what followed the old table continues from where it came from.
            const request = turnWith(store, turn => turn.prompt === 'The trend is wrong, fix it');
            expect(chainAbove(store, 'd_fixed')).toContain(request.id);
            expect(turnWith(store, turn => turn.id === 'old-closing').parentNodeId).toBe('ask');
            // The closing message takes focus; the canvas shows the fix above it.
            expect(dfSelectors.selectCanvasTarget(state)).toEqual({ type: 'chart', chartId: 'chart-fixed' });
        });

        it('moves an app fixed in place to after the request that fixed it', async () => {
            vi.mocked(streamRequest).mockImplementationOnce(async function* () {
                yield { type: 'tool_result', tool: 'edit_file', status: 'ok', stdout: JSON.stringify({
                    path: 'files/quakes.app.jsx', name: 'quakes.app.jsx', display_name: 'Quake explorer', content_hash: 'fixed-hash',
                    available_in_workspace: true, app: true, tables: [], warnings: [],
                    replaces: { id: 'files/quakes.app.jsx', node_id: 'file-quakes.app.jsx', kind: 'file', name: 'Quake explorer' } }) };
                yield { type: 'completion', status: 'success', content: { summary: 'Fixed the app.' } };
            });
            const { store } = mountTask();
            act(() => {
                store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'Ask', textKind: 'explain',
                    content: '', prompt: 'Build an explorer', parentNodeId: 'conversation-root:test', createdAt: 1 }));
                store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'file-quakes.app.jsx', path: 'quakes.app.jsx',
                    displayName: 'Quake explorer', contentHash: 'broken-hash', parentNodeId: 'ask', createdAt: 2 }));
                store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'built', displayId: 'Built', textKind: 'explain',
                    content: 'Built the explorer.', parentNodeId: 'file-quakes.app.jsx', createdAt: 3, answered: true }));
                store.dispatch(dfActions.setFocused({ type: 'file', fileName: 'quakes.app.jsx' }));
                store.dispatch(dfActions.queueAnalystTask({ text: 'The map crashes, fix it', images: [], attachments: [] }));
            });
            await waitFor(() => expect(turnWith(store, turn => turn.content === 'Fixed the app.')).toBeDefined());
            const [app] = store.getState().fileNodes;
            expect(store.getState().fileNodes).toHaveLength(1);
            expect(app).toMatchObject({ contentHash: 'fixed-hash', replaced: { id: 'file-quakes.app.jsx', name: 'Quake explorer' } });
            const request = turnWith(store, turn => turn.prompt === 'The map crashes, fix it');
            expect(request.parentNodeId).toBe('built');
            expect(chainAbove(store, app.id)).toContain(request.id);
            // ask → built → request → … → app: one thread, the broken version gone.
            expect(turnWith(store, turn => turn.id === 'built').parentNodeId).toBe('ask');
            expect(turnWith(store, turn => turn.content === 'Fixed the app.').parentNodeId).toBe(app.id);
        });

        it('deletes a report the agent rewrote', async () => {
            vi.mocked(streamRequest).mockImplementationOnce(async function* () {
                yield { type: 'action', action: 'write_report', replaces: { id: 'report-old', node_id: 'report-old', kind: 'report', name: 'Draft findings' } };
                yield { type: 'text_delta', channel: 'report', content: '# Corrected findings' };
                yield { type: 'completion', status: 'success', content: { summary: 'Rewrote the report.' } };
            });
            const { store } = mountTask();
            act(() => {
                store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'Ask', textKind: 'explain',
                    content: '', prompt: 'Write it up', parentNodeId: 'conversation-root:test', createdAt: 1 }));
                store.dispatch(dfActions.saveGeneratedReport({ id: 'report-old', content: '# Draft findings', title: 'Draft findings',
                    selectedChartIds: [], createdAt: 2, parentNodeId: 'ask', status: 'completed' }));
                store.dispatch(dfActions.setFocused({ type: 'report', reportId: 'report-old' }));
                store.dispatch(dfActions.queueAnalystTask({ text: 'The numbers are wrong, redo it', images: [], attachments: [] }));
            });
            await waitFor(() => expect(turnWith(store, turn => turn.content === 'Rewrote the report.')).toBeDefined());
            const reports = store.getState().generatedReports;
            expect(reports).toHaveLength(1);
            expect(reports[0]).toMatchObject({ title: 'Corrected findings', replaced: { id: 'report-old', name: 'Draft findings' } });
            expect(store.getState().focusedId).toEqual({ type: 'report', reportId: reports[0].id });
        });

        it('deletes items the agent removed and notes it on its message', async () => {
            vi.mocked(streamRequest).mockImplementationOnce(async function* () {
                yield { type: 'tool_start', tool: 'delete_items', tool_call_id: 'delete-1', args: { items: ['d_old'] } } as any;
                yield { type: 'tool_result', tool: 'delete_items', tool_call_id: 'delete-1', status: 'ok', stdout: JSON.stringify({ deleted: {
                    tables: [{ id: 'd_old', node_id: 'd_old', name: 'Old trend', origin: 'derived' }],
                    charts: [{ id: 'chart-old', name: 'Bar Chart of Old trend', table: 'd_old', because: 'chart of Old trend' }],
                    references: [] } }) } as any;
                yield { type: 'completion', status: 'success', content: { summary: 'Removed the old trend.' } };
            });
            const { store } = mountTask();
            act(() => {
                seedTable(store);
                store.dispatch(dfActions.setFocused({ type: 'chart', chartId: 'chart-old' }));
                store.dispatch(dfActions.queueAnalystTask({ text: 'Delete this chart and its table', images: [], attachments: [] }));
            });
            await waitFor(() => expect(turnWith(store, turn => turn.content === 'Removed the old trend.')).toBeDefined());
            // The agent's session layer is built from the state sent with the request, without preview rows.
            const sent = requestBody().session_state;
            expect(sent.derivedTables).toEqual([expect.objectContaining({ id: 'd_old', displayId: 'Old trend' })]);
            expect(sent.derivedTables[0]).not.toHaveProperty('rows');
            expect(sent.charts).toEqual([expect.objectContaining({ id: 'chart-old', tableRef: 'd_old' })]);
            expect(sent.focusedId).toEqual({ type: 'chart', chartId: 'chart-old' });
            expect(requestBody()).not.toHaveProperty('session_items');
            const state = store.getState();
            expect(state.derivedTables).toEqual([]);
            expect(dfSelectors.getAllCharts(state)).toEqual([]);
            // What followed the table continues from where it came from, and the note stays in the thread.
            expect(turnWith(store, turn => turn.id === 'old-closing').parentNodeId).toBe('ask');
            const noted = turnWith(store, turn => !!turn.progressSteps?.some((step: any) => step.label === 'Deleted Old trend'));
            expect(noted).toBeDefined();
            const request = turnWith(store, turn => turn.prompt === 'Delete this chart and its table');
            expect(chainAbove(store, turnWith(store, turn => turn.content === 'Removed the old trend.').id)).toContain(request.id);
        });

        it('applies a chart the agent edited as a file and a file it moved', async () => {
            vi.mocked(streamRequest).mockImplementationOnce(async function* () {
                yield { type: 'tool_result', tool: 'edit_file', status: 'ok', stdout: JSON.stringify({
                    path: 'session/charts/chart-old.json', content_hash: 'h',
                    session_update: { kind: 'chart', id: 'chart-old', spec: { chart_type: 'Line Chart', table: 'd_old',
                        title: 'Trend over time', encodings: { x: { field: 'a' } } } } }) } as any;
                yield { type: 'tool_result', tool: 'move_file', status: 'ok', stdout: JSON.stringify({
                    moved: { from: 'files/draft.md', to: 'files/notes/draft.md' }, content_hash: 'h2' }) } as any;
                yield { type: 'completion', status: 'success', content: { summary: 'Restyled and tidied.' } };
            });
            const { store } = mountTask();
            act(() => {
                seedTable(store);
                store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'file-draft.md', path: 'draft.md', displayName: 'Draft',
                    contentHash: 'h0', parentNodeId: 'ask', createdAt: 4 }));
                store.dispatch(dfActions.setFocused({ type: 'chart', chartId: 'chart-old' }));
                store.dispatch(dfActions.queueAnalystTask({ text: 'Make it a line chart and file the draft under notes', images: [], attachments: [] }));
            });
            await waitFor(() => expect(turnWith(store, turn => turn.content === 'Restyled and tidied.')).toBeDefined());
            expect(requestBody().session_state.charts).toEqual([expect.objectContaining({ id: 'chart-old', chartType: 'Bar Chart' })]);
            const chart = dfSelectors.getAllCharts(store.getState()).find((item: any) => item.id === 'chart-old');
            expect(chart).toMatchObject({ chartType: 'Line Chart', title: 'Trend over time' });
            expect(store.getState().fileNodes).toEqual([expect.objectContaining({ id: 'file-draft.md', path: 'notes/draft.md' })]);
            const steps = store.getState().textTurns.flatMap((turn: any) => turn.progressSteps || []).map((step: any) => step.label);
            expect(steps).toEqual(expect.arrayContaining(['Edited chart Trend over time', 'Moved files/draft.md to files/notes/draft.md']));
        });
    });

    it('continues the conversation after an app, like after a derived table (design-docs/58, rule 3)', async () => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'completion', status: 'success', content: { summary: 'Fixed the map.' } };
        });
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'Ask', textKind: 'explain',
                content: '', prompt: 'Build an explorer', parentNodeId: 'conversation-root:test', createdAt: 1 }));
            store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'file-quakes.app.jsx', path: 'quakes.app.jsx',
                displayName: 'Quake explorer', contentHash: 'hash', parentNodeId: 'ask', createdAt: 2 }));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'built', displayId: 'Built', textKind: 'explain',
                content: 'Built the explorer.', parentNodeId: 'file-quakes.app.jsx', createdAt: 3, answered: true }));
            store.dispatch(dfActions.setFocused({ type: 'file', fileName: 'quakes.app.jsx' }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'The map is not showing', images: [], attachments: [] }));
        });
        await waitFor(() => expect(turnWith(store, turn => turn.content === 'Fixed the map.')).toBeDefined());
        // ask → app → built → request: one thread, not a branch from the app.
        expect(turnWith(store, turn => turn.prompt === 'The map is not showing').parentNodeId).toBe('built');
    });

    it.each(['report', 'connected source'])('continues the conversation after a %s in the thread', async kind => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'completion', status: 'success', content: { summary: 'Answered.' } };
        });
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'Ask', textKind: 'explain',
                content: '', prompt: 'Start', parentNodeId: 'conversation-root:test', createdAt: 1 }));
            if (kind === 'report') {
                store.dispatch(dfActions.saveGeneratedReport({ id: 'report-1', content: '# Findings', selectedChartIds: [],
                    createdAt: 2, parentNodeId: 'ask', status: 'completed' }));
            } else {
                store.dispatch(dfActions.upsertExternalTableReference({ kind: 'external-table-reference', id: 'external:kusto:Beats',
                    connectorId: 'kusto', tableKey: 'Beats', sourceTable: { id: 'Beats', name: 'Beats' }, displayName: 'Beats',
                    capturedAt: '', summary: { columns: [] } } as any));
                store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-beats', tableId: 'external:kusto:Beats',
                    external: true, parentNodeId: 'ask', createdAt: 2 }));
            }
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'closing', displayId: 'Closing', textKind: 'explain',
                content: 'Done.', parentNodeId: kind === 'report' ? 'report-1' : 'loaded-beats', createdAt: 3, answered: true }));
            store.dispatch(dfActions.setFocused(kind === 'report' ? { type: 'report', reportId: 'report-1' } : { type: 'reference', referenceId: 'loaded-beats' }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'Tell me more', images: [], attachments: [] }));
        });
        await waitFor(() => expect(turnWith(store, turn => turn.content === 'Answered.')).toBeDefined());
        expect(turnWith(store, turn => turn.prompt === 'Tell me more').parentNodeId).toBe('closing');
        expect(requestBody().session_state.focusedId).toEqual(kind === 'report' ? { type: 'report', reportId: 'report-1' }
            : { type: 'reference', referenceId: 'loaded-beats' });
    });

    it('shows the running plan while the agent works on the focused app', async () => {
        let continueStream!: () => void;
        const continuation = new Promise<void>(resolve => { continueStream = resolve; });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'execute_python_script', code: 'print(1)', purpose: 'Inspect the explorer map' } as any;
            await continuation;
            yield { type: 'completion', status: 'success', content: { summary: 'Done.' } };
        });
        const { store, container } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'quakes', displayId: 'Quakes', names: [], metadata: {}, rows: [],
                parentNodeId: 'conversation-root:test', derive: { source: [], code: '', dialog: [], trigger: { tableId: 'conversation-root:test', resultTableId: 'quakes' } } } as any));
            store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'file-quakes.app.jsx', path: 'quakes.app.jsx',
                displayName: 'Quake explorer', contentHash: 'hash', parentNodeId: 'quakes', createdAt: 2 }));
            store.dispatch(dfActions.setFocused({ type: 'file', fileName: 'quakes.app.jsx' }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'The map is not showing', images: [], attachments: [] }));
        });
        try {
            await waitFor(() => expect(container.textContent).toContain('Inspect the explorer map'));
        } finally {
            await act(async () => { continueStream(); });
        }
        await waitFor(() => expect(store.getState().draftNodes).toHaveLength(0));
    });

    it.each(['completion', 'clarify'])('places a new app between the request and the message that ends the run (%s)', async ending => {
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'action', action: 'write_html_app', file: {
                name: 'sales_app.html', path: 'files/sales_app.html', display_name: 'Sales explorer',
                content_hash: 'app-hash', url: '/api/workspace/files/sales_app.html',
            } };
            if (ending === 'completion') yield { type: 'completion', status: 'success', content: { summary: 'Built the app.' } };
            else yield { type: 'clarify', questions: [{ text: 'Add a forecast?', options: ['Yes', 'No'] }] } as any;
        });
        const { store } = mountTask({ text: 'Build an interactive sales dashboard', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().draftNodes).toHaveLength(0));
        const state = store.getState();
        const request = turnWith(store, turn => turn.prompt === 'Build an interactive sales dashboard');
        const endingTurn = state.textTurns.at(-1)!;
        expect(request.parentNodeId).toMatch(/^conversation-root:/);
        expect(state.fileNodes).toEqual([expect.objectContaining({ parentNodeId: request.id })]);
        expect(endingTurn.parentNodeId).toBe(state.fileNodes[0].id);
    });

    it.each([
        ['an app open on the canvas', 'sales.app.jsx', 'file-sales.app.jsx'],
        ['a workspace file outside any thread', 'uploaded.md', /^conversation-root:/],
    ])('continues the right thread when asking about %s', async (_label, fileName, expectedParent) => {
        let finishRun!: () => void;
        const running = new Promise<void>(resolve => { finishRun = resolve; });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () { await running; });
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'built', displayId: 'Built', textKind: 'explain',
                content: 'Built the dashboard.', parentNodeId: 'conversation-root:test', createdAt: 1 }));
            store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'file-sales.app.jsx', path: 'sales.app.jsx',
                displayName: 'Sales explorer', contentHash: 'app-hash', parentNodeId: 'built', createdAt: 2 }));
            store.dispatch(dfActions.setFocused({ type: 'file', fileName }));
        });
        try {
            act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Add a units chart', images: [], attachments: [] })));
            await waitFor(() => expect(store.getState().draftNodes).toHaveLength(1));
            // The request continues from the app item itself (rule 3).
            const request = turnWith(store, turn => turn.prompt === 'Add a units chart');
            if (typeof expectedParent === 'string') {
                expect(request.parentNodeId).toBe(expectedParent);
            } else {
                expect(request.parentNodeId).toMatch(expectedParent);
            }
            expect(store.getState().draftNodes[0].parentNodeId).toBe(request.id);
            // What is on the canvas reaches the agent through the session state (design-docs/61).
            expect(requestBody().session_state.focusedId).toEqual({ type: 'file', fileName });
        } finally {
            await act(async () => { finishRun(); });
        }
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
            expect(store.getState().textTurns.find(turn => turn.id === 'question')).toMatchObject({ answered: true });
            // The reply is a user message following the question; the run's draft follows the reply.
            const reply = turnWith(store, turn => turn.prompt === 'Revenue');
            expect(reply.parentNodeId).toBe('question');
            const draft = dispatchSpy.mock.calls.map(([action]) => action).find(dfActions.createDraftNode.match);
            expect(draft?.payload.parentNodeId).toBe(reply.id);
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
        await waitFor(() => expect(store.getState().textTurns).toHaveLength(2));
        const turn = turnWith(store, item => item.content === content);
        expect(turn.parentNodeId).toBe(turnWith(store, item => item.prompt === 'Answer my question').id);
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
        // The pause message follows the report; no empty closing message is added for it.
        expect(store.getState().textTurns.filter(turn => turn.textKind === 'explain' && !turn.content && !turn.prompt
            && !turn.executions?.length)).toHaveLength(0);
        expect(store.getState().textTurns.find(turn => turn.parentNodeId === report.id)).toBeDefined();
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
        // request → report → closing answer
        const request = store.getState().textTurns.find(turn => turn.id === report.parentNodeId);
        expect(request).toMatchObject({ prompt: 'Write a report for this analysis', content: '' });
        if (outcome === 'success') {
            expect(store.getState().textTurns.find(turn => turn.parentNodeId === report.id)).toMatchObject({ content: 'Report ready.' });
        }
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
                createdAt: 1, answered }));
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-newer', displayId: 'Later',
                textKind: 'explain', content: 'Later analysis', parentNodeId: 'textTurn-origin', createdAt: 2 }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: 'textTurn-origin' }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'Report on the earlier analysis', images: [], attachments: [] }));
        });
        await waitFor(() => expect(store.getState().generatedReports[0]?.status).toBe('error'));
        const report = store.getState().generatedReports[0];
        // The request follows the focused message even though it already has a follower: a new branch.
        const request = store.getState().textTurns.find(turn => turn.id === report.parentNodeId)!;
        expect(request.parentNodeId).toBe('textTurn-origin');
        expect(request.prompt).toBe('Report on the earlier analysis');
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-origin')?.answered).toBe(true);
        expect(store.getState().draftNodes).toHaveLength(0);
    });

    it('keeps a form message focused when clicking outside the composer', async () => {
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({
                kind: 'text', id: 'form-owner', displayId: 'form-owner', textKind: 'explain',
                content: 'Connect MySQL', createdAt: 1, parentNodeId: 'conversation-root:test',
                form: { kind: 'connector', title: 'MySQL', connector: { sourceType: 'mysql' } },
            }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: 'form-owner' }));
        });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
        fireEvent.mouseDown(document.body);
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'form-owner' });
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
        await waitFor(() => expect(store.getState().textTurns.some(turn => turn.content === 'Review the suggested host.')).toBe(true));
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
        // request → the step message carrying the proposed command
        expect(store.getState().textTurns).toHaveLength(2);
        const intent = turnWith(store, turn => !!turn.executions?.length);
        const intentId = intent.id;
        expect(intent.parentNodeId).toBe(turnWith(store, turn => turn.prompt === 'Find local data').id);
        expect(intent).toMatchObject({
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
        expect(store.getState().textTurns).toHaveLength(3);
        expect(turnWith(store, turn => turn.id === intentId)).toMatchObject({
            content: proposal.purpose,
            executions: [{ id: proposal.id, status: decision === 'approve' ? 'completed' : 'rejected',
                dangerouslyDisableSandbox: unsandboxed, sandboxDisablingReason: proposal.sandboxDisablingReason,
                result: decision === 'approve' ? { exit_code: 0, output: '/data/sales.csv' } : { rejected: true } }],
        });
        expect(turnWith(store, turn => !!turn.form).parentNodeId).toBe(intentId);
        if (decision === 'approve') expect(turnWith(store, turn => turn.id === intentId).progressSteps).toMatchObject([
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
        const step = () => store.getState().textTurns.find(turn => turn.executions?.length);
        await waitFor(() => expect(step()?.executions?.[0].status).toBe(outcome));
        expect(step()).toMatchObject({ content: proposal.purpose,
            executions: [{ id: proposal.id, argv: proposal.argv, cwd: proposal.cwd }] });
        expect(streamRequest).toHaveBeenCalledTimes(1);
        expect(requestBody().terminal_response).toBeUndefined();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('records an Auto command on its own step when the run continues from a question', async () => {
        const proposal = { id: 'auto-after-reply', argv: ['az', 'account', 'show'], cwd: '/data', purpose: 'Check Azure access', timeout_seconds: 60 };
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'terminal_started', request: proposal } as any;
            yield { type: 'terminal_result', request: proposal, result: { exit_code: 0, output: 'ok' } } as any;
            yield { type: 'completion', content: { summary: 'Access confirmed.' } } as any;
        });
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'question', displayId: 'Question', textKind: 'clarify',
                content: 'Where should the data come from?', parentNodeId: 'conversation-root:test', createdAt: 1 }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: 'question' }));
            store.dispatch(dfActions.queueAnalystTask({ text: 'Test it with my credentials', images: [], attachments: [] }));
        });
        await waitFor(() => expect(store.getState().textTurns.at(-1)?.content).toBe('Access confirmed.'));
        // The command finishes on the step that ran it; the question it continued from is untouched.
        const step = turnWith(store, turn => !!turn.executions?.length);
        expect(step.id).not.toBe('question');
        expect(step.executions).toMatchObject([{ id: proposal.id, status: 'completed' }]);
        expect(turnWith(store, turn => turn.id === 'question').executions).toBeUndefined();
        expect(turnWith(store, turn => turn.id === 'question').progressSteps).toBeUndefined();
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
            await waitFor(() => expect(store.getState().textTurns.find(turn => turn.executions?.length)?.executions?.[0].status).toBe('running'));
            const state = store.getState();
            // request → step message with the running command → live draft
            const request = turnWith(store, turn => turn.prompt === 'Analyze Azure usage');
            const terminalTurn = turnWith(store, turn => !!turn.executions?.length);
            expect(terminalTurn.parentNodeId).toBe(request.id);
            expect(state.draftNodes).toHaveLength(1);
            expect(state.draftNodes[0].derive.trigger.interaction ?? []).toHaveLength(0);
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
        const codeStep = () => store.getState().textTurns.find(turn => turn.codeExecutions?.length);
        try {
            await waitFor(() => expect(codeStep()?.codeExecutions?.[0].status).toBe('running'));
            expect(store.getState().draftNodes[0].derive.runningPlan).toContain('Calculate total');
            expect(store.getState().textTurns.filter(turn => turn.prompt)).toHaveLength(1);
        } finally {
            await act(async () => { continueStream(); });
        }
        await waitFor(() => expect(codeStep()?.codeExecutions?.[0].status).toBe(outcome));
        const step = codeStep()!;
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
            expect(codeStatuses()).toEqual(['running', 'running']);
            yield { type: 'tool_result', tool: 'execute_python_script', tool_call_id: 'second', status: 'error', stdout: 'second output', error: 'second failed' } as any;
            expect(codeStatuses()).toEqual(['running', 'failed']);
            yield { type: 'context_info', rules_injected: ['Additional context'] } as any;
            yield { type: 'tool_result', tool: 'execute_python_script', tool_call_id: 'first', status: 'ok', stdout: 'first output' } as any;
            yield { type: 'completion', content: { summary: 'Finished both calls.' } } as any;
        });
        const { store } = mountTask({ text: 'Run both checks', images: [], attachments: [] });
        const codeStatuses = () => store.getState().textTurns.flatMap(turn => turn.codeExecutions || []).map(call => call.status);
        await waitFor(() => expect(store.getState().textTurns.at(-1)?.content).toBe('Finished both calls.'));
        const turns = store.getState().textTurns;
        // request → step message with both calls → closing answer
        expect(turns).toHaveLength(3);
        const step = turns[1];
        expect(step.parentNodeId).toBe(turns[0].id);
        expect(step.codeExecutions).toMatchObject([
            { code: 'print(1)', output: 'first output', status: 'completed' },
            { code: 'print(2)', output: 'second output', status: 'failed' },
        ]);
        expect(step.progressSteps!.filter(item => item.kind === 'tool')).toMatchObject([
            { toolCallId: 'first', status: 'completed', executionId: step.codeExecutions![0].id },
            { toolCallId: 'second', status: 'failed', executionId: step.codeExecutions![1].id },
        ]);
        expect(turns[2].parentNodeId).toBe(step.id);
        expect((turns[2].progressSteps || []).filter(item => item.kind === 'tool')).toHaveLength(0);
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
        const step = store.getState().textTurns.find(turn => turn.codeExecutions?.length)!;
        expect(step.progressSteps!.map(item => item.status)).toEqual(['interrupted', 'interrupted']);
        expect(step.codeExecutions!.map(call => [call.status, call.output])).toEqual([['interrupted', undefined], ['interrupted', undefined]]);
    });

    it('keeps the earlier request when a run resumes from its question', async () => {
        const trajectory = [{ role: 'user', content: 'Compare the security alert sources' }];
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'execute_python_script', tool_call_id: 'first', code: 'print(1)', purpose: 'Survey sources' } as any;
            yield { type: 'tool_result', tool: 'execute_python_script', tool_call_id: 'first', status: 'ok', stdout: '3' } as any;
            yield { type: 'clarify', questions: [{ text: 'Which scenario would you like to explore?', options: ['Compare all three'] }],
                trajectory, completed_step_count: 1 } as any;
        });
        const { store } = mountTask({ text: 'Compare the security alert sources', images: [], attachments: [] });
        await waitFor(() => expect(store.getState().textTurns.some(turn => turn.textKind === 'clarify')).toBe(true));
        const request = turnWith(store, turn => turn.prompt === 'Compare the security alert sources');
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'execute_python_script', tool_call_id: 'second', code: 'print(2)', purpose: 'Check coverage' } as any;
            yield { type: 'tool_result', tool: 'execute_python_script', tool_call_id: 'second', status: 'ok', stdout: 'ok' } as any;
            yield { type: 'completion', content: { summary: 'All three compared.' } } as any;
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
        await waitFor(() => expect(store.getState().textTurns.at(-1)?.content).toBe('All three compared.'));
        // request → step → question → reply → step → answer, one chain with nothing overwritten.
        const question = turnWith(store, turn => turn.textKind === 'clarify');
        const reply = turnWith(store, turn => turn.prompt === 'Revenue');
        expect(turnWith(store, turn => turn.id === request.id)).toMatchObject({ prompt: request.prompt, parentNodeId: request.parentNodeId });
        expect(reply.id).not.toBe(request.id);
        expect(reply.parentNodeId).toBe(question.id);
        const steps = store.getState().textTurns.filter(turn => turn.codeExecutions?.length);
        expect(steps.map(step => step.parentNodeId)).toEqual([request.id, reply.id]);
        expect(new Set(store.getState().textTurns.map(turn => turn.id)).size).toBe(store.getState().textTurns.length);
        const threads = buildThreads(dfSelectors.getThreadGraph(store.getState()));
        expect(threads.filter(thread => thread.nodeIds.includes(request.id))[0].nodeIds).toContain(store.getState().textTurns.at(-1)!.id);
        expect(threads.some(thread => thread.branchFromId)).toBe(false);
    });

    it('preserves progress across a clarification without mixing it into the resumed stage', async () => {
        const trajectory = [{ role: 'user', content: 'Choose a metric' }];
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'inspect_source_data', tool_call_id: 'before-pause' } as any;
            yield { type: 'tool_result', tool: 'inspect_source_data', tool_call_id: 'before-pause', status: 'ok' } as any;
            yield { type: 'clarify', questions: [{ text: 'Which metric?', options: ['Revenue'] }], trajectory } as any;
        });
        const { store } = mountTask({ text: 'Choose a metric', images: [], attachments: [] });
        const question = () => store.getState().textTurns.find(turn => turn.textKind === 'clarify');
        await waitFor(() => expect(question()).toBeDefined());
        expect(question()!.progressSteps).toMatchObject([{ toolCallId: 'before-pause', status: 'completed' }]);
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'tool_start', tool: 'inspect_source_data', tool_call_id: 'after-pause' } as any;
            yield { type: 'tool_result', tool: 'inspect_source_data', tool_call_id: 'after-pause', status: 'ok' } as any;
            yield { type: 'completion', content: { summary: 'Revenue inspected.' } } as any;
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit clarification' }));
        await waitFor(() => expect(store.getState().textTurns.at(-1)?.content).toBe('Revenue inspected.'));
        expect(requestBody(1).trajectory).toEqual(trajectory);
        // question → reply → resumed answer: each message keeps its own stage's progress.
        expect(question()!.progressSteps).toMatchObject([{ toolCallId: 'before-pause', status: 'completed' }]);
        const resumed = store.getState().textTurns.at(-1)!;
        expect(store.getState().textTurns.find(turn => turn.id === resumed.parentNodeId)?.parentNodeId).toBe(question()!.id);
        expect(resumed.progressSteps).toMatchObject([{ toolCallId: 'after-pause', status: 'completed' }]);
        expect(resumed.progressSteps).toHaveLength(1);
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
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.executions?.length)?.executions?.[0].status).toBe('interrupted'));
        // request → step message with the command; no extra message for the dropped stream.
        expect(store.getState().textTurns).toHaveLength(2);
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
        expect(dispatchSpy).toHaveBeenCalled();
        expect(turnWith(store, turn => turn.prompt === 'Extract data and show').attachments).toEqual(['sales_ab12.csv', 'image']);
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
        expect(requestBody().session_state.focusedId).toEqual({ type: 'file', fileName });
        expect(requestBody()).not.toHaveProperty('scratch_files');
        await waitFor(() => expect(store.getState().draftNodes.every(draft => draft.derive.status !== 'running')).toBe(true));
        act(() => store.dispatch(dfActions.setFocused(undefined)));
        act(() => store.dispatch(dfActions.queueAnalystTask({ text: 'Next question', images: [], attachments: [] })));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(2));
        expect(requestBody(1).session_state.focusedId).not.toEqual({ type: 'file', fileName });
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