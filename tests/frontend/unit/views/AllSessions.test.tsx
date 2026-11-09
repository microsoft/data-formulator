import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AllSessions } from '../../../../src/views/AllSessions';
import { listWorkspaces } from '../../../../src/app/workspaceService';

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock('react-redux', () => ({
    useDispatch: () => dispatch,
    useSelector: (selector: (state: any) => unknown) => selector({ activeWorkspace: { id: 'gas' }, serverConfig: {} }),
}));
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string, params?: Record<string, any>) => params?.defaultValue || key }),
}));
vi.mock('../../../../src/app/sessionThunks', () => ({
    openSession: (id: string, name: string) => ({ type: 'session/open', payload: { id, name } }),
    renameSession: (id: string, name: string) => ({ type: 'session/rename', payload: { id, name } }),
}));
vi.mock('../../../../src/app/workspaceService', () => ({
    listWorkspaces: vi.fn(),
    deleteWorkspace: vi.fn(),
    exportWorkspace: vi.fn(),
    setWorkspaceStarred: vi.fn(),
    onWorkspaceListChanged: () => () => {},
}));

describe('AllSessions', () => {
    it('opens from its own trigger, lists every session, and opens one', async () => {
        vi.mocked(listWorkspaces).mockResolvedValue([
            { id: 'gas', display_name: 'Gas prices', created_at: null, saved_at: null },
            { id: 'movies', display_name: 'Movies', created_at: null, saved_at: null },
        ] as any);
        render(<AllSessions trigger={open => <button onClick={open}>My sessions</button>} />);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(listWorkspaces).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'My sessions' }));
        const dialog = await screen.findByRole('dialog', { name: 'Sessions' });
        expect(await within(dialog).findByText('Movies')).toBeVisible();
        expect(within(dialog).getByText('sidebar.currentSession')).toBeVisible();

        fireEvent.click(within(dialog).getByText('Movies'));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sessions' })).toBeNull());
        expect(dispatch).toHaveBeenCalledWith({ type: 'session/open', payload: { id: 'movies', name: 'Movies' } });
    });
});
