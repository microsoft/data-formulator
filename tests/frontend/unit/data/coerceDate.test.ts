import { describe, it, expect } from 'vitest';
import { CoerceType } from '../../../../src/data/types';

const coerceDate = CoerceType.date;

describe('coerceDate', () => {
  it('should return null for null input', () => {
    expect(coerceDate(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(coerceDate(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(coerceDate('')).toBeNull();
  });

  it('should convert Date object to ISO string', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    const result = coerceDate(date);
    expect(typeof result).toBe('string');
    expect(result).toBe(date.toISOString());
  });

  it('should convert Date object with timezone to ISO string', () => {
    const date = new Date(2024, 0, 1, 8, 30, 0);
    const result = coerceDate(date);
    expect(typeof result).toBe('string');
    expect(result).toBe(date.toISOString());
  });

  it('should pass through string date values unchanged', () => {
    expect(coerceDate('2024-01-01')).toBe('2024-01-01');
    expect(coerceDate('Jan 1, 2024')).toBe('Jan 1, 2024');
  });

  it('should pass through numeric timestamps unchanged', () => {
    const ts = 1700000000000;
    expect(coerceDate(ts)).toBe(ts);
  });
});
