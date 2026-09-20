import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorTablePreview } from '../../../../src/components/ConnectorTablePreview';
import { apiRequest } from '../../../../src/app/apiClient';

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

    it('uses a centered track for empty previews and an inline status over retained rows', () => {
        const view = render(<ConnectorTablePreview {...baseProps} loading sampleRows={[]} />);
        expect(screen.getByText('Loading preview...').closest('[role="status"]')?.querySelector('.MuiLinearProgress-root')).not.toBeNull();
        expect(screen.getByRole('progressbar', { name: 'Loading preview...' })).toBeDefined();
        view.rerender(<ConnectorTablePreview {...baseProps} loading />);
        expect(screen.getByText('US')).toBeDefined();
        expect(screen.getByRole('status', { name: 'Refreshing preview...' }).querySelector('.MuiCircularProgress-root')).not.toBeNull();
        expect(screen.queryByRole('progressbar', { name: 'Loading preview...' })).toBeNull();
    });

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

    it.each([undefined, 50])('uses preview limit %s for rendering and refresh requests', async previewRowLimit => {
        const limit = previewRowLimit ?? 10;
        const rows = Array.from({ length: limit }, (_, index) => ({ value: `sample-${index + 1}` }));
        const onRefreshPreview = vi.fn();
        vi.mocked(apiRequest).mockReset();
        vi.mocked(apiRequest).mockResolvedValue({ data: {
            columns: [{ name: 'value', type: 'STRING' }], rows, total_row_count: limit,
        } } as any);
        render(<ConnectorTablePreview
            {...baseProps}
            columns={[{ name: 'value', type: 'STRING' }]}
            sampleRows={[...rows, { value: 'beyond-limit' }]}
            rowCount={null}
            previewRowLimit={previewRowLimit}
            onRefreshPreview={onRefreshPreview}
        />);

        expect(screen.getByText(`sample-${limit}`)).toBeDefined();
        expect(screen.queryByText('beyond-limit')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }));
        await waitFor(() => expect(onRefreshPreview).toHaveBeenCalledWith(
            rows, [{ name: 'value', type: 'STRING' }], null,
        ));
        expect(JSON.parse(String(vi.mocked(apiRequest).mock.calls[0][1]?.body)).import_options.size).toBe(limit);
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

    it('shows progress and disables the load action while loading', () => {
        render(<ConnectorTablePreview {...baseProps} loading />);

        const loadButton = screen.getByRole('button', { name: 'Loading...' });
        expect(loadButton.hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('progressbar')).toBeDefined();
    });
});
