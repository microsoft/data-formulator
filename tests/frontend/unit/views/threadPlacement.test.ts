import React from 'react';
import 'prismjs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors, type DataFormulatorState } from '../../../../src/app/dfSlice';
import { DataThread } from '../../../../src/views/DataThread';
import { LayoutProvider } from '../../../../src/app/LayoutProvider';

vi.mock('../../../../src/views/SimpleChartRecBox', () => ({ SimpleChartRecBox: () => null }));

const ROOT = 'conversation-root:placement';

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
});
afterEach(() => vi.unstubAllGlobals());

const danglingParents = (state: DataFormulatorState) => dfSelectors.getThreadGraph(state).danglingNodes();

const file = (id: string, parentNodeId: string, createdAt: number) => dfActions.upsertFileNode({
    kind: 'file', id, path: `${id}.md`, displayName: `File ${id}`, contentHash: `${id}-hash`, parentNodeId, createdAt,
});

describe('Thread artifact placement', () => {
    // One artifact under every kind of node an artifact can follow.
    const buildThread = () => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'ask', displayId: 'Ask', textKind: 'explain',
            prompt: 'Build things', content: 'Started.', parentNodeId: ROOT, createdAt: 1 }));
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'loaded', displayId: 'Loaded', names: [], metadata: {},
            rows: [], virtual: { tableId: 'loaded', rowCount: 0 } } as any));
        store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'loaded-ref', tableId: 'loaded',
            parentNodeId: 'ask', createdAt: 2 }));
        store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'made', displayId: 'Made', names: [], metadata: {}, rows: [],
            parentNodeId: 'ask', virtual: { tableId: 'made', rowCount: 0 }, derive: { source: [], code: '', dialog: [],
                trigger: { tableId: ROOT, resultTableId: 'made',
                    interaction: [{ from: 'data-agent', to: 'user', role: 'instruction', content: 'Make the table' }] } } } as any));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'after', displayId: 'After', textKind: 'explain',
            content: 'After the table.', parentNodeId: 'made', createdAt: 5 }));
        store.dispatch(dfActions.saveGeneratedReport({ id: 'findings', title: 'Findings', content: '# Findings',
            selectedChartIds: [], createdAt: 6, status: 'completed', parentNodeId: 'after' }));
        store.dispatch(file('under-root', ROOT, 3));
        store.dispatch(file('under-turn', 'ask', 4));
        store.dispatch(file('under-loaded-ref', 'loaded-ref', 4));
        store.dispatch(file('under-table', 'made', 5));
        store.dispatch(file('under-later-turn', 'after', 6));
        store.dispatch(file('under-report', 'findings', 7));
        return store;
    };

    it('renders every artifact exactly once, whatever node it follows', () => {
        const store = buildThread();
        expect(danglingParents(store.getState())).toEqual([]);
        const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
        const { container } = render(React.createElement(Provider, { store, children:
            React.createElement(ThemeProvider, { theme, children:
                React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
            }),
        }));
        for (const toggle of screen.queryAllByRole('button', { name: 'Expand thread' })) fireEvent.click(toggle);
        const keys = [...store.getState().fileNodes.map(node => node.id), 'report-findings'];
        const counts = Object.fromEntries(keys.map(key => [key,
            container.querySelectorAll(`[data-thread-item="${CSS.escape(key)}"]`).length]));
        expect(counts).toEqual(Object.fromEntries(keys.map(key => [key, 1])));
    });

    it('detects artifacts whose parent no longer exists', () => {
        const store = buildThread();
        store.dispatch(file('orphan', 'deleted-turn', 8));
        expect(danglingParents(store.getState())).toEqual(['orphan']);
    });

    it('opens an older conversation when an app made directly in it is focused', () => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'old', displayId: 'Old', textKind: 'explain',
            prompt: 'Old question', content: 'Old answer.', parentNodeId: 'conversation-root:old', createdAt: 1 }));
        store.dispatch(file('old-app', 'conversation-root:old', 2));
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'new', displayId: 'New', textKind: 'explain',
            prompt: 'New question', content: 'New answer.', parentNodeId: 'conversation-root:new', createdAt: 10 }));
        const theme = createTheme({ palette: { custom: { main: '#a34d16' } } } as any);
        render(React.createElement(Provider, { store, children:
            React.createElement(ThemeProvider, { theme, children:
                React.createElement(LayoutProvider, { children: React.createElement(DataThread) }),
            }),
        }));
        expect(screen.queryByRole('button', { name: 'File old-app' })).toBeNull();
        act(() => store.dispatch(dfActions.setFocused({ type: 'file', fileName: 'old-app.md' })));
        expect(screen.getByRole('button', { name: 'File old-app' })).toBeTruthy();
    });
});

describe('removeDraftNode', () => {
    const withDraftOutputs = () => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.createDraftNode({ id: 'step', displayId: 'Step', parentNodeId: 'asked-from',
            parentTableId: 'asked-from', source: [], interaction: [] }));
        store.dispatch(file('app', 'step', 1));
        store.dispatch(dfActions.addLoadedTableNode({ kind: 'loaded-table', id: 'input-ref', tableId: 'input',
            parentNodeId: 'step', createdAt: 1 }));
        return store;
    };
    const parents = (state: DataFormulatorState) => ({
        app: state.fileNodes[0].parentNodeId, input: state.loadedTableNodes[0].parentNodeId,
    });

    it('lifts everything to the draft parent when the step is abandoned', () => {
        const store = withDraftOutputs();
        store.dispatch(dfActions.removeDraftNode('step'));
        expect(parents(store.getState())).toEqual({ app: 'asked-from', input: 'asked-from' });
    });
});
