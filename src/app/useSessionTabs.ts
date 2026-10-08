// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { DataFormulatorState, dfActions, dfSelectors } from './dfSlice';
import { openSession } from './sessionThunks';
import { claimSession, registerSessionHolder, SESSION_PARAM } from './sessionTabs';
import { store, AppDispatch } from './store';
import { getSerializableState } from './useAutoSave';
import { saveWorkspaceState } from './workspaceService';


/**
 * Make this tab own one session (see `sessionTabs.ts`):
 * - on start, open the session named in the URL from the backend; state restored
 *   from shared browser storage may belong to a different tab;
 * - keep the URL naming the open session so reload and new tabs work;
 * - hand the session to another tab that claims it, saving first.
 */
export function useSessionTabs() {
    const dispatch = useDispatch<AppDispatch>();
    const [searchParams, setSearchParams] = useSearchParams();
    const inSession = useSelector(dfSelectors.selectInSession);
    const activeId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    // While the URL's session loads, the URL stays authoritative.
    const loadingFromUrl = useRef<string | null>(null);
    const [urlLoads, setUrlLoads] = useState(0);
    const started = useRef(false);

    useEffect(() => registerSessionHolder({
        holds: sessionId => {
            const workspace = store.getState().activeWorkspace;
            return workspace?.id === sessionId && !workspace.readOnly;
        },
        release: async sessionId => {
            const state = store.getState();
            if (!dfSelectors.selectSessionEmpty(state)) {
                try { await saveWorkspaceState(getSerializableState(state)); } catch { /* best effort */ }
            }
            dispatch(dfActions.markSessionOpenElsewhere({ id: sessionId }));
        },
    }), [dispatch]);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const urlId = searchParams.get(SESSION_PARAM);
        const workspace = store.getState().activeWorkspace;
        if (urlId && (urlId !== workspace?.id || workspace?.openElsewhere)) {
            loadingFromUrl.current = urlId;
            void dispatch(openSession(urlId, undefined, { saveCurrent: false })).then(opened => {
                // Never keep editing restored state that belongs to another session.
                if (!opened && store.getState().activeWorkspace?.id !== urlId) dispatch(dfActions.resetState());
            }).finally(() => {
                loadingFromUrl.current = null;
                setUrlLoads(count => count + 1);
            });
            return;
        }
        if (workspace && !workspace.readOnly && !workspace.provisional) {
            // Restored state is this tab's session; take it back from any tab editing it.
            void claimSession(workspace.id).then(released => {
                if (released) void dispatch(openSession(workspace.id, workspace.displayName, { saveCurrent: false }));
            });
        }
    }, []);

    useEffect(() => {
        if (loadingFromUrl.current) return;
        const next = inSession && activeId ? activeId : null;
        if ((searchParams.get(SESSION_PARAM) || null) === next) return;
        setSearchParams(previous => {
            const params = new URLSearchParams(previous);
            if (next) params.set(SESSION_PARAM, next);
            else params.delete(SESSION_PARAM);
            return params;
        }, { replace: true });
    }, [inSession, activeId, searchParams, setSearchParams, urlLoads]);
}
