// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../data/types';
import { channels, type ChartTemplateDef } from 'flint-chart';
import { inferTypeFromValueArray, refineTemporalType } from '../data/utils';

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
    label: string;
}

export interface ClarificationQuestion {
    text: string;
    responseType?: 'single_choice' | 'free_text';
    options?: ClarificationOption[];
}

export interface ClarificationResponse {
    /** Position of the answered question in the agent's `questions[]` (0-based).
     *  For pure freeform replies (user typed without selecting any option),
     *  use a negative value (e.g. -1) or set `source: 'freeform'`. */
    question_index: number;
    answer: string;
    source: 'option' | 'free_text' | 'freeform';
}

export type DelegateTarget = 'data_loading' | 'report_gen';

export interface InteractionEntry {
    from: Actor;
    to: Actor;
    role: 'prompt' | 'clarify' | 'instruction' | 'summary' | 'error' | 'explain' | 'delegate';
    plan?: string; // agent's reasoning / thought for this action
    content: string;
    displayContent?: string;
    /** Names of files / images the user attached with this prompt, surfaced as
     *  chips in the message bubble (the file bytes live in workspace scratch/,
     *  not here). */
    attachments?: string[];
    inputTableNames?: string[]; // table names actually used for this derivation step
    clarificationQuestions?: ClarificationQuestion[];
    /** For 'delegate' entries: which peer agent the Data Agent wants to
     *  hand off to. Rendered as one or two one-click button cards. */
    delegateTarget?: DelegateTarget;
    /** For 'delegate' entries: 1–2 hand-off option prompts. Each string
     *  is shown on its own button and used as the seed prompt sent to
     *  the target agent on click. */
    delegateOptions?: string[];
    timestamp?: number;
}

export type DeriveStatus = 'running' | 'clarifying' | 'completed' | 'error' | 'interrupted';

export interface PendingClarification {
    trajectory: any[];
    completedStepCount: number;
    lastCreatedTableId: string | null;
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

/**
 * A first-class **text turn** (clarify / explain) in the thread — a sibling to
 * charts, tables, and reports (see design-docs/41). Placed in the thread by its
 * one authored edge, `parentNodeId` (design-docs/42): the node the user was
 * asking from when the turn was created. Focusing one overlays a panel above the
 * chat without taking over the canvas (the canvas keeps showing `sourceChartId`);
 * deleting one is a generic artifact delete. (Delegate is NOT a text turn — a
 * hand-off is an agent action, handled directly.)
 */
export interface TextTurn {
    kind: 'text';
    id: string;
    displayId: string;
    /** clarify carries `options`; explain has none. */
    textKind: 'clarify' | 'explain';
    /** Markdown: the question preamble, or the answer. */
    content: string;
    /** The user message that triggered this turn (shown with the card so the
     *  exchange stays self-contained — the run produced no table to anchor it). */
    prompt?: string;
    /** clarify only (empty/undefined ⇒ a plain explanation). */
    options?: ClarificationQuestion[];
    /** True once the user has responded to THIS clarify — it then locks
     *  (read-only). A later response is a *new* conversation, not a re-answer. */
    answered?: boolean;
    /** The user's response to this clarify, shown in the resolved read-only view
     *  (question → answer). */
    answer?: string;
    /**
     * The thread node this turn FOLLOWS (design-docs/42) — the SINGLE authored
     * edge that places the turn in the thread. Captured once at ask time: the
     * table the user asked from (a fresh turn), or the previous node in the run
     * (a chained follow-up / the turn being answered). Branching = two nodes
     * sharing a parent. This fully replaces the old inferred positioning
     * (sourceTableId / resultTableId / conversationId), which are now deprecated.
     */
    parentNodeId: string;
    /** The chart the user was on when this turn was created — canvas provenance
     *  only (focusing the turn keeps this chart on the canvas). NOT positioning. */
    sourceChartId?: string;
    actionId?: string;
    /**
     * §12 opaque resume token — set iff the backend stamped a trajectory on the
     * emitting event (continuation opt-in). Absent ⇒ followups are fresh turns.
     */
    resume?: { trajectory: any[]; completedStepCount: number };
    createdAt: number;
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
    /** Backend-detected reason this candidate cannot be loaded (unknown source_id, missing table_key, etc.). */
    resolutionError?: string;
}

export interface LoadPlan {
    candidates: LoadPlanCandidate[];
    reasoning?: string;
}

/**
 * Agent-proposed inline connection form (design 38). Rendered as a card in the
 * data-loading chat so the user can enter credentials and connect without
 * leaving the conversation. One prompt === one form card === one new connection.
 */
export interface ConnectorFormPrompt {
    sourceType: string;                 // loader registry key, e.g. "postgresql"
    prefilled?: Record<string, string>; // seed values the user gave the agent (incl. shared credentials); never persisted
    status?: 'pending' | 'connected';   // pending = awaiting connect; connected = done
    connectorId?: string;               // set once connected
    connectionName?: string;            // display name of the created connection
    tableCount?: number;                // optional: tables discovered on connect
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
    connectorForm?: ConnectorFormPrompt; // Agent-proposed inline connection form
    divider?: boolean;                  // renders a "new request" separator instead of a bubble; excluded from agent history
    hidden?: boolean;                   // included in agent history but NOT rendered (e.g. a post-connect trigger that continues the conversation)
    canContinue?: boolean;              // agent paused at the tool-call limit — show a "Continue" button to resume the task
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
        // Parallel to `levels` (same order); only populated when `levels`
        // was filled by the backend column-stats pass (design-doc 31).
        // When `levels` is curated (chart-gallery / LLM) this stays undefined
        // and the column filter checklist hides the count column.
        levelCounts?: number[],
        // Total distinct non-null values; drives the filter popover variant
        // (≤ 100 → checklist, > 100 → keyword search).
        distinctCount?: number,
        nullCount?: number,
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

