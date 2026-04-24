// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unified table loading thunk: loadTable
 * 
 * All data loaders (file, paste, URL, example, database, extract) should use
 * this thunk to load tables into the application. It handles:
 * - Optionally storing data on the server (workspace) via API calls
 * - Applying row limits when data stays local (storeOnServer = false)
 * - Building DictTable with appropriate virtual/source fields
 * - Adding the table to Redux state + fetching semantic types
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { DataSourceConfig, DictTable } from '../components/ComponentType';
import { Type } from '../data/types';
import { inferTypeFromValueArray } from '../data/utils';
import { fetchWithIdentity, getUrls, CONNECTOR_ACTION_URLS, computeContentHash, SourceTableRef } from './utils';
import { DataFormulatorState, dfActions, fetchFieldSemanticType } from './dfSlice';
import { tableDataDB } from './workspaceDB';

/** Gzip-compress a string into a Blob using the browser's CompressionStream API. */
async function compressBlob(data: string): Promise<Blob> {
    const blob = new Blob([new TextEncoder().encode(data)]);
    const cs = new CompressionStream('gzip');
    const compressedStream = blob.stream().pipeThrough(cs);
    return new Response(compressedStream).blob();
}

export interface LoadTablePayload {
    // The table data (already parsed into rows/names/metadata on the frontend)
    table: DictTable;
    
    // For file uploads to server: the raw File object
    file?: File;
    
    // When true, the backend deletes all existing tables from the same source
    // file before creating the new table.  Used by "Load All" to clean up
    // orphaned sheets when re-uploading a file.
    replaceSource?: boolean;

    // For database sources loaded via data connector:
    sourceTableRef?: SourceTableRef;
    connectorId?: string;
    importOptions?: {
        rowLimit?: number;
        sortColumns?: string[];
        sortOrder?: 'asc' | 'desc';
        conditions?: { column: string; operator: string; value?: any }[];
    };
}

export interface LoadTableResult {
    table: DictTable;
    truncated?: boolean;      // whether rows were truncated due to frontendRowLimit
    originalRowCount?: number; // original count before truncation
    duplicate?: boolean;      // whether the table was already loaded (skipped)
}

/**
 * Unified thunk to load a table from any source.
 * 
 * Storage is determined by the server config:
 * - local / azure_blob: store on server (workspace parquet)
 * - ephemeral: keep data local (frontend-owned, sent with each request)
 * 
 * In all cases: adds table to Redux state + fetches semantic types
 */
export const loadTable = createAsyncThunk<
    LoadTableResult,
    LoadTablePayload,
    { state: DataFormulatorState }
