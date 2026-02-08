// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';

import {
    Box,
    Typography,
    Button,
    Tooltip,
    Collapse,
    Card,
} from '@mui/material';

import React from 'react';

import { Chart, Trigger } from "../components/ComponentType";


import '../scss/EncodingShelf.scss';
import { DictTable } from "../components/ComponentType";
import { Type } from '../data/types';
import embed from 'vega-embed';

import { getTriggers, assembleVegaChart } from '../app/utils';

import { getChartTemplate } from '../components/ChartTemplates';
import { checkChartAvailability, generateChartSkeleton } from './VisualizationView';

import TableRowsIcon from '@mui/icons-material/TableRowsOutlined';
import InsightsIcon from '@mui/icons-material/Insights';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { AppDispatch } from '../app/store';

import { EncodingShelfCard, TriggerCard } from './EncodingShelfCard';

import { useTheme, alpha } from '@mui/material/styles';

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
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

    let WIDTH = boxWidth || 120;
    let HEIGHT = boxHeight || 80;

    let chartTemplate = getChartTemplate(chart.chartType);

    let available = checkChartAvailability(chart, conceptShelfItems, tableRows);

    if (chart.chartType == "Auto") {
        return <Box sx={{ position: "relative", display: "flex", flexDirection: "column", margin: 'auto', color: 'darkgray' }}>
            <InsightsIcon fontSize="large"/>
        </Box>
    }

    if (!available || chart.chartType == "Table") {
        return <Box sx={{ margin: "auto" }} >
            {generateChartSkeleton(chartTemplate?.icon, 64, 64)}
        </Box>
    } 

    // if (chart.chartType == "Table") {
    //     return renderTableChart(chart, conceptShelfItems, tableRows);
    // }

    // prepare the chart to be rendered
    let assembledChart = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, tableRows, tableMetadata, 20);
    assembledChart["background"] = "transparent";
    // chart["autosize"] = {
    //     "type": "fit",
    //     "contains": "padding"
    // };

    const id = `chart-thumbnail-${chart.id}-${(Math.random() + 1).toString(36).substring(7)}`;
    const element = <Box id={id} sx={{ margin: "auto", backgroundColor: chart.saved ? "rgba(255,215,0,0.05)" : "white" }}></Box>;

    // Temporary fix, down sample the dataset
    if (assembledChart["data"]["values"].length > serverConfig.MAX_DISPLAY_ROWS) {
        let values = assembledChart["data"]["values"];
        assembledChart = (({ data, ...o }) => o)(assembledChart);

        let getRandom = (seed: number) => {
            let x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        }
        let getRandomSubarray = (arr: any[], size: number) => {
            let shuffled = arr.slice(0), i = arr.length, temp, index;
            while (i--) {
                index = Math.floor((i + 1) * getRandom(233 * i + 888));
                temp = shuffled[index];
                shuffled[index] = shuffled[i];
                shuffled[i] = temp;
            }
            return shuffled.slice(0, size);
        }
        assembledChart["data"] = { "values": getRandomSubarray(values, serverConfig.MAX_DISPLAY_ROWS) };
    }

    assembledChart['config'] = {
        "axis": {"labelLimit": 30}
    }

    embed('#' + id, assembledChart, { actions: false, renderer: "canvas" }).then(function (result) {
        // Access the Vega view instance (https://vega.github.io/vega/docs/api/view/) as result.view
        if (result.view.container()?.getElementsByTagName("canvas")) {
            let comp = result.view.container()?.getElementsByTagName("canvas")[0];

            // Doesn't seem like width & height are actual numbers here on Edge bug
            // let width = parseInt(comp?.style.width as string);
            // let height = parseInt(comp?.style.height as string);
            if (comp) {
                const { width, height } = comp.getBoundingClientRect();
                //console.log(`THUMB: width = ${width} height = ${height}`);

                if (width > WIDTH || height > HEIGHT) {
                    let ratio = width / height;
                    let fixedWidth = width;
                    if (ratio * HEIGHT < width) {
                        fixedWidth = ratio * HEIGHT;
                    }
                    if (fixedWidth > WIDTH) {
                        fixedWidth = WIDTH;
                    }
                    //console.log("THUMB: width or height are oversized");
                    //console.log(`THUMB: new width = ${fixedWidth}px height = ${fixedWidth / ratio}px`)
                    comp?.setAttribute("style", 
                        `max-width: ${WIDTH}px; max-height: ${HEIGHT}px; width: ${Math.round(fixedWidth)}px; height: ${Math.round(fixedWidth / ratio)}px; `);
                }
            } else {
                console.log("THUMB: Could not get Canvas HTML5 element")
            }
        }
    }).catch((reason) => {
        // console.log(reason)
        // console.error(reason)
    });

    return element;
}

