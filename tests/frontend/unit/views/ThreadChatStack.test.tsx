import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '../../../../src/app/store';
import { dfActions } from '../../../../src/app/dfSlice';
import { DataThread } from '../../../../src/views/DataThread';
import { LayoutProvider } from '../../../../src/app/LayoutProvider';
import type { TextTurn } from '../../../../src/components/ComponentType';

vi.mock('../../../../src/app/apiClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/app/apiClient')>(),
    apiRequest: vi.fn(async () => ({ data: { files: [], tables: [] } })), streamRequest: vi.fn(),
}));

const renderThread = () => render(<Provider store={store}><ThemeProvider theme={createTheme({
    palette: { custom: { main: '#a34d16' } },
} as any)}><LayoutProvider><DataThread /></LayoutProvider></ThemeProvider></Provider>);

/** A chat-only conversation: `exchanges` prompts, each answered by the agent. */
const chat = (exchanges: number) => {
    let parent: string | undefined;
    for (let index = 1; index <= exchanges; index++) {
        const prompt: TextTurn = { kind: 'text', id: `p${index}`, displayId: `p${index}`, textKind: 'explain', content: '',
            prompt: `Question ${index}`, createdAt: index * 2, ...(parent ? { parentNodeId: parent } : {}) } as TextTurn;
        const reply: TextTurn = { kind: 'text', id: `a${index}`, displayId: `a${index}`, textKind: 'explain', content: `Answer ${index}`,
            parentNodeId: prompt.id, createdAt: index * 2 + 1 } as TextTurn;
        store.dispatch(dfActions.addTextTurn(prompt));
        store.dispatch(dfActions.addTextTurn(reply));
        parent = reply.id;
    }
};

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setActiveWorkspace({ id: 'session', displayName: 'Session' }));
});

it('folds a long ongoing chat down to its last two requests', () => {
    chat(6);
    const { unmount } = renderThread();
    // 12 entries at the thread's open end: 8 fold, then the last two exchanges from their user messages.
    for (const hidden of ['Answer 1', 'Question 2', 'Answer 4']) expect(screen.queryByText(hidden)).toBeNull();
    for (const shown of ['Question 5', 'Answer 5', 'Question 6', 'Answer 6']) expect(screen.getByText(shown)).toBeInTheDocument();
    const stack = screen.getByRole('button', { name: '8 earlier messages' });
    expect(stack).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(stack);
    for (const shown of ['Answer 1', 'Question 2', 'Answer 4']) expect(screen.getByText(shown)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fold 8 messages' }));
    expect(screen.queryByText('Answer 1')).toBeNull();
    unmount();
});

it('leaves short chats alone and keeps the focused entry out of the stack', () => {
    chat(2);
    const { unmount } = renderThread();
    expect(screen.queryByRole('button', { name: /earlier messages/ })).toBeNull();
    unmount();

    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setActiveWorkspace({ id: 'session', displayName: 'Session' }));
    chat(6);
    act(() => { store.dispatch(dfActions.setFocused({ type: 'text', textId: 'a3' })); });
    const view = renderThread();
    // Answer 3 splits the folded stretch: Question 1 … Question 3, then Question 4 and Answer 4.
    expect(document.querySelector('[data-thread-item="textturn-a3"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5 earlier messages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 earlier messages' })).toBeInTheDocument();
    view.unmount();
});

it('drops a completed plan from the thread but keeps one with steps left open', () => {
    const plan = (done: number) => ['Fetch the forecast', 'Build the map'].map((text, index) =>
        ({ text, status: index < done ? 'done' as const : 'open' as const }));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'ask', textKind: 'explain', content: '',
        prompt: 'Map the temperature', createdAt: 1 } as TextTurn));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'done', displayId: 'done', textKind: 'explain', content: 'Created the map',
        parentNodeId: 'ask', createdAt: 2, plan: plan(2), planTitle: 'Hourly temperature' } as TextTurn));
    const { unmount } = renderThread();
    expect(screen.getByText('Created the map')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Completed 2\/2/ })).toBeNull();
    unmount();

    store.dispatch(dfActions.updateTextTurn({ id: 'done', plan: plan(1) }));
    const view = renderThread();
    expect(screen.getByRole('button', { name: /Plan 1\/2: Hourly temperature/ })).toBeInTheDocument();
    view.unmount();
});

it('shows a repair the app asked for on its own as one quiet row, not as messages', () => {
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'ask', textKind: 'explain', content: '',
        prompt: 'Make an app of the projects', createdAt: 1 } as TextTurn));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'made', displayId: 'made', textKind: 'explain', content: 'Made the app',
        parentNodeId: 'ask', createdAt: 2 } as TextTurn));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'repair', displayId: 'repair', textKind: 'explain', content: '',
        prompt: 'TypeError: sortBy is not a function', auto: 'app-repair', parentNodeId: 'made', createdAt: 3 } as TextTurn));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'fixed', displayId: 'fixed', textKind: 'explain',
        content: 'Fixed in place: the sort columns now use descending order.', parentNodeId: 'repair', createdAt: 4 } as TextTurn));
    const { unmount } = renderThread();
    expect(screen.getByText('Made the app')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: 'Fixed an error in the app' });
    // The error and the agent's note are in the row, not messages of their own.
    expect(screen.queryByText(/Fixed in place/)).toBeNull();
    expect(screen.queryByText(/sortBy is not a function/)).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText('TypeError: sortBy is not a function')).toBeInTheDocument();
    expect(screen.getByText(/Fixed in place/)).toBeInTheDocument();
    unmount();
});

