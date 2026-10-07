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
