import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { ConceptExplCards, parseFormulaStatements } from '../../../../src/views/ExplComponents';

describe('parseFormulaStatements', () => {
    it('splits semicolon-joined assignments into separate statements', () => {
        expect(parseFormulaStatements(
            '`budget_musd = Production Budget / 1,000,000; worldwide_gross_musd = Worldwide Gross / 1,000,000`',
        )).toEqual({
            statements: [
                { lhs: 'budget_musd', rhs: 'Production Budget / 1,000,000' },
                { lhs: 'worldwide_gross_musd', rhs: 'Worldwide Gross / 1,000,000' },
            ],
        });
    });

    it('keeps separators inside brackets and quotes', () => {
        expect(parseFormulaStatements("`label = fillna(kind, 'a; b'); n = count(x; y)`")).toEqual({
            statements: [
                { lhs: 'label', rhs: "fillna(kind, 'a; b')" },
                { lhs: 'n', rhs: 'count(x; y)' },
            ],
        });
    });

    it('splits at the assignment, not comparison operators', () => {
        expect(parseFormulaStatements('`is_top = rank <= 10 and kind == "A"`')).toEqual({
            statements: [{ lhs: 'is_top', rhs: 'rank <= 10 and kind == "A"' }],
        });
    });

    it('keeps a lead-in note and accepts multiple code spans', () => {
        expect(parseFormulaStatements('Within each category: `share = value / sum(value)` and `pct = share * 100`')).toEqual({
            note: 'Within each category:',
            statements: [
                { lhs: 'share', rhs: 'value / sum(value)' },
                { lhs: 'pct', rhs: 'share * 100' },
            ],
        });
    });

    it('unescapes markdown-escaped underscores', () => {
        expect(parseFormulaStatements('`basket\\_cost = Bananas + Bread`')?.statements[0].lhs).toBe('basket_cost');
    });

    it('stacks piecewise cases under their field', () => {
        expect(parseFormulaStatements(
            "`budget_band = '<$5M' if 0 <= Production Budget < 5,000,000; '$5-25M' if 5,000,000 <= Production Budget < 25,000,000; gross_multiple = a / b`",
        )).toEqual({
            statements: [
                {
                    lhs: 'budget_band',
                    rhs: "'<$5M' if 0 <= Production Budget < 5,000,000",
                    continuations: ["'$5-25M' if 5,000,000 <= Production Budget < 25,000,000"],
                },
                { lhs: 'gross_multiple', rhs: 'a / b' },
            ],
        });
        // A case that itself contains `=` must not be read as a new field.
        expect(parseFormulaStatements("`tier = 'low' if x < 5; 'mid' if x = 5`")?.statements).toEqual([
            { lhs: 'tier', rhs: "'low' if x < 5", continuations: ["'mid' if x = 5"] },
        ]);
    });

    it('returns null for prose, LaTeX, and non-assignment code', () => {
        expect(parseFormulaStatements('The sum of all sources.')).toBeNull();
        expect(parseFormulaStatements('\\( \\text{Profit} = a - b \\)')).toBeNull();
        expect(parseFormulaStatements('`Production Budget / 1e6`')).toBeNull();
        expect(parseFormulaStatements('`f(x) = x + 1`')).toBeNull();
        expect(parseFormulaStatements('`a = b` then something else')).toBeNull();
    });
});

describe('ConceptExplCards', () => {
    it('renders assignments as aligned rows and prose with a field label', () => {
        const { container, getByText, queryByText } = render(
            <ConceptExplCards
                concepts={[
                    { field: 'budget_musd, worldwide_gross_musd', explanation: '`budget_musd = Production Budget / 1,000,000; worldwide_gross_musd = Worldwide Gross / 1,000,000`' },
                    { field: 'Total_Director_Profit', explanation: String.raw`The **cumulative** profit: \( \sum \text{Profit}_{i} \)` },
                    { field: 'Statistical Analysis', explanation: String.raw`\[ y = \beta_0 + \beta_1 x \]` },
                ]}
            />,
        );
        expect(getByText('budget_musd')).toBeTruthy();
        expect(getByText('Worldwide Gross / 1,000,000')).toBeTruthy();
        // The redundant combined label is hidden for assignment rows.
        expect(queryByText('budget_musd, worldwide_gross_musd')).toBeNull();
        expect(getByText('Total_Director_Profit')).toBeTruthy();
        expect(getByText('cumulative').tagName).toBe('STRONG');
        expect(container.querySelectorAll('.katex').length).toBe(2);
        expect(container.querySelectorAll('.katex-error').length).toBe(0);
    });
});
