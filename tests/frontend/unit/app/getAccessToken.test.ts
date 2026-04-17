/**
 * Tests for getAccessToken — silent refresh on expired tokens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockSigninSilent = vi.fn();

vi.mock('../../../../src/app/oidcConfig', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../../src/app/oidcConfig')>();
    return {
        ...original,
        getUserManager: vi.fn(async () => ({
            getUser: mockGetUser,
            signinSilent: mockSigninSilent,
        })),
    };
});

import { getAccessToken } from '../../../../src/app/oidcConfig';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getAccessToken', () => {

    it('returns token when user exists and not expired', async () => {
        mockGetUser.mockResolvedValue({ expired: false, access_token: 'fresh-token' });

        const token = await getAccessToken();

        expect(token).toBe('fresh-token');
        expect(mockSigninSilent).not.toHaveBeenCalled();
    });

    it('returns null when no user stored', async () => {
        mockGetUser.mockResolvedValue(null);

        const token = await getAccessToken();

        expect(token).toBeNull();
        expect(mockSigninSilent).not.toHaveBeenCalled();
    });

    it('calls signinSilent when token is expired and returns refreshed token', async () => {
        mockGetUser.mockResolvedValue({ expired: true, access_token: 'old-token' });
        mockSigninSilent.mockResolvedValue({ expired: false, access_token: 'refreshed-token' });

        const token = await getAccessToken();

        expect(token).toBe('refreshed-token');
        expect(mockSigninSilent).toHaveBeenCalledOnce();
    });

    it('returns null when token is expired and signinSilent fails', async () => {
        mockGetUser.mockResolvedValue({ expired: true, access_token: 'old-token' });
        mockSigninSilent.mockRejectedValue(new Error('refresh failed'));

        const token = await getAccessToken();

        expect(token).toBeNull();
        expect(mockSigninSilent).toHaveBeenCalledOnce();
    });

    it('returns null when token is expired and signinSilent returns null', async () => {
        mockGetUser.mockResolvedValue({ expired: true, access_token: 'old-token' });
        mockSigninSilent.mockResolvedValue(null);

        const token = await getAccessToken();

        expect(token).toBeNull();
    });
});
