import { describe, expect, it } from 'vitest';

import { validateDelegatedLoginMessage } from '../../../../src/views/DBTableManager';

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
