// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAsyncThunk, createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit'
import { Channel, Chart, ChartTemplate, EncodingItem, EncodingMap, FieldItem, Trigger } from '../components/ComponentType'
import { enableMapSet } from 'immer';
import { DictTable } from "../components/ComponentType";
import { Message } from '../views/MessageSnackbar';
import { getChartTemplate, getChartChannels } from "../components/ChartTemplates"
import { getDataTable } from '../views/VisualizationView';
import { adaptChart, getTriggers, getUrls } from './utils';
import { Type } from '../data/types';
import { TableChallenges } from '../views/TableSelectionView';
import { createTableFromFromObjectArray, inferTypeFromValueArray } from '../data/utils';
import { handleSSEMessage } from './SSEActions';

enableMapSet();

export const generateFreshChart = (tableRef: string, chartType: string, source: "user" | "trigger" = "user") : Chart => {
    return { 
        id: `chart-${Date.now()- Math.floor(Math.random() * 10000)}`, 
        chartType: chartType, 
        encodingMap: Object.assign({}, ...getChartChannels(chartType).map((channel) => ({ [channel]: { channel: channel, bin: false } }))),
        tableRef: tableRef,
        saved: false,
        source: source,
    }
}

export interface SSEMessage {
    type: "heartbeat" | "notification" | "action"; 
    text: string;
    data?: Record<string, any>;
    timestamp: number;
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

// Define a type for the slice state
export interface DataFormulatorState {
    sessionId: string | undefined;
    models: ModelConfig[];
    modelSlots: ModelSlots;
    testedModels: {id: string, status: 'ok' | 'error' | 'testing' | 'unknown', message: string}[];

    tables : DictTable[];
    charts: Chart[];
    
    activeChallenges: {tableId: string, challenges: { text: string; difficulty: 'easy' | 'medium' | 'hard'; }[]}[];

    conceptShelfItems: FieldItem[];

    displayPanelSize: number;
    visPaneSize: number;
    conceptShelfPaneSize: number;

    // controls logs and message index
    messages: Message[];
    displayedMessageIdx: number;

    visViewMode: "gallery" | "carousel";

    focusedTableId: string | undefined;
    focusedChartId: string | undefined;

    chartSynthesisInProgress: string[];

    config: {
        formulateTimeoutSeconds: number;
        maxRepairAttempts: number;
        defaultChartWidth: number;
        defaultChartHeight: number;
    }   

    dataLoaderConnectParams: Record<string, Record<string, string>>; // {table_name: {param_name: param_value}}
    
