/**
 * Tests for the unified API client (apiClient.ts).
 *
 * Covers:
 * - ApiRequestError construction and helpers
 * - parseApiResponse: success/error/legacy-format parsing
 * - apiRequest: HTTP-level + body-level error handling
 * - parseStreamLine: NDJSON line parsing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetchWithIdentity before importing apiClient
vi.mock('../../../../src/app/utils', () => ({
    fetchWithIdentity: vi.fn(),
}));

// Mock store for addMessages (used by streamRequest error auto-notify)
vi.mock('../../../../src/app/store', () => ({
    store: {
        getState: vi.fn(() => ({})),
        dispatch: vi.fn(),
    },
}));

import {
    ApiRequestError,
    apiRequest,
    parseApiResponse,
    parseStreamLine,
    type ApiError,
    type StreamEvent,
} from '../../../../src/app/apiClient';
import { fetchWithIdentity } from '../../../../src/app/utils';

// ---------------------------------------------------------------------------
// ApiRequestError
// ---------------------------------------------------------------------------

describe('ApiRequestError', () => {

    it('should carry apiError and httpStatus', () => {
        const apiError: ApiError = { code: 'TABLE_NOT_FOUND', message: 'Not found', retry: false };
        const err = new ApiRequestError(apiError, 404);
        expect(err.apiError).toBe(apiError);
        expect(err.httpStatus).toBe(404);
        expect(err.message).toBe('Not found');
        expect(err.name).toBe('ApiRequestError');
    });

    it('isRetryable returns true when retry flag is set', () => {
        const err = new ApiRequestError({ code: 'LLM_RATE_LIMIT', message: 'slow', retry: true }, 429);
        expect(err.isRetryable).toBe(true);
    });

    it('isRetryable returns false by default', () => {
        const err = new ApiRequestError({ code: 'INTERNAL_ERROR', message: 'oops', retry: false }, 500);
        expect(err.isRetryable).toBe(false);
    });

    it('isAuthError returns true for auth codes', () => {
        for (const code of ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'ACCESS_DENIED']) {
            const err = new ApiRequestError({ code, message: 'auth', retry: false }, 401);
            expect(err.isAuthError).toBe(true);
        }
    });

    it('isAuthError returns false for non-auth codes', () => {
        const err = new ApiRequestError({ code: 'TABLE_NOT_FOUND', message: 'nope', retry: false }, 404);
        expect(err.isAuthError).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// parseApiResponse — new format
// ---------------------------------------------------------------------------

describe('parseApiResponse', () => {

    describe('new unified format', () => {

        it('should parse success response', () => {
            const body = { status: 'ok', data: { tables: ['a', 'b'] }, token: 'tok-1' };
            const result = parseApiResponse(body, 200);
            expect(result).toEqual({ data: { tables: ['a', 'b'] }, token: 'tok-1' });
        });

        it('should throw ApiRequestError on error response', () => {
            const body = {
                status: 'error',
                error: { code: 'TABLE_NOT_FOUND', message: 'Table not found', retry: false },
            };
            expect(() => parseApiResponse(body, 404)).toThrow(ApiRequestError);
            try {
                parseApiResponse(body, 404);
            } catch (e: any) {
                expect(e.apiError.code).toBe('TABLE_NOT_FOUND');
                expect(e.httpStatus).toBe(404);
            }
        });

        it('should include detail when present', () => {
            const body = {
                status: 'error',
                error: { code: 'INTERNAL_ERROR', message: 'Oops', retry: false, detail: 'stack trace...' },
            };
            try {
                parseApiResponse(body, 500);
            } catch (e: any) {
                expect(e.apiError.detail).toBe('stack trace...');
            }
        });
    });

    // --- Legacy format compatibility ---

    describe('Phase 2 unified format', () => {

        it('should parse status:"success" response', () => {
            const body = { status: 'success', data: { tables: ['a', 'b'] } };
            const result = parseApiResponse(body, 200);
            expect(result).toEqual({ data: { tables: ['a', 'b'] }, token: undefined });
        });

        it('should parse status:"success" with token', () => {
            const body = { status: 'success', data: { id: 1 }, token: 'tok-3' };
            const result = parseApiResponse(body, 200);
            expect(result).toEqual({ data: { id: 1 }, token: 'tok-3' });
        });

        it('should throw on error with HTTP 4xx status', () => {
            const body = {
                status: 'error',
                error: { code: 'INVALID_REQUEST', message: 'Bad input', retry: false },
            };
            expect(() => parseApiResponse(body, 400)).toThrow(ApiRequestError);
            try {
                parseApiResponse(body, 400);
            } catch (e: any) {
                expect(e.apiError.code).toBe('INVALID_REQUEST');
                expect(e.httpStatus).toBe(400);
            }
        });

        it('should throw on error with HTTP 5xx status', () => {
            const body = {
                status: 'error',
                error: { code: 'LLM_SERVICE_ERROR', message: 'Upstream fail', retry: true },
            };
            expect(() => parseApiResponse(body, 502)).toThrow(ApiRequestError);
            try {
                parseApiResponse(body, 502);
            } catch (e: any) {
                expect(e.apiError.code).toBe('LLM_SERVICE_ERROR');
                expect(e.httpStatus).toBe(502);
                expect(e.isRetryable).toBe(true);
            }
        });
    });

    describe('legacy format compatibility', () => {

        it('should handle legacy error_message field', () => {
            const body = { status: 'error', error_message: 'Something went wrong', result: [] };
            expect(() => parseApiResponse(body, 500)).toThrow(ApiRequestError);
            try {
                parseApiResponse(body, 500);
            } catch (e: any) {
                expect(e.apiError.message).toBe('Something went wrong');
                expect(e.apiError.code).toBe('UNKNOWN');
            }
        });

        it('should handle legacy message field', () => {
            const body = { status: 'error', message: 'Bad request' };
            try {
                parseApiResponse(body, 400);
            } catch (e: any) {
                expect(e.apiError.message).toBe('Bad request');
            }
        });

        it('should handle legacy error with no message at all', () => {
            const body = { status: 'error', result: [] };
            try {
                parseApiResponse(body, 500);
            } catch (e: any) {
                expect(e.apiError.message).toBe('Unknown error');
                expect(e.apiError.code).toBe('UNKNOWN');
            }
        });

        it('should extract data from legacy result field', () => {
            const body = { status: 'ok', result: [1, 2, 3], token: 'tok-2' };
            const result = parseApiResponse(body, 200);
            expect(result.data).toEqual([1, 2, 3]);
        });
    });
});

// ---------------------------------------------------------------------------
// parseStreamLine — NDJSON line parser
// ---------------------------------------------------------------------------

describe('parseStreamLine', () => {

    it('should parse a normal event', () => {
        const line = JSON.stringify({ type: 'text_delta', data: { text: 'hello' } });
        const event = parseStreamLine(line);
        expect(event).not.toBeNull();
        expect(event!.type).toBe('text_delta');
        expect(event!.data).toEqual({ text: 'hello' });
    });

    it('should parse an error event', () => {
        const line = JSON.stringify({
            type: 'error',
            error: { code: 'LLM_TIMEOUT', message: 'Timeout', retry: true },
        });
        const event = parseStreamLine(line);
        expect(event!.type).toBe('error');
        expect(event!.error!.code).toBe('LLM_TIMEOUT');
        expect(event!.error!.retry).toBe(true);
    });

    it('should parse a done event', () => {
        const line = JSON.stringify({ type: 'done', data: { summary: 'all good' } });
        const event = parseStreamLine(line);
        expect(event!.type).toBe('done');
    });

    it('should return null for empty lines', () => {
        expect(parseStreamLine('')).toBeNull();
        expect(parseStreamLine('   ')).toBeNull();
    });

    it('should return null for malformed JSON', () => {
        expect(parseStreamLine('not json {')).toBeNull();
    });

    it('should handle unicode content', () => {
        const line = JSON.stringify({ type: 'text_delta', data: { text: '数据分析' } });
        const event = parseStreamLine(line);
        expect(event!.data.text).toBe('数据分析');
    });

    // Legacy format: {status: "ok"/"error", result: ...}
    it('should handle legacy status-wrapped events', () => {
        const line = JSON.stringify({
            status: 'ok',
            token: 'tok-1',
            result: { type: 'text_delta', data: { text: 'hi' } },
        });
        const event = parseStreamLine(line);
        expect(event).not.toBeNull();
        expect(event!.type).toBe('text_delta');
        expect(event!.token).toBe('tok-1');
    });

    it('should handle legacy status error wrapper', () => {
        const line = JSON.stringify({
            status: 'error',
            token: 'tok-2',
            error_message: 'Model failed',
        });
        const event = parseStreamLine(line);
        expect(event).not.toBeNull();
        expect(event!.type).toBe('error');
        expect(event!.error!.message).toBe('Model failed');
        expect(event!.token).toBe('tok-2');
    });
});


// ---------------------------------------------------------------------------
// apiRequest — non-streaming request with HTTP-level error handling
// ---------------------------------------------------------------------------

describe('apiRequest', () => {

    const mockFetch = vi.mocked(fetchWithIdentity);

    beforeEach(() => {
        mockFetch.mockReset();
    });

    function mockResponse(body: any, status = 200): Response {
        return {
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
            headers: new Headers({ 'content-type': 'application/json' }),
        } as unknown as Response;
    }

    it('should return data on 200 + status:"success"', async () => {
        mockFetch.mockResolvedValue(
            mockResponse({ status: 'success', data: { id: 1 } }, 200),
        );
        const result = await apiRequest('/api/test');
        expect(result.data).toEqual({ id: 1 });
    });

    it('should return data on 200 + status:"ok" (legacy)', async () => {
        mockFetch.mockResolvedValue(
            mockResponse({ status: 'ok', data: { id: 2 }, token: 'tok' }, 200),
        );
        const result = await apiRequest('/api/test');
        expect(result.data).toEqual({ id: 2 });
        expect(result.token).toBe('tok');
    });

    it('should throw ApiRequestError on 400 + structured error', async () => {
        mockFetch.mockResolvedValue(
            mockResponse({
                status: 'error',
                error: { code: 'INVALID_REQUEST', message: 'Bad input', retry: false },
            }, 400),
        );
        await expect(apiRequest('/api/test')).rejects.toThrow(ApiRequestError);
        try {
            await apiRequest('/api/test');
        } catch (e: any) {
            expect(e.apiError.code).toBe('INVALID_REQUEST');
            expect(e.httpStatus).toBe(400);
        }
    });

    it('should throw ApiRequestError on 502 + structured error', async () => {
        mockFetch.mockResolvedValue(
            mockResponse({
                status: 'error',
                error: { code: 'LLM_SERVICE_ERROR', message: 'Upstream fail', retry: true },
            }, 502),
        );
        await expect(apiRequest('/api/test')).rejects.toThrow(ApiRequestError);
        try {
            await apiRequest('/api/test');
        } catch (e: any) {
            expect(e.isRetryable).toBe(true);
            expect(e.httpStatus).toBe(502);
        }
    });

    it('should throw ApiRequestError on 200 + status:"error" (legacy endpoint)', async () => {
        mockFetch.mockResolvedValue(
            mockResponse({
                status: 'error',
                error_message: 'Something went wrong',
            }, 200),
        );
        await expect(apiRequest('/api/test')).rejects.toThrow(ApiRequestError);
        try {
            await apiRequest('/api/test');
        } catch (e: any) {
            expect(e.apiError.message).toBe('Something went wrong');
            expect(e.apiError.code).toBe('UNKNOWN');
        }
    });

    it('should throw HTTP_ERROR on non-JSON error response', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: () => Promise.reject(new SyntaxError('Unexpected token')),
            headers: new Headers(),
        } as unknown as Response);
        await expect(apiRequest('/api/test')).rejects.toThrow(ApiRequestError);
        try {
            await apiRequest('/api/test');
        } catch (e: any) {
            expect(e.apiError.code).toBe('HTTP_ERROR');
            expect(e.httpStatus).toBe(500);
        }
    });

    it('should throw PARSE_ERROR on 200 with non-JSON body', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.reject(new SyntaxError('Unexpected token')),
            headers: new Headers(),
        } as unknown as Response);
        await expect(apiRequest('/api/test')).rejects.toThrow(ApiRequestError);
        try {
            await apiRequest('/api/test');
        } catch (e: any) {
            expect(e.apiError.code).toBe('PARSE_ERROR');
        }
    });

    it('should pass options to fetchWithIdentity', async () => {
        mockFetch.mockResolvedValue(
            mockResponse({ status: 'success', data: null }, 200),
        );
        const signal = new AbortController().signal;
        await apiRequest('/api/test', { method: 'POST', signal });
        expect(mockFetch).toHaveBeenCalledWith('/api/test', { method: 'POST', signal });
    });
});
