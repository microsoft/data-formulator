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
import { listWorkspaces, loadWorkspace, saveWorkspaceState } from '../../../../src/app/workspaceService';

beforeEach(() => {
    vi.restoreAllMocks();
    mockState.serverConfig.WORKSPACE_BACKEND = 'ephemeral';
    mockState.activeWorkspace = { id: 'workspace-1', displayName: 'Temporary session' };
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
});
