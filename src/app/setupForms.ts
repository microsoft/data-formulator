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
                workflow: { content: String(workflow.content ?? ''), definition: workflow.definition, ...targetOf(workflow.target),
                    ...(workflow.schedule ? { schedule: { config: workflow.schedule.config || {},
                        issues: Array.isArray(workflow.schedule.issues) ? workflow.schedule.issues.map(String) : [] } } : {}) },
            };
        }
        case 'mcp': {
            const mcp = form.mcp || {};
            const modes = ['off', 'ask', 'auto'];
            const modeOf = (value: unknown) => modes.includes(String(value)) ? value as 'off' | 'ask' | 'auto' : undefined;
            return {
                kind: 'mcp', title: title || 'MCP servers',
                mcp: {
                    add: (mcp.add || []).map((item: FormEvent) => ({
                        name: String(item.name ?? ''), transport: item.transport === 'stdio' || item.transport === 'sse' ? item.transport : 'http',
                        ...(item.url ? { url: String(item.url) } : {}),
                        ...(item.auth?.type ? { auth: { type: item.auth.type,
                            ...(item.auth.header ? { header: String(item.auth.header) } : {}),
                            ...(item.auth.client_id ? { client_id: String(item.auth.client_id) } : {}),
                            ...(item.auth.scope ? { scope: String(item.auth.scope) } : {}) } } : {}),
                        ...(item.command ? { command: String(item.command), args: (item.args || []).map(String) } : {}),
                        ...(item.cwd ? { cwd: String(item.cwd) } : {}),
                        ...(item.env_names?.length ? { envNames: item.env_names.map(String) } : {}),
                        ...(item.reason ? { reason: String(item.reason) } : {}),
                    })),
                    changes: (mcp.changes || []).map((item: FormEvent) => ({
                        serverId: String(item.server_id), serverName: String(item.server_name ?? item.server_id),
                        ...(typeof item.enabled === 'boolean' ? { enabled: item.enabled } : {}),
                        ...(item.tools?.length ? { tools: item.tools.map((tool: FormEvent) => ({ name: String(tool.name), enabled: tool.enabled === true })) } : {}),
                        ...(item.reason ? { reason: String(item.reason) } : {}),
                    })),
                    ...(modeOf(mcp.mode) ? { mode: modeOf(mcp.mode), currentMode: modeOf(mcp.current_mode) } : {}),
                },
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
        case 'mcp': {
            const { mcp } = form;
            const added = mcp.add.filter(item => item.addedId).length;
            const parts = [added && `added ${plural(added, 'server')}`, mcp.applied && 'applied changes'].filter(Boolean);
            return parts.length ? `${form.title}: ${parts.join(', ')}` : form.title;
        }
        case 'workflow': {
            const { workflow } = form;
            if (!workflow.saved) return form.title;
            const verb = workflow.target && workflow.saved.path === workflow.target.id ? 'Updated' : 'Saved';
            return `${verb}${workflow.schedule?.savedId ? ' and scheduled' : ''} workflow: ${workflow.definition.name}`;
        }
    }
}
