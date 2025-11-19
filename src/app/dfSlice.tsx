// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAsyncThunk, createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit'
import { Channel, Chart, ChartTemplate, DataCleanBlock, EncodingItem, EncodingMap, FieldItem, Trigger } from '../components/ComponentType'
import { enableMapSet } from 'immer';
import { DictTable } from "../components/ComponentType";
import { Message } from '../views/MessageSnackbar';
import { getChartTemplate, getChartChannels } from "../components/ChartTemplates"
import { getDataTable } from '../views/VisualizationView';
import { adaptChart, getTriggers, getUrls } from './utils';
import { Type } from '../data/types';
import { createTableFromFromObjectArray, inferTypeFromValueArray } from '../data/utils';

enableMapSet();

// Redux Persist will handle persistence automatically with enableMapSet()

export const generateFreshChart = (tableRef: string, chartType: string, source: "user" | "trigger" = "user") : Chart => {
    return { 
        id: `chart-${Date.now()- Math.floor(Math.random() * 10000)}`, 
        chartType: chartType, 
        encodingMap: Object.assign({}, ...getChartChannels(chartType).map((channel) => ({ [channel]: { channel: channel, bin: false } }))),
        tableRef: tableRef,
        saved: false,
        source: source,
        unread: true,
    }
}

export interface SSEMessage {
    type: "heartbeat" | "notification" | "action"; 
    text: string;
    data?: Record<string, any>;
    timestamp: number;
}

// Add interface for app configuration
export interface ServerConfig {
    DISABLE_DISPLAY_KEYS: boolean;
    DISABLE_DATABASE: boolean;
    DISABLE_FILE_UPLOAD: boolean;
    PROJECT_FRONT_PAGE: boolean;
}

export interface ModelConfig {
    id: string; // unique identifier for the model / client combination
    endpoint: string;
    model: string;
    api_key?: string;
    api_base?: string;
    api_version?: string;
}

// Define model slot types
export const MODEL_SLOT_TYPES = ['generation', 'hint'] as const;
export type ModelSlotType = typeof MODEL_SLOT_TYPES[number];

// Derive ModelSlots interface from the constant
export type ModelSlots = Partial<Record<ModelSlotType, string>>;

export interface ClientConfig {
    formulateTimeoutSeconds: number;
    maxRepairAttempts: number;
    defaultChartWidth: number;
    defaultChartHeight: number;
}

export interface GeneratedReport {
    id: string;
    content: string;
    style: string;
    selectedChartIds: string[];
    createdAt: number;
}

export interface DataFormulatorState {

    agentRules: {
        coding: string;
        exploration: string;
    };

    sessionId: string | undefined;
    models: ModelConfig[];
    modelSlots: ModelSlots;
    testedModels: {id: string, status: 'ok' | 'error' | 'testing' | 'unknown', message: string}[];

    tables : DictTable[];
    charts: Chart[];
    
    conceptShelfItems: FieldItem[];

    // controls logs and message index
    messages: Message[];
    displayedMessageIdx: number;

    focusedDataCleanBlockId: {blockId: string, itemId: number} | undefined;

    focusedTableId: string | undefined;
    focusedChartId: string | undefined;

    viewMode: 'editor' | 'report';

    chartSynthesisInProgress: string[];

    serverConfig: ServerConfig;

    config: ClientConfig;

    dataLoaderConnectParams: Record<string, Record<string, string>>; // {table_name: {param_name: param_value}}
    
    // which table is the agent working on
    agentActions: {
        actionId: string, 
        tableId: string, 
        description: string, 
        status: 'running' | 'completed' | 'warning' | 'failed',
        lastUpdate: number, // the time the action is last updated
        hidden: boolean // whether the action is hidden
    }[];

    // Data cleaning dialog state
    dataCleanBlocks: DataCleanBlock[];
    cleanInProgress: boolean;

    // Generated reports state
    generatedReports: GeneratedReport[];
}

