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

/** When a session was started, from its id (see `generateWorkspaceId`); now if the id has no date. */
function sessionIdDate(sessionId: string): Date {
    const match = /^session_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/.exec(sessionId);
    if (!match) return new Date();
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    return new Date(year, month - 1, day, hour, minute, second);
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
    const workspace = await putAway(getState());
    // Another session may have been opened while saving.
    if (getState().activeWorkspace?.id === workspace?.id) {
        dispatch(dfActions.resetState());
    }
};

/** Save the session being left so it can be reopened, or discard it when empty. */
async function putAway(state: DataFormulatorState) {
    const workspace = state.activeWorkspace;
    if (workspace && !workspace.readOnly) {
        if (dfSelectors.selectSessionEmpty(state)) {
            try { await deleteWorkspace(workspace.id); } catch { /* may never have been created */ }
        } else {
            try { await saveWorkspaceState(getSerializableState(state)); } catch { /* best effort */ }
        }
    }
    return workspace;
}

/**
 * Start a blank session in place of the current one (the "+" / New buttons).
 * The current session is saved, or discarded when empty, as on leaving; the
 * new one is saved only once it holds work (autosave skips an empty session).
 */
export const startNewSession = () => async (dispatch: AppDispatch, getState: GetState) => {
    const state = getState();
    if (dfSelectors.selectInSession(state) && dfSelectors.selectSessionEmpty(state) && !state.activeWorkspace?.readOnly) return;
    // Straight from one session to the next: passing through the landing page would move the URL twice.
    const workspace = await putAway(state);
    if (getState().activeWorkspace?.id !== workspace?.id) return;
    dispatch(dfActions.resetForNewWorkspace({ id: generateWorkspaceId(), displayName: defaultSessionName() }));
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
            // A blank session ("+") is saved only once it holds work; reopened before that (reload, back/forward)
            // it gets the name it was started with, still owned by auto-naming.
            const unsaved = !result.state.activeWorkspace && result.displayName === sessionId;
            const blankName = unsaved ? displayName || defaultSessionName(sessionIdDate(sessionId)) : undefined;
            dispatch(dfActions.loadState({ ...result.state, activeWorkspace: {
                ...result.state.activeWorkspace, id: sessionId, displayName: blankName || displayName || result.displayName, readOnly: result.readOnly,
                ...(blankName ? { autoName: { name: blankName, sources: [] } } : {}),
            } }));
            if (result.workflowRun) {
                // A scheduled run's outputs come from its checkpoint and workspace tables, as for a live run.
                const { publishWorkflowRun } = await import('../views/WorkflowPanel');
                try { await publishWorkflowRun(result.workflowRun, sessionId); }
                catch (error) { console.warn('Failed to restore scheduled run outputs:', error); }
            }
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
