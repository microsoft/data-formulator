// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors } from './dfSlice';
import { getUrls } from './utils';
import { apiRequest } from './apiClient';
import { updateWorkspaceMeta } from './workspaceService';
import { AppDispatch } from './store';

/**
 * Auto-names a workspace after the first table is loaded,
 * if the workspace still has its auto-generated timestamp name.
 *
 * Calls the LLM to generate a short 3-5 word summary based on
 * table names and the first user query (if any).
 */
export function useWorkspaceAutoName() {
    const dispatch = useDispatch<AppDispatch>();
    const activeWorkspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);
    const models = useSelector(dfSelectors.getAllModels);
    const selectedModelId = useSelector((state: DataFormulatorState) => state.selectedModelId);
    const calledRef = useRef(false);
    const lastWsIdRef = useRef<string | null>(null);

    useEffect(() => {
        // Reset when workspace changes
        if (activeWorkspace?.id !== lastWsIdRef.current) {
            calledRef.current = false;
            lastWsIdRef.current = activeWorkspace?.id ?? null;
        }

        // Only auto-name once per workspace
        if (calledRef.current) return;

        // Need: active workspace with timestamp name, at least one table, a model selected
        if (!activeWorkspace) return;
        if (tables.length === 0) return;
        if (!selectedModelId) return;

        // Only auto-name if the display name is still the placeholder
        if (activeWorkspace.displayName !== 'Untitled Session') return;

        const model = models.find(m => m.id === selectedModelId);
        if (!model) return;

        calledRef.current = true;

        // Gather context
        const tableNames = tables.map(t => t.displayId || t.id);
        // Find the first user query from draft nodes' interaction log
        const firstInteraction = draftNodes
            .flatMap(n => n.derive?.trigger?.interaction || [])
            .find(entry => entry.from === 'user' && (entry.role === 'prompt' || entry.role === 'instruction'));
        const firstQuery = firstInteraction?.content || '';

        const wsId = activeWorkspace.id;

        (async () => {
            try {
                const { data } = await apiRequest<{ summary: string }>(getUrls().WORKSPACE_SUMMARY, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model,
                        context: {
                            tables: tableNames,
                            userQuery: firstQuery,
                        },
                    }),
                });
                if (data.summary) {
                    dispatch(dfActions.setActiveWorkspace({ id: wsId, displayName: data.summary }));
                    updateWorkspaceMeta(wsId, data.summary).catch(() => {});
                }
            } catch (e) {
                // Best-effort: keep the timestamp name if auto-naming fails
                console.warn('[auto-name] failed:', e);
            }
        })();
    }, [activeWorkspace, tables.length, selectedModelId, draftNodes.length]);
}
