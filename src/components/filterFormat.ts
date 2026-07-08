// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared, human-friendly formatting for source-filter operators and chips.
// Backend operators are terse enums (EQ, GTE, ILIKE, ...); the UI should show
// familiar symbols (=, >=, contains) instead. Kept in one place so every
// surface that renders a filter chip stays consistent.

/** Maps a backend filter operator enum to a readable symbol/word. */
export const FILTER_OPERATOR_SYMBOLS: Record<string, string> = {
    EQ: '=',
    NEQ: '≠',
    GT: '>',
    GTE: '≥',
    LT: '<',
    LTE: '≤',
    IN: 'in',
    NOT_IN: 'not in',
    LIKE: 'contains',
    ILIKE: 'contains',
    BETWEEN: 'between',
    IS_NULL: 'is null',
    IS_NOT_NULL: 'is not null',
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

/**
 * Build a compact, readable chip label for a single filter, e.g.
 *   { column: 'timestamp', operator: 'GTE', value: '2022-12-12' }
 *   → "timestamp ≥ 2022-12-12"
 *   { column: 'name', operator: 'IS_NULL' } → "name is null"
 *   { column: 'ts', operator: 'BETWEEN', value: [1, 5] } → "ts between 1 – 5"
 */
export const formatFilterChipLabel = (
    column: string,
    operator: string,
    value?: any,
): string => {
    const op = formatFilterOperator(operator);
    if (VALUELESS_OPERATORS.has(operator)) return `${column} ${op}`;
    if (operator === 'BETWEEN' && Array.isArray(value) && value.length === 2) {
        return `${column} ${op} ${value[0]} – ${value[1]}`;
    }
    const val = formatFilterValue(value);
    return val ? `${column} ${op} ${val}` : `${column} ${op}`;
};
