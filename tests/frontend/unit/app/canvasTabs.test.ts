import { describe, expect, it } from 'vitest';

import { arrangeCanvasTabs, dataFormulatorReducer, dfActions, isCanvasTabPinned, MAX_CANVAS_TABS } from '../../../../src/app/dfSlice';

const initial = () => dataFormulatorReducer(undefined, { type: '@@init' });
const chart = (id: string) => ({ type: 'chart' as const, chartId: id });
const keys = (state: ReturnType<typeof initial>) => state.canvasTabs.map(tab => tab.key);

describe('canvas tabs', () => {
    it('gives what the canvas shows a preview tab that goes when the user moves on', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'report', reportId: 'r' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('a')));
        expect(keys(state)).toEqual(['report:r', 'chart:a']);
        expect(state.canvasTabActive).toBe('chart:a');
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'table', tableId: 't' }));
        expect(keys(state)).toEqual(['report:r', 'table:t']);
        expect(state.canvasTabActive).toBe('table:t');
        // Closing the canvas drops the preview tab too.
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(undefined));
        expect(keys(state)).toEqual(['report:r']);
        expect(state.canvasTabActive).toBeUndefined();
    });

    it('a new preview tab takes the old one\'s place', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'report', reportId: 'r' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('a')));
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult({ type: 'file', fileName: 'dash.app.jsx' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('b')));
        expect(keys(state)).toEqual(['report:r', 'chart:b', 'file:dash.app.jsx']);
    });

    it('keeps reports, apps and maps open; double-click keeps a preview tab', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'report', reportId: 'r' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'file', fileName: 'dash.app.jsx' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'file', fileName: 'gap.map.json' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'file', fileName: 'notes.md' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('a')));
        expect(keys(state)).toEqual(['report:r', 'file:dash.app.jsx', 'file:gap.map.json', 'chart:a']);
        expect(state.canvasTabs.map(tab => isCanvasTabPinned(tab))).toEqual([true, true, true, false]);

        state = dataFormulatorReducer(state, dfActions.pinCanvasTab('chart:a'));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('b')));
        expect(keys(state)).toEqual(['report:r', 'file:dash.app.jsx', 'file:gap.map.json', 'chart:a', 'chart:b']);
        expect(isCanvasTabPinned(state.canvasTabs[3])).toBe(true);

        // A kept tab goes only when closed.
        state = dataFormulatorReducer(state, dfActions.closeCanvasTabs(['chart:a']));
        expect(keys(state)).toEqual(['report:r', 'file:dash.app.jsx', 'file:gap.map.json', 'chart:b']);
    });

    it('opens tabs for an agent run\'s reports, apps and maps (unseen until visited), not its charts or tables', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult(chart('c')));
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult({ type: 'table', tableId: 't' }));
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult({ type: 'report', reportId: 'r' }));
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult({ type: 'file', fileName: 'gap.map.json' }));
        expect(state.canvasTabs.map(tab => [tab.key, !!tab.unseen])).toEqual([['report:r', true], ['file:gap.map.json', true]]);

        // A followed chart shows as a preview tab; the report stays unseen until the user visits it.
        state = dataFormulatorReducer(state, dfActions.followFocused(chart('c')));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('c')));
        expect(keys(state)).toEqual(['report:r', 'file:gap.map.json', 'chart:c']);
        state = dataFormulatorReducer(state, dfActions.setFocused({ type: 'report', reportId: 'r' }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'report', reportId: 'r' }));
        expect(state.canvasTabs.map(tab => [tab.key, !!tab.unseen])).toEqual([['report:r', false], ['file:gap.map.json', true]]);
    });

    it('drops the least recently seen inactive tab past the cap', () => {
        let state = initial();
        for (let i = 0; i < MAX_CANVAS_TABS; i++) state = dataFormulatorReducer(state, dfActions.noteCanvasResult({ type: 'report', reportId: `r${i}` }));
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab(chart('new')));
        expect(state.canvasTabs).toHaveLength(MAX_CANVAS_TABS);
        expect(keys(state)).toContain('chart:new');
        expect(keys(state)).not.toContain('report:r0');
    });

    it('shows the last tabs added on the right; older ones scroll off the left', () => {
        let state = initial();
        for (let i = 0; i < 7; i++) state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'report', reportId: `r${i}` }));
        let zones = arrangeCanvasTabs(state.canvasTabs, state.canvasTabActive);
        expect(zones.visible.map(tab => tab.key)).toEqual(['report:r2', 'report:r3', 'report:r4', 'report:r5', 'report:r6']);
        expect(zones.history.map(tab => tab.key)).toEqual(['report:r1', 'report:r0']);

        // One opened from the history shows at the end, and the strip then moves it there.
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'report', reportId: 'r0' }));
        zones = arrangeCanvasTabs(state.canvasTabs, state.canvasTabActive);
        expect(zones.visible.map(tab => tab.key)).toEqual(['report:r3', 'report:r4', 'report:r5', 'report:r6', 'report:r0']);
        state = dataFormulatorReducer(state, dfActions.touchCanvasTab('report:r0'));
        zones = arrangeCanvasTabs(state.canvasTabs, state.canvasTabActive);
        expect(zones.visible.map(tab => tab.key)).toEqual(['report:r3', 'report:r4', 'report:r5', 'report:r6', 'report:r0']);
        expect(zones.history.map(tab => tab.key)).toEqual(['report:r2', 'report:r1']);
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
        state = dataFormulatorReducer(state, dfActions.syncCanvasTab({ type: 'text', textId: 'long' }));
        expect(keys(state)).toEqual(['text:long']);
    });

    it('drops a saved tab for a message the chat shows', () => {
        let state = initial();
        state = dataFormulatorReducer(state, dfActions.loadState({
            textTurns: [{ kind: 'text', id: 'answer', displayId: 'A', textKind: 'explain', content: 'An answer.', parentNodeId: 'conversation-root:t', createdAt: 1, answered: true }],
            canvasTabs: [{ key: 'chart:a', target: chart('a'), pinned: true }, { key: 'text:answer', target: { type: 'text', textId: 'answer' } }],
        }));
        expect(keys(state)).toEqual(['chart:a']);
    });

    it('moves a dragged tab to the slot it is dropped on', () => {
        let state = initial();
        for (const id of ['a', 'b', 'c', 'd']) state = dataFormulatorReducer(state, dfActions.noteCanvasResult({ type: 'report', reportId: id }));
        state = dataFormulatorReducer(state, dfActions.moveCanvasTab({ key: 'report:a', toKey: 'report:c' }));
        expect(keys(state)).toEqual(['report:b', 'report:c', 'report:a', 'report:d']);
        state = dataFormulatorReducer(state, dfActions.moveCanvasTab({ key: 'report:d', toKey: 'report:b' }));
        expect(keys(state)).toEqual(['report:d', 'report:b', 'report:c', 'report:a']);
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
            canvasTabs: [{ key: 'chart:a', target: chart('a'), pinned: true }, { key: 'draft:x', target: { type: 'draft', draftId: 'x' } },
                { key: 'chart:old', target: chart('old') }, { key: 'table:t', target: { type: 'table', tableId: 't' } }],
            canvasTabActive: 'table:t',
        }));
        // A preview tab comes back only if it was the one in view.
        expect(keys(state)).toEqual(['chart:a', 'table:t']);
        expect(state.canvasTabActive).toBe('table:t');
        state = dataFormulatorReducer(state, dfActions.loadState({
            canvasTabs: [{ key: 'chart:a', target: chart('a'), pinned: true }],
            canvasTabActive: 'chart:a',
        }));
        expect(keys(state)).toEqual(['chart:a']);
        expect(state.canvasTabActive).toBe('chart:a');
    });
});
