import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dataFormulatorReducer } from '../../../../src/app/dfSlice';
import { apiRequest } from '../../../../src/app/apiClient';
import { CONNECTOR_ACTION_URLS, CONNECTOR_URLS } from '../../../../src/app/utils';
import { ConnectedSourceOverview } from '../../../../src/components/ConnectedSourceOverview';
import { DataLoadMenu, UnifiedDataUploadDialog } from '../../../../src/views/UnifiedDataUploadDialog';
import { LandingDataEntry } from '../../../../src/views/LandingDataEntry';
import * as workspaceService from '../../../../src/app/workspaceService';

let resizeObservers: Set<() => void>;
beforeEach(() => {
    resizeObservers = new Set();
    vi.stubGlobal('ResizeObserver', class {
        constructor(private callback: () => void) { resizeObservers.add(callback); }
        observe() {}
        disconnect() { resizeObservers.delete(this.callback); }
    });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../../src/components/VirtualizedCatalogTree', () => ({
    VirtualizedCatalogTree: ({ nodes, onItemClick }: any) => <div>{nodes.map((node: any) =>
        <button key={node.name} onClick={() => onItemClick(node)}>{node.name}</button>)}</div>,
}));
vi.mock('../../../../src/components/ConnectorTablePreview', () => ({
    ConnectorTablePreview: ({ sampleRows, rowCount, onLoad, loading, loadLabel }: any) => <div>Preview: {sampleRows.length} / {rowCount}
        <button disabled={loading} onClick={() => onLoad?.({})}>{loadLabel || 'Load Table'}</button></div>,
}));
vi.mock('../../../../src/views/WorkspaceFileCanvas', () => ({
    WorkspaceFileCanvas: ({ fileName, sourceFile }: { fileName: string; sourceFile?: File }) => <div>{sourceFile ? 'Source artifact viewer' : 'File viewer'}: {fileName}</div>,
}));

it.each(['notes.md', 'workbook.xlsx'])('loads %s as a file and opens the workspace viewer', async name => {
    const file = new File(['contents'], name);
    vi.spyOn(workspaceService, 'previewConnectorFile').mockResolvedValue(file);
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_ACTION_URLS.GET_CATALOG_TREE) return { data: { tree: [
            { name, node_type: 'table', path: ['documents', name], metadata: { artifact_kind: 'file', file_type: name.split('.').at(-1), file_size: 100 } },
        ] } } as any;
        if (url === CONNECTOR_ACTION_URLS.IMPORT_FILE) return { data: { name: `imported-${name}` } } as any;
        throw new Error(`Unexpected request: ${url}`);
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><ConnectedSourceOverview connectorId="folder" /></Provider>);
    fireEvent.click(await screen.findByRole('button', { name }));
    await screen.findByText(`Source artifact viewer: ${name}`);
    expect(workspaceService.previewConnectorFile).toHaveBeenCalledWith('folder', `documents/${name}`, expect.any(AbortSignal));
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(1);
    expect(screen.queryByRole('tab', { name: 'Columns' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load file' }));
    await screen.findByText(`File viewer: imported-${name}`);
    const request = vi.mocked(apiRequest).mock.calls.find(([url]) => url === CONNECTOR_ACTION_URLS.IMPORT_FILE)!;
    expect(JSON.parse(String(request[1]?.body))).toEqual({ connector_id: 'folder', source_path: `documents/${name}` });
    expect(store.getState().focusedId).toEqual({ type: 'file', fileName: `imported-${name}` });
    expect(store.getState().inputTables).toEqual([]);
});

it('adds a large table as a session reference without uploading files or importing rows', async () => {
    const onReferenceAdded = vi.fn();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_ACTION_URLS.GET_CATALOG_TREE) return { data: { tree: [
            { name: 'events', node_type: 'table', path: ['db', 'events'], metadata: { table_key: 'canonical-events', row_count: '19521849', original_size_bytes: 18 * 1024 ** 3 } },
        ] } } as any;
        if (url === CONNECTOR_ACTION_URLS.PREVIEW_DATA) return { data: { columns: [{ name: 'timestamp', type: 'datetime' }], rows: [], total_row_count: 19521849 } } as any;
        throw new Error(`Unexpected request: ${url}`);
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><ConnectedSourceOverview connectorId="adx" onReferenceAdded={onReferenceAdded} /></Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'events' }));
    await screen.findByText('Preview: 0 / 19521849');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add table reference' })); });
    expect(store.getState().externalTableReferences).toEqual([expect.objectContaining({
        kind: 'external-table-reference', connectorId: 'adx', tableKey: 'canonical-events',
        summary: expect.objectContaining({ rowCount: 19521849, columns: [{ name: 'timestamp', type: 'datetime' }] }),
    })]);
    expect(onReferenceAdded).toHaveBeenCalledOnce();
    expect(store.getState().inputTables).toEqual([]);
    expect(store.getState().focusedId).toEqual({ type: 'external-table', referenceId: 'external:adx:canonical-events' });
    expect(vi.mocked(apiRequest).mock.calls.every(([url]) => url === CONNECTOR_ACTION_URLS.GET_CATALOG_TREE || url === CONNECTOR_ACTION_URLS.PREVIEW_DATA)).toBe(true);
});

