import React from 'react';
import { EditorView } from '@uiw/react-codemirror';
import 'prismjs';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider, useSelector } from 'react-redux';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ThemeProvider, createTheme } from '@mui/material';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../../../src/app/store';
import { dfActions, dfSelectors, fetchGlobalModelList } from '../../../../src/app/dfSlice';
import { apiRequest, streamRequest } from '../../../../src/app/apiClient';
import { getUrls } from '../../../../src/app/utils';
import { pauseWorkflowRun, publishWorkflowRun, sendWorkflowMessage, WorkflowProgress, WorkflowPanel, WorkflowRunObserver, Run, selectChatWorkflow, workflowRequestId } from '../../../../src/views/WorkflowPanel';
import { SchedulesPanel } from '../../../../src/views/WorkflowSchedules';
import { SimpleChartRecBox } from '../../../../src/views/SimpleChartRecBox';
import { FreeDataViewFC } from '../../../../src/views/DataView';
import { DataThread } from '../../../../src/views/DataThread';
import { LayoutProvider } from '../../../../src/app/LayoutProvider';
import { VisualizationViewFC } from '../../../../src/views/VisualizationView';
import { buildThreads } from '../../../../src/app/threadGraph';
import { ConversationCanvas } from '../../../../src/views/ConversationCanvas';
import { ReportView } from '../../../../src/views/ReportView';
import { getSerializableState } from '../../../../src/app/useAutoSave';

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
            }, field_metadata: { category: { semantic_type: 'Category', sort_order: ['B', 'A'] } },
                field_display_names: { value: 'Value' } },
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

    it('groups the tables one data operation loaded into one set, across publications', async () => {
        const table = (name: string) => ({ name, columns: [], row_count: 1, sample_rows: [], content_hash: name,
            origin: 'agent', role: 'source', edit_policy: 'agent_editable' });
        vi.mocked(apiRequest).mockImplementation(async url => url === '/api/workflows/run-state' ? new Promise(() => {})
            : { data: { files: [], tables: ['beats', 'titan', 'walker', 'measurements'].map(table) } } as any);
        const imported = (operation: string, name: string) => ({ id: `import-${operation}-${name}`, type: 'tool_result',
            tool: 'create_data', stdout: JSON.stringify({ table_name: name }) });
        const base = { ...run(), outputs: [imported('op-1', 'beats'), imported('op-1', 'titan')] };
        await publishWorkflowRun(base, 'session');
        // A later publication adds the operation's third table, then another output.
        await publishWorkflowRun({ ...base, outputs: [...base.outputs, imported('op-1', 'walker'),
            { id: 'data', type: 'tool_result', tool: 'create_data', stdout: JSON.stringify({ table_name: 'measurements' }) }] }, 'session');
        const state = store.getState();
        expect(state.artifactSets).toEqual([expect.objectContaining({ id: 'artifactSet-workflow-native-op-1',
            parentNodeId: workflowRequestId('native'),
            memberIds: ['beats', 'titan', 'walker'].map(name => `workflow-data-native-${name}`) })]);
        const parentOf = (id: string) => [...state.loadedTableNodes, ...state.textTurns].find(node => node.id === id)?.parentNodeId;
        // request → {beats, titan, walker} → measurements → the run's record
        expect(parentOf('workflow-data-native-measurements')).toBe('artifactSet-workflow-native-op-1');
        expect(parentOf('textTurn-workflow-native')).toBe('workflow-data-native-measurements');
        // Publishing the same state again changes nothing.
        await publishWorkflowRun({ ...base, outputs: [...base.outputs, imported('op-1', 'walker')] }, 'session');
        expect(store.getState().artifactSets).toEqual(state.artifactSets);
    });

    // A full panel walkthrough: about 3s alone, longer under the parallel suite.
    it('simplifies schedule defaults and reveals missing required inputs', async () => {
        const previous = store.getState();
        let rendered: ReturnType<typeof render> | undefined;
        try {
            store.dispatch(dfActions.setServerConfig({ ...previous.serverConfig, IS_LOCAL_MODE: true }));
            store.dispatch(fetchGlobalModelList.fulfilled([
                { id: 'server-first', endpoint: 'openai', model: 'First', api_key: '', api_base: '', api_version: '' },
                { id: 'server-selected', endpoint: 'openai', model: 'Selected', api_key: '', api_base: '', api_version: '' },
            ], 'schedule-test', undefined));
            store.dispatch(dfActions.selectModel('server-selected'));
            const item = { path: 'review.yaml', name: 'Review values', origin: 'user', parameters: [
                { name: 'subscription', label: 'Subscription', required: true },
                { name: 'days', label: 'Days', type: 'number', required: true, default: 28 },
            ] };
            let savedSchedules: { id: string; config: Record<string, unknown>; next_at: string;
                history: { id: string; status: string; scheduled_for: string }[] }[] = [];
            vi.mocked(apiRequest).mockImplementation(async (url, options) => {
                if (url === '/api/schedules' && options?.method === 'POST') {
                    savedSchedules = [{ id: 'saved-schedule', config: JSON.parse(options.body as string).config, next_at: '2026-10-01T16:00:00Z',
                        history: [{ id: 'skipped-run', status: 'skipped', scheduled_for: '2026-09-30T16:00:00Z' },
                            { id: 'latest-run', status: 'needs_attention', scheduled_for: '2026-09-29T16:00:00Z' },
                            { id: 'older-run', status: 'completed', scheduled_for: '2026-09-28T16:00:00Z' }] }];
                }
                return { data: url === '/api/workflows/list'
                    ? { items: [item], runs: [] } : { available: true, schedules: savedSchedules } } as any;
            });
            const openSession = vi.fn();
            rendered = render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} onOpenSession={openSession} />
                <SchedulesPanel onOpenSession={openSession} /></Provider>);
            await screen.findByRole('button', { name: 'Open Review values' });
            await waitFor(() => expect(screen.getByRole('button', { name: 'New schedule' })).toBeEnabled());
            expect(screen.getByRole('region', { name: 'Schedules' }))
                .toContainElement(screen.getByRole('button', { name: 'New schedule' }));
            expect(screen.getByRole('button', { name: 'New workflow' }).parentElement)
                .not.toContainElement(screen.getByRole('button', { name: 'New schedule' }));
            expect(screen.getByRole('region', { name: 'Schedules' })).toHaveTextContent('No schedules yet');
            fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));
            const workflowSelect = await screen.findByRole('combobox', { name: 'Workflow' });
            fireEvent.change(workflowSelect.parentElement!.querySelector('input')!, { target: { value: 'review.yaml' } });
            expect(screen.getByText('Workflow inputs')).toBeVisible();
            expect(screen.getByText('Run settings')).toBeVisible();
            expect(document.querySelector('[role="dialog"] details')).toBeNull();
            fireEvent.change(screen.getByLabelText(/Subscription/), { target: { value: 'example' } });
            const scheduleName = screen.getByLabelText(/Schedule name/);
            expect(scheduleName).toHaveValue('Review values');
            fireEvent.change(scheduleName, { target: { value: 'Daily review' } });
            expect(screen.queryByRole('group', { name: 'Weekdays' })).not.toBeInTheDocument();
            expect(screen.getByRole('checkbox', { name: 'Auto-approve commands and data loads' })).not.toBeChecked();
            const repeatInput = screen.getByRole('combobox', { name: 'Repeat' }).parentElement!.querySelector('input')!;
            fireEvent.change(repeatInput, { target: { value: 'weekdays' } });
            fireEvent.change(repeatInput, { target: { value: 'custom' } });
            fireEvent.click(screen.getByRole('checkbox', { name: 'Sun' }));
            fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
            await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([url, options]) => url === '/api/schedules' && options?.method === 'POST')).toBe(true));
            const submission = vi.mocked(apiRequest).mock.calls.find(([url, options]) => url === '/api/schedules' && options?.method === 'POST')!;
            expect(JSON.parse(submission[1]!.body as string).config).toMatchObject({
                name: 'Daily review', workflow: 'review.yaml', model_id: 'server-selected', weekdays: [0, 1, 2, 3, 4, 6],
                enabled: true, max_retries: 2, auto_approve: false, catch_up: false,
                setup: { parameters: { subscription: 'example', days: 28 }, instructions: '' },
            });
            // Saving closes the dialog; the Schedules panel lists the new schedule.
            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Schedules' })).not.toBeInTheDocument());
            const scheduleTitle = 'Daily review';
            const editSchedule = await screen.findByRole('button', { name: `Edit schedule ${scheduleTitle}` });
            const schedules = screen.getByRole('region', { name: 'Schedules' });
            expect(schedules).toContainElement(editSchedule);
            expect(screen.getByRole('region', { name: 'Workflows' })).not.toContainElement(editSchedule);
            expect(within(schedules).getByRole('img', { name: 'Next run, Mon, Tue, Wed, Thu, Fri, Sun at 09:00' })).toBeInTheDocument();
            expect(schedules).not.toHaveTextContent(/Last run/);
            expect(within(schedules).getByRole('img', { name: 'Needs attention' })).toBeInTheDocument();
            expect(schedules.textContent).not.toContain('·');
            fireEvent.click(within(schedules).getByRole('button', { name: `Open latest run for schedule ${scheduleTitle}` }));
            expect(openSession).toHaveBeenLastCalledWith('scheduled-latest-run');
            const runItems = within(within(schedules).getByRole('group', { name: `Runs of schedule ${scheduleTitle}` }))
                .getAllByRole('button', { name: /^Open run .* for schedule / });
            expect(runItems).toHaveLength(1);
            fireEvent.click(runItems[0]);
            expect(openSession).toHaveBeenLastCalledWith('scheduled-older-run');
            expect(screen.queryByRole('group', { name: 'Runs of Review values' })).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Open Review values' }));
            fireEvent.click(within(await screen.findByRole('group', { name: 'Runs of Review values' })).getAllByRole('button')[0]);
            await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Workflows' })).toBeNull());
            expect(openSession).toHaveBeenCalledTimes(3);
            expect(openSession).toHaveBeenLastCalledWith('scheduled-latest-run');
            fireEvent.click(editSchedule);
            expect(await screen.findByLabelText(/Schedule name/)).toHaveValue(scheduleTitle);
            expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
            const scheduleList = screen.getByRole('navigation', { name: 'Schedule list' });
            expect(within(scheduleList).getByRole('button', { name: new RegExp(scheduleTitle) })).toHaveAttribute('aria-current', 'true');
            fireEvent.click(within(scheduleList).getByRole('button', { name: 'New schedule' }));
            expect(screen.getByLabelText(/Schedule name/)).toHaveValue('');
            fireEvent.click(within(scheduleList).getByRole('button', { name: new RegExp(scheduleTitle) }));
            expect(screen.getByLabelText(/Schedule name/)).toHaveValue(scheduleTitle);
        } finally {
            rendered?.unmount();
            store.dispatch(dfActions.setServerConfig(previous.serverConfig));
            store.dispatch(fetchGlobalModelList.fulfilled(previous.globalModels, 'restore-schedule-test', undefined));
        }
    }, 15_000);

    it('applies the chart and report edits, moves, and deletions a run made, once', async () => {
        await publishWorkflowRun(run(), 'session');
        const output = (id: string, tool: string, result: object) => ({ id, type: 'tool_result', tool, stdout: JSON.stringify(result) });
        const changed = { ...run(), outputs: [...run().outputs,
            output('edit-report', 'edit_file', { path: 'session/reports/report', session_update: {
                kind: 'report', id: store.getState().generatedReports[0].id, content: '# Revised review' } }),
            output('move', 'move_file', { moved: { from: 'files/notes.txt', to: 'files/docs/notes.txt' } }),
            output('delete', 'delete_items', { deleted: { tables: [], references: [], files: [],
                charts: [{ id: 'chart-native', name: 'Values by category' }] } }),
        ] };
        await publishWorkflowRun(changed, 'session');
        const state = store.getState();
        expect(state.generatedReports[0].content).toBe('# Revised review');
        expect(state.fileNodes.map(node => node.path)).toEqual(['docs/notes.txt']);
        expect(dfSelectors.getAllCharts(state).some(chart => chart.id === 'chart-native')).toBe(false);
        // Publishing the same run again changes nothing more.
        await publishWorkflowRun(changed, 'session');
        expect(dfSelectors.getAllCharts(store.getState()).some(chart => chart.id === 'chart-native')).toBe(false);
        expect(store.getState().generatedReports[0].content).toBe('# Revised review');
    });

    it('publishes the workflow name instead of an internal turn ID', async () => {
        await publishWorkflowRun({ ...run(), outputs: [] }, 'session');
        expect(store.getState().textTurns.find(turn => turn.workflow?.runId === 'native')?.displayId).toBe('Native review');
    });

    it('recovers a running node after reload without executing or stealing focus', async () => {
        await publishWorkflowRun({ ...run(), status: 'running', outputs: [] }, 'session', false);
        const snapshot = { ...run(), status: 'completed', outputs: [{ id: 'report', type: 'report', content: 'Finished in the background' }] };
        vi.mocked(apiRequest).mockImplementation(async () => ({ data: { run: snapshot } }) as any);
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'current-view' }));
        const rendered = render(<Provider store={store}><WorkflowRunObserver /></Provider>);
        await waitFor(() => expect(store.getState().generatedReports[0]?.content).toBe('Finished in the background'));
        expect(store.getState().textTurns[0].workflow?.status).toBe('completed');
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'current-view' });
        expect(streamRequest).not.toHaveBeenCalled();
        expect(vi.mocked(apiRequest).mock.calls.map(([url]) => url)).toEqual(['/api/workflows/run-state']);
        rendered.unmount();
    });

    it('follows a read-only scheduled run and reloads its final snapshot', async () => {
        const scheduledRun = { scheduleId: 'schedule', scheduleName: 'Daily', scheduledFor: '2026-09-30T09:00:00Z' };
        store.dispatch(dfActions.setActiveWorkspace({ id: 'scheduled-native', displayName: 'Daily', readOnly: true, scheduledRun }));
        await publishWorkflowRun({ ...run(), outputs: [] }, 'scheduled-native', false);
        const states = [{ ...run(), outputs: [], activity: 'Checking sources' }, { ...run(), outputs: [], status: 'completed' }];
        const snapshots = [true, false].map(readOnly => ({ state: { activeWorkspace: { id: 'scheduled-native', displayName: 'Daily', readOnly, scheduledRun },
            textTurns: [{ id: 'final', kind: 'text', textKind: 'explain', displayId: 'Daily', content: readOnly ? 'Pending' : 'Done', createdAt: 1, parentNodeId: 'root' }] } }));
        vi.mocked(apiRequest).mockImplementation(async url => ({ data: url === '/api/workflows/run-state'
            ? { run: states.length > 1 ? states.shift() : states[0] } : snapshots.length > 1 ? snapshots.shift() : snapshots[0] }) as any);
        vi.useFakeTimers();
        try {
            const rendered = render(<Provider store={store}><WorkflowRunObserver /></Provider>);
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(store.getState().textTurns[0].workflow).toMatchObject({ status: 'running', activity: 'Checking sources' });
            await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
            expect(store.getState().activeWorkspace?.readOnly).toBe(true);
            await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
            expect(store.getState().activeWorkspace).toMatchObject({ id: 'scheduled-native', readOnly: false });
            expect(store.getState().textTurns.map(turn => turn.content)).toEqual(['Done']);
            expect(streamRequest).not.toHaveBeenCalled();
            expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === '/api/workflows/pause')).toBe(false);
            rendered.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it('opens the latest workflow checkpoint by path even when workflow names are duplicated', async () => {
        vi.mocked(apiRequest).mockImplementation(async url => ({ data: url === '/api/workflows/run-state'
            ? { run: { ...run(), id: 'newest', outputs: [], status: 'paused' } }
            : { items: [{ path: 'mine.yaml', name: 'Review', origin: 'user' }, { path: 'demo/review.yaml', name: 'Review', origin: 'demo' }],
                runs: [{ ...run(), id: 'oldest', name: 'Old name', workflow_path: 'mine.yaml', started_at: '2026-09-28T00:00:00Z' },
                    { ...run(), id: 'newest', name: 'Old name', workflow_path: 'mine.yaml', started_at: '2026-09-30T00:00:00Z' }] } }) as any);
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click((await screen.findAllByRole('button', { name: 'Open Review' }))[0]);
        const workflowRuns = within(await screen.findByRole('group', { name: 'Runs of Review' })).getAllByRole('button');
        expect(workflowRuns).toHaveLength(2);
        fireEvent.click(workflowRuns[0]);
        await waitFor(() => expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'textTurn-workflow-newest' }));
        const request = vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/run-state');
        expect(JSON.parse(request![1]!.body as string)).toEqual({ run_id: 'newest', known_outputs: [] });
        expect(streamRequest).not.toHaveBeenCalled();
    });

    it('explains that scheduling is local-only when the server has none', async () => {
        vi.mocked(apiRequest).mockImplementation(async url => ({ data: url === '/api/workflows/list'
            ? { items: [], runs: [] } : { available: false, schedules: [] } }) as any);
        const rendered = render(<Provider store={store}><SchedulesPanel /></Provider>);
        expect(await screen.findByText(/only available in the local Data Formulator app/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New schedule' })).toHaveProperty('disabled', true);
        rendered.unmount();
    });

    it('shows private read-only workflow details without resume controls', async () => {
        await publishWorkflowRun({ ...run(), status: 'paused', outputs: [], message: 'Execution failed.' }, 'session');
        store.dispatch(dfActions.setActiveWorkspace({ id: 'scheduled-private-test', displayName: 'Scheduled run', readOnly: true }));
        render(<Provider store={store}><WorkflowProgress turn={store.getState().textTurns[0]} canvas /></Provider>);
        // KNOWN PRODUCT BUG (fails today): WorkflowProgress titles the run from `turn.prompt`, which the
        // run record no longer carries (the request message does), so the heading falls back to "Workflow".
        expect(screen.getByRole('heading', { name: 'Native review' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Review request' })).not.toBeInTheDocument();
        expect(streamRequest).not.toHaveBeenCalled();
    });

    it('infers semantics and units for workflow source and derived tables once per published output version', async () => {
        const fallback = vi.mocked(apiRequest).getMockImplementation()!;
        const inferenceUrl = getUrls().SERVER_PROCESS_DATA_ON_LOAD;
        vi.mocked(apiRequest).mockImplementation(async (url, options) => url === inferenceUrl
            ? { data: { result: [{ fields: { value: { semantic_type: 'Currency', unit: 'USD', intrinsic_domain: [0, 100] },
                category: { semantic_type: 'Category', sort_order: ['A', 'B'] } } }] } } as any
            : fallback(url, options));
        const snapshot = run();
        await publishWorkflowRun(snapshot, 'session');
        await waitFor(() => expect(store.getState().tableSemantics).toEqual(expect.arrayContaining([
            expect.objectContaining({ tableId: 'measurements', fields: { value: { semanticType: 'Amount', unit: 'USD', intrinsicDomain: [0, 100] } } }),
            // The agent's own annotations win over inference; inference fills the rest.
            expect.objectContaining({ tableId: 'chart_values', fields: {
                value: { semanticType: 'Amount', unit: 'USD', intrinsicDomain: [0, 100], displayName: 'Value',
                    authored: { displayName: 'Value' } },
                category: { semanticType: 'Category', sortOrder: ['B', 'A'],
                    authored: { semanticType: 'Category', sortOrder: ['B', 'A'] } },
            } }),
        ])));
        const inferenceCalls = () => vi.mocked(apiRequest).mock.calls.filter(([url]) => url === inferenceUrl);
        expect(inferenceCalls().map(([, options]) => JSON.parse(options!.body as string).input_data)).toEqual([
            { name: 'measurements', rows: [{ value: 2 }], virtual: true },
            { name: 'chart_values', rows: [{ category: 'A', value: 2 }], virtual: true },
        ]);
        await publishWorkflowRun(snapshot, 'session');
        expect(inferenceCalls()).toHaveLength(2);
        await publishWorkflowRun({ ...snapshot, outputs: snapshot.outputs!.map(output => output.id === 'data'
            ? { ...output, tool: 'update_data', version: 'updated' } : output) }, 'session');
        expect(inferenceCalls()).toHaveLength(3);
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

    it.each([false, true])('shows dedicated and visualization-time loading as items in the chain (dedicated: %s)', dedicated => {
        // Every item a run loads joins its chain (design-docs/58, rule 1): a load made while
        // visualizing sits between the request and the step that used it; a dedicated load
        // has its own summary before the next request.
        const rootId = 'conversation-root:aircraft';
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'incidents', displayId: 'Incident Records',
            names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'incidents', rowCount: 0 } }));
        const userMessage = (id: string, prompt: string, parentNodeId: string, createdAt: number) => dfActions.addTextTurn({
            kind: 'text', id, displayId: id, textKind: 'explain', prompt, content: '', parentNodeId, createdAt });
        store.dispatch(userMessage('request', dedicated ? 'Load incident data' : 'Compare incidents by flight phase', rootId, 1));
        store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-incidents', tableId: 'incidents',
            parentNodeId: 'request', createdAt: 2 }));
        let stepParent = 'loaded-incidents';
        if (dedicated) {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'load-summary', displayId: 'Data loaded',
                textKind: 'explain', content: 'Incident data is ready.', parentNodeId: 'loaded-incidents', createdAt: 3 }));
            store.dispatch(userMessage('compare', 'Compare incidents by flight phase', 'load-summary', 4));
            stepParent = 'compare';
        }
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'count-step', displayId: 'Count', textKind: 'explain',
            content: 'Count incidents by phase', parentNodeId: stepParent, createdAt: 5 }));
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'phase-counts', displayId: 'Incidents by Flight Phase',
            names: [], rows: [], metadata: {}, description: '', parentNodeId: 'count-step', derive: {
                source: ['incidents'], code: 'result = incidents', outputVariable: 'result', dialog: [],
                trigger: { tableId: rootId, resultTableId: 'phase-counts', chart: undefined },
            } } as any));
        const { container } = renderThread();
        expect(screen.getAllByRole('button', { name: 'view chat' })).toHaveLength(1);
        expect(container.querySelectorAll('[data-thread-item="loaded-incidents"]')).toHaveLength(1);
        const output = container.querySelector<HTMLElement>('[data-thread-item="loaded-incidents"]')!;
        const artifact = within(output).getByRole('button', { name: 'Incident Records' });
        expect(artifact.closest('.data-thread-card')).toBeInTheDocument();
        expect(screen.getAllByText('Incident Records', { exact: true }).filter(node => node.closest('[data-thread-item]'))).toHaveLength(1);
        const step = screen.getByText('Count incidents by phase');
        const request = screen.getByText(dedicated ? 'Load incident data' : 'Compare incidents by flight phase');
        expect(request.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(output.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(!!screen.queryByText('Incident data is ready.')).toBe(dedicated);
        if (dedicated) {
            expect(output.compareDocumentPosition(screen.getByText('Incident data is ready.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(screen.getByText('Incident data is ready.').compareDocumentPosition(screen.getByText('Compare incidents by flight phase'))
                & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        fireEvent.click(artifact);
        expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'loaded-incidents' });
        expect(artifact.closest('.selected-artifact-card')).toBeInTheDocument();
        expect(screen.getByText('Incidents by Flight Phase')).toBeInTheDocument();
    });

    it('shows a virtual source the agent added under the turn that added it', () => {
        const reference = { kind: 'external-table-reference' as const, id: 'external:blob:reviews', connectorId: 'blob',
            tableKey: 'reviews', sourceTable: { id: 'reviews', name: 'az://account/data/games_reviews.parquet' },
            displayName: 'az://account/data/games_reviews.parquet', capturedAt: '', summary: { columns: [] } };
        store.dispatch(dfActions.upsertExternalTableReference(reference));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'added-reference', displayId: 'Added',
            textKind: 'explain', prompt: 'games_reviews.parquet', content: 'Added games_reviews.parquet as a workspace reference.',
            parentNodeId: 'conversation-root:reviews', createdAt: 2 }));
        store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-reviews', tableId: reference.id,
            external: true, parentNodeId: 'added-reference', createdAt: 1 }));
        act(() => store.dispatch(dfActions.setFocused(undefined)));
        const { container } = renderThread();
        const output = container.querySelector<HTMLElement>('[data-thread-item="loaded-reviews"]')!;
        expect(output).toBeInTheDocument();
        expect(within(output).getByText('games_reviews.parquet')).toBeInTheDocument();
        expect(within(output).getByText('(virtual)')).toBeInTheDocument();
        fireEvent.click(within(output).getByRole('button'));
        // The thread node takes focus, so a follow-up continues this thread; the canvas shows the source.
        expect(store.getState().focusedId).toEqual({ type: 'reference', referenceId: 'loaded-reviews' });
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'external-table', referenceId: reference.id });
        expect(output.querySelector('.selected-artifact-card')).toBeInTheDocument();
    });

    it('shows loaded data before ongoing thinking and keeps it before the final summary', () => {
        const rootId = 'conversation-root:live-load';
        // The request is its own message; the run's live draft follows the chain head (design-docs/58).
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'load-request', displayId: 'Load', textKind: 'explain',
            prompt: 'Load consumer price data', content: '', parentNodeId: rootId, createdAt: 1 }));
        store.dispatch(dfActions.createDraftNode({ id: 'loading-draft', displayId: 'Load data',
            parentNodeId: 'load-request', parentTableId: rootId, source: [], interaction: [] }));
        const { container } = renderThread();
        expect(container.querySelector('[data-thread-item="loaded-consumer-prices"]')).toBeNull();
        act(() => {
            store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'consumer_prices', displayId: 'Consumer Prices',
                names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'consumer_prices', rowCount: 0 } }));
            store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-consumer-prices',
                tableId: 'consumer_prices', parentNodeId: 'load-request', createdAt: 2 }));
            store.dispatch(dfActions.moveDraftNode({ draftId: 'loading-draft', parentNodeId: 'loaded-consumer-prices' }));
        });
        const output = container.querySelector('[data-thread-item="loaded-consumer-prices"]')!;
        expect(output).toBeInTheDocument();
        expect(screen.getByText('Load consumer price data').compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const thinking = container.querySelector('[data-thread-item="agent-thinking-loading-draft"]')!;
        expect(thinking).toBeInTheDocument();
        expect(output.compareDocumentPosition(thinking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'load-summary', displayId: 'Summary',
                textKind: 'explain', content: 'Loaded consumer prices.', parentNodeId: 'loaded-consumer-prices', createdAt: 3 }));
            store.dispatch(dfActions.removeDraftNode('loading-draft'));
        });
        expect(container.querySelectorAll('[data-thread-item="loaded-consumer-prices"]')).toHaveLength(1);
        expect(container.querySelector('[data-thread-item="agent-thinking-loading-draft"]')).toBeNull();
        const completedOutput = container.querySelector('[data-thread-item="loaded-consumer-prices"]')!;
        const summary = container.querySelector('[data-thread-item="textturn-load-summary"]')!;
        expect(completedOutput.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'trend-request', displayId: 'Trends', textKind: 'explain',
                prompt: 'Show overall trends', content: '', parentNodeId: 'load-summary', createdAt: 4 }));
            store.dispatch(dfActions.createDraftNode({ id: 'trend-draft', displayId: 'Trends',
                parentNodeId: 'trend-request', parentTableId: rootId, source: ['consumer_prices'], interaction: [] }));
        });
        const followup = screen.getByText('Show overall trends');
        expect(followup).toBeVisible();
        expect(summary.compareDocumentPosition(followup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const followupThinking = container.querySelector('[data-thread-item="agent-thinking-trend-draft"]')!;
        expect(followupThinking).toBeInTheDocument();
        expect(followup.compareDocumentPosition(followupThinking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        act(() => {
            store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'trend-summary', displayId: 'Trends',
                textKind: 'explain', content: 'Prices have increased.', parentNodeId: 'trend-request', createdAt: 5 }));
            store.dispatch(dfActions.removeDraftNode('trend-draft'));
        });
        expect(screen.getAllByText('Show overall trends')).toHaveLength(1);
        expect(followup.compareDocumentPosition(container.querySelector('[data-thread-item="textturn-trend-summary"]')!)
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it.each([true, false])('orders loaded data before its summary but after earlier remarks (summary: %s)', summary => {
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'consumer_prices', displayId: 'Consumer Prices',
            names: [], rows: [], metadata: {}, description: '', virtual: { tableId: 'consumer_prices', rowCount: 0 } }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'load-request', displayId: 'Load', textKind: 'explain',
            prompt: 'Load consumer price data', content: '', parentNodeId: 'conversation-root:load', createdAt: 0 }));
        // The chain records what happened first: a closing summary follows the load; an earlier remark precedes it.
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-load', displayId: 'Load data',
            textKind: 'explain', content: summary ? 'Loaded consumer prices.' : 'Preparing the import.',
            parentNodeId: summary ? 'loaded-consumer-prices' : 'load-request', createdAt: summary ? 3 : 1 }));
        store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-consumer-prices',
            tableId: 'consumer_prices', parentNodeId: summary ? 'load-request' : 'textTurn-load', createdAt: 2 }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-followup', displayId: 'Follow-up',
            textKind: 'explain', content: 'A later analysis.', parentNodeId: summary ? 'textTurn-load' : 'loaded-consumer-prices', createdAt: 4 }));
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

    it('steers a running workflow from its card without pausing it or starting an analyst', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        renderThread();
        expect(screen.queryByPlaceholderText('Message workflow...')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Steer' }));
        const composer = await screen.findByRole('form', { name: 'Steer workflow agent' });
        fireEvent.change(within(composer).getByRole('textbox', { name: 'Message to workflow agent' }), { target: { value: 'Compare weekly returns instead.' } });
        fireEvent.click(within(composer).getByRole('button', { name: 'Send' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/workflows/message', expect.anything()));
        const request = vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/message')!;
        expect(JSON.parse(request[1]!.body as string)).toEqual({ run_id: 'native', message: 'Compare weekly returns instead.', message_id: expect.any(String) });
        await waitFor(() => expect(screen.queryByRole('form', { name: 'Steer workflow agent' })).toBeNull());
        expect(screen.getByText('(steering) Compare weekly returns instead.')).toBeTruthy();
        expect(screen.queryByText('Queued for workflow.')).toBeNull();
        expect(store.getState().textTurns.find(item => item.id === turn.id)!.workflow).toEqual(turn.workflow);
        // Steering is a message within the run, placed right before its record.
        const steering = store.getState().textTurns.find(item => item.prompt === 'Compare weekly returns instead.')!;
        expect(steering).toMatchObject({ content: '', parentNodeId: 'textTurn-workflow-native-request',
            workflowMessage: { runId: 'native', kind: 'steering' } });
        expect(store.getState().textTurns.find(item => item.id === turn.id)!.parentNodeId).toBe(steering.id);
        expect(streamRequest).not.toHaveBeenCalled();
        expect(store.getState().draftNodes).toHaveLength(0);
        const sentMessage = store.getState().textTurns.find(item => item.workflowMessage)!;
        await act(async () => { await publishWorkflowRun({ ...snapshot, applied_message_ids: [sentMessage.workflowMessage!.messageId] }, 'session'); });
        expect(store.getState().textTurns.find(item => item.workflowMessage)!.workflowMessage!.status).toBe('received');
        expect(screen.queryByText('Received by workflow.')).toBeNull();
        await act(async () => { await publishWorkflowRun({ ...snapshot, status: 'completed' }, 'session'); });
        expect(screen.queryByRole('button', { name: 'Steer' })).toBeNull();
    });

    it('resumes a paused workflow with the message sent from its card', async () => {
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
        fireEvent.click(screen.getByRole('button', { name: 'Steer' }));
        const composer = await screen.findByRole('form', { name: 'Steer workflow agent' });
        fireEvent.change(within(composer).getByRole('textbox', { name: 'Message to workflow agent' }), { target: { value: 'Use the latest full month.' } });
        fireEvent.keyDown(within(composer).getByRole('textbox', { name: 'Message to workflow agent' }), { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        const request = JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string);
        expect(request).toMatchObject({ run_id: 'native', reply: 'Use the latest full month.' });
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === '/api/workflows/message')).toBe(false);
        await waitFor(() => expect(store.getState().textTurns.filter(turn => turn.workflowMessage?.kind === 'reply')).toHaveLength(1));
        expect(screen.queryByText('Queued for workflow.')).toBeNull();
    });

    it.each([0, 3, 8])('renders a workflow reply once at its place among outputs after %s outputs', async afterOutputs => {
        const outputs = Array.from({ length: 8 }, (_, index) => {
            const output = structuredClone(run().outputs![2]);
            output.id = `chart-${index}`;
            output.content.result.chart_id = `chart-${index}`;
            output.content.result.content.virtual.table_name = `chart_values_${index}`;
            output.content.result.refined_goal.display_name = `Chart values ${index}`;
            return output;
        });
        await publishWorkflowRun({ ...run(), outputs: outputs.slice(0, afterOutputs) }, 'session');
        // A reply is a user message node placed right before the run's record; later outputs follow it.
        const record = store.getState().textTurns.find(item => item.id === 'textTurn-workflow-native')!;
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'textTurn-workflow-reply-native-question',
            displayId: 'Workflow reply', textKind: 'explain', prompt: 'should be fine', content: '',
            parentNodeId: record.parentNodeId, createdAt: Date.now(), workflowMessage: { runId: 'native', messageId: 'question',
                kind: 'reply', status: 'received' } }));
        store.dispatch(dfActions.updateTextTurn({ id: record.id, parentNodeId: 'textTurn-workflow-reply-native-question' }));
        await publishWorkflowRun({ ...run(), outputs }, 'session');
        const { container } = renderThread(true);
        expect(screen.getAllByText('should be fine')).toHaveLength(1);
        const reply = screen.getByText('should be fine');
        const outputBlock = (index: number) => container.querySelector(`[data-thread-item="regular-table-box-chart_values_${index}"]`)!;
        if (afterOutputs) expect(outputBlock(afterOutputs - 1).compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        if (afterOutputs < 8) expect(reply.compareDocumentPosition(outputBlock(afterOutputs)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(reply.compareDocumentPosition(container.querySelector('[data-thread-item="textturn-textTurn-workflow-native"]')!)
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('publishes an app the workflow wrote, like a file', async () => {
        const snapshot = run();
        snapshot.outputs = [...snapshot.outputs!, { id: 'app', type: 'tool_result', tool: 'write_app', stdout: JSON.stringify({
            path: 'files/explorer.app.jsx', name: 'explorer.app.jsx', display_name: 'Quake explorer', content_hash: 'app-hash',
            available_in_workspace: true, app: true,
        }) }];
        await publishWorkflowRun(snapshot, 'session');
        const app = store.getState().fileNodes.find(node => node.path === 'explorer.app.jsx');
        // Checked when it first renders, even though nobody watched the run.
        expect(app).toMatchObject({ id: 'file-explorer.app.jsx', displayName: 'Quake explorer', contentHash: 'app-hash' });
        expect(store.getState().textTurns.find(turn => turn.workflow)?.workflow?.artifacts?.map(item => item.nodeId))
            .toContain('file-explorer.app.jsx');
        const { container } = renderThread();
        expect(container.querySelector('[data-thread-item="file-explorer.app.jsx"]')).toBeInTheDocument();
    });

    it('places steering after existing outputs and before outputs created later', async () => {
        const snapshot = run();
        await publishWorkflowRun(snapshot, 'session');
        const turn = store.getState().textTurns[0];
        await sendWorkflowMessage(turn, 'Compare next month.', 'steering-1');
        const message = store.getState().textTurns.find(item => item.workflowMessage)!;
        expect(message.parentNodeId).toBe('workflow-report-native');
        expect(store.getState().textTurns.find(item => item.id === turn.id)!.parentNodeId).toBe(message.id);
        const { container } = renderThread();
        expect(container.textContent!.lastIndexOf('notes.txt')).toBeLessThan(container.textContent!.indexOf('Compare next month.'));
        await act(async () => { await publishWorkflowRun({ ...snapshot, outputs: [...snapshot.outputs!, {
            id: 'later-file', type: 'tool_result', tool: 'create_file', stdout: JSON.stringify({
                path: 'files/later-note.txt', name: 'later-note.txt', content_hash: 'later', available_in_workspace: true,
            }),
        }] }, 'session'); });
        expect(container.textContent!.indexOf('Compare next month.')).toBeLessThan(container.textContent!.indexOf('later-note.txt'));
        expect(screen.getAllByText('(steering) Compare next month.')).toHaveLength(1);
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

    it.each(['running', 'paused'])('routes only a directly focused %s workflow box and stops routing after completion', async status => {
        const snapshot = run();
        snapshot.status = status;
        await publishWorkflowRun(snapshot, 'session');
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'other-running-workflow', displayId: 'Other run',
            textKind: 'explain', content: '', parentNodeId: 'conversation-root:other', createdAt: 2,
            workflow: { runId: 'other', status: 'running', stepId: 'analyze', calls: 1, steps: [], outputVersions: {} } }));
        for (const focus of [{ type: 'file' as const, fileName: 'notes.txt' },
            { type: 'reference' as const, referenceId: 'workflow-data-native-measurements' },
            { type: 'chart' as const, chartId: 'chart-native' },
            { type: 'table' as const, tableId: 'chart_values' },
            { type: 'report' as const, reportId: 'workflow-report-native' }]) {
            store.dispatch(dfActions.setFocused(focus));
            expect(selectChatWorkflow(store.getState())).toBeUndefined();
        }
        // Messages on the run's chain (its request, a step) are not the run's record.
        for (const textId of ['textTurn-workflow-native-request', 'textTurn-workflow-step-native-chart']) {
            store.dispatch(dfActions.setFocused({ type: 'text', textId }));
            expect(selectChatWorkflow(store.getState())).toBeUndefined();
        }
        const workflowTurn = store.getState().textTurns.find(turn => turn.workflow?.runId === 'native')!;
        store.dispatch(dfActions.setFocused({ type: 'text', textId: workflowTurn.id }));
        expect(selectChatWorkflow(store.getState())?.workflow?.runId).toBe('native');
        await publishWorkflowRun({ ...snapshot, status: 'completed' }, 'session');
        expect(selectChatWorkflow(store.getState())).toBeUndefined();
    });

    it.each(['workflow', 'chart', 'table'])('places a new analyst request after the focused %s artifact', async target => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        // A focused running record steers its run; a completed one continues as an ordinary thread.
        const fromWorkflow = target === 'workflow';
        const snapshot = { ...run(), status: fromWorkflow ? 'completed' : 'running' };
        await publishWorkflowRun(snapshot, 'session');
        const workflowTurn = store.getState().textTurns.find(turn => turn.workflow)!;
        const parentId = fromWorkflow ? workflowTurn.id : 'chart_values';
        const focus = target === 'chart' ? { type: 'chart' as const, chartId: 'chart-native' }
            : target === 'table' ? { type: 'table' as const, tableId: 'chart_values' }
            : { type: 'text' as const, textId: workflowTurn.id };
        store.dispatch(dfActions.setFocused(focus));
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        const proposal = { content: 'name: Follow-up review', definition: { name: 'Follow-up review' } };
        vi.mocked(streamRequest).mockImplementation(async function* () {
            await pending;
            yield { type: 'completion', status: 'success', content: {
                summary: 'A separate workflow proposal.', form: { kind: 'workflow', title: 'Follow-up review', workflow: proposal },
            } } as any;
        });
        const { container } = renderThread();
        expect(screen.queryByRole('button', { name: 'New request' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Steer workflow agent' })).toBeNull();
        const prompt = 'Create a new workflow based on this artifact';
        fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(String(vi.mocked(streamRequest).mock.calls[0][0])).not.toContain('/workflows/');
        const request = store.getState().textTurns.find(turn => turn.prompt === prompt)!;
        expect(request).toMatchObject({ parentNodeId: parentId, content: '' });
        expect(store.getState().draftNodes[0]?.parentNodeId).toBe(request.id);
        const expectPromptAfterArtifact = () => {
            const artifact = fromWorkflow ? container.querySelector(`[data-thread-item="textturn-${workflowTurn.id}"]`)!
                : container.querySelector('[data-thread-item="regular-table-box-chart_values"]')!;
            expect(artifact).toBeTruthy();
            const prompts = screen.getAllByText(prompt).filter(node => node.closest('[data-thread-item]'));
            expect(prompts).toHaveLength(1);
            expect(artifact.compareDocumentPosition(prompts[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        };
        expectPromptAfterArtifact();
        await act(async () => { finish(); });
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.form?.kind === 'workflow')).toBeDefined());
        const proposalTurn = store.getState().textTurns.find(turn => turn.form?.kind === 'workflow')!;
        expect(proposalTurn).toMatchObject({ parentNodeId: request.id, form: { kind: 'workflow', workflow: proposal } });
        expectPromptAfterArtifact();
        expect(store.getState().textTurns.find(turn => turn.id === workflowTurn.id)?.workflow).toEqual(workflowTurn.workflow);
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => String(url).includes('/workflows/message'))).toBe(false);
    });

    it('publishes native data, chart, file and report under one initial turn, without replay duplicates', async () => {
        const snapshot = run();
        await publishWorkflowRun(snapshot, 'session');
        await publishWorkflowRun(snapshot, 'session');
        const state = store.getState();
        // The run's chain: request → outputs (a step message before the chart's table) → record.
        expect(state.textTurns.map(turn => turn.id).sort()).toEqual(['textTurn-workflow-native',
            'textTurn-workflow-native-request', 'textTurn-workflow-step-native-chart']);
        const turnById = (id: string) => state.textTurns.find(turn => turn.id === id)!;
        expect(turnById('textTurn-workflow-native-request')).toMatchObject({ prompt: 'Run workflow: Native review', content: '',
            parentNodeId: 'conversation-root:native' });
        expect(turnById('textTurn-workflow-native').prompt).toBeUndefined();
        expect(turnById('textTurn-workflow-step-native-chart')).toMatchObject({ content: 'Values by category', parentNodeId: 'file-notes.txt' });
        expect(state.inputTables).toHaveLength(1);
        expect(state.derivedTables).toHaveLength(1);
        expect(state.derivedTables[0].displayId).toBe('Category Values');
        expect(state.derivedTables[0].derive?.source).toEqual(['measurements']);
        expect(state.derivedTables[0].derive?.trigger.chart?.source).toBe('trigger');
        expect(state.derivedTables[0].derive?.trigger.interaction).toBeUndefined();
        expect(state.loadedTableNodes).toHaveLength(1);
        expect(state.fileNodes).toHaveLength(1);
        expect(dfSelectors.getAllCharts(state).filter(chart => chart.id === 'chart-native')).toHaveLength(1);
        expect(state.generatedReports).toHaveLength(1);
        expect(state.generatedReports[0].selectedChartIds).toEqual(['chart-native']);
        expect(turnById('textTurn-workflow-native').outputIds).toEqual(['workflow-data-native-measurements', 'file-notes.txt', 'chart_values', 'workflow-report-native']);
        expect([state.loadedTableNodes[0], state.fileNodes[0], state.derivedTables[0], state.generatedReports[0], turnById('textTurn-workflow-native')]
            .map(output => output.parentNodeId)).toEqual(['textTurn-workflow-native-request', 'workflow-data-native-measurements',
                'textTurn-workflow-step-native-chart', 'chart_values', 'workflow-report-native']);
        expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === getUrls().LIST_TABLES)).toHaveLength(1);
        expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === getUrls().SERVER_PROCESS_DATA_ON_LOAD)).toHaveLength(2);
        expect(apiRequest).toHaveBeenCalledTimes(3);
    });

    it('keeps published chart rows when a later update omits them', async () => {
        const snapshot = run();
        await publishWorkflowRun(snapshot, 'session');
        const rows = store.getState().derivedTables[0].rows;
        const slim = structuredClone(snapshot);
        slim.outputs![2].content.result.content = { ...slim.outputs![2].content.result.content, rows: [], rows_omitted: true };
        await publishWorkflowRun(slim, 'session');
        expect(rows.length).toBeGreaterThan(0);
        expect(store.getState().derivedTables[0].rows).toEqual(rows);
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
    }, 15_000);

    it('keeps a new analyst thread after older threads before and after completion', async () => {
        await publishWorkflowRun({ ...run(), status: 'completed' }, 'session');
        const startedAt = Date.now();
        // Requests are their own message nodes; the live draft follows the request.
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'new-request', displayId: 'New question', textKind: 'explain',
            prompt: 'Compare recent days by hour', content: '', parentNodeId: 'conversation-root:new-question', createdAt: startedAt }));
        store.dispatch(dfActions.createDraftNode({ id: 'new-draft', displayId: 'New question',
            parentNodeId: 'new-request', parentTableId: 'conversation-root:new-question', source: [], interaction: [] }));
        const draftCreatedAt = store.getState().draftNodes.find(draft => draft.id === 'new-draft')!.createdAt;
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'later-request', displayId: 'Later request', textKind: 'explain',
            prompt: 'A later request', content: '', parentNodeId: 'conversation-root:later-question', createdAt: startedAt + 10 }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'later-answer', displayId: 'Later answer',
            textKind: 'explain', content: 'A faster answer', parentNodeId: 'later-request', createdAt: startedAt + 11 }));
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
                textKind: 'explain', content: 'The summary only covers 2011.', parentNodeId: 'new-request', createdAt: startedAt + 20 }));
            store.dispatch(dfActions.removeDraftNode('new-draft'));
        });
        expectThreadOrder();
        expect(store.getState().textTurns.find(turn => turn.id === 'new-answer')?.startedAt).toBe(draftCreatedAt);
        view.unmount();
        store.dispatch(dfActions.loadState(getSerializableState(store.getState())));
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
        // The new chart's step message follows the persisted tail (the report); the record stays last.
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-workflow-step-native-chart-next')?.parentNodeId)
            .toBe('workflow-report-native');
        expect(store.getState().derivedTables.find(table => table.id === 'next_values')?.parentNodeId).toBe('textTurn-workflow-step-native-chart-next');
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-workflow-native')?.parentNodeId).toBe('next_values');
        expect([store.getState().fileNodes[0].parentNodeId, store.getState().derivedTables[0].parentNodeId]).toEqual(firstParents);
        expect(store.getState().textTurns[0].outputIds).toEqual(['workflow-data-native-measurements', 'file-notes.txt', 'chart_values', 'workflow-report-native', 'next_values']);
        const { container } = renderThread();
        expect(screen.getAllByText(/^thread\s*-\s*\d+$/i)).toHaveLength(1);
        expect(container.querySelector('[data-thread-flow-block="output-chart_values"]')).toBeTruthy();
        expect(container.querySelector('[data-thread-flow-block="output-next_values"]')).toBeTruthy();
        expect(screen.getAllByText('Next Values')).toHaveLength(1);
    });

    it('keeps the run record after its outputs and completed follow-ups below it', async () => {
        const snapshot = run();
        snapshot.outputs = [snapshot.outputs![2]];
        await publishWorkflowRun(snapshot, 'session');
        const recordId = 'textTurn-workflow-native';
        const record = () => store.getState().textTurns.filter(turn => turn.id === recordId);
        expect(record()[0].parentNodeId).toBe('chart_values');
        snapshot.outputs.push({ id: 'report', type: 'report', content: '# Final review' });
        await publishWorkflowRun(snapshot, 'session');
        expect(record()[0].parentNodeId).toBe('workflow-report-native');
        snapshot.status = 'completed';
        await publishWorkflowRun(snapshot, 'session');
        // A follow-up continues from the completed record.
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'after-workflow', displayId: 'Follow-up',
            textKind: 'explain', prompt: 'Now compare next month.', content: '', parentNodeId: recordId, createdAt: Date.now() + 1 }));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'after-workflow-answer', displayId: 'Follow-up answer',
            textKind: 'explain', content: 'Next-month analysis.', parentNodeId: 'after-workflow', createdAt: Date.now() + 2 }));
        await publishWorkflowRun(snapshot, 'session');
        expect(record()).toHaveLength(1);
        expect(record()[0].parentNodeId).toBe('workflow-report-native');
        expect(store.getState().textTurns.find(turn => turn.id === 'after-workflow')?.parentNodeId).toBe(recordId);
        const { container } = renderThread();
        const card = container.querySelector(`[data-thread-item="textturn-${recordId}"]`)!;
        expect(card).toBeTruthy();
        expect(container.querySelector('[data-thread-item="report-workflow-report-native"]')!.compareDocumentPosition(card)
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(card.compareDocumentPosition(screen.getByText('Now compare next month.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(container.querySelectorAll(`[data-thread-item="textturn-${recordId}"]`)).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'view chat' })).toHaveLength(1);
    });

    it('keeps the workflow run on the canvas when its completion message is focused', async () => {
        await publishWorkflowRun({ ...run(), status: 'completed', message: 'Completed and verified the review.' }, 'session');
        expect(store.getState().textTurns.find(item => item.id === 'textTurn-workflow-native')?.content).toBe('Completed and verified the review.');
        renderThread();
        // KNOWN PRODUCT BUG (fails today): the completed record (the closing message) renders only as the
        // progress card in the thread, so its completion message is not shown there.
        fireEvent.click(screen.getByText('Completed and verified the review.'));
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'textTurn-workflow-native' });
        expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'text', textId: 'textTurn-workflow-native' });
    });

    it.each(['textTurn-workflow-native'])('sends an analyst follow-up from completed workflow focus %s with its status and output context', async focusedTextId => {
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
        // The completed run, its outputs, and its report reach the agent through the session state (design-docs/61).
        const runTurn = body.session_state.textTurns.find((item: any) => item.workflow);
        expect(runTurn.workflow).toMatchObject({ runId: 'native', status: 'completed' });
        expect(runTurn.outputIds).toEqual(['workflow-data-native-measurements', 'file-notes.txt', 'chart_values', 'workflow-report-native']);
        expect(runTurn.workflow.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'coverage', status: 'passed' })]));
        expect(body.session_state.generatedReports.find((report: any) => report.id === 'workflow-report-native').content).toContain('# Review');
        // The request continues from the completed record; the answer follows the request.
        const request = store.getState().textTurns.find(turn => turn.prompt === body.user_question)!;
        expect(request).toMatchObject({ parentNodeId: 'textTurn-workflow-native', content: '' });
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.content === 'The coverage check passed for all requested regions.'))
            .toMatchObject({ parentNodeId: request.id }));
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-workflow-native')?.answered).not.toBe(true);
    });

    it.each([false, true].flatMap(canvas => ['Run once', 'Reject'].map(label => ({ canvas, label }))))('resumes terminal approval through $label with only the saved request ID (canvas=$canvas)', async ({ canvas, label }) => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), status: 'paused', outputs: [], terminal_request: {
            id: 'approval', argv: ['echo', 'prices'], cwd: '/tmp', purpose: 'Inspect prices', timeout_seconds: 60,
        } };
        await publishWorkflowRun(snapshot, 'session');
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...snapshot, status: 'completed', terminal_request: undefined } } as any;
        });
        render(<Provider store={store}><WorkflowProgress turn={store.getState().textTurns[0]} interactionOnly={!canvas} canvas={canvas} /></Provider>);
        if (canvas) {
            expect(screen.queryByRole('dialog')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
        }
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
            form: { kind: 'workflow', title: 'Daily Trip Trend Comparison', workflow: { content: 'version: 1', definition: {
                name: 'Daily Trip Trend Comparison', overview: 'Compare daily trips', deliverables: ['Hourly chart'],
            } } } }));
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
            prompt: 'Review sales', content: 'Ready to review.', form: { kind: 'workflow', title: definition.name, workflow: proposal },
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
        expect(await screen.findByRole('dialog', { name: /^Run workflow:/ })).toBeInTheDocument();
        expect(screen.getByLabelText('Period')).toHaveValue('Q1');
        expect(streamRequest).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string)).toMatchObject({
            content: proposal.content, setup: { parameters: { period: 'Q1' }, instructions: '' },
        });
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.workflow)?.workflow?.status).toBe('completed'));
    });

    it('saves a proposed workflow together with the schedule proposed with it', async () => {
        const definition = { name: 'Quarterly review', overview: 'Review current sales', deliverables: ['Sales report'],
            parameters: [{ name: 'period', label: 'Period', default: 'Q1' }] };
        const proposal = { definition, content: 'version: 1\nname: Quarterly review\noverview: Review current sales\ndeliverables: [Sales report]',
            schedule: { config: { time: '08:00', weekdays: [0, 1, 2, 3, 4], model_id: 'server-model' }, issues: [] } };
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'scheduled-proposal', displayId: 'Proposal', textKind: 'explain',
            content: 'Ready to review.', form: { kind: 'workflow', title: definition.name, workflow: proposal },
            parentNodeId: 'conversation-root:authoring', createdAt: 1 }));
        vi.mocked(apiRequest).mockImplementation(async (url, options) => {
            if (url === '/api/workflows/save') return { data: { path: JSON.parse(options!.body as string).path, content_hash: 'saved-hash' } } as any;
            if (url === '/api/schedules' && options?.method === 'POST') return { data: { schedule: { id: 'schedule-1', next_at: '2026-10-12T15:00:00Z' } } } as any;
            if (url === '/api/schedules') return { data: { available: true, schedules: [] } } as any;
            return { data: { items: [], runs: [], drafts: [] } } as any;
        });
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'scheduled-proposal' }));
        render(<Provider store={store}><VisualizationViewFC /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Save workflow' }));
        const dialog = await screen.findByRole('dialog', { name: 'Save workflow' });
        expect(await within(dialog).findByRole('checkbox', { name: 'Also run it on a schedule' })).toBeChecked();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save and schedule' }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save workflow' })).not.toBeInTheDocument());
        // The schedule runs the workflow just saved, with its default inputs.
        const scheduled = JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url, options]) => url === '/api/schedules' && options?.method === 'POST')![1]!.body as string);
        expect(scheduled.config).toMatchObject({ workflow: 'quarterly-review.workflow.yaml', name: 'Quarterly review', time: '08:00',
            weekdays: [0, 1, 2, 3, 4], model_id: 'server-model', setup: { parameters: { period: 'Q1' } } });
        const saved = store.getState().textTurns.find((turn: any) => turn.id === 'scheduled-proposal')!.form as any;
        expect(saved.workflow.saved.path).toBe('quarterly-review.workflow.yaml');
        expect(saved.workflow.schedule).toMatchObject({ savedId: 'schedule-1', nextAt: '2026-10-12T15:00:00Z' });
        expect(screen.getByText(/^Scheduled /)).toBeInTheDocument();
    });

    it('formats definition sections and saves a renamed workflow without losing YAML fields', async () => {
        const proposal = { content: 'version: 1\nname: Daily trips\noverview: Compare trips\ndeliverables: [Chart]\nsource:\n  fixed_date: 2011-01-10\n',
            definition: { name: 'Daily trips', overview: 'Compare **daily trips**.', prompt: 'Compare hourly totals.',
                source: { table_name: 'Trips', filters: [{ pickup_date: '2011-01-10' }] }, deliverables: ['Hourly **chart**'],
                parameters: [{ name: 'period', label: 'Period', type: 'select' as const, required: true, default: 'Daily', options: ['Daily', 'Weekly'] }],
                steps: [{ id: 'compare', description: 'Aggregate hourly pickups', instructions: 'Aggregate trips by **hour**.',
                    checkers: [{ id: 'coverage', condition: 'Both days contain all 24 hours.', on_fail: 'compare' }] }] } };
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'formatted-definition', displayId: 'Definition', textKind: 'explain',
            content: 'Ready', form: { kind: 'workflow', title: 'Daily trips', workflow: proposal }, parentNodeId: 'conversation-root:authoring', createdAt: 1 }));
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
        expect(store.getState().textTurns.find(turn => turn.id === 'formatted-definition')?.form).toMatchObject({ title: 'My daily trips', workflow: {
            content: saved.content, definition: { name: 'My daily trips' }, saved: { content_hash: 'new-hash' },
        } });
        expect(streamRequest).not.toHaveBeenCalled();
    });

    it('lets a revision update its target workflow or save a new copy', async () => {
        const proposal = { content: 'version: 1\nname: Fuel', definition: { name: 'Fuel', overview: 'Review', deliverables: ['Report'] },
            target: { id: 'fuel.workflow.yaml', name: 'Fuel' } };
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'revision', displayId: 'Revision', textKind: 'explain', content: 'Revised.',
            form: { kind: 'workflow', title: 'Fuel', workflow: proposal }, parentNodeId: 'conversation-root:authoring', createdAt: 1 }));
        vi.mocked(apiRequest).mockImplementation(async (url, options) => {
            if (url === '/api/workflows/read') return { data: { content: '', content_hash: 'target-hash' } } as any;
            if (url === '/api/workflows/save') return { data: { path: JSON.parse(options!.body as string).path, content_hash: 'new-hash' } } as any;
            return { data: {} } as any;
        });
        const saves = () => vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/workflows/save')
            .map(([, options]) => JSON.parse(options!.body as string));
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'revision' }));
        render(<Provider store={store}><VisualizationViewFC /></Provider>);
        expect(screen.getByText('Workflow definition · revises Fuel')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save workflow' }));
        await act(async () => {});
        expect(screen.getByRole('radio', { name: 'Update Fuel' })).toBeChecked();
        expect(screen.queryByLabelText('Workflow filename', { exact: false })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        await waitFor(() => expect(saves()).toHaveLength(1));
        expect(saves()[0]).toEqual({ path: 'fuel.workflow.yaml', content: proposal.content, content_hash: 'target-hash' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Save workflow' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Save as new workflow' }));
        expect(screen.getByLabelText('Workflow filename', { exact: false })).toHaveValue('fuel-2.workflow.yaml');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(saves()).toHaveLength(2));
        expect(saves()[1]).toEqual({ path: 'fuel-2.workflow.yaml', content: proposal.content });
        await waitFor(() => expect(store.getState().textTurns.find(turn => turn.id === 'revision')?.form)
            .toMatchObject({ workflow: { saved: { path: 'fuel-2.workflow.yaml' } } }));
    });

    it('offers agent authoring from the create dialog without changing conversation focus', async () => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'context', displayId: 'Context', textKind: 'explain',
            content: 'Sales increased in Q2.', parentNodeId: 'conversation-root:sales', createdAt: 1 }));
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'context' }));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [], runs: [] } });
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'New workflow' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'New workflow' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'New workflow' }));
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
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
        expect(screen.getByRole('dialog', { name: 'Workflows' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create with agent' })).toBeNull();
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
        await screen.findByRole('button', { name: `Open ${demo.name}` });
        const workflows = screen.getByRole('region', { name: 'Workflows' });
        expect(workflows).toHaveTextContent(demo.name);
        expect(workflows).toHaveTextContent(server.name);
        expect(workflows).toHaveTextContent(user.name);
        const cards = within(workflows).getAllByRole('article');
        expect(cards).toHaveLength(3);
        expect(cards[0]).toHaveTextContent(user.name);
        expect(screen.getByRole('button', { name: `Open ${demo.name}` })).toHaveTextContent(/demo$/);
        expect(screen.getByRole('button', { name: `Open ${user.name}` })).not.toHaveTextContent(/demo$/);
        expect(screen.queryByText('Workspace workflows')).not.toBeInTheDocument();
        expect(screen.queryByText('Demo workflows')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: `Open ${user.name}` }));
        expect(await screen.findByRole('button', { name: `Delete ${user.path}` })).toBeTruthy();
        const workflowList = screen.getByRole('navigation', { name: 'Workflow list' });
        fireEvent.click(within(workflowList).getByRole('button', { name: new RegExp(demo.name) }));
        await waitFor(() => expect(screen.getByLabelText('Workflow filename')).toHaveValue('household-cost-review-copy-2.yaml'));
        expect(screen.queryByRole('button', { name: `Delete ${demo.path}` })).toBeNull();
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/workflows/read').at(-1)![1]!.body as string)).toEqual({ path: demo.path });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/workflows/save', expect.anything()));
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/save')![1]!.body as string).path).toBe('household-cost-review-copy-2.yaml');
        expect(JSON.parse(vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/workflows/save')![1]!.body as string).content_hash).toBeUndefined();
    });

    it.each([false, true])('shows example workflow cards before user workflows and opens setup (composed: %s)', async composed => {
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [
            { path: 'mine.yaml', name: 'My review', origin: 'user', overview: 'My saved analysis' },
            { path: 'demo/prices.yaml', name: 'Price review', origin: 'demo', overview: 'Compare prices' },
        ], runs: [] } });
        render(<Provider store={store}><WorkflowPanel presentation="landing" onCreateSession={vi.fn()}
            renderLanding={composed ? ({ examples, saved, toolbar }) => <>
                <section aria-label="Examples">{examples}</section>
                <section aria-label="Saved library">{toolbar}{saved}</section>
            </> : undefined} /></Provider>);
        const demo = await screen.findByRole('button', { name: 'Run Price review' });
        const examples = screen.getByRole('region', { name: 'Example workflows' });
        const user = screen.getByRole('region', { name: 'Your workflows' });
        expect(examples.compareDocumentPosition(user) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(examples).toHaveTextContent('Compare prices');
        expect(within(user).getByRole('article')).toHaveTextContent('My review');
        expect(within(examples).getByRole('article').querySelector('[data-workflow-gears="idle"]')).toBeInTheDocument();
        expect(within(user).getByRole('article').querySelector('[data-workflow-gears="idle"]')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Example workflows' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Customize Price review' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit My review' })).toBeNull();
        expect(within(examples).getByRole('article')).toContainElement(demo);
        expect(demo).toHaveTextContent('Compare prices');
        expect(within(demo).getByTestId('PlayArrowIcon')).toBeInTheDocument();
        expect(within(examples).getAllByRole('button')).toHaveLength(1);
        expect(within(user).getByRole('button', { name: 'Delete mine.yaml' })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'New workflow' })).toHaveLength(1);
        if (composed) expect(within(screen.getByRole('region', { name: 'Saved library' })).getByRole('button', { name: 'New workflow' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Delete demo/prices.yaml' })).toBeNull();
        fireEvent.click(demo);
        const setup = await screen.findByRole('dialog', { name: 'Run workflow: Price review' });
        expect(within(setup).getByRole('heading', { name: 'Run workflow: Price review' })).toBeInTheDocument();
        expect(within(setup).getAllByText('Price review', { exact: true })).toHaveLength(1);
        expect(streamRequest).not.toHaveBeenCalled();
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
        expect(screen.getByRole('dialog', { name: /^Run workflow:/ })).toBeTruthy();
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

    it('starts a landing workflow when creating a session unmounts the library', async () => {
        store.dispatch(dfActions.setActiveWorkspace(null));
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [{ path: 'prices.yaml', name: 'Prices' }], runs: [] } });
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...run(), status: 'completed', outputs: [] } } as any;
        });
        const HomeLibrary = () => {
            const inSession = useSelector(dfSelectors.selectInSession);
            return inSession ? <div>Session opened</div> : <WorkflowPanel presentation="landing" onCreateSession={displayName => {
                store.dispatch(dfActions.resetForNewWorkspace({ id: 'landing-run', displayName }));
            }} />;
        };
        render(<Provider store={store}><HomeLibrary /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Run Prices' }));
        fireEvent.change(screen.getByLabelText('Additional instructions'), { target: { value: 'Keep the setup.' } });
        fireEvent.click(screen.getByRole('button', { name: 'New session' }));
        expect(await screen.findByText('Session opened')).toBeInTheDocument();
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        expect(JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string)).toMatchObject({
            path: 'prices.yaml', setup: { parameters: {}, instructions: 'Keep the setup.' },
        });
    });

    it.each([
        { hasWorkspace: true, presentation: 'sidebar' as const },
        { hasWorkspace: false, presentation: 'landing' as const },
    ])('preserves setup until a new workspace is ready ($presentation, existing workspace: $hasWorkspace)', async ({ hasWorkspace, presentation }) => {
        if (!hasWorkspace) store.dispatch(dfActions.setActiveWorkspace(null));
        store.dispatch(dfActions.setDataSourceSidebarOpen(true));
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        vi.mocked(apiRequest).mockResolvedValue({ data: { items: [{ path: 'prices.yaml', name: 'Prices' }], runs: [] } });
        vi.mocked(streamRequest).mockImplementation(async function* () {
            yield { type: 'workflow_state', run: { ...run(), status: 'completed', outputs: [] } } as any;
        });
        const createSession = vi.fn();
        render(<Provider store={store}><WorkflowPanel presentation={presentation} onCreateSession={createSession} /></Provider>);
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

    it('collapses the sidebar after opening a workflow run from its card', async () => {
        store.dispatch(dfActions.setDataSourceSidebarOpen(true));
        const snapshot = { ...run(), status: 'completed', outputs: [] };
        vi.mocked(apiRequest).mockImplementation(async url => ({ data: url === '/api/workflows/run-state'
            ? { run: snapshot }
            : { items: [{ path: 'recent.yaml', name: 'Recent review' }], runs: [{ ...snapshot, name: 'Recent review', workflow_path: 'recent.yaml' }] } }) as any);
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        expect(within(await screen.findByRole('group', { name: 'Previous runs of Recent review' })).getAllByRole('button')).toHaveLength(1);
        fireEvent.click(await screen.findByRole('button', { name: 'Open Recent review' }));
        fireEvent.click(within(await screen.findByRole('group', { name: 'Runs of Recent review' })).getAllByRole('button')[0]);
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
        // The question stays in the chain, answered, followed by the reply; both go right before the record.
        const turnById = (id: string) => store.getState().textTurns.find(item => item.id === id);
        expect(turnById('textTurn-workflow-question-native-question')).toMatchObject({ textKind: 'clarify', answered: true,
            parentNodeId: 'workflow-report-native', options: [expect.objectContaining({ text: 'Which date range should I use?' })] });
        expect(turnById('textTurn-workflow-reply-native-question')).toMatchObject({ prompt: 'Last quarter', content: '',
            parentNodeId: 'textTurn-workflow-question-native-question' });
        expect(turnById(turn.id)!.parentNodeId).toBe('textTurn-workflow-reply-native-question');
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

    it('advances streaming reports in stages, pauses for reading, and preserves the final position', () => {
        let resize = () => {};
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: () => void) { resize = callback; }
            observe() {} unobserve() {} disconnect() {}
        });
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => frames.push(callback)));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const report = { id: 'staged-report', title: 'Review', content: '# Writing', status: 'generating' as const,
            generatingPhase: 'writing' as const, selectedChartIds: [], createdAt: 1 };
        store.dispatch(dfActions.saveGeneratedReport(report));
        store.dispatch(dfActions.setFocused({ type: 'report', reportId: report.id }));
        const { container } = render(<Provider store={store}><ThemeProvider theme={createTheme()}>
            <ReportView />
        </ThemeProvider></Provider>);
        const scroller = container.querySelector('[data-report-scroll]') as HTMLDivElement;
        const content = container.querySelector('[data-report-content]') as HTMLDivElement;
        let contentHeight = 500;
        Object.defineProperty(scroller, 'clientHeight', { value: 600 });
        vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => ({ top: 0 } as DOMRect));
        vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => ({ height: contentHeight, bottom: contentHeight - scroller.scrollTop } as DOMRect));
        const grow = (height: number) => act(() => {
            contentHeight = height;
            resize();
            frames.splice(0).forEach(callback => callback(0));
        });
        grow(500);
        expect(scroller.scrollTop).toBe(0);
        grow(580);
        expect(scroller.scrollTop).toBe(190);
        grow(650);
        expect(scroller.scrollTop).toBe(190);
        grow(780);
        expect(scroller.scrollTop).toBe(390);
        fireEvent.wheel(scroller, { deltaY: -60 });
        scroller.scrollTop = 200;
        fireEvent.scroll(scroller);
        grow(1000);
        expect(scroller.scrollTop).toBe(200);
        expect(screen.getByRole('button', { name: 'Jump to latest' })).toHaveStyle({ left: '24px', bottom: '20px' });
        fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }));
        grow(1000);
        expect(scroller.scrollTop).toBe(610);
        expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
        const reportFrame = content.parentElement as HTMLElement;
        const space = reportFrame.nextElementSibling as HTMLElement;
        expect(space.style.height).toBe('210px');
        expect(reportFrame.style.minHeight).toBe('1000px');
        act(() => store.dispatch(dfActions.updateGeneratedReportContent({ id: report.id, status: 'completed', content: '# Finished' })));
        expect(scroller.scrollTop).toBe(610);
        expect(space.style.height).toBe('210px');
        expect(reportFrame.style.minHeight).toBe('1000px');
        expect(content.contains(space)).toBe(false);
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

    it.each([false, true])('continues an interrupted checkpoint without synthesizing a question (canvas=%s)', async canvas => {
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
            questions: [{ text: snapshot.message, responseType: 'free_text' }] } }} interactionOnly={!canvas} canvas={canvas} /></Provider>);
        if (!canvas) expect(screen.getByText('Interrupted')).toBeTruthy();
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByText('Respond to agent')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: canvas ? 'Resume' : 'Continue workflow' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(1));
        const body = JSON.parse(vi.mocked(streamRequest).mock.calls[0][1]!.body as string);
        expect(body.run_id).toBe(snapshot.id);
        expect(body.reply).toBeUndefined();
        await waitFor(() => expect(store.getState().textTurns[0].workflow?.status).toBe('completed'));
    });

    it('detaches on session switch without pausing backend execution', async () => {
        store.dispatch(dfActions.addModel({ id: 'test-model', model: 'test', endpoint: '', api_key: '' } as any));
        store.dispatch(dfActions.selectModel('test-model'));
        const snapshot = { ...run(), outputs: [], status: 'paused' };
        await publishWorkflowRun(snapshot, 'session');
        let signal: AbortSignal | undefined;
        let detached = false;
        vi.mocked(streamRequest).mockImplementation(async function* (_url, _options, abortSignal) {
            signal = abortSignal;
            const disconnected = new Promise<void>(resolve => abortSignal?.addEventListener('abort', () => resolve(), { once: true }));
            yield { type: 'workflow_state', run: { ...snapshot, status: 'running' } } as any;
            await disconnected;
            detached = true;
        });
        const rendered = render(<Provider store={store}><WorkflowProgress turn={store.getState().textTurns[0]} interactionOnly /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Continue workflow' }));
        await waitFor(() => expect(store.getState().textTurns[0].workflow?.status).toBe('running'));
        act(() => store.dispatch(dfActions.setActiveWorkspace({ id: 'another-session', displayName: 'Other session' })));
        await waitFor(() => expect(detached).toBe(true));
        expect(signal?.aborted).toBe(true);
        expect(store.getState().textTurns[0].workflow?.status).toBe('running');
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === '/api/workflows/pause')).toBe(false);
        rendered.unmount();
    });

    it.each(['orphaned', 'unreachable'])('recovers a restored %s run without guessing its execution status', async failure => {
        const snapshot = run();
        await publishWorkflowRun(snapshot, 'session');
        const original = store.getState().textTurns[0];
        const outputIds = original.outputIds;
        vi.mocked(apiRequest).mockImplementation(async () => {
            if (failure === 'unreachable') throw new Error('Backend unavailable');
            return { data: { run: {
                ...snapshot, status: 'paused', message: 'Execution interrupted: the workflow executor stopped.',
            } } } as any;
        });
        const { rerender } = render(<Provider store={store}><WorkflowRunObserver /><WorkflowProgress turn={original} /></Provider>);
        if (failure === 'unreachable') {
            await waitFor(() => expect(store.getState().textTurns[0].workflow?.activity).toBe('Reconnecting to workflow...'));
            expect(store.getState().textTurns[0].workflow?.status).toBe('running');
            expect(store.getState().textTurns[0].outputIds).toEqual(outputIds);
            return;
        }
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
            expect(signal?.aborted).toBe(health === 'orphaned');
            expect(store.getState().textTurns[0].workflow?.status).toBe(health === 'orphaned' ? 'paused' : 'running');
            if (health !== 'orphaned') await act(async () => { finish(); });
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
        expect(store.getState().textTurns.map(turn => turn.id).sort()).toEqual(['textTurn-workflow-native', 'textTurn-workflow-native-request']);
        expect(store.getState().textTurns.filter(turn => turn.prompt)).toHaveLength(1);
        // The completed record is the run's closing message.
        expect(store.getState().textTurns.find(turn => turn.id === 'textTurn-workflow-native')).toMatchObject({
            content: 'Workflow completed.', parentNodeId: 'workflow-report-native' });
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
        // KNOWN PRODUCT BUG (fails today): the completed record is the run's closing message, but the
        // thread renders it only as the progress card, so its response never appears in the thread.
        expect(text.indexOf(snapshot.message)).toBeGreaterThan(text.lastIndexOf('notes.txt'));
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
        snapshot.evidence = { observed: { tool: 'execute_python_script', text: 'Validated 61 rows', call: 2,
            input: { code: 'print("Validated 61 rows")' } } };
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

    it('keeps the chat for the analyst, with pause on the card and the shared interruption panel', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        await publishWorkflowRun(snapshot, 'session');
        renderThread();
        const input = screen.getByRole('textbox');
        const chat = input.closest('.MuiCard-root')!;
        expect(chat).not.toHaveTextContent('Step 2 of 2');
        expect(screen.queryByPlaceholderText('Message workflow...')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Pause workflow' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send to workflow' })).toBeNull();
        snapshot.activity = 'I am comparing the latest prices with the same month last year.';
        await act(async () => { await publishWorkflowRun(snapshot, 'session'); });
        expect(chat).not.toHaveTextContent(snapshot.activity);
        expect(store.getState().textTurns[0].workflow?.activity).toBe(snapshot.activity);
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/workflows/pause', expect.anything()));
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
        expect(container.querySelector('[data-workflow-step="gather"]')).toHaveTextContent('visited');
        expect(container.querySelector('[data-workflow-step="gather"] [data-workflow-execution]')).toHaveTextContent('1m 13s');
        expect(container.querySelector('[data-workflow-step="analyze"]')).toHaveTextContent('current');
        expect(container.querySelector('[data-workflow-step="analyze"] [data-workflow-execution]')).toHaveTextContent('10s');
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
            expect(activeStep()).toHaveTextContent('current');
            expect(activeStep()).toHaveTextContent('10s');
            act(() => vi.advanceTimersByTime(3000));
            expect(activeStep()).toHaveTextContent('13s');
            expect(container.querySelector('[data-workflow-step="gather"]')).toHaveTextContent('1m 12s');
            const action = container.querySelector('[data-workflow-current-action]')!;
            expect(action).toHaveTextContent('Inspect source data.');
            expect(action.previousElementSibling).toHaveTextContent(canvas ? 'Step 2 of 2' : '3 tool calls');
            expect(action.previousElementSibling).not.toHaveTextContent('Inspect source data.');
            if (canvas) {
                expect(activeStep().querySelector('[data-workflow-running-tool]')).toHaveTextContent('Weekly prices');
                expect(activeStep().querySelector('[data-workflow-running-tool]')).toHaveTextContent('Line Chart');
                expect(activeStep().querySelector('[data-workflow-running-tool]')).toHaveTextContent('Prices');
                expect(container.querySelector('[data-workflow-step="gather"] [data-workflow-running-tool]')).toBeNull();
            } else expect(action).toHaveTextContent('Weekly prices');
            await act(async () => { await publishWorkflowRun({ ...snapshot, step_elapsed_seconds: { gather: 72, analyze: 20 } }, 'session'); });
            rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas={canvas} />);
            expect(activeStep()).toHaveTextContent('20s');
            act(() => vi.advanceTimersByTime(2000));
            expect(activeStep()).toHaveTextContent('22s');
            await act(async () => { await publishWorkflowRun({ ...snapshot, status: 'paused', step_elapsed_seconds: { gather: 72, analyze: 22 } }, 'session'); });
            rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas={canvas} />);
            act(() => vi.advanceTimersByTime(5000));
            expect(activeStep()).toHaveTextContent('22s');
            expect(container.querySelector('[data-workflow-current-action]')).toBeNull();
            expect(container.querySelector('[data-workflow-running-tool]')).toBeNull();
        } finally {
            unmount();
            vi.useRealTimers();
        }
    });

    it('keeps a preview timeline with instructions and execution details closed by default', async () => {
        const snapshot = run();
        snapshot.outputs = [];
        snapshot.instance!.steps!.push({ id: 'report', description: 'Explain the findings', instructions: 'Write the final report.' });
        await publishWorkflowRun(snapshot, 'session');
        const { container, rerender } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        expect(screen.getByRole('list', { name: 'Workflow plan timeline' }).children).toHaveLength(3);
        expect(screen.queryByRole('tablist')).toBeNull();
        const report = within(container.querySelector('[data-workflow-step="report"]') as HTMLElement);
        expect(report.getByText('pending')).toBeVisible();
        expect(report.getByText('Write the final report.')).not.toBeVisible();
        fireEvent.click(report.getByText('Execution details'));
        expect(report.getByText('Write the final report.')).toBeVisible();
        expect(report.getByText('No activity yet.')).toBeVisible();
        fireEvent.click(report.getByText('Execution details'));
        await publishWorkflowRun({ ...snapshot, step_id: 'report' }, 'session');
        rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        expect(report.getByText('Write the final report.')).not.toBeVisible();
        expect(report.getByRole('progressbar', { name: 'Current step running' })).toBeVisible();
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
        expect(screen.getByText('regional revenue')).not.toBeVisible();
        expect(container.querySelector('[data-workflow-scroll]')?.parentElement).toHaveStyle({
            '--df-text-md': '0.875rem', '--df-text-sm': '0.8125rem', '--df-text-xs': '0.75rem',
        });
        // KNOWN PRODUCT BUG (fails today): WorkflowProgress titles the run from `turn.prompt`, which the
        // run record no longer carries (the request message does), so the heading falls back to "Workflow".
        expect(screen.getByRole('heading', { level: 1, name: 'Native review' })).toHaveStyle({ fontSize: '1.375rem' });
        expect(screen.getByText('Regional comparison chart')).not.toBeVisible();
        expect(screen.getByText('Summary report')).not.toBeVisible();
        const summary = screen.getByRole('region', { name: 'Workflow summary' });
        expect(container.textContent!.indexOf('Expected outputs')).toBeLessThan(container.textContent!.indexOf('Steps'));
        if (state === 'completed') {
            expect(within(summary).getByRole('heading', { name: 'Results' })).toBeVisible();
            expect(within(summary).getByText('Revenue increased in three regions.')).toBeVisible();
            expect(within(summary).queryByText('Planned next')).not.toBeInTheDocument();
        } else if (state === 'paused') {
            const header = screen.getByRole('banner', { name: 'Workflow status' });
            expect(within(header).getByText('Choose which regions to include.')).toBeVisible();
            expect(within(header).getByRole('button', { name: 'Resume' })).toBeVisible();
            expect(within(header).getByText('Step 2 of 3:')).toBeVisible();
            expect(within(header).queryByText(/tool calls/)).toBeNull();
        }
        expect(within(summary).queryByText(/^(Completed so far|Working on|Planned next|Reviewing the plan)$/)).not.toBeInTheDocument();
        expect(within(summary).getByText('Last quarter')).not.toBeVisible();
        fireEvent.click(within(summary).getByText('Workflow details'));
        expect(screen.getByText('regional revenue')).toBeVisible();
        expect(within(summary).getByText('Regional comparison chart')).toBeVisible();
        expect(within(summary).getByText('Summary report')).toBeVisible();
        expect(within(summary).getByText('Last quarter')).toBeVisible();
        expect(within(summary).getByText('Use matched reporting periods.')).toBeVisible();
        expect(within(summary).getByText('Exclude incomplete months.')).toBeVisible();
    });

    it('shows stopping immediately and waits for confirmed pause while retaining interrupted text', async () => {
        const snapshot = { ...run(), outputs: [] };
        await publishWorkflowRun(snapshot, 'session');
        const { rerender } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        expect(store.getState().textTurns[0].workflow).toMatchObject({ status: 'running', pauseRequested: true });
        await act(async () => { await publishWorkflowRun(snapshot, 'session'); });
        rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        expect(screen.getByText('Stopping...')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
        await pauseWorkflowRun(snapshot.id);
        expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/workflows/pause')).toHaveLength(1);
        await act(async () => { await publishWorkflowRun({ ...snapshot, status: 'paused',
            interrupted_response: 'Partial analysis, not finished.' }, 'session'); });
        rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        expect(screen.queryByText('Stopping...')).toBeNull();
        expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
        fireEvent.click(screen.getByText('Interrupted response'));
        expect(screen.getByText('Partial analysis, not finished.')).toBeVisible();
    });

    it('clears stopping when the pause request fails', async () => {
        await publishWorkflowRun({ ...run(), outputs: [] }, 'session');
        vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Pause unavailable'));
        await pauseWorkflowRun('native');
        expect(store.getState().textTurns[0].workflow).toMatchObject({ status: 'running', pauseRequested: false });
    });

    it('keeps typed running calls inside execution details and preserves manual expansion', async () => {
        const snapshot = run();
        snapshot.outputs = snapshot.outputs!.map(output => ({ ...output, step_id: 'analyze' }));
        snapshot.active_tool = { id: 'live', tool: 'execute_python_script', step_id: 'analyze', details: { purpose: 'Compare medians' }, input: { code: 'print(43)' } };
        snapshot.evidence = {
            inspected: { tool: 'list_workspace_items', text: 'Inputs found', step_id: 'analyze', call: 1, input: { scope: 'input' } },
            computed: { tool: 'execute_python_script', text: 'Median: 42', step_id: 'analyze', call: 2,
                details: { purpose: 'Calculate cohort median', filename: 'cohort.parquet' }, input: { code: 'print(42)' } },
            command: { tool: 'run_terminal', text: JSON.stringify({ result: { stdout: 'Downloaded sample', exit_code: 0 } }), step_id: 'analyze', call: 3, input: { argv: ['echo', 'sample file'] } },
        };
        await publishWorkflowRun(snapshot, 'session');
        const { container, rerender } = render(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        const step = container.querySelector('[data-workflow-step="analyze"]') as HTMLElement;
        expect(within(step).queryByRole('tab')).toBeNull();
        const execution = step.querySelector('[data-workflow-execution]')!;
        expect(execution).not.toHaveAttribute('open');
        fireEvent.click(within(step).getByText('Execution details'));
        expect(execution).toHaveAttribute('open');
        const live = step.querySelector('[data-workflow-running-tool="live"]')!;
        expect(live.querySelector('summary')).toBeVisible();
        expect(live).toHaveAttribute('data-workflow-call-type', 'python');
        expect(live).not.toHaveAttribute('open');
        expect(live.querySelector('code.language-python')).not.toBeVisible();
        expect(live.querySelector('code.language-python')?.textContent).toBe('print(43)');
        expect(live).toHaveTextContent('Compare medians');
        const computed = step.querySelector('[data-workflow-call="computed"]') as HTMLElement;
        expect(within(computed).getAllByText(/Calculate cohort median/)).toHaveLength(1);
        expect(computed.querySelector('dl')).not.toHaveTextContent('Calculate cohort median');
        expect(computed.querySelector('dl')).toHaveTextContent('cohort.parquet');
        const firstCall = step.querySelector('[data-workflow-call="inspected"]')!;
        expect(live.compareDocumentPosition(firstCall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        for (const [id, type, icon] of [['inspected', 'tool', 'BuildOutlinedIcon'], ['computed', 'python', 'CodeIcon'], ['command', 'terminal', 'TerminalIcon']]) {
            const call = step.querySelector(`[data-workflow-call="${id}"]`)!;
            expect(call).toHaveAttribute('data-workflow-call-type', type);
            expect(call.querySelector(`[data-testid="${icon}"]`)).not.toBeNull();
        }
        expect(step.querySelector('[data-workflow-call="inspected"] code.language-json')?.textContent).toBe(JSON.stringify({ scope: 'input' }, null, 2));
        expect(step.querySelector('[data-workflow-call="computed"] code.language-python')?.textContent).toBe('print(42)');
        expect(step.querySelector('[data-workflow-call="command"] code.language-bash')?.textContent).toBe("echo 'sample file'");
        expect(step.querySelector('[data-workflow-call="command"]')).toHaveTextContent('Downloaded sample');
        expect(step.querySelector('[data-workflow-call="command"]')).toHaveTextContent('Exit code: 0');
        fireEvent.click(live.querySelector('summary')!);
        expect(live.querySelector('code.language-python')).toBeVisible();
        snapshot.evidence.live = { tool: 'execute_python_script', text: '43', step_id: 'analyze', call: 4, input: { code: 'print(43)' } };
        await publishWorkflowRun({ ...snapshot, active_tool: undefined }, 'session');
        rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        const completed = step.querySelector('[data-workflow-call="live"]')!;
        expect(completed).toBe(live);
        expect(completed).toHaveAttribute('open');
        expect(completed.querySelector('code.language-python')).toBeVisible();
        expect(step.querySelector('[data-workflow-call="computed"]')).not.toHaveAttribute('open');
        fireEvent.click(within(step).getByText('Execution details'));
        await publishWorkflowRun({ ...snapshot, activity: 'Still comparing medians' }, 'session');
        rerender(<WorkflowProgress turn={store.getState().textTurns[0]} canvas />);
        expect(execution).not.toHaveAttribute('open');
        expect(live).not.toBeVisible();
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
        expect(within(gather as HTMLElement).queryByRole('tab')).toBeNull();
        expect(actionPreview).not.toBeVisible();
        expect(screen.getByText('Requested dates and regions are covered.')).not.toBeVisible();
        expect(screen.getByText('Totals reconcile to the source data.')).not.toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByText('Execution details'));
        expect(screen.getByText('Requested dates and regions are covered.')).toBeVisible();
        expect(actionPreview).toBeVisible();
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
        expect(gather.querySelector('[data-workflow-activity]')).toBeVisible();
        fireEvent.click(within(gather as HTMLElement).getByText('Call 1: fetch live data'));
        const inputOutput = within(gather as HTMLElement).getByRole('group', { name: 'Tool input' });
        expect(inputOutput).toBeVisible();
        expect(inputOutput).toHaveTextContent('Input not retained for this call.');
        expect(within(inputOutput).queryByRole('button', { name: 'Copy input' })).toBeNull();
        expect(JSON.parse(inputOutput.querySelector('pre')!.textContent!)).toEqual({ rows: 61, metadata: { source: 'live' } });
        expect(screen.getByText('Observed rows')).not.toBeVisible();
        fireEvent.click(gather.querySelector('[data-workflow-check="coverage"] summary')!);
        expect(screen.getByText('Observed rows')).toBeVisible();
        expect(screen.getByText('Before this step · On failure: gather')).toBeVisible();
        expect(screen.getByText('Collect data')).toBeVisible();
        expect(within(gather as HTMLElement).queryByText('No outputs yet.')).toBeNull();
        fireEvent.click(within(gather as HTMLElement).getByText('Execution details'));
        expect(screen.getByText('Collect data')).not.toBeVisible();
        expect(screen.getByText('Observed rows')).not.toBeVisible();
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
        expect(gather.querySelector('[data-workflow-connector]')).toHaveStyle('border-left-width: 2px; border-left-color: #2e7d32; left: 11px');
        expect(gather.querySelector('[data-workflow-marker] .MuiSvgIcon-root')).toHaveStyle('font-size: 16px');
        for (const artifact of container.querySelectorAll('[data-workflow-artifact]')) {
            const style = getComputedStyle(artifact);
            expect(style.borderTopStyle).toBe('solid');
            expect(style.borderTopWidth).toBe('1px');
            expect(style.minWidth).toBe('0px');
            expect(style.boxSizing).toBe('border-box');
        }
        expect(gather.querySelector('[data-workflow-artifacts]')).toBeVisible();
        expect(analyze.querySelector('[data-workflow-artifacts]')).toBeVisible();
        expect(screen.queryByRole('tablist')).toBeNull();
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

    it('restores missing call inputs once without changing saved outputs or focus', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        snapshot.outputs = [];
        snapshot.instance!.overview = 'Saved review';
        snapshot.evidence = { python: { tool: 'execute_python_script', text: '42', step_id: 'analyze' } };
        await publishWorkflowRun(snapshot, 'session');
        const before = store.getState();
        const turn = before.textTurns[0];
        vi.mocked(apiRequest).mockClear();
        vi.mocked(apiRequest).mockResolvedValueOnce({ data: { run: { ...snapshot, evidence: {
            python: { ...snapshot.evidence.python, input: { code: 'print(42)' } },
        } } } } as any);
        const { container, rerender } = render(<WorkflowProgress turn={turn} canvas />);
        await waitFor(() => expect(container.querySelector('[data-workflow-call="python"] code.language-python')?.textContent).toBe('print(42)'));
        rerender(<WorkflowProgress turn={turn} canvas />);
        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(store.getState().textTurns[0]).toEqual(turn);
        expect(store.getState().focusedId).toEqual(before.focusedId);
        expect(store.getState().generatedReports).toEqual(before.generatedReports);
    });

    it('includes the report once as an ordered conversation node rather than a turn attachment', async () => {
        const snapshot = run();
        snapshot.status = 'completed';
        await publishWorkflowRun(snapshot, 'session');
        const thread = buildThreads(dfSelectors.getThreadGraph(store.getState())).find(item => item.nodeIds.includes('chart_values'))!;
        const nodes = thread.nodeIds;
        expect(nodes.indexOf('chart_values')).toBeLessThan(nodes.indexOf('workflow-report-native'));
        expect(nodes.indexOf('workflow-report-native')).toBeLessThan(nodes.indexOf('textTurn-workflow-native'));
        expect(nodes.filter(id => id === 'workflow-report-native')).toHaveLength(1);
        render(<Provider store={store}><ConversationCanvas textTurnId={thread.key} nodeIds={nodes} /></Provider>);
        const report = screen.getAllByRole('button', { name: 'Native review' });
        expect(report).toHaveLength(1);
        fireEvent.click(report[0]);
        expect(store.getState().focusedId).toEqual({ type: 'report', reportId: 'workflow-report-native' });
    });

    it('uses authored output order without special placement rules for reports', async () => {
        // Outputs join the run's chain in the order the run produced them, a report included.
        const snapshot = run();
        const [data, file, chart, report] = snapshot.outputs!;
        snapshot.outputs = [data, report, file, chart];
        await publishWorkflowRun(snapshot, 'session');
        const thread = buildThreads(dfSelectors.getThreadGraph(store.getState())).find(item => item.nodeIds.includes('chart_values'))!;
        expect(thread.nodeIds).toEqual(['textTurn-workflow-native-request', 'workflow-data-native-measurements', 'workflow-report-native',
            'file-notes.txt', 'textTurn-workflow-step-native-chart', 'chart_values', 'textTurn-workflow-native']);
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
        await waitFor(() => expect(store.getState().textTurns.some(item => item.id === turn.id)).toBe(false));
        const state = store.getState();
        expect(state.inputTables).toHaveLength(1);
        expect(state.derivedTables).toHaveLength(1);
        expect(state.generatedReports).toHaveLength(1);
        expect(state.fileNodes).toHaveLength(1);
        expect([state.loadedTableNodes[0], state.fileNodes[0], state.derivedTables[0], state.generatedReports[0]]
            .map(artifact => artifact.parentNodeId)).toEqual(['textTurn-workflow-delete-completed-request',
                'workflow-data-delete-completed-measurements', 'textTurn-workflow-step-delete-completed-chart', 'chart_values']);
        // The run's request and step messages stay with the artifacts they lead to.
        expect(state.textTurns.map(item => item.id).sort()).toEqual(['textTurn-workflow-delete-completed-request',
            'textTurn-workflow-step-delete-completed-chart']);
        expect(apiRequest).not.toHaveBeenCalled();
        await publishWorkflowRun(snapshot, 'session');
        expect(store.getState().textTurns.some(item => item.id === turn.id)).toBe(false);
    });

    it('confirms the filename before deleting a saved workflow and preserves same-titled instances', async () => {
        const items = [{ path: 'old.yaml', name: 'Review' }, { path: 'native.yaml', name: 'Review' }];
        vi.mocked(apiRequest).mockImplementation(async (url) => ({ data: url === '/api/workflows/list'
            ? { items, runs: [] } : url === '/api/workflows/read' ? { content: 'version: 1' } : { path: 'old.yaml' } }) as any);
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click((await screen.findAllByRole('button', { name: 'Open Review' }))[0]);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete old.yaml' }));
        expect(screen.getByText('Delete workflow?').closest('[role="dialog"]')!.textContent).toContain('old.yaml');
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === '/api/workflows/delete')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByText('Delete workflow?')).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Delete old.yaml' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(apiRequest).toHaveBeenCalledWith('/api/workflows/delete', expect.objectContaining({ body: JSON.stringify({ path: 'old.yaml' }) }));
        expect(screen.getAllByRole('button', { name: 'Open Review' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Open Review' }));
        expect(await screen.findByRole('button', { name: 'Delete native.yaml' })).toBeTruthy();
    });

    it('keeps a saved workflow when deletion fails', async () => {
        vi.mocked(apiRequest).mockImplementation(async (url) => {
            if (url === '/api/workflows/delete') throw new Error('Deletion failed');
            return { data: url === '/api/workflows/read' ? { content: 'version: 1' } : { items: [{ path: 'old.yaml', name: 'Review' }], runs: [] } } as any;
        });
        render(<Provider store={store}><WorkflowPanel onCreateSession={vi.fn()} /></Provider>);
        fireEvent.click(await screen.findByRole('button', { name: 'Open Review' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Delete old.yaml' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(store.getState().messages.some(message => message.value === 'Deletion failed')).toBe(true));
        expect(screen.getByText('Delete workflow?').closest('[role="dialog"]')!.textContent).not.toContain('Deletion failed');
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
        // The run produced nothing, so its request goes with it; the late update does not bring either back.
        expect(store.getState().textTurns).toEqual([]);
    });
});