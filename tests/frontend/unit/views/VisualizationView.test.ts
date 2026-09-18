import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';

import { normalizeOperationPreview, VisualizationViewFC } from '../../../../src/views/VisualizationView';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { ConversationCanvas, conversationPath } from '../../../../src/views/ConversationCanvas';
import { CompactMarkdown, InteractionEntryCard, workspaceFileFromHref } from '../../../../src/views/InteractionEntryCard';
import { invalidateChart, setCachedChart } from '../../../../src/app/chartCache';
import { SourceTableShelf } from '../../../../src/views/SourceTableShelf';
import * as workspaceService from '../../../../src/app/workspaceService';
import { WorkspaceFileCanvas } from '../../../../src/views/WorkspaceFileCanvas';
import { DataThread } from '../../../../src/views/DataThread';

const CONVERSATION_ROOT_ID = 'conversation-root:test';

it('preserves the conversation and focus when changing column layouts', () => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    });
    try {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'thread-message', displayId: 'Thread',
            textKind: 'explain', content: 'A thread with enough content to render its column flow.',
            parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 }));
        store.dispatch(dfActions.setFocused({ type: 'text', textId: 'thread-message' }));
        const tree = (denseColumns: boolean) => React.createElement(Provider, { store, children:
            React.createElement(DataThread, { denseColumns }),
        });
        const { container, rerender } = render(tree(true));
        expect(container.querySelectorAll('[data-thread-item="textturn-thread-message"]')).toHaveLength(1);
        rerender(tree(false));
        expect(container.querySelectorAll('[data-thread-item="textturn-thread-message"]')).toHaveLength(1);
        expect(store.getState().focusedId).toEqual({ type: 'text', textId: 'thread-message' });
    } finally {
        vi.unstubAllGlobals();
    }
});

it('renders scratch Parquet as a read-only table preview', async () => {
    const preview = vi.spyOn(workspaceService, 'previewWorkspaceFile').mockResolvedValue({
        name: 'scratch/computed.parquet', kind: 'table', content: '', truncated: false,
        columns: ['value'], rows: [{ value: 8 }, { value: 12 }], row_count: 2,
    });
    const readText = vi.spyOn(workspaceService, 'readWorkspaceTextFile');
    try {
        const store = configureStore({ reducer: dataFormulatorReducer });
        render(React.createElement(Provider, { store, children: React.createElement(WorkspaceFileCanvas, { fileName: 'scratch/computed.parquet' }) }));
        expect(await screen.findByRole('table', { name: 'scratch/computed.parquet' })).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: 'value' })).toBeTruthy();
        expect(screen.getByRole('cell', { name: '12' })).toBeTruthy();
        preview.mockResolvedValue({
            name: 'scratch/computed.parquet', kind: 'table', content: '', truncated: false,
            columns: ['value'], rows: [{ value: 99 }], row_count: 1,
        });
        act(() => workspaceService.notifyWorkspaceFilesChanged());
        expect(await screen.findByRole('cell', { name: '99' })).toBeTruthy();
        expect(screen.queryByRole('cell', { name: '12' })).toBeNull();
        expect(readText).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    } finally {
        preview.mockRestore();
        readText.mockRestore();
    }
});


