import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { store } from '../../../../src/app/store';
import { dfActions } from '../../../../src/app/dfSlice';
import { SessionWormhole } from '../../../../src/views/SessionWormhole';
import * as wormhole from '../../../../src/app/wormholeService';
import type { WormholeTransfer } from '../../../../src/app/wormholeService';
import { openSession } from '../../../../src/app/sessionThunks';

vi.mock('../../../../src/app/wormholeService', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../src/app/wormholeService')>()),
    listWormholeTransfers: vi.fn(),
    sendSessionByWormhole: vi.fn(),
    receiveSessionByWormhole: vi.fn(),
    cancelWormholeTransfer: vi.fn(),
    dismissWormholeTransfer: vi.fn(),
}));
vi.mock('../../../../src/app/sessionThunks', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../src/app/sessionThunks')>()),
    openSession: vi.fn(() => () => Promise.resolve(true)),
}));

const transfer = (overrides: Partial<WormholeTransfer>): WormholeTransfer => ({
    id: 't1', direction: 'receive', status: 'done', display_name: 'Sales review', code: '7-guitarist-revenge',
    workspace_id: 'session_20261106_101500_ab12', total_bytes: 2048, transferred_bytes: 2048, error: '',
    created_at: 0, finished_at: 1, ...overrides,
});

const renderWormhole = () => render(<Provider store={store}><SessionWormhole /></Provider>);

beforeEach(() => {
    store.dispatch(dfActions.resetState());
    store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, SESSION_WORMHOLE_AVAILABLE: true }));
    vi.mocked(wormhole.dismissWormholeTransfer).mockResolvedValue();
    vi.mocked(wormhole.cancelWormholeTransfer).mockResolvedValue();
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

it('keeps a received session on screen until the user opens it', async () => {
    vi.mocked(wormhole.listWormholeTransfers).mockResolvedValue([transfer({})]);
    renderWormhole();
    expect(await screen.findByText('Session received')).toBeTruthy();

    vi.useFakeTimers();
    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });
    expect(screen.getByText('“Sales review” is now in your sessions.')).toBeTruthy();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Open session' }));
    await waitFor(() => expect(openSession).toHaveBeenCalledWith('session_20261106_101500_ab12', 'Sales review'));
    expect(wormhole.dismissWormholeTransfer).toHaveBeenCalledWith('t1');
    expect(screen.queryByText('Session received')).toBeNull();
});

it('closes the received-session card only when dismissed', async () => {
    vi.mocked(wormhole.listWormholeTransfers).mockResolvedValue([transfer({})]);
    renderWormhole();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(wormhole.dismissWormholeTransfer).toHaveBeenCalledWith('t1');
    expect(screen.queryByText('Session received')).toBeNull();
    expect(openSession).not.toHaveBeenCalled();
});

it('shows the code to send and keeps the transfer going in the background when hidden', async () => {
    const waiting = transfer({ id: 's1', direction: 'send', status: 'waiting', workspace_id: 'session_a', transferred_bytes: 0 });
    vi.mocked(wormhole.listWormholeTransfers).mockResolvedValue([waiting]);
    vi.mocked(wormhole.sendSessionByWormhole).mockResolvedValue(waiting);
    renderWormhole();
    await waitFor(() => expect(wormhole.listWormholeTransfers).toHaveBeenCalled());

    act(() => wormhole.requestWormholeDialog({ kind: 'send', workspaceId: 'session_a', displayName: 'Sales review' }));
    expect((await screen.findByTestId('wormhole-code')).textContent).toBe('7-guitarist-revenge');
    expect(screen.queryByText(/wormhole receive/)).toBeNull();
    expect(wormhole.sendSessionByWormhole).toHaveBeenCalledWith('session_a');

    fireEvent.click(screen.getByRole('button', { name: 'The transfer continues in the background.' }));
    await waitFor(() => expect(screen.queryByTestId('wormhole-code')).toBeNull());
    const card = screen.getByRole('region', { name: 'Wormhole transfers' });
    expect(card.textContent).toContain('Sending “Sales review”');
    expect(card.textContent).toContain('7-guitarist-revenge');
    expect(wormhole.cancelWormholeTransfer).not.toHaveBeenCalled();
});

it('starts a receive from a typed code and reports refused codes inline', async () => {
    vi.mocked(wormhole.listWormholeTransfers).mockResolvedValue([]);
    vi.mocked(wormhole.receiveSessionByWormhole).mockRejectedValueOnce(new Error('Enter a wormhole code like 7-guitarist-revenge.'));
    renderWormhole();
    act(() => wormhole.requestWormholeDialog({ kind: 'receive' }));
    fireEvent.change(await screen.findByTestId('wormhole-code-input'), { target: { value: 'nonsense' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
    expect(await screen.findByText('Enter a wormhole code like 7-guitarist-revenge.')).toBeTruthy();

    vi.mocked(wormhole.receiveSessionByWormhole).mockResolvedValueOnce(transfer({ id: 'r1', status: 'connecting', display_name: '' }));
    fireEvent.change(screen.getByTestId('wormhole-code-input'), { target: { value: '7 guitarist revenge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
    await waitFor(() => expect(screen.queryByTestId('wormhole-code-input')).toBeNull());
    expect(wormhole.receiveSessionByWormhole).toHaveBeenLastCalledWith('7 guitarist revenge');
    expect(screen.getByRole('region', { name: 'Wormhole transfers' }).textContent).toContain('Receiving a session');
});
