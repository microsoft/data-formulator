import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { buildSessionStartPrompts } from '../../../../src/views/dataLoadingSuggestions';

const t = ((_key: string, options: { defaultValue: string }) => options.defaultValue) as unknown as TFunction;

describe('buildSessionStartPrompts', () => {
    it('offers what the deployment allows, finding data online only on the user\'s own computer', () => {
        expect(buildSessionStartPrompts(t, { workflows: true, schedules: true, connectors: true, local: true })).toEqual([
            "Show me what's in my connected sources",
            'I want to create a recurring workflow to create reports',
            'Walk me through connecting a new data source',
            'Help me set up tools to discover data online',
        ]);
        expect(buildSessionStartPrompts(t, { workflows: true, schedules: false, connectors: false, local: false })).toEqual([
            "Show me what's in my connected sources",
            'I want to create a reusable workflow to create reports',
        ]);
    });
});
