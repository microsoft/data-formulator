import { createTableFromFromObjectArray } from "../data/utils";
import { DataFormulatorState, generateFreshChart, getDataFieldItems, SSEMessage } from "./dfSlice";

import { Channel, Chart, ChartTemplate, EncodingItem, EncodingMap, FieldItem, Trigger } from '../components/ComponentType'


let actionList = [
    {
        type: "create_chart",
        requiredFields: ['chart_type', 'table_ref', 'encodings']
    },
    {
        type: "load_table_from_object",
        requiredFields: ['table_name', 'rows']
    },
    {
        type: "derive_data_in_progress",
        requiredFields: ['action_id', 'source_table_ids', 'instruction', 'fields']
    },
    {
        type: "derive_data_completed",
        requiredFields: ['action_id','derived_table']
    },
    {
        type: "derive_data_failed",
        requiredFields: ['action_id']
    }
]

let checkActionRequiredFields = (message: SSEMessage, state: DataFormulatorState) => {
    let action = actionList.find(a => a.type == message.data?.type);
    if (!action) {
        state.messages = [...state.messages, {
            component: "server",
            type: "error",
            timestamp: message.timestamp,
            value: `Unknown action type: ${message.data?.type}`
        }];
        return false;
    }
    let missingFields = action.requiredFields.filter(field => !message.data?.[field]);
    if (missingFields.length > 0) {
        state.messages = [...state.messages, {
            component: "server",
            type: "error",
            timestamp: message.timestamp,
            value: `[action] ${message.data?.type} - missing required fields: ${missingFields.join(', ')}`,
            detail: JSON.stringify(message.data).slice(0, 1000)
        }];
        return false;
    }
    return true;
}

export const handleSSEMessage = (state: DataFormulatorState, message: SSEMessage) => {

    if (message.type == "heartbeat") {
        return;
    }

    if (message.type == "notification") {
        state.messages = [...state.messages, {
            component: "server",
            type: "info",
            timestamp: message.timestamp,
            value: message.text || "Unknown message" + " (no data provided, no action taken)"
        }];
        return;
    }

    // otherwise, it's an action
    // if it has no data, it's an error
    if (!message.data) {
        state.messages = [...state.messages, {
            component: "server",
            type: "warning",
            timestamp: message.timestamp,
            value: message.text || "Unknown message" + " (no data provided, no action taken)"
        }];
        return;
    }

    let action = message.data;
    let actionStatus : 'ok' | 'error' | 'in_progress' = 'ok';

    if (!checkActionRequiredFields(message, state)) {
        return;
    }

    if (action.type == "create_chart") {
        let chartType = action.chart_type;
        let encodings = action.encodings;
        let tableRef = action.table_ref;

        let chart = generateFreshChart(tableRef, chartType);
        for (let [channel, fieldName] of Object.entries(encodings)) {
            let field = state.conceptShelfItems.find(f => f.name == fieldName);
            if (field) {
                chart.encodingMap[channel as Channel] = { fieldID: field.id };
            } else {
                let newField = { id: `custom--${fieldName}--${Date.now()}`, name: fieldName as string,
                    type: "auto", source: "custom", domain: [], tableRef: 'custom' } as FieldItem;
                state.conceptShelfItems = [newField, ...state.conceptShelfItems];
                chart.encodingMap[channel as Channel] = { fieldID: newField.id };
            }
        }
        state.charts = [...state.charts, chart];
    } else if (action.type == "load_table_from_object") {
        let rows = action.rows;
        let tableName = action.table_name;
        let table = createTableFromFromObjectArray(tableName, rows, false);
        if (state.tables.find(t => t.id == table.id)) {
            table.id = `${tableName}--${Date.now()}`;
        }
        state.tables = [...state.tables, table];
        state.conceptShelfItems = [...state.conceptShelfItems, ...getDataFieldItems(table)];
        state.focusedTableId = table.id;
    } else if (action.type == "derive_data_in_progress") {
        actionStatus = 'in_progress';
        state.agentWorkInProgress = [...state.agentWorkInProgress, {actionId: action.action_id, target: 'table', targetId: action.source_table_ids[0], description: action.instruction}];
    } else if (action.type == "derive_data_completed") {
        let actionId = action.action_id;
        state.tables = [...state.tables, action.derived_table];
        state.agentWorkInProgress = state.agentWorkInProgress.filter(m => m.actionId != actionId);
    } else if (action.type == "derive_data_failed") {
        let actionId = action.action_id;
        actionStatus = 'error';
        state.agentWorkInProgress = state.agentWorkInProgress.filter(m => m.actionId != actionId);
    } else {
        actionStatus = 'error';
    }
    state.messages = [...state.messages, {
        component: "server",
        type: actionStatus == 'ok' ? "success" : actionStatus == 'in_progress' ? "info" : "error",
        timestamp: message.timestamp,
        value: `[action] ${action.type} - ${message.text}`,
        detail: actionStatus == 'error' ? JSON.stringify(action).slice(0, 1000) : undefined
    }];
    
}