it('uses read-only artifact Markdown controls before import without workspace reads or writes', async () => {
    const file = new File(['# Source document'], 'notes.md');
    const preview = vi.spyOn(workspaceService, 'previewUploadedWorkspaceFile').mockResolvedValue({
        name: file.name, kind: 'text', content: '# Source document', truncated: false,
    });
    const readText = vi.spyOn(workspaceService, 'readWorkspaceTextFile');
    const save = vi.spyOn(workspaceService, 'saveWorkspaceTextFile');
    try {
        const store = configureStore({ reducer: dataFormulatorReducer });
        const { container } = render(React.createElement(Provider, { store, children: React.createElement(WorkspaceFileCanvas, {
            fileName: file.name, sourceFile: file,
        }) }));
        expect(await screen.findByRole('heading', { name: 'Source document' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'View source' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Preview Markdown' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Save file' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Rename file' })).toBeNull();
        fireEvent.keyDown(container.firstChild!, { key: 's', ctrlKey: true });
        expect(readText).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    } finally {
        preview.mockRestore();
        readText.mockRestore();
        save.mockRestore();
    }
});

it('uses file display names with filename bylines and legacy fallback', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const file = { name: 'scratch/unesco_education_summary.md', filename: 'unesco_education_summary.md',
        temporary: true, created_at: '', content_hash: '', file_size: 10, media_type: 'text/markdown' };
    const shelf = (display_name?: string) => React.createElement(Provider, { store,
        children: React.createElement(SourceTableShelf, {
            inputTables: [], workspaceFiles: [{ ...file, display_name }], highlightedTableIds: [],
        }),
    });
    const { rerender } = render(shelf('UNESCO Education'));
    const label = screen.getByText('UNESCO Education');
    expect(screen.getByText(file.filename)).toBeTruthy();
    fireEvent.click(label);
    expect(store.getState().focusedId).toEqual({ type: 'file', fileName: file.name });
    expect(screen.getByRole('button', { name: `Actions for ${file.name}` })).toBeTruthy();
    rerender(shelf());
    expect(screen.getByText(file.filename)).toBeTruthy();
    expect(screen.queryByText('UNESCO Education')).toBeNull();
    rerender(shelf(file.filename));
    expect(screen.getAllByText(file.filename)).toHaveLength(1);
});

it('keeps temporary-file Delete available through refresh and deletes the selected file', async () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const file = { name: 'scratch/draft.md', filename: 'draft.md', temporary: true,
        created_at: '', content_hash: '', file_size: 10, media_type: 'text/markdown' };
    store.dispatch(dfActions.setFocused({ type: 'file', fileName: file.name }));
    const deleteFile = vi.spyOn(workspaceService, 'deleteWorkspaceFile').mockResolvedValue(undefined);
    const shelf = () => React.createElement(Provider, { store, children: React.createElement(SourceTableShelf, {
        inputTables: [], workspaceFiles: [{ ...file }], highlightedTableIds: [],
    }) });
    try {
        const { rerender } = render(shelf());
        expect(screen.queryByText('Temporary')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: `Actions for ${file.name}` }));
        expect(screen.getByRole('menuitem', { name: 'Delete file' })).toBeTruthy();
        expect(screen.queryByRole('menuitem', { name: 'Preview file' })).toBeNull();
        rerender(shelf());
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete file' }));
        await waitFor(() => expect(deleteFile).toHaveBeenCalledWith(file.name));
        await waitFor(() => expect(store.getState().focusedId).toBeUndefined());
    } finally {
        deleteFile.mockRestore();
    }
});

it.each([
    '/api/workspace/files/scratch/summary%20draft.md',
    '/api/agent/workspace/scratch/summary%20draft.md',
    'scratch/summary%20draft.md',
])('opens artifact links in the workspace canvas: %s', href => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const parentClick = vi.fn();
    render(React.createElement(Provider, { store, children:
        React.createElement('div', { onClick: parentClick },
            React.createElement(CompactMarkdown, { content: `[Draft](${href})`, color: 'text.primary' })),
    }));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('link', { name: 'Draft' }), event);
    expect(event.defaultPrevented).toBe(true);
    expect(parentClick).not.toHaveBeenCalled();
    expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'file', fileName: 'scratch/summary draft.md' });
});

it('does not treat external or unsafe URLs as workspace files', () => {
    for (const href of ['https://example.com/scratch/a.md', 'javascript:alert(1)', 'scratch/../a.md', 'scratch/%2E%2E/a.md', 'scratch/%zz']) {
        expect(workspaceFileFromHref(href)).toBeNull();
    }
});

