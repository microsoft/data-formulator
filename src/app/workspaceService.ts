// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unified workspace service — single API for all workspace operations.
 *
 * Components call these functions without knowing which server-side workspace
 * manager is active. All backends expose the same API contract.
 */

import { fetchWithIdentity, getUrls } from './utils';
import { apiRequest, ApiRequestError, assertDownloadResponseOk } from './apiClient';
import { workspaceDB, TableIndexEntry } from './workspaceDB';
import { INPUT_TABLE_PREVIEW_ROW_LIMIT, replaceInputTablePreviews } from './inputTablePreviewCache';
import { migrateState } from './stateMigrations';
import { workspaceTableIdOf } from './tableResolution';
import type { InputTable } from '../components/ComponentType';

export interface WorkspaceSummary {
    id: string;
    display_name: string;
    created_at: string | null;
    saved_at: string | null;
    table_count?: number | null;
    chart_count?: number | null;
    read_only?: boolean;
}

async function isEphemeralBackend(): Promise<boolean> {
    const { store } = await import('./store');
    return store.getState().serverConfig?.WORKSPACE_BACKEND === 'ephemeral';
}

function createRecoveryState(state: Record<string, unknown>): Record<string, unknown> {
    const snapshot = JSON.parse(JSON.stringify(state)) as Record<string, any>;
    snapshot.derivedTables = Array.isArray(snapshot.derivedTables)
        ? snapshot.derivedTables.map((table: Record<string, unknown>) => ({ ...table, rows: [] }))
        : [];
    delete snapshot.tables;
    return snapshot;
}

function createTableIndex(state: Record<string, any>): TableIndexEntry[] {
    const inputs = Array.isArray(state.inputTables) ? state.inputTables : [];
    const derived = Array.isArray(state.derivedTables) ? state.derivedTables : [];
    return [
        ...inputs.map((table: any) => ({
            name: workspaceTableIdOf(table),
            rowCount: table.snapshot?.rowCount || 0,
            columns: (table.snapshot?.columns || []).map((column: any) => ({
                name: column.name,
                type: String(column.type || 'unknown'),
            })),
            contentHash: table.snapshot?.contentHash,
        })),
        ...derived.map((table: any) => ({
            name: table.virtual?.tableId || table.id,
            rowCount: table.virtual?.rowCount || table.rows?.length || 0,
            columns: (table.names || []).map((name: string) => ({
                name,
                type: String(table.metadata?.[name]?.type || 'unknown'),
            })),
            contentHash: table.contentHash,
        })),
    ];
}

// ── Workspace list change event ─────────────────────────────────────
// Fired after mutations (save, delete, rename, meta-update) so all
// list consumers can refresh without coupling to each other.

const WORKSPACE_LIST_CHANGED = 'df:workspace-list-changed';

export function onWorkspaceListChanged(cb: () => void): () => void {
    window.addEventListener(WORKSPACE_LIST_CHANGED, cb);
    return () => window.removeEventListener(WORKSPACE_LIST_CHANGED, cb);
}

function _notifyListChanged(): void {
    window.dispatchEvent(new Event(WORKSPACE_LIST_CHANGED));
}

type PreparedInputTablePreview = {
    table: InputTable;
    rows: Record<string, unknown>[];
};

let workspaceLoadGeneration = 0;

export class WorkspaceLoadSupersededError extends Error {
    readonly name = 'WorkspaceLoadSupersededError';
}

function assertCurrentWorkspaceLoad(generation: number): void {
    if (generation !== workspaceLoadGeneration) {
        throw new WorkspaceLoadSupersededError('A newer workspace load has started');
    }
}

async function prepareInputTablePreviews(
    state: Record<string, any>,
    workspaceId: string,
): Promise<PreparedInputTablePreview[]> {
    const inputTables = (state.inputTables || []) as InputTable[];
    const previews = await Promise.all(inputTables.map(async table => {
        const workspaceTableId = workspaceTableIdOf(table);
        try {
            const { data } = await apiRequest<{ rows: Record<string, unknown>[] }>(getUrls().SAMPLE_TABLE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Workspace-Id': workspaceId,
                },
                body: JSON.stringify({ table: workspaceTableId, size: INPUT_TABLE_PREVIEW_ROW_LIMIT }),
            });
            return { table, rows: data.rows || [] };
        } catch (error) {
            console.warn(`Failed to hydrate preview for ${table.id}:`, error);
            return null;
        }
    }));
    return previews.filter((preview): preview is PreparedInputTablePreview => preview !== null);
}

// ── Workspace CRUD ──────────────────────────────────────────────────────

/** List all workspaces (newest first). */
export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
    const { data } = await apiRequest(getUrls().SESSION_LIST);
    const serverWorkspaces = (data.sessions ?? []) as WorkspaceSummary[];
    if (!await isEphemeralBackend()) return serverWorkspaces;

    const serverIds = new Set(serverWorkspaces.map(workspace => workspace.id));
    const recoveryWorkspaces = await workspaceDB.list();
    const expiredWorkspaces = recoveryWorkspaces
        .filter(workspace => !serverIds.has(workspace.id))
        .map(workspace => ({
            id: workspace.id,
            display_name: workspace.displayName,
            created_at: workspace.createdAt,
            saved_at: workspace.updatedAt,
            read_only: true,
        }));
    return [...serverWorkspaces, ...expiredWorkspaces]
        .sort((left, right) => (right.saved_at || '').localeCompare(left.saved_at || ''));
}