it.each([923098710, undefined])('requires explicit preview for a large or unknown-size Azure blob (%s)', async size => {
    const name = 'az://account.blob.core.windows.net/container/reviews.csv';
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_ACTION_URLS.GET_CATALOG_TREE) return { data: { tree: [
            { name, node_type: 'table', path: [name], metadata: { size_bytes: size } },
        ] } } as any;
        return { data: { columns: [{ name: 'value' }], rows: [{ value: 1 }], total_row_count: 1 } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><ConnectedSourceOverview connectorId="blob" /></Provider>);
    fireEvent.click(await screen.findByRole('button', { name }));
    expect(screen.getByText(/Preview reads the full file and may be slow/)).toBeTruthy();
    expect(screen.queryByText('0 columns')).toBeNull();
    expect(apiRequest).not.toHaveBeenCalledWith(CONNECTOR_ACTION_URLS.PREVIEW_DATA, expect.anything());
    fireEvent.click(screen.getByRole('tab', { name: 'Columns' }));
    expect(apiRequest).not.toHaveBeenCalledWith(CONNECTOR_ACTION_URLS.PREVIEW_DATA, expect.anything());
    fireEvent.click(screen.getByRole('tab', { name: 'Sample data' }));
    fireEvent.click(screen.getByRole('button', { name: 'View preview' }));
    await screen.findByText('Preview: 1 / 1');
    expect(apiRequest).toHaveBeenCalledWith(CONNECTOR_ACTION_URLS.PREVIEW_DATA, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Back to tables' }));
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('button', { name: 'View preview' })).toBeTruthy();
});

it('requires explicit preview before downloading a large file attachment', async () => {
    const previewFile = vi.spyOn(workspaceService, 'previewConnectorFile').mockResolvedValue(new File(['contents'], 'large.xlsx'));
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { tree: [
        { name: 'large.xlsx', node_type: 'table', path: ['large.xlsx'], metadata: { artifact_kind: 'file', file_size: 50 * 1024 * 1024 } },
    ] } } as any);
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><ConnectedSourceOverview connectorId="files" /></Provider>);
    fireEvent.click(await screen.findByRole('button', { name: 'large.xlsx' }));
    expect(screen.getByText(/Preview downloads the file and may be slow/)).toBeTruthy();
    expect(previewFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'View preview' }));
    await screen.findByText('Source artifact viewer: large.xlsx');
    expect(previewFile).toHaveBeenCalledTimes(1);
});

it('keeps small Azure blob previews automatic', async () => {
    const name = 'az://account.blob.core.windows.net/container/small.parquet';
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_ACTION_URLS.GET_CATALOG_TREE) return { data: { tree: [
            { name, node_type: 'table', path: [name], metadata: { size_bytes: 5769397 } },
        ] } } as any;
        return { data: { columns: [], rows: [], total_row_count: 0 } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><ConnectedSourceOverview connectorId="blob" /></Provider>);
    fireEvent.click(await screen.findByRole('button', { name }));
    await screen.findByText('Preview: 0 / 0');
    expect(screen.queryByRole('button', { name: 'View preview' })).toBeNull();
});

