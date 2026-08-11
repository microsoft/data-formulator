import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildLoadQueryImportOptions,
    LoadPlanCard,
} from '../../../../src/components/LoadPlanCard';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('../../../../src/app/apiClient', () => ({
    apiRequest,
    ApiRequestError: class ApiRequestError extends Error {},
}));

vi.mock('../../../../src/app/errorCodes', () => ({
    getErrorMessage: (error: any) => error?.message || 'Request failed',
}));

vi.mock('../../../../src/app/utils', () => ({
    CONNECTOR_ACTION_URLS: {
        PREVIEW_DATA: '/preview',
        GET_STATUS: '/status',
        CONNECT: '/connect',
    },
}));

vi.mock('../../../../src/icons', () => ({
    getConnectorIcon: () => null,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, any>) => {
            if (key === 'dataLoading.loadPlan.loadSelected') return 'Load selected';
            if (key === 'dataLoading.rows') return 'rows';
            if (key === 'dataLoading.cols') return 'cols';
            return params?.defaultValue || key;
        },
    }),
}));

describe('LoadPlanCard', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        vi.stubGlobal('ResizeObserver', class {
            observe() {}
            disconnect() {}
        });
        apiRequest.mockResolvedValue({
            data: {
                columns: ['title'],
                rows: [{ title: 'Remote movie' }],
                total_row_count: 1,
            },
        });
    });

    it('presents connector and scratch candidates through one selection flow', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);

        render(
            <LoadPlanCard
                plan={{
                    response: 'Choose data to load.',
                    options: [{
                        label: 'Movies',
                        tables: [{
                            sourceId: 'warehouse',
                            tableKey: 'movies',
                            displayName: 'Warehouse movies',
                            sourceTable: 'movies',
                        }],
                    }],
                }}
                pendingLoads={[{
                    name: 'Python movies',
                    csvScratchPath: 'scratch/python_movies.csv',
                    confirmed: false,
                    preview: {
                        name: 'Python movies',
                        columns: ['title'],
                        sampleRows: [{ title: 'Arrival' }],
                        totalRows: 1,
                    },
                }]}
                onConfirm={onConfirm}
            />,
        );

        expect(screen.getByText('Warehouse movies')).toBeInTheDocument();
        expect(screen.getByText('Python movies')).toBeInTheDocument();
        expect(screen.getAllByRole('checkbox')).toHaveLength(1);
        await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce());

        fireEvent.click(screen.getByRole('button', { name: 'Load selected (2)' }));

        await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
        const [selected, options] = onConfirm.mock.calls[0];
        expect(selected.map((item: any) => item.kind)).toEqual(['connector', 'scratch']);
        expect(options).toEqual({ newWorkspace: false });
    });

    it('does not fetch a preview for a scratch-only plan', () => {
        render(
            <LoadPlanCard
                pendingLoads={[{
                    name: 'Generated table',
                    csvScratchPath: 'scratch/generated.csv',
                    confirmed: false,
                    preview: {
                        name: 'Generated table',
                        columns: ['value'],
                        sampleRows: [{ value: 1 }],
                        totalRows: 1,
                    },
                }]}
                onConfirm={vi.fn()}
            />,
        );

        expect(screen.getByText('Generated table')).toBeInTheDocument();
        expect(apiRequest).not.toHaveBeenCalled();
    });
});

describe('buildLoadQueryImportOptions', () => {
    const candidate = {
        sourceId: 'warehouse',
        tableKey: 'orders',
        displayName: 'Orders',
        sourceTable: 'orders',
        query: {
            filters: [{ column: 'region', op: 'EQ', value: 'US' }],
            columns: ['order_id', 'amount'],
            orderBy: [{ column: 'amount', direction: 'desc' as const }],
            limit: 500,
        },
    };

    it('converts the canonical load query to connector import options', () => {
        expect(buildLoadQueryImportOptions(candidate)).toEqual({
            size: 500,
            source_filters: [{ column: 'region', operator: 'EQ', value: 'US' }],
            columns: ['order_id', 'amount'],
            sort_columns: ['amount'],
            sort_order: 'desc',
        });
    });

    it('bounds previews without changing the requested load limit', () => {
        expect(buildLoadQueryImportOptions(candidate, 10).size).toBe(10);
        expect(buildLoadQueryImportOptions({
            ...candidate,
            query: { ...candidate.query, limit: 5 },
        }, 10).size).toBe(5);
    });
});
