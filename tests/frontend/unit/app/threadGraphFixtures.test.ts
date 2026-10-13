import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildThreadGraph, buildThreads } from '../../../../src/app/threadGraph';

// Shared with tests/backend/agents/test_session_layer.py, which checks the Python port
// (py-src/data_formulator/analyst/session_layer/graph.py) against the same expectations.
// Regenerate after changing threadGraph.ts: UPDATE_FIXTURES=1 npx vitest run tests/frontend/unit/app/threadGraphFixtures.test.ts
const PATH = 'tests/fixtures/session_layer/threads.json';

const run = (input: any, queries: string[]) => {
    const graph = buildThreadGraph({ tables: [], ...input });
    return {
        threads: buildThreads(graph).map(thread => ({ key: thread.key, rootId: thread.rootId,
            branchFromId: thread.branchFromId ?? null, nodeIds: thread.nodeIds })),
        queries: Object.fromEntries(queries.map(id => [id, {
            ancestors: graph.ancestors(id), tableOf: graph.tableOf(id) ?? null, nearestItem: graph.nearestItem(id) ?? null,
        }])),
    };
};

describe('thread graph fixtures', () => {
    it('match the shared expectations', () => {
        const fixture = JSON.parse(readFileSync(PATH, 'utf-8'));
        for (const testCase of fixture.cases) {
            const actual = run(testCase.input, testCase.queries);
            if (process.env.UPDATE_FIXTURES) testCase.expected = actual;
            else expect(actual, testCase.name).toEqual(testCase.expected);
        }
        if (process.env.UPDATE_FIXTURES) writeFileSync(PATH, JSON.stringify(fixture, null, 2) + '\n');
    });
});
