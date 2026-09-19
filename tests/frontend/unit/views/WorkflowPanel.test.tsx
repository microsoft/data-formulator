import React from 'react';
import 'prismjs';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ThemeProvider, createTheme } from '@mui/material';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../../../src/app/store';
import { dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { apiRequest, streamRequest } from '../../../../src/app/apiClient';
import { publishWorkflowRun, sendWorkflowMessage, WorkflowProgress, WorkflowPanel, Run, selectChatWorkflow } from '../../../../src/views/WorkflowPanel';
import { SimpleChartRecBox } from '../../../../src/views/SimpleChartRecBox';
import { FreeDataViewFC } from '../../../../src/views/DataView';
import { DataThread } from '../../../../src/views/DataThread';
import { LayoutProvider } from '../../../../src/app/LayoutProvider';
import { VisualizationViewFC } from '../../../../src/views/VisualizationView';
import { getThreadConversationIds, orderThreadOutputs } from '../../../../src/views/threadProvenance';
import { ConversationCanvas } from '../../../../src/views/ConversationCanvas';
import { ReportView } from '../../../../src/views/ReportView';

vi.mock('../../../../src/app/apiClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/app/apiClient')>(),
    apiRequest: vi.fn(), streamRequest: vi.fn(),
}));

const run = (): Run => ({
    id: 'native', status: 'running', step_id: 'analyze', message: '', started_at: '2026-09-17T00:00:00Z', calls: 5, tool_calls: 3,
    instance: { name: 'Native review', steps: [
        { id: 'gather', instructions: 'Collect data', checkers: [{ id: 'coverage' }] },
        { id: 'analyze', instructions: 'Analyze data' },
    ] }, visited: ['gather', 'analyze'],
    checks: { coverage: { status: 'passed', explanation: 'Observed rows', evidence_ids: ['observed'] } },
    outputs: [
        { id: 'data', type: 'tool_result', tool: 'create_data', stdout: JSON.stringify({ table_name: 'measurements' }) },
        { id: 'file', type: 'tool_result', tool: 'create_file', stdout: JSON.stringify({
            path: 'files/notes.txt', name: 'notes.txt', content_hash: 'hash', available_in_workspace: true,
        }) },
        { id: 'chart', type: 'result', input_sources: [{ id: 'data:hash:measurements', kind: 'data', display_name: 'measurements' }], content: { question: 'Values by category', result: {
            chart_id: 'chart-native', code: 'result = measurements', content: {
                rows: [{ category: 'A', value: 2 }], virtual: { table_name: 'chart_values', row_count: 1 },
            }, refined_goal: { output_variable: 'result', display_name: 'Category Values', title: 'Values by category', chart: {
                chart_type: 'Bar Chart', encodings: { x: 'category', y: 'value' },
            } },
        } } },
        { id: 'report', type: 'report', content: '# Review\n![Values](chart://chart-native)' },
    ],
});