export const EncodingShelfThread: FC<EncodingShelfThreadProps> = function ({ chartId }) {

    const [collapseEditor, setCollapseEditor] = useState(false);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    let allCharts = useSelector(dfSelectors.getAllCharts);

    let chart = allCharts.find(c => c.id == chartId) as Chart;
    let chartTrigger = chart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == chartId)?.derive?.trigger : undefined;

    let t = tables.find(t => t.id == chart.tableRef) as DictTable;
    let activeTableThread = [...getTriggers(t, tables).map(tr => tr.tableId), chart.tableRef];
    
    const dispatch = useDispatch<AppDispatch>();

    const theme = useTheme();
    const TIMELINE_WIDTH = 16;
    const dashedColor = 'rgba(0,0,0,0.15)';
    const dashedWidth = '1px';
    const dashedStyle = 'dashed';

    let previousInstructions : any = ""

    let buildTimelineTableRow = (tableId: string, isFirst: boolean, isLast: boolean) => {
        let table = tables.find(t => t.id == tableId) as DictTable;
        return (
            <Box key={`timeline-table-${tableId}`} sx={{ display: 'flex', flexDirection: 'row' }}>
                <Box sx={{ width: TIMELINE_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    {!isFirst && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 4, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />}
                    {isFirst && <Box sx={{ flex: '1 1 0', minHeight: 4 }} />}
                    <Box sx={{ flexShrink: 0, zIndex: 1 }}>
                        <TableRowsIcon sx={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }} />
                    </Box>
                    {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 4, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />}
                    {isLast && <Box sx={{ flex: '1 1 0', minHeight: 4 }} />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, display: 'flex', alignItems: 'center' }}>
                    <Typography 
                        sx={{ fontSize: '11px', cursor: 'pointer', color: theme.palette.primary.main, '&:hover': { textDecoration: 'underline' } }} 
                        onClick={() => { dispatch(dfActions.setFocusedTable(tableId)) }}>
                        {table?.displayId || tableId}
                    </Typography>
                </Box>
            </Box>
        );
    };

    let buildTimelineTriggerRow = (trigger: Trigger) => {
        const triggerColor = alpha(theme.palette.custom.main, 0.4);
        return (
            <Box key={`timeline-trigger-${trigger.tableId}`} sx={{ display: 'flex', flexDirection: 'row' }}>
                <Box sx={{ width: TIMELINE_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Box sx={{ width: 0, flex: '0 0 auto', height: 6, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                    <Box sx={{ width: 2, flex: '1 1 0', minHeight: 4, borderRadius: '2px', backgroundColor: triggerColor }} />
                    <Box sx={{ width: 0, flex: '0 0 auto', height: 6, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, py: 0.25 }}>
                    <TriggerCard 
                        className="encoding-shelf-trigger-card" 
                        trigger={trigger} 
                        hideFields={trigger.instruction != ""} 
                        mini={true} />
                </Box>
            </Box>
        );
    };

    let buildTimelineEllipsisRow = () => (
        <Box key="timeline-ellipsis" sx={{ display: 'flex', flexDirection: 'row' }}>
            <Box sx={{ width: TIMELINE_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Box sx={{ width: 0, flex: '1 1 0', minHeight: 4, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ fontSize: '10px', color: 'text.disabled' }}>…</Typography>
            </Box>
        </Box>
    );

    let tableList = activeTableThread.map((tableId) => {
        let table = tables.find(t => t.id == tableId) as DictTable;
        if (!table) {
            return null;
        }
        return tableId;
    }).filter(x => x !== null) as string[];

    let leafTable = tables.find(t => t.id == activeTableThread[activeTableThread.length - 1]) as DictTable;

    let triggers = getTriggers(leafTable, tables)

    // Simplified timeline: source table → (…) → last trigger → current table
    let timelineRows: React.ReactNode[] = [];
    if (tableList.length > 0) {
        // Source table
        timelineRows.push(buildTimelineTableRow(tableList[0], true, false));
        // Ellipsis if intermediate steps were skipped
        if (tableList.length > 2) {
            timelineRows.push(buildTimelineEllipsisRow());
        }
        // Most recent trigger (if any)
        if (triggers.length > 0) {
            timelineRows.push(buildTimelineTriggerRow(triggers[triggers.length - 1]));
        }
        // Current table (if different from source)
        if (tableList.length > 1) {
            timelineRows.push(buildTimelineTableRow(tableList[tableList.length - 1], false, true));
        }
    }

    previousInstructions = (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {timelineRows}
        </Box>
    );

    let postInstruction : any = "";
    if (chartTrigger) {
        
        let resultTable = tables.find(t => t.id == chartTrigger.resultTableId) as DictTable;
        let leafUserCharts = allCharts.filter(c => c.tableRef == resultTable.id).filter(c => c.source == "user");

        let endChartCards = leafUserCharts.map((c) => {
            return <Card key={`end-chart-${c.id}`} variant="outlined" className={"hover-card"} 
                            onClick={() => { 
                                dispatch(dfActions.setFocusedChart(c.id));
                                dispatch(dfActions.setFocusedTable(c.tableRef));
                            }}
                sx={{padding: '2px 0 2px 0', display: 'flex', alignItems: "left", width: 'fit-content', "& canvas": {'margin': 1}}}>
                <ChartElementFC chart={c} tableRows={resultTable.rows.slice(0, 100)} tableMetadata={resultTable.metadata} boxWidth={200} boxHeight={160}/>
            </Card>
        })

        postInstruction = <Collapse orientation="vertical" in={true} sx={{width: "100%"}}>
            {buildTimelineTableRow(resultTable.id, false, endChartCards.length === 0)}
            {endChartCards.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                    <Box sx={{ width: TIMELINE_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 4, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, py: 0.5, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {endChartCards}
                    </Box>
                </Box>
            )}
        </Collapse>
    }

    // Connector between previousInstructions and EncodingShelfCard
    const timelineConnector = (
        <Box sx={{ display: 'flex', flexDirection: 'row' }}>
            <Box sx={{ width: TIMELINE_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Box sx={{ width: 0, flex: '1 1 0', minHeight: 8, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
            </Box>
        </Box>
    );

    const encodingShelf = (
        <Box className="encoding-shelf-compact" sx={{height: '100%',
            width: 236,
            overflowY: 'auto',
            transition: 'height 150ms cubic-bezier(0.4, 0, 0.2, 1) 0ms',
            alignItems: 'flex-start',
            paddingRight: '8px',
        }}>
            {previousInstructions}
            {timelineConnector}
            <EncodingShelfCard chartId={chartId}/>
            {postInstruction}
            <Box sx={{height: '12px'}}></Box>
        </Box>
    )

    return <Collapse 
        key='encoding-shelf'
        collapsedSize={64} in={!collapseEditor} orientation='horizontal' 
        sx={{
            position: 'relative',
            '& .MuiCollapse-wrapper': {
                '& .MuiCollapse-wrapperInner': {
                    '&::after': collapseEditor ? {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        width: '20px',
                        height: '100%',
                        background: 'linear-gradient(to right, transparent, rgba(255,255,255,1))',
                        pointerEvents: 'none',
                        zIndex: 1
                    } : {}
                }
            }
        }}>
        <Box sx={{display: 'flex', flexDirection: 'row', height: '100%', 
            position: 'relative',
        }}>
            <Tooltip placement="left" title={collapseEditor ? "open editor" : "hide editor"}>
                <Button color="primary"
                        sx={{width: 18, minWidth: 18, p: 0}}
                    onClick={()=>{setCollapseEditor(!collapseEditor)}}
                >{collapseEditor ? <ChevronLeftIcon sx={{fontSize: 18}} /> : <ChevronRightIcon sx={{fontSize: 18}} />}</Button>
            </Tooltip>
            {encodingShelf}
        </Box>
    </Collapse>;
}
