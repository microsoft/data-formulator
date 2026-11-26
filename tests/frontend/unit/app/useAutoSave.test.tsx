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
    dispatch: vi.fn(),
    listeners: new Set<() => void>(),
    store: {
        getState: () => mocks.state,
        dispatch: (action: any) => mocks.dispatch(action),
        subscribe: (listener: () => void) => {
            mocks.listeners.add(listener);
            return () => { mocks.listeners.delete(listener); };
        },
    },
}));

function setState(state: any) {
    mocks.state = state;
    mocks.listeners.forEach(listener => listener());
}

vi.mock('react-redux', () => ({
    useStore: () => mocks.store,
}));

vi.mock('../../../../src/app/workspaceService', () => ({
    saveWorkspaceState: (...args: any[]) => mocks.saveWorkspaceState(...args),
    SessionConflictError: class SessionConflictError extends Error {
        constructor(readonly sessionId: string) { super('conflict'); }
    },
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
        mocks.dispatch.mockReset();
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

    it('stops saving and steps back when the server holds a newer copy', async () => {
        const { SessionConflictError } = await import('../../../../src/app/workspaceService');
        mocks.saveWorkspaceState.mockRejectedValueOnce(new SessionConflictError('ws-1'));

        render(<AutoSaveHarness />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: expect.stringMatching(/markSessionOpenElsewhere$/), payload: { id: 'ws-1' } }));
        expect(mocks.handleApiError).not.toHaveBeenCalled();
    });

    it('debounces store changes without re-rendering its host', () => {
        let renders = 0;
        function CountingHarness() {
            renders += 1;
            useAutoSave();
            return null;
        }
        render(<CountingHarness />);
        const initialRenders = renders;

        act(() => { vi.advanceTimersByTime(2000); });
        act(() => setState({ ...mocks.state, dataSourceSidebarOpen: true }));
        act(() => { vi.advanceTimersByTime(2000); });
        expect(mocks.saveWorkspaceState).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1000); });

        expect(mocks.saveWorkspaceState).toHaveBeenCalledTimes(1);
        expect(mocks.saveWorkspaceState.mock.calls[0][0]).toMatchObject({ dataSourceSidebarOpen: true });
        expect(renders).toBe(initialRenders);
    });

    it('saves the latest state when a change arrives during an in-flight save', async () => {
        let finishFirstSave!: () => void;
        mocks.saveWorkspaceState.mockImplementationOnce(() => new Promise<void>(resolve => {
            finishFirstSave = resolve;
        }));

        render(<AutoSaveHarness />);

        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(mocks.saveWorkspaceState).toHaveBeenCalledTimes(1);

        act(() => setState({
            ...mocks.state,
            inputTables: [{
                id: 'table-1',
                source: { kind: 'connector', connectorId: 'kusto-prod' },
            }],
        }));

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
