// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import _, {  } from "lodash";
import { useEffect, useRef } from "react";
import ts from "typescript";
import { Channel, Chart, EncodingItem, EncodingMap, FieldItem, Trigger } from "../components/ComponentType";
import { DictTable } from "../components/ComponentType";
import { Type } from "../data/types";
import * as d3 from 'd3';

import { assembleVegaLite, type ChartEncoding, type AssembleOptions } from "../lib/agents-chart";
import { getBrowserId } from './identity';

export function getUrls() {
    return {
        APP_CONFIG: `/api/app-config`,
        AUTH_INFO_PREFIX: `/api/.auth/`,

        EXAMPLE_DATASETS: `/api/example-datasets`,

        // these functions involves ai agents
        LIST_GLOBAL_MODELS: `/api/agent/list-global-models`,
        CHECK_AVAILABLE_MODELS: `/api/agent/check-available-models`,
        TEST_MODEL: `/api/agent/test-model`,

        SORT_DATA_URL: `/api/agent/sort-data`,
        CLEAN_DATA_URL: `/api/agent/clean-data-stream`,
        DATA_LOADING_CHAT_URL: `/api/agent/data-loading-chat`,
        SCRATCH_UPLOAD_URL: `/api/agent/workspace/scratch/upload`,
        SCRATCH_BASE_URL: `/api/agent/workspace/scratch`,
        
        CODE_EXPL_URL: `/api/agent/code-expl`,
        CHART_INSIGHT_URL: `/api/agent/chart-insight`,
        SERVER_PROCESS_DATA_ON_LOAD: `/api/agent/process-data-on-load`,

        DERIVE_DATA: `/api/agent/derive-data`,
        REFINE_DATA: `/api/agent/refine-data`,
        DATA_AGENT_STREAMING: `/api/agent/data-agent-streaming`,

        // these functions involves database
        UPLOAD_DB_FILE: `/api/tables/upload-db-file`,
        DOWNLOAD_DB_FILE: `/api/tables/download-db-file`,
        RESET_DB_FILE: `/api/tables/reset-db-file`,

        LIST_TABLES: `/api/tables/list-tables`,
        TABLE_DATA: `/api/tables/get-table`,
        CREATE_TABLE: `/api/tables/create-table`,
        PARSE_FILE: `/api/tables/parse-file`,
        DELETE_TABLE: `/api/tables/delete-table`,
        GET_COLUMN_STATS: `/api/tables/analyze`,
        SAMPLE_TABLE: `/api/tables/sample-table`,
        SYNC_TABLE_DATA: `/api/tables/sync-table-data`,
        EXPORT_TABLE_CSV: `/api/tables/export-table-csv`,

        GET_RECOMMENDATION_QUESTIONS: `/api/agent/get-recommendation-questions`,
        GENERATE_REPORT_CHAT: `/api/agent/generate-report-chat`,

        // Workspace display name (auto-naming)
        WORKSPACE_NAME: `/api/agent/workspace-name`,

        // NL-to-filter
        NL_TO_FILTER: `/api/agent/nl-to-filter`,

        // Chart style refinement (restyle agent)
        CHART_RESTYLE: `/api/agent/chart-restyle`,

        // Intent classifier — routes a chart prompt to restyle vs. data agent
        CLASSIFY_CHART_INTENT: `/api/agent/classify-chart-intent`,

        // Refresh data endpoint
        REFRESH_DERIVED_DATA: `/api/agent/refresh-derived-data`,

        // Session management
        SESSION_SAVE: `/api/sessions/save`,
        SESSION_LIST: `/api/sessions/list`,
        SESSION_LOAD: `/api/sessions/load`,
        SESSION_DELETE: `/api/sessions/delete`,
        SESSION_EXPORT: `/api/sessions/export`,
        SESSION_IMPORT: `/api/sessions/import`,
        SESSION_UPDATE_META: `/api/sessions/update-meta`,

        // Workspace
        OPEN_WORKSPACE: `/api/tables/open-workspace`,
    };
}

