import { describe, expect, it } from 'vitest';

import {
    formatRuleDescriptionYamlValue,
    patchRuleFrontMatterContent,
} from '../../../../src/views/knowledgePanelFrontMatter';

describe('formatRuleDescriptionYamlValue', () => {
    it('escapes quotes, backslashes, and line breaks', () => {
        const description = 'ends with slash \\ and "quote"\nalwaysApply: false';

        expect(formatRuleDescriptionYamlValue(description)).toBe(JSON.stringify(description));
    });
});

describe('patchRuleFrontMatterContent', () => {
    it('adds safe rule front matter when content has none', () => {
        const description = 'line 1\nalwaysApply: false\nsource: injected';
        const result = patchRuleFrontMatterContent('# Rule body\n', description, true);
        const lines = result.split('\n');

        expect(lines[0]).toBe('---');
        expect(lines[1]).toBe(`description: ${JSON.stringify(description)}`);
        expect(lines[2]).toBe('alwaysApply: true');
        expect(lines[3]).toBe('---');
        expect(lines.filter(line => line.startsWith('alwaysApply:'))).toEqual(['alwaysApply: true']);
    });

    it('replaces existing rule fields without letting description inject fields', () => {
        const raw = [
            '---',
            'title: existing',
            'description: old',
            'alwaysApply: false',
            'source: manual',
            '---',
            '',
            '# Body',
            '',
        ].join('\n');
        const description = 'quoted "value" and slash \\';
        const result = patchRuleFrontMatterContent(raw, description, true);
        const lines = result.split('\n');

        expect(lines).toContain('title: existing');
        expect(lines).toContain('source: manual');
        expect(lines).toContain(`description: ${JSON.stringify(description)}`);
        expect(lines.filter(line => line.startsWith('description:'))).toEqual([
            `description: ${JSON.stringify(description)}`,
        ]);
        expect(lines.filter(line => line.startsWith('alwaysApply:'))).toEqual(['alwaysApply: true']);
    });
});