it('marks a stopped run with a Stopped chip that stays when the user sends on from it', () => {
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'ask', textKind: 'explain', content: '',
        prompt: 'Get gas prices', createdAt: 1 } as TextTurn));
    store.dispatch(dfActions.createDraftNode({ id: 'run', displayId: 'run', parentNodeId: 'ask', parentTableId: 'ask',
        source: [], interaction: [], actionId: 'run' }));
    store.dispatch(dfActions.updateDeriveStatus({ nodeId: 'run', status: 'interrupted' }));
    const first = renderThread();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.queryByText('Exploration cancelled')).toBeNull();
    fireEvent.click(screen.getByText('Stopped'));
    expect(store.getState().focusedId).toEqual({ type: 'draft', draftId: 'run' });
    first.unmount();

    // Sending on replaces the stopped run's draft; the message it sent keeps the mark.
    act(() => {
        store.dispatch(dfActions.removeDraftNode('run'));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'next', displayId: 'next', textKind: 'explain', content: '',
            prompt: 'continue', parentNodeId: 'ask', afterStop: true, createdAt: 2 } as TextTurn));
    });
    const second = renderThread();
    const chip = document.querySelector('[data-thread-item^="stopped-before-next"]');
    const message = document.querySelector('[data-thread-item="textturn-prompt-next-0"]');
    expect(chip).toBeInTheDocument();
    expect(chip!.compareDocumentPosition(message!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    second.unmount();
});

it('shows a background task on the command that started it: live while it runs, its log on click, its last status after', async () => {
    const { apiRequest } = await import('../../../../src/app/apiClient');
    const { refreshBackgroundTasks } = await import('../../../../src/app/backgroundTasks');
    const running = { id: 'task-1', conversation_id: 'run', purpose: 'Count slowly', command: 'python count.py', status: 'running',
        started: Date.now() / 1000 - 95, ended: null, elapsed_seconds: 95, exit_code: null, stopped_by: null, error: null, output_bytes: 6,
        last_lines: ['tick 1'], log: 'scratch/tasks/task-1.log' };
    let tasks: object[] = [running];
    vi.mocked(apiRequest).mockImplementation(async (url: string) => (url === '/api/tasks/list' ? { data: { tasks } }
        : url === '/api/tasks/log' ? { data: { log: 'tick 1\ntick 2', truncated: false } } : { data: { files: [], tables: [] } }) as any);
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'ask', textKind: 'explain', content: '',
        prompt: 'Count in the background', createdAt: 1 } as TextTurn));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'step', displayId: 'step', textKind: 'explain', content: 'Count slowly',
        parentNodeId: 'ask', createdAt: 2, executions: [{ id: 'cmd', argv: ['python', 'count.py'], cwd: '/w', purpose: 'Count slowly',
            status: 'completed', result: { background_task: 'task-1', started: running.started, exit_code: null } }] } as TextTurn));
    const view = renderThread();
    const row = () => document.querySelector('[data-thread-background-task="task-1"]')!;
    await waitFor(() => expect(row()).toHaveTextContent('1m 35s'));
    // Between polls the time keeps counting.
    await waitFor(() => expect(row()).toHaveTextContent('1m 36s'), { timeout: 2500 });
    expect(row().querySelector('[role="progressbar"]')).toBeInTheDocument();

    fireEvent.click(row());
    expect(await screen.findByText(/tick 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    // It finished, then the server forgot it (a restart): the status it last showed stays.
    const done = { ...running, status: 'completed', ended: running.started + 130, elapsed_seconds: 130, exit_code: 0 };
    tasks = [done];
    await act(() => refreshBackgroundTasks());
    await waitFor(() => expect(row().querySelector('[aria-label="finished · 2m 10s"]')).toBeInTheDocument());
    act(() => { store.dispatch(dfActions.upsertTurnExecution({ turnId: 'step', execution: { ...store.getState().textTurns[1].executions![0],
        result: { background_task: 'task-1', exit_code: null, task: { status: 'completed', started: done.started, ended: done.ended, exit_code: 0 } } } })); });
    tasks = [];
    await act(() => refreshBackgroundTasks());
    expect(row().querySelector('[aria-label="finished · 2m 10s"]')).toBeInTheDocument();
    view.unmount();
});

