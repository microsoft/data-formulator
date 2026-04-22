// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * IndexedDB workspace store for ephemeral mode.
 *
 * Mirrors the backend workspace structure:
 *
 *   Backend (disk):                    IndexedDB:
 *   workspaces/<id>/                   workspaces store:
 *     session_state.json                 { id, displayName, ..., state }
 *     workspace.yaml                     { ..., tableIndex }
 *     data/                            table_data store:
 *       sales.parquet                    { key: "wsId/sales", rows }
 *       products.parquet                 { key: "wsId/products", rows }
 *
 * - "workspaces" store: workspace metadata + session state + table index
 *     (equivalent to session_state.json + workspace.yaml)
 * - "table_data" store: full table rows, keyed by "workspaceId/tableId"
 *     (equivalent to parquet files in data/)
 *
 * Separation ensures workspace switching is fast (load metadata only)
 * and full data is loaded on-demand for agent execution.
 */

const DB_NAME = 'data-formulator-workspaces';
const DB_VERSION = 2;
const STORE_WORKSPACES = 'workspaces';
const STORE_TABLE_DATA = 'table_data';

/** Table entry in the workspace index (equivalent to a row in workspace.yaml). */
export interface TableIndexEntry {
    name: string;
    rowCount: number;
    columns: { name: string; type: string }[];
    contentHash?: string;
}

/** Workspace record in IndexedDB. */
export interface WorkspaceEntry {
    id: string;
    displayName: string;
    createdAt: string;   // ISO
    updatedAt: string;   // ISO
    /** Session state (Redux state minus sensitive/transient fields and table rows). */
    state: Record<string, unknown>;
    /** Table metadata index — equivalent to workspace.yaml. */
    tableIndex: TableIndexEntry[];
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_WORKSPACES)) {
                db.createObjectStore(STORE_WORKSPACES, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_TABLE_DATA)) {
                const tableStore = db.createObjectStore(STORE_TABLE_DATA, { keyPath: 'key' });
                tableStore.createIndex('workspaceId', 'workspaceId', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function txStore(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    storeName: string = STORE_WORKSPACES,
): IDBObjectStore {
    return db.transaction(storeName, mode).objectStore(storeName);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ── Workspace CRUD ──────────────────────────────────────────────────────

export const workspaceDB = {
    /** List all workspaces (metadata only, no full data), newest first. */
    async list(): Promise<WorkspaceEntry[]> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readonly');
            const entries: WorkspaceEntry[] = await reqToPromise(store.getAll());
            entries.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
            return entries;
        } finally {
            db.close();
        }
    },

    /** Load workspace metadata + state. Returns undefined if not found. */
    async load(id: string): Promise<WorkspaceEntry | undefined> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readonly');
            return await reqToPromise(store.get(id));
        } finally {
            db.close();
        }
    },

    /** Save workspace metadata, state, and table index. */
    async save(
        id: string,
        displayName: string,
        state: Record<string, unknown>,
        tableIndex: TableIndexEntry[] = [],
    ): Promise<void> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readwrite');
            const existing: WorkspaceEntry | undefined = await reqToPromise(store.get(id));
            const now = new Date().toISOString();
            const entry: WorkspaceEntry = {
                id,
                displayName,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
                state,
                tableIndex,
            };
            await reqToPromise(store.put(entry));
        } finally {
            db.close();
        }
    },

    /** Delete a workspace and all its table data. */
    async delete(id: string): Promise<void> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readwrite');
            await reqToPromise(store.delete(id));
        } finally {
            db.close();
        }
        await tableDataDB.deleteAll(id);
    },

    /** Check if a workspace exists. */
    async exists(id: string): Promise<boolean> {
        const entry = await this.load(id);
        return entry !== undefined;
    },
};

// ── Table data (full rows) ──────────────────────────────────────────────

export interface TableDataEntry {
    key: string;          // "workspaceId/tableId"
    workspaceId: string;
    tableId: string;
    rows: any[];
}

function tableKey(workspaceId: string, tableId: string): string {
    return `${workspaceId}/${tableId}`;
}