// Define the initial state using that type
const initialState: DataFormulatorState = {

    agentRules: {
        coding: "",
        exploration: "",
    },

    sessionId: undefined,
    models: [],
    modelSlots: {},
    testedModels: [],

    tables: [],
    charts: [],

    conceptShelfItems: [],

    messages: [],
    displayedMessageIdx: -1,

    focusedDataCleanBlockId: undefined,
    focusedTableId: undefined,
    focusedChartId: undefined,

    viewMode: 'editor',

    chartSynthesisInProgress: [],

    serverConfig: {
        DISABLE_DISPLAY_KEYS: false,
        DISABLE_DATABASE: true, // disable database by default
        DISABLE_FILE_UPLOAD: false,
        PROJECT_FRONT_PAGE: false,
    },

    config: {
        formulateTimeoutSeconds: 60,
        maxRepairAttempts: 1,
        defaultChartWidth: 300,
        defaultChartHeight: 300,
    },

    dataLoaderConnectParams: {},
    
    agentActions: [],

    dataCleanBlocks: [],
    cleanInProgress: false,

    generatedReports: []
}

let getUnrefedDerivedTableIds = (state: DataFormulatorState) => {
    // find tables directly referred by charts
    let allCharts = dfSelectors.getAllCharts(state);
    let chartRefedTables = allCharts.map(chart => getDataTable(chart, state.tables, allCharts, state.conceptShelfItems)).map(t => t.id);
    let tableWithDescendants = state.tables.filter(table => state.tables.some(t => t.derive?.trigger.tableId == table.id)).map(t => t.id);

    return state.tables.filter(table => table.derive && !tableWithDescendants.includes(table.id) && !chartRefedTables.includes(table.id)).map(t => t.id);
} 

let deleteChartsRoutine = (state: DataFormulatorState, chartIds: string[]) => {
    let charts = state.charts.filter(c => !chartIds.includes(c.id));
    let focusedChartId = state.focusedChartId;

    if (focusedChartId && chartIds.includes(focusedChartId)) {
        let leafCharts = charts;
        focusedChartId = leafCharts.length > 0 ? leafCharts[0].id : undefined;

        state.focusedTableId = charts.find(c => c.id == focusedChartId)?.tableRef;
    }
    state.chartSynthesisInProgress = state.chartSynthesisInProgress.filter(s => !chartIds.includes(s));

    // update focusedChart and activeThreadChart
    state.charts = charts;
    state.focusedChartId = focusedChartId;
    
    // Set unread to false for the newly focused chart
    if (focusedChartId) {
        let chart = charts.find(c => c.id === focusedChartId);
        if (chart) {
            chart.unread = false;
        }
    }

    let unrefedDerivedTableIds = getUnrefedDerivedTableIds(state);
    let tableIdsToDelete = state.tables.filter(t => !t.anchored && unrefedDerivedTableIds.includes(t.id)).map(t => t.id);
   
    state.tables = state.tables.filter(t => !tableIdsToDelete.includes(t.id));
}

export const fetchFieldSemanticType = createAsyncThunk(
    "dataFormulatorSlice/fetchFieldSemanticType",
    async (table: DictTable, { getState }) => {
        console.log(">>> call agent to infer semantic types <<<")

        let state = getState() as DataFormulatorState;

        let message = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({
                token: Date.now(),
                input_data: {name: table.id, rows: table.rows, virtual: table.virtual ? true : false},
                model: dfSelectors.getActiveModel(state)
            }),
        };

        // timeout the request after 20 seconds
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20000)

        let response = await fetch(getUrls().SERVER_PROCESS_DATA_ON_LOAD, {...message, signal: controller.signal })

        return response.json();
    }
);

export const fetchCodeExpl = createAsyncThunk(
    "dataFormulatorSlice/fetchCodeExpl",
    async (derivedTable: DictTable, { getState }) => {
        console.log(">>> call agent to obtain code explanations <<<")

        let state = getState() as DataFormulatorState;

        let message = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({
                token: Date.now(),
                input_tables: derivedTable.derive?.source
                                .map(tId => state.tables.find(t => t.id == tId) as DictTable)
                                .map(t => ({ 
                                    name: t.id, 
                                    rows: t.rows, 
                                    attached_metadata: t.attachedMetadata
                                })),
                code: derivedTable.derive?.code,
                model: dfSelectors.getActiveModel(state)
            }),
        };

        // timeout the request after 20 seconds
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20000)

        let response = await fetch(getUrls().CODE_EXPL_URL, {...message, signal: controller.signal })

        return response.json();
    }
);

