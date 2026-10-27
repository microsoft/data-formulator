import { describe, expect, it } from "vitest";

import { expectedWorkspaceTables, tablesMissingFrom } from "../../../../src/app/workspaceConsistency";

const inputTable = (id: string, source: any) => ({
  kind: "input-table", id, displayId: id.toUpperCase(), source,
  snapshot: { columns: [], rowCount: 1, capturedAt: 0 }, description: "", addedAt: 0,
}) as any;

describe("workspace consistency", () => {
  it("maps session tables to the workspace tables that hold their data", () => {
    const expected = expectedWorkspaceTables(
      [inputTable("movies", { kind: "workspace", tableId: "movies" }),
       inputTable("orders", { kind: "connector", connectorId: "c", sourceTable: { id: "o", name: "o" }, path: [], workspaceTableId: "orders_1" })],
      [{ kind: "table", id: "t-1", displayId: "Derived", virtual: { tableId: "d_out", rowCount: 4 } } as any,
       { kind: "table", id: "local", displayId: "Local rows", rows: [] } as any],
    );
    expect([...expected].map(([id, { name }]) => [id, name])).toEqual([
      ["movies", "movies"], ["orders", "orders_1"], ["t-1", "d_out"],
    ]);
  });

  it("finds the session tables the workspace does not hold", () => {
    const expected = new Map([["movies", { name: "movies" }], ["shows", { name: "shows" }], ["t-1", { name: "d_out" }]]);
    expect(tablesMissingFrom(expected, new Set(["movies", "d_out"]))).toEqual(["shows"]);
    expect(tablesMissingFrom(expected, new Set(["movies", "shows", "d_out"]))).toEqual([]);
  });
});
