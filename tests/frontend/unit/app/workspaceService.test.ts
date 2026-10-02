import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = {
    serverConfig: { WORKSPACE_BACKEND: 'ephemeral' },
    activeWorkspace: { id: 'workspace-1', displayName: 'Temporary session' },
    inputTables: [],
    derivedTables: [{
        id: 'derived-1',
        names: ['value'],
        rows: [{ value: 42 }],
        metadata: { value: { type: 'number' } },
    }],
};

vi.mock('../../../../src/app/store', () => ({
    store: { getState: vi.fn(() => mockState) },
}));

vi.mock('../../../../src/app/stateMigrations', () => ({
    migrateState: vi.fn((state) => state),
}));

import { ApiRequestError } from '../../../../src/app/apiClient';
import { workspaceDB } from '../../../../src/app/workspaceDB';
import { listWorkspaceFiles, listWorkspaces, loadWorkspace, saveWorkspaceState, WorkspaceLoadSupersededError, isLargeConnectorTable, loadsAsConnectorReference, createExternalTableReference } from '../../../../src/app/workspaceService';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { getInputTablePreview } from '../../../../src/app/inputTablePreviewCache';

beforeEach(() => {
    vi.restoreAllMocks();
    mockState.serverConfig.WORKSPACE_BACKEND = 'ephemeral';
    mockState.activeWorkspace = { id: 'workspace-1', displayName: 'Temporary session' };
});

describe('scheduled snapshots', () => {
    const snapshot = {
        activeWorkspace: { id: 'shared-test', displayName: 'Daily report', readOnly: true,
            scheduledRun: { scheduleId: 'test', scheduleName: 'Daily report', scheduledFor: '2026-09-30T09:00:00Z' } },
        textTurns: [{ id: 'scheduled-summary-run-1', kind: 'text', content: 'Completed', createdAt: 1 }],
        scheduledArtifacts: [
            { kind: 'data', tableId: 'prices', displayName: 'Weekly prices', rows: [{ category: 'A', value: 1 }] },
            { kind: 'chart', id: 'chart-test', tableId: 'summary_data', rows: [{ category: 'A', value: 3 }],
                question: 'How did values compare?', inputSources: [{ id: 'prices', kind: 'data', display_name: 'prices' }],
                goal: { title: 'Values', chart: { chart_type: 'Bar Chart', encodings: { x: { field: 'category' }, y: { field: 'value' } } } } },
            { kind: 'report', content: 'Final findings' },
        ],
    };

    it('rebuilds the live thread: data, the question-triggered chart, then the report', async () => {
        const { materializeScheduledSnapshot } = await import('../../../../src/views/WorkflowPanel');
        const materialized = materializeScheduledSnapshot(snapshot);
        const state = dataFormulatorReducer(undefined, dfActions.loadState(materialized));
        expect(state.loadedTableNodes).toEqual([expect.objectContaining({ id: 'workflow-data-run-1-prices', tableId: 'prices',
            parentNodeId: 'scheduled-summary-run-1' })]);
        const chartTable = state.derivedTables.find(table => table.id === 'summary_data')!;
        expect(chartTable.rows).toEqual([{ category: 'A', value: 3 }]);
        expect(chartTable.virtual).toBeUndefined();
        expect(chartTable.parentNodeId).toBe('workflow-data-run-1-prices');
        expect(chartTable.derive?.source).toEqual(['prices']);
        expect(chartTable.derive?.trigger.interaction?.[0].content).toBe('How did values compare?');
        expect(state.charts[0].id).toBe('chart-test');
        expect(state.conceptShelfItems).toHaveLength(2);
        expect(state.generatedReports[0]).toMatchObject({ id: 'workflow-report-run-1', content: 'Final findings', parentNodeId: 'summary_data' });
        expect(state.focusedId).toEqual({ type: 'report', reportId: 'workflow-report-run-1' });
        expect(state.activeWorkspace?.scheduledRun).toEqual(snapshot.activeWorkspace.scheduledRun);
        expect(snapshot).toHaveProperty('scheduledArtifacts');
        expect(materialized).not.toHaveProperty('scheduledArtifacts');
    });

    it('honors the server read-only flag without saving a browser recovery copy', async () => {
        mockState.serverConfig.WORKSPACE_BACKEND = 'local';
        const requestSpy = vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest')
            .mockResolvedValue({ data: { state: snapshot, read_only: true } });
        const result = await loadWorkspace('shared-test');
        expect(result?.readOnly).toBe(true);
        expect(result?.state.charts[0].id).toBe('chart-test');
        expect(requestSpy).toHaveBeenCalledOnce();
    });

    it('restores private scheduled workflow controls and focuses the failed checkpoint', async () => {
        mockState.serverConfig.WORKSPACE_BACKEND = 'local';
        vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest').mockResolvedValue({ data: {
            state: { ...snapshot, activeWorkspace: { ...snapshot.activeWorkspace, id: 'scheduled-run', readOnly: false },
                textTurns: [{ id: 'scheduled-summary-run', content: 'Execution failed.', createdAt: 1 }] },
            workflow_run: { id: 'run', status: 'paused', step_id: 'inspect', message: 'Execution failed.', started_at: '2026-09-30T09:00:00Z',
                instance: { name: 'Daily report', steps: [{ id: 'inspect', instructions: 'Inspect source' }] },
                evidence: { failed: { tool: 'inspect_data', text: 'Source unavailable', step_id: 'inspect' } } },
        } });
        const result = await loadWorkspace('scheduled-run');
        expect(result?.readOnly).toBe(false);
        expect(result?.state.textTurns).toHaveLength(1);
        expect(result?.state.textTurns[0].workflow).toMatchObject({ runId: 'run', status: 'paused',
            steps: [expect.objectContaining({ id: 'inspect' })], log: [expect.objectContaining({ text: 'Source unavailable' })] });
        expect(result?.state.focusedId).toEqual({ type: 'text', textId: 'textTurn-workflow-run' });
        expect(result?.state.loadedTableNodes[0].parentNodeId).toBe('textTurn-workflow-run');
        expect(result?.state.generatedReports[0].parentNodeId).toBe('summary_data');
    });
});

