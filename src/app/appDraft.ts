// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The code of the app a run is writing, as its draft shows it: the last few lines with every visible character
 * masked (`x`), from the stream's `artifact_draft` events. What is being written (tool, title, start) is on the draft
 * node (`derive.writing`); these lines are kept out of the Redux state: they change several times a second and
 * are never saved.
 */

import { useSyncExternalStore } from 'react';

export interface AppDraftLines {
    /** The run's draft node writing the app. */
    draftId: string;
    lines: string[];
    lineCount: number;
}

let current: AppDraftLines | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** The masked lines a draft node's run has written so far, or null. */
export const useAppDraftLines = (draftId: string | undefined) => {
    const snapshot = () => (current && current.draftId === draftId ? current : null);
    return useSyncExternalStore(subscribe, snapshot, snapshot);
};

/** Take an `artifact_draft` stream event's lines for a draft node. */
export function updateAppDraftLines(draftId: string, event: { lines?: unknown; line_count?: unknown }) {
    if (!Array.isArray(event.lines)) return;
    const lines = event.lines.filter((line): line is string => typeof line === 'string');
    current = { draftId, lines, lineCount: typeof event.line_count === 'number' ? event.line_count : lines.length };
    emit();
}

/** Drop the lines (of this draft only, when given). */
export function clearAppDraftLines(draftId?: string) {
    if (!current || (draftId !== undefined && current.draftId !== draftId)) return;
    current = null;
    emit();
}

/** The masked shape of code, as the agent sends it (`_ArtifactDraftPreview`): visible characters as `x`, the last lines. */
export function maskAppCode(code: string, lastLines = 12, width = 96): { lines: string[]; lineCount: number } {
    const all = code.replace(/\r/g, '').split('\n');
    const lines = all.slice(-lastLines).map(line => line.replace(/\t/g, '  ').replace(/\S/g, 'x').replace(/\s/g, ' ').slice(0, width));
    return { lines, lineCount: all.length };
}
