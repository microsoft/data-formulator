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
    
    let domains = tables.filter(t => Object.keys(t.rows[0]).includes(field.name))
            .map(t => [...new Set(t.rows.map(row => row[field.name]))])
    
    domains = domains.filter((d, i) =>  {
        return !domains.slice(0, i).some(prevD => JSON.stringify(prevD.slice().sort()) == JSON.stringify(d.slice().sort()));
    })
    // if there is no table that includes the given concept, then wrap it around so it is still sound
    return domains.length == 0 ? [[]] : domains;
}

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