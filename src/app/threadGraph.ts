// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The thread as one graph (design-docs/58). Items (tables, loaded and virtual
 * tables, files and apps, reports, workflow definitions, artifact sets) and
 * messages (turns, and the draft at the open end of a run) are all nodes with
 * one parent link, `parentNodeId`. Edges between items are a view: the run of
 * messages from one item to the next.
 *
 * Source tables are roots. Data lineage (`derive.source`) is not part of this
 * graph; it decides refresh and the "Using sources" note, never placement.
 */

import { createConversationRootId, isConversationRootId } from '../components/ComponentType';

export type ThreadItemKind = 'table' | 'loaded-table' | 'file' | 'report' | 'workflow-definition' | 'artifact-set';
export type ThreadMessageKind = 'turn' | 'draft';
export type ThreadNodeKind = ThreadItemKind | ThreadMessageKind;

export interface ThreadGraphNode {
    id: string;
    kind: ThreadNodeKind;
    parentId?: string;
    createdAt: number;
    /** The artifact set this node is a member of. */
    setId?: string;
    /** For loaded-table nodes: the table they point at. */
    tableId?: string;
}

type Edge = { id: string; parentNodeId?: string; createdAt?: number };

export interface ThreadGraphInput {
    tables: (Edge & { derive?: { trigger: { tableId: string } } })[];
    turns?: (Edge & { form?: { kind: string } })[];
    drafts?: Edge[];
    loadedNodes?: (Edge & { tableId: string; external?: boolean })[];
    fileNodes?: Edge[];
    reports?: Edge[];
    artifactSets?: (Edge & { memberIds: string[] })[];
}

const ITEM_KINDS: ReadonlySet<ThreadNodeKind> = new Set<ThreadNodeKind>(
    ['table', 'loaded-table', 'file', 'report', 'workflow-definition', 'artifact-set']);

export class ThreadGraph {
    readonly nodes: ReadonlyMap<string, ThreadGraphNode>;
    private readonly children = new Map<string, ThreadGraphNode[]>();
    private readonly members = new Map<string, string[]>();

    constructor(input: ThreadGraphInput) {
        const nodes = new Map<string, ThreadGraphNode>();
        let order = 0;
        const orderOf = new Map<string, number>();
        const add = (kind: ThreadNodeKind, item: Edge, parentId = item.parentNodeId, extra: Partial<ThreadGraphNode> = {}) => {
            nodes.set(item.id, { id: item.id, kind, parentId: parentId || undefined, createdAt: item.createdAt ?? 0, ...extra });
            orderOf.set(item.id, order++);
        };
        // A derived table without an authored edge predates design-docs/42; its trigger stands in.
        for (const table of input.tables) add('table', table, table.parentNodeId || table.derive?.trigger.tableId);
        for (const turn of input.turns || []) add(turn.form?.kind === 'workflow' ? 'workflow-definition' : 'turn', turn);
        for (const draft of input.drafts || []) add('draft', draft);
        for (const node of input.loadedNodes || []) add('loaded-table', node, node.parentNodeId, { tableId: node.tableId });
        for (const file of input.fileNodes || []) add('file', file);
        for (const report of input.reports || []) add('report', report);
        for (const set of input.artifactSets || []) {
            add('artifact-set', set);
            this.members.set(set.id, set.memberIds.filter(id => nodes.has(id)));
            for (const id of set.memberIds) {
                const member = nodes.get(id);
                if (member) nodes.set(id, { ...member, setId: set.id, parentId: set.id });
            }
        }
        // A parent cycle (from state written by an older bug) has no start. Cut each
        // at its oldest node, which then starts the conversation, so the rest reads
        // in order after it.
        const settled = new Set<string>();
        for (const node of nodes.values()) {
            const path: string[] = [];
            const onPath = new Set<string>();
            let current: string | undefined = node.id;
            while (current && nodes.has(current) && !settled.has(current) && !onPath.has(current)) {
                path.push(current);
                onPath.add(current);
                current = nodes.get(current)!.parentId;
            }
            if (current && onPath.has(current)) {
                const cycle = path.slice(path.indexOf(current)).map(id => nodes.get(id)!);
                const oldest = cycle.reduce((a, b) => b.createdAt < a.createdAt
                    || (b.createdAt === a.createdAt && orderOf.get(b.id)! < orderOf.get(a.id)!) ? b : a);
                nodes.set(oldest.id, { ...oldest, parentId: createConversationRootId(oldest.id) });
            }
            path.forEach(id => settled.add(id));
        }
        this.nodes = nodes;
        for (const node of nodes.values()) {
            if (!node.parentId) continue;
            this.children.set(node.parentId, [...(this.children.get(node.parentId) || []), node]);
        }
        for (const list of this.children.values()) {
            list.sort((a, b) => a.createdAt - b.createdAt || orderOf.get(a.id)! - orderOf.get(b.id)!);
        }
    }

