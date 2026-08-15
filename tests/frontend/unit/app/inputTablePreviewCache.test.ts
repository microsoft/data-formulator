import { afterEach, describe, expect, it } from 'vitest';

import {
    clearInputTablePreviewCache,
    getInputTablePreview,
    INPUT_TABLE_PREVIEW_ROW_LIMIT,
    invalidateInputTablePreview,
    setInputTablePreview,
} from '../../../../src/app/inputTablePreviewCache';

const inputTable = {
    kind: 'input-table' as const,
    id: 'orders',
    displayId: 'Orders',
    source: { kind: 'workspace' as const, tableId: 'orders_workspace' },
    snapshot: { columns: [], rowCount: 100, capturedAt: 10, contentHash: 'v1' },
    description: '',
    addedAt: 1,
};

describe('input table preview cache', () => {
    afterEach(clearInputTablePreviewCache);

    it('bounds rows and invalidates stale content versions', () => {
        const rows = Array.from({ length: INPUT_TABLE_PREVIEW_ROW_LIMIT + 2 }, (_, index) => ({ index }));
        setInputTablePreview(inputTable, rows, 20);

        expect(getInputTablePreview(inputTable)).toEqual({
            tableId: 'orders',
            rows: rows.slice(0, INPUT_TABLE_PREVIEW_ROW_LIMIT),
            fetchedAt: 20,
            contentHash: 'v1',
        });

        expect(getInputTablePreview({
            ...inputTable,
            snapshot: { ...inputTable.snapshot, contentHash: 'v2' },
        })).toBeUndefined();

        invalidateInputTablePreview(inputTable.id);
        expect(getInputTablePreview(inputTable)).toBeUndefined();
    });
});