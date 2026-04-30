import React from 'react';
import { act, render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: {
        sessionLoading: false,
        activeWorkspace: { id: 'ws-1', displayName: 'Workspace 1' },
        tables: [{ id: 'table-1' }],
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

import { useAutoSave } from '../../../../src/app/useAutoSave';

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
});