/**
 * Structured reference to a table in an external data source.
 * - `id`:   opaque identifier the backend loader needs (e.g. numeric dataset_id for Superset,
 *           "schema.table" for a SQL database).
 * - `name`: human-readable label used for display and workspace file naming.
 */
export interface SourceTableRef {
    id: string;
    name: string;
}

/**
 * Static API URLs for connector actions.
 * All action routes accept `connector_id` in the JSON body.
 */
export const CONNECTOR_ACTION_URLS = {
    CONNECT: '/api/connectors/connect',
    DISCONNECT: '/api/connectors/disconnect',
    GET_STATUS: '/api/connectors/get-status',
    GET_CATALOG: '/api/connectors/get-catalog',
    GET_CATALOG_TREE: '/api/connectors/get-catalog-tree',
    SEARCH_CATALOG: '/api/connectors/search-catalog',
    SYNC_CATALOG_METADATA: '/api/connectors/sync-catalog-metadata',
    GET_CACHED_CATALOG_TREE: '/api/connectors/get-cached-catalog-tree',
    IMPORT_DATA: '/api/connectors/import-data',
    REFRESH_DATA: '/api/connectors/refresh-data',
    PREVIEW_DATA: '/api/connectors/preview-data',
    IMPORT_GROUP: '/api/connectors/import-group',
    COLUMN_VALUES: '/api/connectors/column-values',
} as const;

/** Global connector management URLs. */
export const CONNECTOR_URLS = {
    DATA_LOADERS: '/api/data-loaders',
    LIST: '/api/connectors',
    CREATE: '/api/connectors',
    DELETE: (id: string) => `/api/connectors/${id}`,
} as const;

/**
 * Get the current namespaced identity from the Redux store, or fall back to browser ID.
 * Returns identity in "type:id" format (e.g., "user:alice@example.com" or "browser:550e8400-...")
 * 
 * This namespaced format ensures the backend can distinguish between authenticated users
 * and anonymous browser sessions, preventing identity spoofing attacks.
 */
async function getCurrentNamespacedIdentity(): Promise<string> {
    try {
        const { store } = await import('./store');
        const state = store.getState();
        if (state.identity?.id && state.identity?.type) {
            return `${state.identity.type}:${state.identity.id}`;
        }
    } catch (e) {
        // Store not available
    }
    // Fall back to browser ID from localStorage
    return `browser:${getBrowserId()}`;
}

// getAccessToken / getUserManager are imported lazily to avoid circular deps
// and to keep the module working when oidc-client-ts is not bundled.

/**
 * Get the active workspace ID from the Redux store.
 * Returns null if no workspace is active.
 */
async function getActiveWorkspaceId(): Promise<string | null> {
    try {
        const { store } = await import('./store');
        const state = store.getState();
        return state?.activeWorkspace?.id ?? null;
    } catch {
        return null;
    }
}

/**
 * Build a request with identity / auth / workspace headers and ephemeral-mode
 * body injection, then execute a single `fetch`.  This is the inner workhorse
 * called by {@link fetchWithIdentity} (which wraps it with 401 retry).
 */
