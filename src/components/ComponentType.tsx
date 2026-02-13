// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../data/types';
import { channels, type ChartTemplateDef } from '../lib/agents-chart-lib';
import { inferTypeFromValueArray } from '../data/utils';

export type FieldSource = "custom" | "original";

export interface FieldItem {
    id: string;
    name: string;

    source: FieldSource;
    tableRef: string; // which table it belongs to
}

export const duplicateField = (field: FieldItem) => {
    return {
        id: field.id,
        name: field.name,
        source: field.source,
        tableRef: field.tableRef,
    } as FieldItem;
}

export interface Trigger {
    tableId: string, // on which table this action is triggered

    chart?: Chart, // what's the intented chart from the user when running formulation
    instruction: string,
    displayInstruction: string, // the short instruction that will be displayed to the user

    resultTableId: string,
}

// Define data cleaning message types
export type DataCleanTableOutput = {
    name: string;
    context: string;
    content: {
        type: 'csv' | 'image_url' | 'web_url';
        value: string;
        incomplete?: boolean;
    };
};

export interface DataCleanBlock {
    id: string; // the id of the item

    items: DataCleanTableOutput[]; // the items that are cleaned in this block

    derive: {
        sourceId: string | undefined; // the source of the block that leads to this block
        prompt: string;
        artifacts: {type: 'image_url' | 'web_url', value: string}[]; // images sent along with the prompt
    }

    // For output messages  
    dialogItem?: any; // Store the dialog item from the model response
}

// Data source types for tracking where data originated
export type DataSourceType = 'paste' | 'file' | 'url' | 'stream' | 'database' | 'example' | 'extract';

// Configuration for data source refresh behavior
// Note: For database sources, connection details are stored in DuckDB backend,
// not in the frontend. Frontend only manages refresh timing/toggle.
export interface DataSourceConfig {
    type: DataSourceType;
    
    // For URL/stream sources - the URL to fetch data from
    url?: string;
    
    // Refresh interval in seconds (used for streams and database auto-refresh)
    refreshIntervalSeconds?: number;
    
    // For database sources - the DuckDB table name (backend knows how to refresh it)
    databaseTable?: string;
    
    // Whether auto-refresh is enabled (frontend controls this for all source types)
    autoRefresh?: boolean;
    
    // Last refresh timestamp
    lastRefreshed?: number;
    
    // Original file name (for file uploads)
    fileName?: string;
    
    // Whether this table can be refreshed (backend has connection info)
    canRefresh?: boolean;
}

export interface DictTable {
    id: string; // name/id of the table
    displayId: string; // display id of the table 
    
    names: string[]; // column names
    metadata: {[key: string]: {
        type: Type,
        semanticType: string, 
        levels: any[]
    }}; // metadata of the table

    rows: any[]; // table content, each entry is a row
    derive?: { // how is this table derived
        source: string[], // which tables are this table computed from
        code: string,
        outputVariable: string, // the Python variable name containing the result DataFrame (required)
        explanation?: {
            code: string, // explanation of the code
            concepts: {
                field: string,
                explanation: string
            }[]
        },
        dialog: any[], // the log of how the data is derived with LLM (the LLM conversation log)
        // tracks how this derivation is triggered, as we as user instruction used to do the formulation,
        // there is a subtle difference between trigger and source, trigger identifies the occasion when the derivision is called,
        // source specifies how the deriviation is done from the source tables, they may be the same, but not necessarily
        // in fact, right now dict tables are all triggered from charts
        trigger: Trigger,
    };
    virtual?: {
        tableId: string; // the id of the virtual table in the database
        rowCount: number; // total number of rows in the full table
    };
    anchored: boolean; // whether this table is anchored as a persistent table used to derive other tables
    createdBy: 'user' | 'agent'; // whether this table is created by the user or the agent
    attachedMetadata: string; // a string of attached metadata explaining what the table is about (used for prompt)
    
    // New field: tracks the source of the data and refresh configuration
    source?: DataSourceConfig;
    
    // Content hash for detecting data changes during refresh
    // Used to avoid unnecessary derived table recalculations when data hasn't changed
    contentHash?: string;
}

export function createDictTable(
    id: string, rows: any[], 
    derive: {
        code: string, outputVariable: string, 
        explanation?: {
            code: string, 
            concepts: {field: string, explanation: string}[]}, 
            source: string[], 
            dialog: any[], 
            trigger: Trigger
        } | undefined = undefined,
    virtual: {tableId: string, rowCount: number} | undefined = undefined,
    anchored: boolean = false,
    createdBy: 'user' | 'agent' = 'user', // by default, all tables are created by the user
    attachedMetadata: string = '',
    source: DataSourceConfig | undefined = undefined,
) : DictTable {
    
    let names = Object.keys(rows[0])

    return {
        id,
        displayId: `${id}`,
        names, 
        rows,
        metadata: names.reduce((acc, name) => ({
            ...acc,
            [name]: {
                type: inferTypeFromValueArray(rows.map(r => r[name])),
                semanticType: "",
                levels: []
            }
        }), {}),
        derive,
        virtual,
        anchored,
        createdBy,
        attachedMetadata,
        source,
    }
}

export interface ChartInsight {
    title: string;
    takeaways: string[];
    key: string;  // "chartType|sortedFieldIds" — used to detect staleness
}

export type Chart = { 
    id: string, 
    chartType: string, 
    encodingMap: EncodingMap, 
    tableRef: string, 
    saved: boolean,
    source: "user" | "trigger",
    config?: Record<string, any>,  // additional chart properties defined by the chart template
    thumbnail?: string,  // PNG data URL for thumbnail display (managed by ChartRenderService, not persisted)
    insight?: ChartInsight,  // AI-generated insight about the visualization
}

/** Compute a string key for insight invalidation: chartType|sortedFieldIds */
export function computeInsightKey(chart: Chart): string {
    const fieldIds = Object.values(chart.encodingMap)
        .map(enc => enc.fieldID)
        .filter((id): id is string => !!id)
        .sort();
    return `${chart.chartType}|${fieldIds.join(',')}`;
}

export let duplicateChart = (chart: Chart) : Chart => {
    return {
        id: `chart-${Date.now()- Math.floor(Math.random() * 10000)}`,
        chartType: chart.chartType,
        encodingMap: JSON.parse(JSON.stringify(chart.encodingMap)) as EncodingMap,
        tableRef: chart.tableRef,
        saved: false,
        source: chart.source,
        config: chart.config ? JSON.parse(JSON.stringify(chart.config)) : undefined,
    }
}

// visualization related definitions
export type EncodingMap = { [key in Channel]: EncodingItem; }

export interface EncodingItem {
    //channel: Channel, // the channel ID
    fieldID?: string, // the fieldID
    dtype?: "quantitative" | "nominal" | "ordinal" | "temporal",
    aggregate?: AggrOp,
    stack?: "layered" | "zero" | "center" | "normalize",
    //sort?: "ascending" | "descending" | string,
    sortOrder?: "ascending" | "descending", // 
    sortBy?: undefined | string, // what values are used to sort the encoding
    scheme?: string
}



/**
 * ChartTemplate extends the library's ChartTemplateDef with a UI icon.
 * The library definition is icon-free for reusability; this type adds
 * the React element used in the Data Formulator UI.
 */
export type ChartTemplate = ChartTemplateDef & {
    icon: any;
}

export const AGGR_OP_LIST = ["count", "sum", "average"] as const

export type AggrOp = typeof AGGR_OP_LIST[number];
export type Channel = typeof channels[number];

export interface EncodingDropResult {
    channel: Channel
}
