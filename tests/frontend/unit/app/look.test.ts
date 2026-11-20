import { describe, expect, it } from 'vitest';

import { applyLookVariables, readLook, saveLook } from '../../../../src/app/look';

describe('applyLookVariables', () => {
    it('clears every variable the sharp look set when switching back to soft', () => {
        const style = document.createElement('div').style;
        applyLookVariables(style, 'sharp');
        const set = Array.from(style).filter(name => name.startsWith('--df-'));
        expect(set.length).toBeGreaterThan(0);
        applyLookVariables(style, 'soft');
        expect(Array.from(style).filter(name => name.startsWith('--df-'))).toEqual([]);
    });
});

describe('look preference', () => {
    it('reads back each look and falls back to soft for an unknown value', () => {
        saveLook('dark');
        expect(readLook()).toBe('dark');
        localStorage.setItem('df-contrast', 'neon');
        expect(readLook()).toBe('soft');
        saveLook('soft');
    });
});
