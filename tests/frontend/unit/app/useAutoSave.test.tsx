import React from 'react';
import { act, render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: {
        sessionLoading: false,
        activeWorkspace: { id: 'ws-1', displayName: 'Workspace 1' },
        inputTables: [{ id: 'table-1' }],
        derivedTables: [],
    } as any,
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
        mocks.state = {
            sessionLoading: false,
            activeWorkspace: { id: 'ws-1', displayName: 'Workspace 1' },
            inputTables: [{ id: 'table-1' }],
            derivedTables: [],
        };
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

    it('saves the latest state when a change arrives during an in-flight save', async () => {
        let finishFirstSave!: () => void;
        mocks.saveWorkspaceState.mockImplementationOnce(() => new Promise<void>(resolve => {
            finishFirstSave = resolve;
        }));

        const { rerender } = render(<AutoSaveHarness />);

        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(mocks.saveWorkspaceState).toHaveBeenCalledTimes(1);

        mocks.state = {
            ...mocks.state,
            inputTables: [{
                id: 'table-1',
                source: { kind: 'connector', connectorId: 'kusto-prod' },
            }],
        };
        rerender(<AutoSaveHarness />);

        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(mocks.saveWorkspaceState).toHaveBeenCalledTimes(1);

        await act(async () => {
            finishFirstSave();
            await Promise.resolve();
        });

        expect(mocks.saveWorkspaceState).toHaveBeenCalledTimes(2);
        expect(mocks.saveWorkspaceState.mock.calls[1][0]).toMatchObject({
            inputTables: [{
                id: 'table-1',
                source: { kind: 'connector', connectorId: 'kusto-prod' },
            }],
        });
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

    it('persists field semantics in workspace snapshots', () => {
        const snapshot = getSerializableState({
            ...mocks.state,
            tableSemantics: [{
                tableId: 'table-1',
                fields: { amount: { semanticType: 'Currency', unit: 'USD' } },
            }],
        } as any);

        expect(snapshot.tableSemantics).toEqual([{
            tableId: 'table-1',
            fields: { amount: { semanticType: 'Currency', unit: 'USD' } },
        }]);
    });
});
