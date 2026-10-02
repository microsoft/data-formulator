// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors } from './dfSlice';
import { getUrls } from './utils';
import { apiRequest } from './apiClient';
import { updateWorkspaceMeta } from './workspaceService';
import { AppDispatch } from './store';

/** Wait for a burst of sources (e.g. a batch import) to settle before naming. */
const SETTLE_MS = 2000;
const FILE_ITEM_PREFIX = 'workspace-file-';

/** The name a session starts with, until its sources give it a better one. */
export function defaultSessionName(date = new Date()): string {
    return `Analysis Session · ${date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

/** Whether auto-naming still owns the name, i.e. the user never renamed the session. */
export function isAutoNamed(workspace: NonNullable<DataFormulatorState['activeWorkspace']>): boolean {
    return workspace.displayName === 'Untitled Session' || workspace.displayName === workspace.autoName?.name;
}

/** Newline-joined names of the session's sources: loaded tables, connector references, and files. */
export function selectSessionSourceKey(state: DataFormulatorState): string {
    return [
        ...(state.inputTables ?? []).map(table => table.displayId || table.id),
        ...(state.externalTableReferences ?? []).map(reference => reference.displayName),
        ...(state.workspaceItemOrder ?? []).filter(key => key.startsWith(FILE_ITEM_PREFIX))
            .map(key => key.slice(FILE_ITEM_PREFIX.length)).filter(name => !name.startsWith('scratch/')),
    ].join('\n');
}

/**
 * Names the session after its sources with the LLM, and renames it as new
 * sources arrive, until the user renames it themselves.
 */
export function useWorkspaceAutoName() {
    const dispatch = useDispatch<AppDispatch>();
    const workspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const sourceKey = useSelector(selectSessionSourceKey);
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);
    const textTurns = useSelector((state: DataFormulatorState) => state.textTurns);
    const models = useSelector(dfSelectors.getAllModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const latest = useRef(workspace);
    latest.current = workspace;
    const inFlight = useRef(false);
    const failedAttempt = useRef('');
    const [settled, setSettled] = useState(0);

    useEffect(() => {
        if (!workspace || workspace.readOnly || inFlight.current || !isAutoNamed(workspace)) return;
        const sources = sourceKey ? sourceKey.split('\n') : [];
        const named = new Set(workspace.autoName?.sources ?? []);
        if (!sources.some(name => !named.has(name))) return;
        const attempt = `${workspace.id}\n${sourceKey}`;
        if (failedAttempt.current === attempt) return;
        const model = models.find(m => m.id === selectedModelId);
        if (!model) return;

        const timer = window.setTimeout(async () => {
            inFlight.current = true;
            const { id, displayName } = workspace;
            // The first user prompt, preferring turns: a draft is deleted when its
            // run completes, so its interaction log may already be gone.
            const firstTurnPrompt = [...textTurns]
                .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
                .map(turn => turn.prompt)
                .find(prompt => !!prompt);
            const firstInteraction = draftNodes
                .flatMap(n => n.derive?.trigger?.interaction || [])
                .find(entry => entry.from === 'user' && (entry.role === 'prompt' || entry.role === 'instruction'));
            try {
                const { data } = await apiRequest<{ display_name: string }>(getUrls().WORKSPACE_NAME, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model,
                        context: { tables: sources, userQuery: firstTurnPrompt || firstInteraction?.content || '' },
                    }),
                });
                const name = data.display_name?.trim();
                if (!name) throw new Error('Empty session name');
                // Skip if the user renamed or left the session meanwhile.
                if (latest.current?.id === id && latest.current.displayName === displayName) {
                    dispatch(dfActions.setAutoWorkspaceName({ id, displayName: name, sources }));
                    updateWorkspaceMeta(id, name).catch(() => {});
                }
            } catch (e) {
                failedAttempt.current = attempt;
                console.warn('[auto-name] failed:', e);
            } finally {
                inFlight.current = false;
                // Sources that arrived during the request still need a name.
                setSettled(value => value + 1);
            }
        }, SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [workspace, sourceKey, selectedModelId, settled]);
}
