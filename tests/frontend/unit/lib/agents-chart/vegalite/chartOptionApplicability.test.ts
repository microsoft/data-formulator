import { describe, expect, it } from 'vitest';
import { assembleVegaLite } from '../../../../../../src/lib/agents-chart';

const canvas = { width: 600, height: 400 };

/** Keys of options Flint reports as applicable for a rendered spec. */
const applicableKeys = (spec: any): string[] =>
  (spec._options ?? []).filter((o: any) => o.applicable).map((o: any) => o.key);
/** Whether a given option key is carried in the catalog at all. */
const hasOption = (spec: any, key: string): boolean =>
  (spec._options ?? []).some((o: any) => o.key === key);

describe('stackMode applicability (gated on a series/color channel)', () => {
  const rows = [
    { region: 'N', cat: 'a', val: 3 }, { region: 'N', cat: 'b', val: 5 },
    { region: 'S', cat: 'a', val: 2 }, { region: 'S', cat: 'b', val: 4 },
  ];

  it('is applicable when color (the series dimension) is bound', () => {
    const spec = assembleVegaLite({
      data: { values: rows },
      semantic_types: { region: 'Category', cat: 'Category', val: 'Quantity' },
      chart_spec: {
        chartType: 'Stacked Bar Chart',
        encodings: { x: { field: 'region' }, y: { field: 'val' }, color: { field: 'cat' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(applicableKeys(spec)).toContain('stackMode');
  });

  it('is NOT applicable without a color channel (nothing to stack)', () => {
    const spec = assembleVegaLite({
      data: { values: rows },
      semantic_types: { region: 'Category', val: 'Quantity' },
      chart_spec: {
        chartType: 'Stacked Bar Chart',
        encodings: { x: { field: 'region' }, y: { field: 'val' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(hasOption(spec, 'stackMode')).toBe(true);
    expect(applicableKeys(spec)).not.toContain('stackMode');
  });
});

describe('independentYAxis applicability (faceted + quantitative y)', () => {
  const facetRows = [
    { g: 'A', x: 'p', y: 1 }, { g: 'A', x: 'q', y: 2 },
    { g: 'B', x: 'p', y: 100 }, { g: 'B', x: 'q', y: 300 },
  ];

  it('is applicable when faceted with a quantitative y of diverging ranges', () => {
    const spec = assembleVegaLite({
      data: { values: facetRows },
      semantic_types: { g: 'Category', x: 'Category', y: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'x' }, y: { field: 'y' }, column: { field: 'g' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(applicableKeys(spec)).toContain('independentYAxis');
  });

  it('is NOT applicable when not faceted', () => {
    const spec = assembleVegaLite({
      data: { values: facetRows },
      semantic_types: { x: 'Category', y: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'x' }, y: { field: 'y' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(applicableKeys(spec)).not.toContain('independentYAxis');
  });
});

describe('showPercent applicability (additive, single-sign, non-zero total)', () => {
  function barTable(values: any[], semantic_types: any) {
    return assembleVegaLite({
      data: { values },
      semantic_types,
      chart_spec: {
        chartType: 'Bar Table',
        encodings: { y: { field: 'cat' }, x: { field: 'val' } },
        canvasSize: canvas,
      },
    }) as any;
  }

  it('is applicable for an additive single-sign measure with a non-zero total', () => {
    const spec = barTable(
      [{ cat: 'a', val: 10 }, { cat: 'b', val: 20 }, { cat: 'c', val: 30 }],
      { cat: 'Category', val: 'Quantity' },
    );
    expect(applicableKeys(spec)).toContain('showPercent');
  });

  it('is NOT applicable for a mixed-sign measure (share would be misleading)', () => {
    const spec = barTable(
      [{ cat: 'a', val: 10 }, { cat: 'b', val: -20 }, { cat: 'c', val: 5 }],
      { cat: 'Category', val: 'Number' },
    );
    expect(hasOption(spec, 'showPercent')).toBe(true);
    expect(applicableKeys(spec)).not.toContain('showPercent');
  });
});

describe('xAxisType applicability (date-like x with dual interpretation)', () => {
  // Year-month strings: the resolver classifies these as temporal, but the
  // modest distinct set is equally readable as discrete category labels.
  const monthRows = [
    { month: '2010-01', cost: 17.8 }, { month: '2011-04', cost: 20.1 },
    { month: '2012-06', cost: 19.0 }, { month: '2013-09', cost: 19.9 },
    { month: '2014-11', cost: 21.0 },
  ];

  function barWithX(values: any[], semantic_types: any, chartProperties?: any) {
    return assembleVegaLite({
      data: { values },
      semantic_types,
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'month' }, y: { field: 'cost' } },
        canvasSize: canvas,
        ...(chartProperties ? { chartProperties } : {}),
      },
    }) as any;
  }

  it('is applicable for a date-like temporal x with a modest distinct count', () => {
    const spec = barWithX(monthRows, { month: 'YearMonth', cost: 'Quantity' });
    expect(applicableKeys(spec)).toContain('xAxisType');
  });

  it('forces a discrete (nominal) x when the user picks "nominal"', () => {
    const spec = barWithX(
      monthRows, { month: 'YearMonth', cost: 'Quantity' }, { xAxisType: 'nominal' },
    );
    // Override flows through to the encoding type the whole pipeline sees.
    expect(spec.encoding?.x?.type).toBe('nominal');
    // The control stays visible after an explicit choice.
    expect(applicableKeys(spec)).toContain('xAxisType');
  });

  it('is NOT applicable for a plain categorical x (no temporal interpretation)', () => {
    const spec = assembleVegaLite({
      data: { values: [{ region: 'N', cost: 3 }, { region: 'S', cost: 5 }] },
      semantic_types: { region: 'Category', cost: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'region' }, y: { field: 'cost' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(hasOption(spec, 'xAxisType')).toBe(true);
    expect(applicableKeys(spec)).not.toContain('xAxisType');
  });

  it('offers yAxisType for a date-like temporal y (transposed/horizontal bar)', () => {
    const spec = assembleVegaLite({
      data: { values: monthRows },
      semantic_types: { month: 'YearMonth', cost: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { y: { field: 'month' }, x: { field: 'cost' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(applicableKeys(spec)).toContain('yAxisType');
  });

  it('forces a discrete (nominal) y when the user picks "nominal"', () => {
    const spec = assembleVegaLite({
      data: { values: monthRows },
      semantic_types: { month: 'YearMonth', cost: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { y: { field: 'month' }, x: { field: 'cost' } },
        canvasSize: canvas,
        chartProperties: { yAxisType: 'nominal' },
      },
    }) as any;
    expect(spec.encoding?.y?.type).toBe('nominal');
    expect(applicableKeys(spec)).toContain('yAxisType');
  });
});
