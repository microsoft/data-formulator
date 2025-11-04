// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from '../data/types';
import { CHANNEL_LIST } from "../components/ChartTemplates"
import { inferTypeFromValueArray } from '../data/utils';


export interface ConceptTransformation {
    parentIDs: string[],
    description: string,
    code: string
}

export type FieldSource =  "original" | "derived" | "custom";

export interface FieldItem {
    id: string;
    name: string;

    source: FieldSource;
    tableRef: string; // which table it belongs to, it matters when it's an original field or a derived field

    transform?: ConceptTransformation;
    temporary?: true; // the field is temporary, and it will be deleted unless it's saved
}

export const duplicateField = (field: FieldItem) => {
    let newConcept = {
        id: field.id,
        name: field.name,
        source: field.source,
        transform: field.transform,
        tableRef: field.tableRef,
        temporary: field.temporary,
    } as FieldItem;
    return newConcept;
}

export interface Trigger {
    tableId: string, // on which table this action is triggered

    sourceTableIds: string[], // which tables are used in the trigger

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
}

export function createDictTable(
    id: string, rows: any[], 
    derive: {code: string, explanation?: {code: string, concepts: {field: string, explanation: string}[]}, source: string[], dialog: any[], 
             trigger: Trigger} | undefined = undefined,
    virtual: {tableId: string, rowCount: number} | undefined = undefined,
    anchored: boolean = false,
    createdBy: 'user' | 'agent' = 'user', // by default, all tables are created by the user
    attachedMetadata: string = ''
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
        attachedMetadata
    }
}

export type Chart = { 
    id: string, 
    chartType: string, 
    encodingMap: EncodingMap, 
    tableRef: string, 
    saved: boolean,
    source: "user" | "trigger",
    unread: boolean,
}

export let duplicateChart = (chart: Chart) : Chart => {
    return {
        id: `chart-${Date.now()- Math.floor(Math.random() * 10000)}`,
        chartType: chart.chartType,
        encodingMap: JSON.parse(JSON.stringify(chart.encodingMap)) as EncodingMap,
        tableRef: chart.tableRef,
        saved: false,
        source: chart.source,
        unread: false,
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

export type ChartTemplate = {
    chart: string,
    icon: any,
    template: any,
    channels: string[],
    paths: { [key: string]: (string | number)[] | (string | number)[][]; },
    postProcessor?: (vgSpec: any, table: any[]) => any
}

export const AGGR_OP_LIST = ["count", "sum", "average"] as const
//export const MARK_TYPE_LIST = ['circle', 'bar', 'line', 'area', 'point', 'arc'] as const; //'text', 
// export const MARK_TYPE_LIST = ['circle', 'bar', 'line', 'area', 'point', 'rect', 'rule', 'square', 'tick', 'arc', 'geo-us-states', 'geo-point'] as const; //'text', 

export type AggrOp = typeof AGGR_OP_LIST[number];
export type Channel = typeof CHANNEL_LIST[number];


// export const markToChannels = (mark: string) => {
//     let channels = [];
//     if (mark == "rect" || mark == "area") {
//         channels = ["x", "y", "x2", "y2", "color", "column", "row"];
//     } else if ( mark == "geo-point" ) {
//         channels = ["latitude", "longitude", "color",  "opacity", "size", "column", "row"];
//     } else if ( mark == "geo-us-states") {
//         channels = ["id", "color", "opacity", "row", "column"];
//     } else if (mark == "arc") {
//         channels = ["theta", "radius", "color", "column", "row"];
//     } else {
//         channels = ["x", "y", "color", "opacity", "size", "shape", "column", "row"];
//     } 
//     return channels;
// }
