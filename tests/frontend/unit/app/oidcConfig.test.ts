import { beforeEach, describe, expect, it, vi } from 'vitest';

function mockJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('getAuthInfo', () => {
    beforeEach(() => {
        vi.resetModules();
        globalThis.fetch = vi.fn();
    });

    it('unwraps the unified API success envelope', async () => {
        (globalThis.fetch as any).mockResolvedValue(mockJsonResponse({
            status: 'success',
            data: {
                action: 'backend',
                login_url: '/api/auth/oidc/login',
                status_url: '/api/auth/oidc/status',
                logout_url: '/api/auth/oidc/logout',
            },
        }));

        const { getAuthInfo } = await import('../../../../src/app/oidcConfig');

        await expect(getAuthInfo()).resolves.toEqual({
            action: 'backend',
            login_url: '/api/auth/oidc/login',
            status_url: '/api/auth/oidc/status',
            logout_url: '/api/auth/oidc/logout',
        });
    });

    it('keeps legacy flat auth info responses compatible', async () => {
        (globalThis.fetch as any).mockResolvedValue(mockJsonResponse({
            action: 'frontend',
            oidc: {
                authority: 'https://issuer.example.com',
                clientId: 'client-id',
            },
        }));

        const { getAuthInfo } = await import('../../../../src/app/oidcConfig');

        await expect(getAuthInfo()).resolves.toEqual({
            action: 'frontend',
            oidc: {
                authority: 'https://issuer.example.com',
                clientId: 'client-id',
            },
        });
    });

    it('returns null when auth info is unavailable', async () => {
        (globalThis.fetch as any).mockResolvedValue(mockJsonResponse({ error: 'nope' }, 500));

        const { getAuthInfo } = await import('../../../../src/app/oidcConfig');

        await expect(getAuthInfo()).resolves.toBeNull();
    });
});