    kindOf(id: string | undefined): ThreadNodeKind | undefined {
        return id ? this.nodes.get(id)?.kind : undefined;
    }

    parentOf(id: string | undefined): string | undefined {
        return id ? this.nodes.get(id)?.parentId : undefined;
    }

    isItem(id: string | undefined): boolean {
        const kind = this.kindOf(id);
        return !!kind && ITEM_KINDS.has(kind);
    }

    isMessage(id: string | undefined): boolean {
        const kind = this.kindOf(id);
        return kind === 'turn' || kind === 'draft';
    }

    /** Every direct child, oldest first; for an artifact set this includes its members. */
    childrenOf(id: string): ThreadGraphNode[] {
        return this.children.get(id) || [];
    }

    /** The nodes that continue the thread after `id`, oldest first. Set members are not followers. */
    followersOf(id: string): ThreadGraphNode[] {
        return this.childrenOf(id).filter(node => node.setId !== id);
    }

    /** Members of an artifact set, in the order they were produced. */
    membersOf(setId: string): string[] {
        return this.members.get(setId) || [];
    }

    /**
     * The chain above `id`, nearest first. It ends at a conversation root or at
     * the first id the graph does not know (both included), and stops at a cycle.
     */
    ancestors(id: string | undefined, { includeSelf = false } = {}): string[] {
        const chain: string[] = [];
        const seen = new Set<string>();
        let current = id;
        if (current && !includeSelf) {
            seen.add(current);
            current = this.parentOf(current);
        }
        while (current && !seen.has(current)) {
            seen.add(current);
            chain.push(current);
            current = this.parentOf(current);
        }
        return chain;
    }

    /** The nearest item at or above `id` (rule 2: a message shows the item before it). */
    nearestItem(id: string | undefined, { includeSelf = true } = {}): string | undefined {
        return this.ancestors(id, { includeSelf }).find(current => this.isItem(current));
    }

    /** The nearest table at or above `id`, following a loaded reference to the table it points at. */
    tableOf(id: string | undefined): string | undefined {
        for (const current of this.ancestors(id, { includeSelf: true })) {
            const node = this.nodes.get(current);
            if (node?.kind === 'table') return current;
            if (node?.kind === 'loaded-table') return node.tableId;
            if (node?.kind === 'artifact-set') {
                const member = this.membersOf(current).map(memberId => this.nodes.get(memberId))
                    .find(candidate => candidate?.kind === 'table' || candidate?.kind === 'loaded-table');
                if (member) return member.kind === 'table' ? member.id : member.tableId;
            }
        }
        return undefined;
    }

    /** Where a follow-up on `id` attaches: a member of an artifact set continues from the set (rule 9). */
    continuationOf(id: string | undefined): string | undefined {
        if (!id) return undefined;
        return this.nodes.get(id)?.setId ?? id;
    }

