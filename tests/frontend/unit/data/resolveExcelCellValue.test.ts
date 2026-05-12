import { describe, it, expect } from 'vitest';
import { resolveExcelCellValue } from '../../../../src/data/utils';

describe('resolveExcelCellValue', () => {
  // --- Null / undefined ---
  it('should return null for null', () => {
    expect(resolveExcelCellValue(null)).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(resolveExcelCellValue(undefined)).toBeNull();
  });

  // --- Primitives pass-through ---
  it('should return string as-is', () => {
    expect(resolveExcelCellValue('hello')).toBe('hello');
  });

  it('should return number as-is', () => {
    expect(resolveExcelCellValue(42)).toBe(42);
  });

  it('should return boolean as-is', () => {
    expect(resolveExcelCellValue(true)).toBe(true);
    expect(resolveExcelCellValue(false)).toBe(false);
  });

  it('should return empty string as-is', () => {
    expect(resolveExcelCellValue('')).toBe('');
  });

  // --- Date objects ---
  it('should convert Date to ISO string', () => {
    const date = new Date('2024-03-15T10:30:00Z');
    expect(resolveExcelCellValue(date)).toBe('2024-03-15T10:30:00.000Z');
  });

  // --- ExcelJS richText ---
  it('should join richText segments', () => {
    const richText = {
      richText: [
        { text: 'Hello' },
        { text: ' ' },
        { text: 'World' },
      ],
    };
    expect(resolveExcelCellValue(richText)).toBe('Hello World');
  });

  it('should handle richText with missing text fields', () => {
    const richText = {
      richText: [
        { text: 'A' },
        { font: { bold: true } },
        { text: 'B' },
      ],
    };
    expect(resolveExcelCellValue(richText)).toBe('AB');
  });

  // --- ExcelJS hyperlink ---
  it('should extract text from hyperlink object', () => {
    const hyperlink = {
      text: 'Click here',
      hyperlink: 'https://example.com',
    };
    expect(resolveExcelCellValue(hyperlink)).toBe('Click here');
  });

  it('should fall back to hyperlink URL when text is empty', () => {
    const hyperlink = {
      text: '',
      hyperlink: 'https://example.com',
    };
    expect(resolveExcelCellValue(hyperlink)).toBe('https://example.com');
  });

  // --- ExcelJS formula ---
  it('should resolve formula result (primitive)', () => {
    const formula = { formula: '=A1+B1', result: 100 };
    expect(resolveExcelCellValue(formula)).toBe(100);
  });

  it('should resolve formula result (Date)', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const formula = { formula: '=TODAY()', result: date };
    expect(resolveExcelCellValue(formula)).toBe('2024-01-01T00:00:00.000Z');
  });

  it('should return null for formula with undefined result', () => {
    const formula = { formula: '=INVALID()', result: undefined };
    expect(resolveExcelCellValue(formula)).toBeNull();
  });

  // --- ExcelJS error ---
  it('should return null for error cell value', () => {
    const errorCell = { error: '#REF!' };
    expect(resolveExcelCellValue(errorCell)).toBeNull();
  });

  // --- Generic object fallback ---
  it('should stringify unknown objects', () => {
    const obj = { custom: 'data' };
    expect(resolveExcelCellValue(obj)).toBe(String(obj));
  });
});
