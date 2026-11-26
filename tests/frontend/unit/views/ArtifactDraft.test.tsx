import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { afterEach, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { clearAppDraftLines, maskAppCode, updateAppDraftLines } from '../../../../src/app/appDraft';
import { ArtifactDraftCanvas, ArtifactDraftCard, ArtifactDraftView } from '../../../../src/views/ArtifactDraft';
import { CanvasTabs } from '../../../../src/views/CanvasTabs';

afterEach(() => {
    act(() => clearAppDraftLines());
    vi.unstubAllGlobals();
    cleanup();
});

/** A store with a run's draft (on a message) and a notes file open on the canvas. */
const storeWithDraft = () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.createDraftNode({ id: 'draft-1', displayId: 'draft-1', parentNodeId: 'turn-1', parentTableId: 'table-1',
        source: [], interaction: [] }));
    store.dispatch(dfActions.setFocused({ type: 'file', fileName: 'notes.md' }));
    return store;
};

/** The columns of a masked line's muted dots, from its SVG path (the cursor is drawn separately). */
const dotColumns = (row: Element) =>
    [...(row.querySelector('path')?.getAttribute('d') ?? '').matchAll(/M(\d+) /g)].map(match => Number(match[1]) / 4);

it('shows the code of the app being written masked, with spaces kept, and how long it has taken', () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
        render(<ArtifactDraftView tool="write_app" title="Stock risk" startedAt={Date.now()} lineCount={42}
            lines={['xxxxxx xxxx', '', '  xxx x', 'x', 'xxxx xx', 'xx']} />);
        expect(screen.getByRole('status', { name: 'Generating app: Stock risk' })).toBeVisible();
        expect(screen.getByText('Generating app… (0s) · Stock risk')).toBeVisible();
        act(() => { vi.advanceTimersByTime(4000); });
        expect(screen.getByText('Generating app… (4s) · Stock risk')).toBeVisible();
        // The last lines: every character a dot, indentation kept, the last dot colored (the cursor).
        const rows = screen.getByTestId('app-draft-lines').querySelectorAll('[data-draft-line]');
        expect(rows).toHaveLength(6);
        expect(dotColumns(rows[2])).toEqual([2, 3, 4, 6]);
        expect(dotColumns(rows[5])).toEqual([0]);
        expect(rows[5].querySelector('[data-caret]')).toHaveAttribute('x', String(1 * 4));
        expect(rows[1].querySelector('path')).toHaveAttribute('d', '');
    } finally {
        vi.useRealTimers();
    }
});

it('shows only the last twelve lines of a long app', () => {
    const lines = Array.from({ length: 20 }, () => 'xx');
    render(<ArtifactDraftView tool="write_app" startedAt={Date.now()} lineCount={20} lines={lines} />);
    expect(screen.getByTestId('app-draft-lines').querySelectorAll('[data-draft-line]')).toHaveLength(12);
    // After spaces, the cursor waits one dot past them.
    cleanup();
    render(<ArtifactDraftView tool="write_app" startedAt={Date.now()} lineCount={1} lines={['xx  ']} />);
    const row = screen.getByTestId('app-draft-lines').querySelector('[data-draft-line]')!;
    expect(dotColumns(row)).toEqual([0, 1]);
    expect(row.querySelector('[data-caret]')).toHaveAttribute('x', String(4 * 4));
});

