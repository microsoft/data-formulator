// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import _, {  } from "lodash";
import { useEffect, useRef } from "react";
import ts from "typescript";
import { ChannelGroups, getChartChannels, getChartTemplate } from "../components/ChartTemplates";
import { Channel, Chart, ChartTemplate, ConceptTransformation, EncodingItem, EncodingMap, FieldItem, Trigger } from "../components/ComponentType";
import { DictTable } from "../components/ComponentType";
import { getDType, Type } from "../data/types";
import * as d3 from 'd3';
import {
    getVizCategory,
    hasVizCategory,
    isTimeSeriesType,
    isMeasureType,
    isOrdinalType,
    getRecommendedColorSchemeWithMidpoint,
    TIMESERIES_X_TYPES,
} from "../components/semanticTypes";

export function getUrls() {
    return {
        APP_CONFIG: `/api/app-config`,
        AUTH_INFO_PREFIX: `/api/.auth/`,

        EXAMPLE_DATASETS: `/api/example-datasets`,

        // these functions involves ai agents
        CHECK_AVAILABLE_MODELS: `/api/agent/check-available-models`,
        TEST_MODEL: `/api/agent/test-model`,

        SORT_DATA_URL: `/api/agent/sort-data`,
        CLEAN_DATA_URL: `/api/agent/clean-data-stream`,
        
        CODE_EXPL_URL: `/api/agent/code-expl`,
        CHART_INSIGHT_URL: `/api/agent/chart-insight`,
        SERVER_PROCESS_DATA_ON_LOAD: `/api/agent/process-data-on-load`,

        DERIVE_DATA: `/api/agent/derive-data`,
        REFINE_DATA: `/api/agent/refine-data`,
        EXPLORE_DATA_STREAMING: `/api/agent/explore-data-streaming`,

        // these functions involves database
        UPLOAD_DB_FILE: `/api/tables/upload-db-file`,
        DOWNLOAD_DB_FILE: `/api/tables/download-db-file`,
        RESET_DB_FILE: `/api/tables/reset-db-file`,

        LIST_TABLES: `/api/tables/list-tables`,
        TABLE_DATA: `/api/tables/get-table`,
        CREATE_TABLE: `/api/tables/create-table`,
        DELETE_TABLE: `/api/tables/delete-table`,
        GET_COLUMN_STATS: `/api/tables/analyze`,
        SAMPLE_TABLE: `/api/tables/sample-table`,
        SYNC_TABLE_DATA: `/api/tables/sync-table-data`,
        EXPORT_TABLE_CSV: `/api/tables/export-table-csv`,

        DATA_LOADER_LIST_DATA_LOADERS: `/api/tables/data-loader/list-data-loaders`,
        DATA_LOADER_LIST_TABLES: `/api/tables/data-loader/list-tables`,
        DATA_LOADER_INGEST_DATA: `/api/tables/data-loader/ingest-data`,
        DATA_LOADER_VIEW_QUERY_SAMPLE: `/api/tables/data-loader/view-query-sample`,
        DATA_LOADER_INGEST_DATA_FROM_QUERY: `/api/tables/data-loader/ingest-data-from-query`,
        DATA_LOADER_REFRESH_TABLE: `/api/tables/data-loader/refresh-table`,
        DATA_LOADER_FETCH_DATA: `/api/tables/data-loader/fetch-data`,
        DATA_LOADER_GET_TABLE_METADATA: `/api/tables/data-loader/get-table-metadata`,
        DATA_LOADER_LIST_TABLE_METADATA: `/api/tables/data-loader/list-table-metadata`,

        GET_RECOMMENDATION_QUESTIONS: `/api/agent/get-recommendation-questions`,
        GENERATE_REPORT_STREAM: `/api/agent/generate-report-stream`,

        // Refresh data endpoint
        REFRESH_DERIVED_DATA: `/api/agent/refresh-derived-data`,

        // Session management
        SESSION_SAVE: `/api/sessions/save`,
        SESSION_LIST: `/api/sessions/list`,
        SESSION_LOAD: `/api/sessions/load`,
        SESSION_DELETE: `/api/sessions/delete`,
        SESSION_EXPORT: `/api/sessions/export`,
        SESSION_IMPORT: `/api/sessions/import`,

        // Workspace
        OPEN_WORKSPACE: `/api/tables/open-workspace`,
    };
}

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
    const { getBrowserId } = await import('./identity');
    return `browser:${getBrowserId()}`;
}

/**
 * Get auth token if available (for future JWT auth support).
 * Currently returns null - implement when adding custom auth.
 */
function getAuthToken(): string | null {
    // Future: retrieve JWT from localStorage or auth context
    // Example: return localStorage.getItem('auth_token');
    return null;
}

/**
 * Enhanced fetch wrapper that automatically adds identity and auth headers for API requests.
 * 
 * Security model:
 * - X-Identity-Id: Namespaced identity ("type:id" format) for all requests
 * - Authorization: Bearer token (when implementing custom JWT auth)
 * 
 * The backend prioritizes verified auth (Azure headers, JWT) over X-Identity-Id.
 * For anonymous users, X-Identity-Id is used with "browser:" namespace prefix.
 * 
 * Use this instead of native fetch() for all /api/ calls.
 * 
 * @param url - The URL to fetch
 * @param options - Fetch options (same as native fetch)
 * @returns Promise<Response>
 */
export async function fetchWithIdentity(
    url: string | URL,
    options: RequestInit = {}
): Promise<Response> {
    const urlString = typeof url === 'string' ? url : url.toString();
    
    // Add identity and auth headers for all API requests
    if (urlString.startsWith('/api/')) {
        const headers = new Headers(options.headers);
        
        // Always send namespaced identity (fallback for backend)
        const namespacedIdentity = await getCurrentNamespacedIdentity();
        headers.set('X-Identity-Id', namespacedIdentity);
        
        // Send auth token if available (for custom JWT auth)
        const authToken = getAuthToken();
        if (authToken) {
            headers.set('Authorization', `Bearer ${authToken}`);
        }
        
        options = { ...options, headers };
    }
    
    return fetch(url, options);
}

import * as vm from 'vm-browserify';
import { generateFreshChart } from "./dfSlice";

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

/**
 * Check if a numeric value is likely a Unix timestamp (seconds or milliseconds since epoch).
 * Returns false for values that look like years or other small numbers.
 */
