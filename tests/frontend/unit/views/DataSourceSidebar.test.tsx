import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../../../../src/app/utils', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../src/app/utils')>()),
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
    VirtualizedCatalogTree: ({ nodes, onItemClick, selectedIds }: any) => <div data-testid="catalog-tree">
        {nodes.filter((node: any) => node.node_type === 'table').map((node: any) => <button key={node.path.join('/')}
            aria-pressed={selectedIds?.has(node.path.join('/')) ?? false}
            onClick={event => onItemClick(node, event)}>{node.name}</button>)}
    </div>,
}));

vi.mock('../../../../src/components/ConnectorTablePreview', () => ({
    ConnectorTablePreview: () => null,
}));

vi.mock('../../../../src/components/ResizeHandle', () => ({
    ResizeHandle: () => null,
}));

vi.mock('../../../../src/views/WorkflowPanel', () => ({
    WorkflowPanel: () => null,
}));

describe('DataSourceSidebar', () => {
    beforeEach(() => {
        dispatch.mockClear();
        mockState.dataSourceSidebarTab = 'sources';
        mockState.serverConfig.DISABLE_DATA_CONNECTORS = false;
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

    it('shows only the button tooltip when hovering the workflow icon', async () => {
        vi.useFakeTimers();
        try {
            render(<DataSourceSidebar />);
            const button = screen.getByRole('button', { name: 'knowledge.workflows' });
            fireEvent.mouseOver(button.querySelector('[data-workflow-gears]')!);
            await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
            expect(screen.getAllByRole('tooltip')).toHaveLength(1);
            expect(screen.getByRole('tooltip')).toHaveTextContent('knowledge.workflows');
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['AzureBlobDataLoader', 'PostgreSQLDataLoader'])('selects %s rows and only previews database tables', async sourceType => {
        vi.mocked(apiRequest).mockImplementation(async (url: string) => {
            if (url === '/api/connectors') return { data: { connectors: [{
                id: 'test-source', display_name: 'Test source', source_type: sourceType, connected: true,
            }] } };
            if (url === '/api/connectors/get-catalog-tree') return { data: { tree: [{
                name: 'games.parquet', node_type: 'table', path: ['games.parquet'], metadata: { size_bytes: 5769397 },
            }] } };
            return { data: {} };
        });
        render(<DataSourceSidebar />);
        const row = await screen.findByRole('button', { name: 'games.parquet' });
        fireEvent.click(row);
        expect(row).toHaveAttribute('aria-pressed', 'true');
        if (sourceType === 'AzureBlobDataLoader') {
            expect(apiRequest).not.toHaveBeenCalledWith('/api/connectors/preview-data', expect.anything());
        } else {
            await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/connectors/preview-data', expect.anything()));
        }
        fireEvent.click(row);
        expect(row).toHaveAttribute('aria-pressed', 'false');
    });

    it('does not automatically expand the only connected source when other connectors are available', async () => {
        vi.mocked(apiRequest).mockImplementation(async (url: string) => {
            if (url === '/api/connectors') return { data: { connectors: [
                { id: 'datasets', display_name: 'Datasets', source_type: 'SampleDatasetsLoader', connected: true },
                { id: 'warehouse', display_name: 'Warehouse', source_type: 'PostgreSQLDataLoader', connected: false },
            ] } } as any;
            return { data: { tree: [] } } as any;
        });
        render(<DataSourceSidebar />);
        await screen.findByText('Datasets');
        expect(apiRequest).not.toHaveBeenCalledWith('/api/connectors/get-catalog-tree', expect.anything());
        fireEvent.click(screen.getByText('Datasets'));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/connectors/get-catalog-tree', expect.anything()));
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
        expect(screen.getByRole('alert')).toHaveTextContent('Connected; catalog discovery incomplete.');
        const attempts = vi.mocked(apiRequest).mock.calls.filter(([url]) => url === '/api/connectors/get-catalog-tree').length;
        fireEvent.click(screen.getByRole('button', { name: 'Retry discovery' }));
        await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.filter(([url]) =>
            url === '/api/connectors/get-catalog-tree')).toHaveLength(attempts + 1));
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

        fireEvent.click(await screen.findByLabelText('Connect', { selector: 'button', exact: true }));

        expect(onOpenUploadDialog).toHaveBeenCalledWith('connector:mysql-main');
        expect(screen.queryByLabelText('Delete connector', { selector: 'button' })).toBeNull();
        onOpenUploadDialog.mockClear();
        fireEvent.click(screen.getByLabelText('Connector settings', { selector: 'button' }));
        expect(onOpenUploadDialog).toHaveBeenCalledWith('connector:mysql-main');
    });

    it('keeps configured sources connectable while hiding creation when restricted', async () => {
        mockState.serverConfig.DISABLE_DATA_CONNECTORS = true;
        const onOpenUploadDialog = vi.fn();
        vi.mocked(apiRequest).mockResolvedValue({ data: { connectors: [{
            id: 'admin-warehouse', display_name: 'Warehouse', source_type: 'PostgreSQLDataLoader',
            auth_mode: 'credentials', connected: false, deletable: false,
        }] } });
        render(<DataSourceSidebar onOpenUploadDialog={onOpenUploadDialog} />);
        await screen.findByText('Warehouse');
        expect(screen.queryByRole('button', { name: 'Add data connector' })).toBeNull();
        fireEvent.click(screen.getByLabelText('Connect', { selector: 'button', exact: true }));
        expect(onOpenUploadDialog).toHaveBeenCalledWith('connector:admin-warehouse');
        expect(screen.queryByLabelText('Delete connector', { selector: 'button' })).toBeNull();
    });

    it('disconnects connected user connectors without deleting their definition', async () => {
        const onOpenUploadDialog = vi.fn();
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

        render(<DataSourceSidebar onOpenUploadDialog={onOpenUploadDialog} />);

        fireEvent.click(await screen.findByLabelText('Connector settings', { selector: 'button' }));
        expect(onOpenUploadDialog).toHaveBeenCalledWith('connector:mysql-main');
        expect(apiRequest).not.toHaveBeenCalledWith('/api/connectors/disconnect', expect.anything());
        fireEvent.click(screen.getByLabelText('Disconnect', { selector: 'button' }));

        await waitFor(() => {
            expect(apiRequest).toHaveBeenCalledWith('/api/connectors/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: 'mysql-main' }),
            });
        });
        expect(await screen.findByLabelText('Connect', { selector: 'button', exact: true })).toBeEnabled();
        expect(screen.queryByLabelText('Delete connector', { selector: 'button' })).toBeNull();
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

        fireEvent.click(await screen.findByLabelText('Disconnect', { selector: 'button' }));
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/connectors/disconnect', expect.anything()));

        const connectButton = await screen.findByLabelText('Connect', { selector: 'button', exact: true });
        expect(connectButton).toHaveAttribute('aria-label', 'Connect');
        fireEvent.click(connectButton!);

        await waitFor(() => {
            expect(apiRequest).toHaveBeenCalledWith('/api/connectors/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: 'sample_datasets' }),
            });
        });
        expect(await screen.findByLabelText('Disconnect', { selector: 'button' })).toBeEnabled();
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

        fireEvent.click(screen.getByRole('button', { name: 'Sort sessions' }));
        fireEvent.click(await screen.findByText('sidebar.sortRecentlyModifiedFirst'));

        expect(recentlyEdited.compareDocumentPosition(newerCreation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows sessions in one sorted list without source grouping controls', async () => {
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

        const mixed = await screen.findByText('Mixed sources');
        const local = screen.getByText('Local data');
        expect(mixed.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByText('Kusto / MyMysqlDB')).not.toBeInTheDocument();
        expect(screen.queryByText('~/datasets')).not.toBeInTheDocument();
        expect(screen.queryByText('No data')).not.toBeInTheDocument();
        expect(screen.queryByText('Other')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sort sessions' }));
        expect(screen.queryByText('No grouping')).not.toBeInTheDocument();
        expect(screen.queryByText('Data source')).not.toBeInTheDocument();
        expect(screen.getByText('sidebar.sortRecentlyModifiedFirst')).toBeInTheDocument();
    });
});
