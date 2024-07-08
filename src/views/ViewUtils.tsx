// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from "react";
import ts from "typescript";
import { runCodeOnInputListsInVM } from "../app/utils";
import { ConceptTransformation, FieldItem } from "../components/ComponentType";
import { Type } from "../data/types";
import { BooleanIcon, NumericalIcon, StringIcon, DateIcon, UnknownIcon } from '../icons';

import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';

import prettier from "prettier";
import parserBabel from 'prettier/parser-babel';
import { DictTable } from '../components/ComponentType';

// from a list of potential tables, extract domain of a given basic or custom fields
export const getDomains = (field: FieldItem, tables: DictTable[]) : any[][] => {
    let domains = tables.filter(t => t.names.includes(field.name))
            .map(t => [...new Set(t.rows.map(row => row[field.name]))])
    // console.log("=== domains ===")
    // console.log(field.name)
    // console.log(domains)
    domains = domains.filter((d, i) =>  {
        return !domains.slice(0, i).some(prevD => JSON.stringify(prevD.slice().sort()) == JSON.stringify(d.slice().sort()));
    })
    // if there is no table that includes the given concept, then wrap it around so it is still sound
    return domains.length == 0 ? [[]] : domains;
}

// dedup inputs: whether we want to deduplicate the domain
export const deriveTransformExamplesV2 = (code: string, parentIDs: string[], inputListLength: number, 
                                          conceptShelfItems: FieldItem[], tables: DictTable[]) : [any[], any][] => {
    
    // assert that all ids exists in conceptShelfItems
    let parentConcepts = parentIDs.map(id => (conceptShelfItems.find(f => f.id == id) as FieldItem)); 

    let func : any = undefined;
    let inputRequiresColumnList = false;
    try {
        func = eval(ts.transpile(code));
        // prepare the function
        if (func.length == parentConcepts.length * 2 + 1) {
            // we need to retain domain without dedup so that the example table looks right
            inputRequiresColumnList = true;
        }
    } catch { }

    // create a fresh copy of the parent domain since there might be side effect when running code through VM
    let parentDomains = parentConcepts.map(concept => {
        if (concept.source == "derived") {
            let transform = concept.transform as ConceptTransformation;
            let domain = deriveTransformExamplesV2(
                transform.code as string, 
                transform.parentIDs as string[], 
                -1, conceptShelfItems, tables).map(ioPair => ioPair[1]);
            return [...domain]; //[...new Set(domain)];
        } else {
            return getDomains(concept, tables)[0]  //[...concept.domain.values];
        }
    });
    
    let examplesFromEachParent = inputListLength > 0 ? parentDomains.map(l => l.slice(0, inputListLength)) : parentDomains;
   
    let maxValueLength = examplesFromEachParent.length > 0 ? Math.min(...examplesFromEachParent.map(l => l.length)) : 0;

    let inputTupleList = [...Array(maxValueLength).keys()].map(i => examplesFromEachParent.map(exampleList => exampleList[i]));

    let argList = inputTupleList;

    if (inputRequiresColumnList) {
        argList = inputTupleList.map((args, i) => [...args, i, ...parentDomains]);
    }

    if (argList.length == 0) {  return [] }

    return runCodeOnInputListsInVM(code, argList, "faster");
}

export const processCodeCandidates = (rawCodeList: string[], parentIDs: string[], conceptShelfItems: FieldItem[], tables: DictTable[]) : string[] => {

    // do some quick parse check
    let tempCodeList = rawCodeList.filter(code => {
        try {
            prettier.format(code, {
                parser: "babel",
                plugins: [parserBabel]
            })
            return true;
        } catch {
            return false;
        }
    });

    // given a list of code candidates, and a list of inputs, check and partition candidates based on their behavioral equivalence
    let isArrayOrObj = (a: any) => {
        return ((!!a) && (a.constructor === Array)) || (!!a) && (a.constructor === Object);
    }
    let codeOutputSignatures = tempCodeList.map(codeStr => {
            let result = [codeStr, deriveTransformExamplesV2(codeStr, parentIDs, -1, conceptShelfItems, tables)] as [string, [any[], any][]]
            return result
        })
        .filter(([codeStr, ioPairs]) => {
            // console.log(codeStr)
            // console.log(ioPairs)
            // console.log(ioPairs.map(pair => [pair[1], pair[1] == NaN, Number.isNaN(pair[1])]))

            // when no ioPairs is available, we also keep the concept / function
            return  ioPairs.length == 0 || !ioPairs.every(pair => pair[1] == undefined || pair[1] == null || Number.isNaN(pair[1]) || isArrayOrObj(pair[1]))
        })
        .map(([codeStr, ioPairs]) => [codeStr, ioPairs.map(ioPair => `${ioPair[1]}`).join('---')] as [string, string]);

    let codeGroups = new Map<string, string[]>();
    for (let i = 0; i < codeOutputSignatures.length; i ++) {
        let [codeStr, signature] = codeOutputSignatures[i];
        if (codeGroups.has(signature)) {
            codeGroups.get(signature)?.push(codeStr);
        } else {
            codeGroups.set(signature, [codeStr]);
        }
    }

    return [...codeGroups.values()].map(l => l[0]);
}

// given a field and the list of conceptShelfItems, find the final parents of the given field
export const findBaseFields = (field: FieldItem, conceptShelfItems: FieldItem[]): FieldItem[] => {
    if (field.source == "derived") {
        return (field.transform as ConceptTransformation).parentIDs.map(parentID => 
                    findBaseFields(conceptShelfItems.find(f => f.id == parentID) as FieldItem, conceptShelfItems)).flat()
    } else {
        return [field];
    }
}

export const groupConceptItems = (conceptShelfItems: FieldItem[])  => {
    // group concepts based on which source table they belongs to
    return conceptShelfItems.map(f => {
        let group = ""
        if (f.source == "original") {
            group = f.tableRef as string;
        } else if (f.source == "custom") {
            group = "new fields"
        } else if (f.source == "derived") {
            group = findBaseFields(f, conceptShelfItems)[0].tableRef || "custom concepts";
        }
        return {group, field: f}
    });
}

// TODO: fix Unknown icon
export const getIconFromType = (t: Type | undefined): JSX.Element => {
    switch (t) {
        case Type.Boolean:
            return <BooleanIcon fontSize="inherit" />;
        case Type.Date:
            return <DateIcon fontSize="inherit" />;
        case Type.Integer:
        case Type.Number:
            return <NumericalIcon fontSize="inherit" />;
        case Type.String:
            return <StringIcon fontSize="inherit" />;
        case Type.Auto:
            return <AutoFixHighIcon fontSize="inherit" />;
    }
    return <UnknownIcon fontSize="inherit" />;
};