// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppDispatch } from './store';
import { DataFormulatorState, dfActions, dfSelectors } from './dfSlice';
import { generateUUID } from './identity';
import { deleteWorkspace, loadWorkspace, saveWorkspaceState, updateWorkspaceMeta, WorkspaceLoadSupersededError } from './workspaceService';
import { getSerializableState } from './useAutoSave';
import i18n from '../i18n';
import { claimSession } from './sessionTabs';
import { defaultSessionName } from './useWorkspaceAutoName';

type GetState = () => DataFormulatorState;

const pad = (value: number) => String(value).padStart(2, '0');

/** Generate a workspace ID like session_20260408_193052_a1b2 */
export function generateWorkspaceId(): string {
    const now = new Date();
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `session_${date}_${time}_${generateUUID().slice(0, 4)}`;
}

/**
 * Give backend requests a workspace without entering a session. The backend
 * creates the folder lazily and hides it until it holds work; the UI stays on
 * the landing page until then (see `selectInSession`).
 */
export const ensureActiveWorkspace = () => (dispatch: AppDispatch, getState: GetState) => {
    if (getState().activeWorkspace) return;
    const displayName = defaultSessionName();
    dispatch(dfActions.setActiveWorkspace({ id: generateWorkspaceId(), displayName, provisional: true, autoName: { name: displayName, sources: [] } }));
};

/**
 * Leave the current session for the landing page. Work is saved first so it
 * can be reopened; an empty workspace is discarded instead of lingering.
 */
export const leaveSession = () => async (dispatch: AppDispatch, getState: GetState) => {
    const state = getState();
    const workspace = state.activeWorkspace;
    if (workspace && !workspace.readOnly) {
        if (dfSelectors.selectSessionEmpty(state)) {
            try { await deleteWorkspace(workspace.id); } catch { /* may never have been created */ }
        } else {
            try { await saveWorkspaceState(getSerializableState(state)); } catch { /* best effort */ }
        }
    }
    // Another session may have been opened while saving.
    if (getState().activeWorkspace?.id === workspace?.id) {
        dispatch(dfActions.resetState());
    }
};

/**
 * Open a saved session, replacing the current one. Resolves true when it opened;
 * failures are reported to the user and resolve false.
 */
export const openSession = (sessionId: string, displayName?: string, options: { saveCurrent?: boolean } = {}) =>
    async (dispatch: AppDispatch, getState: GetState): Promise<boolean> => {
    // Loading pauses autosave, so persist recent work in the session being left first.
    // Startup skips this: state restored from browser storage may belong to another tab.
    const state = getState();
    const current = state.activeWorkspace;
    if (options.saveCurrent !== false && current && current.id !== sessionId && !current.readOnly
        && !dfSelectors.selectSessionEmpty(state)) {
        try { await saveWorkspaceState(getSerializableState(state)); } catch { /* best effort */ }
    }
    dispatch(dfActions.setSessionLoading({ loading: true, label: i18n.t('sidebar.openingWorkspace') }));
    // A tab editing this session saves and steps back before it loads here.
    await claimSession(sessionId);
    try {
        const result = await loadWorkspace(sessionId);
        if (result) {
            dispatch(dfActions.loadState({ ...result.state, activeWorkspace: {
                ...result.state.activeWorkspace, id: sessionId, displayName: displayName || result.displayName, readOnly: result.readOnly,
            } }));
            return true;
        }
        dispatch(dfActions.addMessages({
            timestamp: Date.now(), type: 'error', component: 'workspace', value: i18n.t('workspace.failedToOpenWorkspace'),
        }));
        return false;
    } catch (error) {
        if (!(error instanceof WorkspaceLoadSupersededError)) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(), type: 'error', component: 'workspace', value: i18n.t('workspace.failedToOpenWorkspace'),
            }));
        }
        return false;
    } finally {
        dispatch(dfActions.setSessionLoading({ loading: false }));
    }
};

/** Rename a session; the active session's name updates immediately so autosave keeps it. */
export const renameSession = (sessionId: string, displayName: string) => async (dispatch: AppDispatch) => {
    dispatch(dfActions.renameActiveWorkspace({ id: sessionId, displayName }));
    await updateWorkspaceMeta(sessionId, displayName);
};

/** Delete a saved session other than the one that is open. */
export const deleteSession = (sessionId: string) => async (_dispatch: AppDispatch, getState: GetState) => {
    if (getState().activeWorkspace?.id === sessionId) throw new Error('Open another session before deleting this one.');
    await deleteWorkspace(sessionId);
};
