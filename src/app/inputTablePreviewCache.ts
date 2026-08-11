// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InputTable, InputTablePreview } from '../components/ComponentType';

export const INPUT_TABLE_PREVIEW_ROW_LIMIT = 10;

const previewCache = new Map<string, InputTablePreview>();

const getPreviewKey = (table: InputTable): string => {
    const version = table.snapshot.contentHash ?? table.snapshot.capturedAt;
    return `${table.id}:${version}`;
};

export const getInputTablePreview = (table: InputTable): InputTablePreview | undefined =>
    previewCache.get(getPreviewKey(table));

export const setInputTablePreview = (
    table: InputTable,
    rows: Record<string, unknown>[],
    fetchedAt: number = Date.now(),
): InputTablePreview => {
    invalidateInputTablePreview(table.id);
    const preview: InputTablePreview = {
        tableId: table.id,
        rows: rows.slice(0, INPUT_TABLE_PREVIEW_ROW_LIMIT),
        fetchedAt,
        ...(table.snapshot.contentHash ? { contentHash: table.snapshot.contentHash } : {}),
    };
    previewCache.set(getPreviewKey(table), preview);
    return preview;
};

export const invalidateInputTablePreview = (tableId: string): void => {
    for (const key of previewCache.keys()) {
        if (key.startsWith(`${tableId}:`)) previewCache.delete(key);
    }
};

export const clearInputTablePreviewCache = (): void => previewCache.clear();