// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import _, {  } from "lodash";
import { useEffect, useRef } from "react";
import ts from "typescript";
import { ChannelGroups, getChartChannels, getChartTemplate } from "../components/ChartTemplates";
import { Channel, Chart, ChartTemplate, ConceptTransformation, EncodingItem, EncodingMap, FieldItem, Trigger } from "../components/ComponentType";
import { DictTable } from "../components/ComponentType";
import { getDType } from "../data/types";
import * as d3 from 'd3';

export interface AppConfig {
    popupConfig?: PopupConfig;
}

export interface PopupConfig {
    allowPopup?: boolean;
    jsUrl?: string;
}

export const appConfig: AppConfig = {
};

export function assignAppConfig(config: AppConfig) {
    //assign the new config to the appConfig
    Object.assign(appConfig, config);
    console.log('appConfig', appConfig);
}

export function getUrls() {
    return {
        CHECK_AVAILABLE_MODELS: `/api/check-available-models`,
        TEST_MODEL: `/api/test-model`,

        // these functions involves openai models
        DERIVE_CONCEPT_URL: `/api/derive-concept-request`,
        DERIVE_PY_CONCEPT: `/api/derive-py-concept`,

        SORT_DATA_URL: `/api/codex-sort-request`,
        CLEAN_DATA_URL: `/api/clean-data`,
        
        CODE_EXPL_URL: `/api/code-expl`,
        SERVER_PROCESS_DATA_ON_LOAD: `/api/process-data-on-load`,

        DATASET_INFO_URL: `/api/datasets-info`,
        DATASET_REQUEST_PREFIX: `/api/datasets/`,

        VEGA_DATASET_LIST: `/api/vega-datasets`,
        VEGA_DATASET_REQUEST_PREFIX: `/api/vega-dataset/`,

        APP_CONFIG: `/api/app-config`,

        AUTH_INFO_PREFIX: `/api/.auth/`,

        UPLOAD_DB_FILE: `/api/tables/upload-db-file`,
        DOWNLOAD_DB_FILE: `/api/tables/download-db-file`,
        RESET_DB_FILE: `/api/tables/reset-db-file`,

        GET_SESSION_ID: `/api/get-session-id`,
        LIST_TABLES: `/api/tables`,
        TABLE_DATA: `/api/tables/get-table`,
        CREATE_TABLE: `/api/tables/create-table`,
        DELETE_TABLE: `/api/tables/delete-table`,
        ANALYZE_TABLE: `/api/tables/analyze`,
        QUERY_TABLE: `/api/tables/query`,
        SAMPLE_TABLE: `/api/tables/sample-table`,

        DERIVE_DATA: `/api/derive-data`,
        REFINE_DATA: `/api/refine-data`,
    };
}

import * as vm from 'vm-browserify';

export function usePrevious<T>(value: T): T | undefined {
    const ref = useRef<T>();
    useEffect(() => {
        ref.current = value;
    });
    return ref.current;
}

export function runCodeOnInputListsInVM(
            code: string, 
            inputTupleList: any[][], 
            mode: "faster" | "safer") : [any[], any][] {
    // inputList is a list of testInputs, each item can be an arg or a list of args (if the function takes more than one argument)
    "use strict";
    let ioPairs : [any[], any][] = inputTupleList.map(args => [args, undefined]);
    if (mode == "safer") {
        try {
            // slightly safer?
            if (code != "") {
                let jsCode = ts.transpile(code);
                //target = eval(jsCode)(s);
                
                //console.log(`let func = ${code}; func(arg)`)
                let context = { inputTupleList : inputTupleList, outputs: inputTupleList.map(args => undefined) };
                //console.log(`let func = ${jsCode}; let outputs = inputList.map(arg => func(arg));`);
                vm.runInNewContext(`let func = ${jsCode}; outputs = inputTupleList.map(args => func(...args));`, context);
                ioPairs = inputTupleList.map((args, i) => [args, context.outputs[i]]);
                return ioPairs;
            }
        } catch(err) {
            console.warn(err);
        }
    } else if (mode == "faster") {
        try {
            if (code != "") {
                let jsCode = ts.transpile(code);
                let func = eval(jsCode);
                ioPairs = inputTupleList.map(args => {
                    let target = undefined;
                    try {
                        // copy args to ensure correctness of mapping
                        target = func(...structuredClone(args))
                    } catch (err) {
                        console.warn(`execution err ${err}`)
                    }
                    return [args, target]
                });
                return ioPairs;
            }
        } catch (err) {            
            console.warn(err);
        }
    }

    return ioPairs;
}

