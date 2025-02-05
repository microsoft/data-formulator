// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as d3 from 'd3';
import Column from './column';

import { DictTable } from '../components/ComponentType';
import { CoerceType, TestType, Type } from './types';
import { ColumnTable } from './table';

export const loadDataWrapper = (title: string, text: string, fileType: string): DictTable | undefined => {
    
    let tableName = title;
    //let tableName = title.replace(/\.[^/.]+$/ , "");

    let table = undefined;
    if (fileType == "text/csv" || fileType == "text/tab-separated-values") {
        table = createTableFromText(tableName, text);
    } else if (fileType == "application/json") {
        table = createTableFromFromObjectArray(tableName, JSON.parse(text));
    }

    return table;
};

export const createTableFromText = (title: string, text: string): DictTable | undefined => {
    // Check for empty strings, bad data, anything else?
    if (!text || text.trim() === '') {
        console.log('Invalid text provided for data. Could not load.');
        return undefined;
    }

    // Determine if the input text is tab or comma separated values
    // Compute the number of tabs and lines
    let tabNum = 0,
        lineNum = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charAt(i) === '\t') tabNum++;
        if (text.charAt(i) === '\n') lineNum++;
    }

    // If one or more tab per line, then it is tab separated values
    // Should check the data file as well for the ending
    const isTabSeparated = tabNum / lineNum >= 1;

    const values = isTabSeparated ? d3.tsvParse(text) : d3.csvParse(text);
    
    return createTableFromFromObjectArray(title, values);
};

export const createTableFromFromObjectArray = (title: string, values: any[], derive?: any): DictTable => {
    const len = values.length;
    let names: string[] = [];
    let cleanNames: string[] = [];
    const columns = new Map<string, Column>();

    if (len) {
        names = Object.keys(values[0]);
        cleanNames = names.map((name, i) => {
            if (name == "") {
                let newName = `c${i}`;
                let k = 0;
                while(names.includes(newName)) {
                    newName = `c${i}_${k}`
                    k = k + 1;
                } 
                return newName;
            }
            // clean up messy column names
            if (name && name.includes(".")) {
                return name.replace(".", "_");
            }
            return name;
        })

        for (let i = 0; i < names.length; i++) {
            let col = [];
            for (let r = 0; r < len; r++) {
                col.push(values[r][names[i]]);
            }
            const type = inferTypeFromValueArray(col);
            col = coerceValueArrayFromTypes(col, type);
            columns.set(cleanNames[i], new Column(col, type));
        }
    }

    let columnTable = new ColumnTable(columns, cleanNames);

    return  {
        id: title,
        names: columnTable.names(),
        types: columnTable.names().map(name => (columnTable.column(name) as Column).type),
        rows: columnTable.objects(),
        derive: derive
    }
};

export const inferTypeFromValueArray = (values: any[]): Type => {
    let types: Type[] = [Type.Boolean, Type.Integer, Type.Date, Type.Number, Type.String];

    for (let i = 0; i < values.length; i++) {
        const v = values[i];

        for (let t = 0; t < types.length; t++) {
            if (v != null && !TestType[types[t]](v)) {
                types.splice(t, 1);
                t -= 1;
            }
        }
    }

    return types[0];
};

export const convertTypeToDtype = (type: Type | undefined): string => {
    return type === Type.Integer || type === Type.Number
        ? 'quantitative'
        : type === Type.Boolean
        ? 'boolean'
        : type === Type.Date
        ? 'date'
        : 'nominal';
};

export const coerceValueArrayFromTypes = (values: any[], type: Type): any[] => {
    return values.map((v) => CoerceType[type](v));
};

export const coerceValueFromTypes = (value: any, type: Type): any => {
    return CoerceType[type](value);
};

export const computeUniqueValues = (values: any[]): any[] => {
    return Array.from(new Set(values));
};

export function tupleEqual(a: any[], b: any[]) {
    // check if two tuples are equal
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; ++i) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// export function arrayEqual(_arr1: any[], _arr2: any[]) {
//     if (Array.isArray(_arr1) || !Array.isArray(_arr2) || _arr1.length !== _arr2.length) {
//         return false;
//     }
    
//     // .concat() to not mutate arguments
//     const arr1 = _arr1.concat().sort();
//     const arr2 = _arr2.concat().sort();
    
//     for (let i = 0; i < arr1.length; i++) {
//         if (arr1[i] !== arr2[i]) {
//             return false;
//         }
//     }
    
//     return true;
// }