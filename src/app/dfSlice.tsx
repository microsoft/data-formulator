// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Channel, Chart, ChartTemplate, EncodingItem, EncodingMap, FieldItem, Trigger } from '../components/ComponentType'
import { enableMapSet } from 'immer';
import { DictTable } from "../components/ComponentType";
import { Message } from '../views/MessageSnackbar';
import { getChartTemplate, getChartChannels } from "../components/ChartTemplates"
import { getDataTable } from '../views/VisualizationView';
import { findBaseFields } from '../views/ViewUtils';
import { adaptChart, getTriggers, getUrls } from './utils';
import { Type } from '../data/types';
import { TableChallenges } from '../views/TableSelectionView';

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

// Define a type for the slice state
export interface DataFormulatorState {

    oaiModels: {endpoint: string, key: string, model: string }[];
    selectedModel: {endpoint: string, model: string}  | undefined;
    testedModels: {endpoint: string, model: string, status: 'ok' | 'error' | 'testing' | 'unknown', message: string}[];

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
    threadDrawerOpen: boolean; // decides whether the thread drawer is open

    chartSynthesisInProgress: string[];

    betaMode: boolean;
}

// Define the initial state using that type
const initialState: DataFormulatorState = {

    oaiModels: [],
    selectedModel: undefined,
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
    threadDrawerOpen: false,

    chartSynthesisInProgress: [],

    betaMode: false,
}

