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

export function getUrls() {
    return {
        GET_SESSION_ID: `/api/get-session-id`,
        APP_CONFIG: `/api/app-config`,
        AUTH_INFO_PREFIX: `/api/.auth/`,

        VEGA_DATASET_LIST: `/api/vega-datasets`,
        VEGA_DATASET_REQUEST_PREFIX: `/api/vega-dataset/`,

        // these functions involves ai agents
        CHECK_AVAILABLE_MODELS: `/api/agent/check-available-models`,
        TEST_MODEL: `/api/agent/test-model`,

        DERIVE_CONCEPT_URL: `/api/agent/derive-concept-request`,
        DERIVE_PY_CONCEPT: `/api/agent/derive-py-concept`,

        SORT_DATA_URL: `/api/agent/sort-data`,
        CLEAN_DATA_URL: `/api/agent/clean-data`,
        
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
            // console.log("field and channel");
            // console.log(`${field.name} ${channel} ${encoding.aggregate}`);

            // create the encoding
            encodingObj["field"] = field.name;
            encodingObj["type"] = encoding.dtype || getDType(field.type, workingTable.map(r => r[field.name]));
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
                // if (actualDomain.every(v => field.domain.includes(v)) && field.domain.length > actualDomain.length) {

                //     let scaleValues = [...new Set(field.domain)].sort();
                //     let legendValues = actualDomain.sort();

                //     encodingObj["scale"] = {
                //         domain: scaleValues,
                //     }
                //     encodingObj["legend"] = {
                //         "values": legendValues,
                //     }
                // }

                if (actualDomain.length >= 16) {
                    if (encodingObj["legend"] == undefined) {
                        encodingObj["legend"] = {}
                    }
                    encodingObj["legend"]['symbolSize'] = 12;
                    encodingObj["legend"]["labelFontSize"] = 8;
                }

                // if ([...new Set(field.domain)].length >= 16) {
                //     if (encodingObj["scale"] == undefined) {
                //         encodingObj["scale"] = {}
                //     }
                //     encodingObj["scale"]['scheme'] = "tableau20";
                // }
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
                        // this is a very interesting hack, it leverages the hidden derived field name used in compiled Vega script to 
                        // handle order of stack bar and stacked area charts
                        vgObj['encoding']['order'] = {
                            "field": `color_${field?.name}_sort_index`,
                        }
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
        vgObj['resolve'] = {
            "axis": {
                "x": "independent",
            }
        }
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

export const resolveChartFields = (chart: Chart, visFields: FieldItem[], refinedGoal: any, table: DictTable) => {
    // resolve and update chart fields based on refined visualization goal

    let targetFieldNames : string[] = refinedGoal['visualization_fields'];
    let targetFieldIds : string[] = targetFieldNames.map(name => visFields.find(c => c.name == name)?.id).filter(fid => fid != undefined) as string[];

    let chartChannels = getChartChannels(chart.chartType);

    let ocupiedChannels = chartChannels.filter(ch => {
        let fieldId = chart.encodingMap[ch as keyof EncodingMap].fieldID;
        return  fieldId != undefined && table.names.includes(visFields.find(c => c.id == fieldId)?.name || "")
    });
    let ocupiedFieldIds = ocupiedChannels.map(ch => chart.encodingMap[ch as keyof EncodingMap].fieldID);

    let newAdditionFieldIds = targetFieldIds.filter(fid => !ocupiedFieldIds.includes(fid))
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
    cardinality: number;
    isLowCardinality: boolean;
    isVeryLowCardinality: boolean;
}

const detectFieldTypeFromValues = (field: FieldItem, table: DictTable): string => {
    // Get the column data for this field
    const fieldName = field.name;
    const columnIndex = table.names.indexOf(fieldName);
    if (columnIndex === -1) return 'nominal';
    
    const values = table.rows.map(row => row[columnIndex]);
    const uniqueCount = new Set(values.filter(v => v != null)).size;
    const totalCount = values.length;
    
    // Use existing getDType function but add cardinality-based logic for quantitative fields
    const baseType = getDType(field.type, values);
    
    if (baseType === 'quantitative') {
        // Check if it looks like a discrete categorical variable
        if (uniqueCount <= 20 && uniqueCount / totalCount < 0.5) {
            return 'ordinal';
        }
        return 'quantitative';
    }
    
    return baseType;
};

const analyzeField = (field: FieldItem, table: DictTable): FieldAnalysis => {
    const fieldName = field.name;
    const columnIndex = table.names.indexOf(fieldName);
    
    if (columnIndex === -1) {
        return {
            field,
            fieldType: 'nominal',
            cardinality: 0,
            isLowCardinality: false,
            isVeryLowCardinality: false
        };
    }
    
    const values = table.rows.map(row => row[columnIndex]);
    const cardinality = new Set(values.filter(v => v != null)).size;
    const fieldType = detectFieldTypeFromValues(field, table);
    
    return {
        field,
        fieldType,
        cardinality,
        isLowCardinality: cardinality <= 20,
        isVeryLowCardinality: cardinality <= 10
    };
};

const getFieldPriority = (fieldAnalysis: FieldAnalysis, chartType: string): number => {
    // Prioritize temporal fields for time-based charts
    if ((chartType.toLowerCase().includes("line") || chartType.toLowerCase().includes("area")) && fieldAnalysis.fieldType === "temporal") {
        return 0;
    }
    // Prioritize quantitative fields
    else if (fieldAnalysis.fieldType === "quantitative") {
        return 1;
    }
    // Then categorical with reasonable cardinality
    else if (fieldAnalysis.isLowCardinality) {
        return 2;
    }
    // Finally high cardinality categoricals
    else {
        return 3;
    }
};

export const resolveChartFieldsV2 = (chart: Chart, visFields: FieldItem[], refinedGoal: any, table: DictTable) => {
    // resolve and update chart fields based on refined visualization goal with enhanced encoding strategy
    //TODO: need to update resolveChartFieldsV2 to use visFields instead of currentConcepts

    let targetFieldNames : string[] = refinedGoal['visualization_fields'];
    let targetFields = targetFieldNames.map(name => visFields.find(c => c.name === name)).filter(f => f != undefined) as FieldItem[];
    
    if (targetFields.length === 0) {
        return chart;
    }
    
    let chartChannels = getChartChannels(chart.chartType);
    let chartType = chart.chartType.toLowerCase();
    
    // Define chart types that have enhanced encoding strategies (matching Python implementation)
    const enhancedChartTypes = ['bar', 'line', 'area', 'scatter', 'point', 'heatmap', 'rect', 'boxplot', 'box'];
    const hasEnhancedStrategy = enhancedChartTypes.some(type => chartType.includes(type));
    
    if (!hasEnhancedStrategy) {
        // Fallback to original approach for undefined chart types
        let targetFieldIds = targetFields.map(f => f.id);
        
        let ocupiedChannels = chartChannels.filter(ch => {
            let fieldId = chart.encodingMap[ch as keyof EncodingMap].fieldID;
            return fieldId != undefined && table.names.includes(visFields.find(c => c.id == fieldId)?.name || "")
        });
        let ocupiedFieldIds = ocupiedChannels.map(ch => chart.encodingMap[ch as keyof EncodingMap].fieldID);

        let newAdditionFieldIds = targetFieldIds.filter(fid => !ocupiedFieldIds.includes(fid))
        let channelsToUpdate = [...chartChannels.filter(ch => !ocupiedChannels.includes(ch))];

        for (let i = 0; i < Math.min(newAdditionFieldIds.length, channelsToUpdate.length); i ++) {
            chart.encodingMap[channelsToUpdate[i] as keyof EncodingMap].fieldID = newAdditionFieldIds[i];
        }
        
        return chart;
    }
    
    // Enhanced encoding strategy for defined chart types
    
    // Analyze field types and properties
    const fieldAnalyses = targetFields.map(field => analyzeField(field, table));
    
    // Sort fields by priority for assignment
    fieldAnalyses.sort((a, b) => getFieldPriority(a, chartType) - getFieldPriority(b, chartType));
    
    // Track used fields and channels
    const usedFieldIds = new Set<string>();
    const encodings: { [channel: string]: string } = {};
    
    const addEncoding = (channel: string, fieldId: string) => {
        encodings[channel] = fieldId;
        usedFieldIds.add(fieldId);
    };
    
    // Get available field analyses (not yet used)
    const getAvailableFieldAnalyses = () => fieldAnalyses.filter(fa => !usedFieldIds.has(fa.field.id));
    
    // Assign primary channels based on chart type
    const assignPrimaryChannels = () => {
        if (!chartChannels.includes("x") || !chartChannels.includes("y")) {
            return;
        }
        
        const availableFields = getAvailableFieldAnalyses();
        
        if (chartType.includes("bar")) {
            // Bar chart: x = categorical, y = quantitative
            const categoricalField = availableFields.find(fa => 
                fa.fieldType === "nominal" || fa.fieldType === "ordinal"
            );
            
            if (categoricalField) {
                addEncoding("x", categoricalField.field.id);
            } else if (availableFields.length > 0) {
                addEncoding("x", availableFields[0].field.id);
            }
            
            const remainingFields = getAvailableFieldAnalyses();
            const quantitativeField = remainingFields.find(fa => fa.fieldType === "quantitative");
            
            if (quantitativeField) {
                addEncoding("y", quantitativeField.field.id);
            }
        }
        else if (chartType.includes("line") || chartType.includes("area")) {
            // Line/Area chart: x = temporal/ordinal, y = quantitative
            const temporalField = availableFields.find(fa => 
                fa.fieldType === "temporal" || fa.fieldType === "ordinal"
            );
            
            if (temporalField) {
                addEncoding("x", temporalField.field.id);
            } else if (availableFields.length > 0) {
                addEncoding("x", availableFields[0].field.id);
            }
            
            const remainingFields = getAvailableFieldAnalyses();
            const quantitativeField = remainingFields.find(fa => fa.fieldType === "quantitative");
            
            if (quantitativeField) {
                addEncoding("y", quantitativeField.field.id);
            }
        }
        else if (chartType.includes("scatter") || chartType.includes("point")) {
            // Point charts: flexible for scatter plots, bubble charts, etc.
            const quantFields = availableFields.filter(fa => fa.fieldType === "quantitative");
            
            if (quantFields.length >= 2) {
                // Traditional scatter plot with two quantitative axes
                addEncoding("x", quantFields[0].field.id);
                addEncoding("y", quantFields[1].field.id);
            } else if (availableFields.length >= 2) {
                // Use any available fields
                addEncoding("x", availableFields[0].field.id);
                addEncoding("y", availableFields[1].field.id);
            } else if (availableFields.length === 1) {
                // Single field - use for y-axis
                addEncoding("y", availableFields[0].field.id);
            }
        }
        else if (chartType.includes("heatmap") || chartType.includes("rect")) {
            // Heatmap: x = categorical, y = categorical, color = quantitative
            const categoricalFields = availableFields.filter(fa => 
                fa.fieldType === "nominal" || fa.fieldType === "ordinal"
            );
            
            if (categoricalFields.length >= 2) {
                addEncoding("x", categoricalFields[0].field.id);
                addEncoding("y", categoricalFields[1].field.id);
            } else if (categoricalFields.length >= 1) {
                addEncoding("x", categoricalFields[0].field.id);
                const otherField = availableFields.find(fa => fa.field.id !== categoricalFields[0].field.id);
                if (otherField) {
                    addEncoding("y", otherField.field.id);
                }
            } else if (availableFields.length >= 2) {
                // Fallback: use any available fields
                addEncoding("x", availableFields[0].field.id);
                addEncoding("y", availableFields[1].field.id);
            }
        }
        else if (chartType.includes("boxplot") || chartType.includes("box")) {
            // Box plot: x = categorical, y = quantitative
            const categoricalField = availableFields.find(fa => 
                fa.fieldType === "nominal" || fa.fieldType === "ordinal"
            );
            const quantitativeField = availableFields.find(fa => 
                fa.fieldType === "quantitative"
            );
            
            if (categoricalField) {
                addEncoding("x", categoricalField.field.id);
            }
            
            if (quantitativeField) {
                addEncoding("y", quantitativeField.field.id);
            }
        }
        else {
            // Default: assign first two available fields
            const remainingFields = getAvailableFieldAnalyses();
            if (remainingFields.length >= 1) {
                addEncoding("x", remainingFields[0].field.id);
            }
            if (remainingFields.length >= 2) {
                addEncoding("y", remainingFields[1].field.id);
            }
        }
    };
    
    // Assign aesthetic channels
    const assignAestheticChannels = () => {
        const remainingFields = getAvailableFieldAnalyses();
        
        // Color channel
        if (chartChannels.includes("color") && remainingFields.length > 0) {
            let colorField;
            
            if (chartType.includes("heatmap") || chartType.includes("rect")) {
                // For heatmaps, color should be quantitative for intensity
                colorField = remainingFields.find(fa => fa.fieldType === "quantitative");
            } else {
                // For other charts, prefer low cardinality categorical fields
                colorField = remainingFields.find(fa => 
                    fa.isLowCardinality && (fa.fieldType === "nominal" || fa.fieldType === "ordinal")
                );
            }
            
            if (!colorField && remainingFields.length > 0) {
                colorField = remainingFields[0];
            }
            
            if (colorField) {
                addEncoding("color", colorField.field.id);
            }
        }
        
        // Size channel: prefer quantitative fields
        const sizeFields = getAvailableFieldAnalyses();
        if (chartChannels.includes("size") && sizeFields.length > 0) {
            const sizeField = sizeFields.find(fa => fa.fieldType === "quantitative") || sizeFields[0];
            if (sizeField) {
                addEncoding("size", sizeField.field.id);
            }
        }
        
        // Shape channel: prefer very low cardinality categorical fields
        const shapeFields = getAvailableFieldAnalyses();
        if (chartChannels.includes("shape") && shapeFields.length > 0) {
            const shapeField = shapeFields.find(fa => 
                fa.isVeryLowCardinality && (fa.fieldType === "nominal" || fa.fieldType === "ordinal")
            );
            if (shapeField) {
                addEncoding("shape", shapeField.field.id);
            }
        }
    };
    
    // Assign faceting channels
    const assignFacetingChannels = () => {
        const remainingFields = getAvailableFieldAnalyses();
        
        // Column: prefer low cardinality fields
        if (chartChannels.includes("column") && remainingFields.length > 0) {
            const colField = remainingFields.find(fa => fa.isLowCardinality);
            if (colField) {
                addEncoding("column", colField.field.id);
            }
        }
        
        // Row: prefer very low cardinality fields
        const rowFields = getAvailableFieldAnalyses();
        if (chartChannels.includes("row") && rowFields.length > 0) {
            const rowField = rowFields.find(fa => fa.isVeryLowCardinality);
            if (rowField) {
                addEncoding("row", rowField.field.id);
            }
        }
    };
    
    // Execute assignment strategy
    assignPrimaryChannels();
    assignAestheticChannels();
    assignFacetingChannels();
    
    // Apply the encodings to the chart
    for (const [channel, fieldId] of Object.entries(encodings)) {
        if (chartChannels.includes(channel)) {
            chart.encodingMap[channel as keyof EncodingMap].fieldID = fieldId;
        }
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