    /**
     * Authored THREAD edge (design-docs/42): the node this table FOLLOWS in the
     * thread — set to a text-turn id when a conversation produced the table (the
     * chain `table → clarifyTurn → askedFromTable`). It overrides
     * `derive.trigger.tableId` for POSITION only; data provenance
     * (`derive.source` / `derive.trigger`) is unchanged. Unset ⇒ the table's
     * thread parent is its data parent (`derive.trigger.tableId`).
     */
    threadParentId?: string;

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
        metadata: names.reduce((acc, name) => {
            const colValues = rows.map(r => r[name]);
            const inferred = inferTypeFromValueArray(colValues);
            return {
                ...acc,
                [name]: {
                    type: refineTemporalType(colValues, inferred),
                    semanticType: "",
                    levels: []
                }
            };
        }, {}),
        derive,
        virtual,
        anchored,
        description,
        source,
    }
}

/**
 * A user-authored "skin" of a chart: a Vega-Lite spec edited via the
 * style/restyle agent. Variants share the chart's encoding and data — they
 * only change visual presentation. See design-docs/28-chart-style-refinement-agent.md.
 *
 * Stored on `Chart` so they persist with the chart and don't pollute the data thread.
 * Currently rendered ONLY in the focused chart canvas (VisualizationView);
 * thumbnails and exports continue to use the assembled default spec.
 */
export interface ChartStyleVariant {
    id: string,                   // stable id, e.g. "v-<timestamp>"
    label?: string,               // user-editable; defaults to "v1", "v2"…
    prompt: string,               // the natural-language instruction that produced this spec
    vlSpec: any,                  // full Vega-Lite spec (data block stripped — re-attached at render)
    basedOnVariantId?: string,    // lineage for "edit v2 → v3"; undefined = derived from default
    encodingFingerprint: string,  // see computeEncodingFingerprint(); used to detect staleness
    createdAt: number,
    rationale?: string,           // optional one-line explanation from the agent
    // Generative UI: a few simple knobs the restyle agent attaches to the
    // variant so the user can keep tweaking the agent-authored spec without
    // re-prompting. While a variant is active these replace the chart-template
    // config. See VariantConfigControl and applyVariantConfigUI in app/restyle.ts.
    configUI?: VariantConfigControl[],
    // Current value for each control, keyed by control.key. Missing key → use
    // the control's defaultValue.
    configValues?: Record<string, any>,
}

/**
 * A single generative-UI control authored by the restyle agent for a style
 * variant. Mirrors the shape of ChartPropertyDef (so it can reuse the same
 * renderers) but instead of arbitrary code it carries a `path`: the location
 * inside the Vega-Lite spec to write the chosen value to.
 *
 * Applying a control is a pure, declarative "set value at path" operation
 * (see applyVariantConfigUI / setAtPath). There is NO code execution — the
 * agent only chooses which knob, where it writes, and the allowed values.
 * The written value may be a scalar OR a whole object (e.g. a full mark/axis
 * sub-spec), which keeps the door open for richer restyle edits while staying
 * safe.
 */
