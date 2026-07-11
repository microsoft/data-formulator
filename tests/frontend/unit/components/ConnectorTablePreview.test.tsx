import React from 'react';
import { render, screen } from '@testing-library/react';
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
        sampleRows: [{ order_id: 1, region: 'US', total: 42 }],
        rowCount: 1,
        loading: false,
        alreadyLoaded: false,
        onLoad: vi.fn(),
    };

    it('shows the source table description directly', () => {
        render(
            <ConnectorTablePreview
                {...baseProps}
                tableDescription="Orders from the warehouse"
            />,
        );

        expect(screen.getByText('Orders from the warehouse')).toBeDefined();
        expect(screen.queryByText('Source metadata')).toBeNull();
    });

    it('uses descriptions on table headers without restoring the old metadata panel', () => {
        const { container } = render(
            <ConnectorTablePreview
                {...baseProps}
            />,
        );

        const orderHeader = Array.from(container.querySelectorAll('th'))
            .find(header => header.textContent === 'order_id');
        expect(orderHeader).toBeDefined();
        expect(orderHeader?.getAttribute('title')).toBeNull();
        expect(screen.queryByText('(订单编号)')).toBeNull();
        expect(screen.queryByText('SUM(line_items.amount)')).toBeNull();
    });
});