describe('external table reference artifacts', () => {
    it('uses configured thresholds with strict boundaries and preserves zero', () => {
        const config = { EXTERNAL_TABLE_MAX_ROWS: 100, EXTERNAL_TABLE_MAX_BYTES: 1024 };
        expect(isLargeConnectorTable({ row_count: 100, size_bytes: 1024 }, config)).toBe(false);
        expect(isLargeConnectorTable({ row_count: 101 }, config)).toBe(true);
        expect(isLargeConnectorTable({ file_size: 1025 }, config)).toBe(true);
        expect(isLargeConnectorTable({ row_count: 1 }, { EXTERNAL_TABLE_MAX_ROWS: 0 })).toBe(true);
        expect(isLargeConnectorTable({}, config)).toBe(false);
        expect(isLargeConnectorTable({ row_count: 1000001 }, { EXTERNAL_TABLE_MAX_ROWS: 2000000 })).toBe(false);
    });

    it.each([
        [null, false], [{}, false], [{ row_count: 1_000_000 }, false],
        [{ row_count: '1000001' }, true], [{ size_bytes: '19327352832' }, true],
        [{ file_size: 18 * 1024 ** 3 }, true], [{ original_size_bytes: 0, size_bytes: 18 * 1024 ** 3 }, true],
    ])('detects large source metadata %j', (metadata, expected) => {
        expect(isLargeConnectorTable(metadata)).toBe(expected);
    });

    it('adds semantic models as references regardless of size', () => {
        expect(loadsAsConnectorReference({ query_model: 'semantic' })).toBe(true);
        expect(loadsAsConnectorReference({ query_model: 'relational', row_count: 10 })).toBe(false);
        expect(loadsAsConnectorReference({ row_count: 2_000_000 })).toBe(true);
    });

    it('keeps references in session state without files or table imports', async () => {
        const requestSpy = vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest')
            .mockResolvedValue({ data: {} });
        const reference = createExternalTableReference({
            kind: 'external-table-reference',
            connectorId: 'adx', tableKey: 'events-key', sourceTable: { id: 'events', name: 'events' },
            displayName: 'Events', capturedAt: '2026-09-18T00:00:00Z',
            summary: { columns: [{ name: 'timestamp', type: 'datetime' }], rowCount: 19_521_849 },
        });
        let state = dataFormulatorReducer(undefined, dfActions.upsertExternalTableReference(reference));
        state = dataFormulatorReducer(state, dfActions.upsertExternalTableReference(reference));
        expect(state.externalTableReferences).toEqual([reference]);
        expect(dfSelectors.selectSessionEmpty(state)).toBe(false);
        expect(state.inputTables).toEqual([]);
        expect(state.fileNodes).toEqual([]);
        state = dataFormulatorReducer(state, dfActions.loadState(JSON.parse(JSON.stringify(state))));
        expect(state.externalTableReferences).toEqual([reference]);
        state = dataFormulatorReducer(state, dfActions.setFocused({ type: 'external-table', referenceId: reference.id }));
        state = dataFormulatorReducer(state, dfActions.removeExternalTableReference(reference.id));
        expect(state.externalTableReferences).toEqual([]);
        expect(state.focusedId).toBeUndefined();
        expect(dataFormulatorReducer(state, dfActions.resetState()).externalTableReferences).toEqual([]);
        expect(requestSpy).not.toHaveBeenCalled();
    });
});