export const tableDataDB = {
    /** Save full table rows. */
    async save(workspaceId: string, tableId: string, rows: any[]): Promise<void> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readwrite', STORE_TABLE_DATA);
            const entry: TableDataEntry = {
                key: tableKey(workspaceId, tableId),
                workspaceId,
                tableId,
                rows,
            };
            await reqToPromise(store.put(entry));
        } finally {
            db.close();
        }
    },

    /** Load full table rows. Returns undefined if not found. */
    async load(workspaceId: string, tableId: string): Promise<any[] | undefined> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readonly', STORE_TABLE_DATA);
            const entry: TableDataEntry | undefined = await reqToPromise(
                store.get(tableKey(workspaceId, tableId))
            );
            return entry?.rows;
        } finally {
            db.close();
        }
    },

    /** Load ALL table rows for a workspace (for sending to server). */
    async loadAll(workspaceId: string): Promise<{ name: string; rows: any[] }[]> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readonly', STORE_TABLE_DATA);
            const index = store.index('workspaceId');
            const entries: TableDataEntry[] = await reqToPromise(index.getAll(workspaceId));
            return entries.map(e => ({ name: e.tableId, rows: e.rows }));
        } finally {
            db.close();
        }
    },

    /** Delete one table's data. */
    async delete(workspaceId: string, tableId: string): Promise<void> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readwrite', STORE_TABLE_DATA);
            await reqToPromise(store.delete(tableKey(workspaceId, tableId)));
        } finally {
            db.close();
        }
    },

    /** Delete all table data for a workspace. */
    async deleteAll(workspaceId: string): Promise<void> {
        const db = await openDB();
        try {
            const store = txStore(db, 'readwrite', STORE_TABLE_DATA);
            const index = store.index('workspaceId');
            const keys = await reqToPromise(index.getAllKeys(workspaceId));
            for (const key of keys) {
                store.delete(key);
            }
        } finally {
            db.close();
        }
    },
};

// ── Export / Import ─────────────────────────────────────────────────────

/**
 * Export a workspace from IndexedDB as a zip file.
 *
 * Zip structure (mirrors backend workspace layout):
 *   session_state.json   — Redux state (minus sensitive fields)
 *   workspace.yaml       — table index as JSON (named .yaml for consistency)
 *   data/<tableId>.json  — full rows for each table
 *
 * Returns a Blob ready for download.
 */
export async function exportWorkspaceToZip(workspaceId: string): Promise<Blob> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Load workspace metadata + state
    const entry = await workspaceDB.load(workspaceId);
    if (!entry) throw new Error(`Workspace '${workspaceId}' not found`);

    // session_state.json
    zip.file('session_state.json', JSON.stringify(entry.state, null, 2));

    // workspace.yaml (as JSON — the backend uses YAML but JSON is a superset)
    zip.file('workspace.yaml', JSON.stringify({
        displayName: entry.displayName,
        tableIndex: entry.tableIndex || [],
    }, null, 2));

    // data/<tableId>.json — full rows from table_data store
    const allTables = await tableDataDB.loadAll(workspaceId);
    const dataFolder = zip.folder('data')!;
    for (const table of allTables) {
        dataFolder.file(`${table.name}.json`, JSON.stringify(table.rows));
    }

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * Import a workspace from a zip file into IndexedDB.
 *
 * Accepts the same zip format produced by exportWorkspaceToZip.
 * Returns the workspace ID and restored state.
 */
export async function importWorkspaceFromZip(
    file: File | Blob,
    workspaceId: string,
    displayName: string,
): Promise<{ state: Record<string, unknown>; tableCount: number }> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(file);

    // Read session_state.json (exported by app) or state.json (built by build_demo_zips.py)
    const stateFile = zip.file('session_state.json') || zip.file('state.json');
    if (!stateFile) throw new Error('Invalid workspace zip: missing session_state.json');
    const state: Record<string, unknown> = JSON.parse(await stateFile.async('string'));

    // Read workspace.yaml (JSON format) — may be at root or under workspace/
    let tableIndex: TableIndexEntry[] = [];
    const yamlFile = zip.file('workspace.yaml') || zip.file('workspace/workspace.yaml');
    if (yamlFile) {
        const meta = JSON.parse(await yamlFile.async('string'));
        tableIndex = meta.tableIndex || [];
    }

    // Save workspace metadata + state
    await workspaceDB.save(workspaceId, displayName, state, tableIndex);

    // Read data/*.json or workspace/data/*.json → table_data store
    let tableCount = 0;
    const dataFolder = zip.folder('data') ?? zip.folder('workspace/data');
    if (dataFolder) {
        const filePromises: Promise<void>[] = [];
        dataFolder.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir || !relativePath.endsWith('.json')) return;
            const tableId = relativePath.replace(/\.json$/, '');
            filePromises.push(
                zipEntry.async('string').then(content => {
                    const rows = JSON.parse(content);
                    return tableDataDB.save(workspaceId, tableId, rows);
                })
            );
            tableCount++;
        });
        await Promise.all(filePromises);
    }

    return { state, tableCount };
}
