// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions } from './dfSlice';
import { AppDispatch } from './store';
import { DictTable } from '../components/ComponentType';
import { createTableFromText } from '../data/utils';
import { fetchWithIdentity, getUrls, computeContentHash } from './utils';

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
 */
export function useDataRefresh() {
    const dispatch = useDispatch<AppDispatch>();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());
    const refreshInProgressRef = useRef<Map<string, boolean>>(new Map());
    const isActiveRef = useRef<Map<string, boolean>>(new Map());
    const initializedTablesRef = useRef<Set<string>>(new Set()); // Track tables that have been initialized

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
     * Backend stores connection info and knows how to refresh - frontend just triggers it.
     * Backend returns data_changed flag - if false, skip resampling to avoid unnecessary work.
     * DuckDB views that depend on this table will auto-recalculate only if data changed.
     */
    const refreshDatabaseTable = useCallback(async (table: DictTable): Promise<RefreshResult> => {
        if (!table.virtual?.tableId) {
            return { tableId: table.id, success: false, message: 'Not a virtual table' };
        }

        const tableName = table.virtual.tableId;

        try {
            // Tell backend to refresh the table - it has the connection info stored
            console.log(`[DataRefresh] Requesting backend to refresh "${tableName}" from external source...`);
            
            const refreshResponse = await fetchWithIdentity(getUrls().DATA_LOADER_REFRESH_TABLE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ table_name: tableName })
            });

            const refreshData = await refreshResponse.json();
            
            if (refreshData.status !== 'success') {
                // Backend doesn't have connection info for this table
                console.log(`[DataRefresh] Cannot refresh "${tableName}": ${refreshData.message}`);
                return {
                    tableId: table.id,
                    success: false,
                    message: refreshData.message || 'No connection info stored for this table'
                };
            }
            
            console.log(`[DataRefresh] Backend refreshed "${tableName}" (${refreshData.row_count} rows, data_changed=${refreshData.data_changed}, hash=${refreshData.content_hash?.slice(0, 8)})`);

            // If data hasn't changed, skip resampling - no need to update frontend
            if (!refreshData.data_changed) {
                console.log(`[DataRefresh] Data unchanged for "${tableName}", skipping resample`);
                return {
                    tableId: table.id,
                    success: true,
                    message: `Data unchanged (${refreshData.row_count} rows)`,
                    // Don't include newRows - signals no update needed
                };
            }

            // Data changed - get a fresh sample for the frontend
            const sampleResponse = await fetchWithIdentity(getUrls().SAMPLE_TABLE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    table: tableName,
                    size: Math.min(table.rows.length, 10000)
                })
            });

            const sampleData = await sampleResponse.json();
            if (sampleData.status === 'success') {
                return {
                    tableId: table.id,
                    success: true,
                    message: `Refreshed from source (${refreshData.row_count} rows)`,
                    newRows: sampleData.rows,
                    contentHash: refreshData.content_hash
                };
            } else {
                return {
                    tableId: table.id,
                    success: false,
                    message: sampleData.error || 'Failed to sample refreshed table'
                };
            }
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
        const table = tables.find(t => t.id === tableId);
        if (!table) {
            // Table no longer exists, stop scheduling
            isActiveRef.current.set(tableId, false);
            return;
        }

        const source = table.source;
        if (!source?.autoRefresh || !source.refreshIntervalSeconds || source.refreshIntervalSeconds <= 0) {
            // Auto-refresh disabled or invalid interval, stop scheduling
            isActiveRef.current.set(tableId, false);
            return;
        }

        // Check if this table is still active (hasn't been removed or disabled)
        if (!isActiveRef.current.get(tableId)) {
            return;
        }

        const intervalMs = source.refreshIntervalSeconds * 1000;
        
        // Schedule the next refresh
        const timeout = setTimeout(async () => {
            // Check again if still active before performing refresh
            if (!isActiveRef.current.get(tableId)) {
                return;
            }

            // Look up table again to get latest state
            const currentTable = tables.find(t => t.id === tableId);
            if (!currentTable) {
                isActiveRef.current.set(tableId, false);
                return;
            }

            // Perform refresh and wait for it to complete
            await performRefresh(currentTable);
            
            // Schedule the next refresh after this one completes
            scheduleNextRefresh(tableId);
        }, intervalMs);

        timeoutRefs.current.set(tableId, timeout);
    }, [tables, performRefresh]);

    /**
     * Set up refresh intervals for tables with auto-refresh enabled.
     * Uses recursive setTimeout pattern to ensure updates wait until complete.
     * Triggers immediate refresh for newly loaded tables.
     */
    useEffect(() => {
        // Clear all existing timeouts
        timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
        timeoutRefs.current.clear();
        isActiveRef.current.clear();

        // Set up new refresh schedules for tables with auto-refresh
        tables.forEach((table) => {
            const source = table.source;
            
            // Check if auto-refresh is enabled
            const shouldAutoRefresh = source?.autoRefresh && 
                source.refreshIntervalSeconds && 
                source.refreshIntervalSeconds > 0;

            if (shouldAutoRefresh) {
                const intervalMs = source.refreshIntervalSeconds! * 1000;
                const isNewTable = !initializedTablesRef.current.has(table.id);
                
                console.log(`[DataRefresh] Setting up auto-refresh for "${table.id}" every ${source.refreshIntervalSeconds}s (new=${isNewTable})`);
                
                // Mark as active and initialized
                isActiveRef.current.set(table.id, true);
                initializedTablesRef.current.add(table.id);
                
                if (isNewTable) {
                    // For newly loaded tables, trigger immediate refresh then schedule next
                    console.log(`[DataRefresh] Triggering immediate first refresh for newly loaded table "${table.id}"`);
                    (async () => {
                        if (!isActiveRef.current.get(table.id)) {
                            return;
                        }
                        await performRefresh(table);
                        scheduleNextRefresh(table.id);
                    })();
                } else {
                    // For existing tables, continue with normal interval
                    const initialTimeout = setTimeout(async () => {
                        if (!isActiveRef.current.get(table.id)) {
                            return;
                        }
                        await performRefresh(table);
                        scheduleNextRefresh(table.id);
                    }, intervalMs);

                    timeoutRefs.current.set(table.id, initialTimeout);
                }
            }
        });

        // Clean up tables that no longer exist from the initialized set
        const currentTableIds = new Set(tables.map(t => t.id));
        initializedTablesRef.current.forEach(tableId => {
            if (!currentTableIds.has(tableId)) {
                initializedTablesRef.current.delete(tableId);
            }
        });

        // Cleanup on unmount or when tables change
        return () => {
            timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
            timeoutRefs.current.clear();
            isActiveRef.current.clear();
        };
    }, [tables, performRefresh, scheduleNextRefresh]);

    /**
     * Manual refresh function that can be called from components
     */
    const manualRefresh = useCallback(async (tableId: string) => {
        const table = tables.find(t => t.id === tableId);
        if (table) {
            await performRefresh(table);
        }
    }, [tables, performRefresh]);

    /**
     * Get refresh info for a table
     */
    const getRefreshInfo = useCallback((tableId: string) => {
        const table = tables.find(t => t.id === tableId);
        if (!table) return null;

        const source = table.source;
        // Can refresh if: stream with URL, or database table with backend connection info
        const canRefresh = (source?.type === 'stream' && !!source.url) || 
                          (source?.type === 'database' && source.canRefresh === true);
        return {
            canRefresh,
            autoRefreshEnabled: source?.autoRefresh ?? false,
            refreshIntervalSeconds: source?.refreshIntervalSeconds,
            lastRefreshed: source?.lastRefreshed,
            sourceType: source?.type
        };
    }, [tables]);

    return {
        manualRefresh,
        getRefreshInfo
    };
}

