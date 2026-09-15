import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { SimpleChartRecBox } from '../../../../src/views/SimpleChartRecBox';
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
            expect(screen.getByTestId('explanation-panel').textContent).toBe('Which metric?');
            await act(async () => { finishRun(); });
        },
    );

    it.each([undefined, 'long_response'])('uses completion presentation, not length, for the existing response card: %s', async (presentation) => {
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
            expect(dfSelectors.selectCanvasTarget(store.getState())).toBeUndefined();
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