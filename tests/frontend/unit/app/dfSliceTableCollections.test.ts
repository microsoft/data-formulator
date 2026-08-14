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
    expect(state.derivedTables[0].parentNodeId).toBe("orders");

    state = dataFormulatorReducer(
      state,
      dfActions.removeTableLocally("orders")
    );
    expect(state.inputTables).toEqual([]);
    expect(state.derivedTables).toEqual([]);
  });

  it("stores an authored parent edge when a report is finalized", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.saveGeneratedReport({
        id: "report-1",
        content: "",
        selectedChartIds: [],
        createdAt: 1,
        triggerTableId: "orders",
        status: "generating",
      })
    );

    state = dataFormulatorReducer(
      state,
      dfActions.updateGeneratedReportContent({
        id: "report-1",
        content: "# Report",
        status: "completed",
        parentNodeId: "textTurn-response",
      })
    );

    expect(state.generatedReports[0]).toEqual(
      expect.objectContaining({
        triggerTableId: "orders",
        parentNodeId: "textTurn-response",
      })
    );
  });

  it("preserves a draft parent edge when promoting its result", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.createDraftNode({
        id: "draft-result",
        displayId: "Result",
        parentNodeId: "textTurn-answer",
        parentTableId: "orders",
        source: ["orders"],
        interaction: [],
      })
    );

    state = dataFormulatorReducer(
      state,
      dfActions.promoteDraft({
        draftId: "draft-result",
        rows: [{ order_id: 1 }],
        names: ["order_id"],
        metadata: { order_id: { type: "integer", levels: [] } },
        code: "result_df = orders",
        outputVariable: "result_df",
        virtual: { tableId: "result_workspace", rowCount: 1 },
      })
    );

    expect(state.draftNodes).toEqual([]);
    expect(state.derivedTables[0]).toMatchObject({
      id: "draft-result",
      parentNodeId: "textTurn-answer",
      derive: {
        trigger: { tableId: "orders" },
      },
    });
  });

  it("repairs authored child edges when a text turn is removed", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-response",
        displayId: "Response",
        textKind: "explain",
        content: "Report written.",
        parentNodeId: "orders",
        createdAt: 1,
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-followup",
        displayId: "Follow-up",
        textKind: "explain",
        content: "More detail",
        parentNodeId: "textTurn-response",
        createdAt: 2,
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.saveGeneratedReport({
        id: "report-1",
        content: "# Report",
        selectedChartIds: [],
        createdAt: 3,
        triggerTableId: "orders",
        parentNodeId: "textTurn-response",
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.addLoadedTableNode({
        kind: "loaded-table",
        id: "loaded-table-orders",
        tableId: "orders",
        parentNodeId: "textTurn-response",
        createdAt: 4,
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.createDraftNode({
        id: "draft-followup",
        displayId: "Draft follow-up",
        parentNodeId: "textTurn-response",
        parentTableId: "orders",
        source: ["orders"],
        interaction: [],
      })
    );

    state = dataFormulatorReducer(
      state,
      dfActions.removeTextTurn("textTurn-response")
    );

    expect(state.textTurns).toEqual([
      expect.objectContaining({
        id: "textTurn-followup",
        parentNodeId: "orders",
      }),
    ]);
    expect(state.generatedReports[0].parentNodeId).toBe("orders");
    expect(state.loadedTableNodes[0].parentNodeId).toBe("orders");
    expect(state.draftNodes[0].parentNodeId).toBe("orders");
  });

  it("removes loaded-table references with their shelf table", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTableToStore(sourceTable as any)
    );
    state = dataFormulatorReducer(
      state,
      dfActions.addLoadedTableNode({
        kind: "loaded-table",
        id: "loaded-table-orders",
        tableId: "orders",
        parentNodeId: "textTurn-load",
        createdAt: 1,
      })
    );

    state = dataFormulatorReducer(state, dfActions.removeTableLocally("orders"));

    expect(state.inputTables).toEqual([]);
    expect(state.loadedTableNodes).toEqual([]);
  });

  it("reparents authored children when a derived table is removed", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTableToStore(sourceTable as any)
    );
    state = dataFormulatorReducer(
      state,
      dfActions.insertDerivedTables({ ...derivedTable, parentNodeId: "orders" } as any)
    );
    state = dataFormulatorReducer(
      state,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-child",
        displayId: "Child",
        textKind: "explain",
        content: "Follow-up",
        parentNodeId: "summary",
        createdAt: 1,
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.createDraftNode({
        id: "draft-child",
        displayId: "Draft child",
        parentNodeId: "summary",
        parentTableId: "summary",
        source: ["summary"],
        interaction: [],
      })
    );

    state = dataFormulatorReducer(state, dfActions.removeTableLocally("summary"));

    expect(state.textTurns[0].parentNodeId).toBe("orders");
    expect(state.draftNodes[0].parentNodeId).toBe("orders");
    expect(state.draftNodes[0].derive.trigger.tableId).toBe("orders");
  });
});
