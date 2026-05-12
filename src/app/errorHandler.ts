// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unified frontend error handler for Data Formulator.
 *
 * All API `.catch` blocks should call {@link handleApiError} instead of
 * writing ad-hoc `console.error` / empty-catch logic.  This ensures every
 * error is either:
 * - Shown to the user via the global MessageSnackbar
 * - Routed to a callback (auth redirect, retry)
 * - Explicitly silenced (with `silent: true`)
 */

import { store } from './store';
import { dfActions } from './dfSlice';
import { ApiRequestError } from './apiClient';
import { getErrorMessage } from './errorCodes';

/**
 * RTK createAsyncThunk serializes thrown errors into plain objects via
 * miniSerializeError(). These objects have {name, message, stack} but are
 * NOT Error instances. This type guard identifies them.
 */
function isSerializedError(value: unknown): value is { message: string } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'message' in value &&
        typeof (value as any).message === 'string'
    );
}

/**
 * Extract a human-readable error message from any error shape.
 *
 * Handles: ApiRequestError, Error instances, RTK serialized error objects
 * ({name, message, stack}), and arbitrary values (via String()).
 *
 * Use this in places where you need the message string inline (e.g. template
 * literals in thunk .catch callbacks) instead of dispatching via handleApiError.
 */
export function extractErrorMessage(error: unknown): string {
    if (error instanceof ApiRequestError) {
        return getErrorMessage(error.apiError);
    }
    if (error instanceof Error) {
        return error.message;
    }
    if (isSerializedError(error)) {
        return error.message;
    }
    return String(error);
}

export interface HandleApiErrorOptions {
    /** When true, do not dispatch to MessageSnackbar. */
    silent?: boolean;
    /** Called when the error is an auth error (AUTH_REQUIRED / AUTH_EXPIRED / ACCESS_DENIED). */
    onAuth?: () => void;
    /** Called when the error is retryable (error.retry === true). */
    onRetryable?: () => void;
}

/**
 * Handle an API error uniformly.
 *
 * @param error    The caught error (ApiRequestError, Error, or unknown)
 * @param context  Human-readable label for the source component / operation
 * @param options  Optional callbacks and behaviour overrides
 */
export function handleApiError(
    error: unknown,
    context: string,
    options?: HandleApiErrorOptions,
): void {
    // User-initiated abort — nothing to do
    if (error instanceof DOMException && error.name === 'AbortError') {
        return;
    }

    let message: string;
    let detail: string | undefined;
    let diagnostics: any;

    if (error instanceof ApiRequestError) {
        message = getErrorMessage(error.apiError);
        detail = [error.apiError.detail, error.apiError.request_id ? `Request ID: ${error.apiError.request_id}` : undefined]
            .filter(Boolean)
            .join('\n');
        if (!detail) detail = undefined;
        diagnostics = error.apiError;

        if (error.isAuthError && options?.onAuth) {
            options.onAuth();
            return;
        }
        if (error.isRetryable && options?.onRetryable) {
            options.onRetryable();
            return;
        }
    } else if (error instanceof Error) {
        message = error.message;
    } else if (isSerializedError(error)) {
        message = error.message;
    } else {
        message = String(error);
    }

    console.error(`[${context}] ${message}`, error);

    if (!options?.silent) {
        store.dispatch(dfActions.addMessages({
            type: 'error',
            component: context,
            timestamp: Date.now(),
            value: message,
            detail,
            diagnostics,
        }));
    }
}
