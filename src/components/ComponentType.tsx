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
    type: Type;
    source: FieldSource;
    domain: any[];
    transform?: ConceptTransformation;
    tableRef?: string; // which table it comes from, it matters when it's an original field
    temporary?: true;
    levels?: {values: any[], reason: string}; // the order in which values in this field would be sorted
    semanticType?: string; // the semantic type of the object, inferred by the model
}

export const duplicateField = (field: FieldItem) => {
    let newConcept = {
        id: field.id,
        name: field.name,
        type: field.type,
        source: field.source,
        domain: field.domain,
        transform: field.transform,
        tableRef: field.tableRef,
        temporary: field.temporary,
        levels: field.levels,
        semanticType: field.semanticType
    } as FieldItem;
    return newConcept;
}

export interface Trigger {
    tableId: string,

    chartRef?: string, // what's the intented chart from the user when running formulation
    instruction: string

    resultTableId: string,
}

export interface DictTable {
    id: string; // name/id of the table
    names: string[]; // column names
    types: Type[]; // column types
    rows: any[]; // table content, each entry is a row
    derive?: { // how is this table derived
        source: string[], // which tables are this table computed from
        code: string,
        codeExpl: string,
        dialog: any[], // the log of how the data is derived with gpt (the GPT conversation log)
        // tracks how this derivation is triggered, as we as user instruction used to do the formulation,
        // there is a subtle difference between trigger and source, trigger identifies the occasion when the derivision is called,
        // source specifies how the deriviation is done from the source tables, they may be the same, but not necessarily
        // in fact, right now dict tables are all triggered from charts
        trigger: Trigger,
    }
}

export function createDictTable(
    id: string, rows: any[], 
    derive: {code: string, codeExpl: string, source: string[], dialog: any[], 
             trigger: Trigger} | undefined = undefined) : DictTable {
    
    let names = Object.keys(rows[0])

    return {
        id,
        names, 
        rows,
        types: names.map(name => inferTypeFromValueArray(rows.map(r => r[name]))),
        derive,
    }
}

export type Chart = { 
    id: string, 
    chartType: string, 
    encodingMap: EncodingMap, 
    tableRef: string, 
    saved: boolean,
    scaleFactor?: number,
    intermediate?: Trigger // whether this chart is only an intermediate chart (e.g., only used as a spec for transforming tables)
}

export let duplicateChart = (chart: Chart) : Chart => {
    return {
        id: `chart-${Date.now()- Math.floor(Math.random() * 10000)}`,
        chartType: chart.chartType,
        encodingMap: JSON.parse(JSON.stringify(chart.encodingMap)) as EncodingMap,
        tableRef: chart.tableRef,
        saved: false,
        intermediate: undefined
    }
}

// visualization related definitions
export type EncodingMap = { [key in Channel]: EncodingItem; }

export interface EncodingItem {
    //channel: Channel, // the channel ID
    fieldID?: string, // the fieldID
    aggregate?: AggrOp,
    bin: boolean,
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
