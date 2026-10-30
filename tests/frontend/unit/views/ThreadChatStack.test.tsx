import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