export function extractFieldsFromEncodingMap(encodingMap: EncodingMap, allFields: FieldItem[]) {
    let aggregateFields: [string | undefined, string][] = []
    let groupByFields: string[] = []
    
    for (const [channel, encoding] of Object.entries(encodingMap)) {
        const field = encoding.fieldID ? _.find(allFields, (f) => f.id === encoding.fieldID) : undefined;
        if (encoding.aggregate) {
            aggregateFields.push([field?.name, encoding.aggregate]);
        } else {
            if (field) {
                groupByFields.push(field.name);
            }
        }
    }

    return { aggregateFields, groupByFields };
}   

export function prepVisTable(table: any[], allFields: FieldItem[], encodingMap: EncodingMap) {
    let { aggregateFields, groupByFields } = extractFieldsFromEncodingMap(encodingMap, allFields);

    console.log("aggregateFields", aggregateFields);
    console.log("groupByFields", groupByFields);

    let processedTable = [...table];

    let result = processedTable;

    if (aggregateFields.length > 0) {
        // Step 2: Group by and aggregate
        const grouped = d3.flatGroup(processedTable, ...groupByFields.map(field => (d: any) => d[field]));
        
        result = grouped.map(row => {
            // Last element is the array of grouped items, rest are group values
            const groupValues = row.slice(0, -1);
            const group = row[row.length - 1];
            
            return {
                // Add group by fields
                ...Object.fromEntries(groupByFields.map((field, i) => [field, groupValues[i]])),
                // Add aggregations
                ...(aggregateFields.some(([_, type]) => type === 'count') 
                    ? { _count: group.length } 
                    : {}),
                ...Object.fromEntries(
                    aggregateFields
                        .filter(([fieldName, aggType]) => aggType !== 'count' && fieldName)
                        .map(([fieldName, aggType]) => {
                            const values = group.map((r: any) => r[fieldName!]);
                            const suffix = `_${aggType}`;
                            const aggFunc = {
                                'sum': d3.sum,
                                'max': d3.max,
                                'min': d3.min,
                                'mean': d3.mean,
                                'median': d3.median,
                                'average': d3.mean,
                                'mode': d3.mode
                            }[aggType] as (values: any[]) => number | undefined;
                            return [fieldName + suffix, aggFunc ? aggFunc(values) : undefined];
                        })
                )
            };
        });
    }

    return result;
}

