// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export enum Type {
    String = 'string',
    Boolean = 'boolean',
    Integer = 'integer',
    Number = 'number',
    Date = 'date',
    Auto = 'auto'
    // Time = 'time',
    // DateTime = 'datetime',
}

export const TypeList = [Type.Auto, Type.Number, Type.Date, Type.String]; //[Type.Boolean, Type.Integer, Type.Number, Type.Date, Type.String];

const coerceBoolean = (v: any): boolean | null => (v == null || v === '' ? null : v === 'false' ? false : !!v);
const coerceNumber = (v: any): number | null => (v == null || v === '' ? null : +v);
const coerceDate = (v: any, format?: any) => {
    // const d = format ? format : Date;
    //return v == null || v === '' ? null : new Date(v);
    //TODO: follow the standard date
    return v;
};
const coerceString = (v: any) => (v == null || v === '' ? null : v);

export const CoerceType = {
    boolean: coerceBoolean,
    number: coerceNumber,
    integer: coerceNumber,
    date: coerceDate,
    string: coerceString,
    auto: coerceString,
};

const testBoolean = (v: any): boolean => v === 'true' || v === 'false' || isBoolean(v);
const testNumber = (v: any): boolean => !isNaN(+v) && !isDate(v);
const testInteger = (v: any): boolean => testNumber(v) && (v = +v) === ~~v;
const testDate = (v: any): boolean => !isNaN(Date.parse(v));
const testString = (v: any): boolean => true;

export const TestType = {
    boolean: testBoolean,
    number: testNumber,
    integer: testInteger,
    date: testDate,
    string: testString,
    auto: testString,
};

export const isBoolean = (v: any) => v === true || v === false || Object.prototype.toString.call(v) === '[object Boolean]';

export const isNumber = (v: any) => typeof v === 'number' || Object.prototype.toString.call(v) === '[object Number]';

export const isDate = (v: any) => Object.prototype.toString.call(v) === '[object Date]';

export const getDType = (type: Type | undefined, domain: any[]): string => {
    // test the data type on the fly if it is not there
    return type === Type.Integer || type === Type.Number ? 'quantitative'
        : type === Type.Boolean ? 'nominal'
        : type === Type.Date ? 'temporal' // date?
        : type === Type.String ? 'nominal'
        : type === Type.Auto ? getDType(testType(domain) as Type, domain)
        : 'nominal';
};

export const testType = (values: any[]) => {
    if (values.length == 0) {
        return "string"
    }
    if (values.filter(v => !isBoolean(v)).length == 0) {
        return "boolean"
    }
    if (values.filter(v => !testNumber(v)).length == 0) {
        return "number"
    }
    if (values.filter(v => !testDate(v)).length == 0) {
        return "date"
    }
    return "string"
}