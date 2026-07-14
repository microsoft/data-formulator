/**
 * Tests for getAccessToken — silent refresh on expired tokens.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockSigninSilent = vi.fn();

import { getAccessTokenFromManager } from '../../../../src/app/oidcToken';

const manager = {
    getUser: mockGetUser,
    signinSilent: mockSigninSilent,
} as any;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getAccessTokenFromManager', () => {

    it('returns token when user exists and not expired', async () => {
        mockGetUser.mockResolvedValue({ expired: false, access_token: 'fresh-token' });

        const token = await getAccessTokenFromManager(manager);

        expect(token).toBe('fresh-token');
        expect(mockSigninSilent).not.toHaveBeenCalled();
    });

    it('returns null when no user stored', async () => {
        mockGetUser.mockResolvedValue(null);

        const token = await getAccessTokenFromManager(manager);

        expect(token).toBeNull();
        expect(mockSigninSilent).not.toHaveBeenCalled();
    });

    it('calls signinSilent when token is expired and returns refreshed token', async () => {
        mockGetUser.mockResolvedValue({ expired: true, access_token: 'old-token' });
        mockSigninSilent.mockResolvedValue({ expired: false, access_token: 'refreshed-token' });

        const token = await getAccessTokenFromManager(manager);

        expect(token).toBe('refreshed-token');
        expect(mockSigninSilent).toHaveBeenCalledOnce();
    });

    it('returns null when token is expired and signinSilent fails', async () => {
        mockGetUser.mockResolvedValue({ expired: true, access_token: 'old-token' });
        mockSigninSilent.mockRejectedValue(new Error('refresh failed'));

        const token = await getAccessTokenFromManager(manager);

        expect(token).toBeNull();
        expect(mockSigninSilent).toHaveBeenCalledOnce();
    });

    it('returns null when token is expired and signinSilent returns null', async () => {
        mockGetUser.mockResolvedValue({ expired: true, access_token: 'old-token' });
        mockSigninSilent.mockResolvedValue(null);

        const token = await getAccessTokenFromManager(manager);

        expect(token).toBeNull();
    });
});
