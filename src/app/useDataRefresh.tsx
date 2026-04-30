// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, selectRefreshConfigs } from './dfSlice';
import { AppDispatch } from './store';
import { DictTable } from '../components/ComponentType';
import { createTableFromText } from '../data/utils';
import { fetchWithIdentity, getUrls, CONNECTOR_ACTION_URLS, computeContentHash } from './utils';
import { apiRequest } from './apiClient';

/** Gzip-compress a string into a Blob using the browser's CompressionStream API. */
async function compressBlob(data: string): Promise<Blob> {
    const blob = new Blob([new TextEncoder().encode(data)]);
    const cs = new CompressionStream('gzip');
    const compressedStream = blob.stream().pipeThrough(cs);
    return new Response(compressedStream).blob();
}

interface RefreshResult {
    tableId: string;
    success: boolean;
    message: string;
    newRows?: any[];
    contentHash?: string; // Hash from backend for database sources
}

/**
 * Custom hook that manages automatic data refresh for tables with streaming or database sources.
 * It sets up intervals for each table that has auto-refresh enabled.
 *
 * Performance: timers are driven by `selectRefreshConfigs` (which is stable when
 * only row data changes) instead of the full `state.tables` array.  A ref keeps
 * track of the latest tables snapshot so callbacks always have fresh data without
 * causing the effect to re-run.
 */
