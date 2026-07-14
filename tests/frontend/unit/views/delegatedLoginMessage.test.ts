import { describe, expect, it, vi } from 'vitest';

import {
    prepareDelegatedLoginUrl,
    validateDelegatedLoginMessage,
} from '../../../../src/views/DBTableManager';

const popup = {} as Window;

function event(data: unknown, origin = 'https://data.example.com', source: Window | null = popup) {
    return { data, origin, source } as MessageEvent;
}

describe('validateDelegatedLoginMessage', () => {
    it('should accept token-free backend success from the expected popup', () => {
        const result = validateDelegatedLoginMessage(
            event({ type: 'df-sso-auth', authenticated: true }),
            'https://data.example.com',
            popup,
        );

        expect(result).toEqual({ kind: 'server-stored' });
    });

    it('should accept a legacy access token from the expected popup', () => {
        const result = validateDelegatedLoginMessage(
            event({ type: 'df-sso-auth', access_token: 'token' }),
            'https://data.example.com',
            popup,
        );

        expect(result).toEqual({
            kind: 'browser-token',
            accessToken: 'token',
            refreshToken: undefined,
            user: undefined,
        });
    });

    it('should reject a message from another origin', () => {
        const result = validateDelegatedLoginMessage(
            event({ type: 'df-sso-auth', authenticated: true }, 'https://evil.example.com'),
            'https://data.example.com',
            popup,
        );

        expect(result).toBeNull();
    });

    it('should reject a message from another window', () => {
        const result = validateDelegatedLoginMessage(
            event({ type: 'df-sso-auth', authenticated: true }, undefined, {} as Window),
            'https://data.example.com',
            popup,
        );

        expect(result).toBeNull();
    });

    it('should reject token-free messages without explicit success', () => {
        const result = validateDelegatedLoginMessage(
            event({ type: 'df-sso-auth' }),
            'https://data.example.com',
            popup,
        );

        expect(result).toBeNull();
    });
});

describe('prepareDelegatedLoginUrl', () => {
    it('should prepare app-relative login through the identity-bearing API client', async () => {
        const request = vi.fn().mockResolvedValue({
            data: { authorize_url: 'https://login.microsoftonline.com/authorize?state=abc' },
        });

        const result = await prepareDelegatedLoginUrl(
            '/api/auth/azure-sql/login',
            'azure_sql:staging',
            'https://data.example.com',
            request,
            {},
        );

        expect(request).toHaveBeenCalledWith(
            '/api/auth/azure-sql/login?df_origin=https%3A%2F%2Fdata.example.com&connector_id=azure_sql%3Astaging',
            { headers: { Accept: 'application/json' } },
        );
        expect(result).toBe('https://login.microsoftonline.com/authorize?state=abc');
    });

    it('should preserve external delegated login query parameters', async () => {
        const request = vi.fn();

        const result = await prepareDelegatedLoginUrl(
            'https://superset.example/login',
            'superset',
            'https://data.example.com',
            request,
            { tenant_id: 'tenant-id' },
        );

        expect(request).not.toHaveBeenCalled();
        expect(result).toBe(
            'https://superset.example/login?df_origin=https%3A%2F%2Fdata.example.com&connector_id=superset&tenant_id=tenant-id',
        );
    });
});