async function _doFetch(
    url: string | URL,
    options: RequestInit = {}
): Promise<Response> {
    const urlString = typeof url === 'string' ? url : url.toString();

    if (urlString.startsWith('/api/')) {
        const headers = new Headers(options.headers);

        const namespacedIdentity = await getCurrentNamespacedIdentity();
        headers.set('X-Identity-Id', namespacedIdentity);

        const workspaceId = await getActiveWorkspaceId();
        if (workspaceId) {
            headers.set('X-Workspace-Id', workspaceId);
        }

        headers.set('Accept-Language', getAgentLanguage());

        // Attach OIDC Bearer token when available (frontend mode only).
        // In backend mode the session cookie handles auth — no Bearer needed.
        try {
            const { getAccessToken, isBackendAuth } = await import('./oidcConfig');
            const backend = await isBackendAuth();
            if (!backend) {
                const accessToken = await getAccessToken();
                if (accessToken) {
                    headers.set('Authorization', `Bearer ${accessToken}`);
                }
            }
        } catch {
            // oidc-client-ts not available — anonymous mode
        }

        options = { ...options, headers };

        console.log(
            `[fetchWithIdentity] ${options.method || 'GET'} ${urlString} with headers:`,
            Object.fromEntries(headers.entries()),
        );

        // Ephemeral mode: attach full table data from IndexedDB to JSON POST requests.
        if (workspaceId && options.method?.toUpperCase() === 'POST') {
            const isEphemeral = await _isEphemeralBackend();
            if (isEphemeral && typeof options.body === 'string') {
                try {
                    const { tableDataDB } = await import('./workspaceDB');
                    const workspaceTables = await tableDataDB.loadAll(workspaceId);
                    const body = JSON.parse(options.body);
                    body._workspace_tables = workspaceTables;
                    options = { ...options, body: JSON.stringify(body) };
                } catch (e) {
                    console.warn('[fetchWithIdentity] Failed to attach workspace tables:', e);
                }
            }
        }
    }

    return fetch(url, options);
}

/**
 * Enhanced fetch wrapper that automatically adds identity and auth headers
 * for API requests.
 *
 * Security model:
 * - `X-Identity-Id`: Namespaced identity (`"type:id"` format) for all requests
 * - `Authorization: Bearer <token>`: OIDC access-token when available
 *
 * On a 401 response the function attempts a silent OIDC token refresh and
 * retries the request exactly once.  If the retry also fails (or OIDC is not
 * active) the original 401 response is returned.
 *
 * Use this instead of native `fetch()` for all `/api/` calls.
 */
export async function fetchWithIdentity(
    url: string | URL,
    options: RequestInit = {}
): Promise<Response> {
    const resp = await _doFetch(url, options);

    if (resp.status === 401) {
        try {
            const { getUserManager } = await import('./oidcConfig');
            const mgr = await getUserManager();
            if (mgr) {
                await mgr.signinSilent();
                return _doFetch(url, options);
            }
        } catch {
            // Silent renew failed or OIDC not available — return original 401
        }
    }

    return resp;
}

async function _isEphemeralBackend(): Promise<boolean> {
    try {
        const { store } = await import('./store');
        return store.getState().serverConfig?.WORKSPACE_BACKEND === 'ephemeral';
    } catch {
        return false;
    }
}

import i18n from '../i18n';

/**
 * Returns the current UI language code (e.g. "zh", "en") for use in agent API requests.
 */
export function getAgentLanguage(): string {
    return i18n.language.split('-')[0];
}

/**
 * Translate a backend message using an optional ``message_code`` / ``content_code``.
 *
 * The backend sends English text as the default value plus a code that maps
 * to a key under ``messages.agent.*`` in the i18n locale files.  If no code
 * is provided or no translation exists, the original English text is returned.
 *
 * @example
 *   translateBackend(event.message, event.message_code, event.message_params)
 *   translateBackend(result.content, result.content_code)
 */
export function translateBackend(
    fallback: string,
    code?: string,
    params?: Record<string, unknown>,
): string {
    if (!code) return fallback;
    const key = `messages.${code}`;
    const translated = i18n.t(key, { ...params, defaultValue: fallback });
    return translated;
}

/**
 * Translate a list of backend option labels using parallel code arrays.
 */
export function translateBackendOptions(
    options: string[],
    codes?: string[],
): string[] {
    if (!codes || codes.length === 0) return options;
    return options.map((opt, i) =>
        codes[i] ? translateBackend(opt, codes[i]) : opt,
    );
}

import * as vm from 'vm-browserify';

export function usePrevious<T>(value: T): T | undefined {
    const ref = useRef<T>();
    useEffect(() => {
        ref.current = value;
    });
    return ref.current;
}

/**
 * Simple hash function (djb2 algorithm) for creating content fingerprints
 * @param str - The string to hash
 * @returns A hexadecimal hash string
 */
function djb2Hash(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
    }
    return (hash >>> 0).toString(16); // Convert to unsigned and then to hex
}

