// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAsyncThunk, createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit'
import { Channel, Chart, ChartTemplate, DataCleanBlock, DataSourceConfig, EncodingItem, EncodingMap, FieldItem, Trigger, computeInsightKey, ChartInsight, ChartStyleVariant, DraftNode, InteractionEntry, DeriveStatus, ChatMessage, PendingTableLoad, PendingClarification } from '../components/ComponentType'
import { enableMapSet } from 'immer';
import { DictTable } from "../components/ComponentType";
import { Message } from '../views/MessageSnackbar';
import { getChartTemplate, getChartChannels } from "../components/ChartTemplates"
import { vlAdaptChart, vlRecommendEncodings } from '../lib/agents-chart';
import { getDataTable } from '../views/ChartUtils';
import { getTriggers, getUrls, computeContentHash } from './utils';
import { apiRequest } from './apiClient';
import { deleteTablesFromWorkspace } from './workspaceService';
import { getChartPngDataUrl } from './chartCache';
import i18n from '../i18n';
import { Type } from '../data/types';
import { createTableFromFromObjectArray, inferTypeFromValueArray, refineTemporalType } from '../data/utils';
import { Identity, IdentityType, getBrowserId } from './identity';
import { REHYDRATE } from 'redux-persist';

enableMapSet();

// Redux Persist will handle persistence automatically with enableMapSet()

export const generateFreshChart = (tableRef: string, chartType: string, source: "user" | "trigger" = "user") : Chart => {
    return { 
        id: `chart-${Date.now()- Math.floor(Math.random() * 10000)}`, 
        chartType: chartType, 
        encodingMap: Object.assign({}, ...getChartChannels(chartType).map((channel) => ({ [channel]: { channel: channel, bin: false } }))),
        tableRef: tableRef,
        source: source,
    }
}

/**
 * Migrate legacy `chartType: "Dotted Line Chart"` to `Line Chart` with `config.showPoints: true`.
 * Dotted Line was removed as a standalone type and folded into a Line Chart property.
 */
const migrateDottedLineChart = (chart: any): any => {
    if (chart?.chartType !== 'Dotted Line Chart') return chart;
    return {
        ...chart,
        chartType: 'Line Chart',
        config: { ...(chart.config || {}), showPoints: true },
    };
};

export interface SSEMessage {
    type: "heartbeat" | "notification" | "action"; 
    text: string;
    data?: Record<string, any>;
    timestamp: number;
}

// Add interface for app configuration
export interface ServerConfig {
    DISABLE_DISPLAY_KEYS: boolean;
    DISABLE_DATA_CONNECTORS: boolean;
    DISABLE_CUSTOM_MODELS: boolean;
    PROJECT_FRONT_PAGE: boolean;
    MAX_DISPLAY_ROWS: number;
    AVAILABLE_LANGUAGES: string[];
    DATA_FORMULATOR_HOME?: string;
    DEV_MODE: boolean;
    WORKSPACE_BACKEND: 'local' | 'azure_blob' | 'ephemeral';
    AUTH_PROVIDER?: string;
    AUTH_INFO?: {
        action: 'frontend' | 'redirect' | 'transparent' | 'none';
        label?: string;
        [key: string]: unknown;
    };
    CONNECTORS?: Array<{
        source_id: string;
        source_type: string;
        name: string;
        icon: string;
        params_form: Array<{name: string; type: string; required: boolean; default?: string; description?: string; sensitive?: boolean; tier?: 'connection' | 'auth' | 'filter'}>;
        pinned_params: Record<string, string>;
        hierarchy: Array<{key: string; label: string}>;
        effective_hierarchy: Array<{key: string; label: string}>;
        auth_instructions: string;
        auth_mode?: string;
        delegated_login?: { login_url: string; label?: string } | null;
    }>;
    DISABLED_SOURCES?: Record<string, {install_hint: string}>;
    CONNECTED_CONNECTORS?: string[];
    IDENTITY?: { type: string; id: string };
    CREDENTIAL_VAULT_ENABLED?: boolean;
    IS_LOCAL_MODE?: boolean;
}

export interface ModelConfig {
    id: string; // unique identifier for the model / client combination
    endpoint: string;
    model: string;
    api_key?: string;
    api_base?: string;
    api_version?: string;
    /** True for models configured server-side via .env. Their credentials never leave the server. */
    is_global?: boolean;
}


export type FocusedId = 
    | { type: 'table'; tableId: string }
    | { type: 'chart'; chartId: string }
    | { type: 'report'; reportId: string }
    | undefined;

export const DEFAULT_ROW_LIMIT = 2_000_000;
export const DEFAULT_ROW_LIMIT_EPHEMERAL = 20_000;

export interface ClientConfig {
    formulateTimeoutSeconds: number;
    defaultChartWidth: number;
    defaultChartHeight: number;
    maxStretchFactor: number; // max per-axis stretch multiplier for chart sizing (default 2.0)
    frontendRowLimit: number; // max rows to keep in browser when loading locally (non-virtual)
    paletteKey: string; // active color palette key from tokens.ts
}

export interface GeneratedReport {
    id: string;
    content: string;
    selectedChartIds: string[];
    createdAt: number;
    title?: string;
    updatedAt?: number;
    triggerTableId?: string;
    contentSnapshotHash?: string;
    prompt?: string;
    status?: 'generating' | 'completed' | 'error';
}

export interface DataFormulatorState {


    // Identity management: local (localhost), user (SSO), or browser (anonymous multi-user)
    // Initialized with browser identity, then updated from server config or auth provider
    identity: Identity;
    /**
     * Server-managed global models loaded from the backend on every app start.
     * These are NOT persisted by redux-persist (blacklisted in store.ts) so they
     * are always refreshed from the latest server configuration.
     */
    globalModels: ModelConfig[];
    /** User-added models, persisted across browser sessions. */
    models: ModelConfig[];
    selectedModelId: string | undefined;
    testedModels: {id: string, status: 'ok' | 'error' | 'testing' | 'unknown', message: string}[];

    tables : DictTable[];
    draftNodes: DraftNode[];
    charts: Chart[];
    
    conceptShelfItems: FieldItem[];

    // controls logs and message index
    messages: Message[];
    displayedMessageIdx: number;

    focusedDataCleanBlockId: {blockId: string, itemId: number} | undefined;

    focusedId: FocusedId;

    viewMode: 'editor' | 'report';

    chartSynthesisInProgress: string[];
    chartInsightInProgress: string[];

    /**
     * Thumbnail PNG data URLs keyed by chart id. Stored in a separate slice
     * (rather than on `chart.thumbnail`) so a thumbnail update doesn't
     * invalidate the `charts` array reference and trigger a cascade of
     * `ChartRenderService` effect re-runs / cancelled render queues.
     * Not persisted — thumbnails are re-derived from the module-scoped
     * `chartCache` on reload.
     */
    chartThumbnails: Record<string, string>;

    /**
     * Monotonically increasing counter bumped whenever the focused canvas
     * fetches a fresh display-row sample (see `src/app/displayRowsCache.ts`).
     * Background services that render off-screen (e.g. ChartRenderService)
     * select this so they re-run when the canvas's richer sample becomes
     * available, instead of being stuck rendering against the small preview
     * slice that virtual tables ship in `table.rows`.
     */
    displayRowsTick: number;

    serverConfig: ServerConfig;

    config: ClientConfig;

    dataLoaderConnectParams: Record<string, Record<string, string>>; // {table_name: {param_name: param_value}}

    // Data cleaning dialog state (legacy, kept for migration)
    dataCleanBlocks: DataCleanBlock[];
    cleanInProgress: boolean;

    // Conversational data loading chat
    dataLoadingChatMessages: ChatMessage[];
    dataLoadingChatInProgress: boolean;
    /**
     * Monotonic counter bumped whenever the chat is reset externally
     * (clearChatMessages). DataLoadingChat watches this to abort any
     * in-flight stream and discard partial dispatches that would
     * otherwise pollute the freshly-cleared thread.
     * Transient — not persisted.
     */
    dataLoadingChatResetCounter: number;
    /**
     * Pending submission queued for the data-loading chat. Set by any
     * surface that wants to hand a prompt off to the chat (the menu
     * agent input box, suggestion auto-run, external dialog callers).
     * `DataLoadingChat` consumes it on render: it clears the slot and
     * sends the carried payload as a fresh user message. Using a single
     * redux slot (instead of props + a reset counter) eliminates the
     * cross-tick race where the parent's pre-clear would otherwise
     * cancel the auto-send for the new prompt. Transient — not persisted.
     */
    dataLoadingChatPending: { text: string; images: string[]; attachments: string[] } | null;
    /**
     * Pending hand-off from the Data Agent to a peer agent. Set by the
     * Data Agent's `delegate` action card; consumed by `DataFormulator`
     * (for `data_loading` → opens the upload dialog) or
     * `SimpleChartRecBox` (for `report_gen` → kicks off the report
     * generator) which clear this back to null. Transient — not
     * persisted across sessions.
     */
    agentHandoffRequest: { target: 'data_loading' | 'report_gen'; prompt: string; images?: string[] } | null;

    // Generated reports state
    generatedReports: GeneratedReport[];

    // Session loading overlay
    sessionLoading: boolean;
    sessionLoadingLabel: string;

    // Active workspace (null = show workspace picker)
    // id: stable identifier (folder name), displayName: user-facing name (can be renamed)
    activeWorkspace: { id: string; displayName: string } | null;

    /** Whether the data source sidebar is expanded (true) or collapsed to rail (false) */
    dataSourceSidebarOpen: boolean;

    /** Which data source sidebar tab is active. Persisted so it survives session refresh. */
    dataSourceSidebarTab: 'sources' | 'sessions' | 'knowledge';

    /**
     * One-shot signal asking the sidebar to focus a specific connector
     * (open the sidebar, switch to sources tab, expand + scroll-into-view
     * + briefly highlight). Cleared by the sidebar after consumption.
     */
    focusedConnectorId?: string;
}

// Define the initial state using that type
const initialState: DataFormulatorState = {


    identity: { type: 'browser', id: getBrowserId() },
    globalModels: [],
    models: [],
    selectedModelId: localStorage.getItem('df_selected_model') || undefined,
    testedModels: [],

    tables: [],
    draftNodes: [],
    charts: [],

    conceptShelfItems: [],

    messages: [],
    displayedMessageIdx: -1,

    focusedDataCleanBlockId: undefined,
    focusedId: undefined,

    viewMode: 'editor',

    chartSynthesisInProgress: [],
    chartInsightInProgress: [],
    chartThumbnails: {},
    displayRowsTick: 0,

    serverConfig: {
        DISABLE_DISPLAY_KEYS: false,
        DISABLE_DATA_CONNECTORS: false,
        DISABLE_CUSTOM_MODELS: false,
        PROJECT_FRONT_PAGE: false,
        MAX_DISPLAY_ROWS: 10000,
        AVAILABLE_LANGUAGES: ['en', 'zh'],
        DEV_MODE: false,
        WORKSPACE_BACKEND: 'local',
    },

    config: {
        formulateTimeoutSeconds: 180,
        defaultChartWidth: 400,
        defaultChartHeight: 300,
        maxStretchFactor: 2.0,
        frontendRowLimit: DEFAULT_ROW_LIMIT,
        paletteKey: 'fluent',
    },

    dataLoaderConnectParams: {},

    dataCleanBlocks: [],
    cleanInProgress: false,

    dataLoadingChatMessages: [],
    dataLoadingChatInProgress: false,
    dataLoadingChatResetCounter: 0,
    dataLoadingChatPending: null,
    agentHandoffRequest: null,

    generatedReports: [],

    sessionLoading: false,
    sessionLoadingLabel: '',

    activeWorkspace: null,

    dataSourceSidebarOpen: false,

    dataSourceSidebarTab: 'sources',

    focusedConnectorId: undefined,
}

