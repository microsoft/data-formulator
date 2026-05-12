import { describe, expect, it } from 'vitest';
import { assembleVegaLite } from '../../../../../../src/lib/agents-chart';

const baseCanvas = { width: 400, height: 300 };

describe('Vega-Lite quantitative axis formatting', () => {
  it('adds a default format to unformatted quantitative position axes', () => {
    const spec = assembleVegaLite({
      data: {
        values: [
          { category: 'A', value: 20 },
          { category: 'B', value: -50 },
        ],
      },
      semantic_types: { category: 'Category', value: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'category' }, y: { field: 'value' } },
        canvasSize: baseCanvas,
      },
      options: { addTooltips: true },
    });

    expect(spec.encoding.y.axis.format).toBe(',.12~g');
    expect(spec.encoding.x.axis?.format).toBeUndefined();
    expect(spec.config.numberFormat).toBeUndefined();
    expect(spec.config.mark.tooltip).toBe(true);
  });

  it('does not override semantic axis formats', () => {
    const spec = assembleVegaLite({
      data: {
        values: [
          { category: 'A', completionRate: 0.2 },
          { category: 'B', completionRate: 0.85 },
        ],
      },
      semantic_types: {
        category: 'Category',
        completionRate: { semanticType: 'Percentage', intrinsicDomain: [0, 1] },
      },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'category' }, y: { field: 'completionRate' } },
        canvasSize: baseCanvas,
      },
      options: { addTooltips: true },
    });

    expect(spec.encoding.y.axis.format).toBe('.0~%');
    expect(spec.encoding.y.axis.format).not.toBe(',.12~g');
  });

  it('does not format binned axes', () => {
    const spec = assembleVegaLite({
      data: {
        values: [
          { value: 1 },
          { value: 2 },
          { value: 3 },
        ],
      },
      semantic_types: { value: 'Quantity' },
      chart_spec: {
        chartType: 'Histogram',
        encodings: { x: { field: 'value' } },
        canvasSize: baseCanvas,
      },
      options: { addTooltips: true },
    });

    expect(spec.encoding.x.bin).toBeTruthy();
    expect(spec.encoding.x.axis?.format).toBeUndefined();
  });
});
