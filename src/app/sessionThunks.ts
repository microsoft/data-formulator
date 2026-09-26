// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppDispatch } from './store';
import { DataFormulatorState, dfActions, dfSelectors } from './dfSlice';
import { generateUUID } from './identity';
import { deleteWorkspace, saveWorkspaceState } from './workspaceService';
import { getSerializableState } from './useAutoSave';

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
    dispatch(dfActions.setActiveWorkspace({ id: generateWorkspaceId(), displayName: 'Untitled Session', provisional: true }));
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
