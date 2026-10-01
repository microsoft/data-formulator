import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions, dfSelectors } from '../../../../src/app/dfSlice';
import { ensureActiveWorkspace, generateWorkspaceId, leaveSession, openSession, renameSession } from '../../../../src/app/sessionThunks';
import { deleteWorkspace, loadWorkspace, saveWorkspaceState, updateWorkspaceMeta } from '../../../../src/app/workspaceService';
import type { AppDispatch } from '../../../../src/app/store';

vi.mock('../../../../src/app/workspaceService', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../src/app/workspaceService')>()),
    deleteWorkspace: vi.fn(() => Promise.resolve()),
    saveWorkspaceState: vi.fn(() => Promise.resolve()),
    loadWorkspace: vi.fn(() => Promise.resolve({ state: {}, displayName: 'Movies', readOnly: false })),
    updateWorkspaceMeta: vi.fn(() => Promise.resolve()),
}));

const makeStore = () => {
    const store = configureStore({
        reducer: dataFormulatorReducer,
        middleware: getDefaultMiddleware => getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }),
    });
    // The session thunks are typed against the app store's (persisted) dispatch.
    return store as typeof store & { dispatch: AppDispatch };
};

describe('session lifecycle', () => {
    beforeEach(() => {
        vi.mocked(deleteWorkspace).mockClear();
        vi.mocked(saveWorkspaceState).mockClear();
    });

    it('generates timestamped workspace IDs', () => {
        expect(generateWorkspaceId()).toMatch(/^session_\d{8}_\d{6}_[0-9a-f]{4}$/);
    });

    it('mints one provisional workspace that keeps the landing page', () => {
        const store = makeStore();
        store.dispatch(ensureActiveWorkspace());
        const first = store.getState().activeWorkspace;
        store.dispatch(ensureActiveWorkspace());

        expect(first).toMatchObject({ displayName: 'Untitled Session', provisional: true });
        expect(store.getState().activeWorkspace?.id).toBe(first?.id);
        expect(dfSelectors.selectInSession(store.getState())).toBe(false);
    });

    it('enters the session once work arrives and stays after it is emptied', () => {
        const store = makeStore();
        store.dispatch(ensureActiveWorkspace());
        store.dispatch(dfActions.setWorkspaceFileCount(1));

        expect(store.getState().activeWorkspace?.provisional).toBeUndefined();
        expect(dfSelectors.selectInSession(store.getState())).toBe(true);

        store.dispatch(dfActions.setWorkspaceFileCount(0));
        expect(dfSelectors.selectInSession(store.getState())).toBe(true);
    });

    it('enters the session when the landing chat is submitted', () => {
        const store = makeStore();
        store.dispatch(ensureActiveWorkspace());
        store.dispatch(dfActions.queueAnalystTask({ text: 'find sales data', images: [], attachments: [] }));

        expect(dfSelectors.selectInSession(store.getState())).toBe(true);
    });

    it('resets every session field while keeping settings and sidebar state', () => {
        const store = makeStore();
        store.dispatch(dfActions.setActiveWorkspace({ id: 'ws', displayName: 'Sales' }));
        store.dispatch(dfActions.appendWorkspaceItems(['shelf-card-orders']));
        store.dispatch(dfActions.setDataSourceSidebarTab('sessions'));
        store.dispatch(dfActions.resetState());

        const state = store.getState();
        expect(state.activeWorkspace).toBeNull();
        expect(state.workspaceItemOrder).toEqual([]);
        expect(state.dataSourceSidebarTab).toBe('sessions');
    });

    it('discards an empty workspace when leaving', async () => {
        const store = makeStore();
        store.dispatch(ensureActiveWorkspace());
        const id = store.getState().activeWorkspace!.id;

        await store.dispatch(leaveSession());

        expect(deleteWorkspace).toHaveBeenCalledWith(id);
        expect(saveWorkspaceState).not.toHaveBeenCalled();
        expect(store.getState().activeWorkspace).toBeNull();
    });

    it('saves a workspace with work before leaving', async () => {
        const store = makeStore();
        store.dispatch(dfActions.setActiveWorkspace({ id: 'ws', displayName: 'Sales' }));
        store.dispatch(dfActions.setWorkspaceFileCount(1));

        await store.dispatch(leaveSession());

        expect(saveWorkspaceState).toHaveBeenCalledOnce();
        expect(deleteWorkspace).not.toHaveBeenCalled();
        expect(store.getState().activeWorkspace).toBeNull();
    });

    it('saves the current session before opening another', async () => {
        const store = makeStore();
        store.dispatch(dfActions.setActiveWorkspace({ id: 'ws', displayName: 'Sales' }));
        store.dispatch(dfActions.setWorkspaceFileCount(1));
        vi.mocked(saveWorkspaceState).mockImplementationOnce(async () => {
            expect(loadWorkspace).not.toHaveBeenCalled();
        });

        expect(await store.dispatch(openSession('movies'))).toBe(true);

        expect(saveWorkspaceState).toHaveBeenCalledOnce();
        expect(loadWorkspace).toHaveBeenCalledWith('movies');
        expect(store.getState().activeWorkspace).toMatchObject({ id: 'movies', displayName: 'Movies' });
        expect(store.getState().sessionLoading).toBe(false);
    });

    it('renames the active session in place without resetting it', async () => {
        const store = makeStore();
        store.dispatch(dfActions.setActiveWorkspace({ id: 'ws', displayName: 'Sales', readOnly: false }));
        store.dispatch(dfActions.setWorkspaceFileCount(2));

        await store.dispatch(renameSession('ws', 'Regional sales'));
        await store.dispatch(renameSession('other', 'Other'));

        expect(updateWorkspaceMeta).toHaveBeenCalledWith('ws', 'Regional sales');
        expect(updateWorkspaceMeta).toHaveBeenCalledWith('other', 'Other');
        expect(store.getState().activeWorkspace).toMatchObject({ id: 'ws', displayName: 'Regional sales' });
        expect(store.getState().workspaceFileCount).toBe(2);
    });
});
