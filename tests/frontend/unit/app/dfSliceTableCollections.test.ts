import { describe, expect, it } from "vitest";

import {
  dataFormulatorReducer,
  dfActions,
  dfSelectors,
  fetchFieldSemanticType,
} from "../../../../src/app/dfSlice";
const CONVERSATION_ROOT_ID = 'conversation-root:test';

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
  it('replaces a virtual reference in place without disturbing existing outputs', () => {
    const reference = { kind: 'external-table-reference' as const, id: 'external:orders', connectorId: 'db',
      tableKey: 'orders', sourceTable: { id: 'orders', name: 'orders' }, displayName: 'Original orders',
      capturedAt: '', summary: { columns: [] } };
    let state = dataFormulatorReducer(undefined, dfActions.upsertExternalTableReference(reference));
    state = dataFormulatorReducer(state, dfActions.addTableToStore(derivedTable as any));
    state = dataFormulatorReducer(state, dfActions.appendWorkspaceItems(['before', reference.id, 'after']));
    state = dataFormulatorReducer(state, dfActions.setFocused({ type: 'external-table', referenceId: reference.id }));
    state = dataFormulatorReducer(state, dfActions.replaceExternalTableReference({ referenceId: reference.id, table: sourceTable as any }));
    expect(state.externalTableReferences).toEqual([]);
    expect(state.inputTables[0].displayId).toBe('Original orders');
    expect(state.workspaceItemOrder).toEqual(['before', 'shelf-card-orders', 'after']);
    expect(state.focusedId).toEqual({ type: 'table', tableId: 'orders' });
    expect(state.derivedTables[0].derive).toMatchObject(derivedTable.derive);
    const deleted = dataFormulatorReducer(undefined, dfActions.replaceExternalTableReference({ referenceId: reference.id, table: sourceTable as any }));
    expect(deleted.inputTables).toEqual([]);
  });

  it.each(['add', 'insert'])('keeps one derived owner across %s publication, refresh, and restore', publication => {
    const { derive, ...snapshot } = derivedTable;
    let state = dataFormulatorReducer(undefined, dfActions.addTableToStore(snapshot as any));
    const staleInput = state.inputTables[0];
    state = dataFormulatorReducer(state, publication === 'add'
      ? dfActions.addTableToStore(derivedTable as any)
      : dfActions.insertDerivedTables(derivedTable as any));
    expect(state.inputTables).toEqual([]);
    expect(state.derivedTables).toHaveLength(1);
    state = dataFormulatorReducer(state, dfActions.addTableToStore({ ...snapshot, rows: [{ order_id: 2 }] } as any));
    expect(state.inputTables).toEqual([]);
    expect(state.derivedTables[0].derive).toEqual(derive);
    expect(state.derivedTables[0].rows).toEqual([{ order_id: 2 }]);
    state = dataFormulatorReducer(state, dfActions.loadState({ ...state, inputTables: [staleInput] }));
    expect(state.inputTables).toEqual([]);
    expect(dfSelectors.getAllTables(state)).toHaveLength(1);
    expect(state.derivedTables[0].derive).toEqual(derive);
  });

  it("preserves workspace item order and appends recreated items at the end", () => {
    let state = dataFormulatorReducer(undefined, dfActions.addTableToStore(sourceTable as any));
    state = dataFormulatorReducer(state, dfActions.appendWorkspaceItems([
      'shelf-card-orders', 'workspace-file-notes.txt', 'external:orders', 'shelf-card-later',
    ]));
    state = dataFormulatorReducer(state, dfActions.removeTableLocally('orders'));
    state = dataFormulatorReducer(state, dfActions.removeFileNodes('notes.txt'));
    state = dataFormulatorReducer(state, dfActions.removeExternalTableReference('external:orders'));
    expect(state.workspaceItemOrder).toEqual(['shelf-card-later']);
    state = dataFormulatorReducer(state, dfActions.appendWorkspaceItems([
      'shelf-card-later', 'workspace-file-notes.txt', 'workspace-file-notes.txt', 'shelf-card-orders', 'external:orders',
    ]));
    expect(state.workspaceItemOrder).toEqual([
      'shelf-card-later', 'workspace-file-notes.txt', 'shelf-card-orders', 'external:orders',
    ]);
    expect(dataFormulatorReducer(undefined, dfActions.loadState(state)).workspaceItemOrder).toEqual(state.workspaceItemOrder);
    expect(dataFormulatorReducer(undefined, dfActions.loadState({})).workspaceItemOrder).toEqual([]);
  });

  it("tracks concurrent pending table loads and clears only the settled request", () => {
    const pending = (requestId: string) => ({ type: 'dataFormulator/loadTable/pending',
      meta: { requestId, arg: { table: sourceTable } } });
    let state = dataFormulatorReducer(undefined, pending('first'));
    state = dataFormulatorReducer(state, pending('second'));
    expect(state.pendingTableLoads).toEqual([
      { id: 'first', names: ['Orders'] }, { id: 'second', names: ['Orders'] },
    ]);
    state = dataFormulatorReducer(state, { type: 'dataFormulator/loadTable/rejected', meta: { requestId: 'first' } });
    expect(state.pendingTableLoads).toEqual([{ id: 'second', names: ['Orders'] }]);
    expect(dataFormulatorReducer(undefined, dfActions.loadState(state)).pendingTableLoads).toEqual([]);
    state = dataFormulatorReducer(state, { type: 'dataFormulator/loadTable/fulfilled', meta: { requestId: 'second' } });
    expect(state.pendingTableLoads).toEqual([]);
  });

  it("cleans up agent loading entries independently", () => {
    let state = dataFormulatorReducer(undefined, dfActions.startTableLoad({ id: 'agent', names: ['Reviews'] }));
    state = dataFormulatorReducer(state, dfActions.startTableLoad({ id: 'agent', names: ['Scoped reviews'] }));
    expect(state.pendingTableLoads).toEqual([{ id: 'agent', names: ['Scoped reviews'] }]);
    state = dataFormulatorReducer(state, dfActions.finishTableLoad('agent'));
    expect(state.pendingTableLoads).toEqual([]);
  });

  it("stores file results separately and updates revisions without moving the node", () => {
    const file = { kind: "file" as const, id: "file-result", path: "scratch/cpi.parquet",
      displayName: "CPI Summary", contentHash: "v1", parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1 };
    let state = dataFormulatorReducer(undefined, dfActions.upsertFileNode(file));
    state = dataFormulatorReducer(state, dfActions.upsertFileNode({ ...file,
      id: "revision", contentHash: "v2", displayName: "Updated CPI", parentNodeId: "later", createdAt: 2,
    }));
    expect(state.textTurns).toEqual([]);
    expect(state.fileNodes).toEqual([{ ...file, contentHash: "v2", displayName: "Updated CPI" }]);
  });

  it("keeps file results after draft cleanup, parent removal, and reload", () => {
    let state = dataFormulatorReducer(undefined, dfActions.addTextTurn({
      kind: "text", id: "request", displayId: "request", textKind: "explain",
      content: "Create a summary", parentNodeId: CONVERSATION_ROOT_ID, createdAt: 1,
    }));
    state = dataFormulatorReducer(state, dfActions.createDraftNode({
      id: "draft", displayId: "draft", parentNodeId: "request",
      parentTableId: CONVERSATION_ROOT_ID, source: [], interaction: [],
    }));
    state = dataFormulatorReducer(state, dfActions.upsertFileNode({
      kind: "file", id: "file", path: "scratch/summary.md", displayName: "Summary",
      contentHash: "hash", parentNodeId: "draft", createdAt: 2,
    }));
    state = dataFormulatorReducer(state, dfActions.removeDraftNode("draft"));
    expect(state.fileNodes[0].parentNodeId).toBe("request");
    state = dataFormulatorReducer(state, dfActions.removeTextTurn("request"));
    expect(state.fileNodes[0].parentNodeId).toBe(CONVERSATION_ROOT_ID);
    const restored = dataFormulatorReducer(undefined, dfActions.loadState(state));
    expect(restored.fileNodes).toEqual(state.fileNodes);
    expect(restored.textTurns).toEqual([]);
    expect(dataFormulatorReducer(undefined, dfActions.loadState({})).fileNodes).toEqual([]);
  });

  it("preserves generalized computation sources on derived tables", () => {
    const withMixedSources = {
      ...derivedTable,
      derive: {
        ...derivedTable.derive,
        inputSources: [
          { id: "data:hash:orders", kind: "data", displayName: "Orders" },
          { id: "file:hash:notes.docx", kind: "file", displayName: "Notes" },
        ],
      },
    };

    const state = dataFormulatorReducer(
      undefined,
      dfActions.insertDerivedTables(withMixedSources as any),
    );

    expect(state.derivedTables[0].derive?.inputSources).toEqual(withMixedSources.derive.inputSources);
    expect(state.derivedTables[0].derive?.source).toEqual(["orders"]);
  });

  it("stores a Flint theme and returns an active custom variant to the base chart", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addChart({
        id: "chart-1",
        chartType: "Bar Chart",
        tableRef: "orders",
        source: "user",
        encodingMap: {},
        activeVariantId: "variant-1",
      } as any)
    );

    state = dataFormulatorReducer(
      state,
      dfActions.setChartTheme({ chartId: "chart-1", themeId: "nyt" })
    );

    expect(state.charts[0].themeId).toBe("nyt");
    expect(state.charts[0].activeVariantId).toBeUndefined();
  });

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
    expect(state.inputTables[0].displayId).toBe("Orders by customer");

    state = dataFormulatorReducer(
      state,
      dfActions.removeTableLocally("orders")
    );
    expect(state.tableSemantics).toEqual([]);
  });

  it("does not replace a manually renamed table with a late inferred name", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTableToStore(sourceTable as any)
    );
    state = dataFormulatorReducer(
      state,
      dfActions.updateTableDisplayId({ tableId: "orders", displayId: "My orders" })
    );
    state = dataFormulatorReducer(
      state,
      fetchFieldSemanticType.fulfilled(
        { result: [{ fields: {}, suggested_table_name: "Suggested orders" }] },
        "request-id",
        sourceTable as any
      )
    );

    expect(state.inputTables[0].displayId).toBe("My orders");
    expect(state.tableSemantics).toEqual([{ tableId: "orders", fields: {} }]);
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

  it("drops the retired mini agent setting from loaded state", () => {
    const state = dataFormulatorReducer(
      undefined,
      dfActions.loadState({
        config: {
          miniMode: true,
          defaultChartWidth: 512,
        },
      })
    );

    expect(state.config.defaultChartWidth).toBe(512);
    expect(state.config).not.toHaveProperty("miniMode");
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

  it("replaces failed drafts under the same parent and transfers focus", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.createDraftNode({
        id: "draft-failed",
        displayId: "Failed",
        parentNodeId: "textTurn-answer",
        parentTableId: "orders",
        source: ["orders"],
        interaction: [],
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.updateDeriveStatus({ nodeId: "draft-failed", status: "error" })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.setFocused({ type: "draft", draftId: "draft-failed" })
    );

    state = dataFormulatorReducer(
      state,
      dfActions.createDraftNode({
        id: "draft-retry",
        displayId: "Retry",
        parentNodeId: "textTurn-answer",
        parentTableId: "orders",
        source: ["orders"],
        interaction: [],
      })
    );

    expect(state.draftNodes.map(draft => draft.id)).toEqual(["draft-retry"]);
    expect(state.focusedId).toEqual({ type: "draft", draftId: "draft-retry" });
  });

  it("retains the Analyst-selected sources on a failed draft", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.createDraftNode({
        id: "draft-failed",
        displayId: "Failed",
        parentNodeId: "textTurn-answer",
        parentTableId: "orders",
        source: ["orders", "customers"],
        interaction: [],
      })
    );

    state = dataFormulatorReducer(
      state,
      dfActions.updateDraftSources({ draftId: "draft-failed", source: ["orders"] })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.updateDeriveStatus({ nodeId: "draft-failed", status: "error" })
    );

    expect(state.draftNodes[0].derive.source).toEqual(["orders"]);
  });

  it("clears an orphaned continuation answer when its failed draft is deleted", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-answer",
        displayId: "Answer",
        textKind: "explain",
        content: "Previous explanation",
        parentNodeId: "orders",
        answered: true,
        answer: "visualize conversation turns",
        createdAt: 1,
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.createDraftNode({
        id: "draft-failed",
        displayId: "Failed",
        parentNodeId: "textTurn-answer",
        parentTableId: "orders",
        source: ["orders"],
        interaction: [],
      })
    );

    state = dataFormulatorReducer(state, dfActions.removeDraftNode("draft-failed"));

    expect(state.textTurns[0].answered).toBe(false);
    expect(state.textTurns[0]).not.toHaveProperty("answer");
  });

  it("keeps a continuation answer when another child artifact remains", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-answer",
        displayId: "Answer",
        textKind: "explain",
        content: "Previous explanation",
        parentNodeId: "orders",
        answered: true,
        answer: "visualize conversation turns",
        createdAt: 1,
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.createDraftNode({
        id: "draft-failed",
        displayId: "Failed",
        parentNodeId: "textTurn-answer",
        parentTableId: "orders",
        source: ["orders"],
        interaction: [],
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-child",
        displayId: "Child",
        textKind: "explain",
        content: "Another response",
        parentNodeId: "textTurn-answer",
        createdAt: 2,
      })
    );

    state = dataFormulatorReducer(state, dfActions.removeDraftNode("draft-failed"));

    expect(state.textTurns[0].answered).toBe(true);
    expect(state.textTurns[0].answer).toBe("visualize conversation turns");
  });

  it("resolves focused draft canvas context through its parent turn", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTableToStore(sourceTable as any)
    );
    state = dataFormulatorReducer(
      state,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-answer",
        displayId: "Answer",
        textKind: "explain",
        content: "Previous explanation",
        parentNodeId: "orders",
        createdAt: 1,
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.createDraftNode({
        id: "draft-failed",
        displayId: "Failed",
        parentNodeId: "textTurn-answer",
        parentTableId: "orders",
        source: ["orders"],
        interaction: [],
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.setFocused({ type: "draft", draftId: "draft-failed" })
    );

    expect(dfSelectors.getEffectiveTableId(state)).toBe("orders");
    expect(dfSelectors.selectCanvasTarget(state)).toEqual({ type: "table", tableId: "orders" });
  });

  it("passes workspace file focus through to the canvas without a table context", () => {
    const state = dataFormulatorReducer(
      undefined,
      dfActions.setFocused({ type: "file", fileName: "notes.docx" })
    );

    expect(dfSelectors.selectCanvasTarget(state)).toEqual({ type: "file", fileName: "notes.docx" });
    expect(dfSelectors.getEffectiveTableId(state)).toBeUndefined();
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

  it("removes a terminal response's paired follow-up question", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-parent",
        displayId: "Parent response",
        textKind: "explain",
        content: "How can I help?",
        parentNodeId: "root",
        answered: true,
        answer: "Tell me more",
        createdAt: 1,
      })
    );
    state = dataFormulatorReducer(
      state,
      dfActions.addTextTurn({
        kind: "text",
        id: "textTurn-child",
        displayId: "Child response",
        textKind: "explain",
        content: "Here is more detail.",
        parentNodeId: "textTurn-parent",
        createdAt: 2,
      })
    );

    state = dataFormulatorReducer(state, dfActions.removeTextTurn("textTurn-child"));

    expect(state.textTurns).toEqual([
      expect.objectContaining({
        id: "textTurn-parent",
        answered: false,
      }),
    ]);
    expect(state.textTurns[0]).not.toHaveProperty("answer");
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
    expect(state.draftNodes[0].derive.source).toEqual([]);
  });

  it("removes deleted data provenance while retaining file provenance", () => {
    let state = dataFormulatorReducer(
      undefined,
      dfActions.addTableToStore(sourceTable as any)
    );
    state = dataFormulatorReducer(
      state,
      dfActions.insertDerivedTables({
        ...derivedTable,
        derive: {
          ...derivedTable.derive,
          inputSources: [
            { id: "data:orders-v1:orders_workspace", kind: "data", displayName: "orders_workspace" },
            { id: "file:docx-v1:notes.docx", kind: "file", displayName: "notes.docx" },
          ],
        },
      } as any)
    );
    state = dataFormulatorReducer(
      state,
      dfActions.addChart({
        id: "chart-summary",
        chartType: "Bar Chart",
        tableRef: "summary",
        source: "user",
        encodingMap: {},
      } as any)
    );

    state = dataFormulatorReducer(state, dfActions.removeTableLocally("orders"));

    expect(state.derivedTables[0].derive?.source).toEqual([]);
    expect(state.derivedTables[0].derive?.trigger.tableId).toBe('conversation-root:orders');
    expect(state.derivedTables[0].derive?.inputSources).toEqual([
      { id: "file:docx-v1:notes.docx", kind: "file", displayName: "notes.docx" },
    ]);
  });
});

