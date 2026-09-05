// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ComputationInputSource, ROOTLESS_THREAD_ID } from '../components/ComponentType';

export function shouldAutoFocusGeneratedChart(userChartFocusLocked: boolean): boolean {
    return !userChartFocusLocked;
}

export function resolveRunParentNodeId(
    continuationParentNodeId: string | null | undefined,
    focusedConversationNodeId?: string | null,
): string {
    return continuationParentNodeId || focusedConversationNodeId || ROOTLESS_THREAD_ID;
}

export function resolveDerivedTriggerTableId(
    lastCreatedTableId: string | null,
    sourceTableId: string | undefined,
): string {
    return lastCreatedTableId || sourceTableId || ROOTLESS_THREAD_ID;
}

export type InputSourceTransition = 'none' | 'initial' | 'continue' | 'merge' | 'switch';

export function classifyInputSourceTransition(
    previous: ComputationInputSource[],
    current: ComputationInputSource[],
): InputSourceTransition {
    if (current.length === 0) return 'none';
    if (previous.length === 0) return 'initial';
    const previousIds = new Set(previous.map(source => source.id));
    const currentIds = new Set(current.map(source => source.id));
    const same = previousIds.size === currentIds.size
        && [...previousIds].every(id => currentIds.has(id));
    if (same) return 'continue';
    return current.some(source => previousIds.has(source.id)) ? 'merge' : 'switch';
}
