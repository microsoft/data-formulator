// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from "react";
import ts from "typescript";
import { runCodeOnInputListsInVM } from "../app/utils";
import { ConceptTransformation, FieldItem } from "../components/ComponentType";
import { Type } from "../data/types";
import { BooleanIcon, NumericalIcon, StringIcon, DateIcon, UnknownIcon } from '../icons';

import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import BarChartIcon from '@mui/icons-material/BarChart';

import prettier from "prettier";
import parserBabel from 'prettier/parser-babel';
import { DictTable } from '../components/ComponentType';

export const groupConceptItems = (conceptShelfItems: FieldItem[], tables: DictTable[])  => {
    // group concepts based on which source table they belongs to
    return conceptShelfItems.map(f => {
        let group = ""
        if (f.source == "original") {
            group = tables.find(t => t.id == f.tableRef)?.displayId || f.tableRef;
        } else if (f.source == "custom") {
            group = "new fields"
        } else if (f.source == "derived") {
            group = tables.find(t => t.id == f.tableRef)?.displayId || f.tableRef;
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
    return <UnknownIcon fontSize="inherit" />;
};