describe('Workflow session publication', () => {
    const renderThread = (denseColumns = false) => render(<Provider store={store}><ThemeProvider theme={createTheme({
        palette: { custom: { main: '#a34d16' } },
    } as any)}><LayoutProvider><DataThread denseColumns={denseColumns} /></LayoutProvider></ThemeProvider></Provider>);

    afterEach(() => vi.unstubAllGlobals());
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
        store.dispatch(dfActions.resetState());
        store.dispatch(dfActions.setActiveWorkspace({ id: 'session', displayName: 'Session' }));
        vi.mocked(apiRequest).mockReset();
        vi.mocked(streamRequest).mockReset();
        vi.mocked(apiRequest).mockImplementation(async url => url === '/api/workflows/run-state' ? new Promise(() => {}) : { data: { files: [], tables: [
            { name: 'measurements', columns: [{ name: 'value', type: 'INTEGER' }], row_count: 1,
                sample_rows: [{ value: 2 }], content_hash: 'hash', origin: 'agent', role: 'source', edit_policy: 'agent_editable' },
        ] } } as any);
    });

    it('sends composer messages to the workflow without pausing or starting an analyst', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        renderThread();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'other-chat', displayId: 'Other chat',
                textKind: 'explain', content: 'An unrelated analyst answer', parentNodeId: 'conversation-root:other', createdAt: 1 }));
            store.dispatch(dfActions.setFocused({ type: 'text', textId: 'other-chat' }));
        });
        const input = screen.getByPlaceholderText('Message workflow...');
        fireEvent.change(input, { target: { value: 'Compare weekly returns instead.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send to workflow' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/workflows/message', expect.anything()));
        const request = vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/message')!;
        expect(JSON.parse(request[1]!.body as string)).toEqual({ run_id: 'native', message: 'Compare weekly returns instead.', message_id: expect.any(String) });
        await waitFor(() => expect(input).toHaveValue(''));
        expect(screen.getByText('Queued for workflow.')).toBeTruthy();
        expect(screen.getByText('Compare weekly returns instead.')).toBeTruthy();
        expect(store.getState().textTurns.find(item => item.id === turn.id)!.workflow).toEqual(turn.workflow);
        expect(store.getState().textTurns.some(item => item.prompt === 'Compare weekly returns instead.' && item.parentNodeId === turn.id)).toBe(true);
        expect(streamRequest).not.toHaveBeenCalled();
        expect(store.getState().draftNodes).toHaveLength(0);
        expect(store.getState().textTurns.find(item => item.id === 'other-chat')?.answered).not.toBe(true);
        const sentMessage = store.getState().textTurns.find(item => item.workflowMessage)!;
        await act(async () => { await publishWorkflowRun({ ...snapshot, applied_message_ids: [sentMessage.workflowMessage!.messageId] }, 'session'); });
        expect(screen.getByText('Received by workflow.')).toBeTruthy();
        expect(screen.queryByText('Queued for workflow.')).toBeNull();
        await act(async () => { await publishWorkflowRun({ ...snapshot, status: 'completed' }, 'session'); });
        expect(screen.queryByRole('button', { name: 'Pause workflow' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send to workflow' })).toBeNull();
    });

    it('answers a pending workflow question from the chat instead of queueing steering', async () => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), status: 'paused', outputs: [], interaction: { call_id: 'question-1',
            questions: [{ text: 'Which period should be reviewed?', responseType: 'free_text', required: true }] } };
        await publishWorkflowRun(snapshot, 'session');
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...snapshot, status: 'running', interaction: undefined } } as any;
            yield { type: 'workflow_state', run: { ...snapshot, status: 'paused', interaction: undefined } } as any;
        });
        renderThread();
        const input = screen.getByPlaceholderText('Message workflow...');
        fireEvent.change(input, { target: { value: 'Use the latest full month.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send to workflow' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        const request = JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string);
        expect(request).toMatchObject({ run_id: 'native', reply: 'Use the latest full month.' });
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === '/api/workflows/message')).toBe(false);
        await waitFor(() => expect(input).toHaveValue(''));
        expect(store.getState().textTurns.filter(turn => turn.workflowMessage?.kind === 'reply')).toHaveLength(1);
        expect(screen.queryByText('Queued for workflow.')).toBeNull();
        expect(screen.queryByText('Which period should be reviewed?')).toBeNull();
    });

    it('places steering after existing outputs and before outputs created later', async () => {
        const snapshot = { ...run(), status: 'paused' };
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        await sendWorkflowMessage(turn, 'Compare next month.', 'steering-1');
        const message = store.getState().textTurns.find(item => item.workflowMessage)!;
        expect(message.workflowMessage!.afterOutputIds).toEqual(turn.outputIds);
        const { container } = renderThread();
        expect(container.textContent!.lastIndexOf('notes.txt')).toBeLessThan(container.textContent!.indexOf('Compare next month.'));
        await act(async () => { await publishWorkflowRun({ ...snapshot, outputs: [...snapshot.outputs!, {
            id: 'later-file', type: 'tool_result', tool: 'create_file', stdout: JSON.stringify({
                path: 'files/later-note.txt', name: 'later-note.txt', content_hash: 'later', available_in_workspace: true,
            }),
        }] }, 'session'); });
        expect(container.textContent!.indexOf('Compare next month.')).toBeLessThan(container.textContent!.indexOf('later-note.txt'));
        expect(screen.getAllByText('Compare next month.')).toHaveLength(1);
    });

    it('separates earlier plan history from reused step IDs and reviews progress before working', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.plan_revision = 1;
        snapshot.plan_review_pending = true;
        snapshot.checks = {};
        snapshot.visited = [];
        snapshot.plan_revisions = [{ plan_revision: 0, reason: 'Changed date range', previous_step_id: 'analyze',
            previous_steps: snapshot.instance!.steps, previous_visited: ['gather'], previous_checks: {
                coverage: { status: 'passed', explanation: 'Old coverage', evidence_ids: ['old'] },
            } }];
        snapshot.evidence = { old: { tool: 'execute_python_script', text: 'Old range data', step_id: 'gather' },
            revised: { tool: 'adapt_plan', text: 'New range plan', step_id: 'gather', plan_revision: 1 } };
        await publishWorkflowRun(snapshot, 'session');
        let turn = store.getState().textTurns[0];
        expect(turn.workflow!.steps.every(step => step.status === 'pending')).toBe(true);
        const { container, rerender } = render(<Provider store={store}><WorkflowProgress turn={turn} canvas /></Provider>);
        expect(screen.getByText('Reviewing plan')).toBeTruthy();
        expect(screen.queryByLabelText('Current step running')).toBeNull();
        expect(container.querySelector('[data-workflow-plan="0"] [data-workflow-call="old"]')).toBeTruthy();
        expect(container.querySelector('[data-workflow-step="gather"] [data-workflow-call="old"]')).toBeNull();
        expect(container.querySelector('[data-workflow-step="gather"] [data-workflow-call="revised"]')).toBeTruthy();
        snapshot.plan_review_pending = false;
        snapshot.step_progress = { gather: { status: 'completed', explanation: 'Existing input still fits', evidence_ids: ['old'] } };
        await publishWorkflowRun(snapshot, 'session');
        turn = store.getState().textTurns[0];
        expect(turn.workflow!.steps[0].status).toBe('completed');
        expect(turn.workflow!.checks).toEqual([]);
        rerender(<Provider store={store}><WorkflowProgress turn={turn} canvas /></Provider>);
        expect(screen.queryByText('Reviewing plan')).toBeNull();
        expect(container.querySelector('[data-workflow-step="gather"]')?.textContent).toContain('Existing input still fits');
    });

    it('routes selected workflow outputs and stops routing after completion', async () => {
        const snapshot = run();
        snapshot.status = 'paused';
        await publishWorkflowRun(snapshot, 'session');
        for (const focus of [{ type: 'file' as const, fileName: 'notes.txt' },
            { type: 'reference' as const, referenceId: 'workflow-data-native-measurements' },
            { type: 'chart' as const, chartId: 'chart-native' },
            { type: 'report' as const, reportId: 'workflow-report-native' }]) {
            store.dispatch(dfActions.setFocused(focus));
            expect(selectChatWorkflow(store.getState())?.workflow?.runId).toBe('native');
        }
        await publishWorkflowRun({ ...snapshot, status: 'completed' }, 'session');
        expect(selectChatWorkflow(store.getState())).toBeUndefined();
    });

    it('publishes native data, chart, file and report under one initial turn, without replay duplicates', async () => {
        const snapshot = run();
        await publishWorkflowRun(snapshot, 'session');
        await publishWorkflowRun(snapshot, 'session');
        const state = store.getState();
        expect(state.textTurns.filter(turn => !turn.workflowCardFor)).toHaveLength(1);
        expect(state.textTurns[0].prompt).toBe('Run workflow: Native review');
        expect(state.inputTables).toHaveLength(1);
        expect(state.derivedTables).toHaveLength(1);
        expect(state.derivedTables[0].displayId).toBe('Category Values');
        expect(state.derivedTables[0].derive?.source).toEqual(['measurements']);
        expect(state.derivedTables[0].derive?.trigger.chart?.source).toBe('trigger');
        expect(state.loadedTableNodes).toHaveLength(1);
        expect(state.fileNodes).toHaveLength(1);
        expect(dfSelectors.getAllCharts(state).filter(chart => chart.id === 'chart-native')).toHaveLength(1);
        expect(state.generatedReports).toHaveLength(1);
        expect(state.generatedReports[0].selectedChartIds).toEqual(['chart-native']);
        expect(state.textTurns[0].outputIds).toEqual(['workflow-data-native-measurements', 'file-notes.txt', 'chart_values', 'workflow-report-native']);
        expect([state.loadedTableNodes[0], state.fileNodes[0], state.derivedTables[0], state.generatedReports[0]]
            .map(output => output.parentNodeId)).toEqual([state.textTurns[0].id, 'workflow-data-native-measurements', 'file-notes.txt', 'chart_values']);
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('keeps workflow thread order as outputs arrive (older outputs already exist: %s)', async olderHasOutputs => {
        const older = { ...run(), outputs: [run().outputs![2]] };
        const newerOutput = structuredClone(older.outputs[0]);
        newerOutput.id = 'newer-chart';
        newerOutput.content.result.chart_id = 'newer-chart';
        newerOutput.content.result.content.virtual.table_name = 'newer_values';
        newerOutput.content.result.refined_goal.display_name = 'Newer Values';
        const newer = { ...run(), id: 'newer', started_at: '2026-09-17T01:00:00Z',
            instance: { ...run().instance!, name: 'Newer review' }, outputs: [newerOutput] };
        await publishWorkflowRun({ ...older, outputs: olderHasOutputs ? older.outputs : [] }, 'session');
        await publishWorkflowRun({ ...newer, outputs: [] }, 'session');
        const turnIds = [older, newer].map(snapshot => store.getState().textTurns.find(turn => turn.workflow?.runId === snapshot.id)!.id);
        const { unmount } = renderThread();
        const expectThreadOrder = () => {
            expect(screen.getAllByText(/^thread\s*-\s*\d+$/i).map(heading => heading.textContent))
                .toEqual([expect.stringMatching(/^thread\s*-\s*1$/i), expect.stringMatching(/^thread\s*-\s*2$/i)]);
            const buttons = screen.getAllByRole('button', { name: 'Open thread conversation' });
            expect(buttons).toHaveLength(2);
            buttons.forEach((button, index) => {
                fireEvent.click(button);
                expect(store.getState().focusedId).toMatchObject({ type: 'conversation', nodeIds: expect.arrayContaining([turnIds[index]]) });
            });
        };
        expectThreadOrder();
        await act(async () => { await publishWorkflowRun(newer, 'session'); });
        expectThreadOrder();
        await act(async () => { await publishWorkflowRun(older, 'session'); });
        expectThreadOrder();
        unmount();
        renderThread();
        expectThreadOrder();
    });

    it('appends after the persisted output tail across resume, updates, and focus changes', async () => {
        const snapshot = run();
        await publishWorkflowRun(snapshot, 'session');
        const firstParents = [store.getState().fileNodes[0].parentNodeId, store.getState().derivedTables[0].parentNodeId];
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'unrelated-focus' }));
        const nextChart = structuredClone(snapshot.outputs![2]);
        nextChart.id = 'chart-next';
        nextChart.content.result.chart_id = 'chart-next';
        nextChart.content.result.content.virtual.table_name = 'next_values';
        nextChart.content.result.refined_goal.display_name = 'Next Values';
        snapshot.outputs!.push(nextChart);
        await publishWorkflowRun(snapshot, 'session');
        snapshot.outputs![1].version = 'updated-notes';
        await publishWorkflowRun(snapshot, 'session');
        expect(store.getState().derivedTables.find(table => table.id === 'next_values')?.parentNodeId).toBe('workflow-report-native');
        expect([store.getState().fileNodes[0].parentNodeId, store.getState().derivedTables[0].parentNodeId]).toEqual(firstParents);
        expect(store.getState().textTurns[0].outputIds).toEqual(['workflow-data-native-measurements', 'file-notes.txt', 'chart_values', 'workflow-report-native', 'next_values']);
        const { container } = renderThread();
        expect(screen.getAllByText(/^thread\s*-\s*\d+$/i)).toHaveLength(1);
        expect(container.querySelector('[data-thread-flow-block="output-chart_values"]')).toBeTruthy();
        expect(container.querySelector('[data-thread-flow-block="output-next_values"]')).toBeTruthy();
        expect(screen.getAllByText('Next Values')).toHaveLength(1);
    });

    it('breaks a workflow using rendered output heights instead of undercounting chart groups', async () => {
        const viewportHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
        const blockHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
            if (this.dataset.threadFlowBlock?.startsWith('output-chart_values')) return 200;
            return this.hasAttribute('data-thread-flow-block') ? 160 : 0;
        });
        try {
            const snapshot = run();
            for (let index = 1; index <= 2; index++) {
                const chart = structuredClone(snapshot.outputs![2]);
                chart.id = `chart-${index}`;
                chart.content.result.chart_id = `chart-${index}`;
                chart.content.result.content.virtual.table_name = `chart_values_${index}`;
                snapshot.outputs!.push(chart);
            }
            await publishWorkflowRun(snapshot, 'session');
            const { container } = renderThread(true);
            const segmentOf = (id: string) => container.querySelector(`[data-thread-flow-block="output-${id}"]`)
                ?.closest('[data-thread-segment]')?.getAttribute('data-thread-segment');
            await waitFor(() => expect(segmentOf('chart_values_2')).not.toBe(segmentOf('chart_values')));
            expect(segmentOf('chart_values')).toBeDefined();
            expect(segmentOf('chart_values_2')).toBeDefined();
            expect(container.querySelectorAll('[data-thread-flow-block="output-chart_values"]')).toHaveLength(1);
            const outputIds = ['chart_values', 'chart_values_1', 'chart_values_2'];
            const initialSegments = outputIds.map(segmentOf);
            blockHeight.mockImplementation(function (this: HTMLElement) {
                return this.hasAttribute('data-thread-flow-block') ? 4000 : 0;
            });
            await act(async () => { await publishWorkflowRun({ ...snapshot, calls: (snapshot.calls ?? 0) + 1 }, 'session'); });
            expect(outputIds.map(segmentOf)).toEqual(initialSegments);
        } finally {
            viewportHeight.mockRestore();
            blockHeight.mockRestore();
        }
    });

    it('counts the workspace shelf toward the first workflow segment height', async () => {
        const viewportHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(711);
        const blockHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
            if (this.hasAttribute('data-thread-shelf')) return 150;
            if (this.hasAttribute('data-thread-flow-header')) return 24;
            const key = this.dataset.threadFlowBlock;
            if (!key) return 0;
            if (key === 'output-chart_values') return 192;
            if (key === 'output-chart_values_1') return 173;
            if (key === 'output-chart_values_2') return 203;
            if (key.startsWith('output-workflow-data-')) return 95;
            if (key.startsWith('output-workflow-report-')) return 40;
            if (key.includes('completed-')) return 51;
            return 147;
        });
        try {
            const snapshot = run();
            const charts = Array.from({ length: 3 }, (_, index) => {
                const chart = structuredClone(snapshot.outputs![2]);
                chart.id = `chart-${index}`;
                chart.content.result.chart_id = `chart-${index}`;
                chart.content.result.content.virtual.table_name = index ? `chart_values_${index}` : 'chart_values';
                return chart;
            });
            snapshot.outputs = [snapshot.outputs![0], ...charts, snapshot.outputs![3]];
            snapshot.status = 'completed';
            await publishWorkflowRun(snapshot, 'session');
            const { container } = renderThread(true);
            const segmentOf = (id: string) => container.querySelector(`[data-thread-flow-block="output-${id}"]`)
                ?.closest('[data-thread-segment]')?.getAttribute('data-thread-segment');
            await waitFor(() => expect(segmentOf('chart_values_2')).toBe('1'));
            expect(segmentOf('chart_values')).toBe('0');
            expect(segmentOf('chart_values_1')).toBe('0');
        } finally {
            viewportHeight.mockRestore();
            blockHeight.mockRestore();
        }
    });

    it('anchors one workflow card after its outputs and keeps completed follow-ups below that boundary', async () => {
        const snapshot = run();
        snapshot.outputs = [snapshot.outputs![2]];
        await publishWorkflowRun(snapshot, 'session');
        const cardId = 'textTurn-workflow-card-native';
        expect(store.getState().textTurns.find(turn => turn.id === cardId)?.parentNodeId).toBe('chart_values');
        snapshot.outputs.push({ id: 'report', type: 'report', content: '# Final review' });
        await publishWorkflowRun(snapshot, 'session');
        expect(store.getState().textTurns.find(turn => turn.id === cardId)?.parentNodeId).toBe('workflow-report-native');
        snapshot.status = 'completed';
        await publishWorkflowRun(snapshot, 'session');
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'after-workflow', displayId: 'Follow-up',
            textKind: 'explain', prompt: 'Now compare next month.', content: 'Next-month analysis.',
            parentNodeId: 'textTurn-workflow-completed-native', createdAt: Date.now() + 1 }));
        await publishWorkflowRun(snapshot, 'session');
        expect(store.getState().textTurns.filter(turn => turn.id === cardId)).toHaveLength(1);
        expect(store.getState().textTurns.find(turn => turn.id === cardId)?.parentNodeId).toBe('workflow-report-native');
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-workflow-completed-native')?.parentNodeId).toBe(cardId);
        const { container } = renderThread();
        const card = container.querySelector(`[data-thread-item="textturn-${cardId}"]`)!;
        expect(card).toBeTruthy();
        expect(card.compareDocumentPosition(screen.getByText('Now compare next month.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(container.querySelectorAll(`[data-thread-item="textturn-${cardId}"]`)).toHaveLength(1);
    });

    it.each(['textTurn-workflow-native', 'textTurn-workflow-card-native'])('sends an analyst follow-up from completed workflow focus %s with its status and output context', async focusedTextId => {
        const snapshot = { ...run(), status: 'completed' };
        await publishWorkflowRun(snapshot, 'session');
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        store.dispatch(dfActions.setFocused({ type: 'text', textId: focusedTextId }));
        let finishResponse!: () => void;
        const responseReady = new Promise<void>(resolve => { finishResponse = resolve; });
        vi.mocked(streamRequest).mockImplementation(async function* () {
            await responseReady;
            yield { type: 'completion', content: { summary: 'The coverage check passed for all requested regions.' } } as any;
        });
        const { container } = renderThread();
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Explain the coverage check and compare the results.' } });
        const send = screen.getByRole('button', { name: 'Explore' });
        expect(send).toBeEnabled();
        fireEvent.click(send);
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        try {
            expect(container.querySelector('[data-thread-item^="agent-thinking-"]')).toBeTruthy();
            expect(container.querySelector('[data-thread-highlighted="true"]')).toBeTruthy();
        } finally {
            await act(async () => { finishResponse(); });
        }
        const body = JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string);
        expect(body.user_question).toBe('Explain the coverage check and compare the results.');
        const context = body.focused_thread.find((step: any) => step.workflow)?.workflow;
        expect(context).toMatchObject({ run_id: 'native', status: 'completed',
            output_ids: ['workflow-data-native-measurements', 'file-notes.txt', 'chart_values', 'workflow-report-native'] });
        expect(context.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'coverage', status: 'passed' })]));
        expect(context.reports[0].content).toContain('# Review');
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.content === 'The coverage check passed for all requested regions.'))
            .toMatchObject({ parentNodeId: 'textTurn-workflow-completed-native', prompt: body.user_question }));
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-workflow-native')?.answered).not.toBe(true);
    });

    it.each(['Run once', 'Reject'])('resumes terminal approval through %s with only the saved request ID', async label => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), status: 'paused', outputs: [], terminal_request: {
            id: 'approval', argv: ['echo', 'prices'], cwd: '/tmp', purpose: 'Inspect prices', timeout_seconds: 60,
        } };
        await publishWorkflowRun(snapshot, 'session');
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...snapshot, status: 'completed', terminal_request: undefined } } as any;
        });
        render(<Provider store={store}><WorkflowProgress turn={store.getState().textTurns[0]} interactionOnly /></Provider>);
        expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog').textContent).toContain('prices');
        fireEvent.click(screen.getByRole('button', { name: label }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        const body = JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string);
        expect(body.run_id).toBe('native');
        expect(body.terminal_response).toEqual({ request_id: 'approval', decision: label === 'Run once' ? 'approve' : 'reject' });
        await waitFor(() => expect(store.getState().textTurns[0].workflow?.status).toBe('completed'));
    });

    it('lists server demos alongside user workflows and customizes a non-colliding copy', async () => {
        const demo = { path: 'demo/household-cost-review.yaml', name: 'Monthly Household Cost Review', origin: 'demo' };
        const user = { path: 'household-cost-review-copy.yaml', name: 'My cost review', origin: 'user' };
        vi.mocked(apiRequest).mockImplementation(async url => ({ data: url === '/api/workflows/read'
            ? { content: 'version: 1\nname: Monthly Household Cost Review' }
            : { items: [demo, user], runs: [] } }) as any);
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        await screen.findByRole('button', { name: `Customize ${demo.name}` });
        expect(screen.getByRole('region', { name: 'Demo workflows' })).toHaveTextContent(demo.name);
        expect(screen.getByRole('region', { name: 'My workflows' })).toHaveTextContent(user.name);
        expect(screen.queryByRole('button', { name: `Delete ${demo.path}` })).toBeNull();
        expect(screen.getByRole('button', { name: `Delete ${user.path}` })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: `Customize ${demo.name}` }));
        expect(await screen.findByLabelText('Instance filename')).toHaveValue('household-cost-review-copy-2.yaml');
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/read')![1]!.body as string)).toEqual({ path: demo.path });
        fireEvent.click(screen.getByRole('button', { name: 'Save instance' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/workflows/save', expect.anything()));
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/save')![1]!.body as string).path).toBe('household-cost-review-copy-2.yaml');
    });

    it('runs a server demo by its namespaced path in the current session', async () => {
        store.dispatch(dfActions.setDataSourceSidebarOpen(true));
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [{ path: 'demo/household-cost-review.yaml',
            name: 'Monthly Household Cost Review', origin: 'demo' }], runs: [] } });
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...run(), status: 'completed', outputs: [] } } as any;
        });
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Run Monthly Household Cost Review' }));
        expect(store.getState().dataSourceSidebarOpen).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Current session' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string).path).toBe('demo/household-cost-review.yaml');
        await waitFor(() => expect(store.getState().dataSourceSidebarOpen).toBe(false));
    });

    it('allows setup without a selected model but prevents execution', async () => {
        store.dispatch(dfActions.selectModel(''));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [{ path: 'prices.yaml', name: 'Prices' }], runs: [] } });
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Run Prices' }));
        expect(screen.getByLabelText('Additional instructions')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
        expect(streamRequest).not.toHaveBeenCalled();
    });

    it('collects setup without an agent turn and submits typed values only after confirmation', async () => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [{ path: 'setup.yaml', name: 'Setup review', parameters: [
            { name: 'symbol', label: 'Symbol', required: true, default: 'MSFT' },
            { name: 'days', label: 'Days', type: 'number', default: 90 },
            { name: 'details', label: 'Include details', type: 'boolean', default: false },
            { name: 'period', label: 'Period', type: 'select', options: ['Month', 'Year'], default: 'Month', allow_custom: true },
            { name: 'tone', label: 'Tone', type: 'select', options: ['Brief', 'Detailed'], default: 'Brief' },
        ] }], runs: [] } });
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...run(), status: 'completed', outputs: [] } } as any;
        });
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Run Setup review' }));
        expect(screen.getByRole('dialog', { name: 'Workflow setup' })).toBeTruthy();
        expect(streamRequest).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(streamRequest).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole('button', { name: 'Run Setup review' }));
        fireEvent.change(screen.getByLabelText(/Symbol/), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Current session' }));
        expect(streamRequest).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText(/Symbol/), { target: { value: 'AAPL' } });
        fireEvent.change(screen.getByLabelText('Days'), { target: { value: '120' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include details' }));
        fireEvent.focus(screen.getByRole('combobox', { name: 'Period' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Year' }));
        expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('Year');
        fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: 'Last quarter' } });
        fireEvent.change(screen.getByLabelText('Additional instructions'), { target: { value: 'Focus on volatility.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Current session' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string).setup).toEqual({
            parameters: { symbol: 'AAPL', days: 120, details: true, period: 'Last quarter', tone: 'Brief' },
            instructions: 'Focus on volatility.',
        });
    });

    it.each([true, false])('preserves setup until a new workspace is ready (existing workspace: %s)', async hasWorkspace => {
        if (!hasWorkspace) store.dispatch(dfActions.setActiveWorkspace(null));
        store.dispatch(dfActions.setDataSourceSidebarOpen(true));
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [{ path: 'prices.yaml', name: 'Prices' }], runs: [] } });
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...run(), status: 'completed', outputs: [] } } as any;
        });
        const createSession = vi.fn();
        render(<Provider store={store}><WorkflowPanel onCreateSession={createSession} /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Run Prices' }));
        expect(screen.queryByRole('button', { name: 'Current session' }) !== null).toBe(hasWorkspace);
        fireEvent.change(screen.getByLabelText('Additional instructions'), { target: { value: 'Compare the latest year.' } });
        expect(streamRequest).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'New session' }));
        expect(createSession).toHaveBeenCalledWith('Prices');
        expect(streamRequest).not.toHaveBeenCalled();
        act(() => store.dispatch(dfActions.resetForNewWorkspace({ id: 'new-session', displayName: 'Prices' })));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string).path).toBe('prices.yaml');
        expect(JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string).setup).toEqual({
            parameters: {}, instructions: 'Compare the latest year.',
        });
        await waitFor(() => expect(store.getState().dataSourceSidebarOpen).toBe(false));
    });

    it('collapses the sidebar after opening a recent workflow run', async () => {
        store.dispatch(dfActions.setDataSourceSidebarOpen(true));
        const snapshot = { ...run(), status: 'completed', outputs: [] };
        vi.mocked(apiRequest).mockImplementation(async url => ({ data: url === '/api/workflows/run-state'
            ? { run: snapshot }
            : { items: [], runs: [{ ...snapshot, name: 'Recent review' }] } }) as any);
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: /Recent review/ }));
        await waitFor(() => expect(store.getState().dataSourceSidebarOpen).toBe(false));
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'textTurn-workflow-native' });
    });

    it('requires an import selection and resumes the same workflow with the selected plan', async () => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), status: 'paused', outputs: [], interaction: { call_id: 'import-call', data_operation: {
            schema_version: 1, id: 'import-prices', status: 'awaiting_selection', reason: 'Acquire prices',
            plans: [{ id: 'daily', hash: 'a'.repeat(64), label: 'Daily prices', summary: 'Import prices',
                steps: [{ kind: 'connector_query', display_name: 'Prices' }] }],
        } } };
        await publishWorkflowRun(snapshot, 'session');
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...snapshot, status: 'completed', interaction: undefined } } as any;
        });
        render(<Provider store={store}><WorkflowProgress turn={store.getState().textTurns[0]} interactionOnly /></Provider>);
        expect(screen.queryByRole('button', { name: 'Load and continue' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
        render(<Provider store={store}><VisualizationViewFC /></Provider>);
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/agent/data-operation-preview', expect.anything()));
        fireEvent.click(screen.getByRole('button', { name: /Daily prices/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(store.getState().textTurns[0].workflow?.dataOperation?.selectedPlanId).toBe(snapshot.interaction.data_operation.plans[0].id);
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        const body = JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string);
        expect(body.run_id).toBe('native');
        expect(body.interaction_response).toEqual({ operation_id: 'import-prices', plan_id: 'daily' });
        await waitFor(() => expect(store.getState().textTurns[0].workflow?.status).toBe('completed'));
    });

    it('opens one agent question and continues the same workflow with its answer', async () => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), status: 'paused', message: 'Which date range should I use?', interaction: {
            call_id: 'question', questions: [{ text: 'Which date range should I use?', responseType: 'free_text' }],
        } };
        await publishWorkflowRun(snapshot, 'session');
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'textTurn-workflow-native' });
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...snapshot, status: 'completed', interaction: undefined } } as any;
        });
        const turn = store.getState().textTurns[0];
        render(<Provider store={store}><WorkflowProgress turn={turn} /><WorkflowProgress turn={turn} canvas /><WorkflowProgress turn={turn} interactionOnly /></Provider>);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getAllByRole('textbox')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Respond to agent' })).toBeNull();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Last quarter' } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        const body = JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string);
        expect(body.run_id).toBe('native');
        expect(body.reply).toBe('Last quarter');
        expect(store.getState().textTurns.some(item => item.prompt === 'Last quarter' && item.parentNodeId === turn.id)).toBe(true);
        await waitFor(() => expect(store.getState().textTurns[0].workflow?.status).toBe('completed'));
    });

    it.each([false, true])('streams reports into one chained native report and handles interruption=%s', async interrupted => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), status: 'paused' };
        snapshot.outputs = snapshot.outputs!.filter(output => output.type !== 'report');
        await publishWorkflowRun(snapshot, 'session');
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...snapshot, status: 'running' } } as any;
            yield { type: 'action', action: 'write_report' } as any;
            expect(store.getState().generatedReports[0]).toMatchObject({ id: 'workflow-report-native', status: 'generating', parentNodeId: 'chart_values' });
            expect(store.getState().textTurns[0].workflow?.artifacts).toContainEqual({ nodeId: 'workflow-report-native', stepId: 'analyze', planRevision: 0 });
            yield { type: 'text_delta', channel: 'report', content: '# Review\n' } as any;
            yield { type: 'text_delta', channel: 'report', content: 'Verified prices.' } as any;
            expect(store.getState().generatedReports[0].content).toBe('');
            await new Promise(resolve => setTimeout(resolve, 125));
            expect(store.getState().generatedReports[0].content).toBe('# Review\nVerified prices.');
            expect(store.getState().focusedId).toEqual({ type: 'report', reportId: 'workflow-report-native' });
            yield { type: 'workflow_state', run: { ...snapshot, status: interrupted ? 'paused' : 'completed',
                outputs: interrupted ? snapshot.outputs : [...snapshot.outputs!, { id: 'report', type: 'report', content: '# Review\nVerified prices.' }] } } as any;
        });
        render(<Provider store={store}><WorkflowProgress turn={store.getState().textTurns[0]} interactionOnly /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Continue workflow' }));
        await waitFor(() => expect(store.getState().generatedReports[0]?.status).toBe(interrupted ? 'error' : 'completed'));
        expect(store.getState().generatedReports).toHaveLength(1);
        expect(store.getState().generatedReports[0].parentNodeId).toBe('chart_values');
    });

    it('keeps thread report metadata stable during content streaming but updates completion', () => {
        const report = { id: 'streaming-report', title: 'Review', content: '', status: 'generating' as const,
            createdAt: 1, selectedChartIds: [] };
        store.dispatch(dfActions.saveGeneratedReport(report));
        const metadata = dfSelectors.getThreadReports(store.getState());
        for (const content of ['First', 'First paragraph', 'First paragraph\n\nSecond paragraph']) {
            store.dispatch(dfActions.updateGeneratedReportContent({ id: report.id, content }));
            expect(dfSelectors.getThreadReports(store.getState())).toBe(metadata);
            expect(dfSelectors.getAllGeneratedReports(store.getState())[0].content).toBe(content);
        }
        store.dispatch(dfActions.updateGeneratedReportContent({ id: report.id, content: 'Finished', status: 'completed' }));
        expect(dfSelectors.getThreadReports(store.getState())).not.toBe(metadata);
        expect(dfSelectors.getThreadReports(store.getState())[0].status).toBe('completed');
    });

    it.each([false, true])('renders a composing workflow report once in the thread with dense columns=%s', async denseColumns => {
        const snapshot = run();
        snapshot.outputs = snapshot.outputs!.filter(output => output.type !== 'report');
        await publishWorkflowRun(snapshot, 'session');
        const report = { id: 'workflow-report-native', title: 'Streaming fuel review', content: '',
            status: 'generating' as const, generatingPhase: 'writing' as const, createdAt: Date.now(),
            parentNodeId: 'chart_values', selectedChartIds: ['chart-native'] };
        store.dispatch(dfActions.saveGeneratedReport(report));
        store.dispatch(dfActions.setFocused({ type: 'report', reportId: report.id }));
        renderThread(denseColumns);
        expect(screen.getAllByRole('button', { name: /Streaming fuel review/ })).toHaveLength(1);
        expect(store.getState().draftNodes).toHaveLength(0);
        act(() => {
            store.dispatch(dfActions.saveGeneratedReport({ ...report, status: 'completed', content: '# Fuel review' }));
        });
        expect(screen.getAllByRole('button', { name: /Streaming fuel review/ })).toHaveLength(1);
    });

    it.each(['', '# Partial report'])('renders final report content read-only after a stream containing %j', async partial => {
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const report = { id: 'workflow-report-native', title: 'Review', content: partial, status: 'generating',
            generatingPhase: 'writing', selectedChartIds: [], parentNodeId: 'workflow-native', createdAt: 1 } as const;
        store.dispatch(dfActions.saveGeneratedReport(report as any));
        store.dispatch(dfActions.setFocused({ type: 'report', reportId: report.id }));
        const { container } = render(<Provider store={store}><ThemeProvider theme={createTheme()}>
            <ReportView />
        </ThemeProvider></Provider>);
        expect(container.querySelector('[contenteditable="true"]')).toBeNull();
        act(() => {
            store.dispatch(dfActions.updateGeneratedReportContent({ id: report.id, content: '# Streaming text' }));
        });
        expect(screen.getByText('Streaming text')).toBeVisible();
        expect(container.querySelector('[contenteditable="true"]')).toBeNull();
        act(() => {
            store.dispatch(dfActions.saveGeneratedReport({ ...report, status: 'completed',
                content: '# Completed review\n\nVerified household costs.' } as any));
        });
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Completed review' })).toBeTruthy());
        expect(screen.getByText('Verified household costs.')).toBeTruthy();
        expect(container.querySelector('.tiptap')?.getAttribute('contenteditable')).toBe('false');
        expect(screen.queryByText('Partial report')).toBeNull();
    });

    it('continues an interrupted checkpoint from the workflow agent box without synthesizing a question', async () => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), outputs: [], status: 'paused', message: 'Connection interrupted. Review and resume the checkpoint.' };
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        expect(turn.workflow?.questions).toBeUndefined();
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...snapshot, status: 'running', message: '' } } as any;
            const activeTool = { id: 'verify', tool: 'execute_python_script', step_id: 'analyze', details: { purpose: 'Verify totals' } };
            yield { type: 'activity', tool: 'execute_python_script', message: 'I am verifying the basket totals.', active_tool: activeTool } as any;
            expect(store.getState().textTurns[0].workflow?.activity).toBe('I am verifying the basket totals.');
            expect(store.getState().textTurns[0].workflow?.activeTool).toEqual(activeTool);
            yield { type: 'activity', tool: 'create_chart' } as any;
            expect(store.getState().textTurns[0].workflow?.activity).toBe('create chart');
            expect(store.getState().textTurns[0].workflow?.activeTool).toBeUndefined();
            yield { type: 'workflow_state', run: { ...snapshot, status: 'completed' } } as any;
        });
        render(<Provider store={store}><WorkflowProgress turn={{ ...turn, workflow: { ...turn.workflow!,
            questions: [{ text: snapshot.message, responseType: 'free_text' }] } }} interactionOnly /></Provider>);
        expect(screen.getByText('Interrupted')).toBeTruthy();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByText('Respond to agent')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Continue workflow' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        const body = JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string);
        expect(body.run_id).toBe(snapshot.id);
        expect(body.reply).toBeUndefined();
        await waitFor(() => expect(store.getState().textTurns[0].workflow?.status).toBe('completed'));
    });

    it.each(['orphaned', 'unreachable'])('interrupts a restored %s run without discarding its outputs', async failure => {
        const snapshot = run();
        await publishWorkflowRun(snapshot, 'session');
        const original = store.getState().textTurns[0];
        const outputIds = original.outputIds;
        if (failure === 'orphaned') vi.mocked(apiRequest).mockResolvedValueOnce({ data: { run: {
            ...snapshot, status: 'paused', message: 'Execution interrupted: the workflow executor stopped.',
        } } } as any);
        else vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Backend unavailable'));
        const { rerender } = render(<Provider store={store}><WorkflowProgress turn={original} /></Provider>);
        await waitFor(() => expect(store.getState().textTurns[0].workflow?.status).toBe('paused'));
        const interrupted = store.getState().textTurns[0];
        expect(interrupted.outputIds).toEqual(outputIds);
        expect(interrupted.content).toMatch(/interrupted/i);
        rerender(<Provider store={store}><WorkflowProgress turn={interrupted} interactionOnly /></Provider>);
        expect(screen.getByText('Interrupted')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Continue workflow' })).toBeTruthy();
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it.each(['unreachable', 'orphaned', 'healthy'])('checks a live stream when the executor is %s', async health => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), outputs: [], status: 'paused' };
        await publishWorkflowRun(snapshot, 'session');
        let signal: AbortSignal | undefined;
        let finish: () => void = () => {};
        let streamFinished = false;
        vi.mocked(streamRequest).mockImplementation(async function* (_url, _options, abortSignal) {
            signal = abortSignal;
            const pending = new Promise<void>(resolve => {
                finish = resolve;
                abortSignal?.addEventListener('abort', () => resolve(), { once: true });
            });
            yield { type: 'workflow_state', run: { ...snapshot, status: 'running' } } as any;
            await pending;
            if (!abortSignal?.aborted) yield { type: 'workflow_state', run: { ...snapshot, status: 'completed' } } as any;
            streamFinished = true;
        });
        if (health === 'unreachable') vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Backend restarted'));
        else vi.mocked(apiRequest).mockResolvedValueOnce({ data: { run: {
            ...snapshot, status: health === 'healthy' ? 'running' : 'paused', message: 'Executor interrupted.',
        } } } as any);
        const view = render(<Provider store={store}><WorkflowProgress turn={store.getState().textTurns[0]} interactionOnly /></Provider>);
        vi.useFakeTimers();
        try {
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue workflow' })); });
            expect(store.getState().textTurns[0].workflow?.status).toBe('running');
            await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
            expect(apiRequest).toHaveBeenCalledWith('/api/workflows/run-state', expect.objectContaining({ signal: expect.anything() }));
            expect(signal?.aborted).toBe(health !== 'healthy');
            expect(store.getState().textTurns[0].workflow?.status).toBe(health === 'healthy' ? 'running' : 'paused');
            if (health === 'healthy') await act(async () => { finish(); });
            expect(streamFinished).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            await act(async () => { finish(); });
            view.unmount();
            vi.useRealTimers();
        }
    });

    it('shows agent table display names without calling them filenames', async () => {
        vi.mocked(apiRequest).mockResolvedValueOnce({ data: { tables: [{ name: 'measurements', original_name: 'Weekly Measurements',
            origin: 'agent', columns: [{ name: 'value', type: 'INTEGER' }], row_count: 1, sample_rows: [{ value: 2 }] }] } } as any);
        const snapshot = run();
        snapshot.outputs = snapshot.outputs!.filter(output => output.id === 'data');
        snapshot.outputs[0].stdout = JSON.stringify({ table_name: 'measurements', display_name: 'Weekly Measurements' });
        await publishWorkflowRun(snapshot, 'session');
        const { container } = render(<Provider store={store}><DndProvider backend={HTML5Backend}><FreeDataViewFC tableId="measurements" showHeaderBar /></DndProvider></Provider>);
        expect(screen.getByText('Weekly Measurements')).toBeTruthy();
        expect(container.textContent).not.toContain('filename:');
        expect(store.getState().inputTables[0].id).toBe('measurements');
    });

    it('updates the same report without adding another user turn', async () => {
        const snapshot = run();
        snapshot.outputs = [{ id: 'report', type: 'report', content: '# First' }];
        await publishWorkflowRun(snapshot, 'session');
        snapshot.outputs[0].content = '# Revised';
        snapshot.status = 'completed';
        await publishWorkflowRun(snapshot, 'session');
        await publishWorkflowRun(snapshot, 'session');
        expect(store.getState().textTurns.filter(turn => !turn.workflowCardFor)).toHaveLength(2);
        expect(store.getState().textTurns.filter(turn => turn.prompt)).toHaveLength(1);
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-workflow-completed-native')?.content).toBe('Workflow completed.');
        expect(store.getState().generatedReports).toHaveLength(1);
        expect(store.getState().generatedReports[0].content).toBe('# Revised');
    });

    it('does not register outputs after the active session changes during a table request', async () => {
        vi.mocked(apiRequest).mockImplementationOnce(async () => {
            store.dispatch(dfActions.resetForNewWorkspace({ id: 'other', displayName: 'Other' }));
            return { data: { tables: [] } } as any;
        });
        await publishWorkflowRun(run(), 'session');
        expect(store.getState().inputTables).toHaveLength(0);
        expect(store.getState().fileNodes).toHaveLength(0);
        expect(store.getState().generatedReports).toHaveLength(0);
        expect(store.getState().textTurns).toHaveLength(0);
    });

    it('shows a failed step instead of inferring completion from visiting it', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.status = 'paused';
        snapshot.checks!.coverage.status = 'failed';
        await publishWorkflowRun(snapshot, 'session');
        render(<WorkflowProgress turn={store.getState().textTurns[0]} />);
        expect(screen.getByText('gather · failed')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review interruption' })).toBeTruthy();
        expect(screen.queryByLabelText('Recovery guidance')).not.toBeInTheDocument();
    });

    it('keeps the prompt first and workflow progress after the latest artifacts', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        snapshot.outputs!.find(output => output.id === 'chart')!.input_sources = [];
        snapshot.message = 'Detailed workflow response belongs in the canvas.';
        await publishWorkflowRun(snapshot, 'session');
        const { container } = renderThread();
        expect(container.querySelector('[data-workflow-progress="native"]')).toBeTruthy();
        expect(screen.getAllByText(/^thread\s*-\s*\d+$/i)).toHaveLength(1);
        const text = container.textContent || '';
        expect(text.indexOf('Run workflow: Native review')).toBeLessThan(text.indexOf('notes.txt'));
        expect(text.indexOf('Run workflow: Native review')).toBeLessThan(text.indexOf('completed · 3 tool calls'));
        expect(text.lastIndexOf('notes.txt')).toBeLessThan(text.indexOf('completed · 3 tool calls'));
        expect(text.indexOf('Category Values')).toBeGreaterThanOrEqual(0);
        expect(text.indexOf('Category Values')).toBeLessThan(text.indexOf('completed · 3 tool calls'));
        expect(text.indexOf('notes.txt')).toBeLessThan(text.indexOf('Category Values'));
        expect(text.indexOf('Category Values')).toBeLessThan(text.indexOf('Native review', text.indexOf('Run workflow: Native review') + 'Run workflow: Native review'.length));
        expect(text.lastIndexOf('notes.txt')).toBeLessThan(text.indexOf(snapshot.message));
        expect(container.querySelector('[data-workflow-progress="native"]')!.textContent).not.toContain(snapshot.message);
    });

    it('does not crash on a previously saved chart whose table no longer exists', () => {
        store.dispatch(dfActions.addChart({ id: 'stale', tableRef: 'missing', source: 'user', chartType: 'Auto', encodingMap: {} } as any));
        expect(() => renderThread()).not.toThrow();
    });

    it('opens the response and recorded analysis in the canvas while keeping the status card compact', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        snapshot.outputs = [];
        snapshot.message = 'Compared the observed values.';
        snapshot.evidence = { observed: { tool: 'execute_python_script', text: 'Validated 61 rows', call: 2 } };
        await publishWorkflowRun(snapshot, 'session');
        const onSelect = vi.fn();
        const { container } = render(<div onClick={onSelect}><WorkflowProgress turn={store.getState().textTurns[0]} /></div>);
        const summary = screen.getByRole('button', { name: 'Open workflow response and analysis log' });
        expect(screen.queryByText(snapshot.message)).toBeNull();
        fireEvent.click(summary);
        expect(container.textContent).not.toContain('Analysis log');
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: 'textTurn-workflow-native' });
        expect(store.getState().viewMode).toBe('editor');
        render(<Provider store={store}><VisualizationViewFC /></Provider>);
        expect(screen.getByText(snapshot.message)).toBeTruthy();
        expect(screen.getByText('Call 2: execute python script')).toBeTruthy();
        expect(screen.getByText('Validated 61 rows')).toBeTruthy();
        expect(onSelect).not.toHaveBeenCalled();
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('keeps running chat quiet with pause and send controls and uses the shared interruption panel', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        await publishWorkflowRun(snapshot, 'session');
        const { container } = renderThread();
        const input = screen.getByPlaceholderText('Message workflow...');
        const chat = input.closest('[data-chat-mode]')!;
        expect(chat).not.toHaveTextContent('Step 2 of 2');
        expect(screen.getByRole('button', { name: 'Pause workflow' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Send to workflow' })).toBeNull();
        snapshot.activity = 'I am comparing the latest prices with the same month last year.';
        await act(async () => { await publishWorkflowRun(snapshot, 'session'); });
        expect(chat).not.toHaveTextContent(snapshot.activity);
        expect(store.getState().textTurns[0].workflow?.activity).toBe(snapshot.activity);
        fireEvent.change(input, { target: { value: 'Use weekly prices.' } });
        expect(screen.getByRole('button', { name: 'Send to workflow' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Pause workflow' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/workflows/pause', expect.anything()));
        expect(input).toHaveValue('Use weekly prices.');
        await act(async () => { await publishWorkflowRun({ ...snapshot, status: 'paused',
            message: 'The source is unavailable. Please load the example dataset to continue.' }, 'session'); });
        expect(chat).toHaveTextContent('Interrupted');
        expect(screen.getByRole('button', { name: 'Continue workflow' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Close (switch focus)' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
        expect(chat).toHaveTextContent('The source is unavailable. Please load the example dataset to continue.');
        expect(chat.querySelector('[role="progressbar"]')).toBeNull();
    });

    it('loads the analysis log on demand for older saved workflow turns', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        snapshot.outputs = [];
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        vi.mocked(apiRequest).mockResolvedValueOnce({ data: { run: { ...snapshot,
            evidence: { observed: { tool: 'fetch_live_data', text: 'Fetched live prices' } },
        } } } as any);
        const { rerender } = render(<WorkflowProgress turn={{ ...turn, workflow: { ...turn.workflow!, log: undefined } }} />);
        expect(apiRequest).not.toHaveBeenCalled();
        rerender(<WorkflowProgress turn={{ ...turn, workflow: { ...turn.workflow!, log: undefined } }} canvas />);
        expect(await screen.findByText('Fetched live prices')).toBeTruthy();
        expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('does not present visited steps as verified in either view', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.status = 'completed';
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        expect(turn.workflow!.steps.map(step => step.status)).toEqual(['passed', 'visited']);
        const { container, rerender } = render(<WorkflowProgress turn={turn} />);
        for (const canvas of [false, true]) {
            rerender(<WorkflowProgress turn={turn} canvas={canvas} />);
            const visited = container.querySelector('[data-workflow-step="analyze"]')!;
            const passed = container.querySelector('[data-workflow-step="gather"]')!;
            expect(visited).toHaveTextContent('visited');
            expect(within(visited as HTMLElement).queryByText(/^(analyze · )?passed$/)).toBeNull();
            expect(passed).toHaveTextContent('passed');
        }
    });

    it('shows the active passed step as reviewing until the run pauses or completes', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.instance!.steps![1].checkers = [{ id: 'accuracy' }];
        snapshot.checks!.accuracy = { status: 'passed', explanation: 'Verified calculations', evidence_ids: ['verified'] };
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        expect(turn.workflow!.steps.map(step => step.status)).toEqual(['passed', 'reviewing']);
        expect(turn.workflow!.checks!.every(check => check.status === 'passed')).toBe(true);
        const { container, rerender } = render(<WorkflowProgress turn={turn} />);
        expect(screen.getByText('analyze · reviewing')).toBeTruthy();
        expect(screen.getByRole('progressbar', { name: 'Current step running' })).toBeTruthy();
        expect(screen.getAllByRole('progressbar')).toHaveLength(1);
        expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
        expect(container.querySelector('[data-workflow-step="analyze"]')).toHaveAttribute('aria-busy', 'true');
        rerender(<WorkflowProgress turn={turn} canvas />);
        const analyze = container.querySelector('[data-workflow-step="analyze"]')!;
        expect(analyze).toHaveAttribute('aria-busy', 'true');
        expect(within(analyze as HTMLElement).getByRole('heading', { name: 'analyze' })).toBeVisible();
        expect(analyze.textContent).toContain('reviewing');
        expect(analyze.querySelector('[role="progressbar"]')).toBeTruthy();
        expect(screen.getAllByRole('progressbar')).toHaveLength(1);
        for (const status of ['paused', 'completed']) {
            await act(async () => { await publishWorkflowRun({ ...snapshot, status }, 'session'); });
            const updated = store.getState().textTurns.find(item => item.id === turn.id)!;
            expect(updated.workflow!.steps.map(step => step.status)).toEqual(['passed', 'passed']);
            rerender(<WorkflowProgress turn={updated} canvas />);
            expect(container.querySelector('[aria-busy="true"]')).toBeNull();
            expect(screen.queryByRole('progressbar')).toBeNull();
        }
    });

    it('shows recorded action and check time for passed and visited steps in both views', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.step_elapsed_seconds = { gather: 72.2, analyze: 9.1 };
        await publishWorkflowRun(snapshot, 'session');
        const { container, rerender } = render(<WorkflowProgress turn={store.getState().textTurns[0]} />);
        expect(container.querySelector('[data-workflow-step="gather"]')).toHaveTextContent('gather · passed · 1m 13s');
        await publishWorkflowRun({ ...snapshot, checks: {} }, 'session');
        rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        expect(container.querySelector('[data-workflow-step="gather"]')).toHaveTextContent('visited · 1m 13s');
        expect(container.querySelector('[data-workflow-step="analyze"]')).toHaveTextContent('current · 10s');
    });

    it.each([false, true])('ticks active step time between checkpoints and stops when paused (canvas=%s)', async canvas => {
        const snapshot = { ...run(), outputs: [], activity: 'Inspect source data.', step_elapsed_seconds: { gather: 72, analyze: 10 },
            active_tool: { id: 'visualizing', tool: 'visualize', step_id: 'analyze',
                details: { title: 'Weekly prices', chart_type: 'Line Chart', inputs: 'Prices' } } };
        await publishWorkflowRun(snapshot, 'session');
        vi.useFakeTimers();
        const { container, rerender, unmount } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas={canvas} />);
        try {
            const activeStep = () => container.querySelector('[data-workflow-step="analyze"]')!;
            expect(activeStep()).toHaveTextContent('current · 10s');
            act(() => vi.advanceTimersByTime(3000));
            expect(activeStep()).toHaveTextContent('current · 13s');
            expect(container.querySelector('[data-workflow-step="gather"]')).toHaveTextContent('1m 12s');
            const action = container.querySelector('[data-workflow-current-action]')!;
            expect(action).toHaveTextContent('Inspect source data.');
            expect(action.previousElementSibling).toHaveTextContent('3 tool calls');
            expect(action.previousElementSibling).not.toHaveTextContent('Inspect source data.');
            if (canvas) {
                expect(activeStep().querySelector('[data-workflow-running-tool]')).toHaveTextContent('Weekly prices');
                expect(activeStep().querySelector('[data-workflow-running-tool]')).toHaveTextContent('Line Chart');
                expect(activeStep().querySelector('[data-workflow-running-tool]')).toHaveTextContent('Prices');
                expect(container.querySelector('[data-workflow-step="gather"] [data-workflow-running-tool]')).toBeNull();
            } else expect(action).toHaveTextContent('Weekly prices');
            await act(async () => { await publishWorkflowRun({ ...snapshot, step_elapsed_seconds: { gather: 72, analyze: 20 } }, 'session'); });
            rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas={canvas} />);
            expect(activeStep()).toHaveTextContent('current · 20s');
            act(() => vi.advanceTimersByTime(2000));
            expect(activeStep()).toHaveTextContent('current · 22s');
            await act(async () => { await publishWorkflowRun({ ...snapshot, status: 'paused', step_elapsed_seconds: { gather: 72, analyze: 22 } }, 'session'); });
            rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas={canvas} />);
            act(() => vi.advanceTimersByTime(5000));
            expect(activeStep()).toHaveTextContent('current · 22s');
            expect(container.querySelector('[data-workflow-current-action]')).toBeNull();
            expect(container.querySelector('[data-workflow-running-tool]')).toBeNull();
        } finally {
            unmount();
            vi.useRealTimers();
        }
    });

    it('resets step progress to pending when the revised plan needs review', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.instance!.steps!.splice(1, 0, { id: 'prepare', instructions: 'Prepare the comparison' });
        snapshot.instance!.steps!.push({ id: 'report', instructions: 'Write the report' });
        snapshot.visited = ['gather', 'prepare', 'analyze'];
        await publishWorkflowRun(snapshot, 'session');
        const { container, rerender } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        const gather = container.querySelector('[data-workflow-step="gather"]')!;
        const prepare = container.querySelector('[data-workflow-step="prepare"]')!;
        const analyze = container.querySelector('[data-workflow-step="analyze"]')!;
        const report = container.querySelector('[data-workflow-step="report"]')!;
        expect(within(gather as HTMLElement).getByText('passed')).toBeVisible();
        expect(within(prepare as HTMLElement).getByText('visited')).toBeVisible();
        expect(within(analyze as HTMLElement).getByText('current')).toBeVisible();
        expect(within(report as HTMLElement).getByText('pending')).toBeVisible();
        await publishWorkflowRun({ ...snapshot, plan_review_pending: true }, 'session');
        rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        for (const step of [gather, prepare, analyze, report]) {
            expect(within(step as HTMLElement).getByText('pending')).toBeVisible();
        }
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('groups calls and checks by step and reveals their evidence on demand', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        snapshot.outputs = [];
        snapshot.message = 'Final verified response';
        snapshot.instance!.steps![0].checkers = [{ id: 'coverage', condition: 'Requested dates and regions are covered.', when: 'before', on_fail: 'gather' }];
        snapshot.instance!.steps![0].description = 'Collect comparable observations for the requested regions.';
        snapshot.instance!.steps![1].checkers = [{ id: 'accuracy', condition: 'Totals reconcile to the source data.' }];
        snapshot.evidence = {
            gathered: { tool: 'fetch_live_data', text: JSON.stringify({ rows: 61, metadata: { source: 'live' } }), call: 1, step_id: 'gather' },
            analyzed: { tool: 'execute_python_script', text: 'Returns reconciled', call: 2, step_id: 'analyze' },
            legacy: { tool: 'read_workspace_item', text: 'Older result without step metadata', call: 0 },
        };
        await publishWorkflowRun(snapshot, 'session');
        const { container } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        const gather = container.querySelector('[data-workflow-step="gather"]')!;
        const analyze = container.querySelector('[data-workflow-step="analyze"]')!;
        expect(screen.getByRole('list', { name: 'Workflow plan timeline' }).children).toHaveLength(2);
        expect(screen.getByText('Collect data')).not.toBeVisible();
        expect(screen.getByText('Collect comparable observations for the requested regions.')).toBeVisible();
        const actionPreview = screen.getByText('Collect data');
        fireEvent.click(gather.querySelector('[data-workflow-action] > summary')!);
        expect(actionPreview).toBeVisible();
        expect(screen.getByText('Requested dates and regions are covered.')).not.toBeVisible();
        expect(screen.getByText('Totals reconcile to the source data.')).not.toBeVisible();
        fireEvent.click(gather.querySelector('[data-workflow-checks] > summary')!);
        expect(screen.getByText('Requested dates and regions are covered.')).toBeVisible();
        expect(screen.getByRole('region', { name: 'gather action' })).toHaveTextContent('Collect data');
        expect(screen.getByRole('region', { name: 'gather action' })).not.toHaveTextContent('Requested dates');
        expect(screen.getByRole('region', { name: 'gather checks' })).toHaveTextContent('Requested dates and regions are covered.');
        expect(screen.getByRole('region', { name: 'gather checks' })).not.toHaveTextContent('Collect data');
        expect(screen.getByLabelText('accuracy: pending')).not.toBeVisible();
        expect(screen.getByText('Before this step · On failure: gather')).not.toBeVisible();
        expect(screen.getByText('Observed rows')).not.toBeVisible();
        expect(screen.getByText('Returns reconciled')).not.toBeVisible();
        expect(gather.querySelector('[data-workflow-call="gathered"]')).toBeTruthy();
        expect(gather.textContent).toContain('Observed rows');
        expect(gather.textContent).not.toContain('Returns reconciled');
        expect(analyze.querySelector('[data-workflow-call="analyzed"]')).toBeTruthy();
        expect(screen.getByText('Unassigned calls (1)').closest('details')!.textContent).toContain('Older result without step metadata');
        fireEvent.click(within(gather as HTMLElement).getByText('Call 1: fetch live data'));
        expect(within(gather as HTMLElement).getByText('61')).toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByText('Raw JSON'));
        expect(JSON.parse(within(gather as HTMLElement).getByText(/"source": "live"/).textContent!)).toEqual({ rows: 61, metadata: { source: 'live' } });
        expect(screen.getByText('Observed rows')).not.toBeVisible();
        fireEvent.click(gather.querySelector('[data-workflow-check="coverage"] summary')!);
        expect(screen.getByText('Observed rows')).toBeVisible();
        expect(screen.getByText('Before this step · On failure: gather')).toBeVisible();
        expect(screen.getByText('Collect data')).toBeVisible();
        expect(container.textContent!.indexOf('Final verified response')).toBeGreaterThan(container.textContent!.indexOf('Unassigned calls'));
    });

    it('groups imported data, charts, files, and reports under their producing steps and opens native artifacts', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        snapshot.outputs = snapshot.outputs!.map(output => ({ ...output,
            step_id: output.type === 'tool_result' ? 'gather' : 'analyze', plan_revision: 0 }));
        await publishWorkflowRun(snapshot, 'session');
        const { container } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        const gather = container.querySelector('[data-workflow-step="gather"]')!;
        const analyze = container.querySelector('[data-workflow-step="analyze"]')!;
        expect(gather.querySelector('[data-workflow-artifact="workflow-data-native-measurements"]')).toBeTruthy();
        expect(gather.querySelector('[data-workflow-artifact="file-notes.txt"]')).toBeTruthy();
        expect(analyze.querySelector('[data-workflow-artifact="chart_values"]')).toBeTruthy();
        expect(analyze.querySelector('[data-workflow-artifact="workflow-report-native"]')).toBeTruthy();
        expect(gather.querySelector('[data-workflow-artifact="chart_values"]')).toBeNull();
        expect(screen.getByText('1 rows · 1 columns')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Open Values by category' }));
        expect(store.getState().focusedId).toEqual({ type: 'chart', chartId: 'chart-native' });
        fireEvent.click(gather.querySelector('[data-workflow-artifact="workflow-data-native-measurements"]')!);
        expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'workflow-data-native-measurements' });
        fireEvent.click(screen.getByRole('button', { name: 'Open notes.txt' }));
        expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'file-notes.txt' });
        fireEvent.click(screen.getByRole('button', { name: 'Open Native review' }));
        expect(store.getState().focusedId).toEqual({ type: 'report', reportId: 'workflow-report-native' });
    });

    it('restores checker definitions for older saved turns without republishing outputs', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        snapshot.outputs = [];
        snapshot.instance!.steps![0].checkers = [{ id: 'coverage', condition: 'All requested regions have observations.' }];
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        vi.mocked(apiRequest).mockResolvedValueOnce({ data: { run: snapshot } } as any);
        render(<WorkflowProgress turn={{ ...turn, workflow: { ...turn.workflow!,
            steps: turn.workflow!.steps.map(step => ({ ...step, checkers: undefined })),
        } }} canvas />);
        expect(await screen.findByText('All requested regions have observations.')).not.toBeVisible();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(store.getState().textTurns[0]).toEqual(turn);
    });

    it('includes the report once as an ordered conversation node rather than a turn attachment', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        await publishWorkflowRun(snapshot, 'session');
        const state = store.getState();
        const nodes = getThreadConversationIds('chart_values', dfSelectors.getAllTables(state), state.textTurns,
            state.loadedTableNodes, state.fileNodes, state.generatedReports);
        expect(nodes.indexOf('chart_values')).toBeLessThan(nodes.indexOf('workflow-report-native'));
        expect(nodes.filter(id => id === 'workflow-report-native')).toHaveLength(1);
        render(<Provider store={store}><ConversationCanvas textTurnId="chart_values" nodeIds={nodes} /></Provider>);
        const report = screen.getAllByRole('button', { name: 'Native review' });
        expect(report).toHaveLength(1);
        fireEvent.click(report[0]);
        expect(store.getState().focusedId).toEqual({ type: 'report', reportId: 'workflow-report-native' });
    });

    it('uses authored output order without special placement rules for reports', () => {
        const items = [{ key: 'prompt' }, { key: 'chart', outputNodeId: 'table' },
            { key: 'report', outputNodeId: 'report' }, { key: 'completion' }];
        const turn = { outputIds: ['report', 'table'] } as any;
        expect(orderThreadOutputs(items, [turn]).map(item => item.key)).toEqual(['prompt', 'report', 'chart', 'completion']);
        expect(orderThreadOutputs(items, [{ outputIds: ['table', 'report'] } as any])).toEqual(items);
        expect(orderThreadOutputs(items, [{} as any])).toEqual(items);
    });

    it('restores older workflow output order without republishing artifacts or changing focus', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        await publishWorkflowRun(snapshot, 'session');
        const before = store.getState();
        const turn = before.textTurns[0];
        store.dispatch(dfActions.updateTextTurn({ id: turn.id, outputIds: undefined }));
        vi.mocked(apiRequest).mockClear();
        vi.mocked(apiRequest).mockResolvedValueOnce({ data: { run: snapshot } } as any);
        const { rerender } = render(<WorkflowProgress turn={{ ...turn, outputIds: undefined }} />);
        expect(apiRequest).not.toHaveBeenCalled();
        rerender(<WorkflowProgress turn={{ ...turn, outputIds: undefined }} canvas />);
        await waitFor(() => expect(store.getState().textTurns[0].outputIds).toEqual(turn.outputIds));
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(store.getState().focusedId).toEqual(before.focusedId);
        expect(store.getState().generatedReports).toEqual(before.generatedReports);
        expect(store.getState().inputTables).toEqual(before.inputTables);
    });

    it('keeps completed saved workflows usable when their backend history is missing', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        await publishWorkflowRun(snapshot, 'session');
        const before = store.getState();
        const turn = { ...before.textTurns[0], outputIds: undefined };
        vi.mocked(apiRequest).mockClear();
        vi.mocked(apiRequest).mockRejectedValue(new Error('Workflow run not found in this session.'));
        const { rerender } = render(<WorkflowProgress turn={turn} />);
        expect(apiRequest).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
        rerender(<WorkflowProgress turn={turn} canvas />);
        expect(await screen.findByText(/Additional run history is unavailable/)).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText(/Error: Workflow run not found/)).toBeNull();
        expect(apiRequest).toHaveBeenCalledTimes(1);
        rerender(<WorkflowProgress turn={turn} />);
        expect(screen.queryByText(/Additional run history is unavailable/)).toBeNull();
        expect(store.getState().generatedReports).toEqual(before.generatedReports);
        expect(store.getState().textTurns[0].workflow?.status).toBe('completed');
    });

    it('deletes a completed workflow node while preserving its generated artifacts', async () => {
        const snapshot = { ...run(), id: 'delete-completed', status: 'completed' };
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id }));
        vi.mocked(apiRequest).mockClear();
        render(<WorkflowProgress turn={turn} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete workflow node' }));
        expect(store.getState().textTurns.some(item => item.id === turn.id)).toBe(false);
        const state = store.getState();
        expect(state.inputTables).toHaveLength(1);
        expect(state.derivedTables).toHaveLength(1);
        expect(state.generatedReports).toHaveLength(1);
        expect(state.fileNodes).toHaveLength(1);
        expect([state.loadedTableNodes[0], state.fileNodes[0], state.derivedTables[0], state.generatedReports[0]]
            .map(artifact => artifact.parentNodeId)).toEqual([turn.parentNodeId, 'workflow-data-delete-completed-measurements', 'file-notes.txt', 'chart_values']);
        expect(apiRequest).not.toHaveBeenCalled();
        await publishWorkflowRun(snapshot, 'session');
        expect(store.getState().textTurns.some(item => item.id === turn.id)).toBe(false);
    });

    it('confirms the filename before deleting a saved workflow and preserves same-titled instances', async () => {
        const items = [{ path: 'old.yaml', name: 'Review' }, { path: 'native.yaml', name: 'Review' }];
        vi.mocked(apiRequest).mockImplementation(async (url) => ({ data: url === '/api/workflows/list'
            ? { items, runs: [] } : { path: 'old.yaml' } }) as any);
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete old.yaml' }));
        expect(screen.getByRole('dialog').textContent).toContain('old.yaml');
        expect(apiRequest).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Delete old.yaml' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.queryByRole('button', { name: 'Delete old.yaml' })).toBeNull();
        expect(apiRequest).toHaveBeenCalledWith('/api/workflows/delete', expect.objectContaining({ body: JSON.stringify({ path: 'old.yaml' }) }));
        expect(screen.getByRole('button', { name: 'Delete native.yaml' })).toBeTruthy();
    });

    it('keeps a saved workflow when deletion fails', async () => {
        vi.mocked(apiRequest).mockResolvedValueOnce({ data: { items: [{ path: 'old.yaml', name: 'Review' }], runs: [] } } as any)
            .mockRejectedValueOnce(new Error('Deletion failed'));
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete old.yaml' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(store.getState().messages.some(message => message.value === 'Deletion failed')).toBe(true));
        expect(screen.getByRole('dialog').textContent).not.toContain('Deletion failed');
        expect(screen.getByRole('button', { name: 'Delete old.yaml', hidden: true })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled();
    });

    it('pauses a running workflow before deleting its node and ignores late updates', async () => {
        const snapshot = { ...run(), id: 'delete-running', outputs: [] };
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        vi.mocked(apiRequest).mockResolvedValue({ data: { run: { ...snapshot, status: 'paused' } } } as any);
        render(<WorkflowProgress turn={turn} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete workflow node' }));
        await waitFor(() => expect(store.getState().textTurns.some(item => item.id === turn.id)).toBe(false));
        expect(apiRequest).toHaveBeenCalledWith('/api/workflows/pause', expect.objectContaining({ body: JSON.stringify({ run_id: snapshot.id }) }));
        await publishWorkflowRun({ ...snapshot, status: 'completed' }, 'session');
        expect(store.getState().textTurns).toHaveLength(0);
    });
});