// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared, human-friendly formatting for source-filter operators and chips.
// Backend operators are query syntax (EQ, GTE, ILIKE, ...); user-facing chips
// follow the conventional compact label–value pattern for common filters
// (`Grade: regular`) and spell out an operator only when it changes meaning.

/** Maps a backend filter operator enum to a readable symbol/word. */
export const FILTER_OPERATOR_SYMBOLS: Record<string, string> = {
    EQ: ':',
    NEQ: 'is not',
    GT: '>',
    GTE: '≥',
    LT: '<',
    LTE: '≤',
    IN: ':',
    NOT_IN: 'excludes',
    LIKE: 'contains',
    ILIKE: 'contains',
    BETWEEN: ':',
    IS_NULL: 'is empty',
    IS_NOT_NULL: 'is not empty',
};

/** Operators that carry no value (rendered as "column is null"). */
const VALUELESS_OPERATORS = new Set(['IS_NULL', 'IS_NOT_NULL']);

/** Human-friendly operator symbol; falls back to the raw operator. */
export const formatFilterOperator = (operator: string): string =>
    FILTER_OPERATOR_SYMBOLS[operator] ?? operator;

const formatFilterValue = (value: any): string => {
    if (value === undefined || value === null || value === '') return '';
    if (Array.isArray(value)) return value.map(v => String(v)).join(', ');
    return String(value);
};

/** Turn technical column identifiers into compact display labels. */
const formatFilterColumn = (column: string): string => {
    const readable = String(column || '').replace(/[_-]+/g, ' ').trim();
    return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : '';
};

/**
 * Build a compact, readable chip label for a single filter, e.g.
 *   { column: 'timestamp', operator: 'GTE', value: '2022-12-12' }
 *   → "Timestamp ≥ 2022-12-12"
 *   { column: 'grade', operator: 'EQ', value: 'regular' } → "Grade: regular"
 *   { column: 'name', operator: 'IS_NULL' } → "Name is empty"
 *   { column: 'date', operator: 'BETWEEN', value: [1, 5] } → "Date: 1 – 5"
 */
export const formatFilterChipLabel = (
    column: string,
    operator: string,
    value?: any,
): string => {
    const label = formatFilterColumn(column);
    const op = formatFilterOperator(operator);
    if (VALUELESS_OPERATORS.has(operator)) return `${label} ${op}`;
    if (operator === 'BETWEEN' && Array.isArray(value) && value.length === 2) {
        return `${label}${op} ${value[0]} – ${value[1]}`;
    }
    const val = formatFilterValue(value);
    if (!val) return `${label} ${op}`;
    if (operator === 'EQ' || operator === 'IN') return `${label}${op} ${val}`;
    return `${label} ${op} ${val}`;
};