describe("text artifact canvas ownership", () => {
  it.each(["explicit", "ancestry"])("preserves the chart for an ordinary explanation with %s provenance", (provenance) => {
    const state = {
      ...dataFormulatorReducer(undefined, dfActions.addTableToStore(sourceTable as any)),
      focusedId: { type: "text", textId: "closing-answer" },
      charts: [{ id: "chart-1", chartType: "Bar Chart", tableRef: "orders", source: "user", encodingMap: {} }],
      textTurns: [
        { kind: "text", id: "previous-answer", displayId: "previous-answer", textKind: "explain",
          content: "Previous iteration", parentNodeId: "orders", createdAt: 1 },
        { kind: "text", id: "closing-answer", displayId: "closing-answer", textKind: "explain",
          content: "Detailed chart findings.\n".repeat(200), parentNodeId: "previous-answer", createdAt: 2,
          ...(provenance === "explicit" ? { sourceChartId: "chart-1" } : {}) },
      ],
    };
    expect(dfSelectors.selectCanvasTarget(state as any)).toEqual({ type: "chart", chartId: "chart-1" });
    const expandedState = { ...state, textTurns: state.textTurns.map(turn =>
      turn.id === "closing-answer" ? { ...turn, presentation: "long_response" } : turn) };
    expect(dfSelectors.selectCanvasTarget(expandedState as any)).toEqual({ type: "text", textId: "closing-answer" });
  });

  it.each([
    ["form", { form: { kind: "connector", title: "Connect", connector: { sourceType: "kusto", status: "pending" } } }],
    ["data operation", { dataOperation: { id: "operation-1", plans: [] } }],
  ])("opens conversation when selecting an explanation after a %s", (_label, artifact) => {
    const state = {
      ...dataFormulatorReducer(undefined, { type: "test/init" }),
      focusedId: { type: "text", textId: "explanation-1" },
      textTurns: [
        {
          kind: "text", id: "artifact-1", displayId: "artifact-1",
          textKind: "explain", content: "Artifact", parentNodeId: "root",
          createdAt: 1, ...artifact,
        },
        {
          kind: "text", id: "explanation-1", displayId: "explanation-1",
          textKind: "explain", content: "Follow-up", parentNodeId: "artifact-1",
          createdAt: 2,
        },
      ],
    };

    expect(dfSelectors.selectCanvasTarget(state as any)).toEqual({
      type: "text",
      textId: "artifact-1",
    });
  });
});