/**
 * Non-memoized equivalent of `dfSelectors.getAllCharts` for use inside
 * reducers. Reducers receive an Immer draft `state`; passing a draft into
 * memoized selectors (createSelector) causes the selector to cache draft
 * proxies. Once the reducer completes, those proxies are revoked, and any
 * later read from the cached array throws "Cannot perform 'get' on a proxy
 * that has been revoked". Always use this helper from reducer code paths.
 */
const collectAllCharts = (state: DataFormulatorState): Chart[] => {
    const triggerCharts = state.tables
        .filter(t => t.derive?.trigger?.chart)
        .map(t => t.derive?.trigger?.chart) as Chart[];
    return [...state.charts, ...triggerCharts];
};

let getUnrefedDerivedTableIds = (state: DataFormulatorState) => {
    // find tables directly referred by charts
    let allCharts = collectAllCharts(state);
    let chartRefedTables = allCharts.map(chart => getDataTable(chart, state.tables, allCharts, state.conceptShelfItems))
        .filter(t => t != undefined).map(t => t.id);
    let tableWithDescendants = state.tables.filter(table => state.tables.some(t => t.derive?.trigger.tableId == table.id)).map(t => t.id);

    return state.tables.filter(table => table.derive && !tableWithDescendants.includes(table.id) && !chartRefedTables.includes(table.id)).map(t => t.id);
}

let deleteChartsRoutine = (state: DataFormulatorState, chartIds: string[]) => {
    let currentFocusedChartId = state.focusedId?.type === 'chart' ? state.focusedId.chartId : undefined;

    // Capture context BEFORE filtering so we can pick a sensible new focus.
    // When the focused chart is being deleted, we prefer:
    //   1. The neighboring sibling on the same table (visually adjacent).
    //   2. The table itself, if no sibling remains.
    //   3. Any remaining chart, as a final fallback.
    let deletedFocusedChart = currentFocusedChartId && chartIds.includes(currentFocusedChartId)
        ? state.charts.find(c => c.id === currentFocusedChartId)
        : undefined;
    let focusedTableRef = deletedFocusedChart?.tableRef;
    let focusedSiblingIndex = -1;
    if (deletedFocusedChart && focusedTableRef) {
        const siblings = state.charts.filter(c => c.tableRef === focusedTableRef);
        focusedSiblingIndex = siblings.findIndex(c => c.id === currentFocusedChartId);
    }

    let charts = state.charts.filter(c => !chartIds.includes(c.id));

    if (deletedFocusedChart) {
        const remainingSiblings = focusedTableRef
            ? charts.filter(c => c.tableRef === focusedTableRef)
            : [];
        if (remainingSiblings.length > 0) {
            // Pick the chart just before the deleted one in original order
            // (visually "previous"). Clamp so the very first sibling
            // falls back to the new first, and tail deletions land on
            // the new last.
            const targetIdx = Math.min(
                Math.max(0, focusedSiblingIndex - 1),
                remainingSiblings.length - 1,
            );
            state.focusedId = { type: 'chart', chartId: remainingSiblings[targetIdx].id };
        } else if (focusedTableRef && state.tables.some(t => t.id === focusedTableRef)) {
            // Last chart on this table — surface the table itself.
            state.focusedId = { type: 'table', tableId: focusedTableRef };
        } else if (charts.length > 0) {
            state.focusedId = { type: 'chart', chartId: charts[0].id };
        } else {
            state.focusedId = undefined;
        }
    }

    state.chartSynthesisInProgress = state.chartSynthesisInProgress.filter(s => !chartIds.includes(s));

    // Clean up thumbnail entries for removed charts.
    if (state.chartThumbnails) {
        for (const id of chartIds) {
            delete state.chartThumbnails[id];
        }
    }

    // update focusedChart and activeThreadChart
    state.charts = charts;

    let unrefedDerivedTableIds = getUnrefedDerivedTableIds(state);
    let tableIdsToDelete = state.tables.filter(t => !t.anchored && unrefedDerivedTableIds.includes(t.id)).map(t => t.id);
    
    // Clean up virtual tables from workspace before removing from state
    let tablesToDelete = state.tables.filter(t => tableIdsToDelete.includes(t.id));
    deleteTablesFromWorkspace(tablesToDelete.map(t => t.virtual.tableId));

    state.tables = state.tables.filter(t => !tableIdsToDelete.includes(t.id));

    // If the focus we just set lands on a table that has now been cascade-
    // deleted (e.g. an unanchored derived table whose only chart we just
    // removed), walk up the derive chain to land on a still-present chart
    // — the "previous chart above this table" the user expects. Falls
    // through to the parent table itself, then to any remaining chart.
    if (state.focusedId?.type === 'table' && !state.tables.some(t => t.id === (state.focusedId as any).tableId)) {
        const deletedTablesById = new Map(tablesToDelete.map(t => [t.id, t]));
        let cursor: string | undefined = (state.focusedId as any).tableId;
        let resolved = false;
        while (cursor) {
            const removedTable = deletedTablesById.get(cursor);
            const parentId: string | undefined = removedTable?.derive?.trigger.tableId;
            if (!parentId) break;
            if (state.tables.some(t => t.id === parentId)) {
                const parentCharts = state.charts.filter(c => c.tableRef === parentId);
                if (parentCharts.length > 0) {
                    state.focusedId = { type: 'chart', chartId: parentCharts[parentCharts.length - 1].id };
                } else {
                    state.focusedId = { type: 'table', tableId: parentId };
                }
                resolved = true;
                break;
            }
            cursor = parentId;
        }
        if (!resolved) {
            if (state.charts.length > 0) {
                state.focusedId = { type: 'chart', chartId: state.charts[state.charts.length - 1].id };
            } else if (state.tables.length > 0) {
                state.focusedId = { type: 'table', tableId: state.tables[0].id };
            } else {
                state.focusedId = undefined;
            }
        }
    }
}

/**
 * Remove a table from Redux state (tables, conceptShelf, charts, draftNodes, focus).
 * Does NOT send any server-side delete requests ??the caller decides whether
 * server cleanup is needed.
 */
let removeTableStateRoutine = (state: DataFormulatorState, tableId: string) => {
    const tableToDelete = state.tables.find(t => t.id === tableId);
    if (!tableToDelete) return;

    const directChildren = state.tables.filter(t =>
        t.derive?.trigger.tableId === tableId ||
        t.derive?.source.includes(tableId)
    );

    if (directChildren.length > 0 && tableToDelete.derive) {
        const parentTriggerId = tableToDelete.derive.trigger.tableId;
        state.tables = state.tables.map(t => {
            if (!t.derive || t.derive.trigger.tableId !== tableId) return t;
            return { ...t, derive: { ...t.derive, trigger: { ...t.derive.trigger, tableId: parentTriggerId } } };
        });
    }

    state.tables = state.tables.filter(t => t.id !== tableId);
    state.conceptShelfItems = state.conceptShelfItems.filter(f => f.tableRef !== tableId);

    const chartIdsToDelete = state.charts.filter(c => c.tableRef === tableId).map(c => c.id);
    deleteChartsRoutine(state, chartIdsToDelete);

    // Also clean up any draft nodes that were chained from this table
    state.draftNodes = state.draftNodes.filter(d => d.derive?.trigger.tableId !== tableId);

    // Delete reports triggered from this table
    state.generatedReports = state.generatedReports.filter(r => r.triggerTableId !== tableId);

    if (state.focusedId?.type === 'table' && state.focusedId.tableId === tableId) {
        state.focusedId = state.tables.length > 0 ? { type: 'table', tableId: state.tables[0].id } : undefined;
    }
    // If a report triggered by this table was focused, fall back
    if (state.focusedId?.type === 'report') {
        const reportId = (state.focusedId as { type: 'report'; reportId: string }).reportId;
        const focusedReport = state.generatedReports.find(r => r.id === reportId);
        if (!focusedReport) {
            state.focusedId = state.tables.length > 0 ? { type: 'table', tableId: state.tables[state.tables.length - 1].id } : undefined;
            state.viewMode = 'editor';
        }
    }
};

export const fetchFieldSemanticType = createAsyncThunk(
    "dataFormulatorSlice/fetchFieldSemanticType",
    async (table: DictTable, { getState }) => {
        console.log(">>> call agent to infer semantic types <<<")

        let state = getState() as DataFormulatorState;

        const sampleRows = (table.rows || []).slice(0, 15);
        const { data } = await apiRequest(getUrls().SERVER_PROCESS_DATA_ON_LOAD, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input_data: {name: table.id, rows: sampleRows, virtual: table.virtual ? true : false},
                model: dfSelectors.getActiveModel(state)
            }),
        });
        return data;
    }
);

/**
 * Fetch backend-computed per-column statistics for a workspace-stored
 * (virtual) table and merge them into ``table.metadata``. Powers the
 * data-grid column filter popover (design-doc 31): the response carries
 * ``distinct_count`` / ``null_count`` for every column and, for
 * low-cardinality columns, ``levels`` + parallel ``level_counts``.
 *
 * ``levels`` is merged with precedence — curated orderings already on the
 * table (LLM ``sort_order``, chart-gallery hints) win; the stats-derived
 * list only fills when the existing ``levels`` is empty.
 */
export const fetchColumnStats = createAsyncThunk(
    "dataFormulatorSlice/fetchColumnStats",
    async (table: DictTable) => {
        const { data } = await apiRequest(getUrls().GET_COLUMN_STATS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table_name: table.virtual?.tableId || table.id }),
        });
        return { tableId: table.id, statistics: data?.statistics || [] };
    }
);

export const fetchCodeExpl = createAsyncThunk(
    "dataFormulatorSlice/fetchCodeExpl",
    async (derivedTable: DictTable, { getState }) => {
        console.log(">>> call agent to obtain code explanations <<<")

        let state = getState() as DataFormulatorState;

        const { data } = await apiRequest(getUrls().CODE_EXPL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input_tables: derivedTable.derive?.source
                                .map(tId => state.tables.find(t => t.id == tId) as DictTable)
                                .map(t => ({ 
                                    name: t.id, 
                                    rows: t.rows,
                                })),
                code: derivedTable.derive?.code,
                model: dfSelectors.getActiveModel(state)
            }),
        });
        return data;
    }
);