export const assembleVegaChart = (
    chartType: string, 
    encodingMap: { [key in Channel]: EncodingItem; }, 
    conceptShelfItems: FieldItem[], 
    workingTable: any[],
    maxNominalValues: number = 68,
    aggrPreprocessed: boolean = false // whether the data has been preprocessed for aggregation and binning
) => {

    if (chartType == "Table") {
        return ["Table", undefined];
    }

    let chartTemplate = getChartTemplate(chartType) as ChartTemplate;
    //console.log(chartTemplate);

    let vgObj = structuredClone(chartTemplate.template);

    for (const [channel, encoding] of Object.entries(encodingMap)) {

        let encodingObj: any = {};

        if (channel == "radius") {
            encodingObj["scale"] = {"type": "sqrt", "zero": true};
        }

        const field = encoding.fieldID ? _.find(conceptShelfItems, (f) => f.id === encoding.fieldID) : undefined;
        if (field == undefined && encoding.aggregate == "count" && aggrPreprocessed) {
            encodingObj["field"] = "_count";
            encodingObj["title"] = "Count";
            encodingObj["type"] = "quantitative";
        } 
        
        if (field) {
            console.log("field and channel");
            console.log(`${field.name} ${channel} ${encoding.aggregate}`);

            // create the encoding
            encodingObj["field"] = field.name;
            encodingObj["type"] = getDType(field.type, workingTable.map(r => r[field.name]));
            if (field.semanticType == "Year") {
                if (['color', 'size', 'column', 'row'].includes(channel)) {
                    encodingObj["type"] = "nominal";
                } else {
                    encodingObj["type"] = "temporal";
                }
            }

            if (aggrPreprocessed) {
                if (encoding.aggregate) {
                    console.log("aggregate", encoding.aggregate);
                    if (encoding.aggregate == "count") {
                        encodingObj["field"] = "_count";
                        encodingObj["title"] = "Count"
                        encodingObj["type"] = "quantitative";
                    } else {
                        encodingObj['field'] = `${field.name || ""}_${encoding.aggregate}`;
                        encodingObj["type"] = "quantitative";
                    }
                }
            } else {
                if (encoding.aggregate) {
                    encodingObj["aggregate"] = encoding.aggregate;
                    if (encodingObj["aggregate"] == "count") {
                        encodingObj["title"] = "Count"
                    }
                }
            }
 
            if (encodingObj["type"] == "quantitative" && chartType.includes("Line") && channel == "x") {
                encodingObj["scale"] = { "nice": false }
            }

            if (encodingObj["type"] == "nominal" && channel == 'color') {

                // special case, unify
                let actualDomain = [...new Set(workingTable.map(r => r[field.name]))];
                if (actualDomain.every(v => field.domain.includes(v)) && field.domain.length > actualDomain.length) {

                    let scaleValues = [...new Set(field.domain)].sort();
                    let legendValues = actualDomain.sort();

                    encodingObj["scale"] = {
                        domain: scaleValues,
                    }
                    encodingObj["legend"] = {
                        "values": legendValues,
                    }
                }

                if (actualDomain.length >= 16) {
                    if (encodingObj["legend"] == undefined) {
                        encodingObj["legend"] = {}
                    }
                    encodingObj["legend"]['symbolSize'] = 12;
                    encodingObj["legend"]["labelFontSize"] = 8;
                }

                if ([...new Set(field.domain)].length >= 16) {
                    if (encodingObj["scale"] == undefined) {
                        encodingObj["scale"] = {}
                    }
                    encodingObj["scale"]['scheme'] = "tableau20";
                }
            }
        }
        
        if (encoding.sortBy || encoding.sortOrder) {
            let sortOrder = encoding.sortOrder || "ascending";

            if (encoding.sortBy == undefined || encoding.sortBy == "default") {
                encodingObj["sort"] = sortOrder;
            } else if (encoding.sortBy == 'x' || encoding.sortBy == 'y') {
                encodingObj["sort"] = `${sortOrder == "ascending" ? "" : "-"}${encoding.sortBy}`;
            } else {
                try {
                    let sortedValues = JSON.parse(encoding.sortBy)['values'];
                    encodingObj['sort'] = sortOrder == "ascending" ? sortedValues : sortedValues.reverse();

                    // special hack: ensure stack bar and stacked area charts are ordered correctly
                    if (channel == 'color' && (vgObj['mark'] == 'bar' || vgObj['mark'] == 'area')) {
                        vgObj['encoding']['order'] = {'values': sortedValues};
                    }
                } catch {
                    console.warn(`sort error > ${encoding.sortBy}`)
                }
            }

            // if (encoding.sort == "ascending" || encoding.sort == "descending"
            //     || encoding.sort == "x" || encoding.sort == "y" || encoding.sort == "-x" || encoding.sort == "-y") {
            //     encodingObj["sort"] = encoding.sort;
            // } else {
            //     encodingObj["sort"] = JSON.parse(encoding.sort);
            // }
        }
        if (encoding.stack) {
            encodingObj["stack"] = encoding.stack == "layered" ? null : encoding.stack;
        }

        if (encoding.scheme) {
            if ('scale' in encodingObj) {
                encodingObj["scale"]["scheme"] = encoding.scheme;
            } else {
                encodingObj["scale"] =  {"scheme": encoding.scheme };
            }
        }

        if (Object.keys(encodingObj).length != 0 && chartTemplate.paths[channel]) {
            let pathObj = chartTemplate.paths[channel];
            let paths : (string | number)[][] = []
            if (pathObj.length > 0 && pathObj[0].constructor === Array) {
                // in this case, there are many destinations, we add the encodingObj to all paths
                paths = pathObj as (string | number)[][];
            } else {
                // in this case, there is only one single destination, we will wrap it with [..]
                paths = [pathObj as (string | number)[]]
            }
            // fill the template with encoding objects
            for (let path of paths) {
                let ref = vgObj;
                for (let key of path.slice(0, path.length - 1)) {
                    ref = ref[key]
                }

                // if the template hold is a string, then we only instantiate a string value
                // if the template hold is a dict, then we embed the actual embeding object
                if (typeof ref[path[path.length - 1]] === 'string' || ref[path[path.length - 1]] instanceof String) {
                    ref[path[path.length - 1]] = encodingObj['field'];
                } else {
                    let prebuiltEntries = ref[path[path.length - 1]] != undefined ? Object.entries(ref[path[path.length - 1]]) : []
                    ref[path[path.length - 1]] = Object.fromEntries([...prebuiltEntries, ...Object.entries(encodingObj)]);
                }
                
            }
        }
    }

    if (vgObj.encoding?.column != undefined && vgObj.encoding?.row == undefined) {
        vgObj['encoding']['facet'] = vgObj['encoding']['column'];
        vgObj['encoding']['facet']['columns'] = 6;
        delete vgObj['encoding']['column'];
    }

    // use post processor to handle smart chart instantiation
    if (chartTemplate.postProcessor) {
        vgObj = chartTemplate.postProcessor(vgObj, workingTable);
    }

    // this is the data that will be assembled into the vega chart
    let values = structuredClone(workingTable);
    values = values.map((r: any) => { 
        let keys = Object.keys(r);
        let temporalKeys = keys.filter((k: string) => conceptShelfItems.some(concept => concept.name == k && (concept.type == "date" || concept.semanticType == "Year")));
        for (let temporalKey of temporalKeys) {
            r[temporalKey] = String(r[temporalKey]);
        }
        return r;
    })

    // Handle nominal axes with many entries
    for (const channel of ['x', 'y', 'column', 'row', 'xOffset']) {
        const encoding = vgObj.encoding?.[channel];
        if (encoding?.type === 'nominal') {
            const fieldName = encoding.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];
            
            let valuesToKeep: any[];
            if (uniqueValues.length > maxNominalValues) {

                if (channel == 'x' || channel == 'y') {
                    const oppositeChannel = channel === 'x' ? 'y' : 'x';
                    const oppositeEncoding = vgObj.encoding?.[oppositeChannel];
                    
                    if (oppositeEncoding?.type === 'quantitative') {
                        // Sort by the quantitative field and take top maxNominalValues
                        const quantField = oppositeEncoding.field;
                        valuesToKeep = uniqueValues
                            .map(val => ({
                                value: val,
                                sum: workingTable
                                    .filter(r => r[fieldName] === val)
                                    .reduce((sum, r) => sum + (r[quantField] || 0), 0)
                            }))
                            .sort((a, b) => b.sum - a.sum)
                            .slice(0, maxNominalValues)
                            .map(v => v.value);
                    } else {
                        // If no quantitative axis, just take first maxNominalValues
                        valuesToKeep = uniqueValues.slice(0, maxNominalValues);
                    }
                } else if (channel == 'row') {
                    valuesToKeep = uniqueValues.slice(0, 20);
                } else {
                    valuesToKeep = uniqueValues.slice(0, maxNominalValues);
                }

                // Filter the working table
                const omittedCount = uniqueValues.length - maxNominalValues;
                const placeholder = `...${omittedCount} items omitted`;
                values = values.filter((row: any) => valuesToKeep.includes(row[fieldName]));

                // Add text formatting configuration
                if (!encoding.axis) {
                    encoding.axis = {};
                }
                encoding.axis.labelColor = {
                    condition: {
                        test: `datum.label == '${placeholder}'`,
                        value: "#999999"
                    },
                    value: "#000000" // default color for other labels
                };
                encoding.axis.labelFont = {
                    condition: {
                        test: `datum.label == '${placeholder}'`,
                        value: "italic"
                    },
                    value: "normal" // default font style for other labels
                };

                // Add placeholder to domain
                if (!encoding.scale) {
                    encoding.scale = {};
                }
                encoding.scale.domain = [...valuesToKeep, placeholder]
            }
        }
    }



    return {...vgObj, data: {values: values}}
}

