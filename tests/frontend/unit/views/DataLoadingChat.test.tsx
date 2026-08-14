import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataLoadingChat } from '../../../../src/views/DataLoadingChat';

const { dispatch, mockState } = vi.hoisted(() => ({
    dispatch: vi.fn(),
    mockState: {
        dataLoadingChatMessages: [{
            id: 'python-result',
            role: 'assistant',
            content: 'Here is the generated table.',
            codeBlocks: [{ code: 'df_movies = load_movies()' }],
            loadPlan: {
                response: 'Load the movie data.',
                options: [{
                    label: 'Movies',
                    tables: [{
                        sourceId: 'warehouse',
                        tableKey: 'movies',
                        displayName: 'Warehouse movies',
                        sourceTable: 'movies',
                    }],
                }],
            },
            pendingLoads: [{
                name: 'df_movies',
                csvScratchPath: 'scratch/df_movies.csv',
                confirmed: false,
                preview: {
                    name: 'df_movies',
                    columns: ['title'],
                    sampleRows: [{ title: 'Arrival' }],
                    totalRows: 1,
                },
            }],
            timestamp: 1,
        }],
        dataLoadingChatInProgress: false,
        dataLoadingChatResetCounter: 0,
        dataLoadingChatPending: null,
        inputTables: [],
        derivedTables: [],
        activeModel: null,
        config: { frontendRowLimit: 1000 },
        activeWorkspace: { id: 'workspace-1' },
    },
}));

vi.mock('react-redux', () => ({
    useDispatch: () => dispatch,
    useSelector: (selector: (state: any) => unknown) => selector(mockState),
}));

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: vi.fn(),
    },
    useTranslation: () => ({
        t: (_key: string, params?: Record<string, any>) => params?.defaultValue || _key,
    }),
}));

vi.mock('../../../../src/app/dfSlice', () => ({
    dfActions: {},
    dfSelectors: {
        getAllTables: (state: any) => [...state.inputTables, ...state.derivedTables],
        getActiveModel: (state: any) => state.activeModel,
    },
}));

vi.mock('../../../../src/components/LoadPlanCard', () => ({
    LoadPlanCard: ({ pendingLoads }: any) => (
        <div data-testid="load-plan-card">
            {(pendingLoads || []).map((pending: any) => pending.name).join(', ')}
        </div>
    ),
}));

vi.mock('../../../../src/components/ConnectorFormCard', () => ({
    ConnectorFormCard: () => null,
}));

vi.mock('../../../../src/views/AgentChatInput', () => ({
    AgentChatInput: () => <div data-testid="agent-chat-input" />,
}));

vi.mock('../../../../src/views/dataLoadingSuggestions', () => ({
    buildDataLoadingSuggestions: () => [],
    buildDataLoadingQuickActions: () => [],
}));

vi.mock('../../../../src/components/ScrollFade', () => ({
    useScrollFade: () => ({ containerRef: { current: null }, showTop: false, showBottom: false }),
    ScrollFadeEdge: () => null,
}));

vi.mock('../../../../src/app/tableThunks', () => ({
    loadTable: vi.fn(),
}));

describe('DataLoadingChat canvas', () => {
    beforeEach(() => {
        dispatch.mockClear();
        vi.stubGlobal('ResizeObserver', class {
            observe() {}
            disconnect() {}
        });
    });

    it('opens Python-produced tables in the unified right-side load plan', async () => {
        render(<DataLoadingChat />);

        await waitFor(() => {
            expect(screen.getByTestId('load-plan-card')).toBeInTheDocument();
        });
        expect(screen.getByTestId('load-plan-card')).toHaveTextContent('df_movies');
        expect(screen.getByRole('button', { name: /Table loading plan/ }))
            .toHaveTextContent('df_movies (source: Python, 1 row)');
        expect(screen.getByRole('button', { name: /Table loading plan/ }))
            .toHaveTextContent('Warehouse movies (source: warehouse)');
        expect(screen.queryByText(/row count unavailable/)).not.toBeInTheDocument();
        expect(screen.queryByText('1 tables proposed')).not.toBeInTheDocument();
        expect(screen.getAllByText('Table loading plan')).toHaveLength(2);
        expect(screen.getByText('Review')).toBeInTheDocument();
    });
});
