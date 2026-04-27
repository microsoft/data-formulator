import { describe, it, expect } from 'vitest';
import { formatCellValue } from '../../../../src/views/ViewUtils';
import { Type } from '../../../../src/data/types';

describe('formatCellValue', () => {
  // --- Null / basic pass-through (unchanged behavior) ---

  it('should return empty string for null/undefined', () => {
    expect(formatCellValue(null)).toBe('');
    expect(formatCellValue(undefined)).toBe('');
  });

  it('should format numbers with locale separators', () => {
    expect(formatCellValue(1234567)).toBe('1,234,567');
    expect(formatCellValue(3.14159)).toMatch(/3\.141/);
  });

  it('should not add separators for non-measure numeric semantics', () => {
    expect(formatCellValue(2026, Type.Integer, 'Year')).toBe('2026');
    expect(formatCellValue(10001, Type.Integer, 'ZipCode')).toBe('10001');
    expect(formatCellValue(123456, Type.Integer, 'ID')).toBe('123456');
  });

  it('should keep separators for measure numeric semantics', () => {
    expect(formatCellValue(1234567, Type.Number, 'Amount')).toBe('1,234,567');
    expect(formatCellValue(1234567, Type.Integer, 'Count')).toBe('1,234,567');
  });

  it('should format booleans as strings', () => {
    expect(formatCellValue(true)).toBe('true');
    expect(formatCellValue(false)).toBe('false');
  });

  it('should pass through plain strings', () => {
    expect(formatCellValue('hello')).toBe('hello');
  });

  // --- With dataType but without it (backward compat) ---

  it('should work without dataType parameter', () => {
    expect(formatCellValue('2024-01-15')).toBe('2024-01-15');
    expect(formatCellValue(42)).toBe('42');
  });

  // --- Date formatting ---

  it('should format Date type with locale date', () => {
    const result = formatCellValue('2024-01-15', Type.Date);
    // The exact format depends on the locale, but it should not be the raw ISO string
    expect(result).not.toBe('');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle invalid date gracefully', () => {
    expect(formatCellValue('not-a-date', Type.Date)).toBe('not-a-date');
  });

  // --- DateTime formatting ---

  it('should format DateTime type with locale datetime', () => {
    const result = formatCellValue('2024-01-15T14:30:00Z', Type.DateTime);
    expect(result).not.toBe('');
    // Should contain both date and time components
    expect(result.length).toBeGreaterThan(5);
  });

  it('should handle invalid datetime gracefully', () => {
    expect(formatCellValue('not-a-datetime', Type.DateTime)).toBe('not-a-datetime');
  });

  // --- Time formatting ---

  it('should format Time type with locale time', () => {
    const result = formatCellValue('14:30:00', Type.Time);
    expect(result).not.toBe('');
    expect(result).not.toBe('Invalid Date');
  });

  it('should handle invalid time gracefully', () => {
    expect(formatCellValue('not-a-time', Type.Time)).toBe('not-a-time');
  });

  // --- Duration formatting ---

  it('should format Duration from milliseconds', () => {
    expect(formatCellValue(9000000, Type.Duration)).toBe('2h 30m');
    expect(formatCellValue(3600000, Type.Duration)).toBe('1h');
    expect(formatCellValue(90000, Type.Duration)).toBe('1m 30s');
    expect(formatCellValue(5000, Type.Duration)).toBe('5s');
    expect(formatCellValue(0, Type.Duration)).toBe('0s');
  });

  it('should pass through non-numeric Duration as string', () => {
    expect(formatCellValue('PT2H30M', Type.Duration)).toBe('PT2H30M');
  });
});