it('shows a muted placeholder for a map being written', () => {
    render(<ArtifactDraftView tool="write_map" title="Storm tracks" startedAt={Date.now()} lineCount={0} lines={[]} />);
    expect(screen.getByRole('status', { name: 'Generating map: Storm tracks' })).toBeVisible();
    expect(screen.getByTestId('map-draft-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('app-draft-lines')).not.toBeInTheDocument();
});

it('masks code the way the agent does', () => {
    expect(maskAppCode('const a = 1;\n\tif (a) {\n  return "你好";\n}', 2)).toEqual({ lines: ['  xxxxxx xxxxx', 'x'], lineCount: 4 });
});

it('lets a run\'s draft own the canvas only while it writes an app or map', () => {
    const store = storeWithDraft();
    const canvas = () => dfSelectors.selectCanvasTarget(store.getState());
    store.dispatch(dfActions.setFocused({ type: 'draft', draftId: 'draft-1' }));
    expect(canvas()?.type).not.toBe('draft');
    store.dispatch(dfActions.setDraftWriting({ draftId: 'draft-1', writing: { tool: 'write_app', startedAt: Date.now() } }));
    expect(canvas()).toEqual({ type: 'draft', draftId: 'draft-1' });
    render(<Provider store={store}><ArtifactDraftCanvas draftId="draft-1" /></Provider>);
    act(() => updateAppDraftLines('draft-1', { lines: ['xx'], line_count: 1 }));
    expect(screen.getByRole('status', { name: 'Generating app' })).toBeVisible();
    const draftLines = () => screen.getByTestId('app-draft-lines').querySelectorAll('[data-draft-line]');
    expect(draftLines()).toHaveLength(1);
    expect(draftLines()[0].querySelector('[data-caret]')).toHaveAttribute('x', '4');
    // Lines of another draft are not this one's.
    act(() => updateAppDraftLines('draft-2', { lines: ['xxxx'], line_count: 1 }));
    expect(draftLines()).toHaveLength(0);
    // The writing stops (the app landed, or the run stopped): the draft no longer owns the canvas.
    act(() => { store.dispatch(dfActions.setDraftWriting({ draftId: 'draft-1' })); });
    expect(canvas()?.type).not.toBe('draft');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    store.dispatch(dfActions.setDraftWriting({ draftId: 'draft-1', writing: { tool: 'write_app', startedAt: Date.now() } }));
    store.dispatch(dfActions.updateDeriveStatus({ nodeId: 'draft-1', status: 'error' }));
    expect(store.getState().draftNodes[0].derive.writing).toBeUndefined();
});

it('shows the draft in the thread as a card that opens it on the canvas', () => {
    const store = storeWithDraft();
    store.dispatch(dfActions.setDraftWriting({ draftId: 'draft-1', writing: { tool: 'write_app', title: 'Stock risk', startedAt: Date.now() } }));
    render(<Provider store={store}><ArtifactDraftCard draftId="draft-1" /></Provider>);
    const card = screen.getByRole('button', { name: /Stock risk/ });
    expect(card).toHaveTextContent('Generating app… (0s)');
    fireEvent.click(card);
    expect(store.getState().focusedId).toEqual({ type: 'draft', draftId: 'draft-1' });
    expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'draft', draftId: 'draft-1' });
});

it('gives a draft being written a preview tab of its own, which goes when the writing stops', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const store = storeWithDraft();
    const Tabs = () => {
        const target = useSelector(dfSelectors.selectCanvasTarget);
        return <CanvasTabs target={target} viewMode="editor" onCloseCanvas={() => undefined} />;
    };
    render(<Provider store={store}><Tabs /></Provider>);
    expect(screen.getByRole('tab', { name: /notes\.md/ })).toHaveAttribute('aria-selected', 'true');
    act(() => {
        store.dispatch(dfActions.setDraftWriting({ draftId: 'draft-1', writing: { tool: 'write_map', title: 'Storm tracks', startedAt: Date.now() } }));
        store.dispatch(dfActions.followFocused({ type: 'draft', draftId: 'draft-1' }));
    });
    const draftTab = screen.getByRole('tab', { name: /Storm tracks/ });
    expect(draftTab).toHaveAttribute('aria-selected', 'true');
    // A preview tab: it replaces the notes file's preview tab, as any other item the canvas moves to would.
    expect(draftTab).toHaveAttribute('data-preview', 'true');
    expect(store.getState().canvasTabActive).toBe('draft:draft-1');
    act(() => { store.dispatch(dfActions.setDraftWriting({ draftId: 'draft-1' })); });
    expect(screen.queryByRole('tab', { name: /Storm tracks/ })).not.toBeInTheDocument();
});
