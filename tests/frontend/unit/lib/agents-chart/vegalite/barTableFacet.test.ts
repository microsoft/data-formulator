import { describe, expect, it } from 'vitest';
import { compile } from 'vega-lite';
import { assembleVegaLite } from '../../../../../../src/lib/agents-chart';

const canvasSize = { width: 400, height: 300 };

const encoding = {
  y: { field: 'agency' },
  x: { field: 'launches' },
  column: { field: 'agency_type' },
};

const semanticTypes = {
  agency: 'Category',
  launches: 'Quantity',
  agency_type: 'Category',
};

describe('Vega-Lite Bar Table facets', () => {
  it('hoists column facets around the hconcat bar table and wraps them', () => {
    const data = [
      { agency_type: 'state', agency: 'RVSN', launches: 1528 },
      { agency_type: 'state', agency: 'UNKS', launches: 904 },
      { agency_type: 'state', agency: 'NASA', launches: 469 },
      { agency_type: 'private', agency: 'Arianespace', launches: 258 },
      { agency_type: 'private', agency: 'ILS-K', launches: 97 },
      { agency_type: 'startup', agency: 'SpaceX', launches: 65 },
    ];

    const spec = assembleVegaLite({
      data: { values: data },
      semantic_types: semanticTypes,
      chart_spec: {
        chartType: 'Bar Table',
        encodings: encoding,
        canvasSize,
      },
    });

    expect(spec.facet).toEqual({ field: 'agency_type', type: 'nominal', sort: null });
    expect(spec.columns).toBe(2);
    expect(spec.hconcat).toBeUndefined();
    expect(spec.spec.hconcat).toHaveLength(2);
    expect(spec.spec.hconcat[0].data).toBeUndefined();
    expect(spec.data).toEqual({ name: '__bt_displayTable' });
    expect(spec.resolve.scale.y).toBe('independent');
    expect(spec.spec.resolve.scale.y).toBe('shared');
    expect(spec.spec.hconcat[0].width).toBeLessThan(canvasSize.width);
    expect(spec.spec.hconcat[0].height).toBeLessThan(canvasSize.height);
    expect(spec.spec.hconcat[0].encoding.y.axis.labelFontSize).toBeLessThan(13);
    expect(spec.spec.hconcat[1].mark.fontSize).toBeLessThan(12);

    expect(() => compile(spec)).not.toThrow();
  });

  it('rolls rows up within each facet without creating an undefined facet', () => {
    const data = [
      { agency_type: 'state', agency: 'RVSN', launches: 100 },
      { agency_type: 'state', agency: 'UNKS', launches: 90 },
      { agency_type: 'state', agency: 'NASA', launches: 80 },
      { agency_type: 'state', agency: 'USAF', launches: 70 },
      { agency_type: 'private', agency: 'Arianespace', launches: 60 },
      { agency_type: 'private', agency: 'ILS-K', launches: 50 },
      { agency_type: 'private', agency: 'ULA', launches: 40 },
      { agency_type: 'private', agency: 'Boeing', launches: 30 },
    ];

    const spec = assembleVegaLite({
      data: { values: data },
      semantic_types: semanticTypes,
      chart_spec: {
        chartType: 'Bar Table',
        encodings: encoding,
        canvasSize,
        chartProperties: { maxRows: 3 },
      },
    });

    const displayRows = spec.datasets.__bt_displayTable;
    expect(displayRows).toHaveLength(6);
    expect(displayRows.filter((row: any) => row.__bt_others)).toEqual([
      expect.objectContaining({ agency_type: 'state', agency: 'Others (+2)', launches: 150 }),
      expect.objectContaining({ agency_type: 'private', agency: 'Others (+2)', launches: 70 }),
    ]);
    expect(displayRows.every((row: any) => row.agency_type === 'state' || row.agency_type === 'private')).toBe(true);
  });

  it('computes percentage totals within each facet', () => {
    const data = [
      { agency_type: 'state', agency: 'RVSN', launches: 100 },
      { agency_type: 'state', agency: 'UNKS', launches: 50 },
      { agency_type: 'private', agency: 'Arianespace', launches: 40 },
      { agency_type: 'private', agency: 'ILS-K', launches: 10 },
    ];

    const spec = assembleVegaLite({
      data: { values: data },
      semantic_types: semanticTypes,
      chart_spec: {
        chartType: 'Bar Table',
        encodings: { ...encoding, color: { field: 'agency_type' } },
        canvasSize,
        chartProperties: { showPercent: true },
      },
    });

    expect(spec.spec.hconcat).toHaveLength(3);
    const percentPanel = spec.spec.hconcat[1];
    expect(percentPanel.transform[0].groupby).toEqual(['agency_type', 'agency']);
    expect(percentPanel.transform[1]).toEqual({
      joinaggregate: [{ op: 'sum', field: '__bt_val', as: '__bt_total' }],
      groupby: ['agency_type'],
    });
    expect(percentPanel.transform[2]).toEqual({
      calculate: 'datum.__bt_total === 0 ? null : datum.__bt_val / datum.__bt_total',
      as: '__bt_pct',
    });

    expect(() => compile(spec)).not.toThrow();
  });
});