/**
 * Hook to handle refreshing derived tables when their source tables change.
 * This should be used in conjunction with useDataRefresh.
 */
export function useDerivedTableRefresh() {
    const dispatch = useDispatch<AppDispatch>();
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const prevTableRowsRef = useRef<Map<string, string>>(new Map());
    const refreshInProgressRef = useRef<Set<string>>(new Set());

    /**
     * Refresh a SQL view (virtual table) by re-sampling from DuckDB.
     * DuckDB views auto-update when base tables change, so we just need fresh data.
     */
    const refreshSqlView = useCallback(async (derivedTable: DictTable): Promise<boolean> => {
        if (!derivedTable.virtual?.tableId) return false;

        const tableName = derivedTable.virtual.tableId;
        console.log(`[DerivedRefresh] Re-sampling SQL view "${tableName}" (DuckDB auto-updated)...`);

        try {
            const response = await fetchWithIdentity(getUrls().SAMPLE_TABLE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    table: tableName,
                    size: Math.max(derivedTable.rows.length, 1000)
                })
            });

            const data = await response.json();
            if (data.status === 'success' && data.rows) {
                console.log(`[DerivedRefresh] Successfully re-sampled SQL view "${tableName}" (${data.rows.length} rows)`);
                
                dispatch(dfActions.updateTableRows({
                    tableId: derivedTable.id,
                    rows: data.rows
                }));

                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'Data Refresh',
                    type: 'info',
                    value: `View "${derivedTable.displayId || derivedTable.id}" refreshed (${data.rows.length} rows)`
                }));
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[DerivedRefresh] Error re-sampling SQL view ${tableName}:`, error);
            return false;
        }
    }, [dispatch]);

    /**
     * Refresh a derived table by re-running its derivation code (Python)
     * or re-sampling if it's an SQL view.
     */
    const refreshDerivedTable = useCallback(async (derivedTable: DictTable, allTables: DictTable[]) => {
        if (!derivedTable.derive) return;
        
        // Prevent concurrent refreshes of the same table
        if (refreshInProgressRef.current.has(derivedTable.id)) {
            console.log(`[DerivedRefresh] Refresh already in progress for: ${derivedTable.id}`);
            return;
        }
        
        refreshInProgressRef.current.add(derivedTable.id);

        try {
            // For SQL views (virtual tables without Python derive code), DuckDB auto-updates the view
            // We just need to re-sample to get the updated data
            if (derivedTable.virtual?.tableId && !derivedTable.derive?.code) {
                console.log(`[DerivedRefresh] Table "${derivedTable.id}" is an SQL view - DuckDB auto-updates it`);
                await refreshSqlView(derivedTable);
                return;
            }

            // For Python-derived tables, we need to re-run the transformation code
            const { source: sourceTableIds, code } = derivedTable.derive;

            console.log(`[DerivedRefresh] Looking for source tables: ${sourceTableIds.join(', ')}`);
            console.log(`[DerivedRefresh] Available tables: ${allTables.map(t => t.id).join(', ')}`);
            
            // Get the actual source table data
            const inputTables: {name: string, rows: any[]}[] = [];
            for (const sourceId of sourceTableIds) {
                const sourceTable = allTables.find(t => t.id === sourceId);
                if (!sourceTable) {
                    console.warn(`[DerivedRefresh] Source table not found: ${sourceId}`);
                    continue;
                }
                const tableName = sourceTable.virtual?.tableId || sourceTable.id.replace(/\.[^/.]+$/, "");
                console.log(`[DerivedRefresh] Found source table "${sourceId}" -> "${tableName}" with ${sourceTable.rows.length} rows`);
                inputTables.push({
                    name: tableName,
                    rows: sourceTable.rows
                });
            }

            if (inputTables.length !== sourceTableIds.length) {
                console.error(`[DerivedRefresh] Missing source tables for: ${derivedTable.id} (got ${inputTables.length}/${sourceTableIds.length})`);
                return;
            }

            console.log(`[DerivedRefresh] Calling server to refresh "${derivedTable.id}" with ${inputTables.length} input tables, code length: ${code.length}`);

            // Call the server to re-run the derivation
            const requestBody: any = {
                input_tables: inputTables,
                code: code,
                output_variable: derivedTable.derive?.outputVariable || 'result_df',
                virtual: !!derivedTable.virtual?.tableId,
                output_table_name: derivedTable.virtual?.tableId
            };
            
            const response = await fetchWithIdentity(getUrls().REFRESH_DERIVED_DATA, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            
            if (data.status === 'ok' && data.rows) {
                console.log(`[DerivedRefresh] Successfully refreshed "${derivedTable.id}" with ${data.rows.length} rows`);
                
                dispatch(dfActions.updateTableRows({
                    tableId: derivedTable.id,
                    rows: data.rows
                }));

                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'Data Refresh',
                    type: 'info',
                    value: `Derived table "${derivedTable.displayId || derivedTable.id}" refreshed (${data.rows.length} rows)`
                }));
            } else {
                console.error(`[DerivedRefresh] Failed to refresh "${derivedTable.id}": ${data.message}`);
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(),
                    component: 'Data Refresh',
                    type: 'warning',
                    value: `Failed to refresh "${derivedTable.displayId || derivedTable.id}": ${data.message}`
                }));
            }
        } catch (error) {
            console.error(`[DerivedRefresh] Error refreshing derived table ${derivedTable.id}:`, error);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                component: 'Data Refresh',
                type: 'error',
                value: `Error refreshing "${derivedTable.displayId || derivedTable.id}": ${error instanceof Error ? error.message : 'Unknown error'}`
            }));
        } finally {
            refreshInProgressRef.current.delete(derivedTable.id);
        }
    }, [dispatch, refreshSqlView]);

    /**
     * Check for table changes and refresh dependent derived tables.
     * Uses content hashes for source tables only - derived tables don't need hashing
     * since their changes are driven by source table changes.
     */
    useEffect(() => {
        console.log(`[DerivedRefresh] useEffect triggered, ${tables.length} tables in state`);
        
        // Build a map of content hashes for source tables only (non-derived tables)
        const currentHashMap = new Map<string, string>();
        tables.forEach(table => {
            // Only track hashes for source tables (non-derived)
            if (!table.derive) {
                // Use stored contentHash if available, otherwise compute it
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

        // Log if no previous hashes (first run)
        if (prevTableRowsRef.current.size === 0 && tables.length > 0) {
            const sourceTableCount = tables.filter(t => !t.derive).length;
            console.log(`[DerivedRefresh] First run, initializing content hashes for ${sourceTableCount} source tables`);
        }

        // If any source tables changed, find and refresh derived tables that depend on them
        if (changedTableIds.length > 0) {
            console.log(`[DerivedRefresh] Source tables changed: ${changedTableIds.join(', ')}`);
            
            // Find derived tables that DIRECTLY depend on the changed tables
            const directlyDependentTables: DictTable[] = [];
            
            tables.forEach(table => {
                if (table.derive) {
                    // Check if this table directly depends on any changed table
                    const dependsOnChanged = table.derive.source.some(
                        sourceId => changedTableIds.includes(sourceId)
                    );
                    
                    const inProgress = refreshInProgressRef.current.has(table.id);
                    
                    console.log(`[DerivedRefresh] Checking derived table "${table.id}": dependsOnChanged=${dependsOnChanged}, inProgress=${inProgress}, sources=[${table.derive.source.join(', ')}]`);
                    
                    // Only refresh if:
                    // 1. It depends on a changed source table
                    // 2. It's not already being refreshed
                    if (dependsOnChanged && !inProgress) {
                        directlyDependentTables.push(table);
                    }
                }
            });

            if (directlyDependentTables.length > 0) {
                console.log(`[DerivedRefresh] Will refresh ${directlyDependentTables.length} directly dependent tables: ${directlyDependentTables.map(t => t.id).join(', ')}`);
                
                // Refresh each directly dependent table
                directlyDependentTables.forEach(derivedTable => {
                    refreshDerivedTable(derivedTable, tables);
                });
            } else {
                console.log(`[DerivedRefresh] No derived tables need refreshing`);
            }
        }

        // Update the previous hashes reference (only source tables)
        prevTableRowsRef.current = currentHashMap;
    }, [tables, refreshDerivedTable]);
}
