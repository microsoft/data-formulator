import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../../../src/app/store';
import { apiRequest } from '../../../../src/app/apiClient';
import { BackgroundTasksPill, StopAgentDialog } from '../../../../src/components/BackgroundTasks';
import type { BackgroundTask } from '../../../../src/app/backgroundTasks';

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
        expect(running).toHaveTextContent('running · 2m');
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
