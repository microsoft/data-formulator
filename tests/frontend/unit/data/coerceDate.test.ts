import { describe, it, expect } from 'vitest';
import { CoerceType } from '../../../../src/data/types';

const coerceDate = CoerceType.date;
const coerceDateTime = CoerceType.datetime;
const coerceTime = CoerceType.time;
const coerceDuration = CoerceType.duration;

// ---------------------------------------------------------------------------
// coerceDate — returns date-only ISO (YYYY-MM-DD) for Date objects
// ---------------------------------------------------------------------------

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

  it('should convert Date object to date-only ISO string', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    const result = coerceDate(date);
    expect(result).toBe('2024-06-15');
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

// ---------------------------------------------------------------------------
// coerceDateTime — returns full ISO string for Date objects
// ---------------------------------------------------------------------------

describe('coerceDateTime', () => {
  it('should return null for null/undefined/empty', () => {
    expect(coerceDateTime(null)).toBeNull();
    expect(coerceDateTime(undefined)).toBeNull();
    expect(coerceDateTime('')).toBeNull();
  });

  it('should convert Date object to full ISO string', () => {
    const date = new Date('2024-06-15T12:00:00Z');
    expect(coerceDateTime(date)).toBe(date.toISOString());
  });

  it('should pass through ISO datetime strings unchanged', () => {
    expect(coerceDateTime('2024-01-15T14:30:00Z')).toBe('2024-01-15T14:30:00Z');
  });
});

// ---------------------------------------------------------------------------
// coerceTime — pass through
// ---------------------------------------------------------------------------

describe('coerceTime', () => {
  it('should return null for null/undefined/empty', () => {
    expect(coerceTime(null)).toBeNull();
    expect(coerceTime(undefined)).toBeNull();
    expect(coerceTime('')).toBeNull();
  });

  it('should pass through time strings unchanged', () => {
    expect(coerceTime('14:30:00')).toBe('14:30:00');
    expect(coerceTime('08:00')).toBe('08:00');
  });
});

// ---------------------------------------------------------------------------
// coerceDuration — pass through
// ---------------------------------------------------------------------------

describe('coerceDuration', () => {
  it('should return null for null/undefined/empty', () => {
    expect(coerceDuration(null)).toBeNull();
    expect(coerceDuration(undefined)).toBeNull();
    expect(coerceDuration('')).toBeNull();
  });

  it('should pass through duration values unchanged', () => {
    expect(coerceDuration('PT2H30M')).toBe('PT2H30M');
    expect(coerceDuration(9000000)).toBe(9000000);
  });
});