export const fetchAvailableModels = createAsyncThunk(
    "dataFormulatorSlice/fetchAvailableModels",
    async () => {
        console.log(">>> call agent to fetch available models <<<")
        let message = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({
                token: Date.now(),
            }),
        };

        // timeout the request after 20 seconds
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20000)

        let response = await fetch(getUrls().CHECK_AVAILABLE_MODELS, {...message, signal: controller.signal })

        return response.json();
    }
);

export const getSessionId = createAsyncThunk(
    "dataFormulatorSlice/getSessionId",
    async (_, { getState }) => {
        let state = getState() as DataFormulatorState;
        let sessionId = state.sessionId;

        const response = await fetch(`${getUrls().GET_SESSION_ID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                session_id: sessionId,
            }),
        });
        return response.json();
    }
);

export const dataFormulatorSlice = createSlice({
    name: 'dataFormulatorSlice',
    initialState: initialState,
    reducers: {
        resetState: (state, action: PayloadAction<undefined>) => {
            //state.table = undefined;
            
            // state.modelSlots = {};
            //state.agentRules = initialState.agentRules;
            //state.config = initialState.config;
            //state.dataLoaderConnectParams = initialState.dataLoaderConnectParams;

            state.testedModels = [];

            state.tables = [];
            state.charts = [];

            state.conceptShelfItems = [];

            state.messages = [];
            state.displayedMessageIdx = -1;

            state.focusedDataCleanBlockId = undefined;

            state.focusedTableId = undefined;
            state.focusedChartId = undefined;

            state.viewMode = 'editor';

            state.chartSynthesisInProgress = [];

            state.serverConfig = initialState.serverConfig;

            state.dataCleanBlocks = [];
            state.cleanInProgress = false;

            state.agentActions = [];

            state.generatedReports = [];
            // Redux Persist will handle persistence automatically
            
        },
        loadState: (state, action: PayloadAction<any>) => {

            let savedState = action.payload;

            // models should not be loaded again, especially they may be from others
            state.agentRules = state.agentRules || initialState.agentRules;
            state.models = state.models || [];
            state.modelSlots = state.modelSlots || {};
            state.testedModels = state.testedModels || [];
            state.dataLoaderConnectParams = state.dataLoaderConnectParams || {};
            state.serverConfig = initialState.serverConfig;

            //state.table = undefined;
            state.tables = savedState.tables || [];
            state.charts = savedState.charts || [];
            
            state.conceptShelfItems = savedState.conceptShelfItems || [];

            state.messages = [];
            state.displayedMessageIdx = -1;

            state.focusedDataCleanBlockId = savedState.focusedDataCleanBlockId || undefined;

            state.focusedTableId = savedState.focusedTableId || undefined;
            state.focusedChartId = savedState.focusedChartId || undefined;

            state.chartSynthesisInProgress = [];

            state.config = savedState.config;

            state.dataCleanBlocks = savedState.dataCleanBlocks || [];
            state.cleanInProgress = false;

            state.agentActions = savedState.agentActions || [];

            state.generatedReports = savedState.generatedReports || [];
        },
        updateAgentWorkInProgress: (state, action: PayloadAction<{actionId: string, tableId?: string, description: string, status: 'running' | 'completed' | 'warning' | 'failed', hidden: boolean}>) => {
            if (state.agentActions.some(a => a.actionId == action.payload.actionId)) {
                state.agentActions = state.agentActions.map(a => a.actionId == action.payload.actionId ? 
                    {...a, ...action.payload, lastUpdate: Date.now()} : a);
            } else {
                state.agentActions = [...state.agentActions, {...action.payload, tableId: action.payload.tableId || "", lastUpdate: Date.now(), hidden: action.payload.hidden}];
            }
        },
        deleteAgentWorkInProgress: (state, action: PayloadAction<string>) => {
            state.agentActions = state.agentActions.filter(a => a.actionId != action.payload);
        },
        setServerConfig: (state, action: PayloadAction<ServerConfig>) => {
            state.serverConfig = action.payload;
        },
        setConfig: (state, action: PayloadAction<ClientConfig>) => {
            state.config = action.payload;
        },
        setViewMode: (state, action: PayloadAction<'editor' | 'report'>) => {
            state.viewMode = action.payload;
        },
        setAgentRules: (state, action: PayloadAction<{coding: string, exploration: string}>) => {
            state.agentRules = action.payload;
        },
        selectModel: (state, action: PayloadAction<string | undefined>) => {
            state.modelSlots = { ...state.modelSlots, generation: action.payload };
        },
        setModelSlot: (state, action: PayloadAction<{slotType: ModelSlotType, modelId: string | undefined}>) => {
            state.modelSlots = { ...state.modelSlots, [action.payload.slotType]: action.payload.modelId };
        },
        setModelSlots: (state, action: PayloadAction<ModelSlots>) => {
            state.modelSlots = action.payload;
        },
        addModel: (state, action: PayloadAction<ModelConfig>) => {
            state.models = [...state.models, action.payload];
        },
        removeModel: (state, action: PayloadAction<string>) => {
            state.models = state.models.filter(model => model.id != action.payload);
            // Remove the model from all slots if it's assigned
            Object.keys(state.modelSlots).forEach(slotType => {
                if (state.modelSlots[slotType as ModelSlotType] === action.payload) {
                    state.modelSlots[slotType as ModelSlotType] = undefined;
                }
            });
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
        loadTable: (state, action: PayloadAction<DictTable>) => {
            let table = action.payload;
            state.tables = [...state.tables, table];
            state.charts = [...state.charts];
            state.conceptShelfItems = [...state.conceptShelfItems, ...getDataFieldItems(table)];

            state.focusedTableId = table.id;
            state.focusedChartId = undefined;
        },
        deleteTable: (state, action: PayloadAction<string>) => {
            let tableId = action.payload;
            state.tables = state.tables.filter(t => t.id != tableId);

            // feels problematic???
            state.conceptShelfItems = state.conceptShelfItems.filter(f => !(f.tableRef == tableId));
            
            // delete charts that refer to this table and intermediate charts that produce this table
            let chartIdsToDelete = state.charts.filter(c => c.tableRef == tableId).map(c => c.id);
            deleteChartsRoutine(state, chartIdsToDelete);
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
        updateTableAttachedMetadata: (state, action: PayloadAction<{tableId: string, attachedMetadata: string}>) => {
            let tableId = action.payload.tableId;
            let attachedMetadata = action.payload.attachedMetadata;
            state.tables = state.tables.map(t => t.id == tableId ? {...t, attachedMetadata} : t);
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
            for (let name of newNames) {
                newMetadata[name] = {type: inferTypeFromValueArray(newValues), semanticType: "", levels: []};
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
            state.charts = [ freshChart , ...state.charts];
            state.focusedTableId = tableId;
            state.focusedChartId = freshChart.id;
            freshChart.unread = false;
        },
        addChart: (state, action: PayloadAction<Chart>) => {
            let chart = action.payload;
            state.charts = [chart, ...state.charts];
        },
        addAndFocusChart: (state, action: PayloadAction<Chart>) => {
            let chart = action.payload;
            state.charts = [chart, ...state.charts];
            state.focusedChartId = chart.id;
            // Set unread to false when focusing the chart
            chart.unread = false;
        },
        duplicateChart: (state, action: PayloadAction<string>) => {
            let chartId = action.payload;

            let chartCopy = JSON.parse(JSON.stringify(state.charts.find(chart => chart.id == chartId) as Chart)) as Chart;
            chartCopy = { ...chartCopy, saved: false, unread: true }
            chartCopy.id = `chart-${Date.now()- Math.floor(Math.random() * 10000)}`;
            state.charts.push(chartCopy);
            state.focusedChartId = chartCopy.id;
            // Set unread to false when focusing the duplicated chart
            chartCopy.unread = false;
        },
        saveUnsaveChart: (state, action: PayloadAction<string>) => {
            let chartId = action.payload;

            state.charts = state.charts.map(chart => {
                if (chart.id == chartId) {
                    return { ...chart, saved: !chart.saved };
                } else {
                    return chart;
                }
            })
        },
        deleteChartById: (state, action: PayloadAction<string>) => {
            let chartId = action.payload;
            deleteChartsRoutine(state, [chartId]);
        },
        updateChartType: (state, action: PayloadAction<{chartId: string, chartType: string}>) => {
            let chartId = action.payload.chartId;
            let chartType = action.payload.chartType;

            let chart = dfSelectors.getAllCharts(state).find(c => c.id == chartId);
            if (chart) {
                chart = adaptChart(chart, getChartTemplate(chartType) as ChartTemplate);
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
        updateChartEncoding: (state, action: PayloadAction<{chartId: string, channel: Channel, encoding: EncodingItem}>) => {
            let chartId = action.payload.chartId;
            let channel = action.payload.channel;
            let encoding = action.payload.encoding;
            let chart = dfSelectors.getAllCharts(state).find(c => c.id == chartId);
            if (chart) {
                chart.encodingMap[channel] = encoding;
            }
        },
        updateChartEncodingProp: (state, action: PayloadAction<{chartId: string, channel: Channel, prop: string, value: any}>) => {
            let chartId = action.payload.chartId;
            let channel = action.payload.channel;
            let prop = action.payload.prop;
            let value = action.payload.value;
            let chart = dfSelectors.getAllCharts(state).find(c => c.id == chartId);
            let table = state.tables.find(t => t.id == chart?.tableRef) as DictTable;
            
            if (chart) {
                //TODO: check this, finding reference and directly update??
                let encoding = chart.encodingMap[channel];
                if (prop == 'fieldID') {
                    encoding.fieldID = value;

                    // automatcially fetch the auto-sort order from the field
                    let field = state.conceptShelfItems.find(f => f.id == value);
                    if (table && field && table.metadata[field.name] && table.metadata[field.name].levels && table.metadata[field.name].levels.length > 0) {
                        encoding.sortBy = JSON.stringify(table.metadata[field.name].levels);
                    }
                } else if (prop == 'aggregate') {
                    encoding.aggregate = value;
                } else if (prop == 'stack') {
                    encoding.stack = value;
                } else if (prop == "sortOrder") {
                    encoding.sortOrder = value == "auto" ? undefined : value;
                } else if (prop == "sortBy") {
                    encoding.sortBy = value == "auto" ? undefined : value;
                } else if (prop == "scheme") {
                    encoding.scheme = value;
                } else if (prop == "dtype") {
                    encoding.dtype = value;
                }
            }
        },
        swapChartEncoding: (state, action: PayloadAction<{chartId: string, channel1: Channel, channel2: Channel}>) => {
            let chartId = action.payload.chartId;
            let channel1 = action.payload.channel1;
            let channel2 = action.payload.channel2;

            let chart = dfSelectors.getAllCharts(state).find(c => c.id == chartId);
            if (chart) {
                let enc1 = chart.encodingMap[channel1];
                let enc2 = chart.encodingMap[channel2];

                chart.encodingMap[channel1] = { fieldID: enc2.fieldID, aggregate: enc2.aggregate, sortBy: enc2.sortBy, sortOrder: enc2.sortOrder };
                chart.encodingMap[channel2] = { fieldID: enc1.fieldID, aggregate: enc1.aggregate, sortBy: enc1.sortBy, sortOrder: enc1.sortOrder };
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
                if (concept.source != "derived") {
                    conceptShelfItems = [concept, ...conceptShelfItems];
                } else {
                    // insert the new concept right after the first parent
                    conceptShelfItems.splice(conceptShelfItems.findIndex(f => f.id == concept.transform?.parentIDs[0]) + 1, 0, concept)
                }
            }
            state.conceptShelfItems = conceptShelfItems;
        },
        deleteConceptItemByID: (state, action: PayloadAction<string>) => {
            let conceptID = action.payload;
            let allCharts = dfSelectors.getAllCharts(state);
            // remove concepts from encoding maps
            if (allCharts.some(chart => chart.saved 
                && Object.entries(chart.encodingMap).some(([channel, encoding]) => encoding.fieldID && conceptID == encoding.fieldID))) {
                console.log("cannot delete!")
            } else {
                let field = state.conceptShelfItems.find(f => f.id == conceptID);
                if (field?.source == "derived") {
                    // delete generated column from the derived table
                    let table = state.tables.find(t => t.id == field.tableRef) as DictTable;
                    let fieldIndex = table.names.indexOf(field.name);
                    table.names = table.names.slice(0, fieldIndex).concat(table.names.slice(fieldIndex + 1));
                    delete table.metadata[field.name];
                    table.rows = table.rows.map(row => {
                        delete row[field.name];
                        return row;
                    });
                }
                state.conceptShelfItems = state.conceptShelfItems.filter(f => f.id != conceptID);

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
        batchDeleteConceptItemByID: (state, action: PayloadAction<string[]>) => {
            let allCharts = dfSelectors.getAllCharts(state);
            for (let conceptID of action.payload) {
                // remove concepts from encoding maps
                if (allCharts.some(chart => chart.saved 
                    && Object.entries(chart.encodingMap).some(([channel, encoding]) => encoding.fieldID && conceptID == encoding.fieldID))) {
                    console.log("cannot delete!")
                } else {
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
            }
        },
        insertDerivedTables: (state, action: PayloadAction<DictTable>) => {
            state.tables = [...state.tables, action.payload];
        },
        overrideDerivedTables: (state, action: PayloadAction<DictTable>) => {
            let table = action.payload;
            state.tables = [...state.tables.filter(t => t.id != table.id), table];
        },
        deleteDerivedTableById: (state, action: PayloadAction<string>) => {
            // delete a synthesis output based on index
            let tableId = action.payload;
            state.tables = state.tables.filter(t => !(t.derive && t.id == tableId));
        },
        clearUnReferencedTables: (state) => {
            // remove all tables that are not referred
            let allCharts = dfSelectors.getAllCharts(state);
            let referredTableId = allCharts.map(chart => getDataTable(chart, state.tables, allCharts, state.conceptShelfItems).id);
            state.tables = state.tables.filter(t => !(t.derive && !referredTableId.some(tableId => tableId == t.id)));
        },
        clearUnReferencedCustomConcepts: (state) => {
            let fieldNamesFromTables = state.tables.map(t => t.names).flat();
            let fieldIdsReferredByCharts = dfSelectors.getAllCharts(state).map(c => Object.values(c.encodingMap).map(enc => enc.fieldID).filter(fid => fid != undefined) as string[]).flat();

            state.conceptShelfItems = state.conceptShelfItems.filter(field => !(field.source == "custom" 
                && !(fieldNamesFromTables.includes(field.name) || fieldIdsReferredByCharts.includes(field.id))))

            // consider cleaning up other fields if 

        },
        addMessages: (state, action: PayloadAction<Message>) => {
            state.messages = [...state.messages, action.payload];
        },
        setDisplayedMessageIndex: (state, action: PayloadAction<number>) => {
            state.displayedMessageIdx = action.payload
        },
        setFocusedTable: (state, action: PayloadAction<string | undefined>) => {
            state.focusedTableId = action.payload;
        },
        setFocusedDataCleanBlockId: (state, action: PayloadAction<{blockId: string, itemId: number} | undefined>) => {
            state.focusedDataCleanBlockId = action.payload;
        },
        setFocusedChart: (state, action: PayloadAction<string | undefined>) => {
            let chartId = action.payload;
            state.focusedChartId = chartId;

            if (state.viewMode == 'report') {
                state.viewMode = 'editor';
            }
            
            // Set unread to false when a chart is focused
            if (chartId) {
                // Find the chart in the charts array
                let chart = state.charts.find(c => c.id === chartId);
                if (chart) {
                    chart.unread = false;
                } else {
                    // Check if it's a trigger chart in tables
                    let table = state.tables.find(t => t.derive?.trigger?.chart?.id === chartId);
                    if (table?.derive?.trigger?.chart) {
                        table.derive.trigger.chart.unread = false;
                    }
                }
            }
        },
        changeChartRunningStatus: (state, action: PayloadAction<{chartId: string, status: boolean}>) => {
            if (action.payload.status) {
                state.chartSynthesisInProgress = [...new Set([...state.chartSynthesisInProgress, action.payload.chartId])]
            } else {
                state.chartSynthesisInProgress = state.chartSynthesisInProgress.filter(s => s != action.payload.chartId);
            }
        },
        setSessionId: (state, action: PayloadAction<string>) => {
            state.sessionId = action.payload;
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
            state.generatedReports = state.generatedReports.filter(r => r.id !== reportId);
            // Redux Persist will handle persistence automatically
        },
        clearGeneratedReports: (state) => {
            state.generatedReports = [];
            // Redux Persist will handle persistence automatically
        }
    },
    extraReducers: (builder) => {
        builder
        .addCase(fetchFieldSemanticType.fulfilled, (state, action) => {
            let data = action.payload;
            let tableId = action.meta.arg.id;
            let table = state.tables.find(t => t.id == tableId) as DictTable;

            if (data["status"] == "ok" && data["result"].length > 0) {
                let typeMap = data['result'][0]['fields'];

                for (let name of table.names) {
                    table.metadata[name] = { 
                        type: typeMap[name]['type'] as Type, 
                        semanticType: typeMap[name]['semantic_type'], 
                        levels: typeMap[name]['sort_order'] || undefined
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
        .addCase(fetchAvailableModels.fulfilled, (state, action) => {
            let defaultModels = action.payload;

            state.models = [
                ...defaultModels, 
                ...state.models.filter(e => !defaultModels.some((m: ModelConfig) => 
                    m.endpoint === e.endpoint && m.model === e.model && 
                    m.api_base === e.api_base && m.api_version === e.api_version
                ))
            ];
            
            state.testedModels = [ 
                ...defaultModels.map((m: ModelConfig) => {return {id: m.id, status: 'ok'}}) ,
                ...state.testedModels.filter(t => !defaultModels.map((m: ModelConfig) => m.id).includes(t.id))
            ]

            if (defaultModels.length > 0) {
                for (const slotType of MODEL_SLOT_TYPES) {
                    if (state.modelSlots[slotType] == undefined) {
                        state.modelSlots[slotType] = defaultModels[0].id;
                    }
                }
            }

            // console.log("load model complete");
            // console.log("state.models", state.models);
        })
        .addCase(fetchCodeExpl.fulfilled, (state, action) => {
            let codeExplResponse = action.payload;
            let derivedTableId = action.meta.arg.id;
            let derivedTable = state.tables.find(t => t.id == derivedTableId)
            if (derivedTable?.derive) {
                // The response is now an object with code and concepts
                derivedTable.derive.explanation = codeExplResponse;
            }
            console.log("fetched codeExpl");
            console.log(action.payload);
        })
        .addCase(getSessionId.fulfilled, (state, action) => {
            console.log("got sessionId ", action.payload.session_id);
            state.sessionId = action.payload.session_id;
        })
    },
})

export const dfSelectors = {
    getActiveModel: (state: DataFormulatorState) : ModelConfig => {
        return state.models.find(m => m.id == state.modelSlots.generation) || state.models[0];
    },
    getModelBySlot: (state: DataFormulatorState, slotType: ModelSlotType) : ModelConfig | undefined => {
        const modelId = state.modelSlots[slotType];
        return modelId ? state.models.find(m => m.id === modelId) : undefined;
    },
    getAllSlotTypes: () : ModelSlotType[] => {
        return [...MODEL_SLOT_TYPES];
    },
    getActiveBaseTableIds: (state: DataFormulatorState) => {
        let focusedTableId = state.focusedTableId;
        let tables = state.tables;
        let focusedTable = tables.find(t => t.id == focusedTableId);
        let sourceTables = focusedTable?.derive?.source || [focusedTable?.id];
        return sourceTables;
    },
    
    // Memoized chart selector that combines both sources
    getAllCharts: createSelector(
        [(state: DataFormulatorState) => state.charts, 
         (state: DataFormulatorState) => state.tables],
        (userCharts, tables) => {
            const triggerCharts = tables
                .filter(t => t.derive?.trigger?.chart)
                .map(t => t.derive?.trigger?.chart) as Chart[];
            return [...userCharts, ...triggerCharts];
        }
    ),

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

    let dataFieldItems = baseTable.names.map((name, index) => {
        const id = `original--${baseTable.id}--${name}`;
        const columnValues = baseTable.rows.map((r) => r[name]);
        const type = baseTable.metadata[name].type;
        const uniqueValues = Array.from(new Set(columnValues));
        return { id, name, type, source: "original", description: "", tableRef: baseTable.id } as FieldItem;
    }) || [];

    return dataFieldItems;
}

// Action creators are generated for each case reducer function
export const dfActions = dataFormulatorSlice.actions;
export const dataFormulatorReducer = dataFormulatorSlice.reducer;