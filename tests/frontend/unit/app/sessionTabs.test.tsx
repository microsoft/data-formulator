import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';

const testStore = vi.hoisted(() => ({ current: null as any }));
vi.mock('../../../../src/app/store', () => ({
    get store() { return testStore.current; },
    get default() { return testStore.current; },
}));
vi.mock('../../../../src/app/workspaceService', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../src/app/workspaceService')>()),
    saveWorkspaceState: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../../src/app/sessionThunks', () => ({
    openSession: vi.fn((id: string) => async (dispatch: any) => {
        dispatch(dfActions.setActiveWorkspace({ id, displayName: `Session ${id}` }));
        dispatch(dfActions.setWorkspaceFileCount(1));
        return true;
    }),
}));

import { claimSession, registerSessionHolder, sessionUrl, TAB_ID } from '../../../../src/app/sessionTabs';
import { useSessionTabs } from '../../../../src/app/useSessionTabs';
import { openSession } from '../../../../src/app/sessionThunks';
import { saveWorkspaceState } from '../../../../src/app/workspaceService';

/** A second browser tab: another channel instance on the same name. */
const otherTab = () => new BroadcastChannel('df-session-tabs');

describe('session tab coordination', () => {
    let peer: BroadcastChannel;
    beforeEach(() => { peer = otherTab(); });
    afterEach(() => peer.close());

    it('waits for a tab editing the session to save and release it', async () => {
        peer.onmessage = event => {
            if (event.data.type !== 'claim' || event.data.sessionId !== 'sales') return;
            peer.postMessage({ type: 'yielding', sessionId: 'sales', tabId: 'peer' });
            setTimeout(() => peer.postMessage({ type: 'released', sessionId: 'sales', tabId: 'peer' }), 400);
        };
        expect(await claimSession('sales')).toBe(true);
    });

    it('continues promptly when no other tab holds the session', async () => {
        const started = Date.now();
        expect(await claimSession('unused')).toBe(false);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('releases a held session to a claiming tab and ignores others', async () => {
        const release = vi.fn(async () => undefined);
        const cleanup = registerSessionHolder({ holds: id => id === 'mine', release });
        const replies: any[] = [];
        peer.onmessage = event => replies.push(event.data);

        peer.postMessage({ type: 'claim', sessionId: 'other', tabId: 'peer' });
        peer.postMessage({ type: 'claim', sessionId: 'mine', tabId: 'peer' });
        await waitFor(() => expect(replies.map(reply => reply.type)).toEqual(['yielding', 'released']));
        expect(release).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledWith('mine');
        expect(replies.every(reply => reply.sessionId === 'mine' && reply.tabId === TAB_ID)).toBe(true);
        cleanup();
    });

    it('builds an app URL naming the session', () => {
        expect(new URL(sessionUrl('session 1')).searchParams.get('session')).toBe('session 1');
        expect(new URL(sessionUrl('s')).pathname.endsWith('/app')).toBe(true);
    });
});

describe('useSessionTabs', () => {
    const Probe: React.FC = () => { useSessionTabs(); return null; };
    const renderAt = (url: string) => {
        const router = createMemoryRouter([{ path: '/app', element: <Probe /> }], { initialEntries: [url] });
        render(<Provider store={testStore.current}><RouterProvider router={router} /></Provider>);
        return router;
    };
    beforeEach(() => {
        testStore.current = configureStore({
            reducer: dataFormulatorReducer,
            middleware: getDefaultMiddleware => getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }),
        });
        vi.mocked(openSession).mockClear();
        vi.mocked(saveWorkspaceState).mockClear();
    });

    it('opens the URL session from the backend instead of restored browser state', async () => {
        testStore.current.dispatch(dfActions.setActiveWorkspace({ id: 'restored', displayName: 'Other tab' }));
        testStore.current.dispatch(dfActions.setWorkspaceFileCount(1));
        const router = renderAt('/app?session=wanted');

        await waitFor(() => expect(testStore.current.getState().activeWorkspace?.id).toBe('wanted'));
        expect(openSession).toHaveBeenCalledWith('wanted', undefined, { saveCurrent: false });
        expect(router.state.location.search).toBe('?session=wanted');
    });

    it('names the open session in the URL and steps back when another tab claims it', async () => {
        testStore.current.dispatch(dfActions.setActiveWorkspace({ id: 'mine', displayName: 'Mine' }));
        testStore.current.dispatch(dfActions.setWorkspaceFileCount(1));
        const router = renderAt('/app');
        await waitFor(() => expect(router.state.location.search).toBe('?session=mine'));
        expect(openSession).not.toHaveBeenCalled();

        const peer = otherTab();
        const replies: string[] = [];
        peer.onmessage = event => replies.push(event.data.type);
        peer.postMessage({ type: 'claim', sessionId: 'mine', tabId: 'peer' });
        await waitFor(() => expect(replies).toEqual(['yielding', 'released']));
        peer.close();

        expect(saveWorkspaceState).toHaveBeenCalledOnce();
        expect(testStore.current.getState().activeWorkspace).toMatchObject({ id: 'mine', readOnly: true, openElsewhere: true });
    });
});
