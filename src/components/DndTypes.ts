// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Drag-and-drop item types and interfaces shared across components. */

/** DnD item type for catalog table nodes dragged from the sidebar. */
export const CATALOG_TABLE_ITEM = 'catalog-table';

export interface CatalogTableDragItem {
    type: typeof CATALOG_TABLE_ITEM;
    connectorId: string;
    tableName: string;
    tableId?: string;
    tablePath: string[];
    sourceType: string;
}
