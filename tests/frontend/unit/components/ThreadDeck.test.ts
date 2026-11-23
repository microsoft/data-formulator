import { describe, expect, it } from 'vitest';
import { justifyRows, tileAspect } from '../../../../src/components/ThreadDeck';

const chart = 4 / 3;
const sizes = (aspects: number[]) => justifyRows(aspects).map(row => row.size);

describe('justifyRows', () => {
  it('keeps a lone chart at the row height instead of stretching it across the column', () => {
    expect(justifyRows([chart])).toEqual([{ size: 1, fill: false }]);
  });

  it('fills rows of a few charts, so rows of different counts come out alike', () => {
    expect(justifyRows([chart, chart])).toEqual([{ size: 2, fill: true }]);
    expect(sizes(Array(3).fill(chart))).toEqual([3]);
    expect(sizes(Array(6).fill(chart))).toEqual([3, 3]);
    expect(sizes(Array(9).fill(chart))).toEqual([3, 3, 3]);
  });

  it('balances an odd count without leaving a lone chart behind', () => {
    expect(sizes(Array(5).fill(chart))).toEqual([2, 3]);
    expect(sizes(Array(7).fill(chart))).toEqual([3, 4]);
  });

  it('lets a wide chart take a fuller row and tall ones share without stretching', () => {
    expect(sizes([1.8, chart, chart, chart, chart])).toEqual([2, 3]);
    expect(justifyRows([0.6, 0.6, 0.6])).toEqual([{ size: 3, fill: false }]);
  });

  it('fills a row of tall charts once their tiles are kept at least square', () => {
    expect([0.5, 1.5, 3].map(tileAspect)).toEqual([1, 1.5, 2]);
    expect(justifyRows([0.6, 0.8, 1.1].map(tileAspect))).toEqual([{ size: 3, fill: true }]);
  });
});
