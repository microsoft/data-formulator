import { describe, expect, it } from 'vitest';

import { formArtifactFromEvent, formArtifactStatus, requestAutoSubmit, takeAutoSubmit } from '../../../../src/app/setupForms';

describe('setup form artifacts', () => {
    it('converts every configure form event into its persisted artifact', () => {
        expect(formArtifactFromEvent({
            kind: 'connector', title: 'Connect to PostgreSQL', auto_submit: true,
            connector: { source_type: 'postgresql', prefilled: { host: 'db' } },
        })).toEqual({
            kind: 'connector', title: 'Connect to PostgreSQL',
            draft: { revision: 0, fields: [], changedByAgent: [], conflict: false },
            connector: { sourceType: 'postgresql', prefilled: { host: 'db' }, status: 'pending' },
        });
        expect(formArtifactFromEvent({
            kind: 'schedule', title: 'Schedule Fuel', schedule: {
                target: { id: 'abc', name: 'Fuel' }, config: { workflow: 'demo/gas.yaml', time: '09:00', weekdays: [0] },
                workflow_name: 'Fuel', issues: ['Choose a server-configured model connection.'],
            },
        })).toEqual({
            kind: 'schedule', title: 'Schedule Fuel', schedule: {
                target: { id: 'abc', name: 'Fuel' }, config: { workflow: 'demo/gas.yaml', time: '09:00', weekdays: [0] }, workflowName: 'Fuel',
                issues: ['Choose a server-configured model connection.'], status: 'pending',
            },
        });
        const definition = { name: 'Fuel', overview: 'Review', deliverables: ['Report'] };
        expect(formArtifactFromEvent({
            kind: 'workflow', title: 'Fuel', workflow: { content: 'name: Fuel', definition, target: { id: 'fuel.workflow.yaml', name: 'Fuel' } },
        })).toEqual({
            kind: 'workflow', title: 'Fuel',
            workflow: { content: 'name: Fuel', definition, target: { id: 'fuel.workflow.yaml', name: 'Fuel' } },
        });
        expect(formArtifactFromEvent({
            kind: 'sessions', title: 'Empty sessions', auto_submit: true, sessions: {
                items: [{ session_id: 's1', current_name: 'Untitled', suggested_name: 'Gas prices', current: false, reason: 'Empty', table_count: 0 }],
                open: { session_id: 's2', display_name: 'Movies' },
            },
        })).toEqual({
            kind: 'sessions', title: 'Empty sessions', sessions: {
                items: [{ sessionId: 's1', currentName: 'Untitled', suggestedName: 'Gas prices', reason: 'Empty', tableCount: 0 }],
                open: { sessionId: 's2', displayName: 'Movies' },
            },
        });
        expect(() => formArtifactFromEvent({ kind: 'theme' })).toThrow('Unsupported form artifact kind');
    });

    it('summarizes pending and completed forms for the thread', () => {
        expect(formArtifactStatus({ kind: 'connector', title: 'Connect', connector: { sourceType: 'mysql', status: 'connected', connectionName: 'Sales' } }))
            .toBe('Connected to Sales');
        expect(formArtifactStatus({ kind: 'schedule', title: 'Schedule Fuel', schedule: { config: {}, status: 'pending' } }))
            .toBe('Schedule Fuel');
        expect(formArtifactStatus({ kind: 'schedule', title: 'Schedule Fuel', schedule: { config: { name: 'Fuel daily' }, status: 'saved' } }))
            .toBe('Saved schedule: Fuel daily');
        expect(formArtifactStatus({ kind: 'schedule', title: 'Update Fuel', schedule: { target: { id: 'abc', name: 'Fuel' },
            config: { name: 'Fuel daily' }, status: 'saved', savedId: 'abc' } })).toBe('Updated schedule: Fuel daily');
        expect(formArtifactStatus({ kind: 'sessions', title: 'Empty sessions', sessions: { items: [] } }))
            .toBe('Empty sessions');
        expect(formArtifactStatus({ kind: 'sessions', title: 'Empty sessions', sessions: { items: [
            { sessionId: 'a', currentName: 'A', renamed: true }, { sessionId: 'b', currentName: 'B', deleted: true },
            { sessionId: 'c', currentName: 'C', deleted: true }] } })).toBe('Empty sessions: renamed 1, deleted 2 of 3 sessions');
        const workflow = { content: '', definition: { name: 'Fuel', overview: '', deliverables: [] }, target: { id: 'fuel.yaml', name: 'Fuel' } };
        expect(formArtifactStatus({ kind: 'workflow', title: 'Fuel', workflow })).toBe('Fuel');
        expect(formArtifactStatus({ kind: 'workflow', title: 'Fuel', workflow: { ...workflow, saved: { path: 'fuel.yaml', content_hash: 'h' } } }))
            .toBe('Updated workflow: Fuel');
        expect(formArtifactStatus({ kind: 'workflow', title: 'Fuel', workflow: { ...workflow, saved: { path: 'fuel-2.yaml', content_hash: 'h' } } }))
            .toBe('Saved workflow: Fuel');
    });

    it('honors a live direct-apply request exactly once and never from persisted state', () => {
        expect(JSON.stringify(formArtifactFromEvent({ kind: 'sessions', auto_submit: true, sessions: { items: [] } }))).not.toContain('auto');
        expect(takeAutoSubmit('turn-x')).toBe(false);
        requestAutoSubmit('turn-x');
        expect(takeAutoSubmit('turn-x')).toBe(true);
        expect(takeAutoSubmit('turn-x')).toBe(false);
    });
});

