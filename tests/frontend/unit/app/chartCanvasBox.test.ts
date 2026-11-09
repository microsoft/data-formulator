import { describe, expect, it } from "vitest";

import { assembleVegaChart, chartCanvasBox, containScale } from "../../../../src/app/utils";

const fields = [
  { id: "category", name: "category", source: "original", tableRef: "t" },
  { id: "value", name: "value", source: "original", tableRef: "t" },
] as any;
const metadata = {
  category: { type: "string", levels: [] },
  value: { type: "number", levels: [] },
} as any;
const encodings = {
  x: { fieldID: "category", dtype: "nominal" },
  y: { fieldID: "value", dtype: "quantitative" },
} as any;
const rows = [{ category: "a", value: 1 }, { category: "b", value: 2 }];

describe("canvas box contract", () => {
  it("reads back exactly the canvasSize passed to Flint (base × stretch)", () => {
    const spec = assembleVegaChart("Bar Chart", encodings, fields, rows, metadata, 400, 300, false, undefined, 1, 1.5);
    expect(chartCanvasBox(spec)).toEqual({ width: 600, height: 450 });
  });

  it("has no box for a spec Flint did not assemble", () => {
    expect(chartCanvasBox({ mark: "bar" })).toBeUndefined();
    expect(chartCanvasBox(undefined)).toBeUndefined();
  });

  it("contain-scales a drawing into its box and never grows it", () => {
    const box = { width: 800, height: 600 };
    expect(containScale({ width: 500, height: 400 }, box)).toBe(1);
    expect(containScale({ width: 493, height: 660 }, box)).toBeCloseTo(600 / 660);
    expect(containScale({ width: 1000, height: 600 }, box)).toBeCloseTo(0.8);
    expect(containScale({ width: 1000, height: 1000 }, undefined)).toBe(1);
  });
});
