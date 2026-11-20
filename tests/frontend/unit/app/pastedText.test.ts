/**
 * A large text paste in a chat box becomes an attached document, typed by its content.
 */
import { describe, expect, it } from 'vitest';
import { LARGE_PASTE_MIN_CHARS, pastedTextFile } from '../../../../src/app/pastedText';

describe('pastedTextFile', () => {
    it('keeps a short paste in the message', () => {
        expect(pastedTextFile('x'.repeat(LARGE_PASTE_MIN_CHARS - 1))).toBeNull();
    });

    it('names and types a large paste by its content', async () => {
        const json = JSON.stringify(Array.from({ length: 200 }, (_, id) => ({ id, title: `case ${id}` })));
        const tsv = ['court\tfiled\tjudge', ...Array.from({ length: 300 }, (_, i) => `wawd\t2024-03-${i % 28 + 1}\tKing`)].join('\n');
        const prose = 'A long blog post paragraph, with commas, and\ttabs now and then. '.repeat(80);

        const jsonFile = pastedTextFile(json, 2)!;
        expect([jsonFile.name, jsonFile.type]).toEqual(['pasted-text-2.json', 'application/json']);
        // Minified JSON is indented so the agent can page it by line; formatted JSON is kept as pasted.
        expect(await jsonFile.text()).toBe(JSON.stringify(JSON.parse(json), null, 2));
        const formatted = JSON.stringify(JSON.parse(json), null, 4);
        expect(await pastedTextFile(formatted)!.text()).toBe(formatted);
        expect(pastedTextFile(tsv)!.name).toBe('pasted-text-1.tsv');
        expect(pastedTextFile(prose)!.name).toBe('pasted-text-1.txt');
        expect(pastedTextFile(`[${json.slice(1, -1)}`.padEnd(LARGE_PASTE_MIN_CHARS, ' ') + ' trailing')!.name)
            .toBe('pasted-text-1.txt');
    });
});
