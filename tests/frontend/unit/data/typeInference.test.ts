import { describe, it, expect } from 'vitest';
import { TestType, Type, mapApiTypeToAppType } from '../../../../src/data/types';
import { inferTypeFromValueArray } from '../../../../src/data/utils';

// ═══════════════════════════════════════════════════════════════════════════
// Individual test* functions
// ═══════════════════════════════════════════════════════════════════════════

describe('testDate (strict YYYY-MM-DD)', () => {
  const test = TestType.date;

  it('should accept ISO date strings', () => {
    expect(test('2024-01-15')).toBe(true);
    expect(test('2024/01/15')).toBe(true);
    expect(test('1999-12-31')).toBe(true);
  });

  it('should reject datetime strings (should be DateTime)', () => {
    expect(test('2024-01-15T14:30:00Z')).toBe(false);
    expect(test('2024-01-15T14:30:00')).toBe(false);
    expect(test('2024-01-15 14:30')).toBe(false);
  });

  it('should reject pure year numbers', () => {
    expect(test('2024')).toBe(false);
    expect(test('1999')).toBe(false);
  });

  it('should reject time-only strings', () => {
    expect(test('14:30:00')).toBe(false);
  });

  it('should reject non-string values', () => {
    expect(test(2024)).toBe(false);
    expect(test(null)).toBe(false);
    expect(test(true)).toBe(false);
  });

  it('should handle whitespace trimming', () => {
    expect(test(' 2024-01-15 ')).toBe(true);
  });
});

describe('testDateTime', () => {
  const test = TestType.datetime;

  it('should accept ISO datetime strings', () => {
    expect(test('2024-01-15T14:30:00Z')).toBe(true);
    expect(test('2024-01-15T14:30:00')).toBe(true);
    expect(test('2024-01-15T14:30:00.000Z')).toBe(true);
    expect(test('2024-01-15 14:30:00')).toBe(true);
  });

  it('should accept Date objects', () => {
    expect(test(new Date('2024-01-15'))).toBe(true);
  });

  it('should reject date-only strings', () => {
    expect(test('2024-01-15')).toBe(false);
  });

  it('should reject time-only strings', () => {
    expect(test('14:30:00')).toBe(false);
  });

  it('should reject non-date strings', () => {
    expect(test('hello')).toBe(false);
    expect(test('2024')).toBe(false);
  });
});

describe('testTime', () => {
  const test = TestType.time;

  it('should accept time strings', () => {
    expect(test('14:30')).toBe(true);
    expect(test('14:30:00')).toBe(true);
    expect(test('8:05:30')).toBe(true);
    expect(test('14:30:00.123')).toBe(true);
  });

  it('should accept time with timezone', () => {
    expect(test('14:30:00Z')).toBe(true);
    expect(test('14:30:00+08:00')).toBe(true);
  });

  it('should reject date strings', () => {
    expect(test('2024-01-15')).toBe(false);
  });

  it('should reject datetime strings', () => {
    expect(test('2024-01-15T14:30:00')).toBe(false);
  });

  it('should reject non-strings', () => {
    expect(test(1430)).toBe(false);
  });
});

