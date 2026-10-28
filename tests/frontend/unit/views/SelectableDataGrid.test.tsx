import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, expect, it, vi } from 'vitest';
import { dataFormulatorReducer } from '../../../../src/app/dfSlice';
import { apiRequest } from '../../../../src/app/apiClient';
import { SelectableDataGrid } from '../../../../src/views/SelectableDataGrid';
import { Type } from '../../../../src/data/types';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn(), fetchWithIdentity: vi.fn() }));
vi.mock('react-virtuoso', () => ({
    TableVirtuoso: ({ data, fixedHeaderContent, itemContent }: any) => <table><thead>{fixedHeaderContent()}</thead>
        <tbody>{data.map((row: any, index: number) => <tr key={index}>{itemContent(index, row)}</tr>)}</tbody></table>,
}));

afterEach(() => { cleanup(); vi.mocked(apiRequest).mockReset(); });

const columnDefs = [
    { id: '#rowId', label: '#', minWidth: 56, format: (value: any) => value, dataType: Type.Number, source: 'original' as const },
    { id: 'country', label: 'country', minWidth: 80, format: (value: any) => value, dataType: Type.String, source: 'original' as const },
];

const renderGrid = (props: Partial<React.ComponentProps<typeof SelectableDataGrid>>) =>
    render(<Provider store={configureStore({ reducer: dataFormulatorReducer })}>
        <SelectableDataGrid tableId="sdg11_sources" tableName="sdg11_sources" rows={[]} columnDefs={columnDefs}
            rowCount={1056} virtual previewOnly {...props} />
    </Provider>);

it('fetches the first page of a virtual table that opens with no rows in memory', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { rows: [{ '#rowId': 1, country: 'AFG' }, { '#rowId': 2, country: 'ALB' }], total_row_count: 1056 } } as any);
    renderGrid({});
    expect(await screen.findByText('ALB')).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(apiRequest).mock.calls[0];
    expect(url).toBe('/api/tables/sample-table');
    expect(JSON.parse(String(options?.body))).toMatchObject({ table: 'sdg11_sources', offset: 0, method: 'head' });
});

it('shows rows already in memory without fetching', async () => {
    renderGrid({ rows: [{ '#rowId': 1, country: 'AFG' }] });
    expect(screen.getByText('AFG')).toBeInTheDocument();
    await waitFor(() => expect(apiRequest).not.toHaveBeenCalled());
});
