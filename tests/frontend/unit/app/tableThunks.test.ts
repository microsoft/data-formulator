/**
 * Tests for buildDictTableFromWorkspace — verifying column description
 * flows from the list-tables API response into DictTable.metadata.
 */
import { describe, it, expect } from 'vitest';
import { buildDictTableFromWorkspace } from '../../../../src/app/tableThunks';

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

    it('preserves column descriptions in metadata', () => {
        const result = buildDictTableFromWorkspace(baseTable, undefined);
        expect(result.metadata['order_id'].description).toBe('Primary key');
        expect(result.metadata['region'].description).toBe('Sales region');
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
