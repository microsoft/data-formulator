// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export enum Type {
    String = 'string',
    Boolean = 'boolean',
    Integer = 'integer',
    Number = 'number',
    Date = 'date',
    DateTime = 'datetime',
    Time = 'time',
    Duration = 'duration',
    Auto = 'auto',
}

export const TypeList = [Type.Auto, Type.Number, Type.Date, Type.DateTime, Type.Time, Type.String];

// ── Coerce helpers ──────────────────────────────────────────────────────

const coerceBoolean = (v: any): boolean | null => (v == null || v === '' ? null : v === 'false' ? false : !!v);
const coerceNumber = (v: any): number | null => (v == null || v === '' ? null : +v);
const coerceDate = (v: any) => {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return v;
};
const coerceDateTime = (v: any) => {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v.toISOString();
    return v;
};
const coerceTime = (v: any) => (v == null || v === '' ? null : v);
const coerceDuration = (v: any) => (v == null || v === '' ? null : v);
const coerceString = (v: any) => (v == null || v === '' ? null : v);

export const CoerceType: Record<string, (v: any) => any> = {
    boolean: coerceBoolean,
    number: coerceNumber,
    integer: coerceNumber,
    date: coerceDate,
    datetime: coerceDateTime,
    time: coerceTime,
    duration: coerceDuration,
    string: coerceString,
    auto: coerceString,
};

// ── Test helpers (type inference) ───────────────────────────────────────

const DATE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
const DATETIME_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[T ]\d{1,2}:\d{2}/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const DURATION_RE = /^P(\d+Y)?(\d+M)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/i;

const testBoolean = (v: any): boolean => v === 'true' || v === 'false' || isBoolean(v);
const testNumber = (v: any): boolean => !isNaN(+v) && !isDate(v);
const testInteger = (v: any): boolean => testNumber(v) && (v = +v) === ~~v;
const testDate = (v: any): boolean => {
    if (typeof v !== 'string') return false;
    return DATE_RE.test(v.trim()) && !isNaN(Date.parse(v));
};
const testDateTime = (v: any): boolean => {
    if (v instanceof Date) return true;
    if (typeof v !== 'string') return false;
    return DATETIME_RE.test(v.trim()) && !isNaN(Date.parse(v));
};
const testTime = (v: any): boolean => {
    if (typeof v !== 'string') return false;
    return TIME_RE.test(v.trim());
};
const testDuration = (v: any): boolean => {
    if (typeof v !== 'string') return false;
    return DURATION_RE.test(v.trim()) && v.trim() !== 'P';
};
const testString = (v: any): boolean => true;

export const TestType: Record<string, (v: any) => boolean> = {
    boolean: testBoolean,
    number: testNumber,
    integer: testInteger,
    date: testDate,
    datetime: testDateTime,
    time: testTime,
    duration: testDuration,
    string: testString,
    auto: testString,
};

export const isBoolean = (v: any) => v === true || v === false || Object.prototype.toString.call(v) === '[object Boolean]';

export const isNumber = (v: any) => typeof v === 'number' || Object.prototype.toString.call(v) === '[object Number]';

export const isDate = (v: any) => Object.prototype.toString.call(v) === '[object Date]';

export const getDType = (type: Type | undefined, domain: any[]): string => {
    switch (type) {
        case Type.Integer:
        case Type.Number:
        case Type.Duration:
            return 'quantitative';
        case Type.Boolean:
            return 'nominal';
        case Type.Date:
        case Type.DateTime:
        case Type.Time:
            return 'temporal';
        case Type.String:
            return 'nominal';
        case Type.Auto:
            return getDType(testType(domain) as Type, domain);
        default:
            return 'nominal';
    }
};

/** Infer the most specific type that all non-null values satisfy. */
export const testType = (values: any[]): string => {
    if (values.length === 0) return 'string';
    const nonNull = values.filter(v => v != null && v !== '');
    if (nonNull.length === 0) return 'string';
    if (nonNull.every(testBoolean)) return 'boolean';
    if (nonNull.every(testInteger)) return 'integer';
    if (nonNull.every(testDateTime)) return 'datetime';
    if (nonNull.every(testDate)) return 'date';
    if (nonNull.every(testTime)) return 'time';
    if (nonNull.every(testDuration)) return 'duration';
    if (nonNull.every(testNumber)) return 'number';
    return 'string';
};

/**
 * Map a backend API type label (standardized or legacy pandas dtype) to App Type.
 * Handles both new normalized labels and old raw dtype strings for backward compat.
 */
export const mapApiTypeToAppType = (apiType: string): Type => {
    const t = apiType.toLowerCase();
    // Standardized labels (from normalize_dtype_to_app_type)
    if (t === 'datetime') return Type.DateTime;
    if (t === 'date') return Type.Date;
    if (t === 'time') return Type.Time;
    if (t === 'duration') return Type.Duration;
    if (t === 'integer') return Type.Integer;
    if (t === 'number') return Type.Number;
    if (t === 'boolean') return Type.Boolean;
    if (t === 'string') return Type.String;
    // Legacy pandas dtype fallback
    if (t.includes('datetime') || t.includes('timestamp')) return Type.DateTime;
    if (t.includes('timedelta')) return Type.Duration;
    if (t.includes('int')) return Type.Integer;
    if (t.includes('float') || t.includes('double')) return Type.Number;
    if (t.includes('bool')) return Type.Boolean;
    return Type.String;
};

export const isTemporalType = (type: Type | undefined): boolean =>
    type === Type.Date || type === Type.DateTime || type === Type.Time;