>(
    'dataFormulator/loadTable',
    async (payload, { dispatch, getState }) => {
        const { table, file, replaceSource, sourceTableRef, connectorId, importOptions } = payload;
        const state = getState();
        const frontendRowLimit = state.config?.frontendRowLimit ?? 2_000_000;
        const existingTables = state.tables;

        // Storage determined by backend config
        const storeOnServer = state.serverConfig?.WORKSPACE_BACKEND !== 'ephemeral';

        // === DUPLICATE CHECK ===
        // Skip when replaceSource is true — the user explicitly wants to
        // refresh / replace data, so we must reach the server to trigger
        // the source-file cleanup even if hashes match.
        if (!replaceSource) {
            const existingById = existingTables.find(t => t.id === table.id);
            if (existingById) {
                dispatch(dfActions.setFocused({ type: 'table', tableId: existingById.id }));
                return { table: existingById, duplicate: true };
            }

            const incomingHash = table.contentHash || computeContentHash(table.rows, table.names);
            const existingByContent = existingTables.find(t => {
                if (!t.contentHash) return false;
                return t.contentHash === incomingHash;
            });
            if (existingByContent) {
                dispatch(dfActions.setFocused({ type: 'table', tableId: existingByContent.id }));
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    type: 'warning',
                    component: 'data loader',
                    value: `This data is identical to the already-loaded table "${existingByContent.displayId}". Skipped duplicate load.`,
                }));
                return { table: existingByContent, duplicate: true };
            }

            if (table.virtual) {
                const existingByVirtual = existingTables.find(t => t.virtual?.tableId === table.virtual?.tableId);
                if (existingByVirtual) {
                    dispatch(dfActions.setFocused({ type: 'table', tableId: existingByVirtual.id }));
                    return { table: existingByVirtual, duplicate: true };
                }
            }
        }
        
        let truncated = false;
        let originalRowCount = 0;

        const sourceType = table.source?.type;
        const enrichedSource: DataSourceConfig | undefined = table.source
            ? { ...table.source, originalTableName: table.source.originalTableName || table.displayId || table.id }
            : undefined;
        let finalTable: DictTable = { ...table, source: enrichedSource || table.source };

        if (storeOnServer) {
            // === STORE ON SERVER PATH ===
            if (sourceType === 'database' && sourceTableRef && connectorId) {
                // Database source: ingest to workspace via data connector
                try {
                    const ingestUrl = CONNECTOR_ACTION_URLS.IMPORT_DATA;
                    const ingestBody = {
                        connector_id: connectorId,
                        source_table: sourceTableRef,
                        table_name: sourceTableRef.name,
                        import_options: importOptions || {},
                    };
                    const response = await fetchWithIdentity(ingestUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(ingestBody),
                    });
                    const data = await response.json();
                    if (data.status === 'success') {
                        // Now fetch the table info from workspace to get sample rows
                        const listResp = await fetchWithIdentity(getUrls().LIST_TABLES, { method: 'GET' });
                        const listData = await listResp.json();
                        if (listData.status === 'success') {
                            const wsTable = listData.tables.find((t: any) => t.name === data.table_name);
                            if (wsTable) {
                                finalTable = buildDictTableFromWorkspace(wsTable, enrichedSource);
                            }
                        }
                    } else {
                        throw new Error(data.message || 'Failed to ingest data');
                    }
                } catch (err) {
                    console.error('Failed to ingest database table to workspace:', err);
                    throw err;
                }
            } else if (file) {
                // File upload to workspace — backend converts to parquet
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('table_name', table.id);
                    if (replaceSource) {
                        formData.append('replace_source', 'true');
                    }
                    // Sheet hint for multi-sheet Excel: backend validates against real sheets
                    const srcName = table.source?.fileName || file.name;
                    if (srcName && table.id.length > srcName.length + 1
                        && table.id.startsWith(srcName + '-')) {
                        formData.append('sheet_name', table.id.slice(srcName.length + 1));
                    }
                    
                    const response = await fetchWithIdentity(getUrls().CREATE_TABLE, {
                        method: 'POST',
                        body: formData,
                    });
                    const data = await response.json();
                    if (data.status === 'success') {
                        // Fetch back from workspace to get proper virtual info
                        const listResp = await fetchWithIdentity(getUrls().LIST_TABLES, { method: 'GET' });
                        const listData = await listResp.json();
                        if (listData.status === 'success') {
                            const wsTable = listData.tables.find((t: any) => t.name === data.table_name);
                            if (wsTable) {
                                finalTable = buildDictTableFromWorkspace(wsTable, enrichedSource);
                            }
                        }
                    } else {
                        throw new Error(data.message || 'Failed to upload file');
                    }
                } catch (err) {
                    console.error('Failed to upload file to workspace:', err);
                    throw err;
                }
            } else {
                // Other sources (paste/url/example/extract): upload raw data to workspace
                try {
                    const formData = new FormData();
                    const compressedBlob = await compressBlob(JSON.stringify(table.rows));
                    formData.append('raw_data', compressedBlob, 'data.json.gz');
                    formData.append('table_name', table.id);
                    
                    const response = await fetchWithIdentity(getUrls().CREATE_TABLE, {
                        method: 'POST',
                        body: formData,
                    });
                    const data = await response.json();
                    if (data.status === 'success') {
                        // Set virtual info from the response — virtual indicates server storage
                        finalTable = {
                            ...table,
                            source: enrichedSource || table.source,
                            virtual: {
                                tableId: data.table_name,
                                rowCount: data.row_count,
                            },
                            id: data.table_name, // use the sanitized name from server
                            displayId: table.displayId || data.table_name,
                        };
                    } else {
                        throw new Error(data.message || 'Failed to save data to workspace');
                    }
                } catch (err) {
                    console.error('Failed to save data to workspace:', err);
                    throw err;
                }
            }
        } else {
            // === LOCAL ONLY PATH (storeOnServer = false) ===
            if (sourceType === 'database' && connectorId && sourceTableRef) {
                // Database source: fetch data via data connector preview (no workspace save)
                try {
                    const response = await fetchWithIdentity(CONNECTOR_ACTION_URLS.PREVIEW_DATA, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            connector_id: connectorId,
                            source_table: sourceTableRef,
                            import_options: {
                                size: frontendRowLimit,
                                sort_columns: importOptions?.sortColumns,
                                sort_order: importOptions?.sortOrder,
                            },
                        }),
                    });
                    const data = await response.json();
                    if (data.status === 'success') {
                        const rows = data.rows;
                        const names = rows.length > 0 ? Object.keys(rows[0]) : [];
                        const totalCount: number = data.total_row_count ?? table.virtual?.rowCount ?? rows.length;
                        originalRowCount = totalCount;
                        truncated = rows.length < totalCount;
                        
                        finalTable = {
                            ...table,
                            source: enrichedSource || table.source,
                            id: table.id,
                            displayId: table.displayId || table.id,
                            names,
                            rows,
                            metadata: names.reduce((acc: Record<string, any>, name: string) => ({
                                ...acc,
                                [name]: {
                                    type: inferTypeFromValueArray(rows.map((r: any) => r[name])),
                                    semanticType: "",
                                    levels: []
                                }
                            }), {}),
                            anchored: true,
                        };
                    } else {
                        throw new Error(data.message || 'Failed to fetch data from external source');
                    }
                } catch (err) {
                    console.error('Failed to fetch data from external source:', err);
                    throw err;
                }
            } else {
                // Other sources: apply row limit
                originalRowCount = table.rows.length;
                if (table.rows.length > frontendRowLimit) {
                    truncated = true;
                    finalTable = {
                        ...table,
                        source: enrichedSource || table.source,
                        rows: table.rows.slice(0, frontendRowLimit),
                    };
                } else {
                    finalTable = { ...table, source: enrichedSource || table.source };
                }
            }
        }

        // Ephemeral mode: store full rows in IndexedDB, keep only samples in Redux
        const isEphemeral = state.serverConfig?.WORKSPACE_BACKEND === 'ephemeral';
        if (isEphemeral && finalTable.rows.length > 0) {
            const wsId = state.activeWorkspace?.id;
            if (wsId) {
                const tableId = finalTable.virtual?.tableId || finalTable.id;
                const fullRows = finalTable.rows;
                const fullRowCount = fullRows.length;

                // Store full data in IndexedDB
                await tableDataDB.save(wsId, tableId, fullRows);

                // Keep only sample rows in Redux + set virtual
                const sampleSize = Math.min(1000, fullRowCount);
                finalTable = {
                    ...finalTable,
                    rows: fullRows.slice(0, sampleSize),
                    virtual: { tableId, rowCount: fullRowCount },
                };
            }
        }

        // Dispatch the table into Redux state
        dispatch(dfActions.addTableToStore(finalTable));
        dispatch(fetchFieldSemanticType(finalTable));

        // Notify user about truncation
        if (truncated && originalRowCount) {
            const workspaceBackend = state.serverConfig?.WORKSPACE_BACKEND;
            const storageLabel = workspaceBackend === 'azure_blob' ? 'Azure' : 'Disk';
            const baseMsg = `Table "${finalTable.displayId || finalTable.id}" was truncated from ${originalRowCount.toLocaleString()} to ${frontendRowLimit.toLocaleString()} rows (browser limit).`;
            const installHint = ` To load the full dataset, switch to "${storageLabel}" storage mode.`;
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'warning',
                component: 'data loader',
                value: baseMsg + installHint,
            }));
        }

        return { table: finalTable, truncated, originalRowCount, duplicate: false };
    }
);