it.each(['conversation', 'long_response'] as const)('normalizes mixed legacy commands in the %s canvas', surface => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const execution = { id: 'command', argv: ['az', 'account', 'show'], cwd: '/workspace', purpose: 'Inspect',
        status: 'completed' as const, result: { exit_code: 0, output: 'Account result' } };
    store.dispatch(dfActions.loadState({ __stateVersion: 6, textTurns: [{ kind: 'text', id: 'legacy', displayId: 'Legacy', textKind: 'explain', createdAt: 1,
        content: 'Inspect.\n\n```json\n' + JSON.stringify({ argv: execution.argv, cwd: execution.cwd, result: execution.result }) + '\n```',
        executions: [execution], ...(surface === 'long_response' ? { presentation: 'long_response' as const } : {}),
    }] } as any));
    store.dispatch(dfActions.setFocused(surface === 'conversation'
        ? { type: 'conversation', tableId: 'legacy', nodeIds: ['legacy'] } : { type: 'text', textId: 'legacy' }));
    const { container } = render(React.createElement(Provider, { store, children: React.createElement(VisualizationViewFC) }));
    expect(screen.getAllByRole('button', { name: /az account show Completed/ })).toHaveLength(1);
    expect(container.querySelector('pre')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /az account show Completed/ }));
    expect(screen.getByText('Account result')).toBeTruthy();
    expect(container.querySelector('details pre')?.textContent).toBe(JSON.stringify(execution.argv, null, 2));
});

it('shows table-owned instructions in conversation without making the instruction card clickable', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const entry = { from: 'data-agent', to: 'user', role: 'instruction', content: 'Which deployments drive token volume?', timestamp: 10 } as const;
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'deployments', displayId: 'Deployments', names: [], metadata: {}, rows: [],
        derive: { source: [], code: '', dialog: [], trigger: { tableId: 'root', instruction: entry.content, interaction: [entry] } },
    } as any));
    const onClick = vi.fn(() => store.dispatch(dfActions.setFocused({ type: 'conversation', tableId: 'deployments', entryIndex: 0 })));
    const card = render(React.createElement(InteractionEntryCard, { entry, onClick }));
    fireEvent.click(screen.getByText(entry.content));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
    store.dispatch(dfActions.setFocused({ type: 'conversation', tableId: 'deployments', entryIndex: 0 }));
    expect(dfSelectors.getEffectiveTableId(store.getState())).toBe('deployments');
    expect(dfSelectors.selectCanvasTarget(store.getState())).toEqual({ type: 'conversation', tableId: 'deployments', entryIndex: 0 });
    card.unmount();
    const { container } = render(React.createElement(Provider, { store, children: React.createElement(VisualizationViewFC) }));
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeTruthy();
    expect(container.querySelector('[data-conversation-entry="deployments-interaction-0"]')?.textContent).toBe(entry.content);
});

it('shows command-only migrated table history in conversation', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.loadState({ __stateVersion: 6, derivedTables: [{ id: 'legacy-table', kind: 'table', displayId: 'Legacy',
        names: [], rows: [], metadata: {}, derive: { source: [], code: '', dialog: [], trigger: { tableId: 'root', instruction: '', interaction: [{
            from: 'data-agent', to: 'user', role: 'explain', content: '```json\n{"argv":["pwd"],"cwd":"/"}\n```',
        }] } },
    }] } as any));
    store.dispatch(dfActions.setFocused({ type: 'conversation', tableId: 'legacy-table', nodeIds: ['legacy-table'] }));
    render(React.createElement(Provider, { store, children: React.createElement(VisualizationViewFC) }));
    expect(screen.getByRole('button', { name: /pwd Status unavailable/ })).toBeTruthy();
});

it('follows shared ancestry and a single continuation without mixing sibling branches', () => {
    const nodes = [{ id: 'root' }, { id: 'first', parentNodeId: 'root' },
        { id: 'left', parentNodeId: 'first' }, { id: 'right', parentNodeId: 'first' },
        { id: 'next', parentNodeId: 'left' }];
    expect(conversationPath(nodes, 'left')).toEqual(['root', 'first', 'left', 'next']);
    expect(conversationPath(nodes, 'first')).toEqual(['root', 'first']);
    expect(conversationPath([{ id: 'cycle', parentNodeId: 'cycle' }], 'cycle')).toEqual(['cycle']);
});