export function useDataRefresh() {
    const dispatch = useDispatch<AppDispatch>();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const refreshConfigs = useSelector(selectRefreshConfigs);
    const timeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const refreshInProgressRef = useRef<Map<string, boolean>>(new Map());
    const isActiveRef = useRef<Map<string, boolean>>(new Map());
    const initializedTablesRef = useRef<Set<string>>(new Set());

    // Keep a ref to the latest tables so callbacks can read fresh data
    // without adding `tables` to useEffect/useCallback deps.
    const tablesRef = useRef(tables);
    tablesRef.current = tables;

    /** Read latest table from store (avoids stale closure issues). */
    const getLatestTable = useCallback((tableId: string): DictTable | undefined => {
        return tablesRef.current.find(t => t.id === tableId);
    }, []);

    /**
     * Fetches fresh data from a streaming URL
     */
    const fetchStreamData = useCallback(async (table: DictTable): Promise<RefreshResult> => {
        const source = table.source;
        if (!source?.url) {
            return { tableId: table.id, success: false, message: 'No URL configured' };
        }

        try {
            const response = await fetch(source.url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const content = await response.text();
            let newRows: any[] = [];

            try {
                const jsonContent = JSON.parse(content);
                if (Array.isArray(jsonContent)) {
                    newRows = jsonContent;
                } else {
                    throw new Error('JSON content must be an array');
                }
            } catch {
                // Try parsing as CSV/TSV
                const tempTable = createTableFromText('temp', content);
                if (tempTable) {
                    newRows = tempTable.rows;
                } else {
                    throw new Error('Unable to parse response as JSON or CSV/TSV');
                }
            }

            return {
                tableId: table.id,
                success: true,
                message: 'Data refreshed successfully',
                newRows
            };
        } catch (error) {
            return {
                tableId: table.id,
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }, []);

    /**
     * Refreshes a virtual table from its original database source.
     * Uses the connected source refresh endpoint when available.
     * Backend returns data_changed flag - if false, skip resampling to avoid unnecessary work.
     */
    const refreshDatabaseTable = useCallback(async (table: DictTable): Promise<RefreshResult> => {
        if (!table.virtual?.tableId) {
            return { tableId: table.id, success: false, message: 'Not a virtual table' };
        }

        const tableName = table.virtual.tableId;
        const connectorId = table.source?.connectorId;

        if (!connectorId) {
            return { tableId: table.id, success: false, message: 'No connector for this table. Please reconnect to the data source.' };
        }

        try {
            console.log(`[DataRefresh] Requesting connector '${connectorId}' to refresh "${tableName}"...`);
            
            const { data: refreshData } = await apiRequest<any>(CONNECTOR_ACTION_URLS.REFRESH_DATA, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connector_id: connectorId, table_name: tableName })
            });
            
            console.log(`[DataRefresh] Backend refreshed "${tableName}" (${refreshData.row_count} rows, data_changed=${refreshData.data_changed})`);

            // If data hasn't changed, skip resampling - no need to update frontend
            if (!refreshData.data_changed) {
                console.log(`[DataRefresh] Data unchanged for "${tableName}", skipping resample`);
                return {
                    tableId: table.id,
                    success: true,
                    message: `Data unchanged (${refreshData.row_count} rows)`,
                };
            }

            // Data changed - get a fresh sample for the frontend
            const { data: sampleData } = await apiRequest<{ rows: any[] }>(getUrls().SAMPLE_TABLE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    table: tableName,
                    size: Math.min(table.rows.length, 10000)
                })
            });

            return {
                tableId: table.id,
                success: true,
                message: `Refreshed from source (${refreshData.row_count} rows)`,
                newRows: sampleData.rows,
                contentHash: refreshData.content_hash
            };
        } catch (error) {
            return {
                tableId: table.id,
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }, [dispatch]);

    /**
     * Refresh a single table's data
     */
    const refreshTable = useCallback(async (table: DictTable): Promise<RefreshResult> => {
        const source = table.source;

        // Stream source - frontend has URL
        if (source?.type === 'stream' && source.url) {
            return fetchStreamData(table);
        }

        // Database source - backend has connection info
        if (table.virtual && source?.type === 'database' && source.canRefresh) {
            return refreshDatabaseTable(table);
        }

        return { tableId: table.id, success: false, message: 'Table does not support refresh' };
    }, [fetchStreamData, refreshDatabaseTable]);

    /**
     * Refresh table and update state, then refresh derived tables
     */
    const performRefresh = useCallback(async (table: DictTable) => {
        // Prevent overlapping refreshes for the same table
        if (refreshInProgressRef.current.get(table.id)) {
            console.log(`[DataRefresh] Refresh already in progress for "${table.id}", skipping...`);
            return;
        }

        refreshInProgressRef.current.set(table.id, true);

        try {
            const result = await refreshTable(table);

            if (result.success) {
                // Check if we have new rows to process
                if (result.newRows) {
                    // For stream sources: compute hash locally and compare
                    // For database sources: backend already determined data changed
                    const newContentHash = result.contentHash || computeContentHash(result.newRows, table.names);
                    const oldContentHash = table.contentHash;
                    
                    const dataChanged = oldContentHash !== newContentHash;
                    
                    if (dataChanged) {
                        console.log(`[DataRefresh] Table "${table.id}" data changed (hash: ${oldContentHash?.slice(0, 8) || 'none'} -> ${newContentHash.slice(0, 8)}), updating...`);
                        
                        // For stream sources with virtual tables, sync the new data to workspace
                        // so that sandbox code (derived table refresh) reads fresh data from parquet.
                        // Database sources don't need this — their backend refresh already updates workspace.
                        if (table.source?.type === 'stream' && table.virtual?.tableId) {
                            try {
                                const compressedBody = await compressBlob(JSON.stringify({
                                    table_name: table.virtual.tableId,
                                    rows: result.newRows
                                }));
                                await apiRequest(getUrls().SYNC_TABLE_DATA, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
                                    body: compressedBody
                                });
                                console.log(`[DataRefresh] Synced stream data for "${table.virtual.tableId}" to workspace`);
                            } catch (syncError) {
                                console.warn(`[DataRefresh] Failed to sync stream data to workspace:`, syncError);
                            }
                        }

                        // Update the table rows - this will trigger useDerivedTableRefresh
                        // Pass contentHash from backend for virtual/DB tables so it reflects full table state
                        dispatch(dfActions.updateTableRows({
                            tableId: table.id,
                            rows: result.newRows,
                            contentHash: result.contentHash  // Use backend hash for DB tables
                        }));

                        // Notify about the refresh
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(),
                            component: 'Data Refresh',
                            type: 'info',
                            value: `Table "${table.displayId || table.id}" data refreshed (${result.newRows.length} rows)`
                        }));
                    } else {
                        console.log(`[DataRefresh] Table "${table.id}" data unchanged (hash: ${newContentHash.slice(0, 8)})`);
                    }
                } else {
                    // Success but no newRows means database refresh detected no data change
                    // No need to update frontend state or trigger derived table refresh
                    console.log(`[DataRefresh] Table "${table.id}" refresh complete - data unchanged (backend check)`);
                }
            } else {
                console.warn(`[DataRefresh] Failed to refresh "${table.id}": ${result.message}`);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'Data Refresh',
                    type: 'warning',
                    value: `Failed to refresh "${table.displayId || table.id}": ${result.message}`
                }));
            }
        } finally {
            refreshInProgressRef.current.set(table.id, false);
        }
    }, [dispatch, refreshTable]);

    /**
     * Schedule the next refresh for a table after the current one completes.
     * Uses recursive setTimeout pattern to ensure updates wait until complete.
     */
    const scheduleNextRefresh = useCallback((tableId: string) => {
        // Look up the current table state to get latest source config
        const table = getLatestTable(tableId);
        if (!table) {
            isActiveRef.current.set(tableId, false);
            return;
        }

        const source = table.source;
        if (!source?.autoRefresh || !source.refreshIntervalSeconds || source.refreshIntervalSeconds <= 0) {
            isActiveRef.current.set(tableId, false);
            return;
        }

        if (!isActiveRef.current.get(tableId)) {
            return;
        }

        const intervalMs = source.refreshIntervalSeconds * 1000;
        
        const timeout = setTimeout(async () => {
            if (!isActiveRef.current.get(tableId)) {
                return;
            }

            // Read latest table from ref (not stale closure)
            const currentTable = getLatestTable(tableId);
            if (!currentTable) {
                isActiveRef.current.set(tableId, false);
                return;
            }

            await performRefresh(currentTable);
            
            scheduleNextRefresh(tableId);
        }, intervalMs);

        timeoutRefs.current.set(tableId, timeout);
    }, [getLatestTable, performRefresh]);

    /**
     * Set up refresh intervals for tables with auto-refresh enabled.
     *
     * This effect depends on `refreshConfigs` (a memoized projection of tables
     * that only contains refresh-relevant fields) — so it does NOT re-run when
     * only table rows change. Timer churn is eliminated.
     */
    useEffect(() => {
        // Clear all existing timeouts
        timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
        timeoutRefs.current.clear();
        isActiveRef.current.clear();

        // Set up new refresh schedules
        refreshConfigs.forEach((config) => {
            // Skip derived tables — they are refreshed by useDerivedTableRefresh
            // when their source tables change, not by polling an external source.
            const shouldAutoRefresh = config.autoRefresh && 
                config.refreshIntervalSeconds && 
                config.refreshIntervalSeconds > 0 &&
                !config.hasDerive;

            if (shouldAutoRefresh) {
                const intervalMs = config.refreshIntervalSeconds! * 1000;
                const isNewTable = !initializedTablesRef.current.has(config.id);
                
                console.log(`[DataRefresh] Setting up auto-refresh for "${config.id}" every ${config.refreshIntervalSeconds}s (new=${isNewTable})`);
                
                isActiveRef.current.set(config.id, true);
                initializedTablesRef.current.add(config.id);
                
                if (isNewTable) {
                    console.log(`[DataRefresh] Triggering immediate first refresh for newly loaded table "${config.id}"`);
                    (async () => {
                        if (!isActiveRef.current.get(config.id)) {
                            return;
                        }
                        const table = getLatestTable(config.id);
                        if (table) {
                            await performRefresh(table);
                        }
                        scheduleNextRefresh(config.id);
                    })();
                } else {
                    const initialTimeout = setTimeout(async () => {
                        if (!isActiveRef.current.get(config.id)) {
                            return;
                        }
                        const table = getLatestTable(config.id);
                        if (table) {
                            await performRefresh(table);
                        }
                        scheduleNextRefresh(config.id);
                    }, intervalMs);

                    timeoutRefs.current.set(config.id, initialTimeout);
                }
            }
        });

        // Clean up tables that no longer exist from the initialized set
        const currentTableIds = new Set(refreshConfigs.map(c => c.id));
        initializedTablesRef.current.forEach(tableId => {
            if (!currentTableIds.has(tableId)) {
                initializedTablesRef.current.delete(tableId);
            }
        });

        return () => {
            timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
            timeoutRefs.current.clear();
            isActiveRef.current.clear();
        };
    }, [refreshConfigs, performRefresh, scheduleNextRefresh, getLatestTable]);

    /**
     * Manual refresh function that can be called from components
     */
    const manualRefresh = useCallback(async (tableId: string) => {
        const table = getLatestTable(tableId);
        if (table) {
            await performRefresh(table);
        }
    }, [getLatestTable, performRefresh]);

    /**
     * Get refresh info for a table
     */
    const getRefreshInfo = useCallback((tableId: string) => {
        const table = getLatestTable(tableId);
        if (!table) return null;

        const source = table.source;
        const canRefresh = (source?.type === 'stream' && !!source.url) || 
                          (source?.type === 'database' && source.canRefresh === true);
        return {
            canRefresh,
            autoRefreshEnabled: source?.autoRefresh ?? false,
            refreshIntervalSeconds: source?.refreshIntervalSeconds,
            lastRefreshed: source?.lastRefreshed,
            sourceType: source?.type
        };
    }, [getLatestTable]);

    return {
        manualRefresh,
        getRefreshInfo
    };
}

