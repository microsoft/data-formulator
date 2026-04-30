// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unified API client for Data Formulator.
 *
 * Provides:
 * - {@link ApiRequestError} — typed error class for API failures
 * - {@link parseApiResponse} — parse JSON body into data or throw
 * - {@link parseStreamLine} — parse a single NDJSON line into a StreamEvent
 * - {@link apiRequest} — high-level non-streaming request
 * - {@link streamRequest} — high-level streaming (NDJSON) request generator
 *
 * All functions are backward-compatible with the legacy response formats
 * (`error_message`, `message`, `result` fields) so that they can be adopted
 * incrementally while backend endpoints are migrated.
 */

import { fetchWithIdentity } from './utils';

// ====== Types ==============================================================

/** Machine-readable error payload from the backend. */
export interface ApiError {
    code: string;
    message: string;
    detail?: string;
    retry?: boolean;
}

/** A single event from a streaming (NDJSON) endpoint. */
export interface StreamEvent<T = any> {
    type: string;
    data?: T;
    error?: ApiError;
    token?: string;
}

// ====== ApiRequestError ====================================================

/**
 * Thrown when an API request returns an error status.
 *
 * Carries the structured {@link ApiError} payload and HTTP status code so that
 * callers can make decisions based on `isAuthError` / `isRetryable`.
 */
export class ApiRequestError extends Error {
    public readonly name = 'ApiRequestError';

    constructor(
        public readonly apiError: ApiError,
        public readonly httpStatus: number,
    ) {
        super(apiError.message);
    }

    get isRetryable(): boolean {
        return this.apiError.retry === true;
    }

    get isAuthError(): boolean {
        return ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'ACCESS_DENIED'].includes(this.apiError.code);
    }
}

// ====== Response parsing ===================================================

/**
 * Parse a JSON response body into `{data, token}` or throw {@link ApiRequestError}.
 *
 * Handles all format generations:
 * - Phase 2+: `{status: "success", data: ...}`
 * - Phase 1:  `{status: "ok", data: ...}` or `{status: "ok", result: ...}`
 * - Error:    `{status: "error", error: {code, message, ...}}`
 * - Legacy:   `{status: "error", error_message: "..."}` or `{status: "error", message: "..."}`
 */
export function parseApiResponse<T = any>(
    body: any,
    httpStatus: number,
): { data: T; token?: string } {
    if (body.status === 'error') {
        let apiError: ApiError;
        if (body.error && typeof body.error === 'object' && body.error.code) {
            apiError = body.error as ApiError;
        } else {
            apiError = {
                code: 'UNKNOWN',
                message: body.error_message ?? body.message ?? 'Unknown error',
                retry: false,
            };
        }
        throw new ApiRequestError(apiError, httpStatus);
    }

    return {
        data: (body.data !== undefined ? body.data : body.result) as T,
        token: body.token,
    };
}

/**
 * Parse a single NDJSON line into a {@link StreamEvent}, or `null` if the line
 * is empty / unparseable.
 *
 * Handles both formats:
 * - New:    `{type: "...", data?: ..., error?: ...}`
 * - Legacy: `{status: "ok"|"error", result: {type, ...}, token, error_message}`
 */
export function parseStreamLine<T = any>(line: string): StreamEvent<T> | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed: any;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return null;
    }

    // New format: already has `type` at top level
    if (parsed.type) {
        return parsed as StreamEvent<T>;
    }

    // Legacy format: {status, result, token, error_message}
    if (parsed.status === 'ok' && parsed.result && typeof parsed.result === 'object') {
        const event: StreamEvent<T> = { ...parsed.result };
        if (parsed.token) event.token = parsed.token;
        return event;
    }

    if (parsed.status === 'error') {
        const error: ApiError = parsed.error ?? {
            code: 'UNKNOWN',
            message: parsed.error_message ?? parsed.message ?? 'Unknown error',
            retry: false,
        };
        const event: StreamEvent<T> = { type: 'error', error };
        if (parsed.token) event.token = parsed.token;
        return event;
    }

    return null;
}

// ====== High-level request functions =======================================

/**
 * Non-streaming API request with unified error handling.
 *
 * Error detection uses a two-layer approach:
 * 1. HTTP status — `!response.ok` catches auth errors (401/403) and
 *    infrastructure failures (500).
 * 2. Body status — `body.status === "error"` catches all application-level
 *    errors (returned as HTTP 200 by the backend).
 *
 * On success, returns `{data, token}`.  On failure, throws
 * {@link ApiRequestError} with the structured error payload.
 *
 * **Streaming endpoints should use {@link streamRequest} instead.**
 */
export async function apiRequest<T = any>(
    url: string,
    options?: RequestInit,
): Promise<{ data: T; token?: string }> {
    const response = await fetchWithIdentity(url, options);

    let body: any;
    try {
        body = await response.json();
    } catch {
        if (!response.ok) {
            throw new ApiRequestError(
                { code: 'HTTP_ERROR', message: `HTTP ${response.status}`, retry: false },
                response.status,
            );
        }
        throw new ApiRequestError(
            { code: 'PARSE_ERROR', message: 'Invalid JSON response', retry: false },
            response.status,
        );
    }

    // parseApiResponse handles both HTTP-level and body-level errors:
    // - If body.status === 'error', it throws ApiRequestError regardless of HTTP status
    // - If body.status is 'success' or 'ok', it extracts data
    return parseApiResponse<T>(body, response.status);
}

/**
 * Streaming (NDJSON) API request.
 *
 * Returns an async generator that yields {@link StreamEvent} objects.
 *
 * Handles two pre-stream error scenarios:
 * - True HTTP errors (500, 413, etc.) — transport-level failures
 * - Validation errors returned as 200 + application/json (not NDJSON) — the
 *   backend rejected the request but responded with a structured body
 */
export async function* streamRequest<T = any>(
    url: string,
    options: RequestInit,
    signal?: AbortSignal,
): AsyncGenerator<StreamEvent<T>> {
    const response = await fetchWithIdentity(url, { ...options, signal });

    // Defensive: true transport-level errors (500 crash, 413 WSGI reject, etc.)
    if (!response.ok) {
        let apiError: ApiError;
        try {
            const body = await response.json();
            apiError = body.error ?? {
                code: 'HTTP_ERROR',
                message: body.error_message ?? body.message ?? `HTTP ${response.status}`,
                retry: false,
            };
        } catch {
            apiError = { code: 'HTTP_ERROR', message: `HTTP ${response.status}`, retry: false };
        }
        throw new ApiRequestError(apiError, response.status);
    }

    // Validation errors: backend returns 200 + application/json instead of NDJSON
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        const body = await response.json();
        if (body.status === 'error') {
            const apiError: ApiError = body.error ?? {
                code: 'UNKNOWN',
                message: body.error_message ?? body.message ?? 'Unknown error',
                retry: false,
            };
            throw new ApiRequestError(apiError, response.status);
        }
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop()!;

            for (const line of lines) {
                const event = parseStreamLine<T>(line);
                if (event) yield event;
            }
        }

        // Process remaining buffer
        if (buffer.trim()) {
            const event = parseStreamLine<T>(buffer);
            if (event) yield event;
        }
    } finally {
        reader.releaseLock();
    }
}