export const fetchChartInsight = createAsyncThunk(
    "dataFormulatorSlice/fetchChartInsight",
    async (args: { chartId: string; tableId: string }, { getState }) => {
        console.log(">>> call agent to generate chart insight <<<");

        const state = getState() as DataFormulatorState;
        const chart = collectAllCharts(state).find(c => c.id === args.chartId);
        if (!chart) throw new Error(`Chart not found: ${args.chartId}`);

        // Wait for chart image to be available in cache (replaces fixed 1.5s delay at call site)
        const chartImage = await waitForChartImage(args.chartId);
        if (!chartImage) {
            throw new DOMException('Chart image not ready after waiting', 'ChartImageNotReady');
        }

        // Strip the data:image/png;base64, prefix for the backend
        const base64Prefix = 'data:image/png;base64,';
        const imagePayload = chartImage.startsWith(base64Prefix)
            ? chartImage.substring(base64Prefix.length)
            : chartImage;

        // Collect field names from the encoding map
        const fieldNames = Object.values(chart.encodingMap)
            .map(enc => enc.fieldID)
            .filter((id): id is string => !!id)
            .map(id => {
                const field = state.conceptShelfItems.find(f => f.id === id);
                return field?.name || id;
            });

        // Collect input table info (include source tables for derived tables)
        const table = state.tables.find(t => t.id === args.tableId);
        const tableIds = table?.derive?.source ? [...table.derive.source, table.id] : [table?.id].filter(Boolean);
        const inputTables = [...new Set(tableIds)]
            .map(tId => state.tables.find(t => t.id === tId))
            .filter((t): t is DictTable => !!t)
            .map(t => ({
                name: t.id,
                rows: t.rows,
            }));

        // Use unified timeout from user config
        const timeoutSeconds = state.config.formulateTimeoutSeconds;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort(new DOMException(
                `Chart insight timed out after ${timeoutSeconds}s`,
                'TimeoutError',
            ));
        }, timeoutSeconds * 1000);

        try {
            const { data } = await apiRequest(getUrls().CHART_INSIGHT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chart_image: imagePayload,
                    chart_type: chart.chartType,
                    field_names: fieldNames,
                    input_tables: inputTables,
                    model: dfSelectors.getActiveModel(state),
                }),
                signal: controller.signal,
            });

            return { title: data.title, takeaways: data.takeaways,
                     chartId: args.chartId, insightKey: computeInsightKey(chart) };
        } finally {
            clearTimeout(timeoutId);
        }
    }
);

/**
 * Wait for a chart image to appear in chartCache.
 * Polls at short intervals up to a maximum timeout.
 */
async function waitForChartImage(
    chartId: string,
    timeoutMs: number = 8000,
    intervalMs: number = 250,
): Promise<string | undefined> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const image = await getChartPngDataUrl(chartId);
        if (image) return image;
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return undefined;
}

/** Fast fetch: returns the list of server-configured models instantly (no
 *  connectivity check).  The UI renders them immediately with a "testing"
 *  spinner so the admin can see every configured model right away. */
export const fetchGlobalModelList = createAsyncThunk(
    "dataFormulatorSlice/fetchGlobalModelList",
    async () => {
        const { data } = await apiRequest(getUrls().LIST_GLOBAL_MODELS);
        return data;
    }
);

/** Slow fetch: runs parallel connectivity checks on all server-configured
 *  models and returns each model's connected / disconnected status. */
export const fetchAvailableModels = createAsyncThunk(
    "dataFormulatorSlice/fetchAvailableModels",
    async () => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000)

        try {
            const { data } = await apiRequest(getUrls().CHECK_AVAILABLE_MODELS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
                signal: controller.signal,
            });
            return data;
        } finally {
            clearTimeout(timeoutId);
        }
    }
);

// No server round-trip needed - identity is determined client-side:
// - User ID from auth provider (if logged in)
// - Browser ID from localStorage (shared across all tabs)

