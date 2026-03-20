// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC } from 'react'
import { useSelector } from 'react-redux'
import { DataFormulatorState, dfSelectors } from '../app/dfSlice';

import {
    Box,
} from '@mui/material';

import React from 'react';

import { Chart } from "../components/ComponentType";


import '../scss/EncodingShelf.scss';
import { Type } from '../data/types';

import { getChartTemplate } from '../components/ChartTemplates';
import { checkChartAvailability, generateChartSkeleton } from './VisualizationView';

import { InsightIcon } from '../icons';


import { EncodingShelfCard } from './EncodingShelfCard';

// Property and state of an encoding shelf
export interface EncodingShelfThreadProps { 
    chartId: string,
}

export let ChartElementFC: FC<{
    chart: Chart, 
    tableRows: any[], 
    tableMetadata: {[key: string]: {type: Type, semanticType: string, levels: any[]}}, 
    boxWidth?: number, boxHeight?: number}> = function({chart, tableRows, tableMetadata, boxWidth, boxHeight}) {

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let WIDTH = boxWidth || 120;
    let HEIGHT = boxHeight || 80;

    let chartTemplate = getChartTemplate(chart.chartType);

    let available = checkChartAvailability(chart, conceptShelfItems, tableRows);

    if (chart.chartType == "Auto") {
        return <Box sx={{ position: "relative", display: "flex", flexDirection: "column", margin: 'auto', color: 'darkgray' }}>
            <InsightIcon fontSize="large"/>
        </Box>
    }

    if (!available || chart.chartType == "Table") {
        return <Box sx={{ margin: "auto" }} >
            {generateChartSkeleton(chartTemplate?.icon, 64, 64)}
        </Box>
    } 

    // Use cached thumbnail from ChartRenderService when available
    if (chart.thumbnail) {
        return (
            <Box sx={{ margin: "auto", display: 'flex', justifyContent: 'center', alignItems: 'center',
                       backgroundColor: chart.saved ? "rgba(255,215,0,0.05)" : "white" }}>
                <img 
                    src={chart.thumbnail} 
                    alt={`${chart.chartType} chart`}
                    style={{ maxWidth: WIDTH, maxHeight: HEIGHT, objectFit: 'contain' }} 
                />
            </Box>
        );
    }

    // Fallback: skeleton while ChartRenderService is processing
    return (
        <Box sx={{ margin: "auto", display: 'flex', justifyContent: 'center', alignItems: 'center',
                   width: WIDTH, height: HEIGHT }}>
            {generateChartSkeleton(chartTemplate?.icon, 48, 48, 0.3)}
        </Box>
    );
}

export const EncodingShelfThread: FC<EncodingShelfThreadProps> = function ({ chartId }) {

    const encodingShelf = (
        <Box className="encoding-shelf-compact" sx={{height: '100%',
            width: 270,
            overflowY: 'auto',
            transition: 'height 150ms cubic-bezier(0.4, 0, 0.2, 1) 0ms',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            px: '8px',
            pt: '8px',
        }}>
            <EncodingShelfCard chartId={chartId}/>
        </Box>
    )

    return encodingShelf;
}
