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
    ConnectorTablePreview: ({ sampleRows, rowCount }: any) => <div>Preview: {sampleRows.length} / {rowCount}</div>,
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tables' }), { target: { value: 'Events' } });
    const catalog = screen.getByRole('navigation', { name: 'Tables' });
    fireEvent.click(table);
    await screen.findByText('Preview: 1 / 100');
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