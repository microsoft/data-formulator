/**
 * Tests for the unified frontend error handler (errorHandler.ts).
 *
 * Verifies that handleApiError dispatches messages to the Redux store
 * (MessageSnackbar) and invokes callbacks appropriately.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock store
const mockDispatch = vi.fn();
vi.mock('../../../../src/app/store', () => ({
    store: {
        getState: vi.fn(() => ({})),
        dispatch: (...args: any[]) => mockDispatch(...args),
    },
}));

// Mock dfActions.addMessages
vi.mock('../../../../src/app/dfSlice', () => ({
    dfActions: {
        addMessages: vi.fn((msgs: any[]) => ({ type: 'dfSlice/addMessages', payload: msgs })),
    },
}));

// Mock i18n
vi.mock('../../../../src/i18n', () => ({
    default: {
        t: vi.fn((key: string) => key),
    },
}));

// Mock errorCodes
vi.mock('../../../../src/app/errorCodes', () => ({
    getErrorMessage: vi.fn((err: any) => err.message),
}));

import { handleApiError } from '../../../../src/app/errorHandler';
import { ApiRequestError, type ApiError } from '../../../../src/app/apiClient';
import { dfActions } from '../../../../src/app/dfSlice';

beforeEach(() => {
    mockDispatch.mockClear();
    vi.mocked(dfActions.addMessages).mockClear();
});

describe('handleApiError', () => {

    describe('ApiRequestError handling', () => {

        it('should dispatch addMessages for an ApiRequestError', () => {
            const apiError: ApiError = { code: 'TABLE_NOT_FOUND', message: 'Table not found', retry: false };
            const err = new ApiRequestError(apiError, 404);

            handleApiError(err, 'test-component');

            expect(dfActions.addMessages).toHaveBeenCalledOnce();
            const msgs = vi.mocked(dfActions.addMessages).mock.calls[0][0];
            expect(msgs).toHaveLength(1);
            expect(msgs[0].type).toBe('error');
            expect(msgs[0].component).toBe('test-component');
            expect(msgs[0].value).toBe('Table not found');
        });

        it('should include detail in the dispatched message', () => {
            const apiError: ApiError = { code: 'INTERNAL_ERROR', message: 'Oops', detail: 'stack...', retry: false };
            const err = new ApiRequestError(apiError, 500);

            handleApiError(err, 'ctx');

            const msgs = vi.mocked(dfActions.addMessages).mock.calls[0][0];
            expect(msgs[0].detail).toBe('stack...');
        });

        it('should include diagnostics with the full apiError', () => {
            const apiError: ApiError = { code: 'LLM_TIMEOUT', message: 'timeout', retry: true };
            const err = new ApiRequestError(apiError, 504);

            handleApiError(err, 'ctx');

            const msgs = vi.mocked(dfActions.addMessages).mock.calls[0][0];
            expect(msgs[0].diagnostics).toEqual(apiError);
        });
    });

    describe('AbortError handling', () => {

        it('should silently ignore AbortError', () => {
            const err = new DOMException('The operation was aborted', 'AbortError');

            handleApiError(err, 'ctx');

            expect(dfActions.addMessages).not.toHaveBeenCalled();
        });
    });

    describe('plain Error handling', () => {

        it('should dispatch addMessages for a plain Error', () => {
            const err = new Error('Network failure');

            handleApiError(err, 'network');

            expect(dfActions.addMessages).toHaveBeenCalledOnce();
            const msgs = vi.mocked(dfActions.addMessages).mock.calls[0][0];
            expect(msgs[0].value).toBe('Network failure');
            expect(msgs[0].component).toBe('network');
        });

        it('should handle non-Error values', () => {
            handleApiError('string error', 'ctx');

            const msgs = vi.mocked(dfActions.addMessages).mock.calls[0][0];
            expect(msgs[0].value).toBe('string error');
        });
    });

    describe('silent option', () => {

        it('should not dispatch when silent is true', () => {
            const err = new Error('silent boom');

            handleApiError(err, 'ctx', { silent: true });

            expect(dfActions.addMessages).not.toHaveBeenCalled();
        });
    });

    describe('callback options', () => {

        it('should call onAuth for auth errors and skip dispatch', () => {
            const onAuth = vi.fn();
            const apiError: ApiError = { code: 'AUTH_REQUIRED', message: 'Login required', retry: false };
            const err = new ApiRequestError(apiError, 401);

            handleApiError(err, 'ctx', { onAuth });

            expect(onAuth).toHaveBeenCalledOnce();
            expect(dfActions.addMessages).not.toHaveBeenCalled();
        });

        it('should call onRetryable for retryable errors and skip dispatch', () => {
            const onRetryable = vi.fn();
            const apiError: ApiError = { code: 'LLM_RATE_LIMIT', message: 'slow down', retry: true };
            const err = new ApiRequestError(apiError, 429);

            handleApiError(err, 'ctx', { onRetryable });

            expect(onRetryable).toHaveBeenCalledOnce();
            expect(dfActions.addMessages).not.toHaveBeenCalled();
        });

        it('should dispatch normally when callback is not provided for matching error', () => {
            const apiError: ApiError = { code: 'AUTH_REQUIRED', message: 'Login', retry: false };
            const err = new ApiRequestError(apiError, 401);

            handleApiError(err, 'ctx');

            expect(dfActions.addMessages).toHaveBeenCalledOnce();
        });
    });
});
