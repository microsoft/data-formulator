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
} from '@mui/material';

import React from 'react';

import { EncodingItem, ConceptTransformation, Chart, FieldItem, Trigger } from "../components/ComponentType";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import { createDictTable, DictTable } from "../components/ComponentType";
import embed from 'vega-embed';

import { getTriggers, getUrls, assembleChart, resolveChartFields } from '../app/utils';

import { getChartTemplate } from '../components/ChartTemplates';
import { chartAvailabilityCheck, generateChartSkeleton } from './VisualizationView';
import TableRowsIcon from '@mui/icons-material/TableRowsOutlined';
import InsightsIcon from '@mui/icons-material/Insights';

import { findBaseFields } from './ViewUtils';
import { AppDispatch } from '../app/store';

import { EncodingShelfCard, TriggerCard } from './EncodingShelfCard';
import ChangeCircleOutlinedIcon from '@mui/icons-material/ChangeCircleOutlined';
import { Type } from '../data/types';

// Property and state of an encoding shelf
export interface EncodingShelfThreadProps { 
    chartId: string,
}

export let ChartElementFC: FC<{chart: Chart, tableRows: any[], boxWidth?: number, boxHeight?: number}> = function({chart, tableRows, boxWidth, boxHeight}) {

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let WIDTH = boxWidth || 120;
    let HEIGHT = boxHeight || 80;

    let chartTemplate = getChartTemplate(chart.chartType);

    let [available, unfilledFields] = chartAvailabilityCheck(chart.encodingMap, conceptShelfItems, tableRows);

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
    let assembledChart = assembleChart(chart, conceptShelfItems, tableRows);
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

let selectBaseTables = (activeFields: FieldItem[], conceptShelfItems: FieldItem[], tables: DictTable[]) : DictTable[] => {
    
    // if there is no active fields at all!!
    if (activeFields.length == 0) {
        return [tables[0]];
    }

    let activeBaseFields = conceptShelfItems.filter((field) => {
        return activeFields.map(f => f.source == "derived" ? findBaseFields(f, conceptShelfItems).map(f2 => f2.id) : [f.id]).flat().includes(field.id);
    });

    let activeOriginalFields = activeBaseFields.filter(field => field.source == "original");
    let activeCustomFields = activeBaseFields.filter(field => field.source == "custom");
    let activeDerivedFields = activeFields.filter(f => f.source == "derived");

    if (activeOriginalFields.length == 0 && activeFields.length > 0 && tables.length > 0) {
        return [tables[0]];
    }

    let baseTables = tables.filter(t => activeOriginalFields.map(f => f.tableRef as string).includes(t.id));

    return baseTables
}

export const EncodingShelfThread: FC<EncodingShelfThreadProps> = function ({ chartId }) {

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const charts = useSelector((state: DataFormulatorState) => state.charts);
    let activeThreadChartId = useSelector((state: DataFormulatorState) => state.activeThreadChartId);
    let activeModel = useSelector(dfSelectors.getActiveModel);
    
    let [reformulateRunning, setReformulteRunning] = useState<boolean>(false);

    let activeThreadChart = charts.find(c => c.id == activeThreadChartId);
    let activeTableThread : string[] = [];
    if (activeThreadChart != undefined) {
        let t = tables.find(t => t.id == (activeThreadChart as Chart).tableRef) as DictTable;
        activeTableThread = getTriggers(t, tables).map(tr => tr.tableId);
        activeTableThread = [...activeTableThread, (activeThreadChart as Chart).tableRef];
    }

    let chart = charts.find(chart => chart.id == chartId) as Chart;

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const dispatch = useDispatch<AppDispatch>();

    const interleaveArrays: any = (a: any[], b: any[], spaceElement?: any) => a.length ? [a[0], spaceElement || '',...interleaveArrays(b, a.slice(1), spaceElement)] : b;

    let previousInstructions : any = ""

    let reFormulate = (trigger: Trigger) => {

        let mode = 'formulate';

        let sourceTable = tables.find(t => t.id == trigger.tableId) as DictTable;
        let overrideTableId = trigger.resultTableId;

        let baseTableIds = sourceTable.derive?.source || [sourceTable.id];
        let baseTables = tables.filter(t => baseTableIds.includes(t.id));
        if (baseTables.length == 0) {
            return;
        }

        // these two items decides what fields and prompt will be used
        let triggerChart = charts.find(c => c.id == trigger.chartRef) as Chart;
        let prompt = trigger.instruction;

        // derive active fields from encoding map so that we can keep the order of which fields will be visualized
        let activeFields = Object.values(triggerChart.encodingMap).map(enc => enc.fieldID).filter(fieldId => fieldId && conceptShelfItems.map(f => f.id)
                .includes(fieldId)).map(fieldId => conceptShelfItems.find(f => f.id == fieldId) as FieldItem);
        let activeBaseFields = activeFields.map(f => f.source == 'derived' ? (f.transform as ConceptTransformation).parentIDs : [f.id])
                .flat().map(fieldId => conceptShelfItems.find(f => f.id == fieldId) as FieldItem)

        dispatch(dfActions.clearUnReferencedTables());
        dispatch(dfActions.setVisPaneSize(640));

        let fieldNamesStr = activeFields.map(f => f.name).reduce(
            (a: string, b: string, i, array) => a + (i < array.length - 1 ? ', ' : ' and ') + b, "")

        let token = String(Date.now());

        // if nothing is specified, just a formulation from the beginning
        let messageBody = JSON.stringify({
            token: token,
            mode,
            input_tables: baseTables.map(t => {return { name: t.id.replace(/\.[^/.]+$/ , ""), rows: t.rows }}),
            new_fields: activeBaseFields.map(f => { return {name: f.name} }),
            extra_prompt: prompt,
            model: activeModel
        }) 
        let engine = getUrls().SERVER_DERIVE_DATA_URL;

        console.log("current log")
        console.log(sourceTable.derive?.dialog)


        if (mode == "formulate" && sourceTable.derive?.dialog) {
            messageBody = JSON.stringify({
                token: token,
                mode,
                input_tables: baseTables.map(t => {return { name: t.id.replace(/\.[^/.]+$/ , ""), rows: t.rows }}),
                output_fields: activeBaseFields.map(f => { return {name: f.name } }),
                dialog: sourceTable.derive?.dialog,
                new_instruction: prompt,
                model: activeModel
            })
            engine = getUrls().SERVER_REFINE_DATA_URL;
        }

        let message = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: messageBody,
        };

        dispatch(dfActions.changeChartRunningStatus({chartId, status: true}))

        // timeout the request after 30 seconds
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        setReformulteRunning(true);
    
        fetch(engine, {...message, signal: controller.signal })
            .then((response) => response.json())
            .then((data) => {

                setReformulteRunning(false);
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}))
                console.log(data);
                console.log(token);
                if (data.results.length > 0) {
                    if (data["token"] == token) {
                        let candidates = data.results.filter((item: any) => {
                            return item["status"] == "ok" && item["content"].length > 0 
                        });

                        if (candidates.length == 0) {
                            let errorMessage = data.results[0].content;
                            let code = data.results[0].code;
                            dispatch(dfActions.addMessages({
                                "timestamp": Date.now(),
                                "type": "error",
                                "value": `Data formulation failed, please retry.`,
                                "code": code,
                                "detail": errorMessage
                            }));
                        } else {

                            let candidateTableId = overrideTableId;

                            // process candidate table
                            let candidate = candidates[0];
                            let candidateTable = createDictTable(
                                candidateTableId, 
                                candidate["content"],
                                {   code: candidate["code"], 
                                    codeExpl: "",
                                    source: baseTables.map(t => t.id), 
                                    dialog: candidate["dialog"], 
                                    trigger: trigger 
                                }
                            )

                            let names = candidateTable.names;
                            let missingNames = names.filter(name => !conceptShelfItems.some(field => field.name == name));
                
                            let conceptsToAdd = missingNames.map((name) => {
                                return {
                                    id: `concept-${name}-${Date.now()}`, name: name, type: "auto" as Type, 
                                    description: "", source: "custom", temporary: true, domain: [],
                                } as FieldItem
                            });

                            // concepts from the current table
                            let currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...conceptsToAdd];
                            
                            dispatch(dfActions.addConceptItems(conceptsToAdd));
                            dispatch(dfActions.overrideDerivedTables(candidateTable));
                            dispatch(fetchFieldSemanticType(candidateTable));
                            dispatch(fetchCodeExpl(candidateTable));

                            if (triggerChart.chartType != "Auto" && charts.find(c => c.tableRef == overrideTableId)) { 
                                let cId = [...charts.filter(c => c.intermediate == undefined), ...charts].find(c => c.tableRef == overrideTableId)?.id;
                                dispatch(dfActions.setFocusedChart(cId));
                            } else {
                                let refinedGoal = candidate['refined_goal']

                                let newChart : Chart; 
                                if (triggerChart.chartType == "Auto") {
                                    let chartTypeMap : any = {
                                        "line" : "Line Chart",
                                        "bar": "Bar Chart",
                                        "point": "Scatter Plot",
                                        "boxplot": "Boxplot"
                                    }
                                    let chartType = chartTypeMap[refinedGoal['chart_type']] || 'Scatter Plot';
                                    newChart = generateFreshChart(candidateTable.id, chartType) as Chart;
                                } else if (chart.chartType == "Table") {
                                    newChart = generateFreshChart(candidateTable.id, 'Table')
                                } else {
                                    newChart = JSON.parse(JSON.stringify(chart)) as Chart;
                                    newChart.id = `chart-${Date.now()- Math.floor(Math.random() * 10000)}`;
                                    newChart.saved = false;
                                    newChart.tableRef = candidateTable.id;
                                    newChart.intermediate = undefined;
                                }

                                newChart = resolveChartFields(newChart, currentConcepts, refinedGoal, candidateTable)
                                
                                dispatch(dfActions.addChart(newChart));
                                dispatch(dfActions.setFocusedChart(newChart.id));                                
                            }

                            // special treatment to clean up "Auto" charts
                            if (triggerChart.chartType == 'Auto') {
                                dispatch(dfActions.deleteChartById(chartId));
                            }

                            dispatch(dfActions.clearUnReferencedTables());
                            dispatch(dfActions.clearUnReferencedCustomConcepts());
                            dispatch(dfActions.setFocusedTable(candidateTable.id));

                            dispatch(dfActions.addMessages({
                                "timestamp": Date.now(),
                                "type": "success",
                                "value": `Data formulation for ${fieldNamesStr} succeeded.`
                            }));
                        }
                    }
                } else {
                    // TODO: add warnings to show the user
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "type": "error",
                        "value": "No result is returned from the data formulation agent. Please try again."
                    }));
                }
            }).catch((error) => {
                setReformulteRunning(false);
           
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}));
                dispatch(dfActions.addMessages({
                    "timestamp": Date.now(),
                    "type": "error",
                    "value": `Data formulation failed, please try again.`,
                    "detail": error.message
                }));
            });
    }

    //let triggers = currentTable.derive.triggers;
    let tableList = activeTableThread.map((tableId) => <div
        key={tableId}
        className="table-list-item">
        <Button variant="text" sx={{textTransform: 'none', padding: 0, minWidth: 0}} onClick={() => { dispatch(dfActions.setFocusedTable(tableId)) }}>
            <Stack direction="row" sx={{fontSize: '12px'}} alignItems="center" gap={"2px"}>
                <TableRowsIcon fontSize="inherit" />
                <Typography sx={{fontSize: '12px'}} >
                    {tableId} 
                </Typography>
            </Stack>
        </Button>
    </div>);

    let tableCards = activeTableThread.map((tableId) => 
        <Card 
            key={tableId}
            variant='outlined' sx={{padding: '2px 0 2px 0'}}>
            <Button variant="text" sx={{textTransform: 'none', padding: 0, marginLeft: 1, minWidth: 0}} onClick={() => { dispatch(dfActions.setFocusedTable(tableId)) }}>
                <Stack direction="row" sx={{fontSize: '12px'}} alignItems="center" gap={"2px"}>
                    <TableRowsIcon fontSize="inherit" />
                    <Typography sx={{fontSize: '12px'}} >
                        {tableId} 
                    </Typography>
                </Stack>
            </Button>
        </Card>);

    let leafTable = tables.find(t => t.id == activeTableThread[activeTableThread.length - 1]) as DictTable;
    let triggers =  getTriggers(leafTable, tables) //leafTable.derive?.triggers || [];
    let instructionCards = triggers.map((trigger, i) => {
        let extractActiveFields = (t: Trigger) => {
            let encodingMap = (charts.find(c => c.id == t.chartRef) as Chart).encodingMap
            return Array.from(Object.values(encodingMap)).map((enc: EncodingItem) => enc.fieldID).filter(x => x != undefined)
        };

        let previousActiveFields = new Set(i == 0 ? [] : extractActiveFields(triggers[i - 1]))
        let currentActiveFields = new Set(extractActiveFields(trigger))
        let fieldsIdentical = _.isEqual(previousActiveFields, currentActiveFields)

        return  <Box 
                    key={trigger.tableId}
                    sx={{padding: 0, display: 'flex'}}>
                    {/* <SouthIcon sx={{fontSize: "inherit", margin: 'auto 4px'}} /> */}
                    <Box sx={{minWidth: '1px', padding: '0px', width: '17px',  flex: 'none', display: 'flex', flexDirection: 'column'
                              //borderLeft: '1px dashed darkgray',
                            }}>
                        <Box sx={{padding:0, width: '1px', margin:'auto', height: '100%',
                                    backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                                    backgroundSize: '1px 6px, 3px 100%'}}></Box>
                        {/* <Box sx={{marginLeft: "6px", marginTop: '-10px', marginBottom: '-4px'}}><PanoramaFishEyeIcon sx={{fontSize: 5}}/></Box>
                        <Box sx={{padding:0, width: '1px', margin:'auto', height: '49%',
                                               backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                            backgroundSize: '1px 6px, 3px 100%'}}></Box> */}
                    </Box>
                    <TriggerCard className="encoding-shelf-trigger-card" trigger={trigger} hideFields={fieldsIdentical} />
                    {i == triggers.length - 1 && chart.intermediate == undefined ? 
                        <Tooltip title={`reformulate: override ${chart.tableRef}`}>
                            <IconButton color="warning" size="small"
                                onClick={() => {
                                    reFormulate(triggers[triggers.length - 1]);
                                }}
                            >{reformulateRunning ? <CircularProgress size={18} color="warning" /> : <ChangeCircleOutlinedIcon />}</IconButton>
                        </Tooltip> 
                        : ""}
                </Box>;
    })
    
    let spaceElement = "" //<Box sx={{padding: '4px 0px', background: 'aliceblue', margin: 'auto', width: '200px', height: '3px', paddingBottom: 0.5}}></Box>;

    let cutIndex = activeTableThread.findIndex((s) => s == chart.tableRef)

    let tableCardsSublist = tableList.slice(0, cutIndex + 1);
    let instructionCardsSublist = instructionCards.slice(0, cutIndex);

    previousInstructions = 
        <Collapse orientation="vertical" in={true} sx={{width: "100%" }}>
            <Box  sx={{padding: '4px 0px', display: 'flex', flexDirection: "column" }}>
                {interleaveArrays(tableCardsSublist, instructionCardsSublist, spaceElement)}
                {/* {w(tableList.slice(0, tableList.length - 1), instructionList.slice(0, instructionList.length - 1))}  */}
                {/* <Button sx={{minWidth: '24px'}}><RestartAlt /></Button> */}
            </Box>
        </Collapse>

    let postInstruction : any = "";
    if (chart.intermediate) {

        let activeThreadChart = (activeThreadChartId ?  charts.find(c => c.id == activeThreadChartId) :
                                (charts.find(c => c.intermediate == undefined && c.tableRef == activeTableThread[activeTableThread.length - 1]))) as Chart;
        let endChartId = activeThreadChart.id;

        let activeEndChartTable = tables.find(t => t.id == activeThreadChart.tableRef) as DictTable;
        let endChartCard = <Card variant="outlined" className={"hover-card"} 
                            onClick={() => { 
                                dispatch(dfActions.setFocusedChart(endChartId));
                                dispatch(dfActions.setFocusedTable(activeThreadChart.tableRef));
                            }}
                sx={{padding: '2px 0 2px 0', display: 'flex', alignItems: "left", width: 'fit-content', "& canvas": {'margin': 1}}}>
                <ChartElementFC chart={activeThreadChart} tableRows={activeEndChartTable.rows} boxWidth={200} boxHeight={160}/>
            </Card>

        let postInstructEndPoint = activeTableThread.findIndex(s => s == activeThreadChart.tableRef);
        postInstruction = <Collapse orientation="vertical" in={true} sx={{width: "100%"}}>
                <Box  sx={{padding: '4px 0px', display: 'flex', flexDirection: "column" }}>
                    {interleaveArrays([<Box
                        key="post-instruction"
                        sx={{width: '17px', height: '12px'}}>
                            <Box sx={{padding:0, width: '1px', margin:'auto', height: '100%',
                                                    backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                                                    backgroundSize: '1px 6px, 3px 100%'}}></Box>
                        </Box>, ...instructionCards.slice(cutIndex+1, postInstructEndPoint)], 
                        tableList.slice(cutIndex + 1, postInstructEndPoint + 1), spaceElement)}
                    {/* {w(Array(tableList.length - (cutIndex) - 1).fill(
                        <Box sx={{padding: '2px 0 2px 0', display: 'flex', alignItems: "center"}}>
                            <SouthIcon sx={{fontSize: "inherit", margin: 'auto 4px'}} />
                        </Box>), 
                        tableList.slice(cutIndex + 1), spaceElement)} */}
                    {/* {w(tableList.slice(0, tableList.length - 1), instructionList.slice(0, instructionList.length - 1))}  */}
                    {/* <Button sx={{minWidth: '24px'}}><RestartAlt /></Button> */}
                </Box>
                <Box>
                    {endChartCard}
                </Box>
            </Collapse>
    }

    // console.log(JSON.stringify(visSpec));

    const encodingShelf = (
        <Box className="encoding-shelf-compact" sx={{height: '100%'}}>
            {/* <Box key='view-title' className="view-title-box">
                <Typography className="view-title" component="h2"  sx={{marginTop: "6px"}}>
                    Chart Builder - <Typography component="span" color="blueviolet">{chart.id.substr(-4)}</Typography>
                </Typography>
            </Box> */}
             {[   
                <Box
                    key="encoding-shelf" 
                    sx={{display: 'flex'}}> 
                    {previousInstructions}
                </Box>,
                // <Box sx={{padding: '4px 0px', background: 'aliceblue', margin: 'auto', width: '200px', height: '6px', paddingBottom: 0.5}}></Box>
            ]}
            <Box sx={{width: '17px', height: '12px'}}>
                <Box sx={{padding:0, width: '1px', margin:'auto', height: '100%',
                                        backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                                        backgroundSize: '1px 6px, 3px 100%'}}></Box>
            </Box>
            <EncodingShelfCard chartId={chartId} trigger={chart.intermediate} />
            {postInstruction}
            <Box sx={{height: '12px'}}></Box>
        </Box>
    )

    return encodingShelf;
}
