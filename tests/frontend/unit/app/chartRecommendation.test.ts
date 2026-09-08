import { describe, expect, it } from 'vitest';

import { resolveChartFields } from '../../../../src/app/chartRecommendation';
import type { Chart, DictTable, FieldItem } from '../../../../src/components/ComponentType';

describe('resolveChartFields', () => {
    it('resolves structured chart encoding objects from analyst output', () => {
        const chart = {
            encodingMap: {},
        } as Chart;
        const fields = [
            { id: 'genre-field', name: 'cdr_genre' },
            { id: 'rating-field', name: 'overall_rating' },
        ] as FieldItem[];

        resolveChartFields(chart, fields, {
            x: { field: 'cdr_genre', type: 'nominal' },
            y: {
                field: 'overall_rating',
                type: 'quantitative',
                aggregate: 'mean',
                sortOrder: 'descending',
                scheme: 'blues',
            },
        }, {} as DictTable);

        expect(chart.encodingMap.x).toEqual({ fieldID: 'genre-field', dtype: 'nominal' });
        expect(chart.encodingMap.y).toEqual({
            fieldID: 'rating-field',
            dtype: 'quantitative',
            aggregate: 'average',
            sortOrder: 'descending',
            scheme: 'blues',
        });
    });
});