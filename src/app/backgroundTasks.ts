// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Background tasks: long commands an agent run started that run on the server apart from it
 * (py-src/.../analyst/background_tasks.py). One shared, polled list for the task pill and the
 * stop dialog: every few seconds while a task runs, rarely otherwise.
 */

import { useSyncExternalStore } from 'react';
import { apiRequest } from './apiClient';

export interface BackgroundTask {
    id: string;
    /** The agent run (its action id) that started the task. */
    conversation_id: string;
    purpose: string;
    command: string;
    status: 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out';
    started: number;
    ended: number | null;
    elapsed_seconds: number;
    exit_code: number | null;
    stopped_by: 'user' | 'agent' | null;
    error: string | null;
    output_bytes: number;
    last_lines: string[];
    log: string;
}

const BUSY_POLL_MS = 3000;
const IDLE_POLL_MS = 20000;

let tasks: BackgroundTask[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;

const emit = () => listeners.forEach(listener => listener());

const schedule = () => {
    clearTimeout(timer);
    if (!listeners.size) return;
    timer = setTimeout(() => void refreshBackgroundTasks(), tasks.some(task => task.status === 'running') ? BUSY_POLL_MS : IDLE_POLL_MS);
};

/** Fetch the session's tasks now (e.g. right after an agent started one). */
export function refreshBackgroundTasks(): Promise<void> {
    inFlight ??= Promise.resolve()
        .then(() => apiRequest<{ tasks: BackgroundTask[] }>('/api/tasks/list', { method: 'GET' }))
        .then(response => {
            const data = response?.data;
            const next = Array.isArray(data?.tasks) ? data.tasks : [];
            if (JSON.stringify(next) !== JSON.stringify(tasks)) {
                tasks = next;
                emit();
            }
        })
        .catch(() => { /* a session without tasks, or the server is busy: try again later */ })
        .finally(() => {
            inFlight = undefined;
            schedule();
        });
    return inFlight;
}

/** Stop tasks the user picked: an interrupt, then a forced kill; a waiting agent is told the user stopped them. */
export async function stopBackgroundTasks(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await apiRequest('/api/tasks/stop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_ids: ids }),
    }).catch(() => undefined);
    await refreshBackgroundTasks();
}

export async function readBackgroundTaskLog(taskId: string): Promise<{ log: string; truncated: boolean }> {
    const { data } = await apiRequest<{ log: string; truncated: boolean }>('/api/tasks/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: taskId }),
    });
    return { log: data?.log ?? '', truncated: !!data?.truncated };
}

/** Forget the tasks shown (a different session opened); the next poll lists the new session's. */
export function resetBackgroundTasks(): void {
    tasks = [];
    emit();
    void refreshBackgroundTasks();
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) void refreshBackgroundTasks();
    return () => {
        listeners.delete(listener);
        if (!listeners.size) clearTimeout(timer);
    };
};

export function useBackgroundTasks(): BackgroundTask[] {
    return useSyncExternalStore(subscribe, () => tasks, () => tasks);
}
