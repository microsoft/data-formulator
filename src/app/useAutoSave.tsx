// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from './dfSlice';
import { saveWorkspaceState } from './workspaceService';
import { handleApiError } from './errorHandler';

/**
 * Fields excluded from auto-save (secrets / ephemeral / fetched-on-startup).
 * Must match the backend's _SENSITIVE_FIELDS in workspace_manager.py.
 */
const EXCLUDED_FIELDS = new Set([
    'models', 'selectedModelId', 'testedModels',
    'dataLoaderConnectParams', 'identity', 'serverConfig',
    // Transient fields that shouldn't trigger or be included in saves
    'chartSynthesisInProgress', 'chartInsightInProgress',
    'cleanInProgress', 'sessionLoading', 'sessionLoadingLabel',
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
            result[key] = value;
        }
    }
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

    useEffect(() => {
        // Don't auto-save while a session is loading, no workspace active, or no tables loaded
        if (state.sessionLoading || !state.activeWorkspace || state.tables.length === 0) {
            return;
        }

        // Debounce: reset timer on every state change
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        timerRef.current = setTimeout(async () => {
            // Skip if a save is already in flight
            if (isSavingRef.current) {
                pendingRef.current = true;
                return;
            }

            isSavingRef.current = true;
            try {
                const serializable = getSerializableState(state);
                await saveWorkspaceState(serializable);
            } catch (err) {
                const now = Date.now();
                if (now - lastErrorNotifyRef.current >= AUTO_SAVE_ERROR_NOTIFY_MS) {
                    lastErrorNotifyRef.current = now;
                    handleApiError(err, 'Auto-save');
                } else {
                    console.warn('[auto-save] failed:', err);
                }
            } finally {
                isSavingRef.current = false;
                // If state changed while we were saving, trigger another save
                if (pendingRef.current) {
                    pendingRef.current = false;
                    // Re-trigger by scheduling another timeout
                    timerRef.current = setTimeout(() => {
                        // This will be picked up by the next effect cycle
                    }, AUTO_SAVE_DEBOUNCE_MS);
                }
            }
        }, AUTO_SAVE_DEBOUNCE_MS);

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
        };
    }, [state]);
}
