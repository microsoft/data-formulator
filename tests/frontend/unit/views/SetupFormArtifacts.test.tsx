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

it('shows a schedule form from before schedules were part of workflows, read-only', async () => {
    const store = makeStore({ kind: 'schedule', title: 'Schedule Fuel', schedule: {
        status: 'saved', config: { name: 'Fuel daily', time: '08:30', weekdays: [0, 1, 2, 3, 4], timezone: 'UTC' } } });
    requestAutoSubmit('turn-1');
    render(<Provider store={store}><Harness /></Provider>);

    expect(screen.getByText('Fuel daily')).toBeTruthy();
    expect(screen.getByText(/Schedules are part of workflows now/)).toBeTruthy();
    expect(screen.getByText(/Weekdays at 8:30 AM · UTC/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(apiRequest).not.toHaveBeenCalled();
});

it('records every direct rename in the stored panel', async () => {
    const store = makeStore({ kind: 'sessions', title: 'Name sessions', sessions: { items: [
        { sessionId: 'session_gas', currentName: 'Untitled', suggestedName: 'Gas prices' },
        { sessionId: 'session_movies', currentName: 'Untitled 2', suggestedName: 'Movies' },
    ] } });
    requestAutoSubmit('turn-1');
    render(<Provider store={store}><Harness /></Provider>);

    await waitFor(() => expect(renameSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(store.getState().textTurns[0].form).toMatchObject({ sessions: { items: [
        { currentName: 'Gas prices', renamed: true }, { currentName: 'Movies', renamed: true },
    ] } }));
});
