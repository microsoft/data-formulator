/**
 * Tests for buildDictTableFromWorkspace — verifying column description
 * flows from the list-tables API response into DictTable.metadata.
 */
import { describe, it, expect } from 'vitest';
import {
    buildDictTableFromWorkspace,
    resolveDatabaseImportLimit,
} from '../../../../src/app/tableThunks';

describe('resolveDatabaseImportLimit', () => {
    it('does not treat an intentional query limit as safety truncation', () => {
        expect(resolveDatabaseImportLimit(500, 2_000_000)).toEqual({
            limit: 500,
            safetyCapApplied: false,
        });
    });

    it('applies the safety cap to unbounded and oversized imports', () => {
        expect(resolveDatabaseImportLimit(undefined, 2_000_000).safetyCapApplied).toBe(true);
        expect(resolveDatabaseImportLimit(3_000_000, 2_000_000)).toEqual({
            limit: 2_000_000,
            safetyCapApplied: true,
        });
    });
});

describe('buildDictTableFromWorkspace', () => {
    const baseTable = {
        name: 'orders',
        row_count: 100,
        columns: [
            { name: 'order_id', type: 'INTEGER', description: 'Primary key' },
            { name: 'status', type: 'VARCHAR' },
            { name: 'region', type: 'VARCHAR', description: 'Sales region' },
        ],
        sample_rows: [{ order_id: 1, status: 'active', region: 'US' }],
        source_type: 'data_loader',
    };

    it.each(['agent', 'user', undefined])('uses the table name as its generic display fallback (%s)', origin => {
        const result = buildDictTableFromWorkspace({ ...baseTable, origin, original_name: 'Weekly Orders' }, undefined);
        expect(result.displayId).toBe('orders');
        expect(result.id).toBe('orders');
        expect(result.virtual?.tableId).toBe('orders');
        expect(buildDictTableFromWorkspace({ ...baseTable, origin }, undefined).displayId).toBe('orders');
    });

    it('keeps an uploaded filename separate from the table display title', () => {
        const result = buildDictTableFromWorkspace({ ...baseTable, source_type: 'upload',
            source_filename: 'orders-export.xlsx', original_name: 'Weekly Orders' }, undefined);
        expect(result.displayId).toBe('orders');
        expect(result.source?.fileName).toBe('orders-export.xlsx');
        expect(result.virtual?.tableId).toBe('orders');
    });

    it('preserves exact connector import provenance alongside existing source settings', () => {
        const listing = { ...baseTable, source_metadata: { import_options: { data_operation: {
            source_id: 'kusto:trips', table_key: 'Trips',
        } } } };
        for (const source of [undefined, { type: 'database' as const, autoRefresh: true }]) {
            const result = buildDictTableFromWorkspace(listing, source);
            expect(result.source?.importedFrom).toEqual({ connectorId: 'kusto:trips', tableKey: 'Trips' });
            if (source) expect(result.source?.autoRefresh).toBe(true);
        }
        expect(buildDictTableFromWorkspace(baseTable, undefined).source?.importedFrom).toBeUndefined();
        const native = { ...baseTable, source_metadata: { import_options: { data_operation: {
            source_id: 'kusto:trips', table_key: 'Trips', lineage_verified: false,
        } } } };
        expect(buildDictTableFromWorkspace(native, { type: 'database', importedFrom: { connectorId: 'kusto:trips', tableKey: 'Trips' } }).source?.importedFrom).toBeUndefined();
    });

    it('uses durable workflow identity and clears it when an update changes provenance', () => {
        const source = { type: 'database' as const, autoRefresh: true,
            importedFrom: { connectorId: 'old-connector', tableKey: 'Old' } };
        const listing = { ...baseTable, origin: 'agent', imported_from: { source_id: 'adx:trips', table_key: 'Trips' } };
        expect(buildDictTableFromWorkspace(listing, source).source).toMatchObject({ autoRefresh: true,
            importedFrom: { connectorId: 'adx:trips', tableKey: 'Trips' } });
        for (const imported_from of [null, undefined, { source_id: '', table_key: 'Trips' }]) {
            expect(buildDictTableFromWorkspace({ ...listing, imported_from }, source).source?.importedFrom).toBeUndefined();
        }
        expect(source.importedFrom.connectorId).toBe('old-connector');
    });

    it('preserves column descriptions in metadata', () => {
        const result = buildDictTableFromWorkspace(baseTable, undefined);
        expect(result.metadata['order_id'].description).toBe('Primary key');
        expect(result.metadata['region'].description).toBe('Sales region');
    });

    it.each([
        { native: { language: 'kql', text: 'Trips | count' }, limit: 48 },
        { group_by: ['pickup_date'], aggregates: [{ op: 'count', as: 'pickups' }] },
    ])('preserves the recorded structured load query %j', query => {
        const result = buildDictTableFromWorkspace({ ...baseTable, source_metadata: {
            source_table_name: 'Trips', data_loader_params: { token: 'private' },
            import_options: { structured_query: query, data_operation: { operation_id: 'operation' } },
        } }, undefined);
        expect(result.source?.loadQuery).toEqual({ sourceTable: 'Trips', query });
        expect(JSON.stringify(result.source?.loadQuery)).not.toContain('private');
        expect(JSON.stringify(result.source?.loadQuery)).not.toContain('operation');
    });

    it('preserves import options only for recorded source loads', () => {
        const query = { source_filters: [{ column: 'region', operator: 'EQ', value: 'US' }],
            columns: ['region'], sort_columns: ['region'], sort_order: 'asc', size: 100 };
        const result = buildDictTableFromWorkspace({ ...baseTable, source_metadata: {
            source_table_name: 'orders', import_options: { ...query, credential: 'private' },
        } }, undefined);
        expect(result.source?.loadQuery).toEqual({ sourceTable: 'orders', query });
        expect(buildDictTableFromWorkspace({ ...baseTable, source_metadata: { import_options: {} } }, undefined).source?.loadQuery).toBeUndefined();
        expect(buildDictTableFromWorkspace(baseTable, undefined).source?.loadQuery).toBeUndefined();
    });

    it('omits description when not provided by backend', () => {
        const result = buildDictTableFromWorkspace(baseTable, undefined);
        expect(result.metadata['status'].description).toBeUndefined();
    });

    it('uses table-level loader description as DictTable.description', () => {
        const withDesc = { ...baseTable, description: 'Order fact table' };
        const result = buildDictTableFromWorkspace(withDesc, undefined);
        expect(result.description).toBe('Order fact table');
    });

    it('works with no descriptions at all', () => {
        const plain = {
            ...baseTable,
            columns: [
                { name: 'x', type: 'INTEGER' },
            ],
        };
        const result = buildDictTableFromWorkspace(plain, undefined);
        expect(result.metadata['x'].description).toBeUndefined();
        expect(result.names).toEqual(['x']);
    });
});
