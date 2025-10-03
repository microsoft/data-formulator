// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import _, {  } from "lodash";
import { useEffect, useRef } from "react";
import ts from "typescript";
import { ChannelGroups, getChartChannels, getChartTemplate } from "../components/ChartTemplates";
import { Channel, Chart, ChartTemplate, ConceptTransformation, EncodingItem, EncodingMap, FieldItem, Trigger } from "../components/ComponentType";
import { DictTable } from "../components/ComponentType";
import { getDType, Type } from "../data/types";
import * as d3 from 'd3';

export function getUrls() {
    return {
        GET_SESSION_ID: `/api/get-session-id`,
        APP_CONFIG: `/api/app-config`,
        AUTH_INFO_PREFIX: `/api/.auth/`,

        EXAMPLE_DATASETS: `/api/example-datasets`,

        // these functions involves ai agents
        CHECK_AVAILABLE_MODELS: `/api/agent/check-available-models`,
        TEST_MODEL: `/api/agent/test-model`,

        DERIVE_CONCEPT_URL: `/api/agent/derive-concept-request`,
        DERIVE_PY_CONCEPT: `/api/agent/derive-py-concept`,

        SORT_DATA_URL: `/api/agent/sort-data`,
        CLEAN_DATA_URL: `/api/agent/clean-data-stream`,
        
        CODE_EXPL_URL: `/api/agent/code-expl`,
        SERVER_PROCESS_DATA_ON_LOAD: `/api/agent/process-data-on-load`,

        DERIVE_DATA: `/api/agent/derive-data`,
        REFINE_DATA: `/api/agent/refine-data`,
        EXPLORE_DATA_STREAMING: `/api/agent/explore-data-streaming`,

        // these functions involves database
        UPLOAD_DB_FILE: `/api/tables/upload-db-file`,
        DOWNLOAD_DB_FILE: `/api/tables/download-db-file`,
        RESET_DB_FILE: `/api/tables/reset-db-file`,

        LIST_TABLES: `/api/tables/list-tables`,
        TABLE_DATA: `/api/tables/get-table`,
        CREATE_TABLE: `/api/tables/create-table`,
        DELETE_TABLE: `/api/tables/delete-table`,
        GET_COLUMN_STATS: `/api/tables/analyze`,
        SAMPLE_TABLE: `/api/tables/sample-table`,

        DATA_LOADER_LIST_DATA_LOADERS: `/api/tables/data-loader/list-data-loaders`,
        DATA_LOADER_LIST_TABLES: `/api/tables/data-loader/list-tables`,
        DATA_LOADER_INGEST_DATA: `/api/tables/data-loader/ingest-data`,
        DATA_LOADER_VIEW_QUERY_SAMPLE: `/api/tables/data-loader/view-query-sample`,
        DATA_LOADER_INGEST_DATA_FROM_QUERY: `/api/tables/data-loader/ingest-data-from-query`,

        QUERY_COMPLETION: `/api/agent/query-completion`,
        GET_RECOMMENDATION_QUESTIONS: `/api/agent/get-recommendation-questions`,
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

    let processedTable = [...table];

    let result = processedTable;

    if (aggregateFields.length > 0) {
        // Step 2: Group by and aggregate
        let grouped = [];
        if (groupByFields.length > 0) {
            grouped = d3.flatGroup(processedTable, ...groupByFields.map(field => (d: any) => d[field]));
        } else {
            grouped = [["_default", processedTable]];
        }

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
    tableMetadata: {[key: string]: {type: Type, semanticType: string, levels: any[]}},
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
            // create the encoding
            encodingObj["field"] = field.name;
            let fieldMetadata = tableMetadata[field.name];

            if (fieldMetadata != undefined) {
                encodingObj["type"] = getDType(fieldMetadata.type, workingTable.map(r => r[field.name]));
                if (fieldMetadata.semanticType == "Date" || fieldMetadata.semanticType == "DateTime" || fieldMetadata.semanticType == "YearMonth" || fieldMetadata.semanticType == "Year" || fieldMetadata.semanticType == "Decade") {
                    if (['color', 'size', 'column', 'row'].includes(channel)) {
                        encodingObj["type"] = "nominal";
                    } else if (fieldMetadata.type == "string" && (fieldMetadata.semanticType == "Decade" || fieldMetadata.semanticType == "Year")) {
                        encodingObj["type"] = "nominal";
                    } else {
                        encodingObj["type"] = "temporal";
                    }
                }
            } else {
                encodingObj["type"] = 'nominal';
            }

            
            if (encoding.dtype) {
                encodingObj["type"] = encoding.dtype;
            }

            if (aggrPreprocessed) {
                if (encoding.aggregate) {
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

                let actualDomain = [...new Set(workingTable.map(r => r[field.name]))];

                if (actualDomain.length >= 16) {
                    if (encodingObj["legend"] == undefined) {
                        encodingObj["legend"] = {}
                    }
                    encodingObj["legend"]['symbolSize'] = 12;
                    encodingObj["legend"]["labelFontSize"] = 8;
                }
            }
        }

        if (encoding.sortBy || encoding.sortOrder) {
            if (encoding.sortBy == undefined) {
                if (encoding.sortOrder) {
                    encodingObj["sort"] = encoding.sortOrder;
                }
            } else if (encoding.sortBy == 'x' || encoding.sortBy == 'y') {
                encodingObj["sort"] = `${encoding.sortOrder == "ascending" ? "" : "-"}${encoding.sortBy}`;
            } else if (encoding.sortBy == 'color') {
                if (encodingMap.color?.fieldID != undefined) {
                    encodingObj["sort"] = `${encoding.sortOrder == "ascending" ? "" : "-"}${encoding.sortBy}`;
                }
            } else {
                try {
                    if (field) {
                        let fieldMetadata = tableMetadata[field.name];
                        let sortedValues = JSON.parse(encoding.sortBy);

                        // this is to coordinate with the type conversion of temporal fields
                        if (fieldMetadata.type == "date" || fieldMetadata.semanticType == "Year" || fieldMetadata.semanticType == "Decade") {
                            sortedValues = sortedValues.map((v: any) => v.toString());
                        }

                        encodingObj['sort'] = (encoding.sortOrder == "ascending" || encoding.sortOrder == undefined) ? sortedValues : sortedValues.reverse();

                        // special hack: ensure stack bar and stacked area charts are ordered correctly
                        if (channel == 'color' && (vgObj['mark'] == 'bar' || vgObj['mark'] == 'area')) {
                            // this is a very interesting hack, it leverages the hidden derived field name used in compiled Vega script to 
                            // handle order of stack bar and stacked area charts
                            vgObj['encoding']['order'] = {
                                "field": `color_${field?.name}_sort_index`,
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`sort error > ${encoding.sortBy}`)
                }
            }

            // if (encoding.sort == "ascending" || encoding.sort == "descending"
            //     || encoding.sort == "x" || encoding.sort == "y" || encoding.sort == "-x" || encoding.sort == "-y") {
            //     encodingObj["sort"] = encoding.sort;
            // } else {
            //     encodingObj["sort"] = JSON.parse(encoding.sort);
            // }
        } else {
            // Auto-sort: when nominal axis has quantitative opposite axis and no explicit sorting is set
            // prioritize color field if present, otherwise sort by quantitative axis descending
            if ((channel === 'x' && encodingObj.type === 'nominal' && encodingMap.y?.fieldID) ||
                (channel === 'y' && encodingObj.type === 'nominal' && encodingMap.x?.fieldID)) {
                
                if (encodingMap.color?.fieldID) {
                    // If color field exists, sort by color (ascending for nominal, descending for quantitative)
                    const colorField = _.find(conceptShelfItems, (f) => f.id === encodingMap.color.fieldID);
                    if (colorField) {
                        const colorFieldMetadata = tableMetadata[colorField.name];
                        if (colorFieldMetadata) {
                            const colorFieldType = getDType(colorFieldMetadata.type, workingTable.map(r => r[colorField.name]));
                            encodingObj["sort"] = colorFieldType === 'quantitative' ? "-color" : "color";
                        } else {
                            encodingObj["sort"] = "color"; // default to ascending if metadata not available
                        }
                    } else {
                        encodingObj["sort"] = "color"; // default to ascending if field not found
                    }
                } else {
                    // Otherwise, sort by the quantitative axis descending
                    const oppositeChannel = channel === 'x' ? 'y' : 'x';
                    const oppositeField = _.find(conceptShelfItems, (f) => f.id === encodingMap[oppositeChannel]?.fieldID);
                    if (oppositeField) {
                        const oppositeFieldMetadata = tableMetadata[oppositeField.name];
                        if (oppositeFieldMetadata && getDType(oppositeFieldMetadata.type, workingTable.map(r => r[oppositeField.name])) === 'quantitative') {
                            encodingObj["sort"] = `-${oppositeChannel}`;
                        }
                    }
                }
            }
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
        vgObj['resolve'] = {
            "scale": {
                "x": "independent",
            }
        }
        delete vgObj['encoding']['column'];
    }

    // Check if y-axis should have independent scaling when columns have vastly different value ranges
    if (vgObj.encoding?.facet != undefined && vgObj.encoding?.y?.type === 'quantitative') {
        const yField = vgObj.encoding.y.field;
        const columnField = vgObj.encoding.facet.field;
        
        if (yField && columnField) {
            // Group data by column values and find max y value for each column
            const columnGroups = new Map<any, number>();
            
            for (const row of workingTable) {
                const columnValue = row[columnField];
                const yValue = row[yField];
                
                if (yValue != null && !isNaN(yValue)) {
                    const currentMax = columnGroups.get(columnValue) || 0;
                    columnGroups.set(columnValue, Math.max(currentMax, Math.abs(yValue)));
                }
            }
            
            // Find the ratio between max and min column max values
            const maxValues = Array.from(columnGroups.values()).filter(v => v > 0);
            if (maxValues.length >= 2) {
                const maxValue = Math.max(...maxValues);
                const minValue = Math.min(...maxValues);
                const ratio = maxValue / minValue;
                
                // If difference is 100x or more, use independent y-axis scaling
                if (ratio >= 100) {
                    if (!vgObj.resolve) {
                        vgObj.resolve = {};
                    }
                    if (!vgObj.resolve.scale) {
                        vgObj.resolve.scale = {};
                    }
                    vgObj.resolve.scale.y = "independent";
                }
            }
        }
    }

    // use post processor to handle smart chart instantiation
    if (chartTemplate.postProcessor) {
        vgObj = chartTemplate.postProcessor(vgObj, workingTable);
    }

    // this is the data that will be assembled into the vega chart
    let values = structuredClone(workingTable);
    if (values.length > 0) {
        let keys = Object.keys(values[0]);
        let temporalKeys = keys.filter((k: string) => 
            tableMetadata[k] && (tableMetadata[k].type == "date" || tableMetadata[k].semanticType == "Year" || tableMetadata[k].semanticType == "Decade"));
        if (temporalKeys.length > 0) {
            values = values.map((r: any) => { 
                for (let temporalKey of temporalKeys) {
                    r[temporalKey] = String(r[temporalKey]);
                }
                return r;
            })
        }
    }

    // Handle nominal axes with many entries
    for (const channel of ['x', 'y', 'column', 'row', 'xOffset']) {
        const encoding = vgObj.encoding?.[channel];
        if (encoding?.type === 'nominal') {
            const fieldName = encoding.field;
            const uniqueValues = [...new Set(values.map((r: any) => r[fieldName]))];

            let fieldMetadata = tableMetadata[fieldName];
            
            const fieldOriginalType = fieldMetadata ? getDType(fieldMetadata.type, workingTable.map(r => r[fieldName])) : 'nominal';
            
            let valuesToKeep: any[];
            if (uniqueValues.length > maxNominalValues) {

                if (fieldOriginalType == 'quantitative') {
                    valuesToKeep = uniqueValues.sort((a, b) => a - b).slice(0, maxNominalValues);
                } else if (channel == 'x' || channel == 'y') {
                    const oppositeChannel = channel === 'x' ? 'y' : 'x';
                    const oppositeEncoding = vgObj.encoding?.[oppositeChannel];
                    const colorEncoding = vgObj.encoding?.color;

                    // Check if this axis already has a sort configuration
                    if (encoding.sort) {
                        // If sort is set to -y, -x, -color, x, y, or color, respect that ordering
                        if (typeof encoding.sort === 'string' && 
                            (encoding.sort === '-y' || encoding.sort === '-x' || encoding.sort === '-color' || 
                             encoding.sort === 'y' || encoding.sort === 'x' || encoding.sort === 'color')) {
                            
                            const isDescending = encoding.sort.startsWith('-');
                            const sortField = isDescending ? encoding.sort.substring(1) : encoding.sort;
                            
                            if (sortField === 'color' && colorEncoding?.field && colorEncoding.type === 'quantitative') {
                                // Sort by color field
                                valuesToKeep = uniqueValues
                                    .map(val => ({
                                        value: val,
                                        colorValue: workingTable
                                            .filter(r => r[fieldName] === val)
                                            .reduce((sum, r) => sum + (r[colorEncoding.field] || 0), 0)
                                    }))
                                    .sort((a, b) => isDescending ? b.colorValue - a.colorValue : a.colorValue - b.colorValue)
                                    .slice(0, maxNominalValues)
                                    .map(v => v.value);
                            } else if (sortField === oppositeChannel && oppositeEncoding?.type === 'quantitative') {
                                // Sort by opposite axis
                                const quantField = oppositeEncoding.field;
                                valuesToKeep = uniqueValues
                                    .map(val => ({
                                        value: val,
                                        sum: workingTable
                                            .filter(r => r[fieldName] === val)
                                            .reduce((sum, r) => sum + (r[quantField] || 0), 0)
                                    }))
                                    .sort((a, b) => isDescending ? b.sum - a.sum : a.sum - b.sum)
                                    .slice(0, maxNominalValues)
                                    .map(v => v.value);
                            } else {
                                // If sort field is not available or not quantitative, fall back to default
                                valuesToKeep = uniqueValues.slice(0, maxNominalValues);
                            }
                        } else {
                            // If sort is a custom array or other value, just take first maxNominalValues
                            valuesToKeep = uniqueValues.slice(0, maxNominalValues);
                        }
                    } else {
                        // No explicit sort configuration, use the existing inference logic
                        // Check if color field exists and is quantitative
                        if (colorEncoding?.field && colorEncoding.type === 'quantitative') {
                            // Sort by color field descending and take top maxNominalValues
                            valuesToKeep = uniqueValues
                                .map(val => ({
                                    value: val,
                                    maxColor: workingTable
                                        .filter(r => r[fieldName] === val)
                                        .reduce((max, r) => Math.max(max, r[colorEncoding.field] || 0), -Infinity)
                                }))
                                .sort((a, b) => b.maxColor - a.maxColor)
                                .slice(0, maxNominalValues)
                                .map(v => v.value);

                        } else if (oppositeEncoding?.type === 'quantitative') {
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

export const resolveChartFieldsBackup = (chart: Chart, availableFields: FieldItem[], visFieldNames: string[], table: DictTable) => {
    // resolve and update chart fields based on refined visualization goal
    
    let visFieldIds : string[] = visFieldNames.map(name => availableFields.find(c => c.name == name)?.id).filter(fid => fid != undefined) as string[];

    let chartChannels = getChartChannels(chart.chartType);

    let ocupiedChannels = chartChannels.filter(ch => {
        let fieldId = chart.encodingMap[ch as keyof EncodingMap].fieldID;
        return  fieldId != undefined && table.names.includes(availableFields.find(c => c.id == fieldId)?.name || "")
    });
    let ocupiedFieldIds = ocupiedChannels.map(ch => chart.encodingMap[ch as keyof EncodingMap].fieldID);

    let newAdditionFieldIds = visFieldIds.filter(fid => !ocupiedFieldIds.includes(fid))
    let channelsToUpdate = [...chartChannels.filter(ch => !ocupiedChannels.includes(ch))];

    for (let i = 0; i < Math.min(newAdditionFieldIds.length, channelsToUpdate.length); i ++) {
        chart.encodingMap[channelsToUpdate[i] as keyof EncodingMap].fieldID = newAdditionFieldIds[i];
    }
    
    return chart;
}


// Enhanced field analysis interface
interface FieldAnalysis {
    field: FieldItem;
    fieldType: string; // 'quantitative', 'nominal', 'ordinal', 'temporal'
    semanticType: string; // 'Date', 'Year', 'Decade', ...
    cardinality: number;
    isLowCardinality: boolean;
    isVeryLowCardinality: boolean;
    mightBeTemporal: boolean;
}

const analyzeField = (field: FieldItem, table: DictTable): FieldAnalysis => {
    const fieldName = field.name;
    const columnIndex = table.names.indexOf(fieldName);
    
    if (columnIndex === -1) {
        return {
            field,
            fieldType: 'nominal',
            semanticType: table.metadata[fieldName].semanticType || 'None',
            cardinality: 0,
            isLowCardinality: false,
            isVeryLowCardinality: false,
            mightBeTemporal: false
        };
    }

    const values = table.rows.map(row => row[fieldName]);
    const cardinality = new Set(values.filter(v => v != null)).size;
    const fieldType = getDType(table.metadata[fieldName].type, values);
    const mightBeTemporal = 
        field.name.toLowerCase().endsWith("year") 
        || field.name.toLowerCase().endsWith("decade") 
        || field.name.toLowerCase().endsWith("decades")
        || (fieldType == "quantitative" && values.every(v => typeof v === "number") && 
            isLikelyYear(values));
    
    return {
        field,
        fieldType,
        semanticType: table.metadata[fieldName].semanticType || 'None',
        cardinality,
        isLowCardinality: cardinality <= 20,
        isVeryLowCardinality: cardinality <= 10,
        mightBeTemporal: mightBeTemporal
    };
};

// Helper function to detect if values look like years
const isLikelyYear = (values: any[]): boolean => {
    const numericValues = values.filter(v => v != null && typeof v === "number");
    if (numericValues.length === 0) return false;
    
    // Check if values are in reasonable year range
    const inYearRange = numericValues.every(v => v >= 1900 && v <= 2100);
    
    // Check if values are integers (years should be whole numbers)
    const areIntegers = numericValues.every(v => Number.isInteger(v));
    
    // Check if the range is reasonable for years (not too spread out)
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const reasonableRange = (max - min) <= 200;
    
    return inYearRange && areIntegers && reasonableRange;
};

export const resolveChartFields = (chart: Chart, allFields: FieldItem[], chartEncodings: { [key: string]: string }, table: DictTable) => {
    for (let [key, value] of Object.entries(chartEncodings)) {

        if (key == "facet") {
            key = "column";
        }

        let field = allFields.find(c => c.name === value);
        chart.encodingMap[key as Channel] = { fieldID: field?.id };
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
            t = parentTable;
        } else {
            break;
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