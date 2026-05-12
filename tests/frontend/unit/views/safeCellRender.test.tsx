/**
 * Tests that verify the safe rendering pattern used in:
 * - ReactTable.tsx
 * - SelectableDataGrid.tsx
 * - DataLoadingThread.tsx
 *
 * The fix ensures that object values (e.g. Date instances from Excel)
 * are converted to strings before being rendered by React, preventing
 * "Objects are not valid as a React child" errors.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

/**
 * Replicates the safe rendering logic applied in the component fixes.
 * ReactTable & SelectableDataGrid use this pattern inline.
 * DataLoadingThread uses it inside the format callback.
 */
const safeCellRender = (value: any): React.ReactNode => {
  if (value != null && typeof value === 'object') return String(value);
  if (typeof value === 'boolean') return `${value}`;
  return value;
};

const formatFn = (v: any) => (v != null && typeof v === 'object' ? String(v) : v);

describe('safeCellRender – inline pattern (ReactTable / SelectableDataGrid)', () => {
  it('should render string values directly', () => {
    const { container } = render(<td>{safeCellRender('hello')}</td>);
    expect(container.textContent).toBe('hello');
  });

  it('should render number values directly', () => {
    const { container } = render(<td>{safeCellRender(42)}</td>);
    expect(container.textContent).toBe('42');
  });

  it('should render null without crashing', () => {
    const { container } = render(<td>{safeCellRender(null)}</td>);
    expect(container.textContent).toBe('');
  });

  it('should render undefined without crashing', () => {
    const { container } = render(<td>{safeCellRender(undefined)}</td>);
    expect(container.textContent).toBe('');
  });

  it('should render boolean as string', () => {
    const { container } = render(<td>{safeCellRender(true)}</td>);
    expect(container.textContent).toBe('true');
  });

  it('should safely render a Date object as string', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    const { container } = render(<td>{safeCellRender(date)}</td>);
    expect(container.textContent).toBe(String(date));
  });

  it('should safely render a plain object as string', () => {
    const obj = { richText: [{ text: 'A' }] };
    const { container } = render(<td>{safeCellRender(obj)}</td>);
    expect(container.textContent).toBe(String(obj));
  });

  it('should safely render an array as string', () => {
    const arr = [1, 2, 3];
    const { container } = render(<td>{safeCellRender(arr)}</td>);
    expect(container.textContent).toBe(String(arr));
  });
});

describe('formatFn – DataLoadingThread format callback', () => {
  it('should pass through string values', () => {
    expect(formatFn('text')).toBe('text');
  });

  it('should pass through number values', () => {
    expect(formatFn(99)).toBe(99);
  });

  it('should pass through null', () => {
    expect(formatFn(null)).toBeNull();
  });

  it('should convert Date object to string', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    expect(formatFn(date)).toBe(String(date));
  });

  it('should convert arbitrary object to string', () => {
    const obj = { formula: '=SUM(A1:A10)', result: 55 };
    expect(formatFn(obj)).toBe(String(obj));
  });
});
