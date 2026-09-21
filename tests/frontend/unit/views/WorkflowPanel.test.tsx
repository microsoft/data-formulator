import React from 'react';
import { EditorView } from '@uiw/react-codemirror';
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

    it('publishes the workflow name instead of an internal turn ID', async () => {
        await publishWorkflowRun({ ...run(), outputs: [] }, 'session');
        expect(store.getState().textTurns.find(turn => turn.workflow?.runId === 'native')?.displayId).toBe('Native review');
    });

    it('keeps a published derived table out of the workspace source shelf', () => {
        const source = { kind: 'table' as const, id: 'aircraft', displayId: 'Aircraft Incidents',
            names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'aircraft', rowCount: 0 } };
        const result = { ...source, id: 'incident-records', displayId: 'Aircraft Incident Records',
            virtual: { tableId: 'incident-records', rowCount: 0 } };
        store.dispatch(dfActions.addTableToStore(source));
        store.dispatch(dfActions.addTableToStore(result));
        store.dispatch(dfActions.addTableToStore({ ...result, derive: {
            source: [source.id], code: 'result = aircraft', outputVariable: 'result', dialog: [],
            trigger: { tableId: source.id, resultTableId: result.id, instruction: 'Prepare incident records',
                sourceTableIds: [source.id], chart: undefined, intermediate: false },
        } } as any));
        const { container } = renderThread();
        expect(dfSelectors.getInputTables(store.getState()).map(table => table.id)).toEqual([source.id]);
        expect(dfSelectors.getAllTables(store.getState()).filter(table => table.id === result.id)).toHaveLength(1);
        expect(within(container.querySelector('[data-thread-shelf]')!).queryByText(result.displayId)).not.toBeInTheDocument();
        expect(screen.getAllByText(result.displayId)).toHaveLength(1);
    });

    it.each([false, true])('distinguishes dedicated loading from visualization-time loading (dedicated: %s)', dedicated => {
        const rootId = 'conversation-root:aircraft';
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'incidents', displayId: 'Incident Records',
            names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'incidents', rowCount: 0 } }));
        if (dedicated) store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'load-summary', displayId: 'Data loaded',
            textKind: 'explain', prompt: 'Load incident data', content: 'Incident data is ready.',
            parentNodeId: rootId, createdAt: 1 }));
        const parentNodeId = dedicated ? 'load-summary' : rootId;
        store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-incidents', tableId: 'incidents',
            parentNodeId, createdAt: 1 }));
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'phase-counts', displayId: 'Incidents by Flight Phase',
            names: [], rows: [], metadata: {}, description: '', parentNodeId, derive: {
                source: ['incidents'], code: 'result = incidents', outputVariable: 'result', dialog: [],
                trigger: { tableId: rootId, resultTableId: 'phase-counts', chart: undefined, interaction: [
                    { from: 'user', to: 'data-agent', role: 'prompt', content: 'Compare incidents by flight phase', timestamp: 2 },
                    { from: 'data-agent', to: 'datarec-agent', role: 'instruction', content: 'Count incidents by phase', timestamp: 3 },
                ] },
            } } as any));
        const { container } = renderThread();
        expect(screen.getAllByRole('button', { name: 'view chat' })).toHaveLength(1);
        expect(container.querySelectorAll('[data-thread-item="loaded-incidents"]')).toHaveLength(1);
        if (dedicated) {
            const output = container.querySelector<HTMLElement>('[data-thread-item="loaded-incidents"]')!;
            const artifact = within(output).getByRole('button', { name: 'Incident Records' });
            expect(artifact.closest('.data-thread-card')).toBeInTheDocument();
            expect(screen.queryByText('Loaded: Incident Records')).not.toBeInTheDocument();
            fireEvent.click(artifact);
            expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'loaded-incidents' });
            expect(artifact.closest('.selected-artifact-card')).toBeInTheDocument();
        } else {
            const loadedReference = screen.getByText('Loaded: Incident Records');
            expect(screen.getByText('Count incidents by phase').closest('[data-thread-item]')).toContainElement(loadedReference);
            expect(loadedReference.closest('button, .data-thread-card')).toBeNull();
            expect(loadedReference).toHaveStyle({ color: 'rgba(0, 0, 0, 0.6)' });
            expect(screen.getAllByText('Incident Records', { exact: true })).toHaveLength(1);
        }
        expect(screen.getByText('Compare incidents by flight phase')).toBeInTheDocument();
        expect(screen.getByText('Incidents by Flight Phase')).toBeInTheDocument();
    });

    it('uses a compact selected conversation button and transparent timeline icon backgrounds', () => {
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'loaded-data', displayId: 'Loaded Data',
            names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'loaded-data', rowCount: 0 } }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-loaded', displayId: 'Loaded',
            textKind: 'explain', prompt: 'Load data', content: 'The data is ready.',
            parentNodeId: 'conversation-root:loaded', createdAt: 3 }));
        store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-reference', tableId: 'loaded-data',
            parentNodeId: 'textTurn-loaded', createdAt: 2 }));
        const { container } = renderThread();
        const button = screen.getByRole('button', { name: 'view chat' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(button).toHaveStyle({ minHeight: '24px', marginLeft: 'auto', textTransform: 'none', color: 'rgba(0, 0, 0, 0.87)' });
        expect(button).toHaveTextContent('view chat');
        expect(button).toHaveAttribute('title', 'Open full conversation');
        expect(within(button).getByTestId('ArrowForwardIcon')).toBeInTheDocument();
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-pressed', 'true');
        fireEvent.mouseOver(button);
        expect(getComputedStyle(button).backgroundColor).toBe('rgba(0, 0, 0, 0.1)');
        const thread = container.querySelector('[data-thread-active="true"]')!;
        expect(thread).toBeInTheDocument();
        for (const key of ['loaded-reference', 'textturn-textTurn-loaded']) {
            const gutter = thread.querySelector(`[data-thread-item="${key}"]`)!.firstElementChild!;
            const icon = gutter.querySelector('svg')!;
            expect(icon.parentElement).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0)' });
            expect(icon).toHaveStyle({ color: 'rgba(0, 0, 0, 0.15)' });
        }
        act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: 'textTurn-loaded' })));
        const responseGutter = container.querySelector('[data-thread-item="textturn-textTurn-loaded"]')!.firstElementChild!;
        expect(responseGutter.querySelector('svg')).toHaveStyle({ color: 'rgb(25, 118, 210)' });
    });

    it('shows loaded data before ongoing thinking and keeps it before the final summary', () => {
        const rootId = 'conversation-root:live-load';
        store.dispatch(dfActions.createDraftNode({ id: 'loading-draft', displayId: 'Load data',
            parentNodeId: rootId, parentTableId: rootId, source: [], interaction: [
                { from: 'user', to: 'data-agent', role: 'prompt', content: 'Load consumer price data', timestamp: 1 },
            ] }));
        const { container } = renderThread();
        expect(container.querySelector('[data-thread-item="loaded-consumer-prices"]')).toBeNull();
        act(() => {
            store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'consumer_prices', displayId: 'Consumer Prices',
                names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'consumer_prices', rowCount: 0 } }));
            store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-consumer-prices',
                tableId: 'consumer_prices', parentNodeId: 'loading-draft', createdAt: 2 }));
        });
        const output = container.querySelector('[data-thread-item="loaded-consumer-prices"]')!;
        expect(output).toBeInTheDocument();
        expect(screen.getByText('Load consumer price data').compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const thinking = container.querySelector(`[data-thread-item="agent-thinking-${rootId}"]`)!;
        expect(thinking).toBeInTheDocument();
        expect(output.compareDocumentPosition(thinking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'load-summary', displayId: 'Summary',
                textKind: 'explain', prompt: 'Load consumer price data', content: 'Loaded consumer prices.',
                parentNodeId: rootId, createdAt: 3 }));
            store.dispatch(dfActions.removeDraftNode({ draftId: 'loading-draft', fileParentNodeId: 'load-summary' }));
        });
        expect(container.querySelectorAll('[data-thread-item="loaded-consumer-prices"]')).toHaveLength(1);
        expect(container.querySelector(`[data-thread-item="agent-thinking-${rootId}"]`)).toBeNull();
        const completedOutput = container.querySelector('[data-thread-item="loaded-consumer-prices"]')!;
        const summary = container.querySelector('[data-thread-item="textturn-load-summary"]')!;
        expect(completedOutput.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        act(() => {
            store.dispatch(dfActions.updateTextTurn({ id: 'load-summary', answered: true, answer: 'Show overall trends' }));
            store.dispatch(dfActions.createDraftNode({ id: 'trend-draft', displayId: 'Trends',
                parentNodeId: 'load-summary', parentTableId: rootId, source: ['consumer_prices'], interaction: [] }));
        });
        const followup = screen.getByText('Show overall trends');
        expect(followup).toBeVisible();
        expect(summary.compareDocumentPosition(followup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const followupThinking = container.querySelector(`[data-thread-item="agent-running-${rootId}"]`)!;
        expect(followupThinking).toBeInTheDocument();
        expect(followup.compareDocumentPosition(followupThinking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'trend-summary', displayId: 'Trends',
                textKind: 'explain', content: 'Prices have increased.', parentNodeId: 'load-summary', createdAt: 5 }));
            store.dispatch(dfActions.removeDraftNode({ draftId: 'trend-draft', fileParentNodeId: 'trend-summary' }));
        });
        expect(screen.getAllByText('Show overall trends')).toHaveLength(1);
        expect(followup.compareDocumentPosition(container.querySelector('[data-thread-item="textturn-trend-summary"]')!)
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it.each([true, false])('orders loaded data before its summary but after earlier remarks (summary: %s)', summary => {
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'consumer_prices', displayId: 'Consumer Prices',
            names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'consumer_prices', rowCount: 0 } }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-load', displayId: 'Load data',
            textKind: 'explain', prompt: 'Load consumer price data', content: summary ? 'Loaded consumer prices.' : 'Preparing the import.',
            parentNodeId: 'conversation-root:load', createdAt: summary ? 3 : 1 }));
        store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-consumer-prices',
            tableId: 'consumer_prices', parentNodeId: 'textTurn-load', createdAt: 2 }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-followup', displayId: 'Follow-up',
            textKind: 'explain', content: 'A later analysis.', parentNodeId: 'consumer_prices', createdAt: 4 }));
        const { container } = renderThread();
        const rows = Array.from(container.querySelectorAll('[data-thread-item]')).map(element => element.getAttribute('data-thread-item'));
        const outputIndex = rows.indexOf('loaded-consumer-prices');
        const responseIndex = rows.indexOf('textturn-textTurn-load');
        expect(outputIndex).toBeGreaterThanOrEqual(0);
        expect(responseIndex).toBeGreaterThanOrEqual(0);
        expect(outputIndex < responseIndex).toBe(summary);
        expect(rows.indexOf('textturn-textTurn-followup')).toBeGreaterThan(Math.max(outputIndex, responseIndex));
        const prompt = screen.getByText('Load consumer price data');
        const output = container.querySelector('[data-thread-item="loaded-consumer-prices"]')!;
        expect(prompt.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it.each([true, false])('sends composer messages to the workflow without pausing or starting an analyst (focused: %s)', async focused => {
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
        expect(selectChatWorkflow(store.getState())).toBeUndefined();
        expect(screen.queryByPlaceholderText('Message workflow...')).toBeNull();
        if (focused) act(() => store.dispatch(dfActions.setFocused({ type: 'text', textId: turn.id })));
        else fireEvent.click(screen.getByRole('button', { name: 'Message workflow agent' }));
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

    it.each(['running', 'paused'])('routes selected %s workflow outputs and stops routing after completion', async status => {
        const snapshot = run();
        snapshot.status = status;
        await publishWorkflowRun(snapshot, 'session');
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'other-running-workflow', displayId: 'Other run',
            textKind: 'explain', content: '', parentNodeId: 'conversation-root:other', createdAt: 2,
            workflow: { runId: 'other', status: 'running', stepId: 'analyze', calls: 1, steps: [], outputVersions: {} } }));
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
            const buttons = screen.getAllByRole('button', { name: 'view chat' });
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

    it('keeps a new analyst thread after older threads before and after completion', async () => {
        await publishWorkflowRun({ ...run(), status: 'completed' }, 'session');
        const startedAt = Date.now();
        store.dispatch(dfActions.createDraftNode({ id: 'new-draft', displayId: 'New question',
            parentNodeId: 'conversation-root:new-question', parentTableId: 'conversation-root:new-question',
            source: [], interaction: [{ from: 'user', to: 'data-agent', role: 'prompt',
                content: 'Compare recent days by hour', timestamp: startedAt }] }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'later-answer', displayId: 'Later answer',
            textKind: 'explain', prompt: 'A later request', content: 'A faster answer',
            parentNodeId: 'conversation-root:later-question', createdAt: startedAt + 10 }));
        let view = renderThread();
        const expectThreadOrder = () => {
            const content = view.container.textContent!;
            expect(content.indexOf('Run workflow: Native review')).toBeGreaterThan(-1);
            expect(content.indexOf('Compare recent days by hour')).toBeGreaterThan(content.indexOf('Run workflow: Native review'));
            expect(content.indexOf('A later request')).toBeGreaterThan(content.indexOf('Compare recent days by hour'));
            expect(screen.getAllByText(/^thread\s*-\s*\d+$/i).map(heading => heading.textContent))
                .toEqual([1, 2, 3].map(index => expect.stringMatching(new RegExp(`^thread\\s*-\\s*${index}$`, 'i'))));
        };
        expectThreadOrder();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'new-answer', displayId: 'New answer',
                textKind: 'explain', prompt: 'Compare recent days by hour', content: 'The summary only covers 2011.',
                parentNodeId: 'conversation-root:new-question', createdAt: startedAt + 20 }));
            store.dispatch(dfActions.removeDraftNode('new-draft'));
        });
        expectThreadOrder();
        expect(store.getState().textTurns.find(turn => turn.id === 'new-answer')?.startedAt).toBe(startedAt);
        view.unmount();
        store.dispatch(dfActions.loadState(store.getState()));
        view = renderThread();
        expectThreadOrder();
        view.unmount();
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

    it('shows a workflow definition as a selected named artifact instead of a response card', () => {
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'trips', displayId: 'Trips', names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'trips', rowCount: 0 } }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'definition', displayId: 'Definition', textKind: 'explain',
            prompt: 'Create a daily workflow', content: 'Proposed a daily trip workflow.', parentNodeId: 'trips', createdAt: 1,
            workflowDefinition: { content: 'version: 1', definition: {
                name: 'Daily Trip Trend Comparison', overview: 'Compare daily trips', deliverables: ['Hourly chart'],
            } } }));
        store.dispatch(dfActions.upsertFileNode({ kind: 'file', id: 'old-notes', path: 'files/notes.md', displayName: 'Notes', contentHash: 'notes-hash', parentNodeId: 'definition', createdAt: 2 }));
        renderThread();
        const artifact = screen.getByRole('button', { name: 'Daily Trip Trend Comparison Workflow definition' });
        expect(artifact.closest('.data-thread-card')).toBeInTheDocument();
        expect(screen.getByText('Workflow definition')).toBeInTheDocument();
        expect(screen.queryByText('Proposed a daily trip workflow.')).not.toBeInTheDocument();
        fireEvent.click(artifact);
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'definition' });
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: 'definition' });
        expect(artifact.closest('.selected-artifact-card')).toBeInTheDocument();
    });

    it.each([true, false])('saves and runs a main-chat workflow proposal independently (save first: %s)', async saveFirst => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const definition = { name: 'Quarterly review', overview: 'Review current sales', deliverables: ['Sales report'],
            parameters: [{ name: 'period', label: 'Period', default: 'Q1' }] };
        const proposal = { definition,
            content: 'version: 1\nname: Quarterly review\noverview: Review current sales\ndeliverables: [Sales report]' };
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'proposal', displayId: 'Proposal', textKind: 'explain',
            prompt: 'Review sales', content: 'Ready to review.', workflowDefinition: proposal,
            parentNodeId: 'conversation-root:authoring', createdAt: 1 }));
        vi.mocked(apiRequest).mockImplementation(async (url, options) => {
            if (url === '/api/workflows/save') return { data: { path: JSON.parse(options!.body as string).path, content_hash: 'saved-hash' } } as any;
            if (url === '/api/workflows/read') return { data: { content_hash: 'saved-hash' } } as any;
            return { data: { items: [], runs: [], drafts: [] } } as any;
        });
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...run(), status: 'completed', outputs: [] } } as any;
        });
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'proposal' }));
        render(<Provider store={store}><VisualizationViewFC /></Provider>);
        expect(await screen.findByRole('region', { name: 'Workflow definition' })).toHaveTextContent('Sales report');
        const definitionPanel = screen.getByRole('region', { name: 'Workflow definition' });
        expect(definitionPanel).toHaveAttribute('id', 'vis-view-canvas');
        expect(definitionPanel.querySelector('[data-workflow-definition-content]')).toHaveStyle({ overflowY: 'auto', minHeight: '0' });
        expect(screen.getByRole('group', { name: 'Workflow actions' })).toHaveStyle({ flexShrink: '0' });
        expect(definitionPanel.querySelector('[data-workflow-definition-content]')).not.toContainElement(screen.getByRole('button', { name: 'Run workflow' }));
        expect(screen.queryByLabelText('Workflow filename')).not.toBeInTheDocument();
        expect(streamRequest).not.toHaveBeenCalled();
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/save', expect.anything());
        if (saveFirst) {
            fireEvent.click(screen.getByRole('button', { name: 'Save workflow' }));
            expect(await screen.findByRole('dialog', { name: 'Save workflow' })).toBeInTheDocument();
            expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/save', expect.anything());
            expect(screen.getByLabelText('Workflow name', { exact: false })).toHaveValue('Quarterly review');
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));
            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save workflow' })).not.toBeInTheDocument());
            const saved = JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/save')![1]!.body as string);
            expect(saved).toEqual({ path: 'quarterly-review.workflow.yaml', content: proposal.content });
            expect(streamRequest).not.toHaveBeenCalled();
        }
        fireEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
        expect(await screen.findByRole('dialog', { name: 'Workflow setup' })).toBeInTheDocument();
        expect(screen.getByLabelText('Period')).toHaveValue('Q1');
        expect(streamRequest).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string)).toMatchObject({
            content: proposal.content, setup: { parameters: { period: 'Q1' }, instructions: '' },
        });
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.workflow)?.workflow?.status).toBe('completed'));
    });

    it('formats definition sections and saves a renamed workflow without losing YAML fields', async () => {
        const proposal = { content: 'version: 1\nname: Daily trips\noverview: Compare trips\ndeliverables: [Chart]\nsource:\n  fixed_date: 2011-01-10\n',
            definition: { name: 'Daily trips', overview: 'Compare **daily trips**.', prompt: 'Compare hourly totals.',
                source: { table_name: 'Trips', filters: [{ pickup_date: '2011-01-10' }] }, deliverables: ['Hourly **chart**'],
                parameters: [{ name: 'period', label: 'Period', type: 'select' as const, required: true, default: 'Daily', options: ['Daily', 'Weekly'] }],
                steps: [{ id: 'compare', description: 'Aggregate hourly pickups', instructions: 'Aggregate trips by **hour**.',
                    checkers: [{ id: 'coverage', condition: 'Both days contain all 24 hours.', on_fail: 'compare' }] }] } };
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'formatted-definition', displayId: 'Definition', textKind: 'explain',
            content: 'Ready', workflowDefinition: proposal, parentNodeId: 'conversation-root:authoring', createdAt: 1 }));
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'formatted-definition' }));
        vi.mocked(apiRequest).mockResolvedValue({ data: { path: 'my-trips.workflow.yaml', content_hash: 'new-hash' } } as any);
        render(<Provider store={store}><VisualizationViewFC /></Provider>);
        for (const name of ['Guidelines and rules', 'Inputs', 'Parameters', 'Execution steps', 'Deliverables']) {
            expect(screen.getByRole('heading', { name })).toBeInTheDocument();
        }
        expect(screen.getByText('table name')).toBeInTheDocument();
        expect(screen.getByText('pickup date')).toBeInTheDocument();
        expect(screen.getByText('Default: Daily')).toBeInTheDocument();
        expect(screen.getByText('daily trips').tagName).toBe('STRONG');
        expect(screen.queryByRole('heading', { name: 'Suggested steps' })).not.toBeInTheDocument();
        expect(screen.getByText('Aggregate hourly pickups').closest('li')?.parentElement?.tagName).toBe('OL');
        expect(screen.getByText('hour').tagName).toBe('STRONG');
        expect(screen.getByText('After: Both days contain all 24 hours. (on failure: compare)')).toBeInTheDocument();
        expect(screen.queryByText(/0\/0 passed|No checks specified|tool calls/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'YAML' }));
        expect(screen.getByRole('tab', { name: 'YAML' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel')).toHaveTextContent('version: 1');
        expect(screen.getByRole('tabpanel').querySelector('.cm-content')).toHaveAttribute('contenteditable', 'false');
        expect(screen.queryByRole('heading', { name: 'Inputs' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save workflow' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Illustration' }));
        expect(screen.getByRole('heading', { name: 'Inputs' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save workflow' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/save', expect.anything());
        fireEvent.click(screen.getByRole('button', { name: 'Save workflow' }));
        fireEvent.change(screen.getByLabelText('Workflow name', { exact: false }), { target: { value: 'My daily trips' } });
        fireEvent.change(screen.getByLabelText('Workflow filename', { exact: false }), { target: { value: 'my-trips.workflow.yaml' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const saved = JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/save')![1]!.body as string);
        expect(saved.path).toBe('my-trips.workflow.yaml');
        expect(saved.content).toContain('name: My daily trips');
        expect(saved.content).toContain('fixed_date:');
        expect(screen.getByRole('heading', { name: 'My daily trips' })).toBeInTheDocument();
        expect(store.getState().textTurns.find(turn => turn.id === 'formatted-definition')?.workflowDefinition).toMatchObject({
            content: saved.content, definition: { name: 'My daily trips' }, saved: { content_hash: 'new-hash' },
        });
        expect(streamRequest).not.toHaveBeenCalled();
    });

    it('offers agent authoring from the create dialog without changing conversation focus', async () => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'context', displayId: 'Context', textKind: 'explain',
            content: 'Sales increased in Q2.', parentNodeId: 'conversation-root:sales', createdAt: 1 }));
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'context' }));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [], runs: [] } });
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Create a workflow' }));
        expect(store.getState().analystChatPending).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Create with agent' }));
        expect(store.getState().analystChatPending).toMatchObject({ intent: 'workflow-authoring', images: [], attachments: [] });
        expect(store.getState().analystChatPending?.text).toContain('current conversation and data');
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'context' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(streamRequest).not.toHaveBeenCalled();
        expect(apiRequest).not.toHaveBeenCalledWith('/api/workflows/author', expect.anything());
    });

    it('creates a session before queuing agent authoring when no session is active', async () => {
        store.dispatch(dfActions.setActiveWorkspace(null));
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [], runs: [] } });
        const createSession = vi.fn((displayName: string) => {
            expect(store.getState().analystChatPending).toBeNull();
            store.dispatch(dfActions.resetForNewWorkspace({ id: 'authoring-session', displayName }));
        });
        render(<Provider store={store}><WorkflowPanel onCreateSession={createSession} /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Create a workflow' }));
        expect(screen.getByRole('button', { name: 'Create with agent' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Create with agent' }));
        expect(createSession).toHaveBeenCalledExactlyOnceWith('Create a workflow');
        expect(store.getState().activeWorkspace?.id).toBe('authoring-session');
        expect(store.getState().analystChatPending).toMatchObject({ intent: 'workflow-authoring', images: [], attachments: [] });
        expect(store.getState().dataSourceSidebarOpen).toBe(false);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('saves pasted YAML without a model or an agent conversation', async () => {
        store.dispatch(dfActions.selectModel('no-selected-model'));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [], runs: [] } });
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Create a workflow' }));
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Create with agent' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Create with agent' }).parentElement)
            .toHaveAttribute('aria-label', 'Select a model to create a workflow with the agent.');
        expect(screen.getByRole('button', { name: 'Create with agent' }).closest('.MuiDialogActions-root'))
            .toContainElement(screen.getByRole('button', { name: 'Save' }));
        expect(screen.getByRole('button', { name: 'Disable line wrap' })).toBeInTheDocument();
        const content = 'version: 1\nname: Sales review\noverview: Review sales\ndeliverables: [Summary]';
        const editor = EditorView.findFromDOM(screen.getByLabelText('Edit workflow.yaml').querySelector('.cm-content')!)!;
        act(() => editor.dispatch({ changes: { from: 0, insert: content } }));
        fireEvent.change(screen.getByLabelText('Workflow filename'), { target: { value: 'sales.workflow.yaml' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/workflows/save', expect.anything()));
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/save')![1]!.body as string))
            .toEqual({ path: 'sales.workflow.yaml', content });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().analystChatPending).toBeNull();
        expect(streamRequest).not.toHaveBeenCalled();
    });

    it('lists server demos alongside user workflows and customizes a non-colliding copy', async () => {
        const demo = { path: 'demo/household-cost-review.yaml', name: 'Monthly Household Cost Review', origin: 'demo' };
        const user = { path: 'household-cost-review-copy.yaml', name: 'My cost review', origin: 'user' };
        const server = { path: 'server/shared.yaml', name: 'Shared review', origin: 'server' };
        vi.mocked(apiRequest).mockImplementation(async url => ({ data: url === '/api/workflows/read'
            ? { content: 'version: 1\nname: Monthly Household Cost Review', content_hash: 'original-hash' }
            : { items: [demo, user, server], runs: [] } }) as any);
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        await screen.findByRole('button', { name: `Customize ${demo.name}` });
        expect(screen.getByRole('region', { name: 'Other workflows' })).toHaveTextContent(demo.name);
        expect(screen.getByRole('region', { name: 'Other workflows' })).toHaveTextContent(server.name);
        expect(screen.getByRole('region', { name: 'My workflows' })).toHaveTextContent(user.name);
        expect(screen.getByRole('region', { name: 'My workflows' })).not.toHaveTextContent(demo.name);
        expect(screen.queryByText('Workspace workflows')).not.toBeInTheDocument();
        expect(screen.queryByText('Demo workflows')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Other workflows' }));
        expect(screen.getByRole('button', { name: 'Other workflows' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('button', { name: `Customize ${demo.name}` })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: `Edit ${user.name}` })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Other workflows' }));
        expect(screen.queryByRole('button', { name: `Delete ${demo.path}` })).toBeNull();
        expect(screen.getByRole('button', { name: `Delete ${user.path}` })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: `Customize ${demo.name}` }));
        expect(await screen.findByLabelText('Workflow filename')).toHaveValue('household-cost-review-copy-2.yaml');
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/read')![1]!.body as string)).toEqual({ path: demo.path });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/workflows/save', expect.anything()));
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/save')![1]!.body as string).path).toBe('household-cost-review-copy-2.yaml');
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/save')![1]!.body as string).content_hash).toBeUndefined();
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

    it('shows completed steps with checkmarks without marking them verified in either view', async () => {
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
            expect(visited).toHaveTextContent('completed');
            expect(within(visited as HTMLElement).getByTestId('CheckCircleOutlineIcon')).toBeInTheDocument();
            expect(within(visited as HTMLElement).queryByText(/^(analyze · )?passed$/)).toBeNull();
            expect(passed).toHaveTextContent('passed');
            rerender(<WorkflowProgress turn={{ ...turn, workflow: { ...turn.workflow!, status: 'paused' } }} canvas={canvas} />);
            const paused = container.querySelector('[data-workflow-step="analyze"]')!;
            expect(paused).toHaveTextContent('visited');
            expect(within(paused as HTMLElement).getByTestId('RadioButtonUncheckedIcon')).toBeInTheDocument();
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

    it('collapses pending step details, allows preview, and opens them when work starts', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.instance!.steps!.push({ id: 'report', description: 'Explain the findings', instructions: 'Write the final report.' });
        await publishWorkflowRun(snapshot, 'session');
        const { container, rerender } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        const report = within(container.querySelector('[data-workflow-step="report"]') as HTMLElement);
        expect(report.getByRole('heading', { name: 'Explain the findings' })).toBeVisible();
        expect(report.getByText('pending')).toBeVisible();
        expect(report.queryByRole('tablist')).not.toBeInTheDocument();
        expect(report.getByText('Write the final report.')).not.toBeVisible();
        fireEvent.click(report.getByRole('button', { name: 'Show details for report' }));
        expect(report.getByRole('tablist')).toBeVisible();
        expect(report.getByText('Write the final report.')).toBeVisible();
        fireEvent.click(report.getByRole('button', { name: 'Hide details for report' }));
        expect(report.queryByRole('tablist')).not.toBeInTheDocument();
        await publishWorkflowRun({ ...snapshot, step_id: 'report' }, 'session');
        rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        expect(report.getByRole('tablist')).toBeVisible();
        expect(report.getByText('Write the final report.')).toBeVisible();
        expect(report.queryByRole('button', { name: 'Show details for report' })).not.toBeInTheDocument();
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

    it.each(['running', 'paused', 'completed', 'reviewing'])('shows the workflow story without expanding details (%s)', async state => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.status = state === 'reviewing' ? 'running' : state;
        snapshot.plan_review_pending = state === 'reviewing';
        snapshot.message = state === 'paused' ? 'Choose which regions to include.' : 'Revenue increased in three regions.';
        snapshot.instance!.overview = 'Compare **regional revenue** on a consistent basis.';
        snapshot.instance!.prompt = 'Use matched reporting periods.';
        snapshot.instance!.deliverables = ['Regional comparison chart', 'Summary report'];
        snapshot.setup = { parameters: { period: 'Last quarter' }, instructions: 'Exclude incomplete months.' };
        snapshot.instance!.steps![0].description = 'Validate regional coverage';
        snapshot.instance!.steps![1].description = 'Compare regional revenue';
        snapshot.instance!.steps!.push({ id: 'report', description: 'Explain the differences', instructions: 'Write a report' });
        snapshot.step_progress = { gather: { status: 'completed', explanation: 'All four regions have matching periods.', evidence_ids: ['observed'] } };
        await publishWorkflowRun(snapshot, 'session');
        const { container } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        expect(screen.getByText('regional revenue')).toBeVisible();
        expect(container.querySelector('[data-workflow-scroll]')?.parentElement).toHaveStyle({
            '--df-text-md': '15px', '--df-text-sm': '15px', '--df-text-xs': '13px',
        });
        expect(screen.getByRole('heading', { level: 1, name: 'Native review' })).toHaveStyle({ fontSize: '24px' });
        expect(screen.getByText('Regional comparison chart')).not.toBeVisible();
        expect(screen.getByText('Summary report')).not.toBeVisible();
        const summary = screen.getByRole('region', { name: 'Workflow summary' });
        expect(container.textContent!.indexOf('Expected outputs')).toBeLessThan(container.textContent!.indexOf('Steps'));
        if (state === 'completed') {
            expect(within(summary).getByRole('heading', { name: 'Results' })).toBeVisible();
            expect(within(summary).getByText('Revenue increased in three regions.')).toBeVisible();
            expect(within(summary).queryByText('Planned next')).not.toBeInTheDocument();
        } else if (state === 'paused') {
            expect(within(summary).getByRole('heading', { name: 'Needs attention' })).toBeVisible();
            expect(within(summary).getByText('Choose which regions to include.')).toBeVisible();
        }
        expect(within(summary).queryByText(/^(Completed so far|Working on|Planned next|Reviewing the plan)$/)).not.toBeInTheDocument();
        expect(within(summary).getByText('Last quarter')).not.toBeVisible();
        fireEvent.click(within(summary).getByText('Scope and inputs'));
        expect(within(summary).getByText('Regional comparison chart')).toBeVisible();
        expect(within(summary).getByText('Summary report')).toBeVisible();
        expect(within(summary).getByText('Last quarter')).toBeVisible();
        expect(within(summary).getByText('Use matched reporting periods.')).toBeVisible();
        expect(within(summary).getByText('Exclude incomplete months.')).toBeVisible();
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
        expect(screen.getByText('Collect data')).toBeVisible();
        expect(screen.getByText('Collect comparable observations for the requested regions.')).toBeVisible();
        const actionPreview = screen.getByText('Collect data');
        expect(within(gather as HTMLElement).getByRole('tab', { name: 'Action' })).toHaveAttribute('aria-selected', 'true');
        expect(actionPreview).toBeVisible();
        expect(screen.getByText('Requested dates and regions are covered.')).not.toBeVisible();
        expect(screen.getByText('Totals reconcile to the source data.')).not.toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByRole('tab', { name: 'Checks (1/1)' }));
        expect(screen.getByText('Requested dates and regions are covered.')).toBeVisible();
        expect(actionPreview).not.toBeVisible();
        expect(within(gather as HTMLElement).getAllByRole('tabpanel')).toHaveLength(1);
        expect(within(gather as HTMLElement).getByRole('tabpanel', { name: 'Checks (1/1)' })).toHaveTextContent('Requested dates and regions are covered.');
        expect(gather.querySelector('[data-workflow-action]')).toHaveTextContent('Collect data');
        expect(screen.getByLabelText('accuracy: pending')).not.toBeVisible();
        expect(screen.getByText('Before this step · On failure: gather')).not.toBeVisible();
        expect(screen.getByText('Observed rows')).not.toBeVisible();
        expect(screen.getByText('Returns reconciled')).not.toBeVisible();
        expect(gather.querySelector('[data-workflow-call="gathered"]')).toBeTruthy();
        expect(gather.textContent).toContain('Observed rows');
        expect(gather.textContent).not.toContain('Returns reconciled');
        expect(analyze.querySelector('[data-workflow-call="analyzed"]')).toBeTruthy();
        expect(screen.getByText('Unassigned calls (1)').closest('details')!.textContent).toContain('Older result without step metadata');
        expect(gather.querySelector('[data-workflow-activity]')).not.toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByRole('tab', { name: 'Activities (1)' }));
        fireEvent.click(within(gather as HTMLElement).getByText('Call 1: fetch live data'));
        expect(within(gather as HTMLElement).getByText('61')).toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByText('Raw JSON'));
        expect(JSON.parse(within(gather as HTMLElement).getByText(/"source": "live"/).textContent!)).toEqual({ rows: 61, metadata: { source: 'live' } });
        expect(screen.getByText('Observed rows')).not.toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByRole('tab', { name: 'Checks (1/1)' }));
        fireEvent.click(gather.querySelector('[data-workflow-check="coverage"] summary')!);
        expect(screen.getByText('Observed rows')).toBeVisible();
        expect(screen.getByText('Before this step · On failure: gather')).toBeVisible();
        expect(screen.getByText('Collect data')).not.toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByRole('tab', { name: 'Artifacts (0)' }));
        expect(within(gather as HTMLElement).getByText('No outputs yet.')).toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByRole('tab', { name: 'Action' }));
        expect(screen.getByText('Collect data')).toBeVisible();
        expect(container.textContent!.indexOf('Final verified response')).toBeLessThan(container.textContent!.indexOf('Unassigned calls'));
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
        expect(gather.querySelector('[data-workflow-connector]')).toHaveStyle('border-left-width: 4px; border-left-color: #2e7d32; left: 12px');
        expect(gather.querySelector('[data-workflow-marker] .MuiSvgIcon-root')).toHaveStyle('font-size: 24px');
        for (const artifact of container.querySelectorAll('[data-workflow-artifact]')) {
            const style = getComputedStyle(artifact);
            expect(style.borderTopStyle).toBe('solid');
            expect(style.borderTopWidth).toBe('1px');
            expect(style.width).toBe('280px');
            expect(style.maxWidth).toBe('100%');
            expect(style.boxSizing).toBe('border-box');
        }
        expect(within(gather as HTMLElement).getByRole('tab', { name: 'Artifacts (2)' })).toHaveAttribute('aria-selected', 'true');
        expect(within(analyze as HTMLElement).getByRole('tab', { name: 'Artifacts (2)' })).toHaveAttribute('aria-selected', 'true');
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