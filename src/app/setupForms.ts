// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Setup form artifacts proposed by the agent's configure skill. The backend
 * emits every kind through one `interact` event shape; this module converts it
 * into the persisted `FormArtifact` and summarizes a form for thread labels.
 */

import type { FormArtifact } from '../components/ComponentType';

type FormEvent = Record<string, any>;

const targetOf = (target: FormEvent | undefined) => target?.id
    ? { target: { id: String(target.id), name: String(target.name ?? target.id) } } : {};

// Direct-apply requests are honored only for forms created by a live agent
// stream in this page. They are never persisted, so a reloaded or imported
// session cannot submit a setup change without the user.
const liveAutoSubmit = new Set<string>();

/** Mark a form turn just created from a live `auto_submit` event. */
export function requestAutoSubmit(turnId: string): void {
    liveAutoSubmit.add(turnId);
}

/** Consume a pending direct-apply request; true at most once per request. */
export function takeAutoSubmit(turnId: string): boolean {
    return liveAutoSubmit.delete(turnId);
}

/** Convert a form event (an `interact` setup form, or a workflow proposal's
 *  completion) into the artifact stored on its text turn. Its `auto_submit`
 *  request is registered separately with `requestAutoSubmit`. */
export function formArtifactFromEvent(form: FormEvent): FormArtifact {
    const title = String(form.title || '');
    switch (form.kind) {
        case 'connector': {
            const sourceType = String(form.connector?.source_type ?? '').trim();
            return {
                kind: 'connector',
                title: title || `Connect to ${sourceType}`,
                draft: { revision: 0, fields: [], changedByAgent: [], conflict: false },
                connector: { sourceType, prefilled: form.connector?.prefilled || {}, status: 'pending' },
            };
        }
        case 'schedule': {
            const schedule = form.schedule || {};
            return {
                kind: 'schedule', title: title || 'Schedule a workflow',
                schedule: {
                    ...targetOf(schedule.target),
                    config: schedule.config || {},
                    workflowName: schedule.workflow_name,
                    issues: Array.isArray(schedule.issues) ? schedule.issues.map(String) : [],
                    status: 'pending',
                },
            };
        }
        case 'sessions': {
            const sessions = form.sessions || {};
            return {
                kind: 'sessions', title: title || 'Sessions',
                sessions: {
                    items: (sessions.items || []).map((item: FormEvent) => ({
                        sessionId: String(item.session_id), currentName: String(item.current_name ?? ''),
                        ...(item.suggested_name ? { suggestedName: String(item.suggested_name) } : {}),
                        ...(item.current === true ? { current: true } : {}),
                        ...(item.reason ? { reason: String(item.reason) } : {}),
                        ...(item.updated_at ? { updatedAt: String(item.updated_at) } : {}),
                        ...(typeof item.table_count === 'number' ? { tableCount: item.table_count } : {}),
                        ...(typeof item.chart_count === 'number' ? { chartCount: item.chart_count } : {}),
                    })),
                    ...(sessions.open ? { open: {
                        sessionId: String(sessions.open.session_id), displayName: String(sessions.open.display_name ?? ''),
                    } } : {}),
                },
            };
        }
        case 'workflow': {
            const workflow = form.workflow || {};
            return {
                kind: 'workflow', title: title || String(workflow.definition?.name || 'Workflow'),
                workflow: { content: String(workflow.content ?? ''), definition: workflow.definition, ...targetOf(workflow.target) },
            };
        }
        default:
            throw new Error(`Unsupported form artifact kind: ${String(form.kind)}`);
    }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** One-line status of a form artifact for the data thread. */
export function formArtifactStatus(form: FormArtifact): string {
    switch (form.kind) {
        case 'connector':
            return form.connector.status === 'connected'
                ? `Connected to ${form.connector.connectionName || form.connector.sourceType}`
                : form.title;
        case 'schedule': {
            const { schedule } = form;
            if (schedule.status !== 'saved') return form.title;
            const verb = schedule.target && schedule.savedId === schedule.target.id ? 'Updated' : 'Saved';
            return `${verb} schedule: ${schedule.config.name || form.title}`;
        }
        case 'sessions': {
            const { items } = form.sessions;
            const deleted = items.filter(item => item.deleted).length;
            const renamed = items.filter(item => item.renamed && !item.deleted).length;
            const changes = [renamed && `renamed ${renamed}`, deleted && `deleted ${deleted}`].filter(Boolean);
            return changes.length ? `${form.title}: ${changes.join(', ')} of ${plural(items.length, 'session')}` : form.title;
        }
        case 'workflow': {
            const { workflow } = form;
            if (!workflow.saved) return form.title;
            const verb = workflow.target && workflow.saved.path === workflow.target.id ? 'Updated' : 'Saved';
            return `${verb} workflow: ${workflow.definition.name}`;
        }
    }
}
