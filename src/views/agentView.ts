// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** The agent's `view` requests (workspace skill): what it asked to see, and how the thread records it. */

import type { Chart, ToolCall } from '../components/ComponentType';

export interface ViewTarget {
    path: string; kind: 'chart' | 'map' | 'app'; id?: string; name?: string;
    /** For a map, the size (CSS pixels) to draw it at; by default a report embed's (or larger, drawn sharper). */
    width?: number; height?: number;
    /** For a map, shorten the picture to the map (see MapSnapshot's fitHeight). */
    fitHeight?: boolean;
}
export interface ViewRequest { id: string; targets: ViewTarget[]; problems?: string[] }
export interface ViewResult {
    path: string; image?: string; error?: string;
    /** The picture's pixels per CSS pixel, when known: its drawn size is its pixel size over this. */
    density?: number;
}

/** The tool name a view is recorded under on the step's message. */
export const VIEW_TOOL = 'view';

/** An item's name for the thread: a chart's title, a file's display name, or its name without its kind's suffix. */
export const viewItemName = (target: ViewTarget, charts: Chart[], files: { path: string; displayName?: string }[] = []) => {
    if (target.kind === 'chart') return charts.find(chart => chart.id === target.id)?.title || 'a chart';
    const name = target.name || target.path.replace(/^files\//, '');
    return files.find(file => file.path === name)?.displayName || name.replace(/\.(app\.jsx|map\.json|html)$/i, '');
};

export const viewCallRecord = (request: ViewRequest, status: ToolCall['status'], results?: ViewResult[]): ToolCall => ({
    id: request.id, tool: VIEW_TOOL, createdAt: Date.now(), status,
    args: { paths: request.targets.map(target => target.path) },
    ...(results ? { output: results.map(result => `${result.path}: ${result.image ? 'drawn' : `not drawn (${result.error})`}`).join('\n') } : {}),
});
