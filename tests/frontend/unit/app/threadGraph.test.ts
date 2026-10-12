import { describe, expect, it } from 'vitest';
import { buildThreadGraph, buildThreads } from '../../../../src/app/threadGraph';

const ROOT = 'conversation-root:graph';

// source ─ ask ─ plan ─ [derived] ─ explain ─ [set: loaded, app] ─ closing
//                             └ reply-2 (branch off "explain")
const graph = buildThreadGraph({
    tables: [
        { id: 'source' },
        { id: 'derived', parentNodeId: 'plan', createdAt: 3, derive: { trigger: { tableId: 'source' } } },
        { id: 'legacy', createdAt: 9, derive: { trigger: { tableId: 'derived' } } },
    ],
    turns: [
        { id: 'ask', parentNodeId: 'source', createdAt: 1 },
        { id: 'plan', parentNodeId: 'ask', createdAt: 2 },
        { id: 'explain', parentNodeId: 'derived', createdAt: 4 },
        { id: 'closing', parentNodeId: 'set', createdAt: 7 },
        { id: 'reply-2', parentNodeId: 'explain', createdAt: 8 },
        { id: 'workflow', parentNodeId: ROOT, createdAt: 10, form: { kind: 'workflow' } },
        { id: 'orphan', parentNodeId: 'deleted-turn', createdAt: 11 },
        { id: 'loop-a', parentNodeId: 'loop-b', createdAt: 12 },
        { id: 'loop-b', parentNodeId: 'loop-a', createdAt: 13 },
    ],
    drafts: [{ id: 'running', parentNodeId: 'closing', createdAt: 14 }],
    loadedNodes: [{ id: 'loaded', tableId: 'source', parentNodeId: 'set', createdAt: 5 }],
    fileNodes: [{ id: 'app', parentNodeId: 'set', createdAt: 6 }],
    artifactSets: [{ id: 'set', parentNodeId: 'explain', memberIds: ['loaded', 'app'], createdAt: 5 }],
});

describe('ThreadGraph', () => {
    it('classifies items and messages', () => {
        expect(['derived', 'loaded', 'app', 'set', 'workflow'].map(id => graph.isItem(id))).toEqual([true, true, true, true, true]);
        expect(graph.kindOf('workflow')).toBe('workflow-definition');
        expect(['ask', 'running'].map(id => graph.isMessage(id))).toEqual([true, true]);
        expect(graph.parentOf('legacy')).toBe('derived');
    });

    it('treats set members as part of the set, not as followers', () => {
        expect(graph.membersOf('set')).toEqual(['loaded', 'app']);
        expect(graph.parentOf('app')).toBe('set');
        expect(graph.followersOf('set').map(node => node.id)).toEqual(['closing']);
        expect(graph.continuationOf('app')).toBe('set');
        expect(graph.continuationOf('derived')).toBe('derived');
    });

    it.each([
        ['a message after a table', 'explain', 'derived'],
        ['a message before any output', 'plan', 'source'],
        ['a message after an artifact set', 'closing', 'set'],
        ['a member of a set', 'app', 'app'],
        ['the open end of a run', 'running', 'set'],
        ['an item', 'derived', 'derived'],
    ])('finds the nearest item for %s', (_label, id, item) => {
        expect(graph.nearestItem(id)).toBe(item);
    });

    it('resolves the table above a node, through loaded references and sets', () => {
        expect(graph.tableOf('explain')).toBe('derived');
        expect(graph.tableOf('loaded')).toBe('source');
        expect(graph.tableOf('closing')).toBe('source');
        expect(graph.tableOf('workflow')).toBeUndefined();
    });

    it('lists the messages of the edge into an item', () => {
        expect(graph.edgeInto('derived')).toEqual(['ask', 'plan']);
        expect(graph.edgeInto('set')).toEqual(['explain']);
    });

    it.each([
        ['a node under a source table', 'closing', 'source'],
        ['a conversation that started with no item', 'workflow', ROOT],
        ['a deleted parent', 'orphan', 'conversation-root:deleted-turn'],
        ['a cycle', 'loop-a', 'conversation-root:loop-a'],
    ])('finds the thread root of %s', (_label, id, root) => {
        expect(graph.rootOf(id)).toBe(root);
    });

    it('reports dangling parents', () => {
        expect(graph.danglingNodes()).toEqual(['orphan']);
    });
});

describe('buildThreads', () => {
    it('follows the oldest follower and branches every other one', () => {
        const threads = buildThreads(graph);
        const byKey = Object.fromEntries(threads.map(thread => [thread.key, thread]));
        expect(byKey['thread-source'].nodeIds).toEqual(['source', 'ask', 'plan', 'derived', 'explain', 'set', 'closing', 'running']);
        expect(byKey['thread-reply-2']).toMatchObject({ branchFromId: 'explain', nodeIds: ['reply-2'], rootId: 'source' });
        // Branches follow their thread, in the order their branch points appear along it.
        expect(threads.slice(0, 3).map(thread => thread.key)).toEqual(['thread-source', 'thread-legacy', 'thread-reply-2']);
        expect(byKey['thread-legacy']).toMatchObject({ branchFromId: 'derived' });
        expect(byKey['thread-workflow']).toMatchObject({ rootId: ROOT, nodeIds: ['workflow'] });
        expect(byKey['thread-orphan'].nodeIds).toEqual(['orphan']);
        expect(threads.flatMap(thread => thread.nodeIds)).not.toContain('app');
    });

    it('cuts a parent cycle at its oldest node and reads the rest in order after it', () => {
        const threads = buildThreads(graph);
        expect(threads.find(thread => thread.key === 'thread-loop-a')).toMatchObject({
            rootId: 'conversation-root:loop-a', nodeIds: ['loop-a', 'loop-b'], branchFromId: undefined });
        const ids = threads.flatMap(thread => thread.nodeIds);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('starts separate threads for separate conversations on one root', () => {
        const twoConversations = buildThreadGraph({ tables: [], turns: [
            { id: 'first', parentNodeId: ROOT, createdAt: 1 }, { id: 'second', parentNodeId: ROOT, createdAt: 2 },
        ] });
        expect(buildThreads(twoConversations).map(thread => [thread.nodeIds, thread.branchFromId]))
            .toEqual([[['first'], undefined], [['second'], undefined]]);
    });

    it('skips starts the caller excludes, such as a source table with nothing after it', () => {
        const shelfOnly = buildThreadGraph({ tables: [{ id: 'unused' }, { id: 'used' }],
            turns: [{ id: 'ask', parentNodeId: 'used', createdAt: 1 }] });
        expect(buildThreads(shelfOnly, id => shelfOnly.followersOf(id).length > 0).map(thread => thread.key))
            .toEqual(['thread-used']);
    });
});
