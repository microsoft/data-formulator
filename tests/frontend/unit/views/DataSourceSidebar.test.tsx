import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DataSourceSidebar } from '../../../../src/views/DataSourceSidebar';
import { apiRequest } from '../../../../src/app/apiClient';
import { listWorkspaces } from '../../../../src/app/workspaceService';

const { dispatch, mockState } = vi.hoisted(() => ({
    dispatch: vi.fn(),
    mockState: {
        dataSourceSidebarOpen: true,
        dataSourceSidebarTab: 'sources',
        serverConfig: { DISABLE_DATA_CONNECTORS: false },
        activeWorkspace: null,
        identity: { type: 'browser', id: 'test-browser' },
        inputTables: [],
        derivedTables: [],
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
        resetState: () => ({ type: 'state/reset' }),
    },
    dfSelectors: {
        getAllTables: (state: any) => [...(state.inputTables ?? []), ...(state.derivedTables ?? [])],
    },
    fetchFieldSemanticType: vi.fn(),
}));

vi.mock('../../../../src/app/utils', () => ({
    CONNECTOR_URLS: {
        LIST: '/api/connectors',
        DELETE: (id: string) => `/api/connectors/${id}`,
    },
    CONNECTOR_ACTION_URLS: {
        CONNECT: '/api/connectors/connect',
        GET_CATALOG: '/api/connectors/get-catalog',
        GET_CATALOG_TREE: '/api/connectors/get-catalog-tree',
        GET_CACHED_CATALOG_TREE: '/api/connectors/get-cached-catalog-tree',
        SYNC_CATALOG_METADATA: '/api/connectors/sync-catalog-metadata',
        SEARCH_CATALOG: '/api/connectors/search-catalog',
        PREVIEW_DATA: '/api/connectors/preview-data',
        REFRESH_DATA: '/api/connectors/refresh-data',
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
        mockState.dataSourceSidebarTab = 'sources';
        vi.stubGlobal('ResizeObserver', class {
            observe() {}
            unobserve() {}
            disconnect() {}
        });
        vi.mocked(apiRequest).mockReset();
        vi.mocked(apiRequest).mockResolvedValue({ data: { connectors: [] } });
        vi.mocked(listWorkspaces).mockReset();
        vi.mocked(listWorkspaces).mockResolvedValue([]);
    });

    it('leaves loading state when catalog fetch fails', async () => {
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
            if (url === '/api/connectors/get-catalog-tree') {
                return Promise.reject({ apiError: { message: 'Data connector error' } });
            }
            return Promise.resolve({ data: {} });
        });

        render(<DataSourceSidebar />);

        fireEvent.click(await screen.findByText('Warehouse'));

        await waitFor(() => {
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

    it('opens the populated connector form from Connect when disconnected', async () => {
        const onOpenUploadDialog = vi.fn();
        vi.mocked(apiRequest).mockResolvedValue({
            data: {
                connectors: [{
                    id: 'mysql-main',
                    display_name: 'MySQL',
                    source_type: 'MySQLDataLoader',
                    auth_mode: 'password',
                    connected: false,
                    deletable: true,
                    pinned_params: { host: 'db.example.com', database: 'sales' },
                }],
            },
        });

        render(<DataSourceSidebar onOpenUploadDialog={onOpenUploadDialog} />);

        const connectButton = (await screen.findByTestId('LinkOutlinedIcon')).closest('button');
        expect(connectButton).toHaveAttribute('aria-label', 'Connect');
        fireEvent.click(connectButton!);

        expect(onOpenUploadDialog).toHaveBeenCalledWith('connector:mysql-main');
        expect(screen.queryByTestId('SettingsOutlinedIcon')).not.toBeInTheDocument();
        expect(screen.getByTestId('DeleteOutlineIcon').closest('button')).toHaveAttribute('aria-label', 'Delete connector');
    });

    it('disconnects connected user connectors without deleting their definition', async () => {
        vi.mocked(apiRequest).mockImplementation((url: string) => {
            if (url === '/api/connectors') {
                return Promise.resolve({
                    data: {
                        connectors: [{
                            id: 'mysql-main',
                            display_name: 'MySQL',
                            source_type: 'MySQLDataLoader',
                            auth_mode: 'password',
                            connected: true,
                            has_stored_credentials: true,
                            deletable: true,
                        }],
                    },
                });
            }
            return Promise.resolve({ data: {} });
        });

        render(<DataSourceSidebar />);

    const disconnectButton = (await screen.findByTestId('LinkOffOutlinedIcon')).closest('button');
    expect(disconnectButton).toHaveAttribute('aria-label', 'Disconnect');
    fireEvent.click(disconnectButton!);

        await waitFor(() => {
            expect(apiRequest).toHaveBeenCalledWith('/api/connectors/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: 'mysql-main' }),
            });
        });
        expect((await screen.findByTestId('LinkOutlinedIcon')).closest('button')).toHaveAttribute('aria-label', 'Connect');
        expect(screen.getByTestId('DeleteOutlineIcon').closest('button')).toHaveAttribute('aria-label', 'Delete connector');
    });

    it('disconnects and reconnects Example Datasets without a form', async () => {
        vi.mocked(apiRequest).mockImplementation((url: string) => {
            if (url === '/api/connectors') {
                return Promise.resolve({
                    data: {
                        connectors: [{
                            id: 'sample_datasets',
                            display_name: 'Example Datasets',
                            source_type: 'SampleDatasetsLoader',
                            auth_mode: 'none',
                            connected: true,
                            deletable: false,
                        }],
                    },
                });
            }
            return Promise.resolve({ data: {} });
        });

        render(<DataSourceSidebar />);

        fireEvent.click((await screen.findByTestId('LinkOffOutlinedIcon')).closest('button')!);
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/connectors/disconnect', expect.anything()));

        const connectButton = (await screen.findByTestId('LinkOutlinedIcon')).closest('button');
        expect(connectButton).toHaveAttribute('aria-label', 'Connect');
        fireEvent.click(connectButton!);

        await waitFor(() => {
            expect(apiRequest).toHaveBeenCalledWith('/api/connectors/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: 'sample_datasets' }),
            });
        });
        expect(await screen.findByTestId('LinkOffOutlinedIcon')).toBeInTheDocument();
    });

    it('returns to the landing state without creating an empty workspace', async () => {
        mockState.dataSourceSidebarTab = 'sessions';
        render(<DataSourceSidebar />);

        fireEvent.click(await screen.findByRole('button', { name: 'New session' }));

        expect(dispatch).toHaveBeenCalledWith({ type: 'state/reset' });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({
            type: 'state/load',
            payload: expect.objectContaining({
                activeWorkspace: expect.objectContaining({ displayName: 'Untitled Session' }),
            }),
        }));
    });

    it('shows newest-created sessions first and can switch to recently modified order', async () => {
        mockState.dataSourceSidebarTab = 'sessions';
        vi.mocked(listWorkspaces).mockResolvedValue([
            {
                id: 'newer-creation',
                display_name: 'Newer creation',
                created_at: '2026-08-15T10:00:00Z',
                saved_at: '2026-08-15T10:00:00Z',
            },
            {
                id: 'recently-edited',
                display_name: 'Recently edited',
                created_at: '2026-08-01T10:00:00Z',
                saved_at: '2026-08-15T11:00:00Z',
            },
        ]);

        render(<DataSourceSidebar />);

        const recentlyEdited = await screen.findByText('Recently edited');
        const newerCreation = screen.getByText('Newer creation');
        expect(newerCreation.compareDocumentPosition(recentlyEdited) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Group and sort sessions' }));
        fireEvent.click(await screen.findByText('sidebar.sortRecentlyModifiedFirst'));

        expect(recentlyEdited.compareDocumentPosition(newerCreation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('groups sessions by their summarized data sources by default', async () => {
        mockState.dataSourceSidebarTab = 'sessions';
        vi.mocked(apiRequest).mockResolvedValue({
            data: {
                connectors: [
                    { id: 'kusto-prod', display_name: 'Kusto' },
                    { id: 'mysql-main', display_name: 'MyMysqlDB' },
                    { id: 'local-datasets', display_name: '~/datasets' },
                ],
            },
        });
        vi.mocked(listWorkspaces).mockResolvedValue([
            {
                id: 'mixed',
                display_name: 'Mixed sources',
                created_at: '2026-08-15T10:00:00Z',
                saved_at: '2026-08-15T10:00:00Z',
                source_ids: ['kusto-prod', 'mysql-main'],
            },
            {
                id: 'local',
                display_name: 'Local data',
                created_at: '2026-08-14T10:00:00Z',
                saved_at: '2026-08-14T10:00:00Z',
                source_ids: ['local-datasets'],
            },
        ]);

        render(<DataSourceSidebar />);

        expect(await screen.findByText('Kusto / MyMysqlDB')).toBeInTheDocument();
        expect(screen.getByText('~/datasets')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Group and sort sessions' }));
        fireEvent.click(await screen.findByText('No grouping'));

        expect(screen.queryByText('Kusto / MyMysqlDB')).not.toBeInTheDocument();
        expect(screen.getByText('Mixed sources')).toBeInTheDocument();
        expect(screen.getByText('Local data')).toBeInTheDocument();
    });
});