/**
 * Computes a content hash for table data to detect changes.
 * Uses a sampling strategy for efficiency with large datasets:
 * - Always includes column names and row count
 * - Samples first 50, last 50, and 50 evenly distributed rows from the middle
 * - This catches most data changes while remaining efficient
 * 
 * @param rows - The table rows to hash
 * @param names - Optional column names (for additional fingerprinting)
 * @returns A hash string representing the content
 */
export function computeContentHash(rows: any[], names?: string[]): string {
    const parts: string[] = [];
    
    // Include column names if provided
    if (names && names.length > 0) {
        parts.push(`cols:${names.join(',')}`);
    }
    
    // Include row count
    const rowCount = rows.length;
    parts.push(`count:${rowCount}`);
    
    if (rowCount === 0) {
        return djb2Hash(parts.join('|'));
    }
    
    // Get column names from first row if not provided
    const columnNames = names || Object.keys(rows[0] || {});
    parts.push(`fields:${columnNames.join(',')}`);
    
    // Sampling strategy for efficiency
    const sampleSize = 50;
    const samplesToInclude: number[] = [];
    
    // Always include first N rows
    for (let i = 0; i < Math.min(sampleSize, rowCount); i++) {
        samplesToInclude.push(i);
    }
    
    // Include evenly distributed rows from the middle
    if (rowCount > sampleSize * 2) {
        const step = Math.floor((rowCount - sampleSize * 2) / sampleSize);
        if (step > 0) {
            for (let i = sampleSize; i < rowCount - sampleSize; i += step) {
                if (samplesToInclude.length < sampleSize * 2) {
                    samplesToInclude.push(i);
                }
            }
        }
    }
    
    // Always include last N rows
    for (let i = Math.max(rowCount - sampleSize, sampleSize); i < rowCount; i++) {
        if (!samplesToInclude.includes(i)) {
            samplesToInclude.push(i);
        }
    }
    
    // Sort indices for consistent ordering
    samplesToInclude.sort((a, b) => a - b);
    
    // Build content string from sampled rows
    const rowStrings: string[] = [];
    for (const idx of samplesToInclude) {
        const row = rows[idx];
        if (row) {
            // Create a deterministic string representation of the row
            const rowValues = columnNames.map(col => {
                const val = row[col];
                if (val === null) return 'null';
                if (val === undefined) return 'undefined';
                if (typeof val === 'object') return JSON.stringify(val);
                return String(val);
            });
            rowStrings.push(`${idx}:${rowValues.join(',')}`);
        }
    }
    
    parts.push(`rows:${rowStrings.join(';')}`);
    
    return djb2Hash(parts.join('|'));
}

export function runCodeOnInputListsInVM(
            code: string, 
            inputTupleList: any[][], 
            mode: "faster" | "safer") : [any[], any][] {
    // inputList is a list of testInputs, each item can be an arg or a list of args (if the function takes more than one argument)
    "use strict";
    let ioPairs : [any[], any][] = inputTupleList.map(args => [args, undefined]);
    if (mode == "safer") {
        try {
            // slightly safer?
            if (code != "") {
                let jsCode = ts.transpile(code);
                //target = eval(jsCode)(s);
                
                //console.log(`let func = ${code}; func(arg)`)
                let context = { inputTupleList : inputTupleList, outputs: inputTupleList.map(args => undefined) };
                //console.log(`let func = ${jsCode}; let outputs = inputList.map(arg => func(arg));`);
                vm.runInNewContext(`let func = ${jsCode}; outputs = inputTupleList.map(args => func(...args));`, context);
                ioPairs = inputTupleList.map((args, i) => [args, context.outputs[i]]);
                return ioPairs;
            }
        } catch(err) {
            console.warn(err);
        }
    } else if (mode == "faster") {
        try {
            if (code != "") {
                let jsCode = ts.transpile(code);
                let func = eval(jsCode);
                ioPairs = inputTupleList.map(args => {
                    let target = undefined;
                    try {
                        // copy args to ensure correctness of mapping
                        target = func(...structuredClone(args))
                    } catch (err) {
                        console.warn(`execution err ${err}`)
                    }
                    return [args, target]
                });
                return ioPairs;
            }
        } catch (err) {            
            console.warn(err);
        }
    }

    return ioPairs;
}

