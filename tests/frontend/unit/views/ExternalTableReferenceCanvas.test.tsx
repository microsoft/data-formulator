import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { ExternalTableReferenceCanvas } from '../../../../src/views/ExternalTableReferenceCanvas';
import { SourceTableShelf } from '../../../../src/views/SourceTableShelf';
import { apiRequest } from '../../../../src/app/apiClient';
import { CONNECTOR_ACTION_URLS } from '../../../../src/app/utils';
import type { ExternalTableReference } from '../../../../src/components/ComponentType';
import { SelectableDataGrid } from '../../../../src/views/SelectableDataGrid';
import { MultiTablePreview } from '../../../../src/views/MultiTablePreview';
import { MessageSnackbar } from '../../../../src/views/MessageSnackbar';
import { Type } from '../../../../src/data/types';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('react-virtuoso', () => ({
    TableVirtuoso: ({ data, fixedHeaderContent, itemContent }: any) => <table><thead>{fixedHeaderContent()}</thead>
        <tbody>{data.map((row: any, index: number) => <tr key={index}>{itemContent(index, row)}</tr>)}</tbody></table>,
}));

it('keeps batch progress in system messages until the load finishes', async () => {
    const scrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
    try {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.startTableLoad({ id: 'batch', names: [], progress: { current: 1, total: 2, name: 'Orders' } }));
        render(<Provider store={store}><MessageSnackbar /></Provider>);
        expect(screen.getByRole('status', { name: 'Loading 1/2: Orders' })).toBeVisible();
        expect(screen.getByRole('status', { name: 'Loading 1/2: Orders' })).toHaveStyle({ fontSize: 'var(--df-text-sm)' });
        expect(screen.getByRole('status', { name: 'Loading 1/2: Orders' }).closest('.MuiPaper-root')).toHaveStyle({ backgroundColor: 'rgb(250, 250, 250)' });
        act(() => store.dispatch(dfActions.startTableLoad({ id: 'batch', names: [], progress: { current: 2, total: 2, name: 'Customers' } })));
        expect(screen.getByRole('status', { name: 'Loading 2/2: Customers' })).toBeVisible();
        act(() => store.dispatch(dfActions.clearMessages()));
        expect(screen.getByRole('status', { name: 'Loading 2/2: Customers' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'View system messages' }));
        expect(screen.getByText('System messages (1)')).toBeVisible();
        expect(screen.queryByText('No messages')).not.toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByRole('status', { name: 'Loading 2/2: Customers' })).toHaveLength(1));
        act(() => store.dispatch(dfActions.finishTableLoad('batch')));
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    } finally {
        if (scrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollTo);
        else delete (HTMLElement.prototype as any).scrollTo;
    }
});

it.each(['success', 'info', 'warning', 'error'] as const)('uses compact neutral styling for %s system messages', type => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><MessageSnackbar /></Provider>);
    act(() => store.dispatch(dfActions.addMessages({ type, component: 'test', timestamp: Date.now(), value: 'Load finished' })));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveStyle({ fontSize: 'var(--df-text-sm)', backgroundColor: 'rgb(250, 250, 250)' });
    expect(alert.querySelector('.MuiAlert-icon')).toHaveStyle({ fontSize: '16px' });
    expect(alert.querySelector('.MuiAlert-action .MuiSvgIcon-root')).toHaveStyle({ fontSize: '16px' });
});

