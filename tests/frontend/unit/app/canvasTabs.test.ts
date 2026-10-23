import { describe, expect, it } from 'vitest';

import { arrangeCanvasTabs, dataFormulatorReducer, dfActions, MAX_CANVAS_TABS } from '../../../../src/app/dfSlice';

const initial = () => dataFormulatorReducer(undefined, { type: '@@init' });
const chart = (id: string) => ({ type: 'chart' as const, chartId: id });
const keys = (state: ReturnType<typeof initial>) => state.canvasTabs.map(tab => tab.key);

describe('canvas tabs', () => {
    it('gives whatever the canvas shows a tab and makes it active', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.setFocused(chart('a')));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('a')));
        state = dataFormulatorReducer(state, dfActions.setFocused(chart('b')));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('b')));
        expect(keys(state)).toEqual(['chart:a', 'chart:b']);
        expect(state.canvasTabActive).toBe('chart:b');
        expect(state.canvasTabs.some(tab => tab.unseen)).toBe(false);
    });

    it('keeps results an agent run adds unseen until the user visits them', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult(chart('a')));
        state = dataFormulatorReducer(state, dfActions.followFocused(chart('a')));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('a')));
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult(chart('b')));
        state = dataFormulatorReducer(state, dfActions.followFocused(chart('b')));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('b')));
        expect(state.canvasTabs.map(tab => !!tab.unseen)).toEqual([true, true]);

        // The user moves on: the tab they were looking at and the one they open count as seen.
        state = dataFormulatorReducer(state, dfActions.setFocused({ type: 'table', tableId: 't' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'table', tableId: 't' }));
        expect(state.canvasTabs.map(tab => [tab.key, !!tab.unseen])).toEqual([['chart:a', true], ['chart:b', false], ['table:t', false]]);
    });

    it('drops the least recently seen unpinned tab past the cap', () => {
        let state = initial();
        for (let i = 0; i < MAX_CANVAS_TABS; i++) state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart(`c${i}`)));
        state = dataFormulatorReducer(state, dfActions.placeCanvasTab({ key: 'chart:c0', pinned: true }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('c1')));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('new')));
        expect(state.canvasTabs).toHaveLength(MAX_CANVAS_TABS);
        expect(keys(state)).toContain('chart:c0');
        expect(keys(state)).toContain('chart:c1');
        expect(keys(state)).not.toContain('chart:c2');
    });

    it('keeps pinned tabs, then the last tabs added on the right; older ones scroll off the left', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'report', reportId: 'r' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'file', fileName: 'dash.app.jsx' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'file', fileName: 'notes.md' }));
        for (let i = 0; i < 6; i++) state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart(`c${i}`)));
        let zones = arrangeCanvasTabs(state.canvasTabs, state.textTurns, state.canvasTabActive);
        // Reports and apps pin themselves.
        expect(zones.pinned.map(tab => tab.key)).toEqual(['report:r', 'file:dash.app.jsx']);
        expect(zones.recent.map(tab => tab.key)).toEqual(['chart:c1', 'chart:c2', 'chart:c3', 'chart:c4', 'chart:c5']);
        // History: the ones further left, nearest first.
        expect(zones.history.map(tab => tab.key)).toEqual(['chart:c0', 'file:notes.md']);

        // Viewing a tab that's in view moves nothing.
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('c2')));
        zones = arrangeCanvasTabs(state.canvasTabs, state.textTurns, state.canvasTabActive);
        expect(zones.recent.map(tab => tab.key)).toEqual(['chart:c1', 'chart:c2', 'chart:c3', 'chart:c4', 'chart:c5']);

        // One opened from the history shows at the end, and the strip then moves it there.
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('c0')));
        zones = arrangeCanvasTabs(state.canvasTabs, state.textTurns, state.canvasTabActive);
        expect(zones.recent.map(tab => tab.key)).toEqual(['chart:c2', 'chart:c3', 'chart:c4', 'chart:c5', 'chart:c0']);
        state = dataFormulatorReducer(state, dfActions.touchCanvasTab('chart:c0'));
        zones = arrangeCanvasTabs(state.canvasTabs, state.textTurns, state.canvasTabActive);
        expect(zones.recent.map(tab => tab.key)).toEqual(['chart:c2', 'chart:c3', 'chart:c4', 'chart:c5', 'chart:c0']);
        expect(zones.history.map(tab => tab.key)).toEqual(['chart:c1', 'file:notes.md']);
    });

    it('pins and unpins a tab on click; an unpinned report stays unpinned', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'report', reportId: 'r' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('a')));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('b')));
        expect(arrangeCanvasTabs(state.canvasTabs, state.textTurns, undefined).pinned.map(tab => tab.key)).toEqual(['report:r']);

        state = dataFormulatorReducer(state, dfActions.placeCanvasTab({ key: 'chart:b', pinned: true, afterKey: 'report:r' }));
        let zones = arrangeCanvasTabs(state.canvasTabs, state.textTurns, undefined);
        expect(zones.pinned.map(tab => tab.key)).toEqual(['report:r', 'chart:b']);
        expect(zones.recent.map(tab => tab.key)).toEqual(['chart:a']);

        state = dataFormulatorReducer(state, dfActions.placeCanvasTab({ key: 'report:r', pinned: false }));
        zones = arrangeCanvasTabs(state.canvasTabs, state.textTurns, undefined);
        expect(zones.pinned.map(tab => tab.key)).toEqual(['chart:b']);
        expect(zones.recent.map(tab => tab.key)).toEqual(['chart:a', 'report:r']);
    });

    it('opens tabs for charts and loaded tables, not derived tables', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.loadState({
            inputTables: [{ kind: 'table', id: 'loaded', displayId: 'Loaded', names: [], metadata: {}, rows: [] }],
            derivedTables: [{ kind: 'table', id: 'derived', displayId: 'Derived', names: [], metadata: {}, rows: [],
                derive: { source: ['loaded'], code: '', dialog: [], trigger: { tableId: 'loaded' } } }],
        }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'table', tableId: 'loaded' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'table', tableId: 'derived' }));
        expect(keys(state)).toEqual(['table:loaded']);
        expect(state.canvasTabActive).toBeUndefined();
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult({ type: 'table', tableId: 'derived' }));
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult(chart('c')));
        expect(keys(state)).toEqual(['table:loaded', 'chart:c']);
    });

    it('opens a tab for a message only when it has a view of its own', () => {
        const turn = (id: string, extra = {}) => ({ kind: 'text', id, displayId: id, textKind: 'explain', content: 'An answer.',
            parentNodeId: 'conversation-root:t', createdAt: 1, answered: true, ...extra });
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.loadState({ textTurns: [turn('answer'), turn('long', { presentation: 'long_response' })] }));
        state = dataFormulatorReducer(state, dfActions.followFocused({ type: 'text', textId: 'answer' }));
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult({ type: 'text', textId: 'answer' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'text', textId: 'answer' }));
        expect(keys(state)).toEqual([]);
        state = dataFormulatorReducer(state, dfActions.followFocused({ type: 'text', textId: 'long' }));
        expect(keys(state)).toEqual(['text:long']);
    });

    it('drops a saved tab for a message the chat shows', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.loadState({
            textTurns: [{ kind: 'text', id: 'answer', displayId: 'A', textKind: 'explain', content: 'An answer.', parentNodeId: 'conversation-root:t', createdAt: 1, answered: true }],
            canvasTabs: [{ key: 'chart:a', target: chart('a') }, { key: 'text:answer', target: { type: 'text', textId: 'answer' } }],
        }));
        expect(keys(state)).toEqual(['chart:a']);
    });

    it('moves a dragged tab to the slot it is dropped on', () => {
        let state = initial();
        for (const id of ['a', 'b', 'c', 'd']) state = dataFormulatorReducer(state, dfActions.noteCanvasResult(chart(id)));
        state = dataFormulatorReducer(state, dfActions.moveCanvasTab({ key: 'chart:a', toKey: 'chart:c' }));
        expect(keys(state)).toEqual(['chart:b', 'chart:c', 'chart:a', 'chart:d']);
        state = dataFormulatorReducer(state, dfActions.moveCanvasTab({ key: 'chart:d', toKey: 'chart:b' }));
        expect(keys(state)).toEqual(['chart:d', 'chart:b', 'chart:c', 'chart:a']);
    });

    it('follows a file rename and closes with the file', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'file', fileName: 'a.md' }));
        state = dataFormulatorReducer(state, dfActions.renameFileNodes({ from: 'a.md', to: 'b.md' }));
        expect(keys(state)).toEqual(['file:b.md']);
        expect(state.canvasTabActive).toBe('file:b.md');
        state = dataFormulatorReducer(state, dfActions.removeFileNodes('b.md'));
        expect(state.canvasTabs).toEqual([]);
    });

    it('restores tabs with the session', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.loadState({
            canvasTabs: [{ key: 'chart:a', target: chart('a'), pinned: true }, { key: 'draft:x', target: { type: 'draft', draftId: 'x' } }],
            canvasTabActive: 'chart:a',
        }));
        expect(keys(state)).toEqual(['chart:a']);
        expect(state.canvasTabActive).toBe('chart:a');
    });
});