/** Load a workspace's saved state. Returns null if not found. */
export async function loadWorkspace(id: string): Promise<{ state: Record<string, any>; displayName: string; readOnly: boolean } | null> {
    const generation = ++workspaceLoadGeneration;
    const ephemeral = await isEphemeralBackend();
    assertCurrentWorkspaceLoad(generation);
    try {
        const { data } = await apiRequest(getUrls().SESSION_LOAD, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        if (!data.state) return null;
        const state = migrateState(data.state);
        const previews = await prepareInputTablePreviews(state, id);
        assertCurrentWorkspaceLoad(generation);
        replaceInputTablePreviews(previews);
        const savedWs = state.activeWorkspace;
        const displayName = savedWs?.displayName || id;
        if (ephemeral) {
            await workspaceDB.save(id, displayName, createRecoveryState(state), createTableIndex(state));
        }
        return { state, displayName, readOnly: false };
    } catch (error) {
        if (error instanceof WorkspaceLoadSupersededError) throw error;
        assertCurrentWorkspaceLoad(generation);
        const unavailable = error instanceof ApiRequestError
            && ['WORKSPACE_EXPIRED', 'TABLE_NOT_FOUND'].includes(error.apiError.code);
        if (!ephemeral || !unavailable) throw error;
        const recovery = await workspaceDB.load(id);
        if (!recovery) return null;
        assertCurrentWorkspaceLoad(generation);
        replaceInputTablePreviews([]);
        return {
            state: createRecoveryState(migrateState(recovery.state)),
            displayName: recovery.displayName,
            readOnly: true,
        };
    }
}

/** Delete a workspace. */
export async function deleteWorkspace(id: string): Promise<void> {
    try {
        await apiRequest(getUrls().SESSION_DELETE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
    } catch (error) {
        const alreadyUnavailable = error instanceof ApiRequestError
            && ['WORKSPACE_EXPIRED', 'TABLE_NOT_FOUND'].includes(error.apiError.code);
        if (!await isEphemeralBackend() || !alreadyUnavailable) throw error;
    }
    if (await isEphemeralBackend()) await workspaceDB.delete(id);
    _notifyListChanged();
}

/** Update only the display name in workspace_meta.json (lightweight, no full state). */
export async function updateWorkspaceMeta(id: string, displayName: string): Promise<void> {
    await apiRequest(getUrls().SESSION_UPDATE_META, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, display_name: displayName }),
    });
    if (await isEphemeralBackend()) await workspaceDB.updateDisplayName(id, displayName);
    _notifyListChanged();
}

/** Save current workspace state (called by auto-save). */
export async function saveWorkspaceState(state: Record<string, unknown>): Promise<void> {
    const { store } = await import('./store');
    const fullState = store.getState();
    const ws = fullState.activeWorkspace;
    if (!ws || isWorkspaceReadOnly(ws)) return;

    await apiRequest(getUrls().SESSION_SAVE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ws.id, state }),
    });
    if (fullState.serverConfig?.WORKSPACE_BACKEND === 'ephemeral') {
        await workspaceDB.save(
            ws.id,
            ws.displayName,
            createRecoveryState(state),
            createTableIndex(fullState),
        );
    }
    _notifyListChanged();
}

// ── Export / Import ─────────────────────────────────────────────────────

/** Export a workspace as a downloadable zip Blob. */
export async function exportWorkspace(id: string): Promise<Blob> {
    const { data } = await apiRequest<{ state: any }>(getUrls().SESSION_LOAD, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
    if (!data.state) {
        throw new Error('Failed to load workspace for export');
    }
    const exportRes = await fetchWithIdentity(getUrls().SESSION_EXPORT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: data.state, workspace_id: id }),
    });
    await assertDownloadResponseOk(exportRes, 'Export failed');
    return exportRes.blob();
}

/** Import a workspace from a zip file. Returns the restored state. */
export async function importWorkspace(
    file: File,
    workspaceId: string,
    displayName: string,
): Promise<Record<string, any>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspace_id', workspaceId);
    const { data } = await apiRequest<{ state: any }>(getUrls().SESSION_IMPORT, {
        method: 'POST',
        body: formData,
    });
    return migrateState(data.state);
}

// ── Table operations ────────────────────────────────────────────────────

/** Delete a table from the workspace. */
export async function deleteTableFromWorkspace(tableId: string): Promise<void> {
    await apiRequest(getUrls().DELETE_TABLE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: tableId }),
    });
}

/** Fire-and-forget batch delete of tables from the workspace. */
export function deleteTablesFromWorkspace(tableIds: string[]): void {
    for (const id of tableIds) {
        deleteTableFromWorkspace(id).catch(err => {
            console.warn(`Failed to clean up table ${id}:`, err);
        });
    }
}

export function isWorkspaceReadOnly(workspace: { readOnly?: boolean } | null | undefined): boolean {
    return workspace?.readOnly === true;
}