import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataOperationCard } from '../../../../src/components/DataOperationCard';
import { parseDataOperation } from '../../../../src/dataOperations/models';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => ({
            'dataLoading.operation.title': 'Data loading options',
            'dataLoading.operation.status.awaitingSelection': 'Awaiting selection',
            'dataLoading.operation.status.partiallyLoaded': 'Partially loaded',
            'dataLoading.operation.failedSteps': '1 table could not be loaded',
        }[key] || key),
    }),
}));

describe('DataOperationCard', () => {
    it('renders immutable plan alternatives without execution controls', () => {
        const operation = parseDataOperation({
            schema_version: 1,
            id: 'operation-1',
            status: 'awaiting_selection',
            reason: 'Choose the appropriate scope',
            description: 'I found two order datasets that support different analysis scopes.',
            plans: [
                {
                    id: 'plan-1',
                    hash: 'a'.repeat(64),
                    label: 'Recent orders',
                    summary: 'Last 90 days',
                    steps: [{
                        kind: 'connector_query',
                        source_id: 'warehouse',
                        table_key: 'public.orders',
                        display_name: 'Orders',
                        source_table: 'public.orders',
                    }],
                },
                {
                    id: 'plan-2',
                    hash: 'b'.repeat(64),
                    label: 'Weekly summary',
                    summary: 'Lower data volume',
                    steps: [{
                        kind: 'connector_query',
                        source_id: 'warehouse',
                        table_key: 'analytics.weekly_orders',
                        display_name: 'Weekly orders',
                        source_table: 'analytics.weekly_orders',
                    }],
                },
            ],
        });

        render(<DataOperationCard operation={operation} />);

        expect(screen.getByText('Data loading options')).toBeInTheDocument();
        // The response is recorded by the turn that carries the card.
        expect(screen.queryByText('I found two order datasets that support different analysis scopes.')).not.toBeInTheDocument();
        expect(screen.getByText('Recent orders')).toBeInTheDocument();
        expect(screen.getByText('Weekly summary')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('shows partial status and failed step names', () => {
        const operation = parseDataOperation({
            schema_version: 1,
            id: 'operation-1',
            status: 'partially_loaded',
            reason: 'Load related tables',
            plans: [{
                id: 'plan-1',
                hash: 'a'.repeat(64),
                label: 'Orders and customers',
                summary: '',
                steps: [{ kind: 'connector_query', display_name: 'Orders' }],
            }],
            result_table_ids: ['orders'],
            failed_steps: [{
                step_index: 1,
                display_name: 'Customers',
                error: { code: 'connector_error', message: 'Customers could not be loaded.' },
            }],
        });

        render(<DataOperationCard operation={operation} />);

        expect(screen.getByText('1 table could not be loaded')).toBeInTheDocument();
        expect(screen.getByText('Customers')).toBeInTheDocument();
    });
});