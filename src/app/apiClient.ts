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
 * All functions enforce the current DF API protocol:
 * `{status: "success", data: ...}` or `{status: "error", error: ...}` for
 * JSON APIs, and top-level `type` events for NDJSON streams.
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
 * Parse a JSON response body into `{data}` or throw {@link ApiRequestError}.
 *
 * Handles the current API format only:
 * - Success: `{status: "success", data: ...}`
 * - Error:   `{status: "error", error: {code, message, ...}}`
 */
export function parseApiResponse<T = any>(
    body: any,
    httpStatus: number,
): { data: T } {
    if (body.status === 'error') {
        if (body.error && typeof body.error === 'object' && body.error.code) {
            throw new ApiRequestError(body.error as ApiError, httpStatus);
        }
        throw new ApiRequestError(
            { code: 'MALFORMED_ERROR', message: 'Malformed error response', retry: false },
            httpStatus,
        );
    }

    if (body.status !== 'success') {
        throw new ApiRequestError(
            { code: 'MALFORMED_RESPONSE', message: 'Malformed success response', retry: false },
            httpStatus,
        );
    }

    return {
        data: body.data as T,
    };
}

/**
 * Parse a single NDJSON line into a {@link StreamEvent}, or `null` if the line
 * is empty / unparseable.
 *
 * Handles the current stream format: `{type: "...", data?: ..., error?: ...}`.
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

    if (parsed.type) {
        return parsed as StreamEvent<T>;
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
 * On success, returns `{data}`.  On failure, throws
 * {@link ApiRequestError} with the structured error payload.
 *
 * **Streaming endpoints should use {@link streamRequest} instead.**
 */
export async function apiRequest<T = any>(
    url: string,
    options?: RequestInit,
): Promise<{ data: T }> {
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

    // parseApiResponse handles body-level success/error envelopes.
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
                message: `HTTP ${response.status}`,
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
                code: 'MALFORMED_ERROR',
                message: 'Malformed error response',
                retry: false,
            };
            throw new ApiRequestError(apiError, response.status);
        }
        throw new ApiRequestError(
            { code: 'MALFORMED_STREAM_RESPONSE', message: 'Expected NDJSON stream response', retry: false },
            response.status,
        );
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new ApiRequestError(
            { code: 'MALFORMED_STREAM_RESPONSE', message: 'Missing stream body', retry: false },
            response.status,
        );
    }
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