    agentWorkInProgress: {actionId: string, target: 'chart' | 'table', targetId: string, description: string}[];
}

// Define the initial state using that type
const initialState: DataFormulatorState = {
    sessionId: undefined,
    models: [],
    modelSlots: {},
    testedModels: [],

    tables: [],
    charts: [],

    activeChallenges: [],
    
    conceptShelfItems: [],

    //synthesizerRunning: false,
    displayPanelSize: 550,
    visPaneSize: 640,
    conceptShelfPaneSize: 240, // 300 is a good number for derived concept cards

    messages: [],
    displayedMessageIdx: -1,

    visViewMode: "carousel",

    focusedTableId: undefined,
    focusedChartId: undefined,

    chartSynthesisInProgress: [],

    config: {
        formulateTimeoutSeconds: 30,
        maxRepairAttempts: 1,
        defaultChartWidth: 300,
        defaultChartHeight: 300,
    },

    dataLoaderConnectParams: {},
    
    agentWorkInProgress: [],
}

let getUnrefedDerivedTableIds = (state: DataFormulatorState) => {
    // find tables directly referred by charts
    let allCharts = dfSelectors.getAllCharts(state);
    let chartRefedTables = allCharts.map(chart => getDataTable(chart, state.tables, allCharts, state.conceptShelfItems)).map(t => t.id);

    return state.tables.filter(table => table.derive && !chartRefedTables.includes(table.id)).map(t => t.id);
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
                                    .map(t => {return {name: t.id, rows: t.rows}}),
                code: derivedTable.derive?.code,
                model: dfSelectors.getActiveModel(state)
            }),
        };

        // timeout the request after 20 seconds
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 20000)

        let response = await fetch(getUrls().CODE_EXPL_URL, {...message, signal: controller.signal })

        return response.text();
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
            
            // avoid resetting inputted models
            // state.oaiModels = state.oaiModels.filter((m: any) => m.endpoint != 'default');

            // state.modelSlots = {};
            state.testedModels = [];

            state.tables = [];
            state.charts = [];
            state.activeChallenges = [];

            state.conceptShelfItems = [];

            state.messages = [];
            state.displayedMessageIdx = -1;

            state.focusedTableId = undefined;
            state.focusedChartId = undefined;

            state.chartSynthesisInProgress = [];

            state.config = initialState.config;
            
            //state.dataLoaderConnectParams = initialState.dataLoaderConnectParams;
        },
        loadState: (state, action: PayloadAction<any>) => {

            let savedState = action.payload;

            state.models = savedState.models;
            state.modelSlots = savedState.modelSlots || {};
            state.testedModels = []; // models should be tested again

            //state.table = undefined;
            state.tables = savedState.tables || [];
            state.charts = savedState.charts || [];
            
            state.activeChallenges = savedState.activeChallenges || [];

            state.conceptShelfItems = savedState.conceptShelfItems || [];

            state.messages = [];
            state.displayedMessageIdx = -1;

            state.focusedTableId = savedState.focusedTableId || undefined;
            state.focusedChartId = savedState.focusedChartId || undefined;

            state.chartSynthesisInProgress = [];

            state.config = savedState.config;

            state.dataLoaderConnectParams = savedState.dataLoaderConnectParams || {};
        },
        setConfig: (state, action: PayloadAction<{
            formulateTimeoutSeconds: number, maxRepairAttempts: number, 
            defaultChartWidth: number, defaultChartHeight: number}>) => {
            state.config = action.payload;
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
            let freshChart = generateFreshChart(table.id, '?') as Chart;
            state.tables = [...state.tables, table];
            state.charts = [...state.charts, freshChart];
            state.conceptShelfItems = [...state.conceptShelfItems, ...getDataFieldItems(table)];

            state.focusedTableId = table.id;
            state.focusedChartId = freshChart.id;
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
        addChallenges: (state, action: PayloadAction<{tableId: string, challenges: { text: string; difficulty: 'easy' | 'medium' | 'hard'; }[]}>) => {
            state.activeChallenges = [...state.activeChallenges, action.payload];
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
            let newTypes = [];
            if (previousName && table.names.indexOf(previousName) != -1) {
                let replacePosition = table.names.indexOf(previousName);
                newNames[replacePosition] = columnName;
                newTypes[replacePosition] = inferTypeFromValueArray(newValues);
            } else {            
                let insertPosition = lastParentName ? table.names.indexOf(lastParentName) : table.names.length - 1;
                newNames = table.names.slice(0, insertPosition + 1).concat(columnName).concat(table.names.slice(insertPosition + 1));
                newTypes = table.types.slice(0, insertPosition + 1).concat(inferTypeFromValueArray(newValues)).concat(table.types.slice(insertPosition + 1));
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
            table.types = newTypes;
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
                table.types = table.types.slice(0, fieldIndex).concat(table.types.slice(fieldIndex + 1));
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
        },
        addAndFocusChart: (state, action: PayloadAction<Chart>) => {
            let chart = action.payload;
            state.charts = [chart, ...state.charts];
            state.focusedChartId = chart.id;
        },
        duplicateChart: (state, action: PayloadAction<string>) => {
            let chartId = action.payload;

            let chartCopy = JSON.parse(JSON.stringify(state.charts.find(chart => chart.id == chartId) as Chart)) as Chart;
            chartCopy = { ...chartCopy, saved: false }
            chartCopy.id = `chart-${Date.now()- Math.floor(Math.random() * 10000)}`;
            state.charts.push(chartCopy);
            state.focusedChartId = chartCopy.id;
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
            
            if (chart) {
                //TODO: check this, finding reference and directly update??
                let encoding = chart.encodingMap[channel];
                if (prop == 'fieldID') {
                    encoding.fieldID = value;

                    // automatcially fetch the auto-sort order from the field
                    let field = state.conceptShelfItems.find(f => f.id == value);
                    if (field?.levels) {
                        encoding.sortBy = JSON.stringify(field.levels);
                    }
                } else if (prop == 'aggregate') {
                    encoding.aggregate = value;
                } else if (prop == 'stack') {
                    encoding.stack = value;
                } else if (prop == "sortOrder") {
                    encoding.sortOrder = value;
                } else if (prop == "sortBy") {
                    encoding.sortBy = value;
                } else if (prop == "scheme") {
                    encoding.scheme = value;
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

                chart.encodingMap[channel1] = { fieldID: enc2.fieldID, aggregate: enc2.aggregate, sortBy: enc2.sortBy };
                chart.encodingMap[channel2] = { fieldID: enc1.fieldID, aggregate: enc1.aggregate, sortBy: enc1.sortBy };
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
                    table.types = table.types.slice(0, fieldIndex).concat(table.types.slice(fieldIndex + 1));
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
        setVisPaneSize: (state, action: PayloadAction<number>) => {
            state.visPaneSize = action.payload;
        },
        setDisplayPanelSize: (state, action: PayloadAction<number>) => {
            state.displayPanelSize = action.payload;
        },
        setConceptShelfPaneSize: (state, action: PayloadAction<number>) => {
            state.conceptShelfPaneSize = action.payload;
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
        setFocusedChart: (state, action: PayloadAction<string | undefined>) => {
            let chartId = action.payload;
            state.focusedChartId = chartId;
            state.visViewMode = "carousel";
        },
        setVisViewMode: (state, action: PayloadAction<"carousel" | "gallery">) => {
            state.visViewMode = action.payload;
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
        handleSSEMessage: (state, action: PayloadAction<SSEMessage>) => {
            handleSSEMessage(state, action.payload);
        },
        clearMessages: (state) => {
            state.messages = [];
        }
    },
    extraReducers: (builder) => {
        builder
        .addCase(fetchFieldSemanticType.fulfilled, (state, action) => {
            let data = action.payload;
            let tableId = action.meta.arg.id;

            if (data["status"] == "ok" && data["result"].length > 0) {
                let typeMap = data['result'][0]['fields'];
                state.conceptShelfItems = state.conceptShelfItems.map(field => {
                    if (((field.source == "original" && field.tableRef == tableId ) || field.source == "custom") && Object.keys(typeMap).includes(field.name)) {
                        field.semanticType = typeMap[field.name]['semantic_type'];
                        field.type = typeMap[field.name]['type'] as Type;
                        if (typeMap[field.name]['sort_order']) {
                            field.levels = { "values": typeMap[field.name]['sort_order'], "reason": "natural sort order"}
                        }
                        return field;
                    } else {
                        return field;
                    }
                })

                if (data["result"][0]["explorative_questions"] && data["result"][0]["explorative_questions"].length > 0) {
                    let table = state.tables.find(t => t.id == tableId) as DictTable;
                    table.explorativeQuestions = data["result"][0]["explorative_questions"] as string[];
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
            let codeExpl = action.payload;
            let derivedTableId = action.meta.arg.id;
            let derivedTable = state.tables.find(t => t.id == derivedTableId)
            if (derivedTable?.derive) {
                derivedTable.derive.codeExpl = codeExpl;
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
}

// derived field: extra all field items from the table
export const getDataFieldItems = (baseTable: DictTable): FieldItem[] => {
    return baseTable.names.map((name, index) => {
        const id = `original--${baseTable.id}--${name}`;
        const columnValues = baseTable.rows.map((r) => r[name]);
        const type = baseTable.types[index];
        const uniqueValues = Array.from(new Set(columnValues));
        const domain = uniqueValues; //Array.from(columnValues);
        return { id, name, type, source: "original", domain, description: "", tableRef: baseTable.id };
    }) || [];
}

// Action creators are generated for each case reducer function
export const dfActions = dataFormulatorSlice.actions;
export const dataFormulatorReducer = dataFormulatorSlice.reducer;