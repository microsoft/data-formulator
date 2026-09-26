import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { openSearchPanel, search } from '@codemirror/search';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import * as apiClient from '../../../../src/app/apiClient';

import { LogViewerDialog, createSavedStateSearchPanel, getSavedStateAutoFoldRanges } from '../../../../src/views/LogViewerDialog';

it('inspects scratch files, saved files, and managed Parquet tables in the diagnostics tab', async () => {
    const request = vi.spyOn(apiClient, 'apiRequest').mockImplementation(async (url: string) => ({ data:
        url.includes('include_temp') ? { files: [
            { name: 'source.md', file_size: 0 },
            { name: 'scratch/intermediate.txt', file_size: 1048576, temporary: true },
            { name: 'data/events.parquet', file_size: 19026 },
        ] } : url.includes('events.parquet/preview') ? { kind: 'table', rows: [{ value: 42 }], truncated: true }
            : url.includes('/preview') ? { kind: 'text', content: 'sample', truncated: false } : { content: 'log' },
    }));
    const store = configureStore({ reducer: () => ({ activeWorkspace: { id: 'workspace-1' } }) });
    const rendered = render(React.createElement(Provider, { store, children:
        React.createElement(LogViewerDialog, { open: true, hideTrigger: true }),
    }));
    try {
        fireEvent.click(screen.getByRole('tab', { name: 'Workspace files' }));
        fireEvent.click(await screen.findByText('scratch/intermediate.txt'));
        await waitFor(() => expect(screen.getByText('sample')).toBeTruthy());
        expect(screen.getByText('source.md')).toBeTruthy();
        expect(screen.getByText('0 B')).toBeTruthy();
        expect(screen.getByText('1.0 MB')).toBeTruthy();
        expect(screen.getByText('18.6 KB')).toHaveStyle({ fontSize: 'var(--df-text-xs)' });
        expect(screen.getByRole('button', { name: 'Download file' })).toBeTruthy();
        expect(request.mock.calls.some(([url]) => url.includes('scratch%2Fintermediate.txt/preview'))).toBe(true);
        expect(request.mock.calls.some(([url, options]) => url.includes('include_tables=true')
            && (options?.headers as Record<string, string>)?.['X-Workspace-Id'] === 'workspace-1')).toBe(true);
        fireEvent.click(screen.getByText('data/events.parquet'));
        await screen.findByText(/"value": 42/);
        expect(screen.getByText(/\[Truncated\]/)).toBeTruthy();
    } finally {
        rendered.unmount();
        request.mockRestore();
    }
});

it('ignores file listings from the previous workspace after a session switch', async () => {
    let finishOld!: (value: any) => void;
    const request = vi.spyOn(apiClient, 'apiRequest').mockImplementation(async (url: string, options?: any) => {
        if (!url.includes('include_tables')) return { data: { content: 'log' } };
        if (options?.headers?.['X-Workspace-Id'] === 'old') {
            return new Promise(resolve => { finishOld = resolve; });
        }
        return { data: { files: [{ name: 'data/current.parquet', file_size: 100 }] } };
    });
    const store = configureStore({ reducer: (state = { activeWorkspace: { id: 'old' } }, action: any) =>
        action.type === 'switch' ? { activeWorkspace: { id: 'new' } } : state });
    const rendered = render(React.createElement(Provider, { store, children:
        React.createElement(LogViewerDialog, { open: true, hideTrigger: true }),
    }));
    try {
        fireEvent.click(screen.getByRole('tab', { name: 'Workspace files' }));
        await waitFor(() => expect(finishOld).toBeDefined());
        act(() => { store.dispatch({ type: 'switch' }); });
        await screen.findByText('data/current.parquet');
        await act(async () => { finishOld({ data: { files: [{ name: 'data/old.parquet', file_size: 100 }] } }); });
        expect(screen.queryByText('data/old.parquet')).toBeNull();
        expect(screen.getByText('data/current.parquet')).toBeTruthy();
    } finally {
        rendered.unmount();
        request.mockRestore();
    }
});