describe('testDuration', () => {
  const test = TestType.duration;

  it('should accept ISO 8601 duration strings', () => {
    expect(test('PT2H30M')).toBe(true);
    expect(test('P1Y2M3D')).toBe(true);
    expect(test('P1DT12H')).toBe(true);
    expect(test('PT45S')).toBe(true);
    expect(test('PT1.5S')).toBe(true);
  });

  it('should reject bare "P" with no components', () => {
    expect(test('P')).toBe(false);
  });

  it('should reject non-duration strings', () => {
    expect(test('2024-01-15')).toBe(false);
    expect(test('hello')).toBe(false);
    expect(test('14:30')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// inferTypeFromValueArray — priority order tests
// ═══════════════════════════════════════════════════════════════════════════

describe('inferTypeFromValueArray', () => {
  it('should infer Boolean for boolean values', () => {
    expect(inferTypeFromValueArray(['true', 'false', 'true'])).toBe(Type.Boolean);
  });

  it('should infer Integer for whole numbers', () => {
    expect(inferTypeFromValueArray(['1', '2', '3'])).toBe(Type.Integer);
  });

  it('should infer Number for decimal numbers', () => {
    expect(inferTypeFromValueArray(['1.5', '2.3', '4.7'])).toBe(Type.Number);
  });

  it('should infer Date for YYYY-MM-DD values', () => {
    expect(inferTypeFromValueArray(['2024-01-15', '2024-02-20', '2024-03-10'])).toBe(Type.Date);
  });

  it('should infer DateTime for YYYY-MM-DDTHH:mm:ss values', () => {
    expect(inferTypeFromValueArray([
      '2024-01-15T14:30:00',
      '2024-02-20T10:00:00',
      '2024-03-10T08:15:30',
    ])).toBe(Type.DateTime);
  });

  it('should infer Time for HH:mm:ss values', () => {
    expect(inferTypeFromValueArray(['14:30:00', '10:00:00', '08:15:30'])).toBe(Type.Time);
  });

  it('should infer Duration for ISO duration values', () => {
    expect(inferTypeFromValueArray(['PT2H', 'PT30M', 'PT1H15M'])).toBe(Type.Duration);
  });

  it('should NOT mis-identify pure year numbers as Date', () => {
    expect(inferTypeFromValueArray(['2020', '2021', '2022'])).toBe(Type.Integer);
  });

  it('should fall back to String for mixed types', () => {
    expect(inferTypeFromValueArray(['hello', '123', '2024-01-15'])).toBe(Type.String);
  });

  it('should skip nulls and empty strings during inference', () => {
    expect(inferTypeFromValueArray([null, '2024-01-15', '', '2024-02-20'])).toBe(Type.Date);
  });

  it('should return Boolean (first candidate) for empty array', () => {
    // No values to filter against → first candidate type survives
    expect(inferTypeFromValueArray([])).toBe(Type.Boolean);
  });

  it('should return Boolean (first candidate) for all-null array', () => {
    // Nulls are skipped → no filtering → first candidate type survives
    expect(inferTypeFromValueArray([null, null, undefined])).toBe(Type.Boolean);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mapApiTypeToAppType — backend API label mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('mapApiTypeToAppType', () => {
  it('should map standardized labels', () => {
    expect(mapApiTypeToAppType('datetime')).toBe(Type.DateTime);
    expect(mapApiTypeToAppType('date')).toBe(Type.Date);
    expect(mapApiTypeToAppType('time')).toBe(Type.Time);
    expect(mapApiTypeToAppType('duration')).toBe(Type.Duration);
    expect(mapApiTypeToAppType('integer')).toBe(Type.Integer);
    expect(mapApiTypeToAppType('number')).toBe(Type.Number);
    expect(mapApiTypeToAppType('boolean')).toBe(Type.Boolean);
    expect(mapApiTypeToAppType('string')).toBe(Type.String);
  });

  it('should handle legacy pandas dtype strings', () => {
    expect(mapApiTypeToAppType('datetime64[ns]')).toBe(Type.DateTime);
    expect(mapApiTypeToAppType('datetime64[ns, UTC]')).toBe(Type.DateTime);
    expect(mapApiTypeToAppType('timedelta64[ns]')).toBe(Type.Duration);
    expect(mapApiTypeToAppType('int64')).toBe(Type.Integer);
    expect(mapApiTypeToAppType('float64')).toBe(Type.Number);
    expect(mapApiTypeToAppType('bool')).toBe(Type.Boolean);
    expect(mapApiTypeToAppType('object')).toBe(Type.String);
  });

  it('should be case-insensitive', () => {
    expect(mapApiTypeToAppType('DateTime')).toBe(Type.DateTime);
    expect(mapApiTypeToAppType('BOOLEAN')).toBe(Type.Boolean);
  });
});