function isLikelyTimestamp(val: number): boolean {
    // Unix timestamps in seconds: typically 10 digits (starts from ~1970)
    // Unix timestamps in milliseconds: typically 13 digits
    // Reasonable timestamp range: 1970 (0) to 2100 (~4102444800 seconds)
    
    // Milliseconds range: 1970 to 2100
    const minTimestampMs = 0;  // Jan 1, 1970
    const maxTimestampMs = 4102444800000;  // ~year 2100
    
    // Seconds range: 1970 to 2100
    const minTimestampSec = 0;
    const maxTimestampSec = 4102444800;  // ~year 2100
    
    // Check if it looks like milliseconds (13 digits, typically > 1e12)
    if (val >= 1e12 && val <= maxTimestampMs) {
        return true;
    }
    
    // Check if it looks like seconds (10 digits, typically > 1e9)
    // Must be > 1e9 to avoid confusion with years (1000-9999)
    if (val >= 1e9 && val <= maxTimestampSec) {
        return true;
    }
    
    return false;
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
    tableMetadata: {[key: string]: {type: Type, semanticType: string, levels: any[]}},
    maxFacetNominalValues: number = 30,
    aggrPreprocessed: boolean = false, // whether the data has been preprocessed for aggregation and binning
    baseChartWidth: number = 100,
    baseChartHeight: number = 80,
    addTooltips: boolean = false,
    chartConfig?: Record<string, any>, // additional chart config properties (e.g., projection, projectionCenter for maps)
    scaleFactor: number = 1,
) => {

    if (chartType == "Table") {
        return ["Table", undefined];
    }

    let chartTemplate = getChartTemplate(chartType) as ChartTemplate;
    //console.log(chartTemplate);

    let vgObj = structuredClone(chartTemplate.template);

    for (const [channel, encoding] of Object.entries(encodingMap)) {

        let encodingObj: any = {};

        if (channel == "radius") {
            encodingObj["scale"] = {"type": "sqrt", "zero": true};
        }

        const field = encoding.fieldID ? _.find(conceptShelfItems, (f) => f.id === encoding.fieldID) : undefined;
        if (field == undefined && encoding.aggregate == "count" && aggrPreprocessed) {
            encodingObj["field"] = "_count";
            encodingObj["title"] = "Count";
            encodingObj["type"] = "quantitative";
        }
        
        if (field) {
            // create the encoding
            encodingObj["field"] = field.name;
            let fieldMetadata = tableMetadata[field.name];

            if (fieldMetadata != undefined) {
                const semanticType = fieldMetadata.semanticType || '';
                const fieldValues = workingTable.map(r => r[field.name]);
                
                // Use semantic type system to determine Vega-Lite encoding type
                // Only use semantic mapping when the type is recognized; generic/unknown
                // types (e.g. 'Value') fall through to JS-type inference via getDType.
                if (semanticType && hasVizCategory(semanticType)) {
                    const vizCategory = getVizCategory(semanticType);
                    
                    // Detect bar-like charts where temporal fields on x/y should be ordinal (discrete bars)
                    const isBarChart = ['Bar Chart', 'Stacked Bar Chart', 'Grouped Bar Chart', 'Heatmap'].includes(chartType);

                    // Map semantic viz category to Vega-Lite type
                    switch (vizCategory) {
                        case 'temporal':
                            // For temporal types in size/facet channels, use ordinal
                            if (['size', 'column', 'row'].includes(channel)) {
                                encodingObj["type"] = "ordinal";
                            } else if (channel === 'color') {
                                // Year-like fields in color: use temporal (continuous gradient) when
                                // many unique values, ordinal (distinct colors) when few.
                                const uniqueColorValues = new Set(workingTable.map(r => r[field.name])).size;
                                encodingObj["type"] = uniqueColorValues > 12 ? "temporal" : "ordinal";
                            } else {
                                // Check if values are actually parseable as temporal
                                // Use Date.parse() to match Vega-Lite's own date detection (vega-loader)
                                const sampleValues = workingTable.map(r => r[field.name]).slice(0, 15).filter(v => v != null);
                                const isValidTemporal = sampleValues.length > 0 && sampleValues.some(val => {
                                    if (val instanceof Date) return true;
                                    if (typeof val === 'number') {
                                        // Accept year-like numbers (e.g., 1960, 2024)
                                        if (val >= 1000 && val <= 3000) return true;
                                        // Unix timestamps in milliseconds
                                        if (val > 86400000 && val < 4200000000000) return true;
                                        return false;
                                    }
                                    if (typeof val === 'string') {
                                        const trimmed = val.trim();
                                        if (!trimmed) return false;
                                        // Accept year-like strings (e.g., "1960", "2024")
                                        if (/^\d{4}$/.test(trimmed)) return true;
                                        // Use Date.parse — same as Vega-Lite's vega-loader isDate check
                                        return !Number.isNaN(Date.parse(trimmed));
                                    }
                                    return false;
                                });

                                if (!isValidTemporal) {
                                    // Not parseable as temporal — fall back to ordinal
                                    encodingObj["type"] = "ordinal";
                                } else if (isBarChart) {
                                    // Bar-like charts: use ordinal for discrete bars only when
                                    // cardinality is low enough to be readable; otherwise keep
                                    // temporal so VL shows a continuous axis with nice ticks.
                                    const uniqueCount = new Set(workingTable.map(r => r[field.name])).size;
                                    encodingObj["type"] = uniqueCount <= 32 ? "ordinal" : "temporal";
                                } else {
                                    encodingObj["type"] = "temporal";
                                }
                            }
                            break;
                        case 'ordinal':
                            // Ordinal types (Month, Rank, Score, etc.) stay ordinal on all channels.
                            // Vega-Lite ordinal gives sequential color scales, ordered sizes,
                            // and sorted facets — all appropriate for inherently ordered data.
                            encodingObj["type"] = "ordinal";
                            break;
                        case 'quantitative':
                            encodingObj["type"] = "quantitative";
                            break;
                        case 'geographic':
                            // Geographic coordinates stay quantitative for position encoding
                            encodingObj["type"] = "quantitative";
                            break;
                        case 'nominal':
                        default:
                            encodingObj["type"] = "nominal";
                            break;
                    }
                } else {
                    // No semantic type - fall back to data type inference
                    encodingObj["type"] = getDType(fieldMetadata.type, fieldValues);
                }
            } else {
                encodingObj["type"] = 'nominal';
            }

           

            if (encoding.dtype) {
                // if the dtype is specified, use it
                encodingObj["type"] = encoding.dtype;
            } else if (channel == 'column' || channel == 'row') {
                // Facet channels need a discrete type. If already nominal or ordinal, keep it;
                // otherwise (e.g. quantitative, temporal) default to nominal.
                if (encodingObj["type"] !== 'nominal' && encodingObj["type"] !== 'ordinal') {
                    encodingObj["type"] = 'nominal';
                }
            }

            if (field && encodingObj["type"] == "quantitative") {
                // Special hack: if the field values are all valid temporal values, set the type to temporal
                let sampleValues = workingTable.slice(0, 15).filter(r => r[field.name] != undefined).map(r => r[field.name]);
                // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sss with optional timezone (Z or +/-HH:mm)
                const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
                if (sampleValues.length > 0 && sampleValues.every((val: any) => isoDateRegex.test(`${val}`.trim()))) {
                    encodingObj["type"] = "temporal";
                }
            }
            
            
            if (aggrPreprocessed) {
                if (encoding.aggregate) {
                    if (encoding.aggregate == "count") {
                        encodingObj["field"] = "_count";
                        encodingObj["title"] = "Count"
                        encodingObj["type"] = "quantitative";
                    } else {
                        encodingObj['field'] = `${field.name || ""}_${encoding.aggregate}`;
                        encodingObj["type"] = "quantitative";
                    }
                }
            } else {
                if (encoding.aggregate) {
                    encodingObj["aggregate"] = encoding.aggregate;
                    if (encodingObj["aggregate"] == "count") {
                        encodingObj["title"] = "Count"
                    }
                }
            }
 
            if (encodingObj["type"] == "quantitative" && chartType.includes("Line") && channel == "x") {
                encodingObj["scale"] = { "nice": false }
            }

            if (encodingObj["type"] == "nominal" && channel == 'color') {

                let actualDomain = [...new Set(workingTable.map(r => r[field.name]))];

                if (actualDomain.length >= 16) {
                    if (encodingObj["legend"] == undefined) {
                        encodingObj["legend"] = {}
                    }
                    encodingObj["legend"]['symbolSize'] = 12;
                    encodingObj["legend"]["labelFontSize"] = 8;
                }
            }
        }

        if (encoding.sortBy || encoding.sortOrder) {
            if (encoding.sortBy == undefined) {
                if (encoding.sortOrder) {
                    encodingObj["sort"] = encoding.sortOrder;
                }
            } else if (encoding.sortBy == 'x' || encoding.sortBy == 'y') {
                if (encoding.sortBy == channel) {
                    encodingObj["sort"] = `${encoding.sortOrder == "descending" ? "-" : ""}${encoding.sortBy}`;
                } else {
                    encodingObj["sort"] = `${encoding.sortOrder == "ascending" ? "" : "-"}${encoding.sortBy}`;
                }

            } else if (encoding.sortBy == 'color') {
                if (encodingMap.color?.fieldID != undefined) {
                    encodingObj["sort"] = `${encoding.sortOrder == "ascending" ? "" : "-"}${encoding.sortBy}`;
                }
            } else {
                try {
                    if (field) {
                        let fieldMetadata = tableMetadata[field.name];
                        let sortedValues = JSON.parse(encoding.sortBy);

                        // this is to coordinate with the type conversion of temporal fields
                        if (fieldMetadata.type == "date" || fieldMetadata.semanticType == "Year" || fieldMetadata.semanticType == "Decade") {
                            sortedValues = sortedValues.map((v: any) => v.toString());
                        }

                        encodingObj['sort'] = (encoding.sortOrder == "ascending" || encoding.sortOrder == undefined) ? sortedValues : sortedValues.reverse();

                        // special hack: ensure stack bar and stacked area charts are ordered correctly
                        if (channel == 'color' && (vgObj['mark'] == 'bar' || vgObj['mark'] == 'area')) {
                            // this is a very interesting hack, it leverages the hidden derived field name used in compiled Vega script to 
                            // handle order of stack bar and stacked area charts
                            vgObj['encoding']['order'] = {
                                "field": `color_${field?.name}_sort_index`,
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`sort error > ${encoding.sortBy}`)
                }
            }

            // if (encoding.sort == "ascending" || encoding.sort == "descending"
            //     || encoding.sort == "x" || encoding.sort == "y" || encoding.sort == "-x" || encoding.sort == "-y") {
            //     encodingObj["sort"] = encoding.sort;
            // } else {
            //     encodingObj["sort"] = JSON.parse(encoding.sort);
            // }
        } else {
            // Auto-sort: when nominal axis has quantitative opposite axis or color field and no explicit sorting is set
            // prioritize color field if present, otherwise sort by quantitative axis descending
            if ((channel === 'x' && encodingObj.type === 'nominal' && encodingMap.y?.fieldID ) ||
                (channel === 'y' && encodingObj.type === 'nominal' && encodingMap.x?.fieldID)) {



                if (chartType.includes("Line") || chartType.includes("Area") || chartType === "Heatmap") {
                    // do nothing — lines/areas need temporal order, heatmaps need natural matrix order
                } else {
                    let colorField = encodingMap.color?.fieldID ? _.find(conceptShelfItems, (f) => f.id === encodingMap.color.fieldID) : undefined;
                    let colorFieldType = undefined;
                    if (colorField) {
                        const colorFieldMetadata = tableMetadata[colorField.name];
                        if (colorFieldMetadata) {
                            colorFieldType = getDType(colorFieldMetadata.type, workingTable.map(r => r[colorField.name]));
                        }
                    }

                    if (colorField && colorFieldType == 'quantitative') {
                        // If color field exists, sort by color (ascending for nominal, descending for quantitative)
                        encodingObj["sort"] = colorFieldType === 'quantitative' ? "-color" : "color";
                    }  else {
                        // Otherwise, sort by the quantitative axis descending
                        const oppositeChannel = channel === 'x' ? 'y' : 'x';
                        const oppositeField = _.find(conceptShelfItems, (f) => f.id === encodingMap[oppositeChannel]?.fieldID);
                        if (oppositeField) {
                            const oppositeFieldMetadata = tableMetadata[oppositeField.name];
                            if (oppositeFieldMetadata && getDType(oppositeFieldMetadata.type, workingTable.map(r => r[oppositeField.name])) === 'quantitative') {
                                encodingObj["sort"] = `-${oppositeChannel}`;
                            }
                        }
                    }
                }
            }
        }
        if (encoding.stack) {
            encodingObj["stack"] = encoding.stack == "layered" ? null : encoding.stack;
        }

        if (channel == "color") {
            if (encoding.scheme && encoding.scheme != "default") {
                // User explicitly specified a color scheme
                if ('scale' in encodingObj) {
                    encodingObj["scale"]["scheme"] = encoding.scheme;
                } else {
                    encodingObj["scale"] = { "scheme": encoding.scheme };
                }
            } else if (field) {
                // Auto-select color scheme based on semantic type
                const fieldMetadata = tableMetadata[field.name];
                const semanticType = fieldMetadata?.semanticType;
                const fieldValues = workingTable.map(r => r[field.name]);
                const encodingVLType = encodingObj.type as 'nominal' | 'ordinal' | 'quantitative' | 'temporal';
                
                // Get recommended color scheme based on semantic type (includes midpoint for diverging)
                const recommendation = getRecommendedColorSchemeWithMidpoint(
                    semanticType,
                    encodingVLType,
                    fieldValues,
                    field.name
                );
                
                if (!('scale' in encodingObj)) {
                    encodingObj["scale"] = {};
                }
                encodingObj["scale"]["scheme"] = recommendation.scheme;
                
                // For diverging schemes, set the domain midpoint
                if (recommendation.type === 'diverging' && recommendation.domainMid !== undefined) {
                    encodingObj["scale"]["domainMid"] = recommendation.domainMid;
                }
            }
        }

        if (Object.keys(encodingObj).length != 0 && chartTemplate.paths[channel]) {
            let pathObj = chartTemplate.paths[channel];
            let paths : (string | number)[][] = []
            if (pathObj.length > 0 && pathObj[0].constructor === Array) {
                // in this case, there are many destinations, we add the encodingObj to all paths
                paths = pathObj as (string | number)[][];
            } else {
                // in this case, there is only one single destination, we will wrap it with [..]
                paths = [pathObj as (string | number)[]]
            }
            // fill the template with encoding objects
            for (let path of paths) {
                let ref = vgObj;
                for (let key of path.slice(0, path.length - 1)) {
                    ref = ref[key]
                }

                // if the template hold is a string, then we only instantiate a string value
                // if the template hold is a dict, then we embed the actual embeding object
                if (typeof ref[path[path.length - 1]] === 'string' || ref[path[path.length - 1]] instanceof String) {
                    ref[path[path.length - 1]] = encodingObj['field'];
                } else {
                    let prebuiltEntries = ref[path[path.length - 1]] != undefined ? Object.entries(ref[path[path.length - 1]]) : []
                    ref[path[path.length - 1]] = Object.fromEntries([...prebuiltEntries, ...Object.entries(encodingObj)]);
                }
            }
        }
    }

    // use post processor to handle smart chart instantiation and apply config
    if (chartTemplate.postProcessor) {
        vgObj = chartTemplate.postProcessor(vgObj, workingTable, chartConfig);
    }

    // this is the data that will be assembled into the vega chart
    let values = structuredClone(workingTable);
    if (values.length > 0) {
        let keys = Object.keys(values[0]);
        let temporalKeys = keys.filter((k: string) => 
            tableMetadata[k] && (tableMetadata[k].type == "date" || tableMetadata[k].semanticType == "Year" || tableMetadata[k].semanticType == "Decade"));
        if (temporalKeys.length > 0) {
            values = values.map((r: any) => { 
                for (let temporalKey of temporalKeys) {
                    const val = r[temporalKey];
                    const fieldMeta = tableMetadata[temporalKey];
                    const semanticType = fieldMeta?.semanticType;
                    
                    // Convert to ISO date strings for Vega-Lite compatibility
                    if (typeof val === 'number') {
                        // Handle Year/Decade semantic types - these are year numbers, not timestamps
                        if (semanticType === 'Year' || semanticType === 'Decade') {
                            // Year values like 2018 should become "2018-01-01"
                            r[temporalKey] = `${Math.floor(val)}`;
                        } else if (isLikelyTimestamp(val)) {
                            // Detect if timestamp is in seconds (10 digits) or milliseconds (13 digits)
                            const timestamp = val < 1e12 ? val * 1000 : val;
                            r[temporalKey] = new Date(timestamp).toISOString();
                        } else {
                            // Small numbers that aren't Year/Decade and don't look like timestamps
                            // If it looks like a year (1000-9999), format as a date for consistency
                            r[temporalKey] = String(val);
                        }
                    } else if (val instanceof Date) {
                        r[temporalKey] = val.toISOString();
                    } else {
                        r[temporalKey] = String(val);
                    }
                }
                return r;
            })
        }
    }

    let nominalCount = {
        x: 0,
        y: 0,
        column: 0,
        row: 0,
        xOffset: 0,
        yOffset: 0,
    }

    // Apply scale factor to base dimensions
    let defaultChartWidth = Math.round(baseChartWidth * scaleFactor);
    let defaultChartHeight = Math.round(baseChartHeight * scaleFactor);

    // Dynamic bar/label sizing: allow stretching to 2x chart width, pack bars as densely as needed.
    // Scale step size proportionally when chart is resized (base reference: 300px)
    let baseRefSize = 300;
    let sizeRatio = Math.max(defaultChartWidth, defaultChartHeight) / baseRefSize;
    let defaultStepSize = Math.round(20 * Math.max(1, sizeRatio));

    // Nominal labels take per-item space; temporal labels auto-tick (no per-bar overhead).
    // Use a smaller effective min step for cap computation to allow more values before filtering.
    // minNominalStep = 2px bar + 4px label padding = 6px minimum per discrete value.
    // Allow discrete axes to stretch up to 2× the default dimension, so compute cap from 2× budget.
    const MIN_NOMINAL_STEP = 6;

    // For grouped bars, each x (or y) value takes xOffset (or yOffset) sub-bars.
    // So step is per sub-bar, and total width ≈ step × xCount × xOffsetCount.
    // Account for this when computing the max values to keep on x/y.
    const isDiscreteType = (t: string | undefined) => t === 'nominal' || t === 'ordinal';
    const xOffsetEnc = vgObj.encoding?.xOffset;
    const yOffsetEnc = vgObj.encoding?.yOffset;
    const xOffsetMultiplier = (xOffsetEnc?.field && isDiscreteType(xOffsetEnc.type))
        ? new Set(values.map((r: any) => r[xOffsetEnc.field])).size : 1;
    const yOffsetMultiplier = (yOffsetEnc?.field && isDiscreteType(yOffsetEnc.type))
        ? new Set(values.map((r: any) => r[yOffsetEnc.field])).size : 1;

    let maxXToKeep = Math.floor(defaultChartWidth * 2 / (MIN_NOMINAL_STEP * xOffsetMultiplier));
    let maxYToKeep = Math.floor(defaultChartHeight * 2 / (MIN_NOMINAL_STEP * yOffsetMultiplier));

    // Decide what are top values to keep for each channel.
    // Count all discrete types (nominal, ordinal) — these use step-based layout.
    for (const channel of ['x', 'y', 'column', 'row', 'xOffset', 'yOffset', "color"]) {
        const encoding = vgObj.encoding?.[channel];
        if (encoding?.field && isDiscreteType(encoding.type)) {

            let maxNominalValuesToKeep = channel == 'x' ? maxXToKeep : channel == 'y' ? maxYToKeep : maxFacetNominalValues;

            const fieldName = encoding.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];

            // count the nominal values in this channel
            nominalCount[channel as keyof typeof nominalCount] = uniqueValues.length > maxNominalValuesToKeep ? maxNominalValuesToKeep : uniqueValues.length;

            let fieldMetadata = tableMetadata[fieldName];
            
            const fieldOriginalType = fieldMetadata ? getDType(fieldMetadata.type, workingTable.map(r => r[fieldName])) : 'nominal';
            
            let valuesToKeep: any[];
            if (uniqueValues.length > maxNominalValuesToKeep) {

                if (fieldOriginalType == 'quantitative' || channel == 'color') {
                    valuesToKeep = uniqueValues.sort((a, b) => a - b).slice(0, channel == 'color' ? 24 : maxNominalValuesToKeep);
                } else if (channel == 'facet' || channel == 'column' || channel == 'row') {
                    valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                } else if (channel == 'x' || channel == 'y') {

                    const oppositeChannel = channel === 'x' ? 'y' : 'x';
                    const oppositeEncoding = vgObj.encoding?.[oppositeChannel];
                    const colorEncoding = vgObj.encoding?.color;

                    let isDescending = true;
                    let sortChannel: string | undefined;
                    let sortField: string | undefined;
                    let sortFieldType: string | undefined;

                    // Check if this axis already has a sort configuration
                    if (encoding.sort) {
                        if (typeof encoding.sort === 'string' && (encoding.sort === 'descending' || encoding.sort === 'ascending')) {
                            isDescending = encoding.sort === 'descending';
                            sortChannel = oppositeChannel;
                            sortField = oppositeEncoding?.field;
                            sortFieldType = oppositeEncoding?.type;
                        } else if (typeof encoding.sort === 'string' && 
                            (encoding.sort === '-y' || encoding.sort === '-x' || encoding.sort === '-color' || 
                             encoding.sort === 'y' || encoding.sort === 'x' || encoding.sort === 'color')) {
                                
                            isDescending = encoding.sort.startsWith('-');
                            sortChannel = isDescending ? encoding.sort.substring(1) : encoding.sort;
                            if (sortChannel) {
                                sortField = vgObj.encoding?.[sortChannel]?.field;
                                sortFieldType = vgObj.encoding?.[sortChannel]?.type;
                            }
                        } 
                    } else {
                        // No explicit sort configuration, use the existing inference logic
                        // Check if color field exists and is quantitative
                        // (Skip heatmaps — they display a matrix where natural order matters)
                        if (chartType !== 'Heatmap' && colorEncoding?.field && colorEncoding.type === 'quantitative') {
                            // Sort by color field descending and take top maxNominalValues
                            sortChannel = 'color';
                            sortField = colorEncoding.field;
                            sortFieldType = colorEncoding.type;
                        } else if (oppositeEncoding?.type === 'quantitative') {
                            // Sort by the quantitative field and take top maxNominalValues
                            sortChannel = oppositeChannel;
                            sortField = oppositeEncoding.field;
                            sortFieldType = oppositeEncoding.type;
                        } else {
                            isDescending = false;
                        }
                    }

                    if (!["Line Chart", "Custom Area Chart"].includes(chartType) &&
                        sortField != undefined && sortChannel != undefined && sortFieldType === 'quantitative') {

                        let aggregateOp = Math.max;
                        let initialValue = -Infinity;

                        if (chartType == "Bar" && sortChannel != 'color') {
                            // bar chart by default will be stacked, so we need to sum the values
                            aggregateOp = (x: number, y: number) => x + y;
                            initialValue = 0;
                        }

                        // Efficient single-pass aggregation + partial sort
                        const valueAggregates = new Map<string, number>();

                        // Single pass through workingTable to compute aggregates
                        for (const row of workingTable) {
                            const fieldValue = row[fieldName];
                            const sortValue = row[sortField as keyof typeof row] || 0;
                            
                            if (valueAggregates.has(fieldValue)) {
                                valueAggregates.set(fieldValue, aggregateOp(valueAggregates.get(fieldValue)!, sortValue));
                            } else {
                                valueAggregates.set(fieldValue, aggregateOp(initialValue, sortValue));
                            }
                        }

                        // Convert to array and get top-K efficiently
                        const valueSortPairs = Array.from(valueAggregates.entries()).map(([value, sortValue]) => ({
                            value,
                            sortValue
                        }));

                        // Use efficient top-K selection
                        if (valueSortPairs.length <= maxNominalValuesToKeep) {
                            valuesToKeep = valueSortPairs
                                .sort((a, b) => isDescending ? b.sortValue - a.sortValue : a.sortValue - b.sortValue)
                                .map(v => v.value);
                        } else {
                            // For large datasets, use partial sort (more efficient than full sort)
                            const compareFn = (a: {value: string, sortValue: number}, b: {value: string, sortValue: number}) => 
                                isDescending ? b.sortValue - a.sortValue : a.sortValue - b.sortValue;
                            
                            // Sort only the top K elements
                            valuesToKeep = valueSortPairs
                                .sort(compareFn)
                                .slice(0, maxNominalValuesToKeep)
                                .map(v => v.value);
                        }
                    } else {
                        // If sort field is not available or not quantitative, fall back to default
                        if (typeof encoding.sort === 'string' && 
                            encoding.sort === 'descending' || encoding.sort === `-${channel}`) {
                            valuesToKeep = uniqueValues.reverse().slice(0, maxNominalValuesToKeep);
                        } else {
                            valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                        }
                    }
                } else {
                    valuesToKeep = uniqueValues.slice(0, maxNominalValuesToKeep);
                }

                // Filter the working table
                const omittedCount = uniqueValues.length - valuesToKeep.length;
                const placeholder = `...${omittedCount} items omitted`;
                if (channel != 'color') {
                    values = values.filter((row: any) => valuesToKeep.includes(row[fieldName]));
                }

                // Add text formatting configuration
                if (!encoding.axis) {
                    encoding.axis = {};
                }
                encoding.axis.labelColor = {
                    condition: {
                        test: `datum.label == '${placeholder}'`,
                        value: "#999999"
                    },
                    value: "#000000" // default color for other labels
                };

                // Add placeholder to domain
                if (channel == 'x' || channel == 'y') {
                    if (!encoding.scale) {
                        encoding.scale = {};
                    }
                    encoding.scale.domain = [...valuesToKeep, placeholder]
                } else if (channel == 'color') {
                    if (!encoding.legend) {
                        encoding.legend = {};
                    }
                    encoding.legend.values = [...valuesToKeep, placeholder]
                }
            }
        }
    }

    if (vgObj.encoding?.column != undefined && vgObj.encoding?.row == undefined) {

        vgObj['encoding']['facet'] = vgObj['encoding']['column'];

        // --- Compute facet column count methodologically ---
        // 1. Estimate minimum subplot width from its x-axis content.
        // 2. Fit as many columns as possible into the total width budget (up to 2× default).
        // 3. Cap at the number of facet values (no empty columns).

        let xDiscreteCount = nominalCount.x;
        if (nominalCount.xOffset > 0) {
            xDiscreteCount = nominalCount.x * nominalCount.xOffset;
        }

        // Minimum subplot width: discrete axes need step × count, continuous axes need MIN_CONTINUOUS_SIZE.
        const MIN_SUBPLOT_WIDTH = 60;   // absolute minimum for any subplot
        const minSubplotWidth = xDiscreteCount > 0
            ? Math.max(MIN_SUBPLOT_WIDTH, xDiscreteCount * MIN_NOMINAL_STEP)
            : MIN_SUBPLOT_WIDTH;

        // Total width budget: allow stretching up to 2× default chart width.
        const maxTotalWidth = 2 * defaultChartWidth;

        // How many columns fit within the budget?
        const maxColsByWidth = Math.max(1, Math.floor(maxTotalWidth / minSubplotWidth));

        // Also cap at the actual facet count (no empty columns).
        const facetCount = nominalCount.column || 1;
        const numCols = Math.min(maxColsByWidth, facetCount);

        vgObj['encoding']['facet']['columns'] = numCols;

        // Independent x-axes only when there are multiple columns AND enough rows
        // to benefit from per-subplot labels (avoids double-label clutter in single-column layout).
        const numRows = Math.ceil(facetCount / numCols);
        if (numCols > 1 && numRows >= 3) {
            vgObj['resolve'] = {
                "axis": {
                    "x": "independent",
                }
            }
        }
        
        delete vgObj['encoding']['column'];
    }

    // --- Compute facet grid dimensions ---
    // Determine how many subplots are laid out in each direction.
    let facetCols = 1;
    let facetRows = 1;

    if (vgObj.encoding?.facet) {
        // Column-only case: was converted from column to facet with columns=N
        const layoutCols = vgObj.encoding.facet.columns || 1;
        const totalFacetValues = nominalCount.column || 1;
        facetCols = Math.min(layoutCols, totalFacetValues);
        facetRows = Math.ceil(totalFacetValues / layoutCols);
    }
    if (vgObj.encoding?.column) {
        // column+row case (column was NOT converted to facet)
        facetCols = nominalCount.column || 1;
    }
    if (vgObj.encoding?.row) {
        facetRows = nominalCount.row || 1;
    }

    let totalFacets = facetCols * facetRows;

    // --- Dynamic per-subplot sizing with elastic stretch ---
    // Use the same power-law elasticity as discrete axes:
    // pressure = facetCount (how many subplots share the dimension)
    // stretch = min(2, pressure^γ), so total width = defaultWidth × stretch
    // subplotSize = defaultWidth × stretch / facetCount
    const FACET_ELASTICITY = 0.5;
    const MIN_CONTINUOUS_SIZE = 10;

    let subplotWidth: number;
    if (facetCols > 1) {
        const stretch = Math.min(2, Math.pow(facetCols, FACET_ELASTICITY));
        subplotWidth = Math.round(Math.max(MIN_CONTINUOUS_SIZE, defaultChartWidth * stretch / facetCols));
    } else {
        subplotWidth = defaultChartWidth;
    }

    let subplotHeight: number;
    if (facetRows > 1) {
        const stretch = Math.min(2, Math.pow(facetRows, FACET_ELASTICITY));
        subplotHeight = Math.round(Math.max(MIN_CONTINUOUS_SIZE, defaultChartHeight * stretch / facetRows));
    } else {
        subplotHeight = defaultChartHeight;
    }

    for (const channel of ['facet', 'column', 'row']) {
        const encoding = vgObj.encoding?.[channel];
        if (encoding?.type === 'quantitative') {
            const fieldName = encoding.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];
            if (uniqueValues.length > maxFacetNominalValues) {
                encoding.bin = true;
            }
        }
    }
    
    // Total discrete items along each axis.
    // In Vega-Lite, config.view.step is the width of each individual sub-bar.
    // For grouped bars with xOffset, total chart width ≈ step × x × xOffset.
    // So the total discrete item count = outer axis count × offset count.
    let xTotalNominalCount = nominalCount.x;
    if (nominalCount.xOffset > 0) {
        xTotalNominalCount = nominalCount.x * nominalCount.xOffset;
    }
    let yTotalNominalCount = nominalCount.y;
    if (nominalCount.yOffset > 0) {
        yTotalNominalCount = nominalCount.y * nominalCount.yOffset;
    }

    // Check if y-axis should have independent scaling when columns have vastly different value ranges
    if (vgObj.encoding?.facet != undefined && vgObj.encoding?.y?.type === 'quantitative') {
        const yField = vgObj.encoding.y.field;
        const columnField = vgObj.encoding.facet.field;
        
        if (yField && columnField) {
            // Group data by column values and find max y value for each column
            const columnGroups = new Map<any, number>();
            
            for (const row of workingTable) {
                const columnValue = row[columnField];
                const yValue = row[yField];
                
                if (yValue != null && !isNaN(yValue)) {
                    const currentMax = columnGroups.get(columnValue) || 0;
                    columnGroups.set(columnValue, Math.max(currentMax, Math.abs(yValue)));
                }
            }
            
            // Find the ratio between max and min column max values
            const maxValues = Array.from(columnGroups.values()).filter(v => v > 0);
            if (maxValues.length >= 2) {
                const maxValue = Math.max(...maxValues);
                const minValue = Math.min(...maxValues);
                const ratio = maxValue / minValue;
                
                // If difference is 100x or more, use independent y-axis scaling
                if (ratio >= 100 && totalFacets < 6) {
                    if (!vgObj.resolve) {
                        vgObj.resolve = {};
                    }
                    if (!vgObj.resolve.scale) {
                        vgObj.resolve.scale = {};
                    }
                    vgObj.resolve.scale.y = "independent";
                }
            }
        }
    }

    // --- Elastic stretch for discrete axes ---
    // "Pressure" = how much space bars want relative to what's available at default step.
    // When pressure > 1, we distribute the excess between chart stretching and bar shrinkage
    // using a power-law elasticity coefficient γ (0.5 = square root = balanced tradeoff).
    //
    //   stretch = min(2, pressure^γ)
    //   resulting step = defaultStep × stretch / pressure = defaultStep / pressure^(1-γ)
    //
    // γ=0: no stretch, only shrink bars. γ=1: stretch fully, no bar shrinkage. γ=0.5: balanced.
    const ELASTICITY = 0.5;

    function computeElasticBudget(totalCount: number, defaultBudget: number): number {
        if (totalCount <= 0) return defaultBudget;
        const pressure = (totalCount * defaultStepSize) / defaultBudget;
        if (pressure <= 1) return defaultBudget;  // fits at default step
        const stretch = Math.min(2, Math.pow(pressure, ELASTICITY));
        return defaultBudget * stretch;
    }

    const xBudget = computeElasticBudget(xTotalNominalCount, subplotWidth);
    const yBudget = computeElasticBudget(yTotalNominalCount, subplotHeight);

    // Step size: budget / totalNominalCount (per sub-bar).
    // Pick the tighter constraint if both axes are discrete.
    let stepSize: number;
    if (xTotalNominalCount > 0 && yTotalNominalCount > 0) {
        stepSize = Math.min(
            Math.floor(xBudget / xTotalNominalCount),
            Math.floor(yBudget / yTotalNominalCount),
        );
    } else if (xTotalNominalCount > 0) {
        stepSize = Math.floor(xBudget / xTotalNominalCount);
    } else if (yTotalNominalCount > 0) {
        stepSize = Math.floor(yBudget / yTotalNominalCount);
    } else {
        stepSize = defaultStepSize;
    }
    stepSize = Math.max(MIN_NOMINAL_STEP, Math.min(defaultStepSize, stepSize));

    // Dynamic label sizing: only shrink labels on discrete axes that need smaller step sizes.
    // Continuous (temporal/quantitative) axes auto-tick, so they keep default font sizes.
    const defaultLabelFontSize = 10;
    const defaultLabelLimit = 100;

    let xLabelFontSize = xTotalNominalCount > 0 ? Math.max(6, Math.min(10, stepSize - 1)) : defaultLabelFontSize;
    let yLabelFontSize = yTotalNominalCount > 0 ? Math.max(6, Math.min(10, stepSize - 1)) : defaultLabelFontSize;
    let xLabelLimit = xTotalNominalCount > 0 ? Math.max(30, Math.min(100, stepSize * 8)) : defaultLabelLimit;
    let xLabelAngle: number | undefined = undefined;
    if (xTotalNominalCount > 0) {
        // Rotate x-axis labels when bars are dense (non-temporal)
        if (stepSize < 10) {
            xLabelAngle = -90;
            xLabelFontSize = Math.max(6, Math.min(8, stepSize));
            xLabelLimit = 40;
        } else if (stepSize < 16) {
            xLabelAngle = -45;
            xLabelFontSize = Math.max(7, Math.min(9, stepSize));
            xLabelLimit = 60;
        }
    }

    let axisXConfig: Record<string, any> = { "labelLimit": xLabelLimit, "labelFontSize": xLabelFontSize };
    if (xLabelAngle !== undefined) {
        axisXConfig["labelAngle"] = xLabelAngle;
        axisXConfig["labelAlign"] = xLabelAngle === -90 ? "right" : "right";
        axisXConfig["labelBaseline"] = xLabelAngle === -90 ? "middle" : "top";
    }
    let axisYConfig: Record<string, any> = { "labelFontSize": yLabelFontSize };

    vgObj['config'] = {
        "view": {
            "continuousWidth": subplotWidth,
            "continuousHeight": subplotHeight,
            "step": stepSize,

        },
        "axisX": axisXConfig,
        "axisY": axisYConfig,
    }

    // For specs with hardcoded width/height (e.g. map charts), apply scaleFactor and sync continuousWidth/Height
    if (typeof vgObj['width'] === 'number') {
        vgObj['width'] = Math.round(vgObj['width'] * scaleFactor);
        vgObj['config']['view']['continuousWidth'] = vgObj['width'];
    }
    if (typeof vgObj['height'] === 'number') {
        vgObj['height'] = Math.round(vgObj['height'] * scaleFactor);
        vgObj['config']['view']['continuousHeight'] = vgObj['height'];
    }

    if (totalFacets > 6) {
        vgObj['config']['header'] = { labelLimit: 120, labelFontSize: 9 };
    }

    // --- Reduce clutter in faceted charts ---
    // Row facets: each subplot repeats the y-axis title (e.g. "Value") next to the
    // facet header label — suppress the per-subplot y title to avoid the double label.
    // Column facets / wrapped facets: same for x-axis title.
    if (facetRows > 1) {
        // Suppress repeated y-axis title on every subplot; one header column is enough.
        if (!vgObj.encoding?.y?.axis) {
            if (vgObj.encoding?.y) vgObj.encoding.y.axis = {};
        }
        if (vgObj.encoding?.y?.axis !== undefined) {
            vgObj.encoding.y.axis.title = null;
        }
    }
    if (facetCols > 1) {
        // Suppress repeated x-axis title on every subplot.
        if (!vgObj.encoding?.x?.axis) {
            if (vgObj.encoding?.x) vgObj.encoding.x.axis = {};
        }
        if (vgObj.encoding?.x?.axis !== undefined) {
            vgObj.encoding.x.axis.title = null;
        }
    }

    if (addTooltips) {
        // Add tooltip via config - works for all spec types including compound specs
        if (!vgObj.config) {
            vgObj.config = {};
        }
        vgObj.config.mark = { ...vgObj.config.mark, tooltip: true };
    }

    // For rect marks (heatmaps) with quantitative/temporal axes, compute mark width/height
    // so rects tile edge-to-edge based on the actual chart dimensions and data cardinality.
    const markType = typeof vgObj.mark === 'string' ? vgObj.mark : vgObj.mark?.type;
    if (markType === 'rect') {
        const contWidth = vgObj['config']?.['view']?.['continuousWidth'] || defaultChartWidth;
        const contHeight = vgObj['config']?.['view']?.['continuousHeight'] || defaultChartHeight;

        for (const axis of ['x', 'y'] as const) {
            const enc = vgObj.encoding?.[axis];
            if (!enc?.field) continue;
            const t = enc.type;
            // Only adjust continuous axes — discrete axes use step-based layout
            if (t === 'nominal' || t === 'ordinal') continue;
            if (enc.aggregate) continue;

            const uniqueVals = [...new Set(values.map((r: any) => r[enc.field]))];
            const cardinality = uniqueVals.length;
            if (cardinality <= 1) continue;

            const dim = axis === 'x' ? contWidth : contHeight;
            // Compute pixel size per cell so rects tile the full chart dimension.
            // For quantitative: size = chartDim / cardinality (evenly spaced values)
            // For temporal: size based on uniform spacing assumption
            const cellSize = Math.max(1, Math.round(dim / cardinality));

            const sizeKey = axis === 'x' ? 'width' : 'height';
            if (typeof vgObj.mark === 'string') {
                vgObj.mark = { type: vgObj.mark, [sizeKey]: cellSize };
            } else {
                vgObj.mark = { ...vgObj.mark, [sizeKey]: cellSize };
            }
        }
    }

    // For boxplot marks, set the box size proportional to step so boxes fill available space.
    // Boxplot mark.size controls the box width in pixels.
    if (markType === 'boxplot' && (xTotalNominalCount > 0 || yTotalNominalCount > 0)) {
        // The discrete axis determines the box spacing via step.
        // Use ~70% of the step for the box width to leave some gap between boxes.
        const boxSize = Math.max(4, Math.round(stepSize * 0.7));
        if (typeof vgObj.mark === 'string') {
            vgObj.mark = { type: vgObj.mark, size: boxSize };
        } else {
            vgObj.mark = { ...vgObj.mark, size: boxSize };
        }
    }

    return {...vgObj, data: {values: values}}
}

