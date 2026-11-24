import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../../../src/app/store';
import { apiRequest } from '../../../../src/app/apiClient';
import { BackgroundTasksPill, durationText, Elapsed, formatElapsed, StopAgentDialog } from '../../../../src/components/BackgroundTasks';
import { backgroundTaskOf, startRecord, taskWakeRequest, type BackgroundTask } from '../../../../src/app/backgroundTasks';

vi.mock('../../../../src/app/apiClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/app/apiClient')>(),
    apiRequest: vi.fn(),
}));

const task = (id: string, extra: Partial<BackgroundTask> = {}): BackgroundTask => ({
    id, conversation_id: 'run-1', purpose: `Crawl ${id}`, command: 'python crawl.py', status: 'running',
    started: Date.now() / 1000 - 125, ended: null, elapsed_seconds: 125, exit_code: null, stopped_by: null, error: null,
    output_bytes: 40, last_lines: ['page 12 of 30'], log: `scratch/tasks/${id}.log`, ...extra,
});

describe('background tasks', () => {
    afterEach(() => vi.mocked(apiRequest).mockReset());

    it('counts a task\'s time from its start, until it ends', async () => {
        expect([formatElapsed(42), formatElapsed(127), formatElapsed(3_725)]).toEqual(['42s', '2m 7s', '1h 2m']);
        expect(durationText(1_000, 1_127.9)).toBe('2m 7s');
        const { rerender } = render(<span data-testid="time"><Elapsed started={Date.now() / 1000 - 95} /></span>);
        expect(screen.getByTestId('time')).toHaveTextContent('1m 35s');
        await waitFor(() => expect(screen.getByTestId('time')).toHaveTextContent('1m 36s'), { timeout: 2500 });
        rerender(<span data-testid="time"><Elapsed started={1_000} ended={1_030} /></span>);
        expect(screen.getByTestId('time')).toHaveTextContent('30s');
    });

    it('words the follow-up that wakes the agent for what its tasks need', () => {
        const t = (key: string, options?: Record<string, unknown>) => `${key}:${options?.count ?? ''}`;
        const ended = task('a', { status: 'failed', wake_due: 'ended' });
        const checking = task('b', { wake_due: 'check_in' });
        const request = taskWakeRequest([ended, checking], t);
        expect(request.text).toContain('- a (failed): Crawl a');
        expect(request.text).toContain('- b (check-in time; still running): Crawl b');
        expect(request.displayText).toBe('backgroundTasks.wake.update:');
        expect(taskWakeRequest([ended], t).displayText).toBe('backgroundTasks.wake.ended:1');
        expect(taskWakeRequest([checking], t).displayText).toBe('backgroundTasks.wake.checkIn:1');
    });

    it('gives the command that started a task its live status, else its record', () => {
        const record = startRecord({ background_task: 'a', started: 500, exit_code: null });
        const started = { background_task: 'a', task: record };
        const ended = { background_task: 'a', task: { status: 'completed', started: 500, ended: 530, exit_code: 0 } };
        const failedAtStart = { background_task: 'a', task: startRecord({ background_task: 'a', started: 500, ended: 500,
            task_status: 'failed', exit_code: 127 }) };
        const live = task('a');
        expect(record).toEqual({ status: 'running', started: 500, ended: null, exit_code: null });
        expect(backgroundTaskOf({ output: 'ok' }, { tasks: [], loaded: true })).toBeUndefined();
        expect(backgroundTaskOf(started, { tasks: [live], loaded: true })).toMatchObject({ status: 'running', started: live.started, ended: null });
        // Not fetched yet: it still runs from its start. Fetched without it (the server restarted): its record, or unknown.
        expect(backgroundTaskOf(started, { tasks: [], loaded: false })).toMatchObject({ status: 'running', started: 500 });
        expect(backgroundTaskOf(ended, { tasks: [], loaded: true })).toMatchObject({ status: 'completed', started: 500, ended: 530 });
        expect(backgroundTaskOf(failedAtStart, { tasks: [], loaded: true })).toMatchObject({ status: 'failed', ended: 500 });
        expect(backgroundTaskOf(started, { tasks: [], loaded: true })?.status).toBe('unknown');
    });

    it('lists only running tasks in a pill, names the request that started one, and drops one once stopped', async () => {
        let tasks = [task('a'), task('b', { status: 'completed', ended: Date.now() / 1000, exit_code: 0 })];
        vi.mocked(apiRequest).mockImplementation(async (url, options) => {
            if (url === '/api/tasks/stop') {
                const ids = JSON.parse(String(options?.body)).task_ids as string[];
                tasks = tasks.map(item => ids.includes(item.id) ? { ...item, status: 'stopped', stopped_by: 'user', ended: Date.now() / 1000 } : item);
            }
            return { data: { tasks } } as any;
        });
        const open = vi.fn();
        render(<Provider store={store}><BackgroundTasksPill requestOf={id => id === 'run-1' ? { text: 'Map the org', open } : undefined} /></Provider>);
        const pill = await screen.findByRole('button', { name: 'Background tasks' });
        expect(pill).toHaveTextContent('1 background task running');
        fireEvent.click(pill);
        expect(document.querySelector('[data-background-task="b"]')).toBeNull();
        const running = document.querySelector('[data-background-task="a"]')!;
        expect(running).toHaveTextContent('Crawl a');
        expect(running).toHaveTextContent('running · 2m 5s');
        expect(running).toHaveTextContent('page 12 of 30');
        fireEvent.click(screen.getAllByText('Map the org')[0]);
        expect(open).toHaveBeenCalled();
        fireEvent.click(pill);
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === '/api/tasks/stop')).toBe(true));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Background tasks' })).toBeNull());
    });

    it('stops only the agent unless the user also picks tasks', () => {
        const onStop = vi.fn();
        const { rerender } = render(<StopAgentDialog open tasks={[task('a'), task('b')]} onClose={() => {}} onStop={onStop} />);
        expect(screen.getByText(/started 2 background tasks that are still running/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }));
        expect(onStop).toHaveBeenLastCalledWith([]);
        rerender(<StopAgentDialog open={false} tasks={[task('a'), task('b')]} onClose={() => {}} onStop={onStop} />);
        rerender(<StopAgentDialog open tasks={[task('a'), task('b')]} onClose={() => {}} onStop={onStop} />);
        act(() => { fireEvent.click(screen.getAllByRole('checkbox')[1]); });
        fireEvent.click(screen.getByRole('button', { name: 'Stop agent and 1 task' }));
        expect(onStop).toHaveBeenLastCalledWith(['b']);
    });
});