it('uses shared initial and refresh states in multi-table previews', () => {
    const view = render(<MultiTablePreview loading />);
    expect(screen.getByRole('progressbar', { name: 'Loading preview...' })).toBeInTheDocument();
    view.rerender(<MultiTablePreview loading table={{ kind: 'table', id: 'sample', displayId: 'Sample',
        names: ['value'], metadata: {}, rows: [{ value: 'Retained row' }], description: '', virtual: { tableId: 'sample', rowCount: 1 } }} />);
    expect(screen.getByText('Retained row')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Refreshing preview...' })).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

it('renders the normal grid in preview-only mode without field actions or data downloads', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><SelectableDataGrid tableId="external:test" tableName="Preview" virtual={false}
        previewOnly rows={[{ review: 'Preview row' }]} rowCount={1}
        columnDefs={[{ id: 'review', label: 'review', dataType: Type.String, source: 'original' }]} /></Provider>);
    expect(screen.getByText('Preview row')).toBeVisible();
    expect(screen.getByText('review').closest('.data-view-header-container')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
});

it('uses a centered track for empty grid requests and retains rows with inline refresh status', async () => {
    let finishRequest!: (value: any) => void;
    vi.mocked(apiRequest).mockImplementation(() => new Promise(resolve => { finishRequest = resolve; }));
    const store = configureStore({ reducer: dataFormulatorReducer });
    const grid = (searchText: string) => <Provider store={store}><SelectableDataGrid tableId="grid:test" tableName="Preview" virtual
        previewOnly rows={[]} rowCount={2} searchText={searchText}
        columnDefs={[{ id: 'review', label: 'review', dataType: Type.String, source: 'original' }]} /></Provider>;
    const view = render(grid(''));
    view.rerender(grid('first'));
    expect(screen.getByRole('progressbar')).toHaveClass('MuiLinearProgress-root');
    await act(async () => finishRequest({ data: { rows: [{ review: 'Retained row' }], total_row_count: 1 } }));
    view.rerender(grid('second'));
    expect(screen.getByText('Retained row')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Refreshing rows...' })).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    await act(async () => finishRequest({ data: { rows: [{ review: 'Updated row' }], total_row_count: 1 } }));
    expect(screen.getByText('Updated row')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('preserves the timeline rail beside both shelf expansion controls', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const tables = Array.from({ length: 7 }, (_, index) => ({ kind: 'table' as const,
        id: `table-${index}`, displayId: `Table ${index}`, names: [], rows: [], metadata: {}, description: '',
        virtual: { tableId: `table-${index}`, rowCount: 0 } }));
    render(<Provider store={store}><SourceTableShelf inputTables={tables} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    const showAll = screen.getByRole('button', { name: 'Show all 7' });
    expect(showAll.parentElement?.querySelector('[aria-hidden="true"]')).toHaveStyle({
        position: 'absolute', top: '0px', bottom: '0px', borderLeft: '2px solid rgba(0,0,0,0.1)',
    });
    fireEvent.click(showAll);
    const showFewer = screen.getByRole('button', { name: 'Show fewer' });
    expect(showFewer.parentElement?.querySelector('[aria-hidden="true"]')).toHaveStyle({
        position: 'absolute', top: '0px', bottom: '0px', borderLeft: '2px solid rgba(0,0,0,0.1)',
    });
});

it('shows pending loads in an empty workspace without creating selectable tables', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.startTableLoad({ id: 'request', names: ['Orders', 'Customers'] }));
    const view = render(<Provider store={store}><SourceTableShelf inputTables={[]} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    expect(screen.getByRole('status', { name: 'Loading Orders' })).toBeVisible();
    const spinner = screen.getByRole('status', { name: 'Loading Orders' }).querySelector('.MuiCircularProgress-root');
    expect(spinner?.parentElement).toHaveTextContent('Loading...');
    expect(spinner?.parentElement).not.toHaveTextContent('Orders');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
    expect(spinner).toHaveStyle({ width: '1em', height: '1em' });
    expect(spinner?.parentElement).toHaveStyle({ fontSize: 'var(--df-text-xs)', gap: '4px' });
    expect(spinner?.parentElement?.parentElement).toHaveStyle({ padding: '4px 6px' });
    expect(screen.getByRole('status', { name: 'Loading Orders' }).querySelector('.MuiSkeleton-root')).toBeNull();
    const loadingRail = screen.getByRole('status', { name: 'Loading Orders' }).firstElementChild;
    expect(loadingRail).toHaveAttribute('aria-hidden', 'true');
    expect(loadingRail).toHaveStyle({ width: '14px', flexShrink: '0' });
    expect(loadingRail?.firstElementChild).toHaveStyle({ borderLeft: '2px solid rgba(0,0,0,0.1)' });
    expect(loadingRail?.lastElementChild).toHaveStyle({ borderLeft: '2px solid rgba(0,0,0,0.1)' });
    expect(screen.getByRole('status', { name: 'Loading Customers' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Orders' })).not.toBeInTheDocument();
    expect(store.getState().inputTables).toEqual([]);
    store.dispatch(dfActions.finishTableLoad('request'));
    view.rerender(<Provider store={store}><SourceTableShelf inputTables={[]} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

const reference: ExternalTableReference = {
    kind: 'external-table-reference', id: 'external:adx:events-key', connectorId: 'adx', connectorName: 'Corporate ADX',
    tableKey: 'events-key', sourceTable: { id: 'db.events', name: 'db.events' }, displayName: 'Events',
    capturedAt: '2026-09-18T00:00:00Z',
    summary: { columns: [{ name: 'timestamp', type: 'datetime' }], rowCount: 19_521_849, description: 'Telemetry events' },
};

beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function showArtifact(withReference = true) {
    const store = configureStore({ reducer: dataFormulatorReducer });
    if (withReference) store.dispatch(dfActions.upsertExternalTableReference(reference));
    render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    return store;
}

it('uses the standard table card for references and keeps their information in the preview', async () => {
    const table = {
        kind: 'table' as const, id: 'local-events', displayId: 'Local events', names: [], metadata: {}, rows: [],
        virtual: { tableId: 'local-events', rowCount: 0 }, description: '',
    };
    const initialState = dataFormulatorReducer(undefined, { type: 'init' });
    const store = configureStore({ reducer: dataFormulatorReducer, preloadedState: { ...initialState, derivedTables: [table] } });
    store.dispatch(dfActions.upsertExternalTableReference(reference));
    const { container } = render(<Provider store={store}><SourceTableShelf inputTables={[table]} highlightedTableIds={[]} workspaceFiles={[{
        name: 'notes.txt', filename: 'notes.txt', created_at: reference.capturedAt,
        content_hash: 'notes', file_size: 10, media_type: 'text/plain',
    }]} /></Provider>);
    const tableCard = screen.getByRole('button', { name: 'Local events' });
    const referenceCard = screen.getByRole('button', { name: 'Events' });
    expect(referenceCard.closest('.data-thread-card')?.className).toBe(tableCard.closest('.data-thread-card')?.className);
    expect(screen.getAllByTestId('InsertDriveFileOutlinedIcon')).toHaveLength(1);
    expect(screen.getByText('(virtual)')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Remove reference' })).not.toBeInTheDocument();
    const referenceIcon = container.querySelector(`[data-workspace-item="${reference.id}"] > div:first-child svg`)!;
    const fileIcon = screen.getByTestId('InsertDriveFileOutlinedIcon');
    expect(referenceIcon).toHaveStyle({ color: 'rgba(0, 0, 0, 0.15)' });
    fireEvent.click(referenceCard);
    expect(store.getState().focusedId).toEqual({ type: 'external-table', referenceId: reference.id });
    expect(referenceIcon).toHaveStyle({ color: 'rgb(25, 118, 210)' });
    expect(fileIcon).toHaveStyle({ color: 'rgba(0, 0, 0, 0.35)' });
    fireEvent.click(screen.getByRole('button', { name: 'notes.txt' }));
    expect(fileIcon).toHaveStyle({ color: 'rgb(25, 118, 210)' });
    expect(referenceIcon).toHaveStyle({ color: 'rgba(0, 0, 0, 0.15)' });
    fireEvent.click(referenceCard);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Events' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove reference' }));
    expect(store.getState().externalTableReferences).toEqual([]);
    expect(screen.getByRole('button', { name: 'notes.txt' })).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
});

it.each([
    ['az://example.blob.core.windows.net/fxdata/games.parquet', 'games.parquet'],
    ['https://example.com/data/games.parquet?version=2', 'games.parquet'],
    ['/data/games.parquet', 'games.parquet'],
])('shows a compact virtual card for %s', (sourceName, shortName) => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference, displayName: sourceName,
        sourceTable: { id: sourceName, name: sourceName } }));
    render(<Provider store={store}><SourceTableShelf inputTables={[]} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    expect(screen.getByRole('button', { name: shortName })).toBeInTheDocument();
    expect(screen.getByText(shortName, { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(sourceName, { exact: true })).not.toBeInTheDocument();
    expect(store.getState().externalTableReferences[0].sourceTable.name).toBe(sourceName);
    expect(apiRequest).not.toHaveBeenCalled();
});

it('nests exact single-source imports as compact rows and keeps ambiguous tables at top level', async () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference(reference));
    const imported = { kind: 'table' as const, id: 'loaded-events', displayId: 'Loaded events', names: [], metadata: {}, rows: [], description: '',
        virtual: { tableId: 'loaded-events', rowCount: 0 },
        source: { type: 'database' as const, importedFrom: { connectorId: reference.connectorId, tableKey: reference.tableKey } } };
    const multiSource = { ...imported, id: 'joined-events', displayId: 'Joined events', virtual: { tableId: 'joined-events', rowCount: 0 }, dataProvenance: {
        origin: 'agent', role: 'source', editPolicy: 'agent_editable', stale: false,
        inputSources: [{ id: 'first', kind: 'data' as const, displayName: 'First' }, { id: 'second', kind: 'data' as const, displayName: 'Second' }],
    } };
    const otherConnector = { ...imported, id: 'other-events', displayId: 'Other events', virtual: { tableId: 'other-events', rowCount: 0 }, source: {
        ...imported.source, importedFrom: { connectorId: 'different', tableKey: reference.tableKey },
    } };
    const unknown = { ...imported, id: 'legacy-events', displayId: 'Legacy events', virtual: { tableId: 'legacy-events', rowCount: 0 }, source: undefined };
    const tables = [imported, multiSource, otherConnector, unknown];
    tables.forEach(table => store.dispatch(dfActions.addTableToStore(table)));
    render(<Provider store={store}><SourceTableShelf inputTables={tables} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    expect(screen.queryByRole('button', { name: 'Loaded events' })).not.toBeInTheDocument();
    for (const name of ['Joined events', 'Other events', 'Legacy events']) {
        expect(screen.getByRole('button', { name }).closest('.data-thread-card')).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Imports from Events' }));
    const child = screen.getByRole('button', { name: 'Loaded events' });
    expect(child.closest('ul')).toHaveAttribute('aria-label', 'Imports from Events');
    expect(child.closest('.data-thread-card')).toBeNull();
    fireEvent.click(child);
    expect(store.getState().focusedId).toEqual({ type: 'table', tableId: imported.id });
    expect(child).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Loaded events' }));
    expect(await screen.findByRole('menuitem', { name: /Rename/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Imports from Events' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Loaded events' })).not.toBeInTheDocument());
    act(() => store.dispatch(dfActions.setFocused({ type: 'table', tableId: unknown.id })));
    act(() => store.dispatch(dfActions.setFocused({ type: 'table', tableId: imported.id })));
    expect(await screen.findByRole('button', { name: 'Loaded events' })).toBeInTheDocument();
    act(() => store.dispatch(dfActions.removeExternalTableReference(reference.id)));
    expect(screen.getByRole('button', { name: 'Loaded events' }).closest('.data-thread-card')).toBeInTheDocument();
    expect(dfSelectors.getAllTables(store.getState()).map(table => table.id)).toContain(imported.id);
});

it('groups single-input workflow tables through manifest provenance but not joins or unresolved lineage', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference(reference));
    const imported = { kind: 'table' as const, id: 'loaded:events', displayId: 'Imported events', names: [], metadata: {}, rows: [], description: '',
        virtual: { tableId: 'loaded:events', rowCount: 0 },
        contentHash: 'a'.repeat(64),
        source: { type: 'database' as const, importedFrom: { connectorId: reference.connectorId, tableKey: reference.tableKey } } };
    const workflowTable = (id: string, sourceIds: string[]) => ({ ...imported, id, displayId: id, source: undefined,
        virtual: { tableId: id, rowCount: 0 },
        dataProvenance: { origin: 'agent', role: 'source', editPolicy: 'agent_editable', stale: false,
            inputSources: sourceIds.map(sourceId => ({ id: `data:${'a'.repeat(64)}:${encodeURIComponent(sourceId)}`, kind: 'data' as const, displayName: 'Not an identity' })) } });
    const tables = [imported, workflowTable('Hourly counts', [imported.id]), workflowTable('Daily summary', ['Hourly counts']),
        workflowTable('Joined comparison', [imported.id, 'Hourly counts']), workflowTable('Missing input', ['unavailable']),
        workflowTable('Cycle first', ['Cycle second']), workflowTable('Cycle second', ['Cycle first']),
        workflowTable('Summary of join', ['Joined comparison'])];
    tables.forEach(table => store.dispatch(dfActions.addTableToStore(table)));
    render(<Provider store={store}><SourceTableShelf inputTables={tables} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Imports from Events' }));
    for (const name of ['Imported events', 'Hourly counts', 'Daily summary']) {
        const child = screen.getByRole('button', { name });
        expect(child.closest('ul')).toHaveAttribute('aria-label', 'Imports from Events');
        expect(child.closest('.data-thread-card')).toBeNull();
    }
    for (const name of ['Joined comparison', 'Missing input', 'Cycle first', 'Cycle second', 'Summary of join']) {
        expect(screen.getByRole('button', { name }).closest('.data-thread-card')).toBeInTheDocument();
    }
});

it('only follows version-matched lineage and keeps durable workflow identity without a parent', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference(reference));
    const origin = { connectorId: reference.connectorId, tableKey: reference.tableKey };
    const parent = { kind: 'table' as const, id: 'parent', displayId: 'Parent', names: [], metadata: {}, rows: [],
        description: '', virtual: { tableId: 'parent', rowCount: 0 },
        contentHash: 'b'.repeat(64), source: { type: 'database' as const, importedFrom: origin } };
    const derived = { ...parent, id: 'changed', displayId: 'Changed input', source: undefined,
        virtual: { tableId: 'changed', rowCount: 0 },
        dataProvenance: { origin: 'agent', role: 'derived', editPolicy: 'agent_editable', stale: false,
            inputSources: [{ id: `data:${'a'.repeat(64)}:parent`, kind: 'data' as const, displayName: 'Parent' }] } };
    const unversioned = { ...derived, id: 'unversioned', displayId: 'Unversioned input', virtual: { tableId: 'unversioned', rowCount: 0 }, dataProvenance: { ...derived.dataProvenance,
        inputSources: [{ id: 'data:parent', kind: 'data' as const, displayName: 'Parent' }] } };
    const durable = { ...derived, id: 'durable', displayId: 'Durable identity', virtual: { tableId: 'durable', rowCount: 0 }, source: parent.source };
    const tables = [derived, unversioned, durable];
    [parent, ...tables].forEach(table => store.dispatch(dfActions.addTableToStore(table)));
    const view = render(<Provider store={store}><SourceTableShelf inputTables={tables} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    for (const name of ['Changed input', 'Unversioned input']) {
        expect(screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('.data-thread-card')).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Durable identity' }).closest('.data-thread-card')).toBeNull();
    view.unmount();
    const restored = configureStore({ reducer: dataFormulatorReducer });
    restored.dispatch(dfActions.upsertExternalTableReference(reference));
    restored.dispatch(dfActions.addTableToStore(durable));
    render(<Provider store={restored}><SourceTableShelf inputTables={[durable]} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    expect(screen.getByRole('button', { name: 'Durable identity' }).closest('.data-thread-card')).toBeNull();
});

it('recovers saved import provenance from workspace metadata and preserves it on reload', async () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.setActiveWorkspace({ id: 'imports', displayName: 'Imports' }));
    store.dispatch(dfActions.upsertExternalTableReference(reference));
    const table = { kind: 'table' as const, id: 'saved-events', displayId: 'Saved events', names: [], metadata: {}, rows: [], description: '',
        virtual: { tableId: 'saved-events', rowCount: 0 },
        source: { type: 'database' as const, autoRefresh: true } };
    store.dispatch(dfActions.addTableToStore(table));
    vi.mocked(apiRequest).mockResolvedValue({ data: { tables: [{ name: table.id, columns: [], sample_rows: [], row_count: 0,
        source_metadata: { import_options: { data_operation: { source_id: reference.connectorId, table_key: reference.tableKey } } },
    }] } });
    const shelf = () => <Provider store={store}><SourceTableShelf inputTables={dfSelectors.getAllTables(store.getState())}
        highlightedTableIds={[]} workspaceFiles={[]} /></Provider>;
    const view = render(shelf());
    await waitFor(() => expect(dfSelectors.getAllTables(store.getState())[0].source?.importedFrom).toEqual({
        connectorId: reference.connectorId, tableKey: reference.tableKey,
    }));
    expect(apiRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { 'X-Workspace-Id': 'imports' } }));
    expect(dfSelectors.getAllTables(store.getState())[0].source?.autoRefresh).toBe(true);
    view.unmount();
    store.dispatch(dfActions.loadState(store.getState()));
    render(shelf());
    expect(screen.getByRole('button', { name: 'Imports from Events' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Saved events' }).closest('.data-thread-card')).toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(1);
});

it('ignores import metadata returned after switching workspaces', async () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.setActiveWorkspace({ id: 'old-workspace', displayName: 'Old workspace' }));
    store.dispatch(dfActions.upsertExternalTableReference(reference));
    const table = { kind: 'table' as const, id: 'events', displayId: 'Events import', names: [], metadata: {}, rows: [], description: '',
        virtual: { tableId: 'events', rowCount: 0 },
        source: { type: 'database' as const } };
    store.dispatch(dfActions.addTableToStore(table));
    let finishOldRequest!: (value: any) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(resolve => { finishOldRequest = resolve; }))
        .mockResolvedValue({ data: { tables: [] } });
    render(<Provider store={store}><SourceTableShelf inputTables={[table]} highlightedTableIds={[]} workspaceFiles={[]} /></Provider>);
    act(() => store.dispatch(dfActions.setActiveWorkspace({ id: 'new-workspace', displayName: 'New workspace' })));
    await act(async () => finishOldRequest({ data: { tables: [{ name: table.id, columns: [], sample_rows: [], row_count: 0,
        source_metadata: { import_options: { data_operation: { source_id: reference.connectorId, table_key: reference.tableKey } } },
    }] } }));
    expect(dfSelectors.getAllTables(store.getState())[0].source?.importedFrom).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Imports from Events' })).not.toBeInTheDocument();
});

it('appends new workspace items after existing ones and preserves order on reload', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference(reference));
    const table = { kind: 'table' as const, id: 'loaded-events', displayId: 'Loaded events', names: [],
        metadata: {}, rows: [], description: '', virtual: { tableId: 'loaded-events', rowCount: 0 } };
    const shelf = (tables: typeof table[]) => <Provider store={store}><SourceTableShelf inputTables={tables}
        highlightedTableIds={[]} workspaceFiles={[]} /></Provider>;
    const view = render(shelf([]));
    act(() => { store.dispatch(dfActions.addTableToStore(table)); });
    view.rerender(shelf([table]));
    expect(screen.getByRole('button', { name: 'Events' }).compareDocumentPosition(
        screen.getByRole('button', { name: 'Loaded events' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => { store.dispatch(dfActions.upsertExternalTableReference({ ...reference, id: 'external:later',
        tableKey: 'later', displayName: 'Later source' })); });
    expect(screen.getByRole('button', { name: 'Loaded events' }).compareDocumentPosition(
        screen.getByRole('button', { name: 'Later source' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const order = store.getState().workspaceItemOrder;
    expect(order).toEqual([reference.id, 'shelf-card-loaded-events', 'external:later']);
    act(() => { store.dispatch(dfActions.upsertExternalTableReference({ ...reference, capturedAt: '2026-09-20T00:00:00Z' })); });
    expect(store.getState().workspaceItemOrder).toEqual(order);
    view.unmount();
    act(() => { store.dispatch(dfActions.loadState(store.getState())); });
    render(shelf([table]));
    expect(store.getState().workspaceItemOrder).toEqual(order);
    expect(screen.getByRole('button', { name: 'Events' }).compareDocumentPosition(
        screen.getByRole('button', { name: 'Loaded events' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('automatically displays and caches a small sample when the preview opens', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { columns: [{ name: 'timestamp' }], rows: [{ timestamp: '2026-09-18' }] } });
    const store = showArtifact();
    await screen.findByTitle('2026-09-18');
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Sample data' })).toBeVisible();
    expect(screen.getByText('Virtual')).toBeVisible();
    expect(screen.queryByText('Preview only. Full data remains in the connected source.')).not.toBeInTheDocument();
    expect(screen.getByText('Data stays in the connected source and is read when needed.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show in data sources' })).toHaveTextContent('db.events');
    expect(screen.getByText(/Corporate ADX/)).toBeVisible();
    expect(screen.getByText('Virtual').closest('.MuiChip-root')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Events' }).parentElement)
        .toContainElement(screen.getByText('Virtual'));
    expect(screen.getByText('Virtual').parentElement?.querySelector('svg')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Events' }).parentElement?.parentElement?.parentElement)
        .toContainElement(screen.getByRole('button', { name: 'Refresh metadata' }));
    expect(screen.queryByRole('button', { name: /analyze|create chart/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Columns' })).not.toBeInTheDocument();
    expect(screen.queryByText('Source details')).not.toBeInTheDocument();
    expect(screen.getByText('Telemetry events')).toBeVisible();
    expect(screen.getByText(/Corporate ADX/)).toBeVisible();
    const request = vi.mocked(apiRequest).mock.calls[0];
    expect(request[0]).toBe(CONNECTOR_ACTION_URLS.PREVIEW_DATA);
    expect(JSON.parse(String(request[1]?.body))).toEqual({ connector_id: 'adx', source_table: reference.sourceTable, limit: 50, import_options: { size: 50 } });
    expect(store.getState().inputTables).toEqual([]);
    expect(store.getState().derivedTables).toEqual([]);
    expect(store.getState().externalTableReferences[0].summary.sampleRows).toEqual([{ timestamp: '2026-09-18' }]);
    expect(store.getState().externalTableReferences[0].summary.columns).toEqual(reference.summary.columns);
    expect(screen.queryByRole('button', { name: 'Fetch sample' })).not.toBeInTheDocument();
});

it('preserves full metadata when only selected columns are sampled and shows limitations', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {
        columns: [{ name: 'review', type: 'string' }], rows: [{ review: 'shortened...' }],
        inspection: { sample_method: 'source_head', schema_source: 'inferred', columns_omitted: 1, values_truncated: true },
    } });
    const store = showArtifact();
    await screen.findByText('shortened...');
    const summary = store.getState().externalTableReferences[0].summary;
    expect(summary.columns.map(column => column.name)).toEqual(['timestamp', 'review']);
    expect(summary.sampleColumns).toEqual(['review']);
    expect(summary.sampleTruncated).toBe(true);
    expect(screen.getByText(/1 columns omitted from preview/)).toHaveTextContent('Long or nested values shortened.');
    expect(screen.getByText(/Inferred schema; later records may differ/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Preview details' })).not.toBeInTheDocument();
    expect(screen.queryByText(/not a random sample/)).not.toBeInTheDocument();
    expect(screen.queryByText('timestamp', { exact: true })).not.toBeInTheDocument();
});

it('limits initial loading to the table body with metadata visible and retains cached rows during refresh', async () => {
    let finishPreview!: (response: any) => void;
    vi.mocked(apiRequest).mockImplementation(() => new Promise(resolve => { finishPreview = resolve; }));
    showArtifact();
    const loading = screen.getByRole('status');
    expect(loading).toHaveTextContent('Loading table preview: Events...');
    const preview = screen.getByRole('region', { name: 'Sample data' });
    expect(loading.parentElement).toBe(preview);
    expect(preview).toHaveStyle({ height: '320px', maxHeight: 'calc(100dvh - 280px)', borderRadius: '8px' });
    expect(loading).toHaveStyle({ height: '100%', alignItems: 'center', justifyContent: 'center' });
    expect(screen.getByRole('heading', { name: 'Events' })).toBeVisible();
    expect(screen.getByText('Virtual')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show in data sources' })).toHaveTextContent('db.events');
    expect(screen.getByText(/Corporate ADX/)).toBeVisible();
    expect(screen.getByText('Telemetry events')).toBeVisible();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    const progress = screen.getByRole('progressbar', { name: 'Loading table preview: Events...' });
    expect(progress).toHaveClass('MuiLinearProgress-root');
    expect(progress).toHaveStyle({ width: '160px', maxWidth: '100%', height: '3px' });
    expect(progress).not.toHaveAttribute('aria-valuenow');
    expect(loading.querySelector('.MuiCircularProgress-root')).toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: 'Refresh metadata' });
    expect(refresh).toBeVisible();
    expect(refresh).toBeEnabled();
    expect(refresh.querySelector('.MuiCircularProgress-root')).toBeNull();
    expect(refresh.querySelector('svg')).toBeInTheDocument();
    await act(async () => { finishPreview({ data: { columns: reference.summary.columns, rows: [{ timestamp: 'cached date' }] } }); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('cached date')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metadata' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading table preview: Events...');
    expect(screen.getByText('cached date')).toBeVisible();
    await act(async () => { finishPreview({ data: { columns: reference.summary.columns, rows: [{ timestamp: 'new date' }] } }); });
    expect(screen.getByRole('button', { name: 'Refresh metadata' })).toBeEnabled();
    expect(screen.getByText('new date')).toBeVisible();
});

it('keeps the loading status unchanged, times out, and ignores the old response after a successful retry', async () => {
    vi.useFakeTimers();
    const responses: ((response: any) => void)[] = [];
    vi.mocked(apiRequest).mockImplementation(() => new Promise(resolve => responses.push(resolve)));
    const store = showArtifact();
    const firstSignal = vi.mocked(apiRequest).mock.calls[0][1]?.signal;
    expect(screen.getByRole('status')).toHaveTextContent('Loading table preview: Events...');
    expect(screen.queryByText(/\d+s elapsed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel waiting' })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('status')).toHaveTextContent('Loading table preview: Events...');
    expect(screen.queryByText(/\d+s elapsed/)).not.toBeInTheDocument();
    expect(firstSignal?.aborted).toBe(false);
    act(() => vi.advanceTimersByTime(105_000));
    expect(firstSignal?.aborted).toBe(true);
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent('No preview received within 2 minutes.');
    expect(warning).not.toHaveClass('MuiAlert-root');
    expect(warning).toHaveStyle({ flexWrap: 'wrap', alignItems: 'baseline', padding: '4px' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveStyle({ padding: '0px 4px', minWidth: '0' });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Preview not loaded.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading table preview: Events...');
    expect(vi.mocked(apiRequest).mock.calls[1][1]?.signal?.aborted).toBe(false);
    await act(async () => { responses[1]({ data: { columns: reference.summary.columns, rows: [{ timestamp: 'retry result' }] } }); });
    await act(async () => { responses[0]({ data: { columns: reference.summary.columns, rows: [{ timestamp: 'stale result' }] } }); });
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('retry result')).toBeVisible();
    expect(store.getState().externalTableReferences[0].summary.sampleRows).toEqual([{ timestamp: 'retry result' }]);
});

it('restarts a pending preview on refresh and ignores the superseded response', async () => {
    vi.useFakeTimers();
    const responses: ((response: any) => void)[] = [];
    vi.mocked(apiRequest).mockImplementation(() => new Promise(resolve => responses.push(resolve)));
    const store = showArtifact();
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('status')).toHaveTextContent('Loading table preview: Events...');
    const firstSignal = vi.mocked(apiRequest).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metadata' }));
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(firstSignal?.aborted).toBe(true);
    const secondRequest = vi.mocked(apiRequest).mock.calls[1];
    expect(secondRequest[0]).toBe(CONNECTOR_ACTION_URLS.PREVIEW_DATA);
    expect(secondRequest[1]?.signal?.aborted).toBe(false);
    expect(JSON.parse(String(secondRequest[1]?.body)).source_table).toEqual(reference.sourceTable);
    expect(screen.getByRole('status')).toHaveTextContent('Loading table preview: Events...');
    await act(async () => { responses[0]({ data: { columns: [], rows: [{ timestamp: 'stale result' }] } }); });
    expect(store.getState().externalTableReferences[0].summary.sampleRows).toBeUndefined();
    expect(screen.getByRole('status')).toBeVisible();
    await act(async () => { responses[1]({ data: { columns: reference.summary.columns, rows: [{ timestamp: 'fresh result' }] } }); });
    expect(screen.getByText('fresh result')).toBeVisible();
    expect(screen.queryByText('stale result')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('retains cached rows when refresh times out', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { columns: reference.summary.columns, rows: [{ timestamp: 'cached date' }] } });
    const store = showArtifact();
    await screen.findByText('cached date');
    vi.useFakeTimers();
    let finishRefresh!: (response: any) => void;
    vi.mocked(apiRequest).mockImplementation(() => new Promise(resolve => { finishRefresh = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metadata' }));
    const signal = vi.mocked(apiRequest).mock.calls[1][1]?.signal;
    act(() => vi.advanceTimersByTime(120_000));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByText('cached date')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh metadata' })).toBeEnabled();
    await act(async () => { finishRefresh({ data: { columns: [], rows: [] } }); });
    expect(store.getState().externalTableReferences[0].summary.sampleRows).toEqual([{ timestamp: 'cached date' }]);
});

it('hides unknown column counts while preserving available source metadata', async () => {
    let finishPreview!: (response: any) => void;
    vi.mocked(apiRequest).mockImplementation(() => new Promise(resolve => { finishPreview = resolve; }));
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference, summary: { columns: [], sizeBytes: 880_000_000 } }));
    render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    expect(screen.queryByText(/0 columns/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show in data sources' })).toHaveTextContent('db.events');
    expect(screen.getByText(/Corporate ADX/)).toBeVisible();
    await act(async () => { finishPreview({ data: { columns: reference.summary.columns, rows: [] } }); });
    expect(screen.queryByText(/0 columns/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 columns shown/)).toBeVisible();
});

it('refreshes only the selected table schema and sample while preserving source metadata', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { columns: reference.summary.columns, rows: [{ timestamp: 'cached date' }] } });
    const store = showArtifact();
    await screen.findByText('cached date');
    vi.mocked(apiRequest).mockResolvedValue({ data: {
        columns: [{ name: 'count', type: 'number' }], rows: [{ count: 3 }], total_row_count: 1,
        source_location: { address: 'https://help.kusto.windows.net', database: 'Samples' },
    } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metadata' }));
    await screen.findByText('3');
    expect(store.getState().externalTableReferences[0].summary).toMatchObject({
        rowCount: reference.summary.rowCount, description: reference.summary.description,
        columns: [{ name: 'count', type: 'number' }], sampleRows: [{ count: 3 }],
    });
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(screen.getByText('https://help.kusto.windows.net / Samples / db.events')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show in data sources' })).toHaveTextContent('https://help.kusto.windows.net / Samples / db.events');
    expect(store.getState().externalTableReferences[0].sourceLocation).toEqual({
        address: 'https://help.kusto.windows.net', database: 'Samples',
    });
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe(CONNECTOR_ACTION_URLS.PREVIEW_DATA);
});

it.each([
    [undefined, [{ value: 1 }], 'Total rows unknown'],
    [0, [{ value: 1 }], 'Total rows unknown'],
    [0, [], '0 total rows'],
    [250, [{ value: 1 }], '250 total rows'],
] as const)('separates preview size from source total %s', (rowCount, sampleRows, total) => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference, connectorName: undefined, summary: {
        columns: [{ name: 'value', type: 'integer' }], rowCount, sampleRows: [...sampleRows],
        inspection: { sample_method: 'source_head' },
    } }));
    render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    expect(screen.getByLabelText('Source metadata')).toHaveTextContent(total);
    expect(screen.getByText(`First ${sampleRows.length} rows · 1 columns shown`)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Preview details' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Inferred schema/)).not.toBeInTheDocument();
    expect(screen.queryByText('adx', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(new Date(reference.capturedAt).toLocaleString())).not.toBeInTheDocument();
});

it('opens the containing connection in the source sidebar without copying or opening the file', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const path = 'https://example.org/datasets/events.csv';
    store.dispatch(dfActions.setDataSourceSidebarOpen(false));
    store.dispatch(dfActions.setDataSourceSidebarTab('knowledge'));
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference,
        sourceTable: { id: path, name: 'events.csv' }, summary: { columns: [], sampleRows: [] } }));
    render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    const location = screen.getByRole('button', { name: 'Show in data sources' });
    expect(location).toHaveTextContent(path);
    fireEvent.click(location);
    expect(store.getState()).toMatchObject({
        dataSourceSidebarOpen: true, dataSourceSidebarTab: 'sources', focusedConnectorId: reference.connectorId,
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('shows persisted schema and sample without another network request', async () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference, summary: {
        ...reference.summary, sampleRows: [{ timestamp: 'cached date' }],
    } }));
    render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    expect(screen.getByText('cached date')).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
});

it('fills the canvas with a sample preview without search or loaded-table actions', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    const sourceName = 'az://example.blob.core.windows.net/fxdata/games_reviews.csv';
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference, displayName: sourceName,
        sourceTable: { id: sourceName, name: sourceName }, summary: { columns: [{ name: 'review', type: 'string' }],
            sampleRows: [{ review: 'First review' }, { review: 'Second review' }] } }));
    render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    expect(screen.getByRole('heading', { name: 'games_reviews.csv' })).toBeVisible();
    expect(screen.getByText(sourceName)).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sample data' }).closest('#vis-view-canvas')).toHaveStyle({ width: '100%', minWidth: '0' });
    expect(screen.getByText('Second review')).toBeVisible();
    expect(screen.getByText('First review')).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /quick chart|download|column menu|analyze/i })).not.toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
});

it.each(['success', 'failure', 'workspace changed'])('imports a confirmed full copy: %s', async outcome => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.setActiveWorkspace({ id: 'original', displayName: 'Original' }));
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference,
        queryIntent: { size: 1 }, summary: { ...reference.summary, sampleRows: [] } }));
    store.dispatch(dfActions.setFocused({ type: 'external-table', referenceId: reference.id }));
    store.dispatch(dfActions.appendWorkspaceItems([reference.id]));
    let finishImport!: (value: any) => void;
    let failImport!: (error: Error) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve, reject) => {
        finishImport = resolve;
        failImport = reject;
    }));
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { tables: [{ name: 'events_copy', columns: [{ name: 'timestamp', type: 'TIMESTAMP' }],
        row_count: 100, sample_rows: [{ timestamp: '2026-09-20' }] }] } });
    const { rerender } = render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Import into workspace' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('uses workspace storage');
    expect(screen.getByRole('dialog')).toHaveTextContent("won't reflect future source changes");
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import copy' }));
    await screen.findByText('Importing workspace copy...');
    expect(store.getState().externalTableReferences).toHaveLength(1);
    expect(store.getState().inputTables).toEqual([]);
    expect(JSON.parse(String(vi.mocked(apiRequest).mock.calls[0][1]?.body))).toEqual({
        connector_id: reference.connectorId, source_table: reference.sourceTable, table_name: 'Events', full_copy: true,
    });
    if (outcome !== 'failure') {
        rerender(<Provider store={store}><ExternalTableReferenceCanvas key="reopened" referenceId={reference.id} /></Provider>);
    }
    expect(screen.queryByRole('button', { name: 'Import into workspace' })).not.toBeInTheDocument();
    if (outcome === 'workspace changed') {
        act(() => { store.dispatch(dfActions.resetForNewWorkspace({ id: 'other', displayName: 'Other' })); });
    }
    await act(async () => {
        if (outcome === 'failure') failImport(new Error('Source is unavailable'));
        else finishImport({ data: { table_name: 'events_copy', row_count: 100 } });
    });
    await waitFor(() => expect(store.getState().pendingTableLoads).toEqual([]));
    if (outcome === 'success') {
        expect(store.getState().externalTableReferences).toEqual([]);
        expect(dfSelectors.getAllTables(store.getState())[0]).toMatchObject({ id: 'events_copy', displayId: 'Events', virtual: { rowCount: 100 }, source: { canRefresh: false } });
        expect(store.getState().workspaceItemOrder).toEqual(['shelf-card-events_copy']);
        expect(store.getState().focusedId).toEqual({ type: 'table', tableId: 'events_copy' });
    } else {
        expect(store.getState().inputTables).toEqual([]);
        if (outcome === 'failure') {
            expect(store.getState().externalTableReferences).toHaveLength(1);
            expect(await screen.findByRole('alert')).toHaveTextContent('Source is unavailable');
            expect(screen.getByRole('button', { name: 'Import into workspace' })).toBeVisible();
        }
    }
});

