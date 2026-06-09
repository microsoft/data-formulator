import { describe, expect, it } from 'vitest';
import { makeSortAction } from '../../../../../src/lib/agents-chart';
import { assembleVegaLite } from '../../../../../src/lib/agents-chart';

const baseCanvas = { width: 400, height: 300 };

describe('makeSortAction (Sort encoding action)', () => {
  const action = makeSortAction();

  describe('get — derive control value from base encodings', () => {
    it('returns undefined (Default) when no sort is set', () => {
      const enc = { x: { field: 'cat', type: 'nominal' as const }, y: { field: 'val', aggregate: 'sum' as const } };
      expect(action.get(enc)).toBeUndefined();
    });

    it('reads value sort from sortBy referencing the measure channel', () => {
      const enc = {
        x: { field: 'cat', type: 'nominal' as const, sortBy: 'y', sortOrder: 'descending' as const },
        y: { field: 'val', aggregate: 'sum' as const },
      };
      expect(action.get(enc)).toBe('value-desc');
    });

    it('treats a bare label sort (sortOrder, no sortBy) as Default', () => {
      const enc = {
        x: { field: 'cat', type: 'nominal' as const, sortOrder: 'ascending' as const },
        y: { field: 'val', aggregate: 'sum' as const },
      };
      expect(action.get(enc)).toBeUndefined();
    });

    it('treats unrepresentable sorts (custom order / by-color) as Default', () => {
      const enc = {
        x: { field: 'cat', type: 'nominal' as const, sortBy: '["B","A"]' },
        y: { field: 'val', aggregate: 'sum' as const },
      };
      expect(action.get(enc)).toBeUndefined();
    });

    it('detects a horizontal orientation (measure on x, category on y)', () => {
      const enc = {
        x: { field: 'val', aggregate: 'sum' as const },
        y: { field: 'cat', type: 'nominal' as const, sortBy: 'x', sortOrder: 'ascending' as const },
      };
      expect(action.get(enc)).toBe('value-asc');
    });

    it('returns undefined when the category axis is temporal (not sortable)', () => {
      const enc = {
        x: { field: 'month', type: 'temporal' as const },
        y: { field: 'val', type: 'quantitative' as const, aggregate: 'sum' as const },
      };
      expect(action.get(enc)).toBeUndefined();
    });

    it('returns undefined when both axes are quantitative (scatter)', () => {
      const enc = {
        x: { field: 'a', type: 'quantitative' as const },
        y: { field: 'b', type: 'quantitative' as const },
      };
      expect(action.get(enc)).toBeUndefined();
    });
  });

  describe('isApplicable — type-aware visibility gate', () => {
    it('is applicable when a discrete category + measure pair exists', () => {
      const enc = { x: { field: 'cat', type: 'nominal' as const }, y: { field: 'val', aggregate: 'sum' as const } };
      expect(action.isApplicable?.({ encodings: enc })).toBe(true);
    });

    it('is not applicable for a temporal-x time series', () => {
      const enc = {
        x: { field: 'month', type: 'temporal' as const },
        y: { field: 'val', type: 'quantitative' as const, aggregate: 'sum' as const },
      };
      expect(action.isApplicable?.({ encodings: enc })).toBe(false);
    });

    it('is not applicable when no measure axis exists', () => {
      const enc = { x: { field: 'cat', type: 'nominal' as const }, y: { field: 'cat2', type: 'nominal' as const } };
      expect(action.isApplicable?.({ encodings: enc })).toBe(false);
    });
  });

  describe('set — compose the override onto the category channel', () => {
    const enc = { x: { field: 'cat', type: 'nominal' as const }, y: { field: 'val', aggregate: 'sum' as const } };

    it('value-desc writes sortBy=measure + descending on the category channel', () => {
      const next = action.set(enc, 'value-desc');
      expect(next.x.sortBy).toBe('y');
      expect(next.x.sortOrder).toBe('descending');
    });

    it('Default (undefined) clears both sort fields', () => {
      const sorted = action.set(enc, 'value-desc');
      const cleared = action.set(sorted, undefined);
      expect(cleared.x.sortBy).toBeUndefined();
      expect(cleared.x.sortOrder).toBeUndefined();
    });

    it('does not mutate the input encodings', () => {
      action.set(enc, 'value-desc');
      expect(enc.x).not.toHaveProperty('sortBy');
    });

    it('targets the category channel under horizontal orientation', () => {
      const horizontal = { x: { field: 'val', aggregate: 'sum' as const }, y: { field: 'cat', type: 'nominal' as const } };
      const next = action.set(horizontal, 'value-asc');
      expect(next.y.sortBy).toBe('x');
      expect(next.y.sortOrder).toBe('ascending');
      expect(next.x.sortBy).toBeUndefined();
    });

    it('is a no-op when there is no discrete category axis (temporal x)', () => {
      const temporal = {
        x: { field: 'month', type: 'temporal' as const },
        y: { field: 'val', type: 'quantitative' as const, aggregate: 'sum' as const },
      };
      const next = action.set(temporal, 'value-desc');
      expect(next).toBe(temporal);
    });
  });

  describe('end-to-end: override composed by the compiler', () => {
    const data = {
      values: [
        { category: 'A', value: 20 },
        { category: 'B', value: 50 },
        { category: 'C', value: 10 },
      ],
    };

    it('value-desc override sorts the bar x-axis by the measure', () => {
      const spec = assembleVegaLite({
        data,
        semantic_types: { category: 'Category', value: 'Quantity' },
        chart_spec: {
          chartType: 'Bar Chart',
          encodings: { x: { field: 'category' }, y: { field: 'value', aggregate: 'sum' } },
          chartProperties: { sort: 'value-desc' },
          canvasSize: baseCanvas,
        },
      });
      expect(spec.encoding.x.sort).toBe('-y');
    });

    it('no override leaves the template default ordering', () => {
      const spec = assembleVegaLite({
        data,
        semantic_types: { category: 'Category', value: 'Quantity' },
        chart_spec: {
          chartType: 'Bar Chart',
          encodings: { x: { field: 'category' }, y: { field: 'value', aggregate: 'sum' } },
          canvasSize: baseCanvas,
        },
      });
      expect(spec.encoding.x.sort).not.toBe('-y');
    });

    it('applies value-desc when the measure type is auto (resolved by the compiler)', () => {
      // The y measure has no explicit `type` and no aggregate — its
      // quantitative-ness is only known after semantic resolution. The
      // override must still compose (regression: previously no-op'd).
      const spec = assembleVegaLite({
        data: {
          values: [
            { category: 'A', value: 20 },
            { category: 'B', value: 50 },
            { category: 'C', value: 10 },
          ],
        },
        semantic_types: { category: 'Category', value: 'Quantity' },
        chart_spec: {
          chartType: 'Bar Chart',
          encodings: { x: { field: 'category' }, y: { field: 'value' } },
          chartProperties: { sort: 'value-desc' },
          canvasSize: baseCanvas,
        },
      });
      expect(spec.encoding.x.sort).toBe('-y');
    });

    it('value-desc overrides a field’s intrinsic ordinal ordering', () => {
      // Ordinal category with canonical levels would normally sort by those
      // levels; an explicit value sort must win over the intrinsic order.
      const spec = assembleVegaLite({
        data: {
          values: [
            { budget: 'Under $10M', pct: 65 },
            { budget: '$10M-$30M', pct: 62 },
            { budget: '$30M-$70M', pct: 64 },
            { budget: '$70M-$150M', pct: 76 },
            { budget: '$150M+', pct: 97 },
          ],
        },
        semantic_types: {
          budget: { semanticType: 'Category', sortOrder: ['Under $10M', '$10M-$30M', '$30M-$70M', '$70M-$150M', '$150M+'] },
          pct: 'Percentage',
        },
        chart_spec: {
          chartType: 'Bar Chart',
          encodings: { x: { field: 'budget', type: 'ordinal' }, y: { field: 'pct' } },
          chartProperties: { sort: 'value-desc' },
          canvasSize: baseCanvas,
        },
      });
      expect(spec.encoding.x.sort).toBe('-y');
    });
  });
});
