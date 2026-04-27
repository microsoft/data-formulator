// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from "react";
import ts from "typescript";
import { runCodeOnInputListsInVM } from "../app/utils";
import { FieldItem } from "../components/ComponentType";
import { Type } from "../data/types";
import { BooleanIcon, NumericalIcon, StringIcon, DateIcon, DateTimeIcon, TimeIcon, DurationIcon, UnknownIcon } from '../icons';

import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import BarChartIcon from '@mui/icons-material/BarChart';
import CommitIcon from '@mui/icons-material/Commit';

import { DictTable } from '../components/ComponentType';

export const groupConceptItems = (conceptShelfItems: FieldItem[], tables: DictTable[])  => {
    // group concepts based on which source table they belongs to
    return conceptShelfItems.map(f => {
        let group = ""
        if (f.source == "original") {
            group = tables.find(t => t.id == f.tableRef)?.displayId || f.tableRef;
        } else if (f.source == "custom") {
            group = "new fields"
        }
        return {group, field: f}
    });
}

export const getIconFromType = (t: Type | undefined): JSX.Element => {
    switch (t) {
        case Type.Boolean:
            return <BooleanIcon fontSize="inherit" />;
        case Type.Date:
            return <DateIcon fontSize="inherit" />;
        case Type.DateTime:
            return <DateTimeIcon fontSize="inherit" />;
        case Type.Time:
            return <TimeIcon fontSize="inherit" />;
        case Type.Duration:
            return <DurationIcon fontSize="inherit" />;
        case Type.Integer:
        case Type.Number:
            return <NumericalIcon fontSize="inherit" />;
        case Type.String:
            return <StringIcon fontSize="inherit" />;
        case Type.Auto:
            return <AutoFixHighIcon fontSize="inherit" />;
    }
    return <CommitIcon sx={{opacity: 0.3}} fontSize="inherit" />;
};

/**
 * Format a cell value for display in data tables.
 *
 * - Numbers get thousand separators (e.g. 1,234,567)
 * - Floats are capped at a reasonable number of decimal places
 * - Non-measure numeric semantics (e.g. Year, ID) stay ungrouped
 * - Date/DateTime/Time get locale-aware formatting via Intl
 * - Duration gets human-readable h/m/s format
 */
export const formatCellValue = (value: any, dataType?: Type, semanticType?: string): string => {
    if (value == null) return '';

    if (typeof value === 'number' && dataType !== Type.Duration) {
        if (!Number.isFinite(value)) return String(value);
        if (shouldDisplayNumericSemanticAsPlainText(semanticType)) return String(value);
        if (Number.isInteger(value)) {
            return value.toLocaleString('en-US');
        }
        return value.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 4,
        });
    }

    if (dataType === Type.DateTime || dataType === Type.Date || dataType === Type.Time) {
        return formatTemporalValue(value, dataType);
    }
    if (dataType === Type.Duration) {
        return formatDuration(value);
    }

    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'object') return String(value);
    return String(value);
};

const PLAIN_NUMERIC_SEMANTIC_TYPES = new Set([
    'year',
    'month',
    'week',
    'day',
    'hour',
    'quarter',
    'decade',
    'yearmonth',
    'yearquarter',
    'yearweek',
    'id',
    'zipcode',
    'rank',
]);

const normalizeSemanticType = (semanticType?: string): string =>
    (semanticType || '').replace(/[\s_-]/g, '').toLowerCase();

const shouldDisplayNumericSemanticAsPlainText = (semanticType?: string): boolean =>
    PLAIN_NUMERIC_SEMANTIC_TYPES.has(normalizeSemanticType(semanticType));

const formatTemporalValue = (value: any, dataType: Type): string => {
    if (dataType === Type.Time) {
        const d = new Date(`1970-01-01T${value}`);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleTimeString();
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    if (dataType === Type.Date) return d.toLocaleDateString();
    return d.toLocaleString();
};

const formatDuration = (value: any): string => {
    if (typeof value === 'number') {
        const h = Math.floor(value / 3_600_000);
        const m = Math.floor((value % 3_600_000) / 60_000);
        const s = Math.floor((value % 60_000) / 1_000);
        const parts: string[] = [];
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (s > 0 || parts.length === 0) parts.push(`${s}s`);
        return parts.join(' ');
    }
    return String(value);
};

/** Returns 'right' for numeric types and Duration, undefined (left) for everything else. */
export const getColumnAlign = (dataType: Type | undefined): 'right' | undefined => {
    if (dataType === Type.Number || dataType === Type.Integer || dataType === Type.Duration) return 'right';
    return undefined;
};

export const getIconFromDtype = (t: "quantitative" | "nominal" | "ordinal" | "temporal" | "auto"): JSX.Element => {
    switch (t) {
        case "quantitative":
            return <NumericalIcon fontSize="inherit" />;
        case "nominal":
            return <StringIcon fontSize="inherit" />;
        case "ordinal":
            return <BarChartIcon fontSize="inherit" />;
        case "temporal":
            return <DateIcon fontSize="inherit" />;
        case "auto":
            return <AutoFixHighIcon fontSize="inherit" />;
    }
    return <CommitIcon sx={{opacity: 0.3}} fontSize="inherit" />;
};