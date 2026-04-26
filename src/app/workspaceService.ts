// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unified workspace service — single API for all workspace operations.
 *
 * Components call these functions without knowing whether the backend is
 * local, azure_blob, or ephemeral.  The routing is handled internally
 * based on ``serverConfig.WORKSPACE_BACKEND``.
 *
 * - local / azure_blob  → server API calls via fetchWithIdentity
 * - ephemeral           → IndexedDB via workspaceDB / tableDataDB
 */

import { fetchWithIdentity, getUrls } from './utils';
import {
    workspaceDB,
    tableDataDB,
    exportWorkspaceToZip,
    importWorkspaceFromZip,
    TableIndexEntry,
} from './workspaceDB';

// ── Helpers ─────────────────────────────────────────────────────────────

async function _getBackend(): Promise<'local' | 'azure_blob' | 'ephemeral'> {
    const { store } = await import('./store');
    return store.getState().serverConfig?.WORKSPACE_BACKEND || 'local';
}

export interface WorkspaceSummary {
    id: string;
    display_name: string;
    saved_at: string | null;
    table_count?: number | null;
    chart_count?: number | null;
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

// ── Workspace CRUD ──────────────────────────────────────────────────────

/** List all workspaces (newest first). */
export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
    const backend = await _getBackend();
    if (backend === 'ephemeral') {
        const entries = await workspaceDB.list();
        return entries.map(e => ({
            id: e.id,
            display_name: e.displayName,
            saved_at: e.updatedAt,
        }));
    }
    const res = await fetchWithIdentity(getUrls().SESSION_LIST);
    const data = await res.json();
    return data.status === 'ok' ? data.sessions : [];
}

/** Load a workspace's saved state. Returns null if not found. */
export async function loadWorkspace(id: string): Promise<{ state: Record<string, any>; displayName: string } | null> {
    const backend = await _getBackend();
    if (backend === 'ephemeral') {
        const entry = await workspaceDB.load(id);
        if (!entry?.state) return null;
        return { state: entry.state as Record<string, any>, displayName: entry.displayName };
    }
    const res = await fetchWithIdentity(getUrls().SESSION_LOAD, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.status !== 'ok' || !data.state) return null;
    const savedWs = data.state.activeWorkspace;
    return { state: data.state, displayName: savedWs?.displayName || id };
}

/** Delete a workspace. */
export async function deleteWorkspace(id: string): Promise<void> {
    const backend = await _getBackend();
    if (backend === 'ephemeral') {
        await workspaceDB.delete(id);
        _notifyListChanged();
        return;
    }
    await fetchWithIdentity(getUrls().SESSION_DELETE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
    _notifyListChanged();
}

/** Update only the display name in workspace_meta.json (lightweight, no full state). */
export async function updateWorkspaceMeta(id: string, displayName: string): Promise<void> {
    const backend = await _getBackend();
    if (backend === 'ephemeral') {
        await workspaceDB.updateDisplayName(id, displayName);
        _notifyListChanged();
        return;
    }
    await fetchWithIdentity(getUrls().SESSION_UPDATE_META, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, display_name: displayName }),
    });
    _notifyListChanged();
}

/** Save current workspace state (called by auto-save). */
export async function saveWorkspaceState(state: Record<string, unknown>): Promise<void> {
    const { store } = await import('./store');
    const fullState = store.getState();
    const backend = fullState.serverConfig?.WORKSPACE_BACKEND || 'local';
    const ws = fullState.activeWorkspace;
    if (!ws) return;

    if (backend === 'ephemeral') {
        const tables = (fullState.tables || []) as any[];
        const tableIndex: TableIndexEntry[] = tables.map((t: any) => ({
            name: t.virtual?.tableId || t.id,
            rowCount: t.virtual?.rowCount || t.rows?.length || 0,
            columns: (t.names || []).map((n: string) => ({
                name: n,
                type: String(t.metadata?.[n]?.type || 'unknown'),
            })),
            contentHash: t.contentHash,
        }));
        await workspaceDB.save(ws.id, ws.displayName, state, tableIndex);
        _notifyListChanged();
        return;
    }
    await fetchWithIdentity(getUrls().SESSION_SAVE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ws.id, state }),
    });
    _notifyListChanged();
}

// ── Export / Import ─────────────────────────────────────────────────────

/** Export a workspace as a downloadable zip Blob. */
export async function exportWorkspace(id: string): Promise<Blob> {
    const backend = await _getBackend();
    if (backend === 'ephemeral') {
        // Ensure latest state is saved before exporting
        const { store } = await import('./store');
        const state = store.getState();
        if (state.activeWorkspace?.id === id) {
            const EXCLUDED = new Set([
                'models', 'selectedModelId', 'testedModels',
                'dataLoaderConnectParams', 'identity', 'agentRules', 'serverConfig',
                'chartSynthesisInProgress', 'chartInsightInProgress',
                'cleanInProgress', 'sessionLoading', 'sessionLoadingLabel',
            ]);
            const serializable: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(state)) {
                if (!EXCLUDED.has(key)) serializable[key] = value;
            }
            await saveWorkspaceState(serializable);
        }
        return exportWorkspaceToZip(id);
    }
    // Server: load state, then export via server endpoint
    const res = await fetchWithIdentity(getUrls().SESSION_LOAD, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (data.status !== 'ok' || !data.state) {
        throw new Error('Failed to load workspace for export');
    }
    const exportRes = await fetchWithIdentity(getUrls().SESSION_EXPORT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: data.state }),
    });
    if (!exportRes.ok) throw new Error('Export failed');
    return exportRes.blob();
}

/** Import a workspace from a zip file. Returns the restored state. */
export async function importWorkspace(
    file: File,
    workspaceId: string,
    displayName: string,
): Promise<Record<string, any>> {
    const backend = await _getBackend();
    if (backend === 'ephemeral') {
        const { state } = await importWorkspaceFromZip(file, workspaceId, displayName);
        return state as Record<string, any>;
    }
    // Server: upload zip
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetchWithIdentity(getUrls().SESSION_IMPORT, {
        method: 'POST',
        body: formData,
    });
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Import failed');
    return data.state;
}

// ── Table operations ────────────────────────────────────────────────────

/** Delete a table from the workspace (server or IndexedDB). */
export async function deleteTableFromWorkspace(tableId: string): Promise<void> {
    const backend = await _getBackend();
    if (backend === 'ephemeral') {
        const { store } = await import('./store');
        const wsId = store.getState().activeWorkspace?.id;
        if (wsId) {
            await tableDataDB.delete(wsId, tableId);
        }
        return;
    }
    await fetchWithIdentity(getUrls().DELETE_TABLE, {
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

// ── Table data (ephemeral only) ─────────────────────────────────────────

export { tableDataDB } from './workspaceDB';
