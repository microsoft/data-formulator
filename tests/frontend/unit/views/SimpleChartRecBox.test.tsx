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
        <button onClick={() => onSubmit([{ question_index: 0, answer: 'Revenue', source: 'option' }])}>Submit clarification</button>
    ),
    ExplanationPanel: ({ content }: { content: string }) => <div data-testid="explanation-panel">{content}</div>,
    FailedDraftPanel: () => null,
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

    it('keeps agent loading cards until the published table is registered', async () => {
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
        expect(screen.getByRole('button', { name: 'Generate a report' })).toBeEnabled();
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Count events by region' } });
        expect(screen.getByRole('button', { name: 'Explore', exact: true })).toBeEnabled();
        if (method === 'enter') fireEvent.keyDown(input, { key: 'Enter' });
        else fireEvent.click(screen.getByRole('button', { name: 'Explore', exact: true }));
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
            expect(derived?.derive?.trigger.interaction.at(-1)?.inputTableNames).toEqual(['Measurements']);
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

    it('keeps a form-associated chat turn focused when clicking outside the composer', async () => {
        const { store } = mountTask();
        act(() => {
            store.dispatch(dfActions.addTextTurn({
                kind: 'text', id: 'form-owner', displayId: 'form-owner', textKind: 'explain',
                content: 'Connect MySQL', createdAt: 1,
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
                content: 'An unrelated answer.', createdAt: 3,
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

    it.each(['approve', 'reject'] as const)('resumes a terminal proposal only after explicit %s and records its outcome', async decision => {
        const proposal = { id: 'terminal-request', argv: ['find', '/data', '-name', '*.csv'],
            cwd: '/data', purpose: 'Find CSV data', timeout_seconds: 60 };
        const trajectory = [{ role: 'user', content: 'Find local data' }];
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'interact', terminal_request: proposal, trajectory, completed_step_count: 2 } as any;
        });
        const { store } = mountTask({ text: 'Find local data', images: [], attachments: [] });
        await screen.findByRole('dialog');
        expect(streamRequest).toHaveBeenCalledTimes(1);
        const originalConversation = requestBody().conversation_id;
        expect(store.getState().textTurns).toHaveLength(1);
        const intentId = store.getState().textTurns[0].id;
        expect(store.getState().textTurns[0]).toMatchObject({
            content: proposal.purpose,
            executions: [{ id: proposal.id, status: 'awaiting_approval', argv: proposal.argv }],
        });
        vi.mocked(streamRequest).mockImplementationOnce(async function* () {
            yield { type: 'terminal_running' };
            yield { type: 'terminal_result', request: proposal,
                result: decision === 'approve' ? { exit_code: 0, output: '/data/sales.csv' } : { rejected: true } } as any;
            yield { type: 'interact', form: { kind: 'connector', title: 'Local data',
                response: 'Review the discovered folder.', connector: { source_type: 'local_folder' } } } as any;
        });
        fireEvent.click(screen.getByRole('button', { name: decision === 'approve' ? 'Run once' : 'Reject' }));
        await waitFor(() => expect(streamRequest).toHaveBeenCalledTimes(2));
        expect(requestBody(1)).toMatchObject({
            conversation_id: originalConversation, trajectory, completed_step_count: 2,
            terminal_response: { request_id: proposal.id, decision },
        });
        expect(requestBody(1).terminal_response).not.toHaveProperty('argv');
        await waitFor(() => expect(store.getState().textTurns.some(turn => turn.form)).toBe(true));
        expect(store.getState().textTurns).toHaveLength(2);
        expect(store.getState().textTurns[0]).toMatchObject({
            id: intentId, content: proposal.purpose,
            executions: [{ id: proposal.id, status: decision === 'approve' ? 'completed' : 'rejected',
                result: decision === 'approve' ? { exit_code: 0, output: '/data/sales.csv' } : { rejected: true } }],
        });
        expect(store.getState().textTurns[1].parentNodeId).toBe(intentId);
        expect(screen.queryByRole('dialog')).toBeNull();
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
        await waitFor(() => expect(store.getState().draftNodes.every(draft => draft.status !== 'running')).toBe(true));
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