    /**
     * The start of the thread `id` belongs to: a conversation root, or the
     * topmost node above it. A chain that breaks (a deleted parent, a missing
     * edge, a cycle) gets a conversation root named after the break so it still
     * renders somewhere.
     */
    rootOf(id: string): string {
        const seen = new Set<string>();
        let current: string | undefined = id;
        while (current && !seen.has(current)) {
            seen.add(current);
            if (isConversationRootId(current)) return current;
            const node = this.nodes.get(current);
            if (!node) return createConversationRootId(current);
            if (!node.parentId) return current;
            current = node.parentId;
        }
        return createConversationRootId(id);
    }

    /** The messages leading into `id` from the item before it, oldest first. */
    edgeInto(id: string): string[] {
        const messages: string[] = [];
        for (const current of this.ancestors(id)) {
            if (!this.isMessage(current)) break;
            messages.unshift(current);
        }
        return messages;
    }

    /** Nodes whose authored parent no longer exists; the thread can only place them on a fallback root. */
    danglingNodes(): string[] {
        return [...this.nodes.values()]
            .filter(node => node.parentId && !isConversationRootId(node.parentId) && !this.nodes.has(node.parentId))
            .map(node => node.id);
    }
}

export const buildThreadGraph = (input: ThreadGraphInput) => new ThreadGraph(input);

export interface ThreadSpec {
    key: string;
    /** The conversation root or topmost node this thread descends from. */
    rootId: string;
    /** The node this thread branched from, when it is not the first follower there. */
    branchFromId?: string;
    /** The thread's nodes in order; set members are rendered by their set. */
    nodeIds: string[];
}

/**
 * Split the graph into threads (rule 10). Each start node opens a thread that
 * follows the oldest follower at every step; every other follower starts a new
 * thread that branches from that node. Branch threads come right after the
 * thread they branch from. `includeStart` filters thread starts, so a source
 * table with nothing after it stays on the shelf.
 */
export function buildThreads(graph: ThreadGraph, includeStart: (id: string) => boolean = () => true): ThreadSpec[] {
    const starts: { id: string; createdAt: number; rootId: string }[] = [];
    const virtualRoots = new Map<string, ThreadGraphNode[]>();
    for (const node of graph.nodes.values()) {
        if (node.setId) continue;
        if (!node.parentId) starts.push({ id: node.id, createdAt: node.createdAt, rootId: node.id });
        else if (isConversationRootId(node.parentId) || !graph.nodes.has(node.parentId)) {
            virtualRoots.set(node.parentId, [...(virtualRoots.get(node.parentId) || []), node]);
        }
    }
    const threads: ThreadSpec[] = [];
    const visited = new Set<string>();
    const walk = (startId: string, rootId: string, branchFromId?: string) => {
        if (visited.has(startId)) return;
        const thread: ThreadSpec = { key: `thread-${startId}`, rootId, branchFromId, nodeIds: [] };
        const branches: [string, string][] = [];
        let current: string | undefined = startId;
        while (current && !visited.has(current)) {
            visited.add(current);
            thread.nodeIds.push(current);
            const followers = graph.followersOf(current);
            for (const follower of followers.slice(1)) branches.push([follower.id, current]);
            current = followers[0]?.id;
        }
        threads.push(thread);
        for (const [id, from] of branches) walk(id, rootId, from);
    };
    for (const [rootId, nodes] of virtualRoots) {
        const ordered = [...nodes].sort((a, b) => a.createdAt - b.createdAt);
        starts.push({ id: ordered[0].id, createdAt: ordered[0].createdAt, rootId });
        // Further conversations on the same root are threads of their own, without a branch point to point at.
        for (const node of ordered.slice(1)) starts.push({ id: node.id, createdAt: node.createdAt, rootId });
    }
    starts.sort((a, b) => a.createdAt - b.createdAt);
    for (const start of starts) {
        if (includeStart(start.id)) walk(start.id, start.rootId);
    }
    return threads;
}
