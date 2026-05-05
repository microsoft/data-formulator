import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorTablePreview } from '../../../../src/components/ConnectorTablePreview';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, any>) => {
            const map: Record<string, string> = {
                'connectorPreview.sourceMetadata': 'Source metadata',
                'connectorPreview.noSourceMetadata': 'No source metadata',
                'connectorPreview.metadataStatus.synced': 'Synced',
                'connectorPreview.columnsCount': 'columns',
                'connectorPreview.colName': 'Column',
                'connectorPreview.colType': 'Type',
                'connectorPreview.colDesc': 'Description',
            };
            return map[key] ?? params?.defaultValue ?? key;
        },
    }),
}));

vi.mock('../../../../src/app/apiClient', () => ({
    apiRequest: vi.fn(),
}));

vi.mock('../../../../src/app/utils', () => ({
    fetchWithIdentity: vi.fn(),
    CONNECTOR_ACTION_URLS: {
        COLUMN_VALUES: '/api/connectors/column-values',
        PREVIEW_DATA: '/api/connectors/preview-data',
    },
}));

describe('ConnectorTablePreview source metadata', () => {
    const baseProps = {
        connectorId: 'warehouse',
        sourceTable: { id: 'orders', name: 'orders' },
        displayName: 'orders',
        columns: [
            { name: 'order_id', type: 'NUMERIC', description: 'Primary order key', verbose_name: '订单编号' },
            { name: 'region', type: 'STRING' },
            { name: 'total', type: 'NUMERIC', description: 'Sum of line items', expression: 'SUM(line_items.amount)' },
        ],
        sampleRows: [],
        rowCount: 1,
        loading: false,
        alreadyLoaded: false,
        onLoad: vi.fn(),
    };

    it('shows collapsed metadata header with status and column count', () => {
        render(
            <ConnectorTablePreview
                {...baseProps}
                tableDescription="Orders from the warehouse"
                metadataStatus="synced"
            />,
        );

        expect(screen.getByText('Source metadata')).toBeDefined();
        expect(screen.getByText('Synced')).toBeDefined();
        expect(screen.getByText(/3\s+columns/)).toBeDefined();
    });

    it('expands to show verbose_name and expression in column table', () => {
        render(
            <ConnectorTablePreview
                {...baseProps}
                metadataStatus="synced"
            />,
        );

        fireEvent.click(screen.getByText('Source metadata'));

        expect(screen.getByText('order_id')).toBeDefined();
        expect(screen.getByText('(订单编号)')).toBeDefined();
        expect(screen.getByText('Primary order key')).toBeDefined();

        expect(screen.getByText('total')).toBeDefined();
        expect(screen.getByText('SUM(line_items.amount)')).toBeDefined();
    });
});
