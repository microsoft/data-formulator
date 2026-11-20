import { describe, expect, it } from 'vitest';

import { parseSimpleYamlList } from '../../../../src/views/ExampleSessions';

describe('demo manifest parsing', () => {
    it('reads scalar fields and follow-up lists, indented or not', () => {
        const items = parseSimpleYamlList([
            '- id: movies',
            '  title: Movies',
            '  live: false',
            '  follow_ups:',
            '    - Which genres earn the most?',
            "    - 'Is it: odd?'",
            '- id: gas',
            '  follow_ups:',
            '  - When did prices peak?',
            '  workspace: /demos/demo_gas.zip',
        ].join('\n'));
        expect(items).toEqual([
            { id: 'movies', title: 'Movies', live: false, follow_ups: ['Which genres earn the most?', 'Is it: odd?'] },
            { id: 'gas', follow_ups: ['When did prices peak?'], workspace: '/demos/demo_gas.zip' },
        ]);
    });
});
