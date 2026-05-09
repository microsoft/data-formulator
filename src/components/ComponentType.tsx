// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../data/types';
import { channels, type ChartTemplateDef } from '../lib/agents-chart';
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

    resultTableId: string, // the table produced by this trigger (=== owning table's id)

    // Rich interaction log
    interaction?: InteractionEntry[];
}

// ── New interaction types ────────────────────────────────────

export type Actor = 'user' | 'data-agent' | 'datarec-agent' | 'datatransform-agent';

export interface ClarificationOption {
    id?: string;
    label: string;
    label_code?: string;
}

export interface ClarificationQuestion {
    id: string;
    text: string;
    text_code?: string;
    text_params?: Record<string, string>;
    responseType?: 'single_choice' | 'free_text';
    required?: boolean;
    options?: ClarificationOption[];
}

export interface ClarificationResponse {
    question_id: string;
    answer: string;
    option_id?: string;
    source: 'option' | 'free_text' | 'freeform';
}

export interface ClarificationAutoSelect {
    question_id: string;
    option_id: string;
    timeout_ms?: number;
}

export interface InteractionEntry {
    from: Actor;
    to: Actor;
    role: 'prompt' | 'clarify' | 'instruction' | 'summary' | 'error' | 'explain';
    plan?: string; // agent's reasoning / thought for this action
    content: string;
    displayContent?: string;
    inputTableNames?: string[]; // table names actually used for this derivation step
    clarificationQuestions?: ClarificationQuestion[];
    timestamp?: number;
}

export type DeriveStatus = 'running' | 'clarifying' | 'completed' | 'error' | 'interrupted';

export interface PendingClarification {
    trajectory: any[];
    completedStepCount: number;
    lastCreatedTableId: string | null;
    autoSelect?: boolean;
    autoSelectQuestionId?: string;
    autoSelectOptionId?: string;
    autoSelectTimeoutMs?: number;
}

export interface DraftNode {
    kind: 'draft';
    id: string;
    displayId: string;
    anchored: boolean;
    derive: {
        source: string[];
        trigger: Trigger;
        status: DeriveStatus;
        runningPlan?: string; // live agent thought text while running
        code?: string;
        codeSignature?: string;
        outputVariable?: string;
        dialog?: any[];
        pendingClarification?: PendingClarification | null;
    };
    actionId?: string;
}

export type ThreadNode = DraftNode | DictTable;

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

// ── Conversational data loading chat types ────────────────────────────────

export interface ChatAttachment {
    type: 'image' | 'file' | 'text_file';
    name: string;
    url?: string;           // data URL or object URL for images
    scratchPath?: string;   // path in workspace scratch folder (for large files)
    preview?: string;       // first N lines for text files
}

export interface InlineTablePreview {
    name: string;
    columns: string[];
    sampleRows: Record<string, any>[];  // first 5-10 rows
    totalRows: number;
    csvScratchPath?: string;
}

export interface CodeExecution {
    code: string;
    stdout?: string;
    error?: string;
    resultTable?: InlineTablePreview;
}

export interface PendingTableLoad {
    name: string;
    csvScratchPath: string;
    preview: InlineTablePreview;
    confirmed: boolean;
    // For sample dataset loading
    sampleDataset?: {
        datasetName: string;
        tables: Array<{
            tableUrl: string;
            format: string;
        }>;
        live?: boolean;
        refreshIntervalSeconds?: number;
    };
}

export interface LoadPlanCandidate {
    sourceId: string;
    tableKey: string;
    displayName: string;
    sourceTable: string;
    sourceTableName?: string;
    filters?: Array<{ column: string; operator: string; value?: any }>;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    selected?: boolean;
}

export interface LoadPlan {
    candidates: LoadPlanCandidate[];
    reasoning?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;                    // markdown text
    attachments?: ChatAttachment[];     // images, files attached by user
    tables?: InlineTablePreview[];      // tables to show inline (assistant only)
    codeBlocks?: CodeExecution[];       // executed code + results (assistant only)
    pendingLoads?: PendingTableLoad[];  // tables awaiting user confirmation
    loadPlan?: LoadPlan;                // Agent-proposed data loading plan
    timestamp: number;
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

    // Connector ID (for tables loaded via a DataConnector)
    connectorId?: string;

    // The original table name before backend sanitization (e.g. "Sales Report 2024")
    originalTableName?: string;
}

export interface DictTable {
    kind: 'table'; // discriminant for ThreadNode union
    id: string; // name/id of the table
    displayId: string; // display id of the table 
    
    names: string[]; // column names
    metadata: {[key: string]: {
        type: Type,
        semanticType: string, 
        levels: any[],
        intrinsicDomain?: [number, number],
        unit?: string,
        displayName?: string,
        description?: string,
    }}; // metadata of the table

    rows: any[]; // table content, each entry is a row
    derive?: { // how is this table derived
        source: string[], // which tables are this table computed from
        code: string,
        codeSignature?: string, // HMAC-SHA256 signature proving code was generated by the server
        outputVariable: string, // the Python variable name containing the result DataFrame (required)
        explanation?: {
            code: string, // explanation of the code
            concepts: {
                field: string,
                explanation: string
            }[]
        },
        dialog: any[], // the log of how the data is derived with LLM (the LLM conversation log)
        trigger: Trigger,
        status?: DeriveStatus, // lifecycle state (new — completed tables may omit for backward compat)
    };
    virtual: {
        tableId: string; // the canonical server-side table name (sanitized)
        rowCount: number; // total number of rows (rows.length may be a sample)
    };
    anchored: boolean; // whether this table is anchored as a persistent table used to derive other tables
    description: string; // table-level description sourced from the loader (read-only). Empty string when none.

    source?: DataSourceConfig;
    
    // Content hash for detecting data changes during refresh
    // Used to avoid unnecessary derived table recalculations when data hasn't changed
    contentHash?: string;
}

export function createDictTable(
    id: string, rows: any[], 
    derive: {
        code: string, codeSignature?: string, outputVariable: string, 
        explanation?: {
            code: string, 
            concepts: {field: string, explanation: string}[]}, 
            source: string[], 
            dialog: any[], 
            trigger: Trigger
        } | undefined = undefined,
    virtual: {tableId: string, rowCount: number} = { tableId: id, rowCount: rows.length },
    anchored: boolean = false,
    description: string = '',
    source: DataSourceConfig | undefined = undefined,
) : DictTable {
    
    let names = Object.keys(rows[0])

    return {
        kind: 'table' as const,
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
        description,
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

/** A registered connector instance from GET /api/connectors */
export interface ConnectorInstance {
    id: string;
    source_type: string;
    display_name: string;
    icon: string;
    connected: boolean;
    /** Backend signals that the vault has stored credentials for this
     *  connector + identity. Used by the connect form to render a placeholder
     *  hint (••••••••) on sensitive fields whose values aren't returned. */
    has_stored_credentials?: boolean;
    /** Backend signals that SSO token exchange can auto-connect this source. */
    sso_auto_connect?: boolean;
    deletable?: boolean;
    params_form: Array<{name: string; type: string; required: boolean; default?: string; description?: string; sensitive?: boolean; tier?: 'connection' | 'auth' | 'filter'}>;
    pinned_params: Record<string, string>;
    hierarchy: Array<{key: string; label: string}>;
    effective_hierarchy: Array<{key: string; label: string}>;
    auth_mode?: string;
    auth_instructions?: string;
    delegated_login?: { login_url: string; label?: string } | null;
}
