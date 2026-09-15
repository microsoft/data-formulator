import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { expect, it, vi } from 'vitest';
import { dataFormulatorReducer } from '../../../../src/app/dfSlice';
import { apiRequest } from '../../../../src/app/apiClient';
import { CONNECTOR_ACTION_URLS } from '../../../../src/app/utils';
import { ConnectedSourceOverview } from '../../../../src/components/ConnectedSourceOverview';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../../src/components/VirtualizedCatalogTree', () => ({
    VirtualizedCatalogTree: ({ nodes, onItemClick }: any) => <div>{nodes.map((node: any) =>
        <button key={node.name} onClick={() => onItemClick(node)}>{node.name}</button>)}</div>,
}));
vi.mock('../../../../src/components/ConnectorTablePreview', () => ({
    ConnectorTablePreview: ({ sampleRows, rowCount }: any) => <div>Preview: {sampleRows.length} / {rowCount}</div>,
}));

it('shows cached catalog metadata first and only requests a bounded preview after selection', async () => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockImplementation(async url => {
        if (url === CONNECTOR_ACTION_URLS.GET_CATALOG_TREE) return { data: { tree: [
            { name: 'Events', node_type: 'table', path: ['db', 'Events'], metadata: { row_count: 100 } },
        ] } } as any;
        return { data: { columns: [{ name: 'value', type: 'number' }], rows: [{ value: 1 }], total_row_count: 100 } } as any;
    });
    const store = configureStore({ reducer: dataFormulatorReducer });
    render(<Provider store={store}><ConnectedSourceOverview connectorId="source" /></Provider>);
    const table = await screen.findByRole('button', { name: 'Events' });
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(1);
    fireEvent.click(table);
    await screen.findByText('Preview: 1 / 100');
    const previewCall = vi.mocked(apiRequest).mock.calls.find(([url]) => url === CONNECTOR_ACTION_URLS.PREVIEW_DATA)!;
    expect(JSON.parse(String(previewCall[1]?.body))).toEqual({
        connector_id: 'source', source_table: { id: 'Events', name: 'Events' }, limit: 10,
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tables' }), { target: { value: 'absent' } });
    expect(screen.queryByRole('button', { name: 'Events' })).toBeNull();
});