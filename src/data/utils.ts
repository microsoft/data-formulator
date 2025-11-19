// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as d3 from 'd3';
import Column from './column';
import * as ExcelJS from 'exceljs';

import { DictTable } from '../components/ComponentType';
import { CoerceType, TestType, Type } from './types';
import { ColumnTable } from './table';

export const loadTextDataWrapper = (title: string, text: string, fileType: string): DictTable | undefined => {
    
    let tableName = title;
    //let tableName = title.replace(/\.[^/.]+$/ , "");

    let table = undefined;
    if (fileType == "text/csv" || fileType == "text/tab-separated-values") {
        table = createTableFromText(tableName, text);
    } else if (fileType == "application/json") {
        table = createTableFromFromObjectArray(tableName, JSON.parse(text), true);
    } 
    return table;
};

export const createTableFromText = (title: string, text: string, context?: string): DictTable | undefined => {
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

    // Use d3.dsvFormat to create a custom parser that properly handles quoted fields
    // This ensures commas inside quoted fields won't be treated as delimiters
    const rows = isTabSeparated 
        ? d3.tsvParseRows(text) 
        : d3.dsvFormat(',').parseRows(text, (row, index) => {
            // Process each row to ensure proper type handling
            return row;
          });
    
    // Handle duplicate column names by appending _1, _2, etc.
    let colNames: string[] = [];
    for (let i = 0; i < rows[0].length; i++) {
        let col = rows[0][i];   
        if (colNames.includes(col)) {
            let k = 1;
            while (colNames.includes(`${col}_${k}`)) {
                k++;
            }
            colNames.push(`${col}_${k}`);
        } else {
            colNames.push(col);
        }
    }

    let values = rows.slice(1);
    let records = values.map(row => {
        let record: any = {};
        for (let i = 0; i < colNames.length; i++) {
            record[colNames[i]] = row[i];
        }
        return record;
    });

    return createTableFromFromObjectArray(title, records, true, undefined, context);
};

export const createTableFromFromObjectArray = (title: string, values: any[], anchored: boolean, derive?: any, context?: string): DictTable => {
    /*
    * title: the title of the table
    * values: the values of the table
    * anchored: whether the table is anchored
    * derive: the derive of the table
    * context: the context of the table that will be attached to table metadata
    */

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
        displayId: `${title}`,
        names: columnTable.names(),
        metadata: columnTable.names().reduce((acc, name) => ({
            ...acc,
            [name]: {
                type: (columnTable.column(name) as Column).type,
                semanticType: "",
                levels: []
            }
        }), {}),
        rows: columnTable.objects(),
        derive: derive,
        anchored: anchored,
        createdBy: "user",
        attachedMetadata: context || ''
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

export const loadBinaryDataWrapper = async (title: string, arrayBuffer: ArrayBuffer): Promise<DictTable[]> => {
    try {
        // Read the Excel file
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);
        
        // Create tables for each sheet
        const tables: DictTable[] = [];
        
        workbook.eachSheet((worksheet, sheetId) => {
            const jsonData: any[] = [];
            
            // Get the first row as headers
            const headerRow = worksheet.getRow(1);
            const headers: string[] = [];
            headerRow.eachCell((cell, colNumber) => {
                headers[colNumber - 1] = cell.value?.toString() || `Column${colNumber}`;
            });
            
            // Process data rows (skip header row)
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return; // Skip header row
                
                const rowData: any = {};
                row.eachCell((cell, colNumber) => {
                    const header = headers[colNumber - 1] || `Column${colNumber}`;
                    rowData[header] = cell.value;
                });
                
                // Only add row if it has data
                if (Object.keys(rowData).length > 0) {
                    jsonData.push(rowData);
                }
            });
            
            // Create a table from the JSON data with sheet name included in the title
            const sheetTable = createTableFromFromObjectArray(`${title}-${worksheet.name}`, jsonData, true);
            tables.push(sheetTable);
        });
        
        return tables;
    } catch (error) {
        console.error('Error processing Excel file:', error);
        return [];
    }
};

/**
 * Exports a DictTable to DSV format using d3.dsvFormat
 * @param table - The DictTable to export
 * @param delimiter - The delimiter to use (e.g., "," for CSV, "\t" for TSV)
 * @returns DSV string representation of the table
 */
export const exportTableToDsv = (table: DictTable, delimiter: string): string => {
    // Use d3.dsvFormat to convert the rows array to DSV
    return d3.dsvFormat(delimiter).format(table.rows);
};