let getUnrefedDerivedTableIds = (state: DataFormulatorState) => {

    // find tables directly referred by charts
    let chartRefedTables = state.charts.map(chart => getDataTable(chart, state.tables, state.charts, state.conceptShelfItems));
    
    // find tables referred via triggers
    let triggerRefedTableIds = chartRefedTables.filter(t => t.derive != undefined).map(t => t.derive?.trigger as Trigger);

    let allRefedTableIds = [...chartRefedTables.map(t => t.id), ...triggerRefedTableIds];

    // TODO: also need to consider concept shelf reference??
    
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
    state.tables = state.tables.filter(t => !unrefedDerivedTableIds.includes(t.id));
    // remove intermediate charts that lead to this table
    state.charts = state.charts.filter(c => !(c.intermediate && unrefedDerivedTableIds.includes(c.intermediate.resultTableId)));
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
                input_data: {name: table.id, rows: table.rows},
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
        console.log(">>> call agent to infer semantic types <<<")
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
  
export const dataFormulatorSlice = createSlice({
    name: 'dataFormulatorSlice',
    initialState: initialState,
    reducers: {
        resetState: (state, action: PayloadAction<undefined>) => {
            //state.table = undefined;
            
            // avoid resetting inputted models
            // state.oaiModels = state.oaiModels.filter((m: any) => m.endpoint != 'default');
            state.selectedModel = state.oaiModels.length > 0 ? state.oaiModels[0] : undefined;
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
            state.threadDrawerOpen = false;

            state.chartSynthesisInProgress = [];

            state.betaMode = false;
        },
        loadState: (state, action: PayloadAction<any>) => {

            let savedState = action.payload;

            state.oaiModels = savedState.oaiModels.filter((m: any) => m.endpoint != 'default');
            state.selectedModel = state.oaiModels.length > 0 ? state.oaiModels[0] : undefined;
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
            state.threadDrawerOpen = false;

            state.chartSynthesisInProgress = [];

            state.betaMode = savedState.betaMode;
        },
        toggleBetaMode: (state, action: PayloadAction<boolean>) => {
            state.betaMode = action.payload;
        },
        selectModel: (state, action: PayloadAction<{model: string, endpoint: string}>) => {
            state.selectedModel = action.payload;
        },
        addModel: (state, action: PayloadAction<{model: string, key: string, endpoint: string}>) => {
            state.oaiModels = [...state.oaiModels, action.payload];
        },
        removeModel: (state, action: PayloadAction<{model: string, endpoint: string}>) => {
            let model = action.payload.model;
            let endpoint = action.payload.endpoint;
            state.oaiModels = state.oaiModels.filter(oaiModel => oaiModel.model != model || oaiModel.endpoint != endpoint );
            state.testedModels = state.testedModels.filter(m => !(m.model == model && m.endpoint == endpoint));
        },
        updateModelStatus: (state, action: PayloadAction<{model: string, endpoint: string, status: 'ok' | 'error' | 'testing' | 'unknown', message: string}>) => {
            let model = action.payload.model;
            let endpoint = action.payload.endpoint;
            let status = action.payload.status;
            let message = action.payload.message;
            
            state.testedModels = [...state.testedModels.filter(t => !(t.model == model && t.endpoint == endpoint)), {model, endpoint, status, message} ]
        },
        addTable: (state, action: PayloadAction<DictTable>) => {
            let table = action.payload;
            state.tables = [...state.tables, table];
            state.conceptShelfItems = [...state.conceptShelfItems, ...getDataFieldItems(table)];
        },
        deleteTable: (state, action: PayloadAction<string>) => {
            let tableId = action.payload;
            state.tables = state.tables.filter(t => t.id != tableId);

            // feels problematic???
            state.conceptShelfItems = state.conceptShelfItems.filter(f => !(f.tableRef == tableId || 
                                                                            findBaseFields(f, state.conceptShelfItems).some(f2 => f2.tableRef == tableId)));
            
            // delete charts that refer to this table and intermediate charts that produce this table
            let chartIdsToDelete = state.charts.filter(c => c.tableRef == tableId).map(c => c.id);
            deleteChartsRoutine(state, chartIdsToDelete);

            // separate this, so that we only delete on tier of table a time
            state.charts = state.charts.filter(c => !(c.intermediate && c.intermediate.resultTableId == tableId));
        },
        addChallenges: (state, action: PayloadAction<{tableId: string, challenges: { text: string; difficulty: 'easy' | 'medium' | 'hard'; }[]}>) => {
            state.activeChallenges = [...state.activeChallenges, action.payload];
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
        updateChartScaleFactor: (state, action: PayloadAction<{chartId: string, scaleFactor: number}>) => {
            let chartId = action.payload.chartId;
            let scaleFactor = action.payload.scaleFactor;

            state.charts = state.charts.map(chart => {
                if (chart.id == chartId) {
                    return { ...chart, scaleFactor: scaleFactor };
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
                } else if (prop == 'bin') {
                    encoding.bin = value;
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

                chart.encodingMap[channel1] = { fieldID: enc2.fieldID, aggregate: enc2.aggregate, bin: enc2.bin, sortBy: enc2.sortBy };
                chart.encodingMap[channel2] = { fieldID: enc1.fieldID, aggregate: enc1.aggregate, bin: enc1.bin, sortBy: enc1.sortBy };
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
                state.conceptShelfItems = state.conceptShelfItems.filter(field => field.id != conceptID);
                for (let chart of state.charts)  {
                    for (let [channel, encoding] of Object.entries(chart.encodingMap)) {
                        if (encoding.fieldID && conceptID == encoding.fieldID) {
                            // clear the encoding
                            chart.encodingMap[channel as Channel] = { bin: false }
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
                                chart.encodingMap[channel as Channel] = { bin: false }
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
            let referredTableId = charts.map(chart => getDataTable(chart, state.tables, charts, state.conceptShelfItems).id);
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
        setThreadDrawerOpen: (state, action: PayloadAction<boolean>) => {
            state.threadDrawerOpen = action.payload;
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
            state.oaiModels = [...defaultModels, ...state.oaiModels.filter(e => !defaultModels.map((m: any) => m.endpoint).includes(e.endpoint))];
            console.log(state.oaiModels)
            
            state.testedModels = [...state.testedModels.filter(t => !(t.endpoint == 'default')), 
                                    ...defaultModels.map((m: any) => {return {endpoint: m.endpoint, model: m.model, status: 'ok'}}) ]

            if (state.selectedModel == undefined && defaultModels.length > 0) {
                state.selectedModel = {
                    model: defaultModels[0].model,
                    endpoint: defaultModels[0].endpoint
                }
            }
            
            console.log("fetched models");
            console.log(action.payload);
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
    },
})

export const dfSelectors = {
    getActiveModel: (state: DataFormulatorState) => {
        return state.oaiModels.find(m => m.endpoint == state.selectedModel?.endpoint && m.model == state.selectedModel.model) || {'endpoint': 'default', model: 'gpt-4o', key: ""}
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