export const dataFormulatorSlice = createSlice({
    name: 'dataFormulatorSlice',
    initialState: initialState,
    reducers: {
        resetState: (state) => {
            //state.table = undefined;
            
            // Preserve: models, selectedModelId, testedModels,
            //           config, dataLoaderConnectParams, identity

            state.tables = [];
            state.draftNodes = [];
            state.charts = [];

            state.conceptShelfItems = [];

            state.messages = [];
            state.displayedMessageIdx = -1;

            state.focusedDataCleanBlockId = undefined;

            state.focusedId = undefined;

            state.viewMode = 'editor';

            state.chartSynthesisInProgress = [];
            state.chartInsightInProgress = [];

            // Preserve serverConfig ??it reflects the actual server state, not user state

            state.dataCleanBlocks = [];
            state.cleanInProgress = false;

            state.dataLoadingChatMessages = [];
            state.dataLoadingChatInProgress = false;
            state.dataLoadingChatResetCounter = (state.dataLoadingChatResetCounter ?? 0) + 1;
            state.dataLoadingChatPending = null;

            state.generatedReports = [];

            // Clear active workspace so stale IDs don't persist across restarts
            state.activeWorkspace = null;
            // Redux Persist will handle persistence automatically
            
        },
        setSessionLoading: (state, action: PayloadAction<{loading: boolean, label?: string}>) => {
            state.sessionLoading = action.payload.loading;
            state.sessionLoadingLabel = action.payload.label || '';
        },
        setActiveWorkspace: (state, action: PayloadAction<{ id: string; displayName: string } | null>) => {
            state.activeWorkspace = action.payload;
        },
        resetForNewWorkspace: (state, action: PayloadAction<{ id: string; displayName: string }>) => {
            // Fresh session data, but preserve user settings / server config / identity / view mode
            return {
                ...initialState,
                identity: state.identity,
                globalModels: state.globalModels,
                models: state.models,
                selectedModelId: state.selectedModelId,
                testedModels: state.testedModels,
                serverConfig: state.serverConfig,
                config: state.config,
                viewMode: state.viewMode,
                dataLoaderConnectParams: state.dataLoaderConnectParams,
                dataSourceSidebarOpen: state.dataSourceSidebarOpen,
                dataSourceSidebarTab: state.dataSourceSidebarTab,
                activeWorkspace: action.payload,
            };
        },
        setDataSourceSidebarOpen: (state, action: PayloadAction<boolean>) => {
            state.dataSourceSidebarOpen = action.payload;
        },
        setDataSourceSidebarTab: (state, action: PayloadAction<'sources' | 'sessions' | 'knowledge'>) => {
            state.dataSourceSidebarTab = action.payload;
        },
        /**
         * Ask the data-source sidebar to focus a specific connector.
         * Opens the sidebar (if collapsed) and stores the target id; the
         * sidebar consumes the signal and clears it.
         */
        focusConnector: (state, action: PayloadAction<string>) => {
            state.dataSourceSidebarOpen = true;
            state.focusedConnectorId = action.payload;
        },
        /** Sidebar calls this once it has consumed a focus request. */
        clearFocusedConnector: (state) => {
            state.focusedConnectorId = undefined;
        },
        loadState: (state, action: PayloadAction<any>) => {
            const saved = action.payload;

            // Return a brand-new state object so Immer skips
            // recursive proxy / freeze on potentially huge table rows.
            return {
                // Preserve local-only / sensitive fields from current state
                identity: state.identity,
                globalModels: state.globalModels || [],
                models: state.models || [],
                selectedModelId: state.selectedModelId || undefined,
                testedModels: state.testedModels || [],
                dataLoaderConnectParams: state.dataLoaderConnectParams || {},
                serverConfig: state.serverConfig,

                // Restore from saved payload (backfill virtual for old states).
                // Strip the legacy `attachedMetadata` field on the way in
                // (see design-docs/23-table-description-unification.md): the
                // value was session-only and often agent-fabricated. We don't
                // migrate it to `description`, which is reserved for
                // loader-supplied source descriptions.
                tables: (saved.tables || []).map((t: any) => {
                    const { attachedMetadata: _legacyAttachedMetadata, ...rest } = t;
                    return {
                        ...rest,
                        description: typeof rest.description === 'string' ? rest.description : '',
                        virtual: rest.virtual || { tableId: rest.id, rowCount: rest.rows?.length || 0 },
                    };
                }),
                draftNodes: (saved.draftNodes || []).map((node: DraftNode) => {
                    // Mark any running/clarifying drafts as interrupted (SSE connection lost)
                    if (node.derive?.status === 'running' || node.derive?.status === 'clarifying') {
                        return {
                            ...node,
                            derive: {
                                ...node.derive,
                                status: 'interrupted' as const,
                                trigger: {
                                    ...node.derive.trigger,
                                    interaction: [
                                        ...(node.derive.trigger.interaction || []),
                                        { from: 'data-agent' as const, to: 'user' as const, role: 'error' as const,
                                          content: 'Interrupted by page refresh. You can retry or delete this step.',
                                          timestamp: Date.now() }
                                    ]
                                }
                            }
                        };
                    }
                    return node;
                }),
                charts: (saved.charts || []).map(migrateDottedLineChart).map((c: Chart) => {
                    // Legacy sessions stored `thumbnail` on the Chart itself.
                    // We now keep thumbnails in a sibling slice (see
                    // `chartThumbnails` in state). Strip the field on load so
                    // it doesn't get re-persisted; ChartRenderService will
                    // repopulate the thumbnail slice from the module cache.
                    if (c && (c as any).thumbnail !== undefined) {
                        const { thumbnail: _drop, ...rest } = c as any;
                        return rest as Chart;
                    }
                    return c;
                }),
                conceptShelfItems: saved.conceptShelfItems || [],
                focusedDataCleanBlockId: saved.focusedDataCleanBlockId || undefined,
                focusedId: saved.focusedId || undefined,
                config: { ...initialState.config, ...(saved.config || {}) },
                dataCleanBlocks: saved.dataCleanBlocks || [],
                dataLoadingChatMessages: saved.dataLoadingChatMessages || [],
                dataLoadingChatPending: null,
                generatedReports: saved.generatedReports || [],

                // Reset transient fields
                messages: [],
                displayedMessageIdx: -1,
                viewMode: saved.viewMode || 'editor',
                chartSynthesisInProgress: [],
                chartInsightInProgress: [],
                cleanInProgress: false,
                dataLoadingChatInProgress: false,
                dataLoadingChatResetCounter: 0,
                agentHandoffRequest: null,
                sessionLoading: false,
                sessionLoadingLabel: '',

                // Preserve or restore workspace name
                activeWorkspace: saved.activeWorkspace ?? state.activeWorkspace ?? null,

                dataSourceSidebarOpen: state.dataSourceSidebarOpen,
                dataSourceSidebarTab: state.dataSourceSidebarTab,

                // Reset display-rows tick so dependent components re-fetch.
                displayRowsTick: 0,

                // Thumbnails are not persisted; ChartRenderService
                // repopulates this slice from the module cache / fresh
                // renders after load.
                chartThumbnails: {},
            };
        },
        setServerConfig: (state, action: PayloadAction<ServerConfig>) => {
            state.serverConfig = action.payload;
            // Auto-adjust frontendRowLimit for ephemeral mode if still at default
            if (action.payload.WORKSPACE_BACKEND === 'ephemeral' && state.config.frontendRowLimit === DEFAULT_ROW_LIMIT) {
                state.config.frontendRowLimit = DEFAULT_ROW_LIMIT_EPHEMERAL;
            }
        },
        setConfig: (state, action: PayloadAction<ClientConfig>) => {
            state.config = action.payload;
        },
        setViewMode: (state, action: PayloadAction<'editor' | 'report'>) => {
            state.viewMode = action.payload;
        },
        selectModel: (state, action: PayloadAction<string | undefined>) => {
            state.selectedModelId = action.payload;
            try {
                if (action.payload) {
                    localStorage.setItem('df_selected_model', action.payload);
                } else {
                    localStorage.removeItem('df_selected_model');
                }
            } catch { /* localStorage unavailable */ }
        },
        addModel: (state, action: PayloadAction<ModelConfig>) => {
            state.models = [...state.models, action.payload];
        },
        removeModel: (state, action: PayloadAction<string>) => {
            state.models = state.models.filter(model => model.id != action.payload);
            if (state.selectedModelId == action.payload) {
                state.selectedModelId = undefined;
                try { localStorage.removeItem('df_selected_model'); } catch { /* */ }
            }
        },
        updateModelStatus: (state, action: PayloadAction<{id: string, status: 'ok' | 'error' | 'testing' | 'unknown', message: string}>) => {
            let id = action.payload.id;
            let status = action.payload.status;
            let message = action.payload.message;
            
            state.testedModels = [
                ...state.testedModels.filter(t => t.id != id), 
                {id: id, status, message}
            ];
        },
        addTableToStore: (state, action: PayloadAction<DictTable>) => {
            let table = action.payload;
            if (!table.contentHash) {
                table = { ...table, contentHash: computeContentHash(table.rows, table.names) };
            }

            const existingIdx = state.tables.findIndex(t => t.id === table.id);
            if (existingIdx >= 0) {
                state.tables[existingIdx] = table;
                state.conceptShelfItems = state.conceptShelfItems.filter(f => f.tableRef !== table.id);
            } else {
                state.tables = [...state.tables, table];
            }

            state.charts = [...state.charts];
            state.conceptShelfItems = [...state.conceptShelfItems, ...getDataFieldItems(table)];
            state.focusedId = { type: 'table', tableId: table.id };
        },
        deleteTable: (state, action: PayloadAction<string>) => {
            const tableId = action.payload;
            const tableToDelete = state.tables.find(t => t.id === tableId);
            if (!tableToDelete) return;
            deleteTablesFromWorkspace([tableToDelete.virtual.tableId]);
            removeTableStateRoutine(state, tableId);
        },
        removeTableLocally: (state, action: PayloadAction<string>) => {
            removeTableStateRoutine(state, action.payload);
        },
        updateTableAnchored: (state, action: PayloadAction<{tableId: string, anchored: boolean}>) => {
            let tableId = action.payload.tableId;
            let anchored = action.payload.anchored;
            state.tables = state.tables.map(t => t.id == tableId ? {...t, anchored} : t);
        },
        updateTableDisplayId: (state, action: PayloadAction<{tableId: string, displayId: string}>) => {
            let tableId = action.payload.tableId;
            let displayId = action.payload.displayId;
            state.tables = state.tables.map(t => t.id == tableId ? {...t, displayId} : t);
        },
        updateTableRows: (state, action: PayloadAction<{tableId: string, rows: any[], contentHash?: string}>) => {
            // Update the rows of a table while preserving all other table properties
            // This is used for refreshing data in original (non-derived) tables
            let tableId = action.payload.tableId;
            let newRows = action.payload.rows;
            let providedContentHash = action.payload.contentHash;
            
            state.tables = state.tables.map(t => {
                if (t.id == tableId) {
                    let newMetadata = { ...t.metadata };
                    for (let name of t.names) {
                        if (newRows.length > 0 && name in newRows[0]) {
                            const colVals = newRows.map(r => r[name]);
                            newMetadata[name] = {
                                ...newMetadata[name],
                                type: refineTemporalType(colVals, inferTypeFromValueArray(colVals)),
                            };
                        }
                    }
                    const updatedSource = t.source ? { ...t.source, lastRefreshed: Date.now() } : undefined;
                    const newContentHash = providedContentHash || computeContentHash(newRows, t.names);
                    const updatedVirtual = { ...t.virtual, rowCount: newRows.length };
                    return { ...t, rows: newRows, metadata: newMetadata, source: updatedSource, contentHash: newContentHash, virtual: updatedVirtual };
                }
                return t;
            });
        },
        updateMultipleTableRows: (state, action: PayloadAction<{tableId: string, rows: any[], contentHash?: string}[]>) => {
            // Batch-update rows for multiple tables in a single state mutation.
            // This avoids N separate dispatches (each creating a new state.tables reference)
            // when refreshing derived tables after a source table changes.
            const updates = new Map(action.payload.map(u => [u.tableId, u]));
            state.tables = state.tables.map(t => {
                const update = updates.get(t.id);
                if (!update) return t;
                const newRows = update.rows;
                const providedContentHash = update.contentHash;
                let newMetadata = { ...t.metadata };
                for (let name of t.names) {
                    if (newRows.length > 0 && name in newRows[0]) {
                        const colVals = newRows.map(r => r[name]);
                        newMetadata[name] = {
                            ...newMetadata[name],
                            type: refineTemporalType(colVals, inferTypeFromValueArray(colVals)),
                        };
                    }
                }
                const updatedSource = t.source ? { ...t.source, lastRefreshed: Date.now() } : undefined;
                const newContentHash = providedContentHash || computeContentHash(newRows, t.names);
                const updatedVirtual = { ...t.virtual, rowCount: newRows.length };
                return { ...t, rows: newRows, metadata: newMetadata, source: updatedSource, contentHash: newContentHash, virtual: updatedVirtual };
            });
        },
        updateTableSource: (state, action: PayloadAction<{tableId: string, source: DataSourceConfig}>) => {
            // Update the source configuration of a table
            let tableId = action.payload.tableId;
            let source = action.payload.source;
            state.tables = state.tables.map(t => t.id == tableId ? {...t, source} : t);
        },
        updateTableSourceRefreshSettings: (state, action: PayloadAction<{tableId: string, autoRefresh: boolean, refreshIntervalSeconds?: number}>) => {
            // Update just the refresh settings of a table's source
            let tableId = action.payload.tableId;
            let autoRefresh = action.payload.autoRefresh;
            let refreshIntervalSeconds = action.payload.refreshIntervalSeconds;
            state.tables = state.tables.map(t => {
                if (t.id == tableId && t.source) {
                    return {
                        ...t,
                        source: {
                            ...t.source,
                            autoRefresh,
                            ...(refreshIntervalSeconds !== undefined ? { refreshIntervalSeconds } : {})
                        }
                    };
                }
                return t;
            });
        },
        extendTableWithNewFields: (state, action: PayloadAction<{tableId: string, columnName: string, values: any[], previousName: string | undefined, parentIDs: string[]}>) => {
            // extend the existing extTable with new columns from the new table
            let newValues = action.payload.values;
            let tableId = action.payload.tableId;
            let columnName = action.payload.columnName;
            let previousName = action.payload.previousName;
            let parentIDs = action.payload.parentIDs;

            // Find the first parent's column name
            let lastParentField = state.conceptShelfItems.find(f => f.id === parentIDs[parentIDs.length - 1]);
            let lastParentName = lastParentField?.name;

            let table = state.tables.find(t => t.id == tableId) as DictTable;

            let newNames = [];
            if (previousName && table.names.indexOf(previousName) != -1) {
                let replacePosition = table.names.indexOf(previousName);
                newNames[replacePosition] = columnName;
            } else {            
                let insertPosition = lastParentName ? table.names.indexOf(lastParentName) : table.names.length - 1;
                newNames = table.names.slice(0, insertPosition + 1).concat(columnName).concat(table.names.slice(insertPosition + 1));
            }

            let newMetadata = structuredClone(table.metadata);
            const inferredColType = refineTemporalType(newValues, inferTypeFromValueArray(newValues));
            for (let name of newNames) {
                newMetadata[name] = {type: inferredColType, semanticType: "", levels: []};
            }

            // Create new rows with the column positioned after the first parent
            let newRows = table.rows.map((row, i) => {
                let newRow: {[key: string]: any} = {};
                for (let key of Object.keys(row)) {
                    newRow[key] = row[key];
                    if (key === lastParentName) {
                        newRow[columnName] = newValues[i];
                    }
                }
                if (!lastParentName) {
                    newRow[columnName] = newValues[i];
                }
                if (previousName) {
                    delete newRow[previousName];
                }
                return newRow;
            });
            
            table.names = newNames;
            table.metadata = newMetadata;
            table.rows = newRows;
        },
        removeDerivedField: (state, action: PayloadAction<{tableId: string, fieldId: string}>) => {
            let tableId = action.payload.tableId;
            let fieldId = action.payload.fieldId;
            let table = state.tables.find(t => t.id == tableId) as DictTable;
            let fieldName = state.conceptShelfItems.find(f => f.id == fieldId)?.name as string;

            let fieldIndex = table.names.indexOf(fieldName);  
            if (fieldIndex != -1) {
                table.names = table.names.slice(0, fieldIndex).concat(table.names.slice(fieldIndex + 1));
                delete table.metadata[fieldName];
                table.rows = table.rows.map(r => {
                    delete r[fieldName];
                    return r;
                });
            }
        },
        createNewChart: (state, action: PayloadAction<{chartType: string, tableId: string}>) => {
            let chartType = action.payload.chartType;
            let tableId = action.payload.tableId || state.tables[0].id;
            let freshChart = generateFreshChart(tableId, chartType, "user") as Chart;
            
            // Auto-populate encodings based on table metadata
            let table = state.tables.find(t => t.id === tableId);
            if (table) {
                const semanticTypes: Record<string, string> = {};
                for (const [fn, meta] of Object.entries(table.metadata)) {
                    if (meta?.semanticType) semanticTypes[fn] = meta.semanticType;
                }
                const suggested = vlRecommendEncodings(chartType, table.rows, semanticTypes);
                for (const [channel, fieldName] of Object.entries(suggested)) {
                    if (freshChart.encodingMap[channel as Channel]?.fieldID == undefined) {
                        const fieldItem = state.conceptShelfItems.find(f => f.name === fieldName && table!.names.includes(f.name));
                        if (fieldItem) freshChart.encodingMap[channel as Channel] = { fieldID: fieldItem.id };
                    }
                }
            }
            
            state.charts = [ freshChart , ...state.charts];
            state.focusedId = { type: 'chart', chartId: freshChart.id };
        },
        addChart: (state, action: PayloadAction<Chart>) => {
            let chart = action.payload;
            state.charts = [chart, ...state.charts];
        },
        addAndFocusChart: (state, action: PayloadAction<Chart>) => {
            let chart = action.payload;
            state.charts = [chart, ...state.charts];
            state.focusedId = { type: 'chart', chartId: chart.id };
        },
        duplicateChart: (state, action: PayloadAction<string>) => {
            let chartId = action.payload;

            let chartCopy = JSON.parse(JSON.stringify(state.charts.find(chart => chart.id == chartId) as Chart)) as Chart;
            chartCopy.id = `chart-${Date.now()- Math.floor(Math.random() * 10000)}`;
            state.charts.push(chartCopy);
            state.focusedId = { type: 'chart', chartId: chartCopy.id };
        },
        deleteChartById: (state, action: PayloadAction<string>) => {
            let chartId = action.payload;
            deleteChartsRoutine(state, [chartId]);
        },
        updateChartType: (state, action: PayloadAction<{chartId: string, chartType: string}>) => {
            let chartId = action.payload.chartId;
            let chartType = action.payload.chartType;

            let chart = collectAllCharts(state).find(c => c.id == chartId);
            if (chart) {
                const template = getChartTemplate(chartType) as ChartTemplate;
                const sourceType = chart.chartType;

                // Get data table + semantic types for recommendation-based adaptation
                let allCharts = collectAllCharts(state);
                let table = getDataTable(chart, state.tables, allCharts, state.conceptShelfItems);
                const semanticTypes: Record<string, string> = {};
                if (table) {
                    for (const [fn, meta] of Object.entries(table.metadata)) {
                        if (meta?.semanticType) semanticTypes[fn] = meta.semanticType;
                    }
                }

                // Extract current encodings as field names
                const filledEncodings: Record<string, string> = {};
                for (const [ch, enc] of Object.entries(chart.encodingMap)) {
                    if (enc.fieldID != null) {
                        const field = state.conceptShelfItems.find(f => f.id === enc.fieldID);
                        if (field) filledEncodings[ch] = field.name;
                    }
                }

                // Adapt encodings: re-recommends with preference for existing fields
                let adapted = vlAdaptChart(sourceType, chartType, filledEncodings, table?.rows, semanticTypes);

                // Fallback: if adaptation returned nothing but we had fields,
                // keep fields in channels that exist in both source and target
                if (Object.keys(adapted).length === 0 && Object.keys(filledEncodings).length > 0) {
                    const targetChannelSet = new Set(template.channels);
                    for (const [ch, fieldName] of Object.entries(filledEncodings)) {
                        if (targetChannelSet.has(ch)) {
                            adapted[ch] = fieldName;
                        }
                    }
                }

                // Build new encoding map from adapted field names
                const newEncodingMap = Object.assign(
                    {}, ...template.channels.map((ch: string) => ({ [ch]: {} as EncodingItem })),
                ) as EncodingMap;
                for (const [ch, fieldName] of Object.entries(adapted)) {
                    const field = state.conceptShelfItems.find(f => f.name === fieldName);
                    if (field) newEncodingMap[ch as Channel] = { fieldID: field.id };
                }
                chart = { ...chart, chartType, encodingMap: newEncodingMap };

                // Intentionally do NOT autofill remaining empty channels via a
                // second recommendation pass: the adapter already returns at
                // most as many fields as the source had, and re-recommending
                // here would (a) re-introduce duplicates (e.g. `metric` already
                // on `y` getting suggested again for `color`) and (b) surprise
                // the user by inflating a 2-encoding chart into a 5-encoding
                // one on type switch.  Empty channels are left for the user.

                // Chart type changed — any active variant was authored against
                // the old structure, so step out of it. The variants stay in
                // the chip strip (marked stale) for the user to revisit.
                chart.activeVariantId = undefined;

                dfSelectors.replaceChart(state, chart);
            }
        },
        
        updateTableRef: (state, action: PayloadAction<{chartId: string, tableRef: string}>) => {
            let chartId = action.payload.chartId;
            let tableRef = action.payload.tableRef;
            state.charts = state.charts.map(chart => {
                if (chart.id == chartId) {
                    return { ...chart, tableRef }
                } else {
                    return chart
                }
            })
        },
        updateChartConfig: (state, action: PayloadAction<{chartId: string, key: string, value: any}>) => {
            let chartId = action.payload.chartId;
            let key = action.payload.key;
            let value = action.payload.value;
            let chart = collectAllCharts(state).find(c => c.id == chartId);
            if (chart) {
                if (!chart.config) {
                    chart.config = {};
                }
                if (value === undefined) {
                    delete chart.config[key];
                } else {
                    chart.config[key] = value;
                }
            }
        },
        updateChartThumbnail: (state, action: PayloadAction<{chartId: string, thumbnail: string}>) => {
            // Write to a dedicated slice (not onto the Chart object) so that
            // thumbnail updates don't invalidate the `charts` array reference
            // — that ref is in the dep list of ChartRenderService's effect,
            // and churning it cancels the in-flight render queue on every
            // tick (see design discussion on tick performance).
            if (!state.chartThumbnails) state.chartThumbnails = {};
            state.chartThumbnails[action.payload.chartId] = action.payload.thumbnail;
        },
        bumpDisplayRowsTick: (state) => {
            state.displayRowsTick = (state.displayRowsTick || 0) + 1;
        },
        updateChartInsight: (state, action: PayloadAction<{chartId: string, insight: ChartInsight}>) => {
            let chart = collectAllCharts(state).find(c => c.id == action.payload.chartId);
            if (chart) {
                chart.insight = action.payload.insight;
            }
        },
        // --- Style variants (see design-docs/28-chart-style-refinement-agent.md) ---
        // Variants are user-authored "skins" of a chart's Vega-Lite spec. They live
        // on Chart, persist with the session, and drive both the focused canvas
        // (VisualizationView) and the thread thumbnail (ChartRenderService) so
        // the preview reflects whichever variant the user has active.
        addStyleVariant: (state, action: PayloadAction<{chartId: string, variant: ChartStyleVariant, activate?: boolean}>) => {
            const { chartId, variant, activate } = action.payload;
            const chart = collectAllCharts(state).find(c => c.id === chartId);
            if (!chart) return;
            if (!chart.styleVariants) chart.styleVariants = [];
            chart.styleVariants.push(variant);
            if (activate !== false) {
                chart.activeVariantId = variant.id;
            }
        },
        setActiveVariant: (state, action: PayloadAction<{chartId: string, variantId: string | undefined}>) => {
            const { chartId, variantId } = action.payload;
            const chart = collectAllCharts(state).find(c => c.id === chartId);
            if (!chart) return;
            chart.activeVariantId = variantId;
        },
        deleteStyleVariant: (state, action: PayloadAction<{chartId: string, variantId: string}>) => {
            const { chartId, variantId } = action.payload;
            const chart = collectAllCharts(state).find(c => c.id === chartId);
            if (!chart || !chart.styleVariants) return;
            chart.styleVariants = chart.styleVariants.filter(v => v.id !== variantId);
            if (chart.activeVariantId === variantId) {
                chart.activeVariantId = undefined;
            }
            if (chart.styleVariants.length === 0) {
                chart.styleVariants = undefined;
            }
        },
        renameStyleVariant: (state, action: PayloadAction<{chartId: string, variantId: string, label: string}>) => {
            const { chartId, variantId, label } = action.payload;
            const chart = collectAllCharts(state).find(c => c.id === chartId);
            const v = chart?.styleVariants?.find(v => v.id === variantId);
            if (v) v.label = label;
        },
        // Replace a variant's spec in place — used by the "refresh stale variant"
        // flow (overlay in VisualizationView). The variant id stays the same so
        // the chip doesn't visibly disappear and re-appear.
        updateStyleVariant: (state, action: PayloadAction<{chartId: string, variantId: string, vlSpec: any, rationale?: string, encodingFingerprint?: string}>) => {
            const { chartId, variantId, vlSpec, rationale, encodingFingerprint } = action.payload;
            const chart = collectAllCharts(state).find(c => c.id === chartId);
            const v = chart?.styleVariants?.find(v => v.id === variantId);
            if (!v) return;
            v.vlSpec = vlSpec;
            if (rationale !== undefined) v.rationale = rationale;
            if (encodingFingerprint !== undefined) v.encodingFingerprint = encodingFingerprint;
        },
        updateChartEncoding: (state, action: PayloadAction<{chartId: string, channel: Channel, encoding: EncodingItem}>) => {
            let chartId = action.payload.chartId;
            let channel = action.payload.channel;
            let encoding = action.payload.encoding;
            let chart = collectAllCharts(state).find(c => c.id == chartId);
            if (chart) {
                chart.encodingMap[channel] = encoding;
                // Auto-revert to default whenever the user edits the encoding so
                // the canvas reflects what they're editing. Existing variants
                // stay in the chip strip (now stale). See
                // design-docs/28-chart-style-refinement-agent.md §4.7.
                if (chart.activeVariantId) chart.activeVariantId = undefined;
            }
        },
        updateChartEncodingProp: (state, action: PayloadAction<{chartId: string, channel: Channel, prop: string, value: any}>) => {
            let chartId = action.payload.chartId;
            let channel = action.payload.channel;
            let prop = action.payload.prop;
            let value = action.payload.value;
            let chart = collectAllCharts(state).find(c => c.id == chartId);
            let table = state.tables.find(t => t.id == chart?.tableRef) as DictTable;
            
            if (chart) {
                //TODO: check this, finding reference and directly update??
                let encoding = chart.encodingMap[channel];
                // Track whether the prop value actually changed so we only
                // invalidate the active variant on real edits. Without this
                // check, no-op dispatches (e.g. EncodingBox's auto-sort
                // useEffect re-firing on chart switch) silently reset
                // chart.activeVariantId back to "default".
                let changed = false;
                if (prop == 'fieldID') {
                    if (encoding.fieldID !== value) changed = true;
                    encoding.fieldID = value;

                    // automatcially fetch the auto-sort order from the field
                    let field = state.conceptShelfItems.find(f => f.id == value);
                    if (table && field && table.metadata[field.name] && table.metadata[field.name].levels && table.metadata[field.name].levels.length > 0) {
                        const nextSortBy = JSON.stringify(table.metadata[field.name].levels);
                        if (encoding.sortBy !== nextSortBy) changed = true;
                        encoding.sortBy = nextSortBy;
                    }
                } else if (prop == 'aggregate') {
                    if (encoding.aggregate !== value) changed = true;
                    encoding.aggregate = value;
                } else if (prop == "sortOrder") {
                    const next = value == "auto" ? undefined : value;
                    if (encoding.sortOrder !== next) changed = true;
                    encoding.sortOrder = next;
                } else if (prop == "sortBy") {
                    const next = value == "auto" ? undefined : value;
                    if (encoding.sortBy !== next) changed = true;
                    encoding.sortBy = next;
                } else if (prop == "scheme") {
                    if (encoding.scheme !== value) changed = true;
                    encoding.scheme = value;
                } else if (prop == "dtype") {
                    if (encoding.dtype !== value) changed = true;
                    encoding.dtype = value;
                }
                // Auto-revert to default when the encoding actually changes
                // (see above). No-op updates must NOT clear the variant.
                if (changed && chart.activeVariantId) chart.activeVariantId = undefined;
            }
        },
        swapChartEncoding: (state, action: PayloadAction<{chartId: string, channel1: Channel, channel2: Channel}>) => {
            let chartId = action.payload.chartId;
            let channel1 = action.payload.channel1;
            let channel2 = action.payload.channel2;

            let chart = collectAllCharts(state).find(c => c.id == chartId);
            if (chart) {
                let enc1 = chart.encodingMap[channel1];
                let enc2 = chart.encodingMap[channel2];

                chart.encodingMap[channel1] = { fieldID: enc2.fieldID, aggregate: enc2.aggregate, sortBy: enc2.sortBy, sortOrder: enc2.sortOrder };
                chart.encodingMap[channel2] = { fieldID: enc1.fieldID, aggregate: enc1.aggregate, sortBy: enc1.sortBy, sortOrder: enc1.sortOrder };
                // Auto-revert to default when the encoding changes (see above).
                if (chart.activeVariantId) chart.activeVariantId = undefined;
            }
        },
        addConceptItems: (state, action: PayloadAction<FieldItem[]>) => {
            state.conceptShelfItems = [...action.payload, ...state.conceptShelfItems];
        },
        updateConceptItems: (state, action: PayloadAction<FieldItem>) => {
            let concept = action.payload;
            let conceptShelfItems = [...state.conceptShelfItems];
            let index = conceptShelfItems.findIndex(field => field.id === concept.id);
            if (index != -1) {
                conceptShelfItems[index] = concept;
            } else {
                conceptShelfItems = [concept, ...conceptShelfItems];
            }
            state.conceptShelfItems = conceptShelfItems;
        },
        deleteConceptItemByID: (state, action: PayloadAction<string>) => {
            let conceptID = action.payload;
            let allCharts = collectAllCharts(state);
            // remove concepts from encoding maps
            state.conceptShelfItems = state.conceptShelfItems.filter(f => f.id != conceptID);
            for (let chart of allCharts)  {
                for (let [channel, encoding] of Object.entries(chart.encodingMap)) {
                    if (encoding.fieldID && conceptID == encoding.fieldID) {
                        // clear the encoding
                        chart.encodingMap[channel as Channel] = { }
                    }
                }
            }
        },
        batchDeleteConceptItemByID: (state, action: PayloadAction<string[]>) => {
            let allCharts = collectAllCharts(state);
            for (let conceptID of action.payload) {
                // remove concepts from encoding maps
                state.conceptShelfItems = state.conceptShelfItems.filter(field => field.id != conceptID);
                for (let chart of allCharts)  {
                    for (let [channel, encoding] of Object.entries(chart.encodingMap)) {
                        if (encoding.fieldID && conceptID == encoding.fieldID) {
                            // clear the encoding
                            chart.encodingMap[channel as Channel] = { }
                        }
                    }
                }
            }
        },
        insertDerivedTables: (state, action: PayloadAction<DictTable>) => {
            // Guard against duplicate IDs (e.g. race conditions or backend name collisions)
            if (state.tables.some(t => t.id === action.payload.id)) return;
            state.tables = [...state.tables, action.payload];
        },
        // ?? Draft node reducers ??????????????????????????????????
        createDraftNode: (state, action: PayloadAction<{ id: string; displayId: string; parentTableId: string; source: string[]; interaction: InteractionEntry[]; chart?: Chart; actionId?: string }>) => {
            const { id, displayId, parentTableId, source, interaction, chart, actionId } = action.payload;
            const draft: DraftNode = {
                kind: 'draft',
                id,
                displayId,
                anchored: false,
                derive: {
                    source,
                    trigger: {
                        tableId: parentTableId,
                        resultTableId: id,
                        chart,
                        interaction,
                    },
                    status: 'running',
                },
                actionId,
            };
            state.draftNodes = [...state.draftNodes, draft];
        },
        appendDraftInteraction: (state, action: PayloadAction<{ draftId: string; entry: InteractionEntry }>) => {
            const draft = state.draftNodes.find(d => d.id === action.payload.draftId);
            if (draft?.derive?.trigger) {
                draft.derive.trigger.interaction = [
                    ...(draft.derive.trigger.interaction || []),
                    action.payload.entry,
                ];
            }
        },
        updateDraftRunningPlan: (state, action: PayloadAction<{ draftId: string; plan: string }>) => {
            const draft = state.draftNodes.find(d => d.id === action.payload.draftId);
            if (draft?.derive) {
                draft.derive.runningPlan = action.payload.plan;
            }
        },
        updateDeriveStatus: (state, action: PayloadAction<{ nodeId: string; status: DeriveStatus }>) => {
            const draft = state.draftNodes.find(d => d.id === action.payload.nodeId);
            if (draft?.derive) {
                draft.derive.status = action.payload.status;
            }
        },
        updateDraftClarification: (state, action: PayloadAction<{ draftId: string; pendingClarification: PendingClarification | null }>) => {
            const draft = state.draftNodes.find(d => d.id === action.payload.draftId);
            if (draft?.derive) {
                draft.derive.pendingClarification = action.payload.pendingClarification;
            }
        },
        promoteDraft: (state, action: PayloadAction<{ draftId: string; rows: any[]; names: string[]; metadata: any; code: string; codeSignature?: string; outputVariable?: string; dialog?: any[]; explanation?: any; virtual: { tableId: string; rowCount: number }; description?: string; source?: DataSourceConfig }>) => {
            const { draftId, rows, names, metadata, code, codeSignature, outputVariable, dialog, explanation, virtual, description, source } = action.payload;
            const draft = state.draftNodes.find(d => d.id === draftId);
            if (!draft) return;
            const table: DictTable = {
                kind: 'table',
                id: draft.id,
                displayId: draft.displayId,
                anchored: draft.anchored,
                derive: {
                    ...draft.derive,
                    status: 'completed' as const,
                    code,
                    codeSignature,
                    outputVariable: outputVariable || 'result_df',
                    dialog: dialog || [],
                    explanation,
                },
                rows,
                names,
                metadata,
                virtual: virtual,
                description: description || '',
                source,
            };
            state.tables = [...state.tables, table];
            state.draftNodes = state.draftNodes.filter(d => d.id !== draftId);
        },
        removeDraftNode: (state, action: PayloadAction<string>) => {
            state.draftNodes = state.draftNodes.filter(d => d.id !== action.payload);
        },
        appendTriggerInteraction: (state, action: PayloadAction<{ tableId: string; entries: InteractionEntry[] }>) => {
            const table = state.tables.find(t => t.id === action.payload.tableId);
            if (table?.derive?.trigger) {
                table.derive.trigger.interaction = [
                    ...(table.derive.trigger.interaction || []),
                    ...action.payload.entries,
                ];
            }
        },
        overrideDerivedTables: (state, action: PayloadAction<DictTable>) => {
            let table = action.payload;
            
            // Clean up old virtual table from workspace since it's being replaced
            let oldTable = state.tables.find(t => t.id == table.id);
            if (oldTable) {
                deleteTablesFromWorkspace([oldTable.virtual.tableId]);
            }
            
            state.tables = [...state.tables.filter(t => t.id != table.id), table];
        },
        deleteDerivedTableById: (state, action: PayloadAction<string>) => {
            // delete a synthesis output based on index
            let tableId = action.payload;
            
            // Clean up virtual table from workspace before removing from state
            let tableToDelete = state.tables.find(t => t.derive && t.id == tableId);
            if (tableToDelete) {
                deleteTablesFromWorkspace([tableToDelete.virtual.tableId]);
            }
            
            state.tables = state.tables.filter(t => !(t.derive && t.id == tableId));
        },
        clearUnReferencedTables: (state) => {
            // remove all tables that are not referred
            let allCharts = collectAllCharts(state);
            let referredTableId = allCharts.map(chart => getDataTable(chart, state.tables, allCharts, state.conceptShelfItems))
                .filter(t => t != undefined).map(t => t.id);
            let tablesToRemove = state.tables.filter(t => t.derive && !referredTableId.some(tableId => tableId == t.id));
            
            // Clean up virtual tables from workspace
            deleteTablesFromWorkspace(tablesToRemove.map(t => t.virtual.tableId));
            
            state.tables = state.tables.filter(t => !tablesToRemove.some(tr => tr.id == t.id));
        },
        clearUnReferencedCustomConcepts: (state) => {
            let fieldNamesFromTables = state.tables.map(t => t.names).flat();
            let fieldIdsReferredByCharts = collectAllCharts(state).map(c => Object.values(c.encodingMap).map(enc => enc.fieldID).filter(fid => fid != undefined) as string[]).flat();

            state.conceptShelfItems = state.conceptShelfItems.filter(field => !(field.source == "custom" 
                && !(fieldNamesFromTables.includes(field.name) || fieldIdsReferredByCharts.includes(field.id))))
        },
        addMessages: (state, action: PayloadAction<Message>) => {
            state.messages = [...state.messages, action.payload];
        },
        setDisplayedMessageIndex: (state, action: PayloadAction<number>) => {
            state.displayedMessageIdx = action.payload
        },
        setFocused: (state, action: PayloadAction<FocusedId>) => {
            const payload = action.payload;
            state.focusedId = payload;

            if (payload?.type === 'chart' && state.viewMode == 'report') {
                state.viewMode = 'editor';
            }
            if (payload?.type === 'report') {
                state.viewMode = 'report';
            }
            // Clear the "unread" mark on a chart as soon as the user focuses it.
            if (payload?.type === 'chart') {
                const focusedChart = state.charts.find(c => c.id === payload.chartId);
                if (focusedChart?.unread) {
                    focusedChart.unread = false;
                }
            }
        },
        setFocusedDataCleanBlockId: (state, action: PayloadAction<{blockId: string, itemId: number} | undefined>) => {
            state.focusedDataCleanBlockId = action.payload;
        },
        changeChartRunningStatus: (state, action: PayloadAction<{chartId: string, status: boolean}>) => {
            if (action.payload.status) {
                state.chartSynthesisInProgress = [...new Set([...state.chartSynthesisInProgress, action.payload.chartId])]
            } else {
                state.chartSynthesisInProgress = state.chartSynthesisInProgress.filter(s => s != action.payload.chartId);
            }
        },
        setIdentity: (state, action: PayloadAction<Identity>) => {
            state.identity = action.payload;
        },
        updateDataLoaderConnectParams: (state, action: PayloadAction<{dataLoaderType: string, params: Record<string, string>}>) => {
            let dataLoaderType = action.payload.dataLoaderType;
            let params = action.payload.params;
            state.dataLoaderConnectParams[dataLoaderType] = params;
        },
        updateDataLoaderConnectParam: (state, action: PayloadAction<{dataLoaderType: string, paramName: string, paramValue: string}>) => {
            let dataLoaderType = action.payload.dataLoaderType;
            if (!state.dataLoaderConnectParams[dataLoaderType]) {
                state.dataLoaderConnectParams[dataLoaderType] = {};
            }
            let paramName = action.payload.paramName;
            let paramValue = action.payload.paramValue;
            state.dataLoaderConnectParams[dataLoaderType][paramName] = paramValue;
        },
        deleteDataLoaderConnectParams: (state, action: PayloadAction<string>) => {
            let dataLoaderType = action.payload;
            delete state.dataLoaderConnectParams[dataLoaderType];
        },
        clearMessages: (state) => {
            state.messages = [];
        },
        // Data cleaning dialog actions
        addDataCleanBlock: (state, action: PayloadAction<DataCleanBlock>) => {
            state.dataCleanBlocks = [...state.dataCleanBlocks, action.payload];
        },
        removeDataCleanBlocks: (state, action: PayloadAction<{blockIds: string[]}>) => {
            state.dataCleanBlocks = state.dataCleanBlocks.filter(block => !action.payload.blockIds.includes(block.id));
        },
        resetDataCleanBlocks: (state) => {
            state.dataCleanBlocks = [];
        },
        updateLastDataCleanBlock: (state, action: PayloadAction<Partial<DataCleanBlock>>) => {
            if (state.dataCleanBlocks.length > 0) {
                const lastIndex = state.dataCleanBlocks.length - 1;
                state.dataCleanBlocks[lastIndex] = { 
                    ...state.dataCleanBlocks[lastIndex], 
                    ...action.payload 
                };
            }
        },
        setCleanInProgress: (state, action: PayloadAction<boolean>) => {
            state.cleanInProgress = action.payload;
        },
        // Conversational data loading chat actions
        addChatMessage: (state, action: PayloadAction<ChatMessage>) => {
            state.dataLoadingChatMessages = [...state.dataLoadingChatMessages, action.payload];
        },
        updateLastChatMessage: (state, action: PayloadAction<Partial<ChatMessage>>) => {
            if (state.dataLoadingChatMessages.length > 0) {
                const lastIndex = state.dataLoadingChatMessages.length - 1;
                state.dataLoadingChatMessages[lastIndex] = {
                    ...state.dataLoadingChatMessages[lastIndex],
                    ...action.payload,
                };
            }
        },
        clearChatMessages: (state) => {
            // Reset is a coherent operation: clear messages, drop the
            // in-progress flag, and bump the reset counter so the chat
            // surface aborts its in-flight stream and discards any
            // pending dispatches from that stream. Doing all three in
            // one reducer avoids interleaving with redux/react render
            // cycles that would otherwise let stale messages slip in.
            state.dataLoadingChatMessages = [];
            state.dataLoadingChatInProgress = false;
            state.dataLoadingChatResetCounter = (state.dataLoadingChatResetCounter ?? 0) + 1;
            // Note: `dataLoadingChatPending` is intentionally left
            // alone. Callers that want "fresh slate + auto-send the
            // new prompt" dispatch `clearChatMessages` followed by
            // `setDataLoadingChatPending` in the same tick — clearing
            // pending here would race with that ordering.
        },
        setDataLoadingChatPending: (
            state,
            action: PayloadAction<{ text: string; images: string[]; attachments: string[] }>,
        ) => {
            state.dataLoadingChatPending = action.payload;
        },
        clearDataLoadingChatPending: (state) => {
            state.dataLoadingChatPending = null;
        },
        confirmTableLoad: (state, action: PayloadAction<{messageId: string, tableName: string}>) => {
            const msg = state.dataLoadingChatMessages.find(m => m.id === action.payload.messageId);
            if (msg?.pendingLoads) {
                const pending = msg.pendingLoads.find(p => p.name === action.payload.tableName);
                if (pending) {
                    pending.confirmed = true;
                }
            }
        },
        markLoadPlanConfirmed: (state, action: PayloadAction<{messageId: string}>) => {
            const msg = state.dataLoadingChatMessages.find(m => m.id === action.payload.messageId);
            if (msg?.loadPlan) {
                msg.loadPlan.candidates.forEach(c => { c.selected = false; });
            }
        },
        setDataLoadingChatInProgress: (state, action: PayloadAction<boolean>) => {
            state.dataLoadingChatInProgress = action.payload;
        },
        /**
         * Request that the Data Agent hand off to a peer agent
         * (Data Loading or Report Gen) seeded with a specific prompt
         * (and optional images). Consumed by `DataFormulator` (for
         * `data_loading` — opens the unified upload dialog on the
         * 'extract' tab) or `SimpleChartRecBox` (for `report_gen`
         * — kicks off the report generator); each clears the
         * request after handling.
         */
        requestAgentHandoff: (state, action: PayloadAction<{ target: 'data_loading' | 'report_gen'; prompt: string; images?: string[] }>) => {
            state.agentHandoffRequest = {
                target: action.payload.target,
                prompt: action.payload.prompt,
                images: action.payload.images,
            };
        },
        clearAgentHandoffRequest: (state) => {
            state.agentHandoffRequest = null;
        },
        // Generated reports actions
        saveGeneratedReport: (state, action: PayloadAction<GeneratedReport>) => {
            const report = action.payload;
            // Check if report with same ID already exists and update it, otherwise add new
            const existingIndex = state.generatedReports.findIndex(r => r.id === report.id);
            if (existingIndex >= 0) {
                state.generatedReports[existingIndex] = report;
            } else {
                state.generatedReports.unshift(report); // Add to beginning of array
            }
            // Redux Persist will handle persistence automatically
        },
        deleteGeneratedReport: (state, action: PayloadAction<string>) => {
            const reportId = action.payload;
            const report = state.generatedReports.find(r => r.id === reportId);
            const wasFocused = state.focusedId?.type === 'report' && state.focusedId.reportId === reportId;

            state.generatedReports = state.generatedReports.filter(r => r.id !== reportId);

            // Fallback focus: trigger table's first chart, or the trigger table itself
            if (wasFocused && report) {
                const triggerTableId = report.triggerTableId;
                if (triggerTableId) {
                    const allCharts = collectAllCharts(state);
                    const tableChart = allCharts.find(c => c.tableRef === triggerTableId && c.source === 'user');
                    if (tableChart) {
                        state.focusedId = { type: 'chart', chartId: tableChart.id };
                    } else {
                        state.focusedId = { type: 'table', tableId: triggerTableId };
                    }
                } else if (state.tables.length > 0) {
                    state.focusedId = { type: 'table', tableId: state.tables[state.tables.length - 1].id };
                } else {
                    state.focusedId = undefined;
                }
                state.viewMode = 'editor';
            }
        },
        updateGeneratedReportContent: (state, action: PayloadAction<{ id: string; content: string; status?: GeneratedReport['status']; title?: string }>) => {
            const { id, content, status, title } = action.payload;
            const report = state.generatedReports.find(r => r.id === id);
            if (report) {
                report.content = content;
                if (title) report.title = title;
                if (status) report.status = status;
                report.updatedAt = Date.now();
            }
        },
        clearGeneratedReports: (state) => {
            state.generatedReports = [];
            // Redux Persist will handle persistence automatically
        }
    },
    extraReducers: (builder) => {
        builder
        .addCase(REHYDRATE, (state: any, action: any) => {
            // On a normal page refresh, redux-persist replays the persisted
            // state directly into the reducer — it does NOT go through our
            // `loadState` action. Any draft that was `running` or
            // `clarifying` when the tab closed will rehydrate in that
            // status, but the SSE stream that was driving it is gone, so
            // the UI gets stuck on a "thinking…" banner with a runaway
            // elapsed-time counter. Mark those drafts as interrupted and
            // clear transient agent flags, mirroring the same cleanup
            // `loadState` performs for session loads.
            const incoming = action.payload;
            if (!incoming) return;
            if (Array.isArray(incoming.draftNodes)) {
                incoming.draftNodes = incoming.draftNodes.map((node: DraftNode) => {
                    if (node.derive?.status === 'running' || node.derive?.status === 'clarifying') {
                        return {
                            ...node,
                            derive: {
                                ...node.derive,
                                status: 'interrupted' as const,
                                runningPlan: undefined,
                                trigger: {
                                    ...node.derive.trigger,
                                    interaction: [
                                        ...(node.derive.trigger.interaction || []),
                                        {
                                            from: 'data-agent' as const,
                                            to: 'user' as const,
                                            role: 'error' as const,
                                            content: 'Interrupted by page refresh. You can retry or delete this step.',
                                            timestamp: Date.now(),
                                        },
                                    ],
                                },
                            },
                        };
                    }
                    return node;
                });
            }
            // Reset other transient in-progress flags that snuck into the
            // persisted blob (chartSynthesisInProgress / chartInsightInProgress
            // are already blacklisted in store.ts).
            incoming.cleanInProgress = false;
            incoming.dataLoadingChatInProgress = false;
            incoming.sessionLoading = false;
            incoming.sessionLoadingLabel = '';
            incoming.messages = [];
            incoming.displayedMessageIdx = -1;
        })
        .addCase(fetchFieldSemanticType.fulfilled, (state, action) => {
            let data = action.payload;
            let tableId = action.meta.arg.id;
            let table = state.tables.find(t => t.id == tableId) as DictTable;

            if (data["result"]?.length > 0) {
                let typeMap = data['result'][0]['fields'];

                for (let name of table.names) {
                    const prev = table.metadata[name] || { type: Type.String, semanticType: "", levels: [] };
                    const sortOrder = typeMap[name]['sort_order'];
                    const hasCuratedLevels = Array.isArray(sortOrder) && sortOrder.length > 0;
                    // Per design-doc 31 precedence: when the agent supplies a
                    // curated sort_order, drop any data-derived levelCounts so
                    // the popover checklist hides the count column.
                    table.metadata[name] = {
                        ...prev,
                        type: typeMap[name]['type'] as Type,
                        semanticType: typeMap[name]['semantic_type'],
                        levels: hasCuratedLevels ? sortOrder : (prev.levels || []),
                        levelCounts: hasCuratedLevels ? undefined : prev.levelCounts,
                        intrinsicDomain: typeMap[name]['intrinsic_domain'] || prev.intrinsicDomain,
                        unit: typeMap[name]['unit'] || prev.unit,
                    };
                }

                if (data["result"][0]["suggested_table_name"]) {
                    // avoid duplicate display ids
                    let existingDisplayIds = state.tables.filter(t => t.id != tableId).map(t => t.displayId);
                    let suffix = "";
                    let displayId = `${data["result"][0]["suggested_table_name"] as string}${suffix}`;
                    let suffixId = 1;
                    while (existingDisplayIds.includes(displayId)) {
                        displayId = `${data["result"][0]["suggested_table_name"] as string}${suffixId}`;
                        suffixId++;
                        suffix = `-${suffixId}`;
                    }
                    table.displayId = displayId;
                }
            }
        })
        .addCase(fetchColumnStats.fulfilled, (state, action) => {
            const { tableId, statistics } = action.payload as {
                tableId: string;
                statistics: Array<{ column: string; statistics: any }>;
            };
            const table = state.tables.find(t => t.id === tableId) as DictTable | undefined;
            if (!table) return;
            for (const entry of statistics) {
                const name = entry?.column;
                if (!name || !(name in table.metadata)) continue;
                const s = entry.statistics || {};
                const prev = table.metadata[name];
                const hasExistingLevels = Array.isArray(prev.levels) && prev.levels.length > 0;
                const incomingLevels = Array.isArray(s.levels) ? s.levels : undefined;
                const incomingCounts = Array.isArray(s.level_counts) ? s.level_counts : undefined;
                table.metadata[name] = {
                    ...prev,
                    distinctCount: typeof s.unique_count === 'number' ? s.unique_count : prev.distinctCount,
                    nullCount: typeof s.null_count === 'number' ? s.null_count : prev.nullCount,
                    // Curated levels win; only fill when empty.
                    levels: hasExistingLevels ? prev.levels : (incomingLevels || []),
                    levelCounts: hasExistingLevels ? prev.levelCounts : incomingCounts,
                };
            }
        })
        .addCase(fetchGlobalModelList.fulfilled, (state, action) => {
            // Populate globalModels so the UI renders every configured model
            // immediately. Server-configured models are trusted by default:
            // they start as "unknown" and are selectable without a connectivity
            // check. Users can click "Test" to verify manually if they want.
            const models: ModelConfig[] = action.payload;
            state.globalModels = models;

            // Reset stale global model statuses on every app start so a previous
            // session's "ok"/"error" doesn't linger. User-added model test
            // results are preserved.
            const globalIds = new Set(models.map(m => m.id));
            state.testedModels = [
                ...models.map(m => ({ id: m.id, status: 'unknown' as const, message: '' })),
                ...state.testedModels.filter(t => !globalIds.has(t.id)),
            ];

            // Auto-select the first global model when nothing is selected.
            if (state.selectedModelId == undefined && models.length > 0) {
                state.selectedModelId = models[0].id;
            }
        })
        .addCase(fetchGlobalModelList.rejected, (state, action) => {
            if (action.error?.name !== 'AbortError') {
                state.messages.push({
                    timestamp: Date.now(), type: 'warning',
                    component: 'model list',
                    value: i18n.t('messages.globalModelListFailed'),
                });
            }
        })
        .addCase(fetchAvailableModels.fulfilled, (state, action) => {
            // Phase 2 (after connectivity checks): update statuses for each model.
            const serverModels: (ModelConfig & { status: string; error: string | null })[] = action.payload;

            // Update globalModels with the full response (may include extra fields).
            state.globalModels = serverModels;

            // Replace global model entries in testedModels with real statuses,
            // preserving user-model test results.
            state.testedModels = [
                ...serverModels.map(m => ({
                    id: m.id,
                    status: (m.status === 'connected' ? 'ok' : 'error') as 'ok' | 'error' | 'testing' | 'unknown',
                    message: m.error ?? '',
                })),
                ...state.testedModels.filter(t => !serverModels.some(m => m.id === t.id)),
            ];

            // Auto-select the first connected global model when nothing is selected.
            if (state.selectedModelId == undefined) {
                const firstConnected = serverModels.find(m => m.status === 'connected');
                if (firstConnected) {
                    state.selectedModelId = firstConnected.id;
                }
            }
        })
        .addCase(fetchAvailableModels.rejected, (state, action) => {
            if (action.error?.name === 'AbortError') {
                return;
            }

            state.testedModels = state.testedModels.map(model =>
                model.status === 'testing'
                    ? { ...model, status: 'unknown' as const, message: '' }
                    : model
            );
            state.messages.push({
                timestamp: Date.now(), type: 'warning',
                component: 'model list',
                value: i18n.t('messages.availableModelsFailed'),
            });
        })
        .addCase(fetchCodeExpl.fulfilled, (state, action) => {
            let codeExplResponse = action.payload;
            let derivedTableId = action.meta.arg.id;
            let derivedTable = state.tables.find(t => t.id == derivedTableId)
            if (derivedTable?.derive) {
                derivedTable.derive.explanation = codeExplResponse;
            }
        })
        .addCase(fetchCodeExpl.rejected, (state, action) => {
            if (action.error?.name !== 'AbortError') {
                state.messages.push({
                    timestamp: Date.now(), type: 'warning',
                    component: 'code explanation',
                    value: 'Failed to generate code explanation',
                });
            }
        })
        .addCase(fetchFieldSemanticType.rejected, (state, action) => {
            if (action.error?.name !== 'AbortError') {
                state.messages.push({
                    timestamp: Date.now(), type: 'warning',
                    component: 'semantic type',
                    value: 'Failed to infer field semantic types',
                });
            }
        })
        .addCase(fetchChartInsight.pending, (state, action) => {
            let chartId = action.meta.arg.chartId;
            if (!state.chartInsightInProgress.includes(chartId)) {
                state.chartInsightInProgress.push(chartId);
            }
        })
        .addCase(fetchChartInsight.fulfilled, (state, action) => {
            let { chartId, insightKey, title, takeaways } = action.payload;
            let chart = collectAllCharts(state).find(c => c.id === chartId);
            if (chart && (title || (takeaways && takeaways.length > 0))) {
                chart.insight = { title, takeaways: takeaways || [], key: insightKey };
            }
            state.chartInsightInProgress = state.chartInsightInProgress.filter(id => id !== chartId);
            console.log("fetched chart insight", action.payload);
        })
        .addCase(fetchChartInsight.rejected, (state, action) => {
            const chartId = action.meta.arg.chartId;
            state.chartInsightInProgress = state.chartInsightInProgress.filter(id => id !== chartId);

            const errorName = action.error?.name;

            if (errorName === 'AbortError') {
                // User cancelled — no feedback needed
                return;
            }

            if (errorName === 'TimeoutError') {
                state.messages.push({
                    timestamp: Date.now(), type: 'warning',
                    component: 'chart insight',
                    value: i18n.t('messages.chartInsightTimedOut', {
                        seconds: state.config.formulateTimeoutSeconds,
                    }),
                });
                return;
            }

            if (errorName === 'ChartImageNotReady') {
                state.messages.push({
                    timestamp: Date.now(), type: 'warning',
                    component: 'chart insight',
                    value: i18n.t('messages.chartInsightImageNotReady'),
                });
                return;
            }

            state.messages.push({
                timestamp: Date.now(), type: 'warning',
                component: 'chart insight',
                value: action.error?.message || i18n.t('messages.chartInsightFailed'),
            });
        })
    },
})

