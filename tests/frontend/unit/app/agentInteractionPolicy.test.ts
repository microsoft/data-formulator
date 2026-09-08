import { describe, expect, it } from 'vitest';
import {
  classifyInputSourceTransition,
  resolveConversationParentNodeId,
  resolveDerivedTriggerTableId,
  resolveRunParentNodeId,
  shouldShowInputSourceTransition,
  shouldAutoFocusGeneratedChart,
} from '../../../../src/app/agentInteractionPolicy';
import { ROOTLESS_THREAD_ID } from '../../../../src/components/ComponentType';

describe('agent interaction policy', () => {
  it('keeps generated chart auto-focus disabled while the user is viewing a chart', () => {
    expect(shouldAutoFocusGeneratedChart(false)).toBe(true);
    expect(shouldAutoFocusGeneratedChart(true)).toBe(false);
  });

  it('introduces a table only when a derived result uses one', () => {
    expect(resolveDerivedTriggerTableId(null, undefined)).toBe(ROOTLESS_THREAD_ID);
    expect(resolveDerivedTriggerTableId(null, 'orders')).toBe('orders');
    expect(resolveDerivedTriggerTableId('derived-orders', 'orders')).toBe('derived-orders');
  });

  it('starts fresh runs rootless and preserves explicit continuations', () => {
    expect(resolveRunParentNodeId(null)).toBe(ROOTLESS_THREAD_ID);
    expect(resolveRunParentNodeId(null, 'derived-orders')).toBe('derived-orders');
    expect(resolveRunParentNodeId('textTurn-question')).toBe('textTurn-question');
  });

  it('continues from the latest response when its chart is focused', () => {
    const turns = [
      { id: 'older-response', parentNodeId: 'orders', createdAt: 10 },
      { id: 'latest-response', parentNodeId: 'older-response', createdAt: 20 },
      { id: 'other-thread', parentNodeId: 'customers', createdAt: 30 },
    ];

    expect(resolveConversationParentNodeId(null, 'orders', turns, ['orders', 'customers']))
      .toBe('latest-response');
    expect(resolveConversationParentNodeId('older-response', 'orders', turns, ['orders', 'customers']))
      .toBe('older-response');
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
