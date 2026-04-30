import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DataSourceSidebar } from '../../../../src/views/DataSourceSidebar';
import { apiRequest } from '../../../../src/app/apiClient';

const { dispatch, mockState } = vi.hoisted(() => ({
    dispatch: vi.fn(),
    mockState: {
        dataSourceSidebarOpen: true,
        serverConfig: { DISABLE_DATA_CONNECTORS: false },
        activeWorkspace: null,
        identity: { type: 'browser', id: 'test-browser' },
        tables: [],
    },
}));

vi.mock('../../../../src/app/apiClient', () => ({
    apiRequest: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    initReactI18next: {
        type: '3rdParty',
        init: vi.fn(),
    },
    useTranslation: () => ({
        t: (key: string, params?: Record<string, any>) => params?.defaultValue || key,
    }),
}));

vi.mock('react-redux', () => ({
    useDispatch: () => dispatch,
    useSelector: (selector: (state: any) => unknown) => selector(mockState),
}));

vi.mock('../../../../src/app/dfSlice', () => ({
    dfActions: {
        addMessages: (payload: any) => ({ type: 'messages/add', payload }),
        setDataSourceSidebarOpen: (payload: any) => ({ type: 'sidebar/setOpen', payload }),
        setSessionLoading: (payload: any) => ({ type: 'session/setLoading', payload }),
        loadState: (payload: any) => ({ type: 'state/load', payload }),
        setActiveWorkspace: (payload: any) => ({ type: 'workspace/setActive', payload }),
    },
    fetchFieldSemanticType: vi.fn(),
}));

vi.mock('../../../../src/app/utils', () => ({
    CONNECTOR_URLS: {
        LIST: '/api/connectors',
        DELETE: (id: string) => `/api/connectors/${id}`,
    },
    CONNECTOR_ACTION_URLS: {
        GET_CACHED_CATALOG_TREE: '/api/connectors/get-cached-catalog-tree',
        SYNC_CATALOG_METADATA: '/api/connectors/sync-catalog-metadata',
        SEARCH_CATALOG: '/api/connectors/search-catalog',
        PREVIEW_DATA: '/api/connectors/preview-data',
        REFRESH_DATA: '/api/connectors/refresh-data',
        CATALOG_ANNOTATIONS: '/api/connectors/catalog-annotations',
        DISCONNECT: '/api/connectors/disconnect',
    },
    translateBackend: (message: string) => message,
    fetchWithIdentity: vi.fn(),
}));

vi.mock('../../../../src/app/tableThunks', () => ({
    loadTable: vi.fn(),
    buildDictTableFromWorkspace: vi.fn(),
}));

vi.mock('../../../../src/app/workspaceService', () => ({
    listWorkspaces: vi.fn(() => Promise.resolve([])),
    loadWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    onWorkspaceListChanged: vi.fn(() => () => {}),
}));

vi.mock('../../../../src/components/VirtualizedCatalogTree', () => ({
    VirtualizedCatalogTree: () => <div data-testid="catalog-tree" />,
}));

vi.mock('../../../../src/components/ConnectorTablePreview', () => ({
    ConnectorTablePreview: () => null,
}));

vi.mock('../../../../src/components/ResizeHandle', () => ({
    ResizeHandle: () => null,
}));

vi.mock('../../../../src/views/KnowledgePanel', () => ({
    KnowledgePanel: () => null,
}));

describe('DataSourceSidebar', () => {
    beforeEach(() => {
        dispatch.mockClear();
        vi.mocked(apiRequest).mockReset();
    });

    it('leaves loading state when catalog sync fails', async () => {
        vi.mocked(apiRequest).mockImplementation((url: string) => {
            if (url === '/api/connectors') {
                return Promise.resolve({
                    data: {
                        connectors: [{
                            id: 'warehouse',
                            display_name: 'Warehouse',
                            source_type: 'PostgreSQLDataLoader',
                            connected: true,
                            deletable: false,
                        }],
                    },
                });
            }
            if (url === '/api/connectors/get-cached-catalog-tree') {
                return Promise.resolve({ data: {} });
            }
            if (url === '/api/connectors/sync-catalog-metadata') {
                return Promise.reject({ apiError: { message: 'Data connector error' } });
            }
            return Promise.resolve({ data: {} });
        });

        render(<DataSourceSidebar />);

        fireEvent.click(await screen.findByText('Warehouse'));

        await waitFor(() => {
            expect(screen.getByText('Data connector error')).toBeInTheDocument();
        });
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'messages/add',
            payload: expect.objectContaining({
                component: 'data-source-sidebar',
                type: 'warning',
                value: 'Data connector error',
            }),
        }));
    });
});
