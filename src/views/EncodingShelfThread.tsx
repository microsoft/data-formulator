// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, generateFreshChart } from '../app/dfSlice';

import {
    Box,
    Typography,
    Button,
    CircularProgress,
    IconButton,
    Tooltip,
    Collapse,
    Stack,
    Card,
    ListItemIcon,
} from '@mui/material';

import React from 'react';

import { EncodingItem, Chart, Trigger } from "../components/ComponentType";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import { DictTable } from "../components/ComponentType";
import { Type } from '../data/types';
import embed from 'vega-embed';

import { getTriggers, assembleVegaChart } from '../app/utils';

import { getChartTemplate } from '../components/ChartTemplates';
import { checkChartAvailability, generateChartSkeleton } from './VisualizationView';

import TableRowsIcon from '@mui/icons-material/TableRowsOutlined';
import InsightsIcon from '@mui/icons-material/Insights';
import AnchorIcon from '@mui/icons-material/Anchor';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import { AppDispatch } from '../app/store';

import { EncodingShelfCard, TriggerCard } from './EncodingShelfCard';

import { useTheme } from '@mui/material/styles';

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
    if (assembledChart["data"]["values"].length > 5000) {
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
        assembledChart["data"] = { "values": getRandomSubarray(values, 5000) };
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

    const interleaveArrays: any = (a: any[], b: any[], spaceElement?: any) => a.length ? [a[0], spaceElement || '',...interleaveArrays(b, a.slice(1), spaceElement)] : b;

    let previousInstructions : any = ""

    let buildTableCard = (tableId: string) => {
        let table = tables.find(t => t.id == tableId) as DictTable;
        return <div
                key={`${tableId}-table-list-item`}
                className="table-list-item">
                <Button variant="text" sx={{textTransform: 'none', padding: 0, minWidth: 0}} onClick={() => { dispatch(dfActions.setFocusedTable(tableId)) }}>
                <Stack direction="row" sx={{fontSize: '12px'}} alignItems="center" gap={"2px"}>
                    {table && table.anchored ? <AnchorIcon fontSize="inherit" /> : <TableRowsIcon fontSize="inherit" />}
                    <Typography sx={{fontSize: '12px'}} >
                        {table.displayId || tableId}
                    </Typography>
                </Stack>
            </Button>
        </div>
    }

    let tableList = activeTableThread.map((tableId) => {
        let table = tables.find(t => t.id == tableId) as DictTable;
        if (!table) {
            return null;
        }
        return buildTableCard(tableId);
    });

    let leafTable = tables.find(t => t.id == activeTableThread[activeTableThread.length - 1]) as DictTable;

    let triggers =  getTriggers(leafTable, tables)

    let instructionCards = triggers.map((trigger, i) => {
        let extractActiveFields = (t: Trigger) => {
            let encodingMap = allCharts.find(c => c.id == t.chart?.id)?.encodingMap;
            if (!encodingMap) {
                return [];
            }
            return Array.from(Object.values(encodingMap)).map((enc: EncodingItem) => enc.fieldID).filter(x => x != undefined)
        };
        let previousActiveFields = new Set(i == 0 ? [] : extractActiveFields(triggers[i - 1]))
        let currentActiveFields = new Set(extractActiveFields(trigger))
        let fieldsIdentical = _.isEqual(previousActiveFields, currentActiveFields)
        return <Box 
            key={`${trigger.tableId}-trigger-card`}
            sx={{padding: 0, display: 'flex', flexDirection: 'column'}}>
            <Box sx={{ml: '8px', height: '4px', borderLeft: '1px solid lightgray'}}></Box>

            <TriggerCard 
                className="encoding-shelf-trigger-card" 
                trigger={trigger} 
                hideFields={trigger.instruction != ""} 
                mini={true} />
            <Box sx={{ml: '8px', height: '4px', borderLeft: '1px solid darkgray'}}></Box>
        </Box>
    })
    
    let spaceElement = "" //<Box sx={{padding: '4px 0px', background: 'aliceblue', margin: 'auto', width: '200px', height: '3px', paddingBottom: 0.5}}></Box>;

    let truncated = tableList.length > 3;

    previousInstructions = truncated ? 
        <Box  sx={{padding: '4px 0px', display: 'flex', flexDirection: "column" }}>
            {tableList[0]}
            <Box sx={{height: '24px', borderLeft: '1px dashed darkgray', 
                position: 'relative',
                ml: '8px', display: 'flex', alignItems: 'center', cursor: 'pointer',
                '&:hover': {
                    ml: '7px',
                    borderLeft: '3px solid darkgray',
                }}}>
                <Typography sx={{fontSize: '12px', color: 'darkgray', ml: 2}}>
                    ...
                </Typography>
            </Box>
            {tableList[tableList.length - 3]}
            {instructionCards[instructionCards.length - 2]}
            {tableList[tableList.length - 2]}
            {instructionCards[instructionCards.length - 1]}
            {tableList[tableList.length - 1]}
        </Box> 
    :
        <Box  sx={{padding: '4px 0px', display: 'flex', flexDirection: "column" }}>
            {interleaveArrays(tableList, instructionCards, spaceElement)}
        </Box>;

    let postInstruction : any = "";
    if (chartTrigger) {
        
        let resultTable = tables.find(t => t.id == chartTrigger.resultTableId) as DictTable;
        let leafUserCharts = allCharts.filter(c => c.tableRef == resultTable.id).filter(c => c.source == "user");

        let endChartCards = leafUserCharts.map((c) => {
            return <Card variant="outlined" className={"hover-card"} 
                            onClick={() => { 
                                dispatch(dfActions.setFocusedChart(c.id));
                                dispatch(dfActions.setFocusedTable(c.tableRef));
                            }}
                sx={{padding: '2px 0 2px 0', display: 'flex', alignItems: "left", width: 'fit-content', "& canvas": {'margin': 1}}}>
                <ChartElementFC chart={c} tableRows={resultTable.rows.slice(0, 100)} tableMetadata={resultTable.metadata} boxWidth={200} boxHeight={160}/>
            </Card>
        })

        postInstruction = <Collapse orientation="vertical" in={true} sx={{width: "100%"}}>
            <Box key="post-instruction" sx={{width: '17px', height: '12px'}}>
                <Box sx={{padding:0, width: '1px', margin:'auto', height: '100%',
                                        backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                                        backgroundSize: '1px 6px, 3px 100%'}}></Box>
            </Box>
            {buildTableCard(resultTable.id)}
            <Box key="post-instruction" sx={{width: '17px', height: '12px'}}>
                <Box sx={{padding:0, width: '1px', margin:'auto', height: '100%',
                                        backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                                        backgroundSize: '1px 6px, 3px 100%'}}></Box>
            </Box>
            <Box sx={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                {endChartCards}
            </Box>
            </Collapse>
    }

    const encodingShelf = (
        <Box className="encoding-shelf-compact" sx={{height: '100%',
            width: 236,
            overflowY: 'auto',
            transition: 'height 300ms cubic-bezier(0.4, 0, 0.2, 1) 0ms',
            alignItems: 'flex-start',
            paddingRight: '8px',
        }}>
             {[   
                <Box
                    key="encoding-shelf" 
                    sx={{display: 'flex'}}> 
                    {previousInstructions}
                </Box>,
            ]}
            <Box sx={{width: '17px', height: '12px'}}>
                <Box sx={{padding:0, width: '1px', margin:'auto', height: '100%',
                                        backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                                        backgroundSize: '1px 6px, 3px 100%'}}></Box>
            </Box>
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
