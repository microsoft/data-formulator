import { describe, expect, it } from "vitest";

import { assembleVegaChart } from "../../../../src/app/utils";
import { Chart, computeInsightKey } from "../../../../src/components/ComponentType";


const chart = {
  id: "chart-1",
  chartType: "Bar Chart",
  tableRef: "table-1",
  source: "user",
  encodingMap: {
    x: { fieldID: "category", dtype: "nominal" },
    y: { fieldID: "value", dtype: "quantitative", aggregate: "sum" },
  },
} as Chart;


describe("chart insight contract", () => {
  it("invalidates insight text when channel or aggregation changes", () => {
    const original = computeInsightKey(chart);
    const swapped = {
      ...chart,
      encodingMap: {
        x: chart.encodingMap.y,
        y: chart.encodingMap.x,
      },
    } as Chart;
    const averaged = {
      ...chart,
      encodingMap: {
        ...chart.encodingMap,
        y: { ...chart.encodingMap.y, aggregate: "average" },
      },
    } as Chart;

    expect(computeInsightKey(swapped)).not.toBe(original);
    expect(computeInsightKey(averaged)).not.toBe(original);
  });

  it("passes title and subtitle through Flint assembly", () => {
    const spec = assembleVegaChart(
      "Bar Chart",
      chart.encodingMap,
      [
        { id: "category", name: "category", source: "original", tableRef: "table-1" },
        { id: "value", name: "value", source: "original", tableRef: "table-1" },
      ] as any,
      [{ category: "A", value: 10 }],
      {
        category: { type: "string", levels: [] },
        value: { type: "number", levels: [] },
      } as any,
      400,
      300,
      false,
      undefined,
      1,
      undefined,
      undefined,
      {
        category: { semanticType: "Category", displayName: "Product" },
        value: { semanticType: "Quantity", displayName: "Revenue", unit: "USD" },
      },
      "Revenue Concentrated in Product A",
      "US revenue by product, USD",
    ) as any;

    expect(spec.title?.text).toBe("Revenue Concentrated in Product A");
    expect([spec.title?.subtitle].flat().join(" ")).toBe("US revenue by product, USD");
  });

  it("applies a Flint theme preset to the assembled base chart", () => {
    const args = [
      "Bar Chart",
      chart.encodingMap,
      [
        { id: "category", name: "category", source: "original", tableRef: "table-1" },
        { id: "value", name: "value", source: "original", tableRef: "table-1" },
      ],
      [{ category: "A", value: 10 }],
      {
        category: { type: "string", levels: [] },
        value: { type: "number", levels: [] },
      },
      400,
      300,
      false,
      undefined,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ] as const;

    const defaultSpec = assembleVegaChart(...args as any) as any;
    const nytSpec = assembleVegaChart(...args as any, "nyt") as any;

    expect(nytSpec).not.toEqual(defaultSpec);
    expect(JSON.stringify(nytSpec)).toContain("#2f6b9a");
  });

  it("preserves the dark canvas supplied by the Power BI theme", () => {
    const spec = assembleVegaChart(
      "Bar Chart",
      chart.encodingMap,
      [
        { id: "category", name: "category", source: "original", tableRef: "table-1" },
        { id: "value", name: "value", source: "original", tableRef: "table-1" },
      ] as any,
      [{ category: "A", value: 10 }],
      {
        category: { type: "string", levels: [] },
        value: { type: "number", levels: [] },
      } as any,
      400,
      300,
      false,
      undefined,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "powerbi",
    ) as any;

    expect(spec.background).toBe("#1b1a19");
  });
});