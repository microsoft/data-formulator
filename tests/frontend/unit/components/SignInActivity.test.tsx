import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../../../src/app/apiClient';
import { SignInActivity, type SignInEvent } from '../../../../src/components/SignInActivity';

vi.mock('../../../../src/app/apiClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/app/apiClient')>(),
    apiRequest: vi.fn(),
}));

const github = { service: 'github', name: 'GitHub', send_to: ['api.github.com'], session: 'session_1' };
const events: SignInEvent[] = [
    { ...github, time: 1794170000, event: 'used', url: 'api.github.com/user/repos', status: 200, account: 'ada' },
    { ...github, time: 1794169900, event: 'signed_in', how: 'local', read: 'gh auth token', scope: 'session', account: 'ada' },
];

describe('sign-in activity', () => {
    afterEach(() => vi.mocked(apiRequest).mockReset());

    it('lists what was signed in to, how, where the key goes and what was fetched with it', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ data: { events } } as any);
        render(<SignInActivity refresh={0} />);
        const [used, signedIn] = await screen.findAllByRole('row').then(rows => rows.slice(1));
        expect(within(used).getByText('Used')).toBeVisible();
        expect(used).toHaveTextContent('GET api.github.com/user/repos → 200');
        expect(signedIn).toHaveTextContent("Signed in");
        expect(signedIn).toHaveTextContent("this computer's login · (gh auth token) · one session · @ada");
        expect(signedIn).toHaveTextContent('api.github.com');
        expect(signedIn).toHaveTextContent('session_1');
        expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/api/accounts/activity');
    });

    it('says when there is nothing yet', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ data: { events: [] } } as any);
        render(<SignInActivity refresh={0} />);
        expect(await screen.findByText('No sign-ins yet.')).toBeVisible();
    });
});
