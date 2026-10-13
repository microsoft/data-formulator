// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ComputationInputSource, createConversationRootId } from '../components/ComponentType';
import type { ThreadGraph } from './threadGraph';

export function shouldAutoFocusGeneratedChart(userChartFocusLocked: boolean): boolean {
    return !userChartFocusLocked;
}

export function resolveRunParentNodeId(
    continuationParentNodeId: string | null | undefined,
    focusedConversationNodeId?: string | null,
    newConversationRootId?: string,
): string {
    return continuationParentNodeId || focusedConversationNodeId || newConversationRootId || createConversationRootId();
}

/**
 * Where a request continues from (design-docs/58, rule 3). A focused message is
 * followed directly. A focused item (a derived table, an app or file, a report,
 * a reference) continues its open conversation: the newest message after the
 * item that nothing has been produced from yet. When there is none (nothing
 * follows, or every conversation after it already led to another item), the
 * request starts from the item itself.
 */
export function resolveConversationParentNodeId(
    focusedTurnId: string | null | undefined,
    focusedItemId: string | null | undefined,
    graph: ThreadGraph,
    canContinue: (turnId: string) => boolean = () => true,
): string | undefined {
    if (focusedTurnId && graph.kindOf(focusedTurnId) === 'turn') return focusedTurnId;
    if (!focusedItemId) return undefined;
    const producesItem = (id: string, seen = new Set<string>()): boolean => graph.childrenOf(id).some(child =>
        !seen.has(child.id) && (seen.add(child.id), graph.isItem(child.id) || producesItem(child.id, seen)));
    let open: { id: string; createdAt: number } | undefined;
    for (const node of graph.nodes.values()) {
        // A workflow proposal is a reply too, so it can be the open end.
        if ((node.kind !== 'turn' && node.kind !== 'workflow-definition') || !canContinue(node.id)
            || graph.nearestItem(node.id, { includeSelf: false }) !== focusedItemId) continue;
        if (open && node.createdAt <= open.createdAt) continue;
        if (!producesItem(node.id)) open = node;
    }
    return open?.id;
}

export function resolveDerivedTriggerTableId(
    lastCreatedTableId: string | null,
    sourceTableId: string | undefined,
    conversationRootId: string,
): string {
    return lastCreatedTableId || sourceTableId || conversationRootId;
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
