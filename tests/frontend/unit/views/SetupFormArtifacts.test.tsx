import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { beforeEach, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, DataFormulatorState } from '../../../../src/app/dfSlice';
import { apiRequest } from '../../../../src/app/apiClient';
import { deleteSession, openSession, renameSession } from '../../../../src/app/sessionThunks';
import { requestAutoSubmit } from '../../../../src/app/setupForms';
import { ScheduleFormArtifactView, SessionsFormArtifactView } from '../../../../src/views/SetupFormArtifacts';
import type { FormArtifact, TextTurn } from '../../../../src/components/ComponentType';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../../src/app/sessionThunks', () => ({
    renameSession: vi.fn(() => async () => undefined),
    deleteSession: vi.fn(() => async () => undefined),
    openSession: vi.fn(() => async () => true),
}));

const makeStore = (form: FormArtifact) => {
    const initial = dataFormulatorReducer(undefined, { type: 'init' });
    const turn: TextTurn = { kind: 'text', id: 'turn-1', displayId: 'turn-1', textKind: 'explain', content: 'Review',
        parentNodeId: 'root', createdAt: 1, form };
    return configureStore({ reducer: dataFormulatorReducer, preloadedState: {
        ...initial, textTurns: [turn], activeWorkspace: { id: 'session_current', displayName: 'Current work' },
        globalModels: [{ id: 'server-model', model: 'gpt', endpoint: 'openai', api_key: '', api_base: '', api_version: '' }] as any,
    } as DataFormulatorState });
};

const Harness: React.FC = () => {
    const turn = useSelector((state: DataFormulatorState) => state.textTurns[0]);
    const form = turn.form!;
    return form.kind === 'schedule' ? <ScheduleFormArtifactView turn={turn} form={form} />
        : form.kind === 'sessions' ? <SessionsFormArtifactView turn={turn} form={form} /> : null;
};

beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(renameSession).mockClear();
    vi.mocked(openSession).mockClear();
    vi.mocked(deleteSession).mockClear();
});

it('renames, opens in a new tab, and deletes each session directly', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const store = makeStore({ kind: 'sessions', title: 'Empty sessions', sessions: { items: [
        { sessionId: 'session_gas', currentName: 'Untitled', suggestedName: 'Gas prices', reason: 'No tables or charts', tableCount: 0, chartCount: 0 },
        { sessionId: 'session_movies', currentName: 'Movies' },
        { sessionId: 'session_current', currentName: 'Current work', current: true },
    ] } });
    render(<Provider store={store}><Harness /></Provider>);

    expect(screen.getByText('0 tables · 0 charts')).toBeTruthy();
    expect(screen.getByText('No tables or charts')).toBeTruthy();
    expect(screen.getByText('Suggested name: Gas prices')).toBeTruthy();
    expect(screen.getByText(/^Current$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete Current work' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Current work in new tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Untitled' }));
    const field = screen.getByLabelText('Name of Untitled') as HTMLInputElement;
    expect(field.value).toBe('Gas prices');
    fireEvent.change(field, { target: { value: 'Regional gas prices' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(renameSession).toHaveBeenCalledWith('session_gas', 'Regional gas prices'));
    expect(await screen.findByText('Regional gas prices')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open Movies in new tab' }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('session=session_movies'), '_blank', 'noopener');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Movies' }));
    expect(deleteSession).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('session_movies'));
    expect(await screen.findByText('Deleted')).toBeTruthy();
    expect(openSession).not.toHaveBeenCalled();
    open.mockRestore();
});

it('applies requested renames and opening directly once on arrival', async () => {
    const store = makeStore({ kind: 'sessions', title: 'Open Movies', sessions: { items: [
        { sessionId: 'session_gas', currentName: 'Untitled', suggestedName: 'Gas prices' },
    ], open: { sessionId: 'session_movies', displayName: 'Movies' } } });
    requestAutoSubmit('turn-1');
    render(<Provider store={store}><Harness /></Provider>);

    await waitFor(() => expect(openSession).toHaveBeenCalledWith('session_movies', 'Movies'));
    expect(renameSession).toHaveBeenCalledWith('session_gas', 'Gas prices');
});

