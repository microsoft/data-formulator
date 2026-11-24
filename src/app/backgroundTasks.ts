// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Background tasks: long commands an agent run started that run on the server apart from it
 * (py-src/.../analyst/background_tasks.py). One shared, polled list for the task pill, the thread's task groups and
 * the stop dialog: every few seconds while a task runs, rarely otherwise. Tasks that need the agent while no run
 * follows them wake it with a follow-up (useTaskWakeUps).
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
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
    /** Whether the task's end wakes the agent (when no run is following it), and its check-in time (epoch seconds). */
    wake?: boolean;
    check_in_at?: number | null;
    /** Why the agent should be woken for it now: it ended untold, or its check-in time came. */
    wake_due?: 'ended' | 'check_in' | null;
}

const BUSY_POLL_MS = 3000;
const IDLE_POLL_MS = 20000;

let tasks: BackgroundTask[] = [];
// Whether `tasks` came from the server since the session opened: before that, a task missing from it is not known to be gone.
let loaded = false;
let snapshot = { tasks, loaded };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;

const emit = () => {
    snapshot = { tasks, loaded };
    listeners.forEach(listener => listener());
};

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
            if (!loaded || JSON.stringify(next) !== JSON.stringify(tasks)) {
                tasks = next;
                loaded = true;
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

/** Ask the agent run `conversationId` for an update without stopping it: its wait on tasks ends at once, else its next step hears it. */
export async function checkInAgent(conversationId: string): Promise<void> {
    await apiRequest('/api/tasks/checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => undefined);
}

/** The latest task list, for code that runs outside a render (a timer). */
export const currentBackgroundTasks = (): BackgroundTask[] => tasks;

/** How long a wake-up waits after the first task needs the agent, so endings close together go in one follow-up. */
export const TASK_WAKE_BATCH_MS = 3000;

/**
 * Wake the agent for tasks that need it (`wake_due`: ended untold, or their check-in time came) while no run follows
 * them: `onWake` gets every due task at once, a moment after the first so endings close together go together, and
 * each task's news once. Held while `busy` (a run works, a message is queued or being written); the news then
 * reaches the agent another way, or after.
 */
export function useTaskWakeUps(busy: boolean, onWake: (due: BackgroundTask[]) => void): void {
    const list = useBackgroundTasks();
    const busyRef = useRef(busy);
    busyRef.current = busy;
    const onWakeRef = useRef(onWake);
    onWakeRef.current = onWake;
    const woken = useRef(new Set<string>());
    const timerRef = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => { clearTimeout(timerRef.current); timerRef.current = undefined; }, []);
    useEffect(() => {
        const fresh = (task: BackgroundTask) => !!task.wake_due && !woken.current.has(`${task.id}:${task.wake_due}`);
        if (busy || timerRef.current || !list.some(fresh)) return;
        timerRef.current = setTimeout(() => void (async () => {
            await refreshBackgroundTasks();
            timerRef.current = undefined;
            if (busyRef.current) return;
            const due = currentBackgroundTasks().filter(fresh);
            if (!due.length) return;
            due.forEach(task => woken.current.add(`${task.id}:${task.wake_due}`));
            onWakeRef.current(due);
        })(), TASK_WAKE_BATCH_MS);
    }, [list, busy]);
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The follow-up the app sends the agent for tasks that need it (`wake_due`), with no run following them: `text` for
 * the agent, `displayText` for the thread's quiet row.
 */
export function taskWakeRequest(due: BackgroundTask[], t: Translate): { text: string; displayText: string } {
    const ended = due.filter(task => task.wake_due === 'ended').length;
    const lines = due.map(task => `- ${task.id} (${task.wake_due === 'ended' ? task.status : 'check-in time; still running'}): ${task.purpose}`);
    return {
        text: '[Automatic message] Background tasks you started need your attention:\n' + lines.join('\n')
            + '\n\nTheir status and last output are in [BACKGROUND TASKS] above. Tell the user what came of them and continue '
            + 'the work they were for.',
        displayText: ended === due.length ? t('backgroundTasks.wake.ended', { count: ended })
            : ended === 0 ? t('backgroundTasks.wake.checkIn', { count: due.length })
            : t('backgroundTasks.wake.update'),
    };
}

/** The follow-up the app sends when the user asks for an update while no run is working. */
export const taskUpdateRequest = (t: Translate): { text: string; displayText: string } => ({
    text: '[Automatic message] The user asked for an update on the background tasks (see [BACKGROUND TASKS] above).',
    displayText: t('backgroundTasks.wake.asked'),
});

export async function readBackgroundTaskLog(taskId: string): Promise<{ log: string; truncated: boolean }> {
    const { data } = await apiRequest<{ log: string; truncated: boolean }>('/api/tasks/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: taskId }),
    });
    return { log: data?.log ?? '', truncated: !!data?.truncated };
}

/** Forget the tasks shown (a different session opened); the next poll lists the new session's. */
export function resetBackgroundTasks(): void {
    tasks = [];
    loaded = false;
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

/** The session's tasks and whether they came from the server yet. */
export function useBackgroundTaskList(): { tasks: BackgroundTask[]; loaded: boolean } {
    return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export type TaskStatus = BackgroundTask['status'] | 'unknown' | 'not_started';

/** A task's record on the command that started it (`result.task`), written at the start and when its status changes;
 *  times are epoch seconds (the server runs tasks locally, on this clock). */
export interface SeenTask { status: BackgroundTask['status']; started: number; ended: number | null; exit_code: number | null }

/** A task as the thread shows it. */
export interface TaskView { id: string; task?: BackgroundTask; status: TaskStatus; started?: number; ended?: number | null }

/** Whether a command's result is a background task's start (`result.background_task`). */
export const isTaskStart = (result: Record<string, unknown> | undefined): boolean => typeof result?.background_task === 'string';

/** A command meant to start a background task, as the thread holds it (a terminal execution). */
export interface TaskStartCall { id: string; status: string; background?: boolean; result?: Record<string, unknown> }

/** Whether the thread shows a command with the step's tasks: it started one, or it was meant to (and is not waiting for
 *  approval, which the command's own row asks for). */
export const isTaskStartCall = (call: TaskStartCall): boolean =>
    isTaskStart(call.result) || (!!call.background && call.status !== 'awaiting_approval');

/** A task start as the thread shows it: the task, or one still starting, or one that did not start (refused). */
export const taskViewOf = (call: TaskStartCall, list: { tasks: BackgroundTask[]; loaded: boolean }): TaskView =>
    backgroundTaskOf(call.result, list) ?? { id: call.id, status: call.status === 'running' ? 'running' : 'not_started' };

/** A started task's first record, from the start result (which says how it ended if it ended at once). */
export function startRecord(result: Record<string, unknown>): SeenTask {
    const status = typeof result.task_status === 'string' ? result.task_status as SeenTask['status'] : 'running';
    return { status, started: Number(result.started) || Date.now() / 1000,
        ended: typeof result.ended === 'number' ? result.ended : null, exit_code: (result.exit_code as number | null) ?? null };
}

/**
 * A task as the thread shows it: live while the server lists it, else its record. A task the server no longer lists
 * (it restarted) while its record says running is unknown; before the list has loaded it is taken as still running.
 */
export function backgroundTaskOf(result: Record<string, unknown> | undefined,
    list: { tasks: BackgroundTask[]; loaded: boolean }): TaskView | undefined {
    if (!isTaskStart(result)) return undefined;
    const id = result!.background_task as string;
    const task = list.tasks.find(item => item.id === id);
    if (task) return { id, task, status: task.status, started: task.started, ended: task.ended };
    const record = result!.task as Partial<SeenTask> | undefined;
    if (record?.status && record.status !== 'running') return { id, status: record.status, started: record.started, ended: record.ended ?? null };
    return { id, status: list.loaded ? 'unknown' : 'running', started: record?.started };
}