export const adaptChart = (chart: Chart, targetTemplate: ChartTemplate) => {

    let discardedChannels = Object.entries(chart.encodingMap).filter(([ch, enc]) => {
        return !targetTemplate.channels.includes(ch) && enc.fieldID != undefined
    });

    let newEncodingMap = Object.assign({}, ...targetTemplate.channels.map((channel) => {
        let encoding = Object.keys(chart.encodingMap).includes(channel) ? chart.encodingMap[channel as Channel] : { channel: channel, bin: false }
        return { [channel]: encoding }
    })) as EncodingMap

    // for channels that will be discarded, find another way to adapt it
    for (let [ch, enc] of discardedChannels) {
        let otherChannelsFromSameGroup = (Object.entries(ChannelGroups).find(([grp, channelList]) => channelList.includes(ch)) as [string, string[]])[1]
        let candChannels = targetTemplate.channels.filter(c => otherChannelsFromSameGroup.includes(c) && newEncodingMap[c as Channel].fieldID == undefined);
        if (candChannels.length > 0) {
            newEncodingMap[candChannels[0] as Channel] = enc
        }
    }

    return { ...chart, chartType: targetTemplate.chart, encodingMap: newEncodingMap }
}

export const resolveRecommendedChart = (refinedGoal: any, allFields: FieldItem[], table: DictTable) => {
    
    let chartObj = refinedGoal['chart'] || {};
    let rawChartType = chartObj['chart_type'];
    let chartEncodings = chartObj['encodings'];

    if (chartEncodings == undefined || rawChartType == undefined) {
        let newChart = generateFreshChart(table.id, 'Scatter Plot') as Chart;
        let basicEncodings : { [key: string]: string } = table.names.length > 1 ? {x: table.names[0], y: table.names[1]} : {};
        newChart = resolveChartFields(newChart, allFields, basicEncodings, table);
        return newChart;
    }

    let chartTypeMap : any = {
        "line" : "Line Chart",
        "histogram": "Histogram",
        "bar": "Bar Chart",
        "point": "Scatter Plot",
        "boxplot": "Boxplot",
        "area": "Custom Area",
        "heatmap": "Heatmap",
        "group_bar": "Grouped Bar Chart",
        "pie": "Pie Chart",
        "worldmap": "World Map",
        "usmap": "US Map"
    }
    let chartType = chartTypeMap[rawChartType] || 'Scatter Plot';
    let newChart = generateFreshChart(table.id, chartType) as Chart;
    newChart = resolveChartFields(newChart, allFields, chartEncodings, table);

    // Apply chart config properties from agent recommendation
    if (chartObj['config'] && typeof chartObj['config'] === 'object') {
        newChart.config = { ...chartObj['config'] };
    }
    return newChart;
}

export const resolveChartFields = (chart: Chart, allFields: FieldItem[], chartEncodings: { [key: string]: string }, table: DictTable) => {
    // Get the keys that should be present after this update
    const newEncodingKeys = new Set(Object.keys(chartEncodings).map(key => key === "facet" ? "column" : key));
    
    // Remove encodings that are no longer in chartEncodings
    for (const key of Object.keys(chart.encodingMap)) {
        if (!newEncodingKeys.has(key) && chart.encodingMap[key as Channel]?.fieldID != undefined) {
            chart.encodingMap[key as Channel] = {};
        }
    }
    
    // Add/update encodings from chartEncodings
    for (let [key, value] of Object.entries(chartEncodings)) {
        if (key == "facet") {
            key = "column";
        }

        let field = allFields.find(c => c.name === value);
        if (field) {
            chart.encodingMap[key as Channel] = { fieldID: field.id };
        }
    }
    
    return chart;
}

export let getTriggers = (leafTable: DictTable, tables: DictTable[]) => {
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
