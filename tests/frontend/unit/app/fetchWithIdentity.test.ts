/**
 * Tests for fetchWithIdentity — Bearer token attachment and 401 retry.
 *
 * Mock strategy:
 * - `oidcConfig` module is mocked to control getAccessToken / getUserManager
 * - Global `fetch` is mocked to inspect headers and simulate responses
 * - Redux store is mocked to provide identity / workspace state
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ---- Module mocks (must be before imports) --------------------------------

vi.mock('../../../../src/app/oidcConfig', () => ({
    getAccessToken: vi.fn(async () => null),
    getUserManager: vi.fn(async () => null),
}));

vi.mock('../../../../src/app/store', () => ({
    store: {
        getState: vi.fn(() => ({
            identity: { type: 'browser', id: 'test-browser-id' },
            activeWorkspace: null,
            serverConfig: { WORKSPACE_BACKEND: 'local' },
        })),
    },
}));

vi.mock('../../../../src/app/identity', () => ({
    getBrowserId: vi.fn(() => 'test-browser-id'),
}));

vi.mock('../../../../src/i18n', () => ({
    default: { language: 'en' },
}));

// ---- Imports (after mocks) -----------------------------------------------

import { fetchWithIdentity } from '../../../../src/app/utils';
import { getAccessToken, getUserManager } from '../../../../src/app/oidcConfig';

// ---- Helpers -------------------------------------------------------------

function mockFetchResponse(status: number, body: any = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ---- Tests ---------------------------------------------------------------

beforeEach(() => {
    vi.restoreAllMocks();

    // Re-apply default mock implementations after restoreAllMocks
    (getAccessToken as Mock).mockResolvedValue(null);
    (getUserManager as Mock).mockResolvedValue(null);

    globalThis.fetch = vi.fn(async () => mockFetchResponse(200));
});

describe('fetchWithIdentity', () => {

    describe('Bearer token attachment', () => {

        it('should attach Authorization header when OIDC token is available', async () => {
            (getAccessToken as Mock).mockResolvedValue('oidc-access-token-123');

            await fetchWithIdentity('/api/test');

            const callArgs = (globalThis.fetch as Mock).mock.calls[0];
            const headers = callArgs[1].headers as Headers;
            expect(headers.get('Authorization')).toBe('Bearer oidc-access-token-123');
        });

        it('should not attach Authorization header in anonymous mode', async () => {
            (getAccessToken as Mock).mockResolvedValue(null);

            await fetchWithIdentity('/api/test');

            const callArgs = (globalThis.fetch as Mock).mock.calls[0];
            const headers = callArgs[1].headers as Headers;
            expect(headers.has('Authorization')).toBe(false);
        });

        it('should always attach X-Identity-Id header', async () => {
            await fetchWithIdentity('/api/test');

            const callArgs = (globalThis.fetch as Mock).mock.calls[0];
            const headers = callArgs[1].headers as Headers;
            expect(headers.get('X-Identity-Id')).toBe('browser:test-browser-id');
        });

        it('should not modify headers for non-API URLs', async () => {
            await fetchWithIdentity('/static/file.js');

            const callArgs = (globalThis.fetch as Mock).mock.calls[0];
            expect(callArgs[1]?.headers).toBeUndefined();
        });
    });

    describe('401 retry with silent renew', () => {

        it('should retry once after silent renew on 401', async () => {
            const mockSigninSilent = vi.fn(async () => {});
            (getUserManager as Mock).mockResolvedValue({
                signinSilent: mockSigninSilent,
            });
            (getAccessToken as Mock).mockResolvedValue('old-token');

            (globalThis.fetch as Mock)
                .mockResolvedValueOnce(mockFetchResponse(401))
                .mockResolvedValueOnce(mockFetchResponse(200, { ok: true }));

            const resp = await fetchWithIdentity('/api/data');

            expect(resp.status).toBe(200);
            expect(mockSigninSilent).toHaveBeenCalledOnce();
            expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        });

        it('should return 401 when silent renew fails', async () => {
            (getUserManager as Mock).mockResolvedValue({
                signinSilent: vi.fn(async () => { throw new Error('renew failed'); }),
            });
            (getAccessToken as Mock).mockResolvedValue('expired-token');

            (globalThis.fetch as Mock).mockResolvedValue(mockFetchResponse(401));

            const resp = await fetchWithIdentity('/api/data');

            expect(resp.status).toBe(401);
        });

        it('should not retry when no UserManager is available', async () => {
            (getUserManager as Mock).mockResolvedValue(null);
            (getAccessToken as Mock).mockResolvedValue(null);

            (globalThis.fetch as Mock).mockResolvedValue(mockFetchResponse(401));

            const resp = await fetchWithIdentity('/api/data');

            expect(resp.status).toBe(401);
            expect(globalThis.fetch).toHaveBeenCalledOnce();
        });

        it('should not retry on non-401 errors', async () => {
            (getAccessToken as Mock).mockResolvedValue('token');
            (getUserManager as Mock).mockResolvedValue({
                signinSilent: vi.fn(),
            });

            (globalThis.fetch as Mock).mockResolvedValue(mockFetchResponse(500));

            const resp = await fetchWithIdentity('/api/data');

            expect(resp.status).toBe(500);
            expect(globalThis.fetch).toHaveBeenCalledOnce();
        });
    });
});