it('cancels before import and hides importing in a read-only workspace', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference, summary: { ...reference.summary, sampleRows: [] } }));
    render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Import into workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(apiRequest).not.toHaveBeenCalled();
    expect(store.getState().externalTableReferences).toHaveLength(1);
    act(() => { store.dispatch(dfActions.setActiveWorkspace({ id: 'shared', displayName: 'Shared', readOnly: true })); });
    expect(screen.queryByRole('button', { name: 'Import into workspace' })).not.toBeInTheDocument();
});

it('caches at most 50 sample rows without registering a workspace table', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {
        columns: [{ name: 'value', type: 'integer' }],
        rows: Array.from({ length: 70 }, (_, index) => ({ value: index })),
    } });
    const store = showArtifact();
    await waitFor(() => expect(store.getState().externalTableReferences[0].summary.sampleRows).toHaveLength(50));
    expect(store.getState().externalTableReferences[0].summary.sampleRows?.[49]).toEqual({ value: 49 });
    expect(store.getState().inputTables).toEqual([]);
    expect(store.getState().derivedTables).toEqual([]);
});

it('fills missing schema from the sample and bounds cached cell text', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {
        columns: [{ name: 'review', type: 'string' }], rows: [{ review: 'x'.repeat(2000) }],
    } });
    const store = showArtifact(false);
    store.dispatch(dfActions.upsertExternalTableReference({ ...reference, summary: { columns: [], sizeBytes: 880_000_000 } }));
    await waitFor(() => expect(store.getState().externalTableReferences[0].summary.sampleTruncated).toBe(true));
    expect(store.getState().externalTableReferences[0].summary.columns).toEqual([{ name: 'review', type: 'string' }]);
    expect(store.getState().externalTableReferences[0].summary.sizeBytes).toBe(880_000_000);
    expect(String(store.getState().externalTableReferences[0].summary.sampleRows?.[0].review)).toHaveLength(1003);
});

it('cancels the automatic sample request when the preview closes', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.upsertExternalTableReference(reference));
    const { unmount } = render(<Provider store={store}><ExternalTableReferenceCanvas referenceId={reference.id} /></Provider>);
    const signal = vi.mocked(apiRequest).mock.calls[0][1]?.signal;
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(store.getState().externalTableReferences[0].summary.sampleRows).toBeUndefined();
});

it('handles a removed reference without reading a file or querying the connector', async () => {
    showArtifact(false);
    await screen.findByText('Reference unavailable');
    expect(apiRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh metadata' })).toBeDisabled();
});

it('keeps cached metadata visible when the connector is unavailable', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('Source disconnected'));
    showArtifact();
    await screen.findByText('Telemetry events');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Source disconnected'));
    expect(screen.getByText('Telemetry events')).toBeTruthy();
    expect(apiRequest).toHaveBeenCalledTimes(1);
    vi.mocked(apiRequest).mockResolvedValue({ data: { columns: reference.summary.columns, rows: [{ timestamp: 'retry success' }] } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metadata' }));
    await screen.findByText('retry success');
    expect(apiRequest).toHaveBeenCalledTimes(2);
});