// ??? Memoized granular selectors ?????????????????????????????????????????????
// These avoid re-renders in components that don't care about row data changes.

/** Returns a stable array of table IDs. Only changes when tables are added/removed/reordered. */
export const selectTableIds = createSelector(
    [(state: DataFormulatorState) => state.tables],
    (tables) => tables.map(t => t.id),
    {
        memoizeOptions: {
            resultEqualityCheck: (prev: string[], next: string[]) => {
                if (prev.length !== next.length) return false;
                for (let i = 0; i < prev.length; i++) {
                    if (prev[i] !== next[i]) return false;
                }
                return true;
            }
        }
    }
);

/**
 * Returns a stable "refresh config" fingerprint for auto-refresh timer management.
 * Only changes when a table's autoRefresh/refreshIntervalSeconds/source.type changes,
 * or when tables are added/removed ??NOT when rows are updated.
 */
export const selectRefreshConfigs = createSelector(
    [(state: DataFormulatorState) => state.tables],
    (tables) => tables.map(t => ({
        id: t.id,
        autoRefresh: t.source?.autoRefresh ?? false,
        refreshIntervalSeconds: t.source?.refreshIntervalSeconds,
        sourceType: t.source?.type,
        canRefresh: t.source?.canRefresh ?? false,
        url: t.source?.url,
        hasVirtual: !!t.virtual?.tableId,
        hasDerive: !!t.derive,
    })),
    {
        memoizeOptions: {
            resultEqualityCheck: (prev: any[], next: any[]) => {
                if (prev.length !== next.length) return false;
                for (let i = 0; i < prev.length; i++) {
                    const a = prev[i], b = next[i];
                    if (a.id !== b.id || a.autoRefresh !== b.autoRefresh ||
                        a.refreshIntervalSeconds !== b.refreshIntervalSeconds ||
                        a.sourceType !== b.sourceType || a.canRefresh !== b.canRefresh ||
                        a.url !== b.url || a.hasVirtual !== b.hasVirtual ||
                        a.hasDerive !== b.hasDerive) return false;
                }
                return true;
            }
        }
    }
);