export type VariantConfigControl = {
    key: string;
    label: string;
    /**
     * Path into the vlSpec where the chosen value is written, as an array of
     * object keys / array indices, e.g. ["mark","opacity"] or
     * ["encoding","x","axis","labelAngle"]. Intermediate objects are created
     * as needed. Prototype-polluting segments are rejected at apply time.
     */
    path: (string | number)[];
} & (
    | { type: 'continuous'; min: number; max: number; step?: number; defaultValue: number }
    | { type: 'discrete';  options: { value: any; label: string }[]; defaultValue: any }
    | { type: 'binary';    defaultValue: boolean }
);

export type Chart = { 
    id: string, 
    chartType: string, 
    encodingMap: EncodingMap, 
    tableRef: string, 
    source: "user" | "trigger",
    config?: Record<string, any>,  // additional chart properties defined by the chart template
    title?: string,  // AI-generated chart title (from the analyst's visualize action)
    titleKey?: string,  // "chartType|sortedFieldIds" snapshot when title was set; used to detect staleness
    styleVariants?: ChartStyleVariant[],  // user-authored style refinements (see ChartStyleVariant)
    activeVariantId?: string,  // id of the variant currently rendered in the focused canvas; undefined = default
    scaleFactor?: number,  // zoom level applied by the resizer; undefined = 1 (no zoom)
    unread?: boolean,  // true for agent-generated charts the user hasn't focused yet; cleared on focus
}

/** Compute a string key for title-staleness invalidation: chartType|sortedFieldIds */
export function computeInsightKey(chart: Chart): string {
    const fieldIds = Object.values(chart.encodingMap)
        .map(enc => enc.fieldID)
        .filter((id): id is string => !!id)
        .sort();
    return `${chart.chartType}|${fieldIds.join(',')}`;
}

/**
 * Fingerprint of the chart's structural identity for variant staleness detection.
 * A variant is "stale" iff its stored encodingFingerprint != fingerprintOf(currentChart).
 * Includes chartType + sorted (channel, fieldID, aggregate) tuples — anything that
 * meaningfully changes what the chart depicts. Excludes config (purely cosmetic).
 */
export function computeEncodingFingerprint(chart: Pick<Chart, 'chartType' | 'encodingMap'>): string {
    const tuples = Object.entries(chart.encodingMap)
        .map(([ch, enc]) => `${ch}:${enc?.fieldID ?? ''}:${enc?.aggregate ?? ''}`)
        .sort();
    return `${chart.chartType}|${tuples.join('|')}`;
}

/** True iff the variant was authored against an encoding that no longer matches the chart. */
export function isVariantStale(chart: Chart, variant: ChartStyleVariant): boolean {
    return variant.encodingFingerprint !== computeEncodingFingerprint(chart);
}

export let duplicateChart = (chart: Chart) : Chart => {
    return {
        id: `chart-${Date.now()- Math.floor(Math.random() * 10000)}`,
        chartType: chart.chartType,
        encodingMap: JSON.parse(JSON.stringify(chart.encodingMap)) as EncodingMap,
        tableRef: chart.tableRef,
        source: chart.source,
        config: chart.config ? JSON.parse(JSON.stringify(chart.config)) : undefined,
        scaleFactor: chart.scaleFactor,
        // styleVariants are intentionally NOT copied: they are user-authored
        // refinements tied to the chart they were created on. A duplicate is a
        // fresh canvas. (See design-docs/28-chart-style-refinement-agent.md.)
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

export interface ConnectorAuthPath {
    id: string;
    label: string;
    description?: string;
    fields: string[];
    required_fields?: string[];
    kind: 'credentials' | 'ambient' | 'delegated_login' | 'token_exchange';
    default?: boolean;
    /** Optional in-app CLI sign-in (local mode only), e.g. `az login`. */
    cli_login?: {
        provider: string;
        label: string;
        status_url: string;
        login_url: string;
    };
}

/** A registered connector instance from GET /api/connectors */
export interface ConnectorInstance {
    id: string;
    source_type: string;
    type_name?: string;
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
    params_form: Array<{name: string; type: string; required: boolean; default?: string | number | boolean; options?: string[]; advanced?: boolean; description?: string; sensitive?: boolean; tier?: 'connection' | 'auth' | 'filter'}>;
    pinned_params: Record<string, string>;
    hierarchy: Array<{key: string; label: string}>;
    effective_hierarchy: Array<{key: string; label: string}>;
    auth_mode?: string;
    auth_paths?: ConnectorAuthPath[];
    auth_instructions?: string;
    delegated_login?: { login_url: string; label?: string; params?: string[] } | null;
}
