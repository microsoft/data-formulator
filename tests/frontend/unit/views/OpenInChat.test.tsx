import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { ExplanationPanel } from '../../../../src/views/AgentPausePanel';
import { ConversationCanvas } from '../../../../src/views/ConversationCanvas';
import type { TextTurn } from '../../../../src/components/ComponentType';

it('offers to open a long answer in the chat view', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<ExplanationPanel content="A long answer" onClose={() => {}} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in chat' }));
    expect(onOpen).toHaveBeenCalled();
    rerender(<ExplanationPanel content="Still writing" onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Open in chat' })).toBeNull();
});

it('brings the opened message into view in the chat', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const turn = (id: string, extra: Partial<TextTurn>) => store.dispatch(dfActions.addTextTurn({ kind: 'text', id, displayId: id,
        textKind: 'explain', content: '', createdAt: 1, ...extra } as TextTurn));
    turn('ask', { prompt: 'Find papers' });
    turn('answer', { content: 'Here are the papers', parentNodeId: 'ask' });
    const scrolled: string[] = [];
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) { scrolled.push(this.getAttribute('data-conversation-entry') || ''); };
    render(<Provider store={store}><ConversationCanvas textTurnId="thread-ask" nodeIds={['ask', 'answer']} anchorId="answer" /></Provider>);
    expect(screen.getByText('Here are the papers')).toBeInTheDocument();
    expect(scrolled).toEqual(['answer']);
    HTMLElement.prototype.scrollIntoView = previous;
});
