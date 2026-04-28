// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Maps backend error codes to i18n translation keys.
 *
 * When the backend returns `error.code`, this mapping is used to find the
 * localised message.  If no translation exists the backend's English
 * `error.message` is used as fallback.
 */

import i18n from '../i18n';
import type { ApiError } from './apiClient';

export const ERROR_CODE_I18N_MAP: Record<string, string> = {
    // Auth
    AUTH_REQUIRED: 'errors.authRequired',
    AUTH_EXPIRED: 'errors.authExpired',
    ACCESS_DENIED: 'errors.accessDenied',

    // Input / validation
    INVALID_REQUEST: 'errors.invalidRequest',
    TABLE_NOT_FOUND: 'errors.tableNotFound',
    FILE_PARSE_ERROR: 'errors.fileParseError',
    FILE_TOO_LARGE: 'errors.fileTooLarge',
    VALIDATION_ERROR: 'errors.validationError',

    // LLM / model
    LLM_AUTH_FAILED: 'errors.llmAuthFailed',
    LLM_RATE_LIMIT: 'errors.llmRateLimit',
    LLM_CONTEXT_TOO_LONG: 'errors.llmContextTooLong',
    LLM_MODEL_NOT_FOUND: 'errors.llmModelNotFound',
    LLM_TIMEOUT: 'errors.llmTimeout',
    LLM_SERVICE_ERROR: 'errors.llmServiceError',
    LLM_CONTENT_FILTERED: 'errors.llmContentFiltered',
    LLM_UNKNOWN_ERROR: 'errors.llmUnknownError',

    // Data / connector
    DB_CONNECTION_FAILED: 'errors.dbConnectionFailed',
    DB_QUERY_ERROR: 'errors.dbQueryError',
    DATA_LOAD_ERROR: 'errors.dataLoadError',
    CONNECTOR_ERROR: 'errors.connectorError',

    // Catalog / annotations
    CATALOG_SYNC_TIMEOUT: 'errors.catalogSyncTimeout',
    CATALOG_NOT_FOUND: 'errors.catalogNotFound',
    ANNOTATION_CONFLICT: 'errors.annotationConflict',
    ANNOTATION_INVALID_PATCH: 'errors.annotationInvalidPatch',

    // Execution
    CODE_EXECUTION_ERROR: 'errors.codeExecutionError',
    AGENT_ERROR: 'errors.agentError',

    // System
    INTERNAL_ERROR: 'errors.internalError',
    SERVICE_UNAVAILABLE: 'errors.serviceUnavailable',
};

/**
 * Get the best user-facing message for an API error.
 *
 * Tries the i18n translation first; falls back to the backend message.
 */
export function getErrorMessage(apiError: ApiError): string {
    const i18nKey = ERROR_CODE_I18N_MAP[apiError.code];
    if (i18nKey) {
        const translated = i18n.t(i18nKey);
        if (translated !== i18nKey) return translated;
    }
    return apiError.message;
}
