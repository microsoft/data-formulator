import { describe, expect, it } from 'vitest';
import { escapeIntrawordUnderscores, parseSetupGuide } from '../../../../src/components/SetupGuide';

describe('escapeIntrawordUnderscores', () => {
    it('keeps parameter names literal in setup guides', () => {
        expect(escapeIntrawordUnderscores('**Example:** aws_access_key_id: `AKIA...`'))
            .toBe('**Example:** aws\\_access\\_key\\_id: `AKIA...`');
    });

    it('leaves code, link targets, URLs and real emphasis alone', () => {
        const markdown = 'Set `aws_profile`, see [the docs](https://example.com/a_b) or https://x.io/c_d. _(optional)_\n\n```\nmy_var = 1\n```';
        expect(escapeIntrawordUnderscores(markdown)).toBe(markdown);
    });
});

describe('parseSetupGuide', () => {
    it('splits a guide into labelled sections and name/value examples', () => {
        const guide = '**Example:** region_name: `us-east-1` · bucket: `my-data-bucket`\n\n'
            + '**Option 1 — AWS Profile (recommended):**\nSet `aws_profile`.\n\n'
            + 'Every identity needs access.';
        expect(parseSetupGuide(guide)).toEqual([
            { kind: 'example', label: 'Example', pairs: [['region_name', '`us-east-1`'], ['bucket', '`my-data-bucket`']] },
            { kind: 'section', label: 'Option 1 — AWS Profile (recommended)', body: 'Set `aws_profile`.\n\nEvery identity needs access.' },
        ]);
    });

    it('reads headings on their own line, single-value examples, and hides agent notes', () => {
        const guide = 'Intro line.\n\n**Example**\n\nurl: `https://bi.company.com`\n\n**Check**\n\nNote: use the base URL.\n\n'
            + '<!-- agent-notes -->\n\n**Query behavior**\n\nDuckDB internals.';
        expect(parseSetupGuide(guide)).toEqual([
            { kind: 'text', body: 'Intro line.' },
            { kind: 'example', label: 'Example', pairs: [['url', '`https://bi.company.com`']] },
            { kind: 'section', label: 'Check', body: 'Note: use the base URL.' },
        ]);
    });

    it('recognises examples by their shape in any language, keeping trailing notes', () => {
        expect(parseSetupGuide('**示例：** server: `localhost` · database: `mydb` (username/password empty)')).toEqual([
            { kind: 'example', label: '示例', pairs: [['server', '`localhost`'], ['database', '`mydb` (username/password empty)']] },
        ]);
    });

    it('keeps a labelled paragraph as prose when it is not all name/value pairs', () => {
        expect(parseSetupGuide('**Getting credentials:** AWS Console → IAM · Users')[0].kind).toBe('section');
    });
});
