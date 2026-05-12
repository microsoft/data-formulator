// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Shared chart utility functions — extracted from VisualizationView to break
// circular dependencies between views.

import React from 'react';
import { Box } from '@mui/material';
import AddchartIcon from '@mui/icons-material/Addchart';
import { Chart, DictTable, EncodingItem, EncodingMap, FieldItem } from '../components/ComponentType';

export let generateChartSkeleton = (icon: any, width: number = 160, height: number = 160, opacity: number = 0.5) => (
    <Box width={width} height={height} sx={{ display: "flex" }}>
        {icon == undefined ?
            <AddchartIcon sx={{ color: "lightgray", margin: "auto" }} /> :
            typeof icon == 'string' ?
                <Box width="100%" sx={{ display: "flex", opacity: opacity }}>
                    <img height={Math.min(64, height)} width={Math.min(64, width)}
                         style={{ maxHeight: Math.min(height, Math.max(32, 0.5 * height)), maxWidth: Math.min(width, Math.max(32, 0.5 * width)), margin: "auto" }} 
                         src={icon} alt="" role="presentation" />
                </Box> :
                <Box width="100%" sx={{ display: "flex", opacity: opacity }}>
                    {React.cloneElement(icon, {
                        style: { 
                            maxHeight: Math.min(height, 32),
                            maxWidth: Math.min(width, 32), 
                            margin: "auto" 
                        }
                    })}
                </Box>}
    </Box>
)

export let getDataTable = (chart: Chart, tables: DictTable[], charts: Chart[], 
                           conceptShelfItems: FieldItem[], ignoreTableRef = false) => {
    // given a chart, determine which table would be used to visualize the chart

    // return the table directly
    if (chart.tableRef && !ignoreTableRef) {
        return tables.find(t => t.id == chart.tableRef) as DictTable;
    }

    let activeFields = conceptShelfItems.filter((field) => Array.from(Object.values(chart.encodingMap)).map((enc: EncodingItem) => enc.fieldID).includes(field.id));

    let workingTableCandidates = tables.filter(t => {
        return activeFields.every(f => t.names.includes(f.name));
    });
    
    let confirmedTableCandidates = workingTableCandidates.filter(t => !charts.some(c => c.saved && c.tableRef == t.id));
    if(confirmedTableCandidates.length > 0) {
        return confirmedTableCandidates[0];
    } else if (workingTableCandidates.length > 0) {
        return workingTableCandidates[0];
    } else {
        // sort base tables based on how many active fields are covered by existing tables
        return tables.filter(t => t.derive == undefined).sort((a, b) => activeFields.filter(f => a.names.includes(f.name)).length 
                                        - activeFields.filter(f => b.names.includes(f.name)).length).reverse()[0];
    }
}

export let checkChartAvailability = (chart: Chart, conceptShelfItems: FieldItem[], visTableRows: any[]) => {
    let visFieldIds = Object.keys(chart.encodingMap)
            .filter(key => chart.encodingMap[key as keyof EncodingMap].fieldID != undefined)
            .map(key => chart.encodingMap[key as keyof EncodingMap].fieldID);
    let visFields = conceptShelfItems.filter(f => visFieldIds.includes(f.id));
    return visFields.length > 0 && visTableRows.length > 0 && visFields.every(f => Object.keys(visTableRows[0]).includes(f.name));
}
