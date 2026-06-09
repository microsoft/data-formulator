import { describe, expect, it } from 'vitest';
import { assembleVegaLite } from '../../../../../../src/lib/agents-chart';

const canvas = { width: 500, height: 400 };

/** Keys of options Flint reports as applicable for a rendered spec. */
const applicableKeys = (spec: any): string[] =>
  (spec._options ?? []).filter((o: any) => o.applicable).map((o: any) => o.key);
/** Look up a single option descriptor on a rendered spec. */
const optionFor = (spec: any, key: string): any =>
  (spec._options ?? []).find((o: any) => o.key === key);

/** Resolve the y scale across the possible spec nestings (top / layer / facet). */
function yScale(spec: any): any {
  return (
    spec?.encoding?.y?.scale ??
    spec?.spec?.encoding?.y?.scale ??
    (Array.isArray(spec?.layer)
      ? spec.layer.find((l: any) => l.encoding?.y?.scale)?.encoding?.y?.scale
      : undefined) ??
    (Array.isArray(spec?.spec?.layer)
      ? spec.spec.layer.find((l: any) => l.encoding?.y?.scale)?.encoding?.y?.scale
      : undefined)
  );
}

/** Does the resolved y scale anchor the axis at zero? */
function yIncludesZero(spec: any): boolean {
  const scale = yScale(spec);
  if (!scale) return false;
  if (scale.zero === true) return true;
  if (Array.isArray(scale.domain)) return scale.domain[0] === 0;
  if (scale.domainMin === 0) return true;
  return false;
}

/** A scatter plot (position-cognitive) with a typed quantitative y axis. */
function scatterY(yType: string, yValues: number[], chartProperties?: any) {
  const values = yValues.map((v, i) => ({ x: i + 1, y: v }));
  return assembleVegaLite({
    data: { values },
    // x = Number (zero-meaningful → forced → never offers includeZero_x),
    // so only the y axis is under test.
    semantic_types: { x: 'Number', y: yType },
    chart_spec: {
      chartType: 'Scatter Plot',
      encodings: { x: { field: 'x' }, y: { field: 'y' } },
      canvasSize: canvas,
      chartProperties,
    },
  }) as any;
}

describe('zero-baseline toggle: offered only when the choice is a genuine toss-up', () => {
  it('does NOT offer Zero Y for an arbitrary type away from zero (zero is meaningless → just fit data)', () => {
    // Temperature = arbitrary; zero is not a meaningful reference, so the
    // engine fits the data and there is nothing to debate.
    const spec = scatterY('Temperature', [60, 70, 80, 90, 100]);
    expect(applicableKeys(spec)).not.toContain('includeZero_y');
    expect(yIncludesZero(spec)).toBe(false);
  });

  it('does NOT offer Zero Y for a contextual type close to zero (engine confidently includes zero)', () => {
    // Percentage = contextual; data 5–25 hugs zero (proximity 0.2) → engine
    // includes zero and is confident enough that no toggle is needed.
    const spec = scatterY('Percentage', [5, 10, 15, 20, 25]);
    expect(applicableKeys(spec)).not.toContain('includeZero_y');
    expect(yIncludesZero(spec)).toBe(true);
  });

  it('does NOT offer Zero Y for a meaningful type whose data already spans toward zero', () => {
    // Price = meaningful; data 10–40 (proximity 0.25) already spans most of the
    // way to zero, so including zero barely changes the view → keep zero on
    // silently, no toggle.
    const spec = scatterY('Price', [10, 20, 30, 40]);
    expect(applicableKeys(spec)).not.toContain('includeZero_y');
    expect(yIncludesZero(spec)).toBe(true);
  });

  it('offers Zero Y for a meaningful type far from zero on a position mark (default ON)', () => {
    // Price = meaningful; data 1000–1200 (proximity 0.83) sits far from zero, so
    // anchoring at zero would crush the data into a thin band — a real
    // zoom-vs-anchor toss-up. Toggle is offered, recommended ON.
    const spec = scatterY('Price', [1000, 1050, 1100, 1150, 1200]);
    expect(applicableKeys(spec)).toContain('includeZero_y');
    expect(optionFor(spec, 'includeZero_y')?.value).toBe(true);
    expect(yIncludesZero(spec)).toBe(true);
  });

  it('does NOT offer Zero Y for an unknown/unrecognized type (no opinion to debate)', () => {
    const spec = scatterY('Mystery', [60, 70, 80, 90]);
    expect(applicableKeys(spec)).not.toContain('includeZero_y');
  });

  it('does NOT offer Zero Y on a bar chart (length mark — baseline is structural)', () => {
    const spec = assembleVegaLite({
      data: {
        values: [
          { cat: 'a', y: 60 }, { cat: 'b', y: 70 },
          { cat: 'c', y: 80 }, { cat: 'd', y: 90 },
        ],
      },
      semantic_types: { cat: 'Category', y: 'Temperature' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'cat' }, y: { field: 'y' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(applicableKeys(spec)).not.toContain('includeZero_y');
  });

  it('does NOT offer Zero Y for a meaningful type on a bar chart (mandatory baseline)', () => {
    const spec = assembleVegaLite({
      data: {
        values: [
          { cat: 'a', y: 10 }, { cat: 'b', y: 20 },
          { cat: 'c', y: 30 }, { cat: 'd', y: 40 },
        ],
      },
      semantic_types: { cat: 'Category', y: 'Price' },
      chart_spec: {
        chartType: 'Bar Chart',
        encodings: { x: { field: 'cat' }, y: { field: 'y' } },
        canvasSize: canvas,
      },
    }) as any;
    expect(applicableKeys(spec)).not.toContain('includeZero_y');
  });
});

describe('zero-baseline toggle: the choice drives the rendered axis', () => {
  it('unset follows the engine decision (arbitrary away from zero → fits data)', () => {
    const spec = scatterY('Temperature', [60, 70, 80, 90, 100]);
    expect(yIncludesZero(spec)).toBe(false);
  });

  it('ON forces the axis to include zero', () => {
    const spec = scatterY('Temperature', [60, 70, 80, 90, 100], { includeZero_y: true });
    expect(yIncludesZero(spec)).toBe(true);
    // stays offered so the user can revert
    expect(applicableKeys(spec)).toContain('includeZero_y');
  });

  it('OFF fits the data even over a zero-anchored semantic domain', () => {
    // Percentage close to zero would default to a zero baseline (and a
    // [0,100]-style intrinsic floor). Turning the toggle OFF must win: the
    // axis fits the data and is NOT re-pinned to zero.
    const spec = scatterY('Percentage', [5, 10, 15, 20, 25], { includeZero_y: false });
    expect(yIncludesZero(spec)).toBe(false);
    expect(applicableKeys(spec)).toContain('includeZero_y');
  });

  it('OFF fits the data for a meaningful type on a line/point chart', () => {
    // Price 0.8–2.0 (the screenshot case): default ON shows zero, but turning
    // the toggle OFF fits the data instead of crushing it against the baseline.
    const spec = scatterY('Price', [0.8, 1.0, 1.4, 1.8, 2.0], { includeZero_y: false });
    expect(yIncludesZero(spec)).toBe(false);
    expect(applicableKeys(spec)).toContain('includeZero_y');
  });
});
