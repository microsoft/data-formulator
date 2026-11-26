import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { afterEach, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { FreeDataViewFC } from '../../../../src/views/DataView';
import { Type } from '../../../../src/data/types';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn(), fetchWithIdentity: vi.fn() }));
vi.mock('react-virtuoso', () => ({
    TableVirtuoso: ({ data, fixedHeaderContent, itemContent }: any) => <table><thead>{fixedHeaderContent()}</thead>
        <tbody>{data.map((row: any, index: number) => <tr key={index}>{itemContent(index, row)}</tr>)}</tbody></table>,
}));

afterEach(cleanup);

const workspaceTable = (rows: Record<string, unknown>[], contentHash: string) => {
    const names = Object.keys(rows[0]);
    return {
        kind: 'table', id: 'sdg4_table', displayId: 'SDG 4 Indicators', names, rows, contentHash,
        metadata: Object.fromEntries(names.map(name => [name, { type: Type.String, semanticType: '', levels: [] }])),
        virtual: { tableId: 'sdg4_table', rowCount: rows.length },
        source: { type: 'database', databaseTable: 'sdg4_table' }, anchored: false, attachedMetadata: '',
    } as any;
};

it('shows a workspace table\'s new rows when it is rewritten in place', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    act(() => { store.dispatch(dfActions.addTableToStore(workspaceTable([{ indicator: 'Completion rate' }], 'h1'))); });
    render(<Provider store={store}><DndProvider backend={HTML5Backend}><FreeDataViewFC tableId="sdg4_table" /></DndProvider></Provider>);
    expect(screen.getByText('Completion rate')).toBeInTheDocument();

    act(() => { store.dispatch(dfActions.addTableToStore(workspaceTable([{ country: 'Niger', literacy: '38' }], 'h2'))); });
    expect(screen.getByText('Niger')).toBeInTheDocument();
    expect(screen.queryByText('Completion rate')).toBeNull();
});
