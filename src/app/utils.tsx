// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import _, {  } from "lodash";
import { useEffect, useRef } from "react";
import ts from "typescript";
import { ChannelGroups, getChartChannels, getChartTemplate } from "../components/ChartTemplates";
import { Channel, Chart, ChartTemplate, ConceptTransformation, EncodingItem, EncodingMap, FieldItem, Trigger } from "../components/ComponentType";
import { DictTable } from "../components/ComponentType";
import { getDType } from "../data/types";

export interface AppConfig {
    serverUrl: string;
    popupConfig?: PopupConfig;
}

export interface PopupConfig {
    allowPopup?: boolean;
    jsUrl?: string;
}

export const appConfig: AppConfig = {
    serverUrl:  process.env.NODE_ENV == "production" ? "./" : "http://127.0.0.1:5000/",
};

export function assignAppConfig(config: AppConfig) {
    //assign the new config to the appConfig
    Object.assign(appConfig, config);
    console.log('appConfig', appConfig);
}

export function getUrls() {
    return {
        CHECK_AVAILABLE_MODELS: `${appConfig.serverUrl}/check-available-models`,
        TEST_MODEL: `${appConfig.serverUrl}/test-model`,

        // these functions involves openai models
        DERIVE_CONCEPT_URL: `${appConfig.serverUrl}/derive-concept-request`,
        SORT_DATA_URL: `${appConfig.serverUrl}/codex-sort-request`,
        CLEAN_DATA_URL: `${appConfig.serverUrl}/clean-data`,
        SERVER_DERIVE_DATA_URL: `${appConfig.serverUrl}/derive-data`,
        SERVER_REFINE_DATA_URL: `${appConfig.serverUrl}/refine-data`,
        CODE_EXPL_URL: `${appConfig.serverUrl}/code-expl`,
        SERVER_PROCESS_DATA_ON_LOAD: `${appConfig.serverUrl}/process-data-on-load`,

        DATASET_INFO_URL: `${appConfig.serverUrl}/datasets-info`,
        DATASET_REQUEST_PREFIX: `${appConfig.serverUrl}/datasets/`,

        VEGA_DATASET_LIST: `${appConfig.serverUrl}/vega-datasets`,
        VEGA_DATASET_REQUEST_PREFIX: `${appConfig.serverUrl}/vega-dataset/`,

        AUTH_INFO_PREFIX: `${appConfig.serverUrl}/.auth/`
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
                        target = func(...JSON.parse(JSON.stringify(args)))
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

export function baseTableToExtTable(table: any[], derivedFields: FieldItem[], allFields: FieldItem[]) {
    // derive fields from derivedFields from the original table

    if (table.length == 0) {
        return [];
    }

    let availableBaseFields = allFields.filter(f => Object.keys(table[0]).includes(f.name));
    let extDerivedFields = [...derivedFields];
    while(true) {
        let unresolvedDerivedParentID = extDerivedFields.map(field => {
            let parentIDs = (field.transform as ConceptTransformation).parentIDs;
            return allFields.filter(f => parentIDs.includes(f.id) && f.source == "derived")
                            .filter(f => !extDerivedFields.map(f => f.id).includes(f.id))
                            .map(f => f.id);
        }).flat()
        unresolvedDerivedParentID = [...new Set(unresolvedDerivedParentID)];
        
        if (unresolvedDerivedParentID.length == 0) {
            break
        } else {
            extDerivedFields = [...extDerivedFields, ...allFields.filter(f => unresolvedDerivedParentID.includes(f.id))]
        }
    }

    // derivedCols contains the derived column name, parent column names and its values
    let derivedColID2Cols : Map<string, [string, string[], any[]]> = new Map();
    
    // contains the list of IDs of concepts that have already been derived
    while(!extDerivedFields.every(f => derivedColID2Cols.has(f.id))) {
        let readyFields = extDerivedFields.filter(f => !derivedColID2Cols.has(f.id))
                            .filter(f => (f.transform as ConceptTransformation).parentIDs.every(
                                parentID => [...derivedColID2Cols.keys(), ...availableBaseFields.map(f => f.id)].includes(parentID)));
        
        if (readyFields.length == 0) {
            // there are concepts without parents???
            break
        }

        let newlyDerivedCols: [string, string[], any[]][] = readyFields.map(field => {
            //let baseFields = (field.transform as ConceptTransformation).parentIDs.map((parentID) => allFields.find(f => f.id == parentID) as FieldItem);

            let parentNames = (field.transform as ConceptTransformation).parentIDs.map(parentID => (allFields.find(f => f.id == parentID) as FieldItem).name);
            let baseCols = (field.transform as ConceptTransformation).parentIDs.map(parentID => {
                let baseField = availableBaseFields.find(f => f.id == parentID);
                if (baseField != undefined) {
                    return table.map((row) => row[(baseField as FieldItem).name])
                } else {
                    return (derivedColID2Cols.get(parentID) as [string, string[], any[]])[2];
                }
            });
            
            let jsCode = ts.transpile((field.transform as ConceptTransformation).code as string);
            let func = eval(jsCode);
    
            //let baseFieldCols = baseFields.map(f => table.map((row) => row[f.name]));
            
            let values = table.map((row, rowIdx) => {
                let inputTuples = baseCols.map(col => col[rowIdx]) // baseFields.map((baseField) => row[baseField.name]);
                let target = undefined;

                try {
                    let args = inputTuples;
                    if (func.length == baseCols.length * 2 + 1) {
                        // avoid side effect, use the copy of the column when calling the function
                        args = [...inputTuples, rowIdx, ...JSON.parse(JSON.stringify(baseCols))]
                    }            
        
                    target = func(...args);
                } catch(err) {
                    //console.warn(err);
                }
                return target;
            });
    
            return [field.name, parentNames, values];
        })
        
        
        for (let i = 0; i < readyFields.length; i ++) {
            derivedColID2Cols.set(readyFields[i].id, newlyDerivedCols[i]);
        }
    }

    let derivedCols = [...derivedColID2Cols.values()];
    
    let tableNames = Object.keys(table[0]);
    let orderedNames = [...tableNames];

    while(true) {
        let missingCols = derivedCols.filter(c => !orderedNames.includes(c[0]))
        if (missingCols.length == 0) {
            break
        }
        for (let [name, parentNames, vals] of missingCols) {
            if (!parentNames.every(name => orderedNames.includes(name))) {
                // wait for next round
                continue
            }
            let lastParent = (parentNames as string[]).sort((n1, n2) => orderedNames.indexOf(n2) - orderedNames.indexOf(n1))[0];
            let lastParentIndex = orderedNames.indexOf(lastParent);
            orderedNames.splice(lastParentIndex + 1, 0, name);
        }
    }

    let derivedColName2Values : any = {};
    for (let i = 0; i < derivedCols.length; i ++) {
        derivedColName2Values[derivedCols[i][0] as string] = derivedCols[i][2];
    }
    // console.log(orderedNames)

    let extTable = table.map((row, i) => {
        let newRow : any = {};
        for (let name of orderedNames) {
            if (name in row) {
                newRow[name] = row[name]
            } else {
                newRow[name] = derivedColName2Values[name][i];
            }
        } 
        
        return newRow;
    })

    return extTable;
}


export const instantiateVegaTemplate = (chartType: string, encodingMap: { [key in Channel]: EncodingItem; }, allFields: FieldItem[], workingTable: any[]) => {

    if (chartType == "Table") {
        return ["Table", undefined];
    }

    let chartTemplate = getChartTemplate(chartType) as ChartTemplate;
    //console.log(chartTemplate);

    let vgObj = JSON.parse(JSON.stringify(chartTemplate.template));
    const baseTableSchemaObj: any = {};

    for (const [channel, encoding] of Object.entries(encodingMap)) {

        let encodingObj: any = {};

        if (channel == "radius") {
            encodingObj["scale"] = {"type": "sqrt", "zero": true};
        }

        const field = encoding.fieldID ? _.find(allFields, (f) => f.id === encoding.fieldID) : undefined;
        if (field) {
            //console.log(field)
            // the synthesizer only need to see base table schema
            let baseFields = (field.source == "derived" ? 
                    (field.transform as ConceptTransformation).parentIDs.map((parentID) => allFields.find((f) => f.id == parentID) as FieldItem) 
                  : [field]);

            for (let baseField of baseFields) {
                if (Object.keys(baseTableSchemaObj).includes(baseField.name)) {
                    continue;
                }
                baseTableSchemaObj[baseField.name] = {
                    channel, 
                    dtype: getDType(baseField.type, workingTable.map(r => r[baseField.name])),
                    name: baseField.name,
                    original: baseField.source == "original",
                    // domain: {
                    //     values: [...new Set(baseField.domain.values)],
                    //     is_complete: baseField.domain.isComplete
                    // },
                };
            }

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

            if (encoding.bin) {
                encodingObj["bin"] = encoding.bin;
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
        if (encoding.aggregate) {
            encodingObj["aggregate"] = encoding.aggregate;
            if (encodingObj["aggregate"] == "count") {
                encodingObj["title"] = "Count"
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

    // console.log(JSON.stringify(vgObj))

    return [vgObj, baseTableSchemaObj];
}

export const assembleChart = (chart: Chart, conceptShelfItems: FieldItem[], dataValues: any[]) => {

    let vgSpec: any = instantiateVegaTemplate(chart.chartType, chart.encodingMap, conceptShelfItems, dataValues)[0];

    let values = JSON.parse(JSON.stringify(dataValues));
    values = values.map((r: any) => { 
        let keys = Object.keys(r);
        let temporalKeys = keys.filter((k: string) => conceptShelfItems.some(concept => concept.name == k && (concept.type == "date" || concept.semanticType == "Year")));
        for (let temporalKey of temporalKeys) {
            r[temporalKey] = String(r[temporalKey]);
        }
        return r;
    })
    return {...vgSpec, data: {values: values}}
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
    // recursively find triggers that ends in leafTable
    let triggers : Trigger[] = [];
    let t = leafTable;
    while(t.derive != undefined) {
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