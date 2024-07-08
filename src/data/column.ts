// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Type } from './types';
import { computeUniqueValues } from './utils';

export default class Column {
    protected _data: any[];

    protected _type: Type;

    protected _uniques: any[];

    constructor(data: any[], type?: Type) {
        this._data = data;
        this._type = type || Type.String;
        // Should sort uniques based on type?
        this._uniques = computeUniqueValues(this._data);
    }

    get uniques(): any[] {
        return this._uniques;
    }

    get type(): Type {
        return this._type;
    }

    get length(): number {
        return this._data.length;
    }

    get(row: number): any {
        return this._data[row];
    }
}
