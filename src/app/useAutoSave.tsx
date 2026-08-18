// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useCallback, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { DataFormulatorState, dfSelectors } from './dfSlice';
import { saveWorkspaceState } from './workspaceService';
import { handleApiError } from './errorHandler';
import { DF_STATE_VERSION } from './stateMigrations';
import { stripConnectorPrefillFromEntries } from './connectorFormPersistence';

/**
 * Fields excluded from auto-save (secrets / ephemeral / fetched-on-startup).
 * Must match the backend's _SENSITIVE_FIELDS in workspace_manager.py.
 */
const EXCLUDED_FIELDS = new Set([
    'tables',
    'models', 'selectedModelId', 'testedModels',
    'dataLoaderConnectParams', 'identity', 'serverConfig',
    // Transient fields that shouldn't trigger or be included in saves
    'chartSynthesisInProgress',
    'tableLoadsInFlight',
    'cleanInProgress', 'sessionLoading', 'sessionLoadingLabel',
    // Starter-questions status is transient (loading/error); the questions
    // themselves are persisted, but the fetch status should reset on reload.
    'starterQuestionsStatus',
    // Thumbnails are derived from chart specs + table data; re-rendered
    // from the module cache on reload, so don't waste bandwidth saving them.
    'chartThumbnails',
]);

/** Debounce interval in milliseconds. */
const AUTO_SAVE_DEBOUNCE_MS = 3000;
const AUTO_SAVE_ERROR_NOTIFY_MS = 60000;

/**
 * Extract the serializable portion of the Redux state (strip sensitive/transient fields).
 */
export function getSerializableState(state: DataFormulatorState): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state)) {
        if (!EXCLUDED_FIELDS.has(key)) {
            result[key] = key === 'dataLoadingChatMessages' || key === 'textTurns'
                ? stripConnectorPrefillFromEntries(value)
                : value;
        }
    }
    // Stamp the schema version so `migrateState` can upgrade this payload on a
    // future load (see stateMigrations.ts). Unversioned = 0.
    result.__stateVersion = DF_STATE_VERSION;
    return result;
}

/**
 * Custom hook that auto-persists the Redux state to the backend.
 *
 * Debounces writes so rapid state changes (typing, dragging, etc.) don't
 * flood the server. Sensitive fields are stripped before sending.
 *
 * The backend writes the state to `session_state.json` in the active workspace.
 */
export function useAutoSave() {
    const state = useSelector((s: DataFormulatorState) => s);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isSavingRef = useRef(false);
    const pendingRef = useRef(false);
    const lastErrorNotifyRef = useRef(0);
    const latestStateRef = useRef(state);
    latestStateRef.current = state;

    const saveLatestState = useCallback(async () => {
        if (isSavingRef.current) {
            pendingRef.current = true;
            return;
        }

        isSavingRef.current = true;
        try {
            do {
                pendingRef.current = false;
                try {
                    await saveWorkspaceState(getSerializableState(latestStateRef.current));
                } catch (err) {
                    const now = Date.now();
                    if (now - lastErrorNotifyRef.current >= AUTO_SAVE_ERROR_NOTIFY_MS) {
                        lastErrorNotifyRef.current = now;
                        handleApiError(err, 'Auto-save');
                    } else {
                        console.warn('[auto-save] failed:', err);
                    }
                }
            } while (pendingRef.current);
        } finally {
            isSavingRef.current = false;
        }
    }, []);

    useEffect(() => {
        // Nothing to save while a session is loading, read-only, workspace-less,
        // or still empty. A conversation with no tables yet IS worth saving.
        if (state.sessionLoading || !state.activeWorkspace || state.activeWorkspace.readOnly
            || dfSelectors.selectSessionEmpty(state)) {
            return;
        }

        // Debounce: reset timer on every state change
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        timerRef.current = setTimeout(() => {
            void saveLatestState();
        }, AUTO_SAVE_DEBOUNCE_MS);

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, [saveLatestState, state]);
}
