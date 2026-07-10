import { describe, expect, it } from 'vitest';
import { formatFilterChipLabel } from '../../../../src/components/filterFormat';

describe('formatFilterChipLabel', () => {
    it('uses label-value language for equality and membership', () => {
        expect(formatFilterChipLabel('grade', 'EQ', 'regular')).toBe('Grade: regular');
        expect(formatFilterChipLabel('sales_region', 'IN', ['West', 'East']))
            .toBe('Sales region: West, East');
    });

    it('uses a compact range instead of query syntax', () => {
        expect(formatFilterChipLabel('date', 'BETWEEN', ['2005-08-01', '2025-08-01']))
            .toBe('Date: 2005-08-01 – 2025-08-01');
    });

    it('spells out operators whose meaning matters', () => {
        expect(formatFilterChipLabel('grade', 'NEQ', 'regular')).toBe('Grade is not regular');
        expect(formatFilterChipLabel('product_name', 'ILIKE', 'market')).toBe('Product name contains market');
        expect(formatFilterChipLabel('owner', 'IS_NULL')).toBe('Owner is empty');
    });

    it('keeps familiar comparison symbols', () => {
        expect(formatFilterChipLabel('price', 'GTE', 10)).toBe('Price ≥ 10');
    });
});
