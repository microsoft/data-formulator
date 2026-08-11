import { describe, expect, it } from "vitest";

import {
  dataFormulatorReducer,
  dfActions,
  fetchFieldSemanticType,
} from "../../../../src/app/dfSlice";

const sourceTable = {
  kind: "table" as const,
  id: "orders",
  displayId: "Orders",
  names: ["order_id"],
  metadata: {
    order_id: { type: "integer", semanticType: "", levels: [] },
  },
  rows: [{ order_id: 1 }],
  virtual: { tableId: "orders_workspace", rowCount: 120000 },
  description: "Customer orders",
  contentHash: "orders-v1",
};

const derivedTable = {
  ...sourceTable,
  id: "summary",
  displayId: "Summary",
  virtual: { tableId: "summary_workspace", rowCount: 1 },
  derive: {
    source: ["orders"],
    code: "result_df = orders",
    outputVariable: "result_df",
    dialog: [],
    trigger: { tableId: "orders", resultTableId: "summary" },
  },
};

describe("split table collections", () => {
  it("stores inferred field semantics separately from physical metadata", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTableToStore(sourceTable as any)
    );
    state = dataFormulatorReducer(
      state,
      fetchFieldSemanticType.fulfilled(
        {
          result: [
            {
              fields: {
                order_id: {
                  type: "string",
                  semantic_type: "identifier",
                  sort_order: ["first", "second"],
                  intrinsic_domain: [1, 100],
                  unit: "order",
                },
              },
              suggested_table_name: "Orders by customer",
            },
          ],
        },
        "request-id",
        sourceTable as any
      )
    );

    expect(state).not.toHaveProperty("tables");
    expect(state.inputTables[0].snapshot.columns[0]).toEqual({
      name: "order_id",
      type: "integer",
      levels: [],
    });
    expect(state.tableSemantics).toEqual([
      {
        tableId: "orders",
        displayName: "Orders by customer",
        fields: {
          order_id: {
            semanticType: "identifier",
            sortOrder: ["first", "second"],
            intrinsicDomain: [1, 100],
            unit: "order",
          },
        },
      },
    ]);

    state = dataFormulatorReducer(
      state,
      dfActions.removeTableLocally("orders")
    );
    expect(state.tableSemantics).toEqual([]);
  });

  it("automatically migrates legacy tables when state is loaded", () => {
    const state = dataFormulatorReducer(
      undefined,
      dfActions.loadState({
        __stateVersion: 2,
        tables: [sourceTable, derivedTable],
      })
    );

    expect(state.inputTables).toEqual([
      expect.objectContaining({
        kind: "input-table",
        id: "orders",
        displayId: "Orders",
        source: { kind: "workspace", tableId: "orders_workspace" },
        snapshot: expect.objectContaining({
          rowCount: 120000,
          contentHash: "orders-v1",
        }),
      }),
    ]);
    expect(state.inputTables[0]).not.toHaveProperty("rows");
    expect(state.derivedTables).toEqual([
      expect.objectContaining({
        id: "summary",
        derive: expect.objectContaining({ source: ["orders"] }),
      }),
    ]);
    expect(state).not.toHaveProperty("tables");
  });

  it("stores input metadata without rows and tracks derived tables separately", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTableToStore(sourceTable as any)
    );

    expect(state).not.toHaveProperty("tables");
    expect(state.inputTables).toEqual([
      expect.objectContaining({
        kind: "input-table",
        id: "orders",
        source: { kind: "workspace", tableId: "orders_workspace" },
        snapshot: expect.objectContaining({
          rowCount: 120000,
          contentHash: "orders-v1",
        }),
      }),
    ]);
    expect(state.inputTables[0]).not.toHaveProperty("rows");
    expect(state.inputTables[0].snapshot).not.toHaveProperty("sampleRows");

    state = dataFormulatorReducer(
      state,
      dfActions.insertDerivedTables(derivedTable as any)
    );
    expect(state.derivedTables.map((table) => table.id)).toEqual(["summary"]);

    state = dataFormulatorReducer(
      state,
      dfActions.removeTableLocally("orders")
    );
    expect(state.inputTables).toEqual([]);
    expect(state.derivedTables).toEqual([]);
  });
});
