import { describe, expect, it } from "vitest";

import {
  toAnalystTableRef,
  workspaceTableIdOf,
} from "../../../../src/app/tableResolution";
import type { InputTable } from "../../../../src/components/ComponentType";

const inputTable = (overrides: Partial<InputTable> = {}): InputTable => ({
  kind: "input-table",
  id: "consumer_price_index",
  displayId: "美国消费品价格",
  source: { kind: "workspace", tableId: "consumer_price_index" },
  snapshot: {
    columns: [
      { name: "Month", type: "date" as any },
      { name: "price", type: "number" as any },
    ],
    rowCount: 246,
    capturedAt: 1,
  },
  description: "",
  addedAt: 1,
  ...overrides,
});

describe("workspaceTableIdOf", () => {
  it("uses the workspace table id for workspace-backed inputs", () => {
    expect(workspaceTableIdOf(inputTable())).toBe("consumer_price_index");
  });

  it("uses the materialized copy for connector-backed inputs", () => {
    const table = inputTable({
      source: {
        kind: "connector",
        connectorId: "sample_datasets",
        sourceTable: { id: "Consumer Price Index", name: "Consumer Price Index" },
        path: [],
        workspaceTableId: "consumer_price_index_2",
      },
    });
    expect(workspaceTableIdOf(table)).toBe("consumer_price_index_2");
  });

  it("falls back to the entry id when a connector input is not materialized", () => {
    const table = inputTable({
      source: {
        kind: "connector",
        connectorId: "sample_datasets",
        sourceTable: { id: "cpi", name: "cpi" },
        path: [],
      },
    });
    expect(workspaceTableIdOf(table)).toBe("consumer_price_index");
  });
});

describe("toAnalystTableRef", () => {
  it("sends the workspace id, the user-facing name, and the snapshot schema", () => {
    expect(toAnalystTableRef(inputTable())).toEqual({
      name: "consumer_price_index",
      display_name: "美国消费品价格",
      row_count: 246,
      columns: [
        { name: "Month", type: "date" },
        { name: "price", type: "number" },
      ],
    });
  });

  it("omits row_count when the snapshot has no known count", () => {
    const ref = toAnalystTableRef(
      inputTable({
        snapshot: { columns: [], rowCount: null, capturedAt: 1 },
      }),
    );
    expect(ref).not.toHaveProperty("row_count");
  });

  it("never carries preview rows", () => {
    expect(JSON.stringify(toAnalystTableRef(inputTable()))).not.toContain("rows");
  });
});