/**
 * Extracts trigger charts from tables. Uses a stable serialization key so the
 * output array only changes when trigger charts are actually added/removed/modified
 * ??not when table rows change.
 */
const selectTriggerCharts = createSelector(
    [(state: DataFormulatorState) => state.tables],
    (tables) => {
        return tables
            .filter(t => t.derive?.trigger?.chart)
            .map(t => t.derive?.trigger?.chart) as Chart[];
    },
    {
        memoizeOptions: {
            // Use a result equality check so row-only changes don't produce a new array
            // if trigger charts themselves haven't changed.
            resultEqualityCheck: (prev: Chart[], next: Chart[]) => {
                if (prev.length !== next.length) return false;
                for (let i = 0; i < prev.length; i++) {
                    if (prev[i] !== next[i]) return false;
                }
                return true;
            }
        }
    }
);

export const dfSelectors = {
    /** All models visible in the UI: global (server-managed) first, then user-added. */
    getAllModels: (state: DataFormulatorState): ModelConfig[] => {
        return [...(state.globalModels ?? []), ...state.models];
    },
    getActiveModel: (state: DataFormulatorState): ModelConfig | undefined => {
        const all = [...(state.globalModels ?? []), ...state.models];
        return all.find(m => m.id == state.selectedModelId) ?? all[0];
    },
    getEffectiveTableId: (state: DataFormulatorState): string | undefined => {
        if (!state.focusedId) return undefined;
        if (state.focusedId.type === 'table') return state.focusedId.tableId;
        // type === 'chart': derive table from the chart's tableRef
        let allCharts = collectAllCharts(state);
        let chart = allCharts.find(c => c.id === (state.focusedId as { type: 'chart'; chartId: string }).chartId);
        return chart?.tableRef;
    },
    getFocusedChartId: (state: DataFormulatorState): string | undefined => {
        return state.focusedId?.type === 'chart' ? state.focusedId.chartId : undefined;
    },
    getActiveBaseTableIds: (state: DataFormulatorState) => {
        let effectiveTableId = dfSelectors.getEffectiveTableId(state);
        let tables = state.tables;
        let focusedTable = tables.find(t => t.id == effectiveTableId);
        let sourceTables = focusedTable?.derive?.source || [focusedTable?.id];
        return sourceTables;
    },
    
    // Memoized chart selector that combines both sources.
    // Decoupled from row-data changes via selectTriggerCharts.
    getAllCharts: createSelector(
        [(state: DataFormulatorState) => state.charts, 
         selectTriggerCharts],
        (userCharts, triggerCharts) => {
            return [...userCharts, ...triggerCharts];
        }
    ),

    /**
     * Subscribe to a single chart's thumbnail without re-rendering whenever
     * any other chart's thumbnail changes. Use as
     *   `useSelector(dfSelectors.getChartThumbnail(chartId))`.
     */
    getChartThumbnail: (chartId: string) =>
        (state: DataFormulatorState): string | undefined =>
            state.chartThumbnails?.[chartId],

    replaceChart: (state: DataFormulatorState, chart: Chart) => {
        if (state.charts.find(c => c.id == chart.id)) {
            // chart is from charts
            state.charts = state.charts.map(c => c.id == chart.id ? chart : c);
        } else {
            // chart is from tables
            let table = state.tables.find(t => t.derive?.trigger?.chart?.id == chart.id) as DictTable;
            if (table.derive?.trigger) {
                table.derive = { ...table.derive, trigger: { ...table.derive?.trigger, chart: chart } };
            }
        }
    },
    // Generated reports selectors
    getAllGeneratedReports: (state: DataFormulatorState) => state.generatedReports,
    getReportById: (state: DataFormulatorState, reportId: string) => 
        state.generatedReports.find(r => r.id === reportId),
}

// derived field: extra all field items from the table
export const getDataFieldItems = (baseTable: DictTable): FieldItem[] => {

    let dataFieldItems = baseTable.names.map((name) => {
        const id = `original--${baseTable.id}--${name}`;
        return { id, name, source: "original", tableRef: baseTable.id } as FieldItem;
    }) || [];

    return dataFieldItems;
}

// Action creators are generated for each case reducer function
export const dfActions = dataFormulatorSlice.actions;
export const dataFormulatorReducer = dataFormulatorSlice.reducer;