it('renders a conversation canvas with full messages and collapsed command results', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'first', displayId: 'first', textKind: 'explain',
        parentNodeId: 'root', content: 'I will inspect the account.', prompt: 'Analyze usage', createdAt: 1,
        executions: [{ id: 'command', argv: ['az', 'account', 'show'], cwd: '/workspace', purpose: 'Inspect', status: 'completed', result: { output: 'Account result' } }],
    }));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'next', displayId: 'next', textKind: 'explain',
        parentNodeId: 'first', content: 'Here are the findings.', createdAt: 2,
    }));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'outside', displayId: 'outside', textKind: 'explain',
        parentNodeId: 'next', content: 'Outside this segment.', createdAt: 3,
    }));
    store.dispatch(dfActions.setFocused({ type: 'conversation', tableId: 'root', nodeIds: ['first', 'next'] }));
    render(React.createElement(Provider, { store, children: React.createElement(VisualizationViewFC) }));
    expect(screen.getByRole('heading', { name: 'Conversation' })).toBeTruthy();
    expect(screen.getByText('Analyze usage')).toBeTruthy();
    expect(screen.getByText('Here are the findings.')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'User' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Agent' })).toBeNull();
    expect(screen.getByText('Analyze usage').closest('[data-conversation-role="user"]')).toBeTruthy();
    expect(screen.getByText('Here are the findings.').closest('[data-conversation-role="agent"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /az account show Completed/ }).closest('[data-conversation-role="agent"]')).toBeTruthy();
    expect(screen.queryByText('Outside this segment.')).toBeNull();
    expect(screen.queryByText('Agent', { exact: true })).toBeNull();
    expect(screen.queryByText('You', { exact: true })).toBeNull();
    expect(screen.queryByText('Account result')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /az account show Completed/ }));
    expect(screen.getByText('Account result')).toBeTruthy();
});

vi.mock('../../../../src/components/ConnectorFormCard', () => ({
    ConnectorFormCard: ({ prompt }: any) => React.createElement('div', { 'data-connector-id': prompt.connectorId }, 'Connector fields'),
}));

it.each(['table', 'chart', 'chart-image'])('shows inline table and chart previews and opens the %s artifact', target => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'usage', displayId: 'Usage', names: ['resource', 'tokens'],
        metadata: { resource: { type: 'string' }, tokens: { type: 'number' } },
        rows: Array.from({ length: 7 }, (_, index) => ({ resource: `resource-${index}`, tokens: index * 100 })),
        derive: { source: [], code: '', dialog: [], trigger: { tableId: 'root', instruction: 'Inspect usage', interaction: [
            { from: 'user', to: 'data-agent', role: 'prompt', content: 'Visualize it and write a report', timestamp: 1 },
            { from: 'data-agent', to: 'user', role: 'instruction', content: 'Which resources account for observed token consumption?', timestamp: 2 },
        ] } },
    } as any));
    store.dispatch(dfActions.addChart({ id: 'usage-chart', chartType: 'Bar Chart', tableRef: 'usage', source: 'user', encodingMap: {} } as any));
    const image = 'data:image/png;base64,preview';
    store.dispatch(dfActions.updateChartThumbnail({ chartId: 'usage-chart', thumbnail: image }));
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'findings', displayId: 'findings', textKind: 'explain',
        parentNodeId: 'usage', content: 'Usage increased this month.', createdAt: 1,
    }));
    store.dispatch(dfActions.setFocused({ type: 'text', textId: 'findings' }));
    render(React.createElement(Provider, { store, children: React.createElement(ConversationCanvas, { textTurnId: 'findings', nodeIds: ['usage', 'findings'] }) }));
    expect(screen.getByRole('img', { name: 'Bar Chart - Usage' }).getAttribute('src')).toBe(image);
    expect(screen.getByText('Visualize it and write a report')).toBeTruthy();
    expect(screen.getByText('Which resources account for observed token consumption?')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('resource-0')).toBeTruthy();
    expect(screen.getByText('resource-4')).toBeTruthy();
    expect(screen.queryByText('resource-5')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: target === 'table' ? 'Open table: Usage'
        : target === 'chart' ? 'Open chart: Bar Chart - Usage' : 'Bar Chart - Usage' }));
    expect(store.getState().focusedId).toEqual(target === 'table'
        ? { type: 'table', tableId: 'usage' } : { type: 'chart', chartId: 'usage-chart' });
});

