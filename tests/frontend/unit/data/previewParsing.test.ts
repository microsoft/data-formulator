import { describe, expect, it } from 'vitest';

import {
    createTableFromText,
    loadTextDataWrapper,
} from '../../../../src/data/utils';

describe('bounded file preview parsing', () => {
    it('caps CSV preview rows without changing full parsing', () => {
        const text = [
            'id,value',
            ...Array.from({ length: 50 }, (_, index) => `${index},value-${index}`),
        ].join('\n');

        expect(createTableFromText('preview', text, 20)?.rows).toHaveLength(20);
        expect(createTableFromText('full', text)?.rows).toHaveLength(50);
    });

    it('caps JSON preview rows without changing full parsing', () => {
        const text = JSON.stringify(
            Array.from({ length: 50 }, (_, index) => ({ id: index, value: `value-${index}` })),
        );

        expect(loadTextDataWrapper('preview', text, 'application/json', 20)?.rows).toHaveLength(20);
        expect(loadTextDataWrapper('full', text, 'application/json')?.rows).toHaveLength(50);
    });
});
