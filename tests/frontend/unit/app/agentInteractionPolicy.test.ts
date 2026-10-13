import { describe, expect, it } from 'vitest';
import {
  classifyInputSourceTransition,
  resolveConversationParentNodeId,
  resolveDerivedTriggerTableId,
  resolveRunParentNodeId,
  shouldShowInputSourceTransition,
} from '../../../../src/app/agentInteractionPolicy';
import { ThreadGraph } from '../../../../src/app/threadGraph';
const CONVERSATION_ROOT_ID = 'conversation-root:test';

describe('agent interaction policy', () => {
  it('introduces a table only when a derived result uses one', () => {
    expect(resolveDerivedTriggerTableId(null, undefined, CONVERSATION_ROOT_ID)).toBe(CONVERSATION_ROOT_ID);
    expect(resolveDerivedTriggerTableId(null, 'orders', CONVERSATION_ROOT_ID)).toBe('orders');
    expect(resolveDerivedTriggerTableId('derived-orders', 'orders', CONVERSATION_ROOT_ID)).toBe('derived-orders');
  });

  it('starts fresh conversation roots and preserves explicit continuations', () => {
    const rootId = resolveRunParentNodeId(null);
    expect(rootId).toMatch(/^conversation-root:/);
    expect(resolveRunParentNodeId(null)).not.toBe(rootId);
    expect(resolveRunParentNodeId(null, null, CONVERSATION_ROOT_ID)).toBe(CONVERSATION_ROOT_ID);
    expect(resolveRunParentNodeId(null, 'derived-orders')).toBe('derived-orders');
    expect(resolveRunParentNodeId('textTurn-question')).toBe('textTurn-question');
  });

  it('continues the open conversation after a focused table, or starts from the table once it led on', () => {
    const table = (id: string, parentNodeId?: string) => ({ id, parentNodeId, derive: { trigger: { tableId: 'root' } } } as any);
    const turn = (id: string, parentNodeId: string, createdAt: number) => ({ id, parentNodeId, createdAt } as any);
    const graphOf = (turns: any[], tables: any[]) => new ThreadGraph({ tables, turns });
    // orders → older → latest; customers → other
    const open = graphOf([turn('older-response', 'orders', 10), turn('latest-response', 'older-response', 20),
      turn('other-thread', 'customers', 30)], [table('orders', 'root'), table('customers', 'root')]);
    expect(resolveConversationParentNodeId(null, 'orders', open)).toBe('latest-response');
    expect(resolveConversationParentNodeId('older-response', 'orders', open)).toBe('older-response');
    expect(resolveConversationParentNodeId(null, 'orders', open, id => id !== 'latest-response')).toBe('older-response');
    // orders → summary → request → step → by-year: that conversation led on, so start from orders.
    const ledOn = graphOf([turn('summary', 'orders', 10), turn('request', 'summary', 20), turn('step', 'request', 30)],
      [table('orders', 'root'), table('by-year', 'step')]);
    expect(resolveConversationParentNodeId(null, 'orders', ledOn)).toBeUndefined();
    // …unless another conversation after orders is still open.
    const both = graphOf([turn('summary', 'orders', 10), turn('request', 'summary', 20), turn('step', 'request', 30),
      turn('aside', 'summary', 25)], [table('orders', 'root'), table('by-year', 'step')]);
    expect(resolveConversationParentNodeId(null, 'orders', both)).toBe('aside');
    expect(resolveConversationParentNodeId(null, 'orders', graphOf([], [table('orders', 'root')]))).toBeUndefined();
  });

  it('continues the open conversation after an app or report the same way', () => {
    const turn = (id: string, parentNodeId: string, createdAt: number) => ({ id, parentNodeId, createdAt } as any);
    const graph = new ThreadGraph({ tables: [], turns: [turn('ask', 'conversation-root:a', 1), turn('built', 'file-app', 3)],
      fileNodes: [{ id: 'file-app', parentNodeId: 'ask', createdAt: 2 }] });
    expect(resolveConversationParentNodeId(null, 'file-app', graph)).toBe('built');
    // A workflow proposal that closed the run is an open end as well.
    const proposed = new ThreadGraph({ tables: [], turns: [turn('ask', 'conversation-root:a', 1),
      { id: 'proposal', parentNodeId: 'file-app', createdAt: 3, form: { kind: 'workflow' } } as any],
      fileNodes: [{ id: 'file-app', parentNodeId: 'ask', createdAt: 2 }] });
    expect(resolveConversationParentNodeId(null, 'file-app', proposed)).toBe('proposal');
    const reportOnly = new ThreadGraph({ tables: [], turns: [turn('ask', 'conversation-root:a', 1)],
      reports: [{ id: 'report', parentNodeId: 'ask', createdAt: 2 }] });
    expect(resolveConversationParentNodeId(null, 'report', reportOnly)).toBeUndefined();
  });

  it('classifies generalized computation source transitions', () => {
    const data = { id: 'data:orders', kind: 'data' as const, displayName: 'Orders' };
    const file = { id: 'file:notes', kind: 'file' as const, displayName: 'Notes' };
    const other = { id: 'data:customers', kind: 'data' as const, displayName: 'Customers' };

    expect(classifyInputSourceTransition([], [])).toBe('none');
    expect(classifyInputSourceTransition([], [file])).toBe('initial');
    expect(classifyInputSourceTransition([data], [data])).toBe('continue');
    expect(classifyInputSourceTransition([data], [data, file])).toBe('merge');
    expect(classifyInputSourceTransition([data], [other])).toBe('switch');
  });

  it('hides a source edge that only repeats the thread trigger table', () => {
    expect(shouldShowInputSourceTransition('initial', 'orders', ['orders'])).toBe(false);
    expect(shouldShowInputSourceTransition('merge', 'orders', ['orders', 'customers'])).toBe(true);
    expect(shouldShowInputSourceTransition('switch', 'orders', [undefined])).toBe(true);
  });
});