it.each(['Auto', '?', 'Table'])('does not display internal %s trigger charts as conversation artifacts', chartType => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'resources', displayId: 'Resources', names: [], metadata: {}, rows: [] } as any));
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'deployments', displayId: 'Deployments', names: [], metadata: {}, rows: [],
        derive: { source: ['resources'], code: '', dialog: [], trigger: { tableId: 'resources', instruction: 'Analyze deployments',
            chart: { id: 'trigger-chart', chartType, tableRef: 'resources', source: 'trigger', encodingMap: {} },
        } },
    } as any));
    store.dispatch(dfActions.addChart({ id: 'real-chart', chartType: 'Bar Chart', tableRef: 'resources', source: 'user', encodingMap: {} } as any));
    expect(dfSelectors.getAllCharts(store.getState()).some(chart => chart.id === 'trigger-chart')).toBe(true);
    render(React.createElement(Provider, { store, children: React.createElement(ConversationCanvas, { textTurnId: 'deployments', nodeIds: ['resources', 'deployments'] }) }));
    expect(screen.queryByText(`${chartType} - Resources`)).toBeNull();
    expect(screen.getByRole('button', { name: 'Open chart: Bar Chart - Resources' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open table: Resources' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open table: Deployments' })).toBeTruthy();
});

it.each([true, false])('opens a chart from its labeled preview with or without a cached image (cached: %s)', cached => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const chartId = 'narrow-preview';
    const label = 'Bar Chart - Token Usage By Deployment';
    store.dispatch(dfActions.addTableToStore({ kind: 'table', id: 'deployment-table', displayId: 'Token Usage By Deployment',
        names: [], metadata: {}, rows: [],
    } as any));
    store.dispatch(dfActions.addChart({ id: chartId, chartType: 'Bar Chart', tableRef: 'deployment-table', source: 'user', encodingMap: {} } as any));
    if (cached) setCachedChart(chartId, { svg: '', thumbnailDataUrl: '', fullPngDataUrl: 'data:image/png;base64,narrow',
        specKey: 'narrow', naturalWidth: 120, naturalHeight: 300 });
    try {
        render(React.createElement(Provider, { store, children: React.createElement(ConversationCanvas, { textTurnId: 'deployment-table' }) }));
        expect(screen.getAllByText(label)).toHaveLength(1);
        if (cached) expect(screen.getByRole('img', { name: label })).toHaveAttribute('src', 'data:image/png;base64,narrow');
        else expect(screen.queryByRole('img', { name: label })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: `Open chart: ${label}` }));
        expect(store.getState().focusedId).toEqual({ type: 'chart', chartId });
    } finally {
        invalidateChart(chartId);
    }
});

it('renders explicit long responses in the dedicated response view, not Conversation', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTextTurn({ kind: 'text', id: 'long', displayId: 'Long', textKind: 'explain',
        content: 'Detailed standalone findings.', presentation: 'long_response', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 }));
    store.dispatch(dfActions.setFocused({ type: 'text', textId: 'long' }));
    render(React.createElement(Provider, { store, children: React.createElement(VisualizationViewFC) }));
    expect(screen.getByText('Detailed standalone findings.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Conversation' })).toBeNull();
    expect(screen.getByRole('heading')).toBeTruthy();
});

it.each([
    { sourceType: 'mysql' },
    { sourceType: 'local_folder', status: 'connected' as const, connectorId: 'unesco-folder', connectionName: 'UNESCO' },
])('renders the connector view for $sourceType instead of reopening setup or showing plain text', connector => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTextTurn({
        kind: 'text', id: 'form', displayId: 'form', textKind: 'explain',
        content: 'Please provide the details in the form.', parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1,
        form: { kind: 'connector', title: 'Connection', connector },
    }));
    store.dispatch(dfActions.setFocused({ type: 'text', textId: 'form' }));
    render(React.createElement(Provider, { store, children: React.createElement(VisualizationViewFC) }));
    expect(screen.getByText('Connector fields')).toBeTruthy();
    if (connector.connectorId) {
        expect(screen.getByText('Connector fields').getAttribute('data-connector-id')).toBe(connector.connectorId);
        expect(screen.queryByRole('button', { name: 'Select Folder' })).toBeNull();
    }
});

describe('normalizeOperationPreview', () => {
    it('supplies empty arrays for a failed preview with missing table data', () => {
        expect(normalizeOperationPreview({
            display_name: 'Recent orders',
            source_id: 'warehouse',
            error: 'Warehouse unavailable',
        })).toEqual({
            display_name: 'Recent orders',
            source_id: 'warehouse',
            error: 'Warehouse unavailable',
            columns: [],
            rows: [],
        });
    });
});