import { describe, expect, it } from 'vitest';

import {
    applyAuthoredSemantics,
    authoredFieldSemantics,
    canonicalSemanticType,
    mergeInferredSemantics,
    normalizeFieldAnnotation,
} from '../../../../src/app/fieldSemantics';

describe('canonicalSemanticType', () => {
    it('maps case and punctuation variants to registered Flint types', () => {
        expect(canonicalSemanticType('year')).toBe('Year');
        expect(canonicalSemanticType('date_time')).toBe('DateTime');
        expect(canonicalSemanticType('Year Month')).toBe('YearMonth');
        expect(canonicalSemanticType('zip_code')).toBe('ZipCode');
    });

    it('maps unambiguous aliases used by agents and older prompts', () => {
        expect(canonicalSemanticType('String')).toBe('Category');
        expect(canonicalSemanticType('currency')).toBe('Amount');
        expect(canonicalSemanticType('TimeRange')).toBe('Range');
        expect(canonicalSemanticType('hour_of_day')).toBe('Hour');
        expect(canonicalSemanticType('identifier')).toBe('ID');
    });

    it('rejects encoding types and free text so inference can fill the gap', () => {
        for (const value of ['quantitative', 'nominal', 'ordinal', 'temporal', 'life expectancy (years)', '', 3, null]) {
            expect(canonicalSemanticType(value)).toBeUndefined();
        }
    });
});

describe('normalizeFieldAnnotation', () => {
    it('accepts snake_case agent keys and the names agents use for them', () => {
        expect(normalizeFieldAnnotation({
            semantic_type: 'score', domain: ['1', 5], ordinal_order: ['Low', 'High', 'Low'],
            baseline: 100, currency: 'USD', description: 'dropped',
        })).toEqual({ semanticType: 'Score', intrinsicDomain: [1, 5], sortOrder: ['Low', 'High'], divergingMidpoint: 100, unit: 'USD' });
    });

    it('drops invalid values and returns undefined when nothing usable remains', () => {
        expect(normalizeFieldAnnotation({ semantic_type: 'Number', intrinsic_domain: [5, 1], sort_order: ['only'] }))
            .toEqual({ semanticType: 'Number' });
        expect(normalizeFieldAnnotation('nominal')).toBeUndefined();
        expect(normalizeFieldAnnotation({ semantic_type: 'quantitative', unit: '  ' })).toBeUndefined();
        expect(normalizeFieldAnnotation(['Year'])).toBeUndefined();
    });

    it('keeps usable properties even without a valid type', () => {
        expect(normalizeFieldAnnotation({ semantic_type: 'index', baseline: 100 })).toEqual({ divergingMidpoint: 100 });
    });
});

describe('authoredFieldSemantics', () => {
    it('combines metadata and display names for existing columns only', () => {
        expect(authoredFieldSemantics(['year', 'share'], {
            year: 'year', share: { semantic_type: 'Percentage', intrinsic_domain: [0, 100] }, ghost: 'Count',
        }, { year: 'Year', share: 'Share (%)', ghost: 'Ghost' })).toEqual({
            year: { semanticType: 'Year', displayName: 'Year' },
            share: { semanticType: 'Percentage', intrinsicDomain: [0, 100], displayName: 'Share (%)' },
        });
        expect(authoredFieldSemantics(['a'], undefined, null)).toEqual({});
    });
});

describe('authored and inferred merging', () => {
    const inferred = { band: { semanticType: 'Category' }, total: { semanticType: 'Count', unit: 'items' } };

    it('lets authored values win, fills gaps from inference, and survives re-inference', () => {
        const authored = { band: { semanticType: 'Range', sortOrder: ['low', 'mid', 'high'], displayName: 'Band' } };
        const stored = applyAuthoredSemantics({}, authored);
        const first = mergeInferredSemantics(['band', 'total'], inferred, stored);
        expect(first.band).toMatchObject({ semanticType: 'Range', sortOrder: ['low', 'mid', 'high'], displayName: 'Band' });
        expect(first.total).toEqual({ semanticType: 'Count', unit: 'items' });

        const refreshed = mergeInferredSemantics(['band', 'total'],
            { band: { semanticType: 'Category', unit: 'tier' }, total: { semanticType: 'Number' } }, first);
        expect(refreshed.band).toMatchObject({ semanticType: 'Range', unit: 'tier', displayName: 'Band' });
        expect(refreshed.total).toEqual({ semanticType: 'Number' });
    });

    it('applies authored values over existing inference without dropping other fields', () => {
        const fields = applyAuthoredSemantics(inferred, { total: { displayName: 'Total' } });
        expect(fields.band).toEqual({ semanticType: 'Category' });
        expect(fields.total).toEqual({ semanticType: 'Count', unit: 'items', displayName: 'Total', authored: { displayName: 'Total' } });
    });

    it('keeps legacy top-level display names and drops removed columns', () => {
        const fields = mergeInferredSemantics(['band'], inferred, { band: { semanticType: 'Category', displayName: 'Band' }, gone: {} });
        expect(fields).toEqual({ band: { semanticType: 'Category', displayName: 'Band' } });
    });
});
