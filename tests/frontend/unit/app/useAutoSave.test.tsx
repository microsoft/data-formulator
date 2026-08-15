import React from 'react';
import { act, render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: {
        sessionLoading: false,
        activeWorkspace: { id: 'ws-1', displayName: 'Workspace 1' },
        inputTables: [{ id: 'table-1' }],
        derivedTables: [],
    },
    saveWorkspaceState: vi.fn(),
    handleApiError: vi.fn(),
}));

vi.mock('react-redux', () => ({
    useSelector: (selector: any) => selector(mocks.state),
}));

vi.mock('../../../../src/app/workspaceService', () => ({
    saveWorkspaceState: (...args: any[]) => mocks.saveWorkspaceState(...args),
}));

vi.mock('../../../../src/app/errorHandler', () => ({
    handleApiError: (...args: any[]) => mocks.handleApiError(...args),
}));

import { getSerializableState, useAutoSave } from '../../../../src/app/useAutoSave';

function AutoSaveHarness() {
    useAutoSave();
    return null;
}

describe('useAutoSave', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.saveWorkspaceState.mockReset();
        mocks.handleApiError.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('notifies the frontend when auto-save fails', async () => {
        const err = new Error('save failed');
        mocks.saveWorkspaceState.mockRejectedValueOnce(err);

        render(<AutoSaveHarness />);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(mocks.handleApiError).toHaveBeenCalledWith(err, 'Auto-save');
    });

    it('strips connector form prefills from workspace snapshots', () => {
        const state = {
            ...mocks.state,
            textTurns: [{
                id: 'turn-1',
                form: {
                    kind: 'connector',
                    title: 'Connect to PostgreSQL',
                    connector: {
                        sourceType: 'postgresql',
                        status: 'pending',
                        prefilled: { host: 'db.example.com', password: 'secret' },
                    },
                },
            }],
        };

        const snapshot = getSerializableState(state as any);

        expect(snapshot.textTurns).toEqual([{
            id: 'turn-1',
            form: {
                kind: 'connector',
                title: 'Connect to PostgreSQL',
                connector: {
                    sourceType: 'postgresql',
                    status: 'pending',
                },
            },
        }]);
        expect(state.textTurns[0].form.connector.prefilled.password).toBe('secret');
    });
});