it('shows a step\'s background tasks as their own group, apart from its tool calls', async () => {
    const { apiRequest } = await import('../../../../src/app/apiClient');
    const started = Date.now() / 1000 - 70;
    const task = (id: string, status: string, seconds = 70) => ({ id, conversation_id: 'run', purpose: id, command: 'x', status, started,
        ended: status === 'running' ? null : started + seconds, elapsed_seconds: seconds, exit_code: null, stopped_by: null, error: null,
        output_bytes: 0, last_lines: [], log: '' });
    vi.mocked(apiRequest).mockImplementation(async (url: string) => (url === '/api/tasks/list'
        ? { data: { tasks: [task('t1', 'running'), task('t2', 'completed'), task('t3', 'failed', 0)] } }
        : { data: { files: [], tables: [] } }) as any);
    const command = (id: string, createdAt: number, background?: string) => ({ id, argv: ['x', id], cwd: '/w', purpose: `Purpose ${id}`,
        status: 'completed', createdAt, result: background
            ? { background_task: background, exit_code: null, task: { status: 'running', started, ended: null, exit_code: null } }
            : { exit_code: 0 } });
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'ask', textKind: 'explain', content: '',
        prompt: 'Crawl three sites', createdAt: 1 } as TextTurn));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'step', displayId: 'step', textKind: 'explain', content: 'Purpose t1',
        parentNodeId: 'ask', createdAt: 2, executions: [
            // A refused start the agent made again (below) once a slot freed: it is that task, not one more.
            { id: 'refused-then-run', argv: ['x', 't1'], cwd: '/w', purpose: 'Purpose t1', status: 'failed', background: true,
                result: { error: 'At most 8 background tasks can run at once, so this one did not start.', exit_code: null } },
            command('t1', 1, 't1'), command('check', 2), command('t2', 3, 't2'),
            command('list', 4), command('t3', 5, 't3'),
            // A start the limit refused: the task did not start, and the group says so.
            { id: 'refused', argv: ['x', 'never'], cwd: '/w', purpose: 'Purpose refused', status: 'failed', createdAt: 6, background: true,
                result: { error: 'At most 8 background tasks can run at once, so this one did not start.', exit_code: null } }] } as TextTurn));
    const view = renderThread();
    // The tasks fold into one row that says how they are doing; the step's tool calls are its own, without them.
    const group = await screen.findByRole('button', { name: '4 background tasks' });
    await waitFor(() => expect(group).toHaveTextContent("1 running · 1 finished · 1 failed · 1 didn't start"));
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-thread-background-task]')).toBeNull();
    // The step's own calls are back to how a settled step shows them: its message (labelled by its first call, not
    // a task it started), from which they open.
    expect(screen.queryByText('Purpose t1')).toBeNull();
    expect(screen.getByText('Purpose check')).toBeInTheDocument();
    fireEvent.click(group);
    expect(document.querySelector('[data-thread-background-task="t1"] [role="progressbar"]')).toBeInTheDocument();
    expect(document.querySelector('[data-thread-background-task="t2"] [aria-label="finished · 1m 10s"]')).toBeInTheDocument();
    // One that ended without finishing says so, rather than showing a time that looks stuck.
    expect(document.querySelector('[data-thread-background-task="t3"]')).toHaveTextContent('failed · 0s');
    expect(document.querySelector('[data-thread-background-task="refused"]')).toHaveTextContent("Purpose refuseddidn't start");
    view.unmount();
});

it('shows a follow-up the app sent for background tasks as an event row with its tasks behind it, then the agent\'s reply', async () => {
    const { apiRequest } = await import('../../../../src/app/apiClient');
    const started = Date.now() / 1000 - 40;
    vi.mocked(apiRequest).mockImplementation(async (url: string) => (url === '/api/tasks/list' ? { data: { tasks: [
        { id: 'a', conversation_id: 'run', purpose: 'Crawl A', command: 'x', status: 'completed', started, ended: started + 30,
            elapsed_seconds: 30, exit_code: 0, stopped_by: null, error: null, output_bytes: 0, last_lines: [], log: '' },
        { id: 'b', conversation_id: 'run', purpose: 'Crawl B', command: 'x', status: 'completed', started, ended: started + 35,
            elapsed_seconds: 35, exit_code: 0, stopped_by: null, error: null, output_bytes: 0, last_lines: [], log: '' },
    ] } } : { data: { files: [], tables: [] } }) as any);
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'wake', displayId: 'wake', textKind: 'explain', content: '',
        prompt: '2 background tasks ended', auto: 'task-wake', taskIds: ['a', 'b'], createdAt: 1 } as TextTurn));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'reply', displayId: 'reply', textKind: 'explain',
        content: 'Both crawls finished: 58 pages.', parentNodeId: 'wake', createdAt: 2 } as TextTurn));
    const view = renderThread();
    const event = await screen.findByRole('button', { name: '2 background tasks ended' });
    await waitFor(() => expect(event).toHaveTextContent('2 finished'));
    expect(document.querySelector('[data-user-message]')).toBeNull();
    expect(screen.getByText('Both crawls finished: 58 pages.')).toBeInTheDocument();
    fireEvent.click(event);
    expect(document.querySelector('[data-thread-background-task="a"]')).toHaveTextContent('Crawl A');
    expect(document.querySelector('[data-thread-background-task="b"]')).toHaveTextContent('35s');
    view.unmount();
});
