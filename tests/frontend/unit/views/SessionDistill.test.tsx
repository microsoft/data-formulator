// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for the session-scoped distillation flow
 * (design-docs/24-session-scoped-distillation.md).
 *
 * Covers:
 *   - buildSessionExperienceContext: state-independent payload assembly
 *     (trimming ladder, stat aggregation).
 *   - findSessionExperience: lookup by workspace id.
 */

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-redux', () => ({
    useDispatch: () => vi.fn(),
    useSelector: (selector: (state: any) => unknown) => selector({}),
}));

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string, opts?: any) => opts?.defaultValue ?? key }),
}));

import {
    buildSessionExperienceContext,
    findSessionExperience,
    type SessionThread,
} from '../../../../src/views/SessionDistill';
import type { KnowledgeItem } from '../../../../src/api/knowledgeApi';

const WORKSPACE = { id: 'ws-1', displayName: 'Gas analysis 2024' };

function makeThread(id: string, events: Array<Record<string, any>>): SessionThread {
    return { thread_id: id, label: id, events };
}

function userPrompt(text: string): Record<string, any> {
    return { type: 'message', from: 'user', to: 'data-agent', role: 'prompt', content: text };
}

function createTable(id: string, opts?: { columns?: string[]; sample_rows?: any[] }): Record<string, any> {
    return {
        type: 'create_table', table_id: id, source_tables: [],
        columns: opts?.columns ?? ['v'],
        row_count: 1,
        sample_rows: opts?.sample_rows ?? [{ v: 1 }],
    };
}

function toolCall(name: string, args?: string): Record<string, any> {
    return {
        type: 'message', from: 'data-agent', to: 'data-agent',
        role: 'tool_call', content: name, ...(args ? { args } : {}),
    };
}

describe('buildSessionExperienceContext', () => {
    it('returns null when no threads are supplied', () => {
        const result = buildSessionExperienceContext(WORKSPACE, []);
        expect(result).toBeNull();
    });

    it('packs every supplied thread into the payload, in order', () => {
        const threads = [
            makeThread('a', [userPrompt('load gas prices'), createTable('df_a')]),
            makeThread('b', [userPrompt('filter to 2024'), createTable('df_b')]),
        ];
        const result = buildSessionExperienceContext(WORKSPACE, threads);
        expect(result).not.toBeNull();
        expect(result!.threads).toHaveLength(2);
        expect(result!.payload.workspace_id).toBe('ws-1');
        expect(result!.payload.workspace_name).toBe('Gas analysis 2024');
        expect(result!.payload.threads.map(t => t.thread_id)).toEqual(['a', 'b']);
    });

    it('counts steps as create_table events across all threads', () => {
        const threads = [
            makeThread('a', [userPrompt('a'), createTable('df_a')]),
            makeThread('b', [userPrompt('b'), createTable('df_b1'), createTable('df_b2')]),
        ];
        const result = buildSessionExperienceContext(WORKSPACE, threads);
        expect(result!.stats.threadCount).toBe(2);
        expect(result!.stats.stepCount).toBe(3);
    });

    it('drops tool-call events when over the byte budget', () => {
        // Each tool-call event carries a large args blob to push over 60 KB.
        const huge = 'x'.repeat(20_000);
        const threads = Array.from({ length: 4 }, (_, i) =>
            makeThread(`t${i}`, [
                userPrompt(`q${i}`),
                toolCall('explore', huge),
                createTable(`df_${i}`),
            ]),
        );
        const result = buildSessionExperienceContext(WORKSPACE, threads);
        expect(result).not.toBeNull();
        // After tool-call drop the prompts + create_tables fit, so all
        // threads survive but tool calls are gone.
        expect(result!.threads).toHaveLength(4);
        const allRoles = result!.threads.flatMap(t => t.events.map(e => e.role));
        expect(allRoles).not.toContain('tool_call');
        expect(result!.notes.some(n => n.includes('tool-call'))).toBe(true);
    });

    it('drops oldest threads when payload still exceeds budget after lighter trimming', () => {
        // Build many threads each carrying a wide create_table — columns
        // arrays survive both trim steps, so the last resort kicks in.
        const wideCols = Array.from({ length: 200 }, (_, i) => `col_${i}_${'x'.repeat(20)}`);
        const threads = Array.from({ length: 80 }, (_, i) =>
            makeThread(`t${i}`, [
                userPrompt(`q${i}`),
                createTable(`df_${i}`, { columns: wideCols }),
            ]),
        );
        const result = buildSessionExperienceContext(WORKSPACE, threads);
        expect(result).not.toBeNull();
        expect(result!.threads.length).toBeLessThan(80);
        expect(result!.notes.some(n => n.includes('omitted') && n.includes('thread'))).toBe(true);
    });
});

describe('findSessionExperience', () => {
    function item(path: string, sourceWorkspaceId?: string): KnowledgeItem {
        return {
            title: path, tags: [], path, source: 'distill', created: '2026-05-06',
            sourceWorkspaceId,
        };
    }

    it('returns the entry whose sourceWorkspaceId matches', () => {
        const items = [
            item('foo.md'),
            item('gas.md', 'ws-1'),
            item('bar.md', 'ws-2'),
        ];
        const m = findSessionExperience(items, 'ws-1');
        expect(m?.path).toBe('gas.md');
    });

    it('returns undefined when nothing matches', () => {
        const items = [item('foo.md', 'ws-9')];
        expect(findSessionExperience(items, 'ws-1')).toBeUndefined();
    });

    it('returns undefined when workspaceId is empty', () => {
        const items = [item('foo.md', 'ws-1')];
        expect(findSessionExperience(items, '')).toBeUndefined();
    });
});