export function extractFieldsFromEncodingMap(encodingMap: EncodingMap, allFields: FieldItem[]) {
    let aggregateFields: [string | undefined, string][] = []
    let groupByFields: string[] = []
    
    for (const [channel, encoding] of Object.entries(encodingMap)) {
        const field = encoding.fieldID ? _.find(allFields, (f) => f.id === encoding.fieldID) : undefined;
        if (encoding.aggregate) {
            aggregateFields.push([field?.name, encoding.aggregate]);
        } else {
            if (field) {
                groupByFields.push(field.name);
            }
        }
    }

    return { aggregateFields, groupByFields };
}



export function prepVisTable(table: any[], allFields: FieldItem[], encodingMap: EncodingMap) {
    let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(encodingMap, allFields);

    let processedTable = [...table];

    let result = processedTable;

    if (aggregateFields.length > 0) {
        // Step 2: Group by and aggregate
        let grouped = [];
        if (groupByFields.length > 0) {
            grouped = d3.flatGroup(processedTable, ...groupByFields.map(field => (d: any) => d[field]));
        } else {
            grouped = [["_default", processedTable]];
        }

        result = grouped.map(row => {
            // Last element is the array of grouped items, rest are group values

            const groupValues = row.slice(0, -1);
            const group = row[row.length - 1];
            
            return {
                // Add group by fields
                ...Object.fromEntries(groupByFields.map((field, i) => [field, groupValues[i]])),
                // Add aggregations
                ...(aggregateFields.some(([_, type]) => type === 'count') 
                    ? { _count: group.length } 
                    : {}),
                ...Object.fromEntries(
                    aggregateFields
                        .filter(([fieldName, aggType]) => aggType !== 'count' && fieldName)
                        .map(([fieldName, aggType]) => {
                            const values = group.map((r: any) => r[fieldName!]);
                            const suffix = `_${aggType}`;
                            const aggFunc = {
                                'sum': d3.sum,
                                'max': d3.max,
                                'min': d3.min,
                                'mean': d3.mean,
                                'median': d3.median,
                                'average': d3.mean,
                                'mode': d3.mode
                            }[aggType] as (values: any[]) => number | undefined;
                            return [fieldName + suffix, aggFunc ? aggFunc(values) : undefined];
                        })
                )
            };
        });
    }

    return result;
}

