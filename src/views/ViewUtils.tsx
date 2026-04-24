// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from "react";
import ts from "typescript";
import { runCodeOnInputListsInVM } from "../app/utils";
import { FieldItem } from "../components/ComponentType";
import { Type } from "../data/types";
import { BooleanIcon, NumericalIcon, StringIcon, DateIcon, UnknownIcon } from '../icons';

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
    return <CommitIcon sx={{opacity: 0.3}} fontSize="inherit" />;
};

/**
 * Format a cell value for display in data tables.
 *
 * - Numbers get thousand separators (e.g. 1,234,567)
 * - Floats are capped at a reasonable number of decimal places
 * - Non-numbers pass through as strings
 */
export const formatCellValue = (value: any): string => {
    if (value == null) return '';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return String(value);
        if (Number.isInteger(value)) {
            return value.toLocaleString('en-US');
        }
        // Determine meaningful decimal places: use up to 4, but trim trailing zeros
        return value.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 4,
        });
    }
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'object') return String(value);
    return String(value);
};

/** Returns 'right' for numeric types, undefined (left) for everything else. */
export const getColumnAlign = (dataType: Type | undefined): 'right' | undefined => {
    if (dataType === Type.Number || dataType === Type.Integer) return 'right';
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