it('allows switching tabs after a saved-state load fails', async () => {
    let rejectSavedState!: (error: Error) => void;
    const pending = new Promise<never>((_, reject) => { rejectSavedState = reject; });
    const request = vi.spyOn(apiClient, 'apiRequest').mockImplementation(async (url: string) => {
        if (url.includes('sessions/load')) return pending;
        return { data: url.includes('include_temp') ? { files: [] } : { content: 'Short log', path: '/logs/server.log' } };
    });
    const store = configureStore({ reducer: () => ({ activeWorkspace: { id: 'workspace-1' } }) });
    const rendered = render(React.createElement(Provider, { store, children:
        React.createElement(LogViewerDialog, { open: true, hideTrigger: true }),
    }));
    try {
        await screen.findByText('Short log');
        fireEvent.click(screen.getByRole('tab', { name: 'Saved state' }));
        expect(screen.getByRole('progressbar')).toBeTruthy();
        await act(async () => rejectSavedState(new Error('State unavailable')));
        await screen.findByText('State unavailable');
        fireEvent.click(screen.getByRole('tab', { name: 'Workspace files' }));
        await screen.findByText('No workspace files.');
        expect(screen.queryByText('State unavailable')).toBeNull();
    } finally {
        rendered.unmount();
        request.mockRestore();
    }
});

describe('saved-state auto folding', () => {
    it('folds only the configured array-aware state paths', () => {
        const doc = JSON.stringify({
            inputTables: [{ snapshot: { columns: [{ name: 'title' }] }, rows: [1] }],
            derivedTables: [{
                snapshot: { keep: 'open' },
                rows: [{ title: 'Movie' }],
                metadata: { title: { levels: ['Movie'] } },
                derive: {
                    dialog: [{ role: 'user' }],
                    explanation: { code: 'Groups movies', concepts: [{ field: 'title' }] },
                    trigger: { interaction: [{ role: 'instruction' }] },
                    source: ['movies'],
                },
            }],
            draftNodes: [{
                derive: {
                    dialog: [{ role: 'assistant' }],
                    trigger: { interaction: [{ role: 'clarify' }] },
                    pendingClarification: { trajectory: [{ step: 1 }], completedStepCount: 1 },
                },
            }],
            charts: [{ styleVariants: [{ vlSpec: { mark: 'bar' } }] }],
            generatedReports: [{ inspectionSteps: [{ label: 'Inspect chart' }] }],
            textTurns: [{
                options: [{ label: 'Use Movies' }],
                form: { kind: 'connector' },
                dataOperation: { candidates: ['movies'] },
                resume: { trajectory: [{ step: 2 }], completedStepCount: 2 },
            }],
            dataLoadingChatMessages: [{
                role: 'assistant',
                content: 'Found data',
                codeBlocks: [{ code: 'load()' }],
                tables: [{ name: 'Movies' }],
                loadPlan: { steps: [{ action: 'load' }] },
                dataOperation: { candidates: ['movies'] },
                connectorForm: { sourceType: 'postgresql' },
            }],
            snapshot: { keep: 'open' },
        }, null, 2);
        const state = EditorState.create({ doc, extensions: [json()] });

        const foldedContents = getSavedStateAutoFoldRanges(state)
            .map(range => state.doc.sliceString(range.from, range.to));

        expect(foldedContents).toHaveLength(20);
        expect(foldedContents.some(content => content.includes('"columns"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"title": "Movie"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"role": "user"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"concepts"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"vlSpec"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"Inspect chart"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"sourceType": "postgresql"'))).toBe(true);
        expect(foldedContents.some(content => content.includes('"keep": "open"'))).toBe(false);
        expect(foldedContents.some(content => content.includes('"content": "Found data"'))).toBe(false);
    });

    it('uses a minimal search panel without browser suggestions', () => {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc: '{"tableSemantics": []}',
                extensions: [search({ createPanel: createSavedStateSearchPanel })],
            }),
        });

        openSearchPanel(view);
        const panel = view.dom.querySelector('.cm-search')!;
        const input = panel.querySelector('input')!;

        expect(input.name).toBe('df-saved-state-find');
        expect(input.autocomplete).toBe('off');
        expect(input.getAttribute('autocorrect')).toBe('off');
        expect(input.getAttribute('spellcheck')).toBe('false');
        expect([...panel.querySelectorAll('button')].map(button => button.name)).toEqual([
            'next', 'prev', 'select', 'close',
        ]);
        expect(panel.querySelectorAll('label')).toHaveLength(0);

        view.destroy();
        parent.remove();
    });
});