export const assembleVegaChart = (
    chartType: string, 
    encodingMap: { [key in Channel]: EncodingItem; }, 
    conceptShelfItems: FieldItem[], 
    workingTable: any[],
    tableMetadata: {[key: string]: {type: Type, semanticType: string, levels: any[], intrinsicDomain?: [number, number], unit?: string, displayName?: string, description?: string}},
    baseChartWidth: number = 100,
    baseChartHeight: number = 80,
    addTooltips: boolean = false,
    chartProperties?: Record<string, any>,
    scaleFactor: number = 1,
    maxStretchFactor?: number,
    assembleOptions?: AssembleOptions,
    semanticAnnotationOverrides?: Record<string, any>,
) => {

    // Convert app-level EncodingMap (fieldID-based) to library-level encodings (field-name-based)
    const encodings: Record<string, ChartEncoding> = {};
    for (const [channel, encoding] of Object.entries(encodingMap)) {
        const field = encoding.fieldID ? _.find(conceptShelfItems, (f) => f.id === encoding.fieldID) : undefined;
        encodings[channel] = {
            field: field?.name,
            type: encoding.dtype,
            aggregate: encoding.aggregate,
            sortOrder: encoding.sortOrder,
            sortBy: encoding.sortBy,
            scheme: encoding.scheme,
        };
    }

    // Extract semantic types from table metadata
    // Build SemanticAnnotation objects when enriched metadata (intrinsicDomain, unit) is available
    const semanticTypes: Record<string, string | any> = {};
    for (const [fieldName, meta] of Object.entries(tableMetadata)) {
        if (meta.semanticType) {
            if (meta.intrinsicDomain || meta.unit) {
                // Build enriched annotation object
                const annotation: any = { semanticType: meta.semanticType };
                if (meta.intrinsicDomain) annotation.intrinsicDomain = meta.intrinsicDomain;
                if (meta.unit) annotation.unit = meta.unit;
                if (meta.levels && meta.levels.length > 0) annotation.sortOrder = meta.levels;
                semanticTypes[fieldName] = annotation;
            } else {
                semanticTypes[fieldName] = meta.semanticType;
            }
        }
    }
    // Merge enriched annotations (e.g., intrinsicDomain, unit) when provided
    if (semanticAnnotationOverrides) {
        for (const [fieldName, annotation] of Object.entries(semanticAnnotationOverrides)) {
            semanticTypes[fieldName] = annotation;
        }
    }

    // Hack: pie-like radial charts grow too large because the circumference
    // pressure model + VL's auto-radius both amplify the canvas size.
    // Apply two dampening levers:
    //   1. Shrink the base canvas so VL's arc radius starts smaller
    //   2. Cap maxStretch more aggressively so pressure growth is limited
    const PIE_LIKE_TYPES = new Set([
        'Pie Chart', 'Rose Chart', 'Sunburst Chart',
        'Radar Chart', 'Gauge Chart',
    ]);
    const isPieLike = PIE_LIKE_TYPES.has(chartType);

    // Lever 1: reduce base canvas for pie-like charts (0.75× → smaller pie)
    const canvasShrink = isPieLike ? 0.75 : 1;
    const effectiveW = Math.round(baseChartWidth * scaleFactor * canvasShrink);
    const effectiveH = Math.round(baseChartHeight * scaleFactor * canvasShrink);

    // Lever 2: tighter stretch cap for pie-like charts
    let effectiveMaxStretch = maxStretchFactor;
    if (effectiveMaxStretch != null && isPieLike) {
        // Compress toward 1: e.g. 2.0 → 1.3, 3.0 → 1.6, 5.0 → 2.2
        effectiveMaxStretch = 1 + (effectiveMaxStretch - 1) * 0.3;
    }

    const fieldDisplayNames: Record<string, string> = {};
    for (const [name, meta] of Object.entries(tableMetadata)) {
        if (meta.displayName) fieldDisplayNames[name] = meta.displayName;
    }

    return assembleVegaLite({
        data: { values: workingTable },
        semantic_types: semanticTypes,
        chart_spec: {
            chartType,
            encodings,
            canvasSize: { width: effectiveW, height: effectiveH },
            chartProperties,
        },
        options: {
            addTooltips,
            ...(effectiveMaxStretch != null ? { maxStretch: effectiveMaxStretch } : {}),
            ...assembleOptions,
        },
        ...(Object.keys(fieldDisplayNames).length > 0 ? { field_display_names: fieldDisplayNames } : {}),
    });
}

// resolveRecommendedChart & resolveChartFields remain in app layer (need generateFreshChart, Chart)
export { resolveRecommendedChart, resolveChartFields } from './chartRecommendation';

export let getTriggers = (leafTable: DictTable, tables: DictTable[]): Trigger[] => {
    // recursively find triggers that ends in leafTable (if the leaf table is anchored, we will find till the previous table is anchored)
    let triggers : Trigger[] = [];
    let t = leafTable;
    
    while(true) {
        // this is when we find an original table
        if (t.derive == undefined) {
            break;
        }

        // this is when we find an anchored table (which is not the leaf table)
        if (t !== leafTable && t.anchored) {
            break;
        }

        let trigger = t.derive.trigger as Trigger;
        triggers = [trigger, ...triggers];
        let parentTable = tables.find(x => x.id == trigger.tableId);
        if (parentTable) {
            t = parentTable;
        } else {
            break;
        }
    }
    
    return triggers;
}

/**
 * Returns a hash code from a string
 * @param  {String} str The string to hash.
 * @return {Number}    A 32bit integer
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 */
export function hashCode(str: string) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}
