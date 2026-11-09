import { describe, expect, it } from "vitest";

import { derivedRefreshWaves } from "../../../../src/app/derivedRefresh";
import type { DictTable } from "../../../../src/components/ComponentType";

const table = (id: string, source?: string[]): DictTable =>
  ({ id, rows: [], names: [], ...(source ? { derive: { source, code: "", trigger: { tableId: source[0] } } } : {}) }) as unknown as DictTable;

const ids = (waves: DictTable[][]) => waves.map(wave => wave.map(item => item.id));

describe("derivedRefreshWaves", () => {
  it("refreshes tables computed from a changed table first, then the tables computed from them", () => {
    const tables = [
      table("chained", ["first", "other"]),
      table("first", ["loaded"]),
      table("other", ["unchanged"]),
      table("second", ["first"]),
      table("loaded"),
      table("unchanged"),
    ];

    expect(ids(derivedRefreshWaves(tables, ["loaded"]))).toEqual([["first"], ["chained", "second"]]);
  });

  it("waits for every changed input of a table before refreshing it", () => {
    const tables = [
      table("late", ["a", "b"]),
      table("b", ["a"]),
      table("a", ["loaded"]),
      table("loaded"),
    ];

    expect(ids(derivedRefreshWaves(tables, ["loaded"]))).toEqual([["a"], ["b"], ["late"]]);
  });

  it("leaves unrelated tables alone and still refreshes a cycle", () => {
    const tables = [table("x", ["y"]), table("y", ["x", "loaded"]), table("z", ["elsewhere"]), table("loaded")];

    expect(ids(derivedRefreshWaves(tables, ["loaded"]))).toEqual([["x", "y"]]);
    expect(derivedRefreshWaves(tables, ["nothing"])).toEqual([]);
  });
});