it('does not apply a restored session panel without the live request', async () => {
    const store = makeStore({ kind: 'sessions', title: 'Open Movies',
        sessions: { items: [], open: { sessionId: 'session_movies', displayName: 'Movies' } } });
    render(<Provider store={store}><Harness /></Provider>);

    expect(await screen.findByRole('button', { name: 'Open Movies' })).toBeTruthy();
    expect(openSession).not.toHaveBeenCalled();
});

const mockScheduleApi = (saved = { id: 'sched-1', next_at: '2026-10-01T16:00:00+00:00' }) => {
    vi.mocked(apiRequest).mockImplementation(async (url: string, options?: RequestInit) => {
        if (url === '/api/workflows/list') return { data: { items: [{ path: 'demo/gas.yaml', name: 'Fuel Price Trends', origin: 'demo', parameters: [] }], runs: [] } } as any;
        if (url === '/api/schedules' && options?.method === 'POST') return { data: { schedule: { ...saved, config: JSON.parse(String(options.body)).config } } } as any;
        if (url === '/api/schedules') return { data: { available: true, schedules: [] } } as any;
        throw new Error(`Unexpected request ${url}`);
    });
};

it('auto-saves a complete directly applied schedule with the user defaults', async () => {
    mockScheduleApi();
    const store = makeStore({ kind: 'schedule', title: 'Schedule Fuel Price Trends', schedule: {
        status: 'pending', issues: [], config: { name: 'Fuel Price Trends', workflow: 'demo/gas.yaml', time: '08:30', weekdays: [0, 1, 2, 3, 4] },
    } });
    requestAutoSubmit('turn-1');
    render(<Provider store={store}><Harness /></Provider>);

    await waitFor(() => expect(store.getState().textTurns[0].form).toMatchObject({ schedule: { status: 'saved', savedId: 'sched-1' } }));
    const post = vi.mocked(apiRequest).mock.calls.find(([url, options]) => url === '/api/schedules' && options?.method === 'POST');
    const body = JSON.parse(String(post![1]!.body));
    expect(body).not.toHaveProperty('id');
    expect(body.config).toMatchObject({ workflow: 'demo/gas.yaml', time: '08:30', weekdays: [0, 1, 2, 3, 4],
        model_id: 'server-model', auto_approve: false, publish: false, enabled: true });
    expect(body.config.timezone).toBeTruthy();
    expect(await screen.findByLabelText('Next run')).toBeTruthy();
});

it('keeps a schedule with unresolved issues open for review instead of auto-saving', async () => {
    mockScheduleApi();
    const store = makeStore({ kind: 'schedule', title: 'Schedule Fuel Price Trends', schedule: {
        status: 'pending', issues: ['Unknown timezone \'Mars/Base\'; choose an IANA timezone.'], config: { name: 'Fuel', workflow: 'demo/gas.yaml', weekdays: [0] },
    } });
    requestAutoSubmit('turn-1');
    render(<Provider store={store}><Harness /></Provider>);

    expect(await screen.findByText(/Unknown timezone/)).toBeTruthy();
    await waitFor(() => expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === '/api/workflows/list')).toBe(true));
    expect(vi.mocked(apiRequest).mock.calls.some(([url, options]) => url === '/api/schedules' && options?.method === 'POST')).toBe(false);
    expect(screen.getByRole('button', { name: 'Save schedule' })).toBeTruthy();
});

it('never auto-saves a schedule that auto-approves commands', async () => {
    mockScheduleApi();
    const store = makeStore({ kind: 'schedule', title: 'Schedule Fuel', schedule: {
        status: 'pending', issues: [], config: { name: 'Fuel', workflow: 'demo/gas.yaml', time: '08:30', weekdays: [0], auto_approve: true },
    } });
    requestAutoSubmit('turn-1');
    render(<Provider store={store}><Harness /></Provider>);

    expect(await screen.findByRole('button', { name: 'Save schedule' })).toBeTruthy();
    expect(vi.mocked(apiRequest).mock.calls.some(([url, options]) => url === '/api/schedules' && options?.method === 'POST')).toBe(false);
});
