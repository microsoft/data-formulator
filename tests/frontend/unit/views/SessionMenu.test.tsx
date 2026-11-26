import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataFormulatorReducer, dfActions } from '../../../../src/app/dfSlice';
import { SessionMenu, SessionShareButton } from '../../../../src/views/SessionMenu';
import { requestWormholeDialog } from '../../../../src/app/wormholeService';
import { listWorkspaces } from '../../../../src/app/workspaceService';
import { openSession } from '../../../../src/app/sessionThunks';

vi.mock('../../../../src/app/workspaceService', async importOriginal => ({
    ...(await importOriginal<object>()),
    listWorkspaces: vi.fn(),
    onWorkspaceListChanged: vi.fn(() => () => undefined),
}));
vi.mock('../../../../src/app/wormholeService', () => ({ requestWormholeDialog: vi.fn() }));
vi.mock('../../../../src/app/sessionThunks', async importOriginal => ({
    ...(await importOriginal<object>()),
    openSession: vi.fn(() => ({ type: 'session/open' })),
}));

const session = (id: string, saved: string, extra = {}) => ({ id, display_name: `Name ${id}`, created_at: saved, saved_at: saved, ...extra });

const setup = () => {
    const store = configureStore({ reducer: dataFormulatorReducer });
    store.dispatch(dfActions.setActiveWorkspace({ id: 'current', displayName: 'Pipeline' }));
    render(<Provider store={store}><SessionMenu /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /Pipeline/ }));
};

describe('the session menu at the end of the header path', () => {
    beforeEach(() => {
        vi.mocked(listWorkspaces).mockResolvedValue([
            session('current', '2026-11-20T10:00'), session('old', '2026-11-01T10:00'), session('new', '2026-11-19T10:00'),
            session('run', '2026-11-20T09:00', { scheduled_run: { workflow: 'w' } }),
            ...['a', 'b'].map((id, index) => session(id, `2026-10-0${index + 1}T10:00`)),
        ] as any);
        vi.mocked(openSession).mockClear();
    });

    it('switches to one of the three most recent other sessions, or shows them all', async () => {
        setup();
        await waitFor(() => expect(screen.getByRole('menuitem', { name: /Name new/ })).toBeInTheDocument());
        const items = screen.getAllByRole('menuitem').map(item => item.textContent);
        // Newest first, each with when it was last saved; not this session or scheduled runs.
        expect(items.map(text => text?.match(/^Name [a-z]+/)?.[0] ?? text)).toEqual(['Name new', 'Name old', 'Name b', 'All sessions…']);
        expect(items[0]).toMatch(/Nov 19/);
        expect(screen.queryByRole('menuitem', { name: /Rename|Export|wormhole/i })).toBeNull();

        fireEvent.click(screen.getByRole('menuitem', { name: /Name old/ }));
        expect(openSession).toHaveBeenCalledWith('old', 'Name old');
    });
});

describe('the header Share button', () => {
    const share = (workspace: { readOnly?: boolean; provisional?: boolean } = {}, wormhole = true) => {
        const store = configureStore({ reducer: dataFormulatorReducer });
        store.dispatch(dfActions.setServerConfig({ ...store.getState().serverConfig, SESSION_WORMHOLE_AVAILABLE: wormhole } as any));
        store.dispatch(dfActions.setActiveWorkspace({ id: 'current', displayName: 'Pipeline', ...workspace }));
        const view = render(<Provider store={store}><SessionShareButton /></Provider>);
        const button = screen.queryByRole('button', { name: 'Share' });
        if (button) fireEvent.click(button);
        const items = screen.queryAllByRole('menuitem').map(item => item.textContent);
        view.unmount();
        return items;
    };

    it('sends, exports or receives a session, as far as the session and the server allow', () => {
        vi.mocked(requestWormholeDialog).mockClear();
        expect(share()).toEqual(['Share via wormhole', 'Receive via wormhole', 'Download session file']);
        expect(share({ readOnly: true })).toEqual(['Receive via wormhole', 'Download session file']);
        expect(share({}, false)).toEqual(['Download session file']);
        // Nothing to share: no button.
        expect(share({ provisional: true }, false)).toEqual([]);
        expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    });
});
