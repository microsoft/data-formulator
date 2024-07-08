// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Column from './column';
import { Type } from './types';

const columnsToObjects = (columns: Map<string, Column>, names: string[], nrows: number): any[] => {
    const objects = [];
    for (let r = 0; r < nrows; r++) {
        const o: any = {};
        for (let c = 0; c < names.length; c++) {
            o[names[c]] = columns.get(names[c])?.get(r);
        }
        objects.push(o);
    }
    return objects;
};

export class ColumnTable {
    protected _data: Map<string, Column>;

    protected _names: string[];

    protected _objects: any[];

    protected _nrows: number;

    constructor(columns: Map<string, Column>, names: string[]) {
        this._data = columns;
        this._names = names;
        const nrows = columns.get(names[0])?.length;
        this._nrows = nrows ? nrows : 0;
        this._objects = columnsToObjects(this._data, this._names, this._nrows);
    }

    public numCols = (): number => {
        return this._names.length;
    };

    public numRows = (): number => {
        return this._nrows;
    };

    public column = (name: string): Column | undefined => {
        return this._data.get(name);
    };

    public columnAt = (col: number): Column | undefined => {
        return this._data.get(this._names[col]);
    };

    public columns = (): Map<string, Column> => {
        return this._data;
    };

    public objects = (): any[] => {
        return this._objects;
    };

    public names = (): string[] => {
        return this._names;
    };

    public metadata = (): [string, Type][] => {
        return this._names.map((name) => [name, (this.column(name) as Column).type])
    }

    public get = (name: string, row: number = 0): any => {
        const column = this.column(name);
        return column?.get(row);
    };
}