/**
 * Hook to handle refreshing derived tables when their source tables change.
 * This should be used in conjunction with useDataRefresh.
 *
 * Key performance optimisation: all derived table refreshes triggered by a
 * single source-table change are fetched in parallel and then dispatched as
 * a **single** `updateMultipleTableRows` action — collapsing N state updates
 * (and N full-app re-renders) into one.
 */
export function useDerivedTableRefresh() {
    const dispatch = useDispatch<AppDispatch>();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const prevTableRowsRef = useRef<Map<string, string>>(new Map());
    const refreshInProgressRef = useRef<boolean>(false);

    /**
     * Refresh a SQL view (virtual table) by re-sampling from DuckDB.
     * Returns the result rather than dispatching directly.
     */
    const refreshSqlView = useCallback(async (derivedTable: DictTable): Promise<{tableId: string, rows: any[]} | null> => {
        if (!derivedTable.virtual?.tableId) return null;

        const tableName = derivedTable.virtual.tableId;
        console.log(`[DerivedRefresh] Re-sampling SQL view "${tableName}" (DuckDB auto-updated)...`);

        try {
            const { data } = await apiRequest<{ rows: any[] }>(getUrls().SAMPLE_TABLE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    table: tableName,
                    size: Math.max(derivedTable.rows.length, 1000)
                })
            });

            if (data.rows) {
                console.log(`[DerivedRefresh] Successfully re-sampled SQL view "${tableName}" (${data.rows.length} rows)`);
                return { tableId: derivedTable.id, rows: data.rows };
            }
            return null;
        } catch (error) {
            console.error(`[DerivedRefresh] Error re-sampling SQL view ${tableName}:`, error);
            return null;
        }
    }, []);

    /**
     * Refresh a single derived table. Returns the result for batching.
     */
    const refreshOneDerivedTable = useCallback(async (
        derivedTable: DictTable,
        allTables: DictTable[]
    ): Promise<{tableId: string, rows: any[]} | null> => {
        if (!derivedTable.derive) return null;

        try {
            // SQL views — DuckDB auto-updates; just re-sample
            if (derivedTable.virtual?.tableId && !derivedTable.derive?.code) {
                console.log(`[DerivedRefresh] Table "${derivedTable.id}" is an SQL view - DuckDB auto-updates it`);
                return await refreshSqlView(derivedTable);
            }

            // Python-derived tables — re-run the transformation code
            const { source: sourceTableIds, code, codeSignature } = derivedTable.derive;

            // Security: refuse to send code without a valid server signature
            if (!codeSignature) {
                console.warn(`[DerivedRefresh] Table "${derivedTable.id}" has no code signature — skipping refresh (code may predate signing)`);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'Data Refresh',
                    type: 'warning',
                    value: `Cannot refresh "${derivedTable.displayId || derivedTable.id}": missing code signature. Re-derive the table to obtain a signed version.`
                }));
                return null;
            }

            console.log(`[DerivedRefresh] Looking for source tables: ${sourceTableIds.join(', ')}`);
            
            const inputTables: {name: string, rows: any[]}[] = [];
            for (const sourceId of sourceTableIds) {
                const sourceTable = allTables.find(t => t.id === sourceId);
                if (!sourceTable) {
                    console.warn(`[DerivedRefresh] Source table not found: ${sourceId}`);
                    continue;
                }
                const tableName = sourceTable.virtual?.tableId || sourceTable.id.replace(/\.[^/.]+$/, "");
                inputTables.push({ name: tableName, rows: sourceTable.rows });
            }

            if (inputTables.length !== sourceTableIds.length) {
                console.error(`[DerivedRefresh] Missing source tables for: ${derivedTable.id} (got ${inputTables.length}/${sourceTableIds.length})`);
                return null;
            }

            console.log(`[DerivedRefresh] Calling server to refresh "${derivedTable.id}" with ${inputTables.length} input tables, code length: ${code.length}`);

            const requestBody: any = {
                input_tables: inputTables,
                code: code,
                code_signature: codeSignature, // HMAC proof that server generated this code
                output_variable: derivedTable.derive?.outputVariable || 'result_df',
                virtual: !!derivedTable.virtual?.tableId,
                output_table_name: derivedTable.virtual?.tableId
            };
            
            const { data } = await apiRequest<{ rows?: any[]; message?: string }>(getUrls().REFRESH_DERIVED_DATA, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (data.rows) {
                console.log(`[DerivedRefresh] Successfully refreshed "${derivedTable.id}" with ${data.rows.length} rows`);
                return { tableId: derivedTable.id, rows: data.rows };
            } else {
                console.error(`[DerivedRefresh] Failed to refresh "${derivedTable.id}": ${data.message}`);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'Data Refresh',
                    type: 'warning',
                    value: `Failed to refresh "${derivedTable.displayId || derivedTable.id}": ${data.message}`
                }));
                return null;
            }
        } catch (error) {
            console.error(`[DerivedRefresh] Error refreshing derived table ${derivedTable.id}:`, error);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'Data Refresh',
                type: 'error',
                value: `Error refreshing "${derivedTable.displayId || derivedTable.id}": ${error instanceof Error ? error.message : 'Unknown error'}`
            }));
            return null;
        }
    }, [dispatch, refreshSqlView]);

    /**
     * Check for table changes and refresh dependent derived tables.
     * All refreshes are fetched in parallel, then committed as a single batch dispatch.
     */
    useEffect(() => {
        console.log(`[DerivedRefresh] useEffect triggered, ${tables.length} tables in state`);
        
        // Build a map of content hashes for source tables only (non-derived tables)
        const currentHashMap = new Map<string, string>();
        tables.forEach(table => {
            if (!table.derive) {
                const hash = table.contentHash || computeContentHash(table.rows, table.names);
                currentHashMap.set(table.id, hash);
            }
        });

        // Check which source tables have changed
        const changedTableIds: string[] = [];
        currentHashMap.forEach((hash, tableId) => {
            const prevHash = prevTableRowsRef.current.get(tableId);
            if (prevHash && prevHash !== hash) {
                changedTableIds.push(tableId);
                console.log(`[DerivedRefresh] Detected change in source table "${tableId}" (hash: ${prevHash.slice(0, 8)} -> ${hash.slice(0, 8)})`);
            }
        });

        if (prevTableRowsRef.current.size === 0 && tables.length > 0) {
            const sourceTableCount = tables.filter(t => !t.derive).length;
            console.log(`[DerivedRefresh] First run, initializing content hashes for ${sourceTableCount} source tables`);
        }

        // If any source tables changed, find and refresh all dependent derived tables in parallel
        if (changedTableIds.length > 0 && !refreshInProgressRef.current) {
            console.log(`[DerivedRefresh] Source tables changed: ${changedTableIds.join(', ')}`);
            
            const directlyDependentTables: DictTable[] = [];
            tables.forEach(table => {
                if (table.derive) {
                    const dependsOnChanged = table.derive.source.some(
                        sourceId => changedTableIds.includes(sourceId)
                    );
                    console.log(`[DerivedRefresh] Checking derived table "${table.id}": dependsOnChanged=${dependsOnChanged}, sources=[${table.derive.source.join(', ')}]`);
                    if (dependsOnChanged) {
                        directlyDependentTables.push(table);
                    }
                }
            });

            if (directlyDependentTables.length > 0) {
                console.log(`[DerivedRefresh] Will refresh ${directlyDependentTables.length} directly dependent tables in parallel: ${directlyDependentTables.map(t => t.id).join(', ')}`);
                
                refreshInProgressRef.current = true;

                // Fire all refreshes in parallel, then batch the results into ONE dispatch
                Promise.all(
                    directlyDependentTables.map(dt => refreshOneDerivedTable(dt, tables))
                ).then(results => {
                    const successfulUpdates = results.filter((r): r is {tableId: string, rows: any[]} => r !== null);
                    
                    if (successfulUpdates.length > 0) {
                        // Single dispatch for ALL derived table updates
                        dispatch(dfActions.updateMultipleTableRows(successfulUpdates));
                        
                        // One summary message instead of N individual messages
                        const names = successfulUpdates.map(u => {
                            const t = tables.find(t => t.id === u.tableId);
                            return `"${t?.displayId || u.tableId}" (${u.rows.length} rows)`;
                        });
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(),
                            component: 'Data Refresh',
                            type: 'info',
                            value: `Refreshed ${successfulUpdates.length} derived table(s): ${names.join(', ')}`
                        }));
                    }
                }).finally(() => {
                    refreshInProgressRef.current = false;
                });
            } else {
                console.log(`[DerivedRefresh] No derived tables need refreshing`);
            }
        }

        // Update the previous hashes reference (only source tables)
        prevTableRowsRef.current = currentHashMap;
    }, [tables, refreshOneDerivedTable, dispatch]);
}