it('offers direct upload and browsing with an agent tip instead of a chat composer', () => {
    const onSelectTab = vi.fn();
    render(<DataLoadMenu onSelectTab={onSelectTab} />);
    fireEvent.click(screen.getByRole('button', { name: 'Upload files' }));
    expect(onSelectTab).toHaveBeenLastCalledWith('upload');
    fireEvent.click(screen.getByRole('button', { name: 'Browse data sources' }));
    expect(onSelectTab).toHaveBeenLastCalledWith('database');
    expect(screen.getByText('You can also ask the agent to find and load data.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
});

it('keeps the landing chat, quick actions, and source links separate from the load menu', () => {
    const onStartChat = vi.fn();
    const onUpload = vi.fn();
    const onConnect = vi.fn();
    const onSelectConnector = vi.fn();
    const connector = { id: 'examples', display_name: 'Example Datasets', connected: true } as any;
    render(<LandingDataEntry onStartChat={onStartChat} ensureActiveWorkspace={vi.fn()}
        onUpload={onUpload} onConnect={onConnect} onSelectConnector={onSelectConnector} connectors={[connector]} />);
    expect(screen.queryByRole('button', { name: 'Browse data sources' })).toBeNull();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Compare weekly sales' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onStartChat).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onStartChat).toHaveBeenLastCalledWith('Compare weekly sales', [], []);
    expect(input).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Guide me to connect a data source' }));
    expect(onStartChat).toHaveBeenLastCalledWith('Guide me to connect a data source', [], []);
    fireEvent.click(screen.getByRole('button', { name: 'Example Datasets' }));
    expect(onSelectConnector).toHaveBeenCalledWith(connector);
    fireEvent.click(screen.getByRole('button', { name: 'Upload Data' }));
    expect(onUpload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Connect databases' }));
    expect(onConnect).toHaveBeenCalledOnce();
});

it('uploads landing attachments into a session and submits the server filename', async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ data: { path: 'scratch/sales-123.csv' } } as any);
    const ensureActiveWorkspace = vi.fn();
    const onStartChat = vi.fn();
    const { container } = render(<LandingDataEntry onStartChat={onStartChat} ensureActiveWorkspace={ensureActiveWorkspace}
        onUpload={vi.fn()} onConnect={vi.fn()} onSelectConnector={vi.fn()} connectors={[]} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['sales\n12'], 'sales.csv', { type: 'text/csv' })] } });
    expect(ensureActiveWorkspace).toHaveBeenCalledOnce();
    await screen.findByText('sales-123.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Start chatting with the agent' }));
    expect(onStartChat).toHaveBeenCalledWith('', [], ['sales-123.csv']);
});

it('disables the landing composer and quick actions in read-only sessions', () => {
    render(<LandingDataEntry onStartChat={vi.fn()} ensureActiveWorkspace={vi.fn()} onUpload={vi.fn()}
        onConnect={vi.fn()} onSelectConnector={vi.fn()} connectors={[]} readOnly />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guide me to connect a data source' })).toHaveAttribute('aria-disabled', 'true');
});

it('browses a connector using the artifact preview inside the load dialog', async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_URLS.LIST) return { data: { connectors: [
            { id: 'source', display_name: 'Example source', icon: 'sample_datasets', connected: true, params_form: [] },
        ] } } as any;
        if (url === CONNECTOR_ACTION_URLS.GET_CATALOG_TREE) return { data: { tree: [
            { name: 'Events', node_type: 'table', path: ['Events'], metadata: { row_count: 100 } },
        ] } } as any;
        return { data: { columns: [{ name: 'value', type: 'number' }], rows: [{ value: 1 }], total_row_count: 100 } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    const onClose = vi.fn();
    render(<Provider store={store}><UnifiedDataUploadDialog open onClose={onClose} /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Browse data sources' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Data source' }), { target: { value: 'source' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Events' }));
    await screen.findByText('Preview: 1 / 100');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Columns' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(store.getState().focusedConnectorId).toBeFalsy();
});

it.each([false, true])('opens a connector directly in the appropriate view (connected=%s)', async connected => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_URLS.LIST) return { data: { connectors: [
            { id: 'source', display_name: 'Example source', icon: 'azure_blob', connected, deletable: true, params_form: [], auth_mode: 'credentials' },
        ] } } as any;
        return { data: { tree: [{ name: 'Events', node_type: 'table', path: ['Events'], metadata: {} }] } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><UnifiedDataUploadDialog open initialTab="connector:source" onClose={vi.fn()} /></Provider>);
    await screen.findByDisplayValue('Example source');
    expect(screen.getByRole('button', { name: 'Delete connector' })).toBeTruthy();
    if (connected) {
        await screen.findByRole('button', { name: 'Events' });
        expect(screen.queryByRole('button', { name: /^Connect$/ })).toBeNull();
    } else {
        expect(screen.getByRole('button', { name: /^Connect$/ })).toBeTruthy();
        expect(apiRequest).not.toHaveBeenCalledWith(CONNECTOR_ACTION_URLS.GET_CATALOG_TREE, expect.anything());
    }
});

