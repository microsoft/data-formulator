import { describe, expect, it } from 'vitest';

import { dataFormulatorReducer, dfActions, MAX_CANVAS_TABS } from '../../../../src/app/dfSlice';

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

    it('moves a touched tab to the end and drops the oldest unpinned past the cap', () => {
        let state = initial();
        for (let i = 0; i < MAX_CANVAS_TABS; i++) state = dataFormulatorReducer(state, dfActions.noteCanvasResult(chart(`c${i}`)));
        state = dataFormulatorReducer(state, dfActions.setCanvasTabPinned({ key: 'chart:c0', pinned: true }));
        state = dataFormulatorReducer(state, dfActions.touchCanvasTab('chart:c1'));
        expect(keys(state).at(-1)).toBe('chart:c1');
        state = dataFormulatorReducer(state, dfActions.noteCanvasResult(chart('new')));
        expect(state.canvasTabs).toHaveLength(MAX_CANVAS_TABS);
        expect(keys(state)).toContain('chart:c0');
        expect(keys(state)).not.toContain('chart:c2');
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
