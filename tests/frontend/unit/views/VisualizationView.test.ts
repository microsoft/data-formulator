import React from 'react';
import { render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';

import { normalizeOperationPreview, VisualizationViewFC } from '../../../../src/views/VisualizationView';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';

vi.mock('../../../../src/components/ConnectorFormCard', () => ({
    ConnectorFormCard: () => React.createElement('div', null, 'Connector fields'),
}));

it('renders the connector form instead of treating its owner as a plain explanation', () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.addTextTurn({
        kind: 'text', id: 'form', displayId: 'form', textKind: 'explain',
        content: 'Please provide the details in the form.', createdAt: 1,
        form: { kind: 'connector', title: 'MySQL connection', connector: { sourceType: 'mysql' } },
    }));
    store.dispatch(dfActions.setFocused({ type: 'text', textId: 'form' }));
    render(React.createElement(Provider, { store, children: React.createElement(VisualizationViewFC) }));
    expect(screen.getByText('Connector fields')).toBeTruthy();
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