it.each([false, true])('preserves catalog browsing and bounded previews with split view %s', async wide => {
    let browserWidth = wide ? 1000 : 600;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: browserWidth } as DOMRect));
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_ACTION_URLS.GET_CATALOG_TREE) return { data: { tree: [
            { name: 'Events', node_type: 'table', path: ['db', 'Events'], metadata: { row_count: 100 } },
            { name: 'EventsArchive', node_type: 'table', path: ['db', 'EventsArchive'], metadata: { row_count: 100 } },
            { name: 'Users', node_type: 'table', path: ['db', 'Users'], metadata: null },
        ] } } as any;
        return { data: { columns: [{ name: 'value', type: 'number' }], rows: [{ value: 1 }], total_row_count: 100 } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><ConnectedSourceOverview connectorId="source" /></Provider>);
    const table = await screen.findByRole('button', { name: 'Events' });
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(1);
    const scrollParent = table.parentElement!.parentElement!;
    scrollParent.scrollTop = 120;
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tables' }), { target: { value: 'Events' } });
    expect(scrollParent.scrollTop).toBe(0);
    scrollParent.scrollTop = 80;
    const catalog = screen.getByRole('navigation', { name: 'Tables' });
    fireEvent.click(table);
    await screen.findByText('Preview: 1 / 100');
    expect(scrollParent.scrollTop).toBe(80);
    if (wide) {
        expect(screen.getByRole('navigation', { name: 'Tables' })).toBe(catalog);
        expect(screen.queryByRole('button', { name: 'Back to tables' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Previous table' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Next table' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'EventsArchive' }));
        await screen.findByRole('heading', { name: 'EventsArchive' });
        fireEvent.click(screen.getByRole('button', { name: 'Events' }));
        await screen.findByText('Preview: 1 / 100');
        browserWidth = 600;
        act(() => resizeObservers.forEach(callback => callback()));
        expect(screen.queryByRole('navigation', { name: 'Tables' })).toBeNull();
        expect(screen.getByRole('heading', { name: 'Events' })).toBeTruthy();
    } else {
        expect(screen.queryByRole('navigation', { name: 'Tables' })).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Previous table' })).toBeDisabled();
    const previewCall = vi.mocked(apiRequest).mock.calls.find(([url]) => url === CONNECTOR_ACTION_URLS.PREVIEW_DATA)!;
    expect(JSON.parse(String(previewCall[1]?.body))).toEqual({
        connector_id: 'source', source_table: { id: 'Events', name: 'Events' }, limit: 50,
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Columns' }));
    expect(screen.getByRole('tabpanel', { name: 'Columns' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'value' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByText('db / Events')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Sample data' }));
    expect(screen.getByRole('tabpanel', { name: 'Sample data' })).toBeTruthy();
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(wide ? 4 : 2);
    fireEvent.click(screen.getByRole('button', { name: 'Next table' }));
    await screen.findByText('Preview: 1 / 100');
    expect(screen.getByRole('heading', { name: 'EventsArchive' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next table' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous table' }));
    await screen.findByText('Preview: 1 / 100');
    expect(screen.getByRole('heading', { name: 'Events' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to tables' }));
    expect(screen.getByRole('navigation', { name: 'Tables' })).toBe(catalog);
    expect(screen.getByRole('textbox', { name: 'Search tables' })).toHaveValue('Events');
    expect(screen.queryByRole('region', { name: 'Table details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Users' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tables' }), { target: { value: 'absent' } });
    expect(screen.queryByRole('button', { name: 'Events' })).toBeNull();
});