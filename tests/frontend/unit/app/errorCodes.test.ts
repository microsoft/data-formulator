/**
 * Tests for error code → i18n message mapping (errorCodes.ts).
 */
import { describe, it, expect, vi } from 'vitest';

// Mock i18n to control translation results
vi.mock('../../../../src/i18n', () => ({
    default: {
        t: vi.fn((key: string) => {
            const translations: Record<string, string> = {
                'errors.authRequired': '需要登录',
                'errors.llmRateLimit': '请求过于频繁，请稍后再试',
                'errors.tableNotFound': '未找到数据表',
                'errors.internalError': '服务器内部错误',
            };
            return translations[key] ?? key;
        }),
    },
}));

import { getErrorMessage, ERROR_CODE_I18N_MAP } from '../../../../src/app/errorCodes';
import type { ApiError } from '../../../../src/app/apiClient';

describe('ERROR_CODE_I18N_MAP', () => {

    it('should have mappings for all major error codes', () => {
        const requiredCodes = [
            'AUTH_REQUIRED', 'AUTH_EXPIRED', 'ACCESS_DENIED',
            'TABLE_NOT_FOUND', 'INVALID_REQUEST', 'FILE_TOO_LARGE',
            'LLM_AUTH_FAILED', 'LLM_RATE_LIMIT', 'LLM_TIMEOUT',
            'LLM_SERVICE_ERROR', 'LLM_CONTENT_FILTERED',
            'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE',
        ];
        for (const code of requiredCodes) {
            expect(ERROR_CODE_I18N_MAP).toHaveProperty(code);
        }
    });

    it('should map to errors.* i18n keys', () => {
        for (const [, value] of Object.entries(ERROR_CODE_I18N_MAP)) {
            expect(value).toMatch(/^errors\./);
        }
    });
});

describe('getErrorMessage', () => {

    it('should return translated message for known code', () => {
        const err: ApiError = { code: 'AUTH_REQUIRED', message: 'Authentication required', retry: false };
        expect(getErrorMessage(err)).toBe('需要登录');
    });

    it('should return translated message for LLM rate limit', () => {
        const err: ApiError = { code: 'LLM_RATE_LIMIT', message: 'Rate limit exceeded', retry: true };
        expect(getErrorMessage(err)).toBe('请求过于频繁，请稍后再试');
    });

    it('should fall back to backend message for unknown code', () => {
        const err: ApiError = { code: 'SOME_NEW_CODE', message: 'Backend says this', retry: false };
        expect(getErrorMessage(err)).toBe('Backend says this');
    });

    it('should fall back to backend message when i18n key has no translation', () => {
        // LLM_AUTH_FAILED is in the map but not in our mock translations
        const err: ApiError = { code: 'LLM_AUTH_FAILED', message: 'Auth failed - check key', retry: false };
        // i18n.t returns the key itself when no translation → fallback to backend message
        expect(getErrorMessage(err)).toBe('Auth failed - check key');
    });

    it('should use TABLE_NOT_FOUND translation', () => {
        const err: ApiError = { code: 'TABLE_NOT_FOUND', message: 'Table not found', retry: false };
        expect(getErrorMessage(err)).toBe('未找到数据表');
    });
});
