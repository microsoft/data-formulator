// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Browser-owned recovery snapshots for TTL-managed ephemeral workspaces.
 *
 * Snapshots contain session structure and metadata only. Full table rows are
 * owned by the server workspace and are removed from IndexedDB during upgrade.
 */

const DB_NAME = 'data-formulator-workspaces';
const DB_VERSION = 3;
const STORE_WORKSPACES = 'workspaces';
const LEGACY_STORE_TABLE_DATA = 'table_data';

export interface TableIndexEntry {
    name: string;
    rowCount: number;
    columns: { name: string; type: string }[];
    contentHash?: string;
}

export interface WorkspaceEntry {
    id: string;
    displayName: string;
    createdAt: string;
    updatedAt: string;
    state: Record<string, unknown>;
    tableIndex: TableIndexEntry[];
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_WORKSPACES)) {
                db.createObjectStore(STORE_WORKSPACES, { keyPath: 'id' });
            }
            if (db.objectStoreNames.contains(LEGACY_STORE_TABLE_DATA)) {
                db.deleteObjectStore(LEGACY_STORE_TABLE_DATA);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
    return db.transaction(STORE_WORKSPACES, mode).objectStore(STORE_WORKSPACES);
}

export const workspaceDB = {
    async list(): Promise<WorkspaceEntry[]> {
        const db = await openDB();
        try {
            const entries = await requestToPromise<WorkspaceEntry[]>(store(db, 'readonly').getAll());
            return entries.sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''));
        } finally {
            db.close();
        }
    },

    async load(id: string): Promise<WorkspaceEntry | undefined> {
        const db = await openDB();
        try {
            return await requestToPromise<WorkspaceEntry | undefined>(store(db, 'readonly').get(id));
        } finally {
            db.close();
        }
    },

    async save(
        id: string,
        displayName: string,
        state: Record<string, unknown>,
        tableIndex: TableIndexEntry[] = [],
    ): Promise<void> {
        const db = await openDB();
        try {
            const objectStore = store(db, 'readwrite');
            const existing = await requestToPromise<WorkspaceEntry | undefined>(objectStore.get(id));
            const now = new Date().toISOString();
            await requestToPromise(objectStore.put({
                id,
                displayName,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
                state,
                tableIndex,
            } satisfies WorkspaceEntry));
        } finally {
            db.close();
        }
    },

    async delete(id: string): Promise<void> {
        const db = await openDB();
        try {
            await requestToPromise(store(db, 'readwrite').delete(id));
        } finally {
            db.close();
        }
    },

    async updateDisplayName(id: string, displayName: string): Promise<void> {
        const db = await openDB();
        try {
            const objectStore = store(db, 'readwrite');
            const existing = await requestToPromise<WorkspaceEntry | undefined>(objectStore.get(id));
            if (!existing) return;
            await requestToPromise(objectStore.put({
                ...existing,
                displayName,
                updatedAt: new Date().toISOString(),
            }));
        } finally {
            db.close();
        }
    },
};
