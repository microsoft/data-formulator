import { describe, expect, it } from 'vitest';
import { ROOTLESS_THREAD_ID } from '../../../../src/components/ComponentType';
import {
  getThreadTriggers,
  isThreadLeafTable,
  resolveThreadParentTableId,
} from '../../../../src/views/threadProvenance';

describe('thread provenance', () => {
  it('uses authored conversation parents for visual lineage', () => {
    const source = { id: 'consumer_price_index' } as any;
    const first = {
      id: 'd_out',
      parentNodeId: ROOTLESS_THREAD_ID,
      derive: { trigger: { tableId: source.id, resultTableId: 'd_out' } },
    } as any;
    const second = {
      id: 'd_d_out',
      parentNodeId: 'first-response',
      derive: { trigger: { tableId: source.id, resultTableId: 'd_d_out' } },
    } as any;
    const third = {
      id: 'd_d_out_2',
      parentNodeId: 'second-response',
      derive: { trigger: { tableId: source.id, resultTableId: 'd_d_out_2' } },
    } as any;
    const tables = [source, first, second, third];
    const turns = [
      { id: 'first-response', parentNodeId: first.id },
      { id: 'second-response', parentNodeId: second.id },
    ] as any;

    expect(resolveThreadParentTableId(first, tables, turns)).toBe(source.id);
    expect(resolveThreadParentTableId(second, tables, turns)).toBe(first.id);
    expect(resolveThreadParentTableId(third, tables, turns)).toBe(second.id);
    expect(tables.filter(table => isThreadLeafTable(table, tables, turns)).map(table => table.id))
      .toEqual([third.id]);
    expect(getThreadTriggers(third, tables, turns).map(trigger => [
      trigger.tableId,
      trigger.resultTableId,
    ])).toEqual([
      [source.id, first.id],
      [first.id, second.id],
      [second.id, third.id],
    ]);
  });
});