export const adaptChart = (chart: Chart, targetTemplate: ChartTemplate) => {

    let discardedChannels = Object.entries(chart.encodingMap).filter(([ch, enc]) => {
        return !targetTemplate.channels.includes(ch) && enc.fieldID != undefined
    });

    let newEncodingMap = Object.assign({}, ...targetTemplate.channels.map((channel) => {
        let encoding = Object.keys(chart.encodingMap).includes(channel) ? chart.encodingMap[channel as Channel] : { channel: channel, bin: false }
        return { [channel]: encoding }
    })) as EncodingMap

    // for channels that will be discarded, find another way to adapt it
    for (let [ch, enc] of discardedChannels) {
        let otherChannelsFromSameGroup = (Object.entries(ChannelGroups).find(([grp, channelList]) => channelList.includes(ch)) as [string, string[]])[1]
        let candChannels = targetTemplate.channels.filter(c => otherChannelsFromSameGroup.includes(c) && newEncodingMap[c as Channel].fieldID == undefined);
        if (candChannels.length > 0) {
            newEncodingMap[candChannels[0] as Channel] = enc
        }
    }

    if (targetTemplate.chart == "Histogram") {
        newEncodingMap.y = { aggregate: "count" };
    }

    return { ...chart, chartType: targetTemplate.chart, encodingMap: newEncodingMap }
}

