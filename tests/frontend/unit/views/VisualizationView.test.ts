import { describe, expect, it } from 'vitest';

import { normalizeOperationPreview } from '../../../../src/views/VisualizationView';

describe('normalizeOperationPreview', () => {
    it('supplies empty arrays for a failed preview with missing table data', () => {
        expect(normalizeOperationPreview({
            display_name: 'Recent orders',
            source_id: 'warehouse',
            error: 'Warehouse unavailable',
        })).toEqual({
            display_name: 'Recent orders',
            source_id: 'warehouse',
            error: 'Warehouse unavailable',
            columns: [],
            rows: [],
        });
    });
});