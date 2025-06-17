// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Channel, Chart, ChartTemplate, EncodingItem, EncodingMap, FieldItem, Trigger } from '../components/ComponentType'
import { enableMapSet } from 'immer';
import { DictTable } from "../components/ComponentType";
import { Message } from '../views/MessageSnackbar';
import { getChartTemplate, getChartChannels } from "../components/ChartTemplates"
import { getDataTable } from '../views/VisualizationView';
import { adaptChart, getTriggers, getUrls } from './utils';
import { Type } from '../data/types';
import { TableChallenges } from '../views/TableSelectionView';
import { inferTypeFromValueArray } from '../data/utils';

enableMapSet();

export const generateFreshChart = (tableRef: string, chartType?: string) : Chart => {
    let realChartType = chartType || "?"
    return { 
        id: `chart-${Date.now()- Math.floor(Math.random() * 10000)}`, 
        chartType: realChartType, 
        encodingMap: Object.assign({}, ...getChartChannels(realChartType).map((channel) => ({ [channel]: { channel: channel, bin: false } }))),
        tableRef: tableRef,
        saved: false
    }
}

export interface SSEMessage {
    type: "notification" | "action"; 
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

// Define a type for the slice state
export interface DataFormulatorState {
    sessionId: string | undefined;
    models: ModelConfig[];
    selectedModelId: string | undefined;
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
    activeThreadChartId: string | undefined; // specifying which chartThread is actively viewed

    chartSynthesisInProgress: string[];

    config: {
        formulateTimeoutSeconds: number;
        maxRepairAttempts: number;
        defaultChartWidth: number;
        defaultChartHeight: number;
    }   

    dataLoaderConnectParams: Record<string, Record<string, string>>; // {table_name: {param_name: param_value}}
    
