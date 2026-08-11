// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DictTable, InputTable } from "../components/ComponentType";
import { getInputTablePreview } from "./inputTablePreviewCache";

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
    tableId:
      table.source.kind === "workspace"
        ? table.source.tableId
        : table.source.workspaceTableId ?? table.id,
    rowCount: table.snapshot.rowCount ?? 0,
  },
  description: table.description,
  source: table.sourceConfig,
  ...(table.threadParentId ? { threadParentId: table.threadParentId } : {}),
  contentHash: table.snapshot.contentHash,
});

export const materializeTables = (
  inputTables: InputTable[],
  derivedTables: DictTable[]
): DictTable[] => [
  ...inputTables.map(materializeInputTablePreview),
  ...derivedTables,
];