/**
 * Helper: Build a DictTable from a workspace table listing (as returned by /api/tables/list-tables).
 */
export function buildDictTableFromWorkspace(
    wsTable: any,
    source: DataSourceConfig | undefined,
): DictTable {
    const convertSqlTypeToAppType = (sqlType: string): Type => {
        sqlType = sqlType.toUpperCase();
        if (sqlType.includes('INT') || sqlType === 'BIGINT' || sqlType === 'SMALLINT' || sqlType === 'TINYINT') {
            return Type.Integer;
        } else if (sqlType.includes('FLOAT') || sqlType.includes('DOUBLE') || sqlType.includes('DECIMAL') || sqlType.includes('NUMERIC') || sqlType.includes('REAL')) {
            return Type.Number;
        } else if (sqlType.includes('BOOL')) {
            return Type.Boolean;
        } else if (sqlType.includes('DATE') || sqlType.includes('TIME') || sqlType.includes('TIMESTAMP')) {
            return Type.Date;
        } else {
            return Type.String;
        }
    };

    const sourceMeta = wsTable.source_metadata;
    const backendOriginalName: string | undefined = wsTable.original_name || undefined;
    let sourceConfig: DataSourceConfig;
    if (source) {
        sourceConfig = {
            ...source,
            originalTableName: source.originalTableName || backendOriginalName,
        };
    } else if (wsTable.source_type === 'upload' && wsTable.source_filename) {
        const fn = wsTable.source_filename;
        const dotIdx = fn.lastIndexOf('.');
        sourceConfig = {
            type: 'file',
            fileName: fn,
            originalTableName: backendOriginalName || (dotIdx > 0 ? fn.substring(0, dotIdx) : fn),
        };
    } else {
        sourceConfig = {
            type: 'database',
            databaseTable: wsTable.name,
            canRefresh: sourceMeta != null,
            lastRefreshed: Date.now(),
            originalTableName: backendOriginalName,
        };
    }

    return {
        kind: 'table' as const,
        id: wsTable.name,
        displayId: wsTable.name,
        names: wsTable.columns.map((col: any) => col.name),
        metadata: wsTable.columns.reduce((acc: Record<string, any>, col: any) => ({
            ...acc,
            [col.name]: {
                type: convertSqlTypeToAppType(col.type),
                semanticType: "",
                levels: []
            }
        }), {}),
        rows: wsTable.sample_rows,
        virtual: {
            tableId: wsTable.name,
            rowCount: wsTable.row_count,
        },
        anchored: true,
        attachedMetadata: '',
        source: sourceConfig,
    };
}

/**
 * Check if any ancestor table of a given table is local-only (no virtual field).
 * A table without `virtual` has all its data in the browser only, not on the server.
 * Used by derivation code to decide whether derived results should also stay local.
 */
export function hasLocalOnlyAncestor(tableId: string, tables: DictTable[]): boolean {
    const visited = new Set<string>();
    
    const check = (id: string): boolean => {
        if (visited.has(id)) return false;
        visited.add(id);
        
        const t = tables.find(tbl => tbl.id === id);
        if (!t) return false;
        // virtual field indicates data is stored on server; absence means local-only
        if (!t.virtual && !t.derive) return true;
        
        if (t.derive?.source) {
            for (const sourceId of t.derive.source) {
                if (check(sourceId)) return true;
            }
        }
        return false;
    };
    
    return check(tableId);
}