    lastSSEMessage: SSEMessage | undefined; // Store the last received SSE message
}

// Define the initial state using that type
const initialState: DataFormulatorState = {
    sessionId: undefined,
    models: [],
    selectedModelId: undefined,
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
    activeThreadChartId: undefined,

    chartSynthesisInProgress: [],

    config: {
        formulateTimeoutSeconds: 30,
        maxRepairAttempts: 1,
        defaultChartWidth: 300,
        defaultChartHeight: 300,
    },

    dataLoaderConnectParams: {},
    
    lastSSEMessage: undefined,
}

let getUnrefedDerivedTableIds = (state: DataFormulatorState) => {

    // find tables directly referred by charts
    let chartRefedTables = state.charts.map(chart => getDataTable(chart, state.tables, state.charts, state.conceptShelfItems));
    
    // find tables referred via triggers
    let triggerRefedTableIds = chartRefedTables.filter(t => t.derive != undefined).map(t => t.derive?.trigger as Trigger);

    let allRefedTableIds = [...chartRefedTables.map(t => t.id), ...triggerRefedTableIds];

    return state.tables.filter(table => table.derive && !allRefedTableIds.includes(table.id)).map(t => t.id);
} 

let deleteChartsRoutine = (state: DataFormulatorState, chartIds: string[]) => {
    let charts = state.charts.filter(c => !chartIds.includes(c.id));
    let focusedChartId = state.focusedChartId;
    let activeThreadChartId = state.activeThreadChartId;

    if (focusedChartId && chartIds.includes(focusedChartId)) {
        let leafCharts = charts.filter(c => c.intermediate == undefined);
        focusedChartId = leafCharts.length > 0 ? leafCharts[0].id : undefined;
        activeThreadChartId = focusedChartId;

        state.focusedTableId = charts.find(c => c.id == focusedChartId)?.tableRef;
    }
    state.chartSynthesisInProgress = state.chartSynthesisInProgress.filter(s => chartIds.includes(s));

    // update focusedChart and activeThreadChart
    state.charts = charts;
    state.focusedChartId = focusedChartId;
    state.activeThreadChartId = activeThreadChartId;

    let unrefedDerivedTableIds = getUnrefedDerivedTableIds(state);
    let tableIdsToDelete = state.tables.filter(t => !t.anchored && unrefedDerivedTableIds.includes(t.id)).map(t => t.id);
    
    state.tables = state.tables.filter(t => !tableIdsToDelete.includes(t.id));
    // remove intermediate charts that lead to this table
    state.charts = state.charts.filter(c => !(c.intermediate && tableIdsToDelete.includes(c.intermediate.resultTableId)));
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

            state.selectedModelId = state.models.length > 0 ? state.models[0].id : undefined;
            state.testedModels = [];

            state.tables = [];
            state.charts = [];
            state.activeChallenges = [];

            state.conceptShelfItems = [];

            state.messages = [];
            state.displayedMessageIdx = -1;

            state.focusedTableId = undefined;
            state.focusedChartId = undefined;
            state.activeThreadChartId = undefined;

            state.chartSynthesisInProgress = [];

            state.config = initialState.config;
            
            //state.dataLoaderConnectParams = initialState.dataLoaderConnectParams;
        },
        loadState: (state, action: PayloadAction<any>) => {

            let savedState = action.payload;

            state.models = savedState.models;
            state.selectedModelId = savedState.selectedModelId;
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
            state.activeThreadChartId = savedState.activeThreadChartId || undefined;

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
            state.selectedModelId = action.payload;
        },
        addModel: (state, action: PayloadAction<ModelConfig>) => {
            state.models = [...state.models, action.payload];
        },
        removeModel: (state, action: PayloadAction<string>) => {
            state.models = state.models.filter(model => model.id != action.payload);
            if (state.selectedModelId == action.payload) {
                state.selectedModelId = undefined;
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
        loadTable: (state, action: PayloadAction<DictTable>) => {
            let table = action.payload;
            state.tables = [...state.tables, table];
            state.conceptShelfItems = [...state.conceptShelfItems, ...getDataFieldItems(table)];

            state.focusedTableId = table.id;
            state.focusedChartId = undefined;
            state.activeThreadChartId = undefined;  
        },
        deleteTable: (state, action: PayloadAction<string>) => {
            let tableId = action.payload;
            state.tables = state.tables.filter(t => t.id != tableId);

            // feels problematic???
            state.conceptShelfItems = state.conceptShelfItems.filter(f => !(f.tableRef == tableId));
            
            // delete charts that refer to this table and intermediate charts that produce this table
            let chartIdsToDelete = state.charts.filter(c => c.tableRef == tableId).map(c => c.id);
            deleteChartsRoutine(state, chartIdsToDelete);

            // separate this, so that we only delete on tier of table a time
            state.charts = state.charts.filter(c => !(c.intermediate && c.intermediate.resultTableId == tableId));
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
        createNewChart: (state, action: PayloadAction<{chartType?: string, tableId?: string}>) => {
            let chartType = action.payload.chartType;
            let tableId = action.payload.tableId || state.tables[0].id;
            let freshChart = generateFreshChart(tableId, chartType) as Chart;
            state.charts = [ freshChart , ...state.charts];
            state.focusedTableId = tableId;
            state.focusedChartId = freshChart.id;
            state.activeThreadChartId = freshChart.id;
        },
        addChart: (state, action: PayloadAction<Chart>) => {
            let chart = action.payload;
            state.charts = [chart, ...state.charts]
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
            state.charts = state.charts.map(chart => {
                if (chart.id == chartId) {
                    return adaptChart(chart, getChartTemplate(chartType) as ChartTemplate);
                } else {
                    return chart
                }
            })
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
        replaceTable: (state, action: PayloadAction<{chartId: string, table: DictTable}>) => {
            let chartId = action.payload.chartId;
            let chart = state.charts.find(c => c.id == chartId) as Chart;
            let table = action.payload.table;
            let currentTableRef = getDataTable(chart, state.tables, state.charts, state.conceptShelfItems).id;
            state.charts = state.charts.map(c => {
                if (c.id == chartId) {
                    return { ...c, tableRef: table.id }
                } else {
                    return c
                }
            })

            if (!state.charts.some(c => c.id != chartId && getDataTable(c, state.tables, state.charts, state.conceptShelfItems).id == currentTableRef)) {
                state.tables = [...state.tables.filter(t => t.id != currentTableRef), table];
            } else {
                state.tables = [...state.tables, table];
            }
        },
        updateChartEncodingMap: (state, action: PayloadAction<{chartId: string, encodingMap: EncodingMap}>) => {
            let chartId = action.payload.chartId;
            let encodingMap = action.payload.encodingMap;
            state.charts = state.charts.map(c => {
                if (c.id == chartId) {
                    return { ...c, encodingMap: encodingMap }
                } else {
                    return c
                }
            })
        },
        updateChartEncoding: (state, action: PayloadAction<{chartId: string, channel: Channel, encoding: EncodingItem}>) => {
            let chartId = action.payload.chartId;
            let channel = action.payload.channel;
            let encoding = action.payload.encoding;
            let chart = state.charts.find(chart => chart.id == chartId);
            if (chart) {
                //TODO: check this, finding reference and directly update??
                (state.charts.find(chart => chart.id == chartId) as Chart).encodingMap[channel] = encoding;
            }
        },
        updateChartEncodingProp: (state, action: PayloadAction<{chartId: string, channel: Channel, prop: string, value: any}>) => {
            let chartId = action.payload.chartId;
            let channel = action.payload.channel;
            let prop = action.payload.prop;
            let value = action.payload.value;
            let chart = state.charts.find(chart => chart.id == chartId);
            
            if (chart) {
                //TODO: check this, finding reference and directly update??
                let encoding = (state.charts.find(chart => chart.id == chartId) as Chart).encodingMap[channel];
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

            let chart = state.charts.find(chart => chart.id == chartId)
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
            // remove concepts from encoding maps
            if (state.charts.some(chart => chart.saved 
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

                for (let chart of state.charts)  {
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
            for (let conceptID of action.payload) {
                // remove concepts from encoding maps
                if (state.charts.some(chart => chart.saved 
                    && Object.entries(chart.encodingMap).some(([channel, encoding]) => encoding.fieldID && conceptID == encoding.fieldID))) {
                    console.log("cannot delete!")
                } else {
                    state.conceptShelfItems = state.conceptShelfItems.filter(field => field.id != conceptID);
                    for (let chart of state.charts)  {
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
            let charts = state.charts;
            let referredTableId = charts.map(chart => getDataTable(chart, state.tables, state.charts, state.conceptShelfItems).id);
            state.tables = state.tables.filter(t => !(t.derive && !referredTableId.some(tableId => tableId == t.id)));
        },
        clearUnReferencedCustomConcepts: (state) => {
            let fieldNamesFromTables = state.tables.map(t => t.names).flat();
            let fieldIdsReferredByCharts = state.charts.map(c => Object.values(c.encodingMap).map(enc => enc.fieldID).filter(fid => fid != undefined) as string[]).flat();

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

            let chart = state.charts.find(c => c.id == chartId)

            // update activeThread based on focused chart
            if (chart?.intermediate == undefined) {
                state.activeThreadChartId = chartId;
            } else {
                let currentActiveThreadChart = state.charts.find(c => c.id == state.activeThreadChartId);
                let activeThreadChartTable = state.tables.find(t => t.id == currentActiveThreadChart?.tableRef);

                if (activeThreadChartTable) {
                    let triggers = getTriggers(activeThreadChartTable, state.tables);
                    if (triggers.map(tg => tg.tableId).includes(chart?.intermediate?.resultTableId)) {
                        let nextChart =  state.charts.find(c => c.intermediate == undefined && c.tableRef == chart?.intermediate?.resultTableId);
                        if (nextChart) {
                            state.activeThreadChartId = nextChart.id;
                        }
                    }
                }           
            }
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
            state.lastSSEMessage = action.payload;
            if (action.payload.type == "notification") {
                console.log('SSE message stored in Redux:', action.payload);
                state.messages = [...state.messages, {
                    component: "server",
                    type: "info",
                    timestamp: action.payload.timestamp,
                    value: action.payload.text || "Unknown message"
                }];
            } else if (action.payload.type == "action") {
                console.log('SSE message stored in Redux:', action.payload);
                state.messages = [...state.messages, {
                    component: "server",
                    type: "info",
                    timestamp: action.payload.timestamp,
                    value: action.payload.text || "Unknown message"
                }];
            }
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
            }
        })
        .addCase(fetchAvailableModels.fulfilled, (state, action) => {
            let defaultModels = action.payload;

            state.models = [
                ...defaultModels, 
                ...state.models.filter(e => !defaultModels.map((m: ModelConfig) => m.endpoint).includes(e.endpoint))
            ];
            
            state.testedModels = [ 
                ...defaultModels.map((m: ModelConfig) => {return {id: m.id, status: 'ok'}}) ,
                ...state.testedModels.filter(t => !defaultModels.map((m: ModelConfig) => m.id).includes(t.id))
            ]

            if (state.selectedModelId == undefined && defaultModels.length > 0) {
                state.selectedModelId = defaultModels[0].id;
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
        return state.models.find(m => m.id == state.selectedModelId) || state.models[0];
    },
    getActiveBaseTableIds: (state: DataFormulatorState) => {
        let focusedTableId = state.focusedTableId;
        let tables = state.tables;
        let focusedTable = tables.find(t => t.id == focusedTableId);
        let sourceTables = focusedTable?.derive?.source || [focusedTable?.id];
        return sourceTables;
    }
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