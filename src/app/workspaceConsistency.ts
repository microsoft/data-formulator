// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Session ⇄ workspace consistency.
 *
 * The session state (the canvas: tables, threads, charts) is written by the
 * frontend; the table data (workspace.yaml + parquet) by the backend. Nothing
 * else ties them together, so a load that landed in another workspace, or a
 * deletion from another tab, leaves the session listing tables with no data.
 * This check compares the two whenever the session's tables change, and flags
 * the tables whose data is missing instead of letting every read fail silently.
 */

import { useEffect } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { DictTable, InputTable } from '../components/ComponentType';
import { DataFormulatorState, dfActions } from './dfSlice';
import { workspaceTableIdOf } from './tableResolution';
import { apiRequest } from './apiClient';
import { getUrls } from './utils';
import i18n from '../i18n';

const CHECK_DELAY_MS = 1500;

/** Each session table backed by workspace data: session id → workspace table name. */
export const expectedWorkspaceTables = (
    inputTables: InputTable[],
    derivedTables: DictTable[],
): Map<string, { name: string; displayId: string }> => {
    const expected = new Map<string, { name: string; displayId: string }>();
    for (const table of inputTables) {
        expected.set(table.id, { name: workspaceTableIdOf(table), displayId: table.displayId || table.id });
    }
    for (const table of derivedTables) {
        // A derived table without `virtual` keeps its rows in the session itself.
        if (table.virtual?.tableId) {
            expected.set(table.id, { name: table.virtual.tableId, displayId: table.displayId || table.id });
        }
    }
    return expected;
};

export const tablesMissingFrom = (
    expected: Map<string, { name: string }>,
    workspaceNames: Set<string>,
): string[] => [...expected].filter(([, { name }]) => !workspaceNames.has(name)).map(([id]) => id);

export function useWorkspaceConsistency() {
    const dispatch = useDispatch();
    const workspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const inputTables = useSelector((state: DataFormulatorState) => state.inputTables);
    const derivedTables = useSelector((state: DataFormulatorState) => state.derivedTables);
    const sessionLoading = useSelector((state: DataFormulatorState) => state.sessionLoading);
    const store = useStore<DataFormulatorState>();

    const expected = expectedWorkspaceTables(inputTables, derivedTables);
    const key = [...expected].map(([id, { name }]) => `${id}=${name}`).sort().join('|');
    const workspaceId = workspace?.id;

    useEffect(() => {
        if (sessionLoading) return;
        if (!workspaceId || expected.size === 0) {
            dispatch(dfActions.setTablesMissingData([]));
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const { data } = await apiRequest<{ tables: { name: string }[] }>(getUrls().LIST_TABLES, {
                    method: 'GET', headers: { 'X-Workspace-Id': workspaceId },
                });
                if (cancelled) return;
                const missing = tablesMissingFrom(expected, new Set((data.tables || []).map(table => table.name)));
                dispatch(dfActions.setTablesMissingData(missing));
                if (missing.length === 0) return;
                const names = missing.map(id => expected.get(id)?.displayId || id).join(', ');
                const value = i18n.t('dataThread.tableDataMissing', { names });
                // Once per session view: loading a session clears its messages, so this re-reports then.
                if (store.getState().messages.some(message => message.value === value)) return;
                dispatch(dfActions.addMessages({ timestamp: Date.now(), type: 'warning', component: 'workspace', value }));
            } catch {
                // An unreachable or expired workspace is reported where it is opened.
            }
        }, CHECK_DELAY_MS);
        return () => { cancelled = true; clearTimeout(timer); };
        // `expected` is captured through `key`.
    }, [workspaceId, key, sessionLoading, dispatch, store]);
}
