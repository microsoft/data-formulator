import { describe, expect, it } from 'vitest';
import { assembleVegaLite, getChartOptions } from '../../../../../../src/lib/agents-chart';

const canvas = { width: 500, height: 400 };

/** Keys of options Flint reports as applicable for a rendered spec. */
const applicableKeys = (spec: any): string[] =>
  (spec._options ?? []).filter((o: any) => o.applicable).map((o: any) => o.key);
/** Look up a single option descriptor on a rendered spec. */
const optionFor = (spec: any, key: string): any =>
  (spec._options ?? []).find((o: any) => o.key === key);

// Wide-range positive values (≥ 6 orders of magnitude) so the engine's
// conservative log recommendation fires, and the offer-eligibility (≥ 3
// decades) is comfortably met.
const wideX = Array.from({ length: 12 }, (_, i) => ({
  x: Math.pow(10, i * 0.7), // 1 … ~10^7.7
  y: i + 1,
}));

function scatter(encodings: any, chartProperties?: any) {
  return assembleVegaLite({
    data: { values: wideX },
    semantic_types: { x: 'Quantity', y: 'Number' },
    chart_spec: {
      chartType: 'Scatter Plot',
      encodings,
      canvasSize: canvas,
      chartProperties,
    },
  }) as any;
}

describe('per-axis log scale: offer eligibility + user override', () => {
  it('offers logScale_x on a wide-range continuous quantitative position axis', () => {
    const spec = scatter({ x: { field: 'x' }, y: { field: 'y' } });
    expect(applicableKeys(spec)).toContain('logScale_x');
  });

  it('does NOT offer log on a narrow-range axis', () => {
    const narrow = Array.from({ length: 12 }, (_, i) => ({ x: 10 + i, y: i }));
    const spec = assembleVegaLite({
      data: { values: narrow },
      semantic_types: { x: 'Number', y: 'Number' },
      chart_spec: {
        chartType: 'Scatter Plot',
        encodings: { x: { field: 'x' }, y: { field: 'y' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(applicableKeys(spec)).not.toContain('logScale_x');
  });

  it("unset follows the engine recommendation (log for wide-range additive measure)", () => {
    const spec = scatter({ x: { field: 'x' }, y: { field: 'y' } });
    expect(spec.encoding.x.scale?.type).toBe('log');
    // and the option's resolved value reflects that recommendation
    expect(optionFor(spec, 'logScale_x')?.value).toBe(true);
  });

  it("false overrides the recommendation and forces a linear axis", () => {
    const spec = scatter({ x: { field: 'x' }, y: { field: 'y' } }, { logScale_x: false });
    expect(spec.encoding.x.scale?.type).not.toBe('log');
    // still offered, so the user can revert
    expect(applicableKeys(spec)).toContain('logScale_x');
  });

  it("true forces a log axis even when the engine would not recommend it", () => {
    // Generic 'Number' over a moderate (non-recommended) range: default stays linear.
    const vals = Array.from({ length: 12 }, (_, i) => ({ x: (i + 1) * 50, y: i }));
    const auto = assembleVegaLite({
      data: { values: vals },
      semantic_types: { x: 'Number', y: 'Number' },
      chart_spec: {
        chartType: 'Scatter Plot',
        encodings: { x: { field: 'x' }, y: { field: 'y' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(auto.encoding.x.scale?.type).not.toBe('log');

    const forced = assembleVegaLite({
      data: { values: vals },
      semantic_types: { x: 'Number', y: 'Number' },
      chart_spec: {
        chartType: 'Scatter Plot',
        encodings: { x: { field: 'x' }, y: { field: 'y' } },
        canvasSize: canvas,
        chartProperties: { logScale_x: true },
      },
    }) as any;
    expect(forced.encoding.x.scale?.type).toBe('log');
  });

  it("uses symlog for a true toggle when the data contains zeros", () => {
    const withZeros = [{ x: 0, y: 0 }, ...Array.from({ length: 11 }, (_, i) => ({ x: Math.pow(10, i * 0.6), y: i + 1 }))];
    const spec = assembleVegaLite({
      data: { values: withZeros },
      semantic_types: { x: 'Number', y: 'Number' },
      chart_spec: {
        chartType: 'Scatter Plot',
        encodings: { x: { field: 'x' }, y: { field: 'y' } },
        canvasSize: canvas,
        chartProperties: { logScale_x: true },
      },
    }) as any;
    expect(spec.encoding.x.scale?.type).toBe('symlog');
  });

  it('never offers log on a length-cognitive bar chart, even with wide-range data', () => {
    const spec = assembleVegaLite({
      data: { values: wideX.map((d, i) => ({ cat: `c${i}`, val: d.x })) },
      semantic_types: { cat: 'Category', val: 'Quantity' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'cat' }, y: { field: 'val' } },
        canvasSize: canvas,
      },
    }) as any;
    // Length marks never even carry the log-scale option in their catalog.
    expect((spec._options ?? []).find((o: any) => o.key.startsWith('logScale'))).toBeUndefined();
  });

  it('offers log only on the quantitative value axis of a line chart (not the temporal axis)', () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      t: `2020-${String((i % 12) + 1).padStart(2, '0')}-01`,
      v: Math.pow(10, i * 0.7),
    }));
    const spec = assembleVegaLite({
      data: { values: series },
      semantic_types: { t: 'Date', v: 'Quantity' },
      chart_spec: {
        chartType: 'Line Chart',
        encodings: { x: { field: 't' }, y: { field: 'v' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(applicableKeys(spec)).toContain('logScale_y');
    expect(applicableKeys(spec)).not.toContain('logScale_x');
  });

  it('getChartOptions reports the same applicable options as the rendered spec', () => {
    const input = {
      data: { values: wideX },
      semantic_types: { x: 'Quantity', y: 'Number' },
      chart_spec: {
        chartType: 'Scatter Plot',
        encodings: { x: { field: 'x' }, y: { field: 'y' } },
        canvasSize: canvas,
      },
    };
    const spec = assembleVegaLite(input) as any;
    const options = getChartOptions(input);
    expect(options).toEqual(spec._options);
    expect(options.filter(o => o.applicable).map(o => o.key)).toContain('logScale_x');
  });
});
