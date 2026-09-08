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

type ConversationTurnRef = {
    id: string;
    parentNodeId: string;
    createdAt: number;
};

export function resolveConversationParentNodeId(
    focusedTurnId: string | null | undefined,
    focusedTableId: string | null | undefined,
    textTurns: ConversationTurnRef[],
    tableIds: string[],
): string | undefined {
    if (focusedTurnId && textTurns.some(turn => turn.id === focusedTurnId)) {
        return focusedTurnId;
    }
    if (!focusedTableId) return undefined;

    const turnsById = new Map(textTurns.map(turn => [turn.id, turn]));
    const knownTableIds = new Set(tableIds);
    const belongsToFocusedTable = (turn: ConversationTurnRef) => {
        let parentId: string | undefined = turn.parentNodeId;
        const seen = new Set<string>();
        while (parentId && !seen.has(parentId)) {
            if (parentId === focusedTableId) return true;
            if (knownTableIds.has(parentId)) return false;
            seen.add(parentId);
            parentId = turnsById.get(parentId)?.parentNodeId;
        }
        return false;
    };

    return textTurns
        .filter(belongsToFocusedTable)
        .sort((left, right) => right.createdAt - left.createdAt)[0]?.id;
}

export function resolveDerivedTriggerTableId(
    lastCreatedTableId: string | null,
    sourceTableId: string | undefined,
): string {
    return lastCreatedTableId || sourceTableId || ROOTLESS_THREAD_ID;
}

export type InputSourceTransition = 'none' | 'initial' | 'continue' | 'merge' | 'switch';

export function shouldShowInputSourceTransition(
    transition: InputSourceTransition,
    triggerTableId: string | undefined,
    inputSourceTableIds: Array<string | undefined>,
): boolean {
    if (transition === 'none' || transition === 'continue') return false;
    const repeatsTrigger = inputSourceTableIds.length > 0
        && inputSourceTableIds.every(tableId => !!tableId && tableId === triggerTableId);
    return !repeatsTrigger;
}

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