it('converts an MCP setup proposal and summarizes its progress', () => {
    const form = formArtifactFromEvent({ kind: 'mcp', title: 'Add GitHub', mcp: {
        add: [{ name: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', auth: { type: 'oauth' } },
            { name: 'Files', transport: 'stdio', command: 'npx', args: ['-y', 'files'], env_names: ['ROOT'] }],
        changes: [{ server_id: 'docs', server_name: 'Docs', enabled: false }], mode: 'auto', current_mode: 'ask' } });
    expect(form).toEqual({ kind: 'mcp', title: 'Add GitHub', mcp: {
        add: [{ name: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', auth: { type: 'oauth' } },
            { name: 'Files', transport: 'stdio', command: 'npx', args: ['-y', 'files'], envNames: ['ROOT'] }],
        changes: [{ serverId: 'docs', serverName: 'Docs', enabled: false }], mode: 'auto', currentMode: 'ask' } });
    expect(formArtifactStatus(form)).toBe('Add GitHub');
    if (form.kind !== 'mcp') throw new Error('expected an MCP form');
    expect(formArtifactStatus({ ...form, mcp: { ...form.mcp, add: [{ ...form.mcp.add[0], addedId: 'github' }, form.mcp.add[1]], applied: true } }))
        .toBe('Add GitHub: added 1 server, applied changes');
});

it('converts a sign-in request, keeping only known values and never a secret', () => {
    const form = formArtifactFromEvent({
        kind: 'signin', title: 'Sign in to Hugging Face', response: 'This dataset is gated.',
        signin: {
            provider: 'huggingface', provider_name: 'Hugging Face', reason: 'gated',
            explanation: 'The dataset is gated.', unlocks: 'Preview 5 rows',
            steps: [{ text: 'Accept the terms', url: 'https://huggingface.co/datasets/meta/evals' }, { text: 'Then come back' }],
            prefer: 'device', signed_in: false, token: 'should-not-be-kept',
        },
    });
    expect(form).toEqual({
        kind: 'signin', title: 'Sign in to Hugging Face', signin: {
            provider: 'huggingface', providerName: 'Hugging Face', reason: 'gated', explanation: 'The dataset is gated.',
            unlocks: 'Preview 5 rows', prefer: 'device', status: 'pending',
            steps: [{ text: 'Accept the terms', url: 'https://huggingface.co/datasets/meta/evals' }, { text: 'Then come back' }],
        },
    });
    expect(JSON.stringify(form)).not.toContain('should-not-be-kept');
    const odd = formArtifactFromEvent({ kind: 'signin', signin: { provider: 'huggingface', provider_name: 'Hugging Face',
        reason: 'because', prefer: 'password', explanation: 'x', signed_in: true, login: 'ada' } });
    expect(odd.kind === 'signin' && odd.signin).toMatchObject({ reason: 'other', login: 'ada', steps: [] });
    expect(odd.kind === 'signin' && 'prefer' in odd.signin).toBe(false);
    expect(odd.title).toBe('Sign in to Hugging Face');
});

it('summarizes a sign-in request by how the user answered', () => {
    const base = formArtifactFromEvent({ kind: 'signin', title: 'Sign in to Hugging Face',
        signin: { provider: 'huggingface', provider_name: 'Hugging Face', reason: 'gated', explanation: 'x' } });
    if (base.kind !== 'signin') throw new Error('expected a sign-in form');
    expect(formArtifactStatus(base)).toBe('Sign in to Hugging Face');
    expect(formArtifactStatus({ ...base, signin: { ...base.signin, status: 'signed_in', login: 'ada' } }))
        .toBe('Signed in to Hugging Face as @ada');
    expect(formArtifactStatus({ ...base, signin: { ...base.signin, status: 'declined' } }))
        .toBe('Continued without signing in to Hugging Face');
    expect(formArtifactStatus({ ...base, signin: { ...base.signin, status: 'replied' } }))
        .toBe('Not signed in to Hugging Face (replied in chat)');
});

it("keeps a proposed sign-in spec's known fields only", () => {
    const form = formArtifactFromEvent({ kind: 'signin', title: 'Sign in to Kaggle', signin: {
        provider: 'kaggle', provider_name: 'Kaggle', verified: false, replaces: true, reason: 'unauthorized', explanation: 'x',
        spec: { id: 'kaggle', name: 'Kaggle', send_to: ['www.kaggle.com'], get_token: 'https://www.kaggle.com/settings',
            auth: { type: 'basic', username_label: 'Kaggle username', extra: 'dropped' }, verified: false,
            methods: ['token', 'password'], domains: ['kaggle.com'], secret: 'never-kept',
            local: { file: '~/.kaggle/kaggle.json', fields: { username: 'username', key: 'key' }, extra: 'dropped' } },
    } });
    expect(form.kind === 'signin' && form.signin).toMatchObject({
        provider: 'kaggle', verified: false, replaces: true, reason: 'unauthorized',
        spec: { id: 'kaggle', send_to: ['www.kaggle.com'], auth: { type: 'basic', username_label: 'Kaggle username' },
            methods: ['token'], domains: ['kaggle.com'], verified: false,
            local: { file: '~/.kaggle/kaggle.json', fields: { username: 'username', key: 'key' } } },
    });
    expect(JSON.stringify(form)).not.toMatch(/never-kept|dropped|password/);
    const unknownAuth = formArtifactFromEvent({ kind: 'signin', signin: { provider: 'x', provider_name: 'X', explanation: 'x',
        spec: { id: 'x', auth: { type: 'cookie' } } } });
    expect(unknownAuth.kind === 'signin' && unknownAuth.signin.spec).toBeUndefined();
});