describe('ephemeral workspace recovery', () => {
    it('stores a row-free browser snapshot after a successful server save', async () => {
        const requestSpy = vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest')
            .mockResolvedValue({ data: {} });
        const saveSpy = vi.spyOn(workspaceDB, 'save').mockResolvedValue();

        await saveWorkspaceState(mockState as any);

        expect(requestSpy).toHaveBeenCalledOnce();
        expect(saveSpy).toHaveBeenCalledOnce();
        const recoveryState = saveSpy.mock.calls[0][2] as any;
        expect(recoveryState.derivedTables[0].rows).toEqual([]);
    });

    it('loads an expired server workspace from its browser snapshot as read-only', async () => {
        vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest').mockRejectedValue(
            new ApiRequestError({
                code: 'WORKSPACE_EXPIRED',
                message: 'expired',
            }, 200),
        );
        vi.spyOn(workspaceDB, 'load').mockResolvedValue({
            id: 'workspace-1',
            displayName: 'Temporary session',
            createdAt: '2026-08-10T00:00:00Z',
            updatedAt: '2026-08-10T01:00:00Z',
            state: mockState as any,
            tableIndex: [],
        });

        const result = await loadWorkspace('workspace-1');

        expect(result?.readOnly).toBe(true);
        expect((result?.state.derivedTables as any[])[0].rows).toEqual([]);
    });
});

