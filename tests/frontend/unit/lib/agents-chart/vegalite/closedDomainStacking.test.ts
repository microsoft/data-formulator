import { describe, expect, it } from 'vitest';
import { assembleVegaLite } from '../../../../../../src/lib/agents-chart';

const canvas = { width: 600, height: 400 };

/**
 * Regression: a closed-domain measure (Correlation, intrinsic [-1, 1]) on a bar
 * chart that stacks — either via a color series or via repeated categories with
 * no color — must NOT keep the intrinsic clamp domain, or the stacked bars
 * overflow/clip past the fixed axis bound.
 */
describe('closed-domain stacked bar overflow', () => {
  it('drops the intrinsic [-1,1] clamp when a color series stacks past the bound', () => {
    const products = ['A', 'B', 'C', 'D'];
    const series = ['s1', 's2', 's3', 's4'];
    const values: any[] = [];
    for (const p of products) {
      for (const s of series) values.push({ product: p, series: s, corr: 0.9 });
    }
    const spec = assembleVegaLite({
      data: { values },
      semantic_types: { product: 'Category', series: 'Category', corr: 'Correlation' },
      chart_spec: {
        chartType: 'Stacked Bar Chart',
        encodings: { x: { field: 'product' }, y: { field: 'corr' }, color: { field: 'series' } },
        canvasSize: canvas,
      },
    });
    expect(spec.encoding.y.scale?.domain).toBeUndefined();
    expect(spec.encoding.y.scale?.clamp).toBeUndefined();
  });

  it('drops the intrinsic clamp when repeated categories stack with NO color', () => {
    const products = ['A', 'B', 'C', 'D', 'E'];
    const values: any[] = [];
    for (const p of products) {
      for (let i = 0; i < 4; i++) {
        values.push({ product: p, corr: p === 'C' ? -0.21 : 0.9 });
      }
    }
    const spec = assembleVegaLite({
      data: { values },
      semantic_types: { product: 'Category', corr: 'Correlation' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'product' }, y: { field: 'corr' } },
        canvasSize: canvas,
      },
    });
    expect(spec.encoding.y.scale?.domain).toBeUndefined();
    expect(spec.encoding.y.scale?.clamp).toBeUndefined();
  });

  it('detects overflow on the negative side even when signed totals would cancel', () => {
    // Per category: three +0.5 and four -0.5 → signed sum = -0.5 (within [-1,1]),
    // but the negative stack reaches -2.0, overflowing the lower bound.
    const products = ['A', 'B'];
    const values: any[] = [];
    for (const p of products) {
      for (let i = 0; i < 3; i++) values.push({ product: p, corr: 0.5 });
      for (let i = 0; i < 4; i++) values.push({ product: p, corr: -0.5 });
    }
    const spec = assembleVegaLite({
      data: { values },
      semantic_types: { product: 'Category', corr: 'Correlation' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'product' }, y: { field: 'corr' } },
        canvasSize: canvas,
      },
    });
    expect(spec.encoding.y.scale?.domain).toBeUndefined();
  });

  it('keeps the intrinsic [-1,1] domain for a non-stacking chart (one row per category)', () => {
    const values = [
      { product: 'A', corr: 0.9 },
      { product: 'B', corr: -0.21 },
      { product: 'C', corr: 0.4 },
    ];
    const spec = assembleVegaLite({
      data: { values },
      semantic_types: { product: 'Category', corr: 'Correlation' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'product' }, y: { field: 'corr' } },
        canvasSize: canvas,
      },
    });
    expect(spec.encoding.y.scale?.domain).toEqual([-1, 1]);
  });
});
