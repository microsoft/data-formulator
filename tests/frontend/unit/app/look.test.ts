import { describe, expect, it } from 'vitest';

import { applyLookVariables } from '../../../../src/app/look';

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
