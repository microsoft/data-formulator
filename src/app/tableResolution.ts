// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DictTable, InputTable } from "../components/ComponentType";
import { getInputTablePreview } from "./inputTablePreviewCache";

/** The durable workspace table the input resolves to — what the backend reads. */
export const workspaceTableIdOf = (table: InputTable): string =>
  table.source.kind === "workspace"
    ? table.source.tableId
    : table.source.workspaceTableId ?? table.id;

/** How an input table is referenced in an analyst request. */
export interface AnalystTableRef {
  name: string;
  display_name: string;
  columns: { name: string; type: string }[];
  row_count?: number;
}

export const toAnalystTableRef = (table: InputTable): AnalystTableRef => ({
  name: workspaceTableIdOf(table),
  display_name: table.displayId || table.id,
  columns: table.snapshot.columns.map((column) => ({
    name: column.name,
    type: String(column.type ?? "unknown"),
  })),
  ...(table.snapshot.rowCount != null ? { row_count: table.snapshot.rowCount } : {}),
});

export const materializeInputTablePreview = (table: InputTable): DictTable => ({
  kind: "table",
  id: table.id,
  displayId: table.displayId,
  names: table.snapshot.columns.map((column) => column.name),
  metadata: Object.fromEntries(
    table.snapshot.columns.map(
      ({ name, sourceType: _sourceType, ...metadata }) => [
        name,
        { ...metadata, levels: metadata.levels ?? [] },
      ]
    )
  ),
  rows: getInputTablePreview(table)?.rows ?? [],
  virtual: {
    tableId: workspaceTableIdOf(table),
    rowCount: table.snapshot.rowCount ?? 0,
  },
  description: table.description,
  source: table.sourceConfig,
  contentHash: table.snapshot.contentHash,
});

export const materializeTables = (
  inputTables: InputTable[],
  derivedTables: DictTable[]
): DictTable[] => [
  ...inputTables.map(materializeInputTablePreview),
  ...derivedTables,
];
