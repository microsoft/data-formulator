// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import _, {  } from "lodash";
import { useEffect, useRef } from "react";
import ts from "typescript";
import { channelGroups, getChartChannels, getChartTemplate } from "../components/ChartTemplates";
import { Channel, Chart, ChartTemplate, EncodingItem, EncodingMap, FieldItem, Trigger } from "../components/ComponentType";
import { DictTable } from "../components/ComponentType";
import { Type } from "../data/types";
import * as d3 from 'd3';

import { assembleVegaLite, type ChartEncoding, type AssembleOptions } from "../lib/agents-chart";

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
    baseChartWidth: number = 100,
    baseChartHeight: number = 80,
    addTooltips: boolean = false,
    chartProperties?: Record<string, any>,
    scaleFactor: number = 1,
    assembleOptions?: AssembleOptions,
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
    const semanticTypes: Record<string, string> = {};
    for (const [fieldName, meta] of Object.entries(tableMetadata)) {
        if (meta.semanticType) {
            semanticTypes[fieldName] = meta.semanticType;
        }
    }

    return assembleVegaLite({
        data: { values: workingTable },
        semantic_types: semanticTypes,
        chart_spec: {
            chartType,
            encodings,
            canvasSize: { width: Math.round(baseChartWidth * scaleFactor), height: Math.round(baseChartHeight * scaleFactor) },
            chartProperties,
        },
        options: {
            addTooltips,
            ...assembleOptions,
        },
    });
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
        let otherChannelsFromSameGroup = (Object.entries(channelGroups).find(([grp, channelList]) => channelList.includes(ch)) as [string, string[]])[1]
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
        "area": "Area Chart",
        "heatmap": "Heatmap",
        "group_bar": "Grouped Bar Chart",
        "pie": "Pie Chart",
        "worldmap": "World Map",
        "usmap": "US Map",
        "candlestick": "Candlestick Chart",
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