describe('local workspace parity', () => {
    it('lists durable workspace files without requesting scratch items', async () => {
        const files = [{ name: 'summary.md', origin: 'agent' }, { name: 'source.txt', origin: null }];
        const requestSpy = vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest')
            .mockResolvedValue({ data: { files } });

        expect(await listWorkspaceFiles()).toEqual(files);
        expect(requestSpy).toHaveBeenCalledExactlyOnceWith('/api/workspace/files');
    });

    it('returns only the server workspace list without consulting recovery storage', async () => {
        mockState.serverConfig.WORKSPACE_BACKEND = 'local';
        vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest').mockResolvedValue({
            data: { sessions: [{ id: 'local-1', display_name: 'Local', created_at: null, saved_at: null }] },
        });
        const recoveryListSpy = vi.spyOn(workspaceDB, 'list').mockResolvedValue([]);

        const result = await listWorkspaces();

        expect(result.map(workspace => workspace.id)).toEqual(['local-1']);
        expect(recoveryListSpy).not.toHaveBeenCalled();
    });

    it('propagates a missing-workspace error without consulting recovery storage', async () => {
        mockState.serverConfig.WORKSPACE_BACKEND = 'local';
        const error = new ApiRequestError({
            code: 'TABLE_NOT_FOUND',
            message: 'missing',
        }, 200);
        vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest').mockRejectedValue(error);
        const recoveryLoadSpy = vi.spyOn(workspaceDB, 'load').mockResolvedValue(undefined);

        await expect(loadWorkspace('missing')).rejects.toBe(error);
        expect(recoveryLoadSpy).not.toHaveBeenCalled();
    });

    it('saves only to the server without creating a recovery snapshot', async () => {
        mockState.serverConfig.WORKSPACE_BACKEND = 'local';
        const requestSpy = vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest')
            .mockResolvedValue({ data: {} });
        const recoverySaveSpy = vi.spyOn(workspaceDB, 'save').mockResolvedValue();

        await saveWorkspaceState(mockState as any);

        expect(requestSpy).toHaveBeenCalledOnce();
        expect(recoverySaveSpy).not.toHaveBeenCalled();
    });

    it('hydrates previews against the workspace being loaded', async () => {
        mockState.serverConfig.WORKSPACE_BACKEND = 'local';
        mockState.activeWorkspace = { id: 'workspace-a', displayName: 'Workspace A' };
        const inputTable = {
            kind: 'input-table',
            id: 'sales',
            displayId: 'Sales',
            source: { kind: 'workspace', tableId: 'sales_data' },
            snapshot: { columns: [], rowCount: 1, capturedAt: 1 },
            description: '',
            addedAt: 1,
        } as const;
        const requestSpy = vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest')
            .mockImplementation(async (url: string, options?: RequestInit) => {
                if (url === '/api/sessions/load') {
                    return { data: { state: { inputTables: [inputTable] } } };
                }
                if (url === '/api/tables/sample-table') {
                    return { data: { rows: [{ amount: 42 }] } };
                }
                throw new Error(`Unexpected URL: ${url}`);
            });

        await loadWorkspace('workspace-b');

        const sampleCall = requestSpy.mock.calls.find(([url]) => url === '/api/tables/sample-table');
        expect(new Headers(sampleCall?.[1]?.headers).get('X-Workspace-Id')).toBe('workspace-b');
        expect(getInputTablePreview(inputTable as any)?.rows).toEqual([{ amount: 42 }]);
    });

    it('rejects a load superseded by a newer workspace switch', async () => {
        mockState.serverConfig.WORKSPACE_BACKEND = 'local';
        let resolveFirstLoad!: (value: { data: { state: Record<string, unknown> } }) => void;
        const firstLoadResponse = new Promise<{ data: { state: Record<string, unknown> } }>(resolve => {
            resolveFirstLoad = resolve;
        });
        const requestSpy = vi.spyOn(await import('../../../../src/app/apiClient'), 'apiRequest')
            .mockImplementation(async (_url: string, options?: RequestInit) => {
                const workspaceId = JSON.parse(String(options?.body)).id;
                if (workspaceId === 'workspace-b') return firstLoadResponse;
                return { data: { state: { inputTables: [] } } };
            });

        const firstLoad = loadWorkspace('workspace-b');
        await vi.waitFor(() => expect(requestSpy).toHaveBeenCalledOnce());
        const secondLoad = loadWorkspace('workspace-c');
        await expect(secondLoad).resolves.toMatchObject({ readOnly: false });
        resolveFirstLoad({ data: { state: { inputTables: [] } } });

        await expect(firstLoad).rejects.toBeInstanceOf(WorkspaceLoadSupersededError);
    });
});