// these two functions are used to handle recommendations/corrections from the AI agents

export const resolveChartFields = (chart: Chart, currentConcepts: FieldItem[], refinedGoal: any, table: DictTable) => {
    // resolve and update chart fields based on refined visualization goal

    let targetFieldNames : string[] = refinedGoal['visualization_fields'];
    let targetFieldIds : string[] = targetFieldNames.map(name => currentConcepts.find(c => c.name == name)?.id).filter(fid => fid != undefined) as string[];

    let chartChannels = getChartChannels(chart.chartType);

    let ocupiedChannels = chartChannels.filter(ch => {
        let fieldId = chart.encodingMap[ch as keyof EncodingMap].fieldID;
        return  fieldId != undefined && table.names.includes(currentConcepts.find(c => c.id == fieldId)?.name || "")
    });
    let ocupiedFieldIds = ocupiedChannels.map(ch => chart.encodingMap[ch as keyof EncodingMap].fieldID);

    let newAdditionFieldIds = targetFieldIds.filter(fid => !ocupiedFieldIds.includes(fid))
    let channelsToUpdate = [...chartChannels.filter(ch => !ocupiedChannels.includes(ch))];
    
    
    for (let i = 0; i < Math.max(newAdditionFieldIds.length, channelsToUpdate.length); i ++) {
        chart.encodingMap[channelsToUpdate[i] as keyof EncodingMap].fieldID = newAdditionFieldIds[i];
    }
    
    return chart;
}

export let getTriggers = (leafTable: DictTable, tables: DictTable[]) => {
    // recursively find triggers that ends in leafTable (if the leaf table is anchored, we will find till the previous table is anchored)
    let triggers : Trigger[] = [];
    let t = leafTable;
    while(true) {

        // this is when we find an original table
        if (t.derive == undefined) {
            break;
        }

        // this is when we find an anchored table (which is not the leaf table)
        if (t !== leafTable && t.anchored) {
            break;
        }

        let trigger = t.derive.trigger as Trigger;
        triggers = [trigger, ...triggers];
        let parentTable = tables.find(x => x.id == trigger.tableId);
        if (parentTable) {
            t = parentTable
        } else {
            break
        }
    }
    return triggers;
}

/**
 * Returns a hash code from a string
 * @param  {String} str The string to hash.
 * @return {Number}    A 32bit integer
 * @see http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
 */
export function hashCode(str: string) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}