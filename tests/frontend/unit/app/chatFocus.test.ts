import { describe, expect, it } from 'vitest';

import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';

const initial = () => dataFormulatorReducer(undefined, { type: '@@init' });
const turn = (id: string, parentNodeId: string, createdAt: number, extra = {}) => ({
    kind: 'text', id, displayId: id, textKind: 'explain', content: `Message ${id}.`, parentNodeId, createdAt, answered: true, ...extra,
});

const withChat = () => {
    let state = initial();
    state = dataFormulatorReducer(state, dfActions.loadState({ textTurns: [
        turn('q1', 'conversation-root:t', 1),
        turn('a1', 'q1', 2),
        turn('other', 'conversation-root:u', 3),
    ] }));
    return dataFormulatorReducer(state, dfActions.setFocused({ type: 'conversation', tableId: 'thread-q1', nodeIds: ['q1', 'a1'], label: 'Thread 1' }));
};

describe('focus with the chat open', () => {
    it('brings a clicked message into view in the chat instead of closing it', () => {
        const state = dataFormulatorReducer(withChat(), dfActions.setFocused({ type: 'text', textId: 'q1' }));
        expect(state.focusedId).toEqual({ type: 'conversation', tableId: 'thread-q1', nodeIds: ['q1', 'a1'], label: 'Thread 1', anchorId: 'q1' });
    });

    it('opens the chat of another thread\'s message', () => {
        const state = dataFormulatorReducer(withChat(), dfActions.setFocused({ type: 'text', textId: 'other' }));
        expect(state.focusedId).toMatchObject({ type: 'conversation', tableId: 'thread-other', nodeIds: ['other'], anchorId: 'other' });
    });

    it('shows a run\'s answer in the chat, which reads the thread as it grows', () => {
        let state = withChat();
        state = dataFormulatorReducer(state, dfActions.addTextTurn(turn('a2', 'a1', 4) as any));
        state = dataFormulatorReducer(state, dfActions.followFocused({ type: 'text', textId: 'a2' }));
        expect(state.focusedId).toMatchObject({ type: 'conversation', tableId: 'thread-q1', anchorId: 'a2' });
        // A follow-up from the chat continues from its newest message.
        expect(dfSelectors.getFocusNodeId(state)).toBe('a2');
    });

    it('keeps the chat when a run focuses a result', () => {
        const state = dataFormulatorReducer(withChat(), dfActions.followFocused({ type: 'chart', chartId: 'c' }));
        expect(state.focusedId).toMatchObject({ type: 'conversation', tableId: 'thread-q1' });
    });

    it('lets a message that waits on the user, and anything the user opens, take the canvas', () => {
        let state = withChat();
        state = dataFormulatorReducer(state, dfActions.addTextTurn(turn('ask', 'a1', 4,
            { textKind: 'clarify', answered: false, options: [{ text: 'Which year?', options: ['2024'] }] }) as any));
        expect(dataFormulatorReducer(state, dfActions.setFocused({ type: 'text', textId: 'ask' })).focusedId)
            .toEqual({ type: 'text', textId: 'ask' });
        expect(dataFormulatorReducer(state, dfActions.setFocused({ type: 'chart', chartId: 'c' })).focusedId)
            .toEqual({ type: 'chart', chartId: 'c' });
    });
});
