import { describe, expect, it } from 'vitest';
import { assembleVegaLite } from '../../../../../../src/lib/agents-chart';

const canvas = { width: 400, height: 300 };

/**
 * Numeric labels on a banded (discrete) x-axis must not be forced horizontal
 * when they would crowd — many/wide numbers should rotate. Few, short numbers
 * stay horizontal. A continuous (non-banded) quantitative axis is left to
 * Vega-Lite's own overlap handling.
 */
describe('banded x-axis numeric label angle', () => {
  it('rotates many wide numeric labels on a banded ordinal x-axis', () => {
    const values = Array.from({ length: 30 }, (_, i) => ({
      bucket: 1000000 + i * 125000,
      count: 10 + (i % 7),
    }));
    const spec: any = assembleVegaLite({
      data: { values },
      semantic_types: { bucket: 'Quantity', count: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'bucket', type: 'ordinal' }, y: { field: 'count' } },
        canvasSize: canvas,
      },
    });
    expect(spec.config.axisX.labelAngle).toBe(-45);
  });

  it('keeps a few short numeric labels horizontal', () => {
    const values = [
      { bucket: 1, count: 10 },
      { bucket: 2, count: 20 },
      { bucket: 3, count: 15 },
    ];
    const spec: any = assembleVegaLite({
      data: { values },
      semantic_types: { bucket: 'Quantity', count: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'bucket', type: 'ordinal' }, y: { field: 'count' } },
        canvasSize: canvas,
      },
    });
    expect(spec.config.axisX.labelAngle).toBe(0);
  });

  it('leaves a continuous (non-banded) quantitative x-axis to VL overlap handling', () => {
    const values = Array.from({ length: 25 }, (_, i) => ({
      bucket: 1000000 + i * 125000,
      count: 10 + (i % 7),
    }));
    const spec: any = assembleVegaLite({
      data: { values },
      semantic_types: { bucket: 'Quantity', count: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'bucket' }, y: { field: 'count' } },
        canvasSize: canvas,
      },
    });
    // Continuous axis: no forced labelAngle override from banded-label logic.
    expect(spec.config.axisX?.labelAngle).toBeUndefined();
  });
});
