// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, generateFreshChart } from '../app/dfSlice';

import {
    Box,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ListSubheader,
    ListItemIcon,
    ListItemText,
    IconButton,
    Tooltip,
    TextField,
    Stack,
    Card,
    Chip,
    Autocomplete,
    Menu,
} from '@mui/material';

import React from 'react';

import { Channel, EncodingItem, ConceptTransformation, Chart, FieldItem, Trigger, duplicateChart, EncodingMap } from "../components/ComponentType";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import { createDictTable, DictTable } from "../components/ComponentType";

import { getUrls, resolveChartFields } from '../app/utils';
import { EncodingBox } from './EncodingBox';

import { ChannelGroups, CHART_TEMPLATES, getChartTemplate } from '../components/ChartTemplates';
import { getDataTable } from './VisualizationView';
import TableRowsIcon from '@mui/icons-material/TableRowsOutlined';
import ChangeCircleOutlinedIcon from '@mui/icons-material/ChangeCircleOutlined';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';

import { AppDispatch } from '../app/store';
import PrecisionManufacturing from '@mui/icons-material/PrecisionManufacturing';
import { Type } from '../data/types';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';

// Property and state of an encoding shelf
export interface EncodingShelfCardProps { 
    chartId: string;
    trigger?: Trigger;
    noBorder?: boolean;
}

let selectBaseTables = (activeFields: FieldItem[], currentTable: DictTable, tables: DictTable[]) : DictTable[] => {
    
    let baseTables = [];

    // if the current table is derived from other tables, then we need to add those tables to the base tables
    if (currentTable.derive && !currentTable.anchored) {
        baseTables = currentTable.derive.source.map(t => tables.find(t2 => t2.id == t) as DictTable);
    } else {
        baseTables.push(currentTable);
    }

    // if there is no active fields at all!!
    if (activeFields.length == 0) {
        return baseTables;
    } else {
        // find what are other tables that was used to derive the active fields
        let relevantTableIds = [...new Set(activeFields.filter(t => t.source != "custom").map(t => t.tableRef))];
        // find all tables that contains the active original fields
        let tablesToAdd = tables.filter(t => relevantTableIds.includes(t.id));

        baseTables.push(...tablesToAdd.filter(t => !baseTables.map(t2 => t2.id).includes(t.id)));
    }

    return baseTables;
}

export const TriggerCard: FC<{className?: string, trigger: Trigger, hideFields?: boolean, label?: string}> = function ({ label, className, trigger, hideFields }) {

    let fieldItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const dispatch = useDispatch<AppDispatch>();

    let encodingComp : any = '';
    let prompt = trigger.instruction ? `"${trigger.instruction}"` : "";

    if (trigger.chart) {

        let chart = trigger.chart;
        let encodingMap = chart?.encodingMap;

        encodingComp = Object.entries(encodingMap)
            .filter(([channel, encoding]) => {
                return encoding.fieldID != undefined;
            })
            .map(([channel, encoding], index) => {
                let field = fieldItems.find(f => f.id == encoding.fieldID) as FieldItem;
                return [index > 0 ? '⨉' : '', 
                        <Chip 
                            key={`trigger-${channel}-${field?.id}`}
                            sx={{color:'inherit', maxWidth: '110px', marginLeft: "2px", height: 18, fontSize: 12, borderRadius: '4px', 
                                   border: '1px solid rgb(250 235 215)', background: 'rgb(250 235 215 / 70%)',
                                   '& .MuiChip-label': { paddingLeft: '6px', paddingRight: '6px' }}} 
                              label={`${field?.name}`} />]
            })
    }

    return <Box sx={{ }}>
            <InputLabel sx={{
                position: "absolute",
                background: "white",
                fontSize: "8px",
                transform: "translate(6px, -6px)",
                width: "50px",
                textAlign: "center",
                zIndex: 2,
            }}>{label}</InputLabel>
        <Card className={`${className}`} variant="outlined" 
                sx={{cursor: 'pointer', backgroundColor: 'rgba(255, 160, 122, 0.07)', '&:hover': { transform: "translate(0px, 1px)",  boxShadow: "0 0 3px rgba(33,33,33,.2)"}}} 
                onClick={()=>{ 
                    if (trigger.chart) {
                        dispatch(dfActions.setFocusedChart(trigger.chart.id));
                        dispatch(dfActions.setFocusedTable(trigger.chart.tableRef));
                    }
                }}>
            <Stack direction="row" sx={{marginLeft: 1, marginRight: 'auto', fontSize: 12}} alignItems="center" gap={"2px"}>
                <PrecisionManufacturing  sx={{color: 'darkgray', width: '14px', height: '14px'}} />
                <Box sx={{margin: '4px 8px 4px 2px', flex: 1}}>
                    {hideFields ? "" : <Typography fontSize="inherit" sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
                                    color: 'rgba(0,0,0,0.7)', maxWidth: 'calc(100%)'}}>{encodingComp}</Typography>}
                    <Typography fontSize="inherit" sx={{textAlign: 'center', 
                                    color: 'rgba(0,0,0,0.7)',  maxWidth: 'calc(100%)'}}>{prompt}</Typography> 
                </Box>
            </Stack>
        </Card>
    </Box>
}

// Add this component before EncodingShelfCard
const UserActionTableSelector: FC<{
    requiredActionTableIds: string[],
    userSelectedActionTableIds: string[],
    tables: DictTable[],
    updateUserSelectedActionTableIds: (tableIds: string[]) => void,
    requiredTableIds?: string[]
}> = ({ requiredActionTableIds, userSelectedActionTableIds, tables, updateUserSelectedActionTableIds, requiredTableIds = [] }) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);

    let actionTableIds = [...requiredActionTableIds, ...userSelectedActionTableIds.filter(id => !requiredActionTableIds.includes(id))];

    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleTableSelect = (table: DictTable) => {
        if (!actionTableIds.includes(table.id)) {
            updateUserSelectedActionTableIds([...userSelectedActionTableIds, table.id]);
        }
        handleClose();
    };

    return (
        <Box sx={{ 
            display: 'flex',
            flexWrap: 'wrap',
            gap: '2px',
            padding: '4px',
            marginBottom: 0.5,
        }}>
            {actionTableIds.map((tableId) => {
                const isRequired = requiredTableIds.includes(tableId);
                return (
                    <Chip
                        key={tableId}
                        label={tables.find(t => t.id == tableId)?.displayId}
                        size="small"
                        sx={{
                            height: 16,
                            fontSize: '10px',
                            borderRadius: '0px',
                            bgcolor: isRequired ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.1)', // darker blue for required
                            color: 'rgba(0, 0, 0, 0.7)',
                            '& .MuiChip-label': {
                                pl: '4px',
                                pr: '6px'
                            }
                        }}
                        deleteIcon={<CloseIcon sx={{ fontSize: '8px', width: '12px', height: '12px' }} />}
                        onDelete={isRequired ? undefined : () => updateUserSelectedActionTableIds(actionTableIds.filter(id => id !== tableId))}
                    />
                );
            })}
            <Tooltip title="add more base tables for data formulation">
                <IconButton
                    size="small"
                    onClick={handleClick}
                    sx={{ 
                        width: 16,
                        height: 16,
                        fontSize: '10px',
                        padding: 0
                    }}
                >
                    <AddIcon fontSize="inherit" />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
            >
                {tables
                    .map((table) => {
                        const isSelected = !!actionTableIds.find(t => t === table.id);
                        return (
                            <MenuItem 
                                disabled={isSelected}
                                key={table.id}
                                onClick={() => handleTableSelect(table)}
                                sx={{ 
                                    fontSize: '12px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}
                            >
                                {table.displayId}
                            </MenuItem>
                        );
                    })
                }
            </Menu>
        </Box>
    );
};


export const EncodingShelfCard: FC<EncodingShelfCardProps> = function ({ chartId }) {

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const config = useSelector((state: DataFormulatorState) => state.config);
    let existMultiplePossibleBaseTables = tables.filter(t => t.derive == undefined || t.anchored).length > 1;

    let activeModel = useSelector(dfSelectors.getActiveModel);
    let allCharts = useSelector(dfSelectors.getAllCharts);

    let chart = allCharts.find(c => c.id == chartId) as Chart;
    let trigger = chart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == chartId)?.derive?.trigger : undefined;

    let [prompt, setPrompt] = useState<string>(trigger?.instruction || "");

    let encodingMap = chart?.encodingMap;

    let handleUpdateChartType = (newChartType: string)=>{
        dispatch(dfActions.updateChartType({chartId, chartType: newChartType}));
    }

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let currentTable = getDataTable(chart, tables, allCharts, conceptShelfItems);

    const dispatch = useDispatch<AppDispatch>();
    

    // Add this state
    const [userSelectedActionTableIds, setUserSelectedActionTableIds] = useState<string[]>([]);
    
    
    // Update the handler to use state
    const handleUserSelectedActionTableChange = (newTableIds: string[]) => {
        setUserSelectedActionTableIds(newTableIds);
    };

    let encodingBoxGroups = Object.entries(ChannelGroups)
        .filter(([group, channelList]) => channelList.some(ch => Object.keys(encodingMap).includes(ch)))
        .map(([group, channelList]) => {

            let component = <Box>
                <Typography key={`encoding-group-${group}`} sx={{ fontSize: 10, color: "text.secondary", marginTop: "6px", marginBottom: "2px" }}>{group}</Typography>
                {channelList.filter(channel => Object.keys(encodingMap).includes(channel))
                    .map(channel => <EncodingBox key={`shelf-${channel}`} channel={channel as Channel} chartId={chartId} />)}
            </Box>
            return component;
        });

    // derive active fields from encoding map so that we can keep the order of which fields will be visualized
    let activeFields = Object.values(encodingMap).map(enc => enc.fieldID).filter(fieldId => fieldId && conceptShelfItems.map(f => f.id)
                                .includes(fieldId)).map(fieldId => conceptShelfItems.find(f => f.id == fieldId) as FieldItem);
    
    let activeCustomFields = activeFields.filter(field => field.source == "custom");

    // check if the current table contains all fields already exists a table that fullfills the user's specification
    let existsWorkingTable = activeFields.length == 0 || activeFields.every(f => currentTable.names.includes(f.name));
    
    // this is the base tables that will be used to derive the new data
    // this is the bare minimum tables that are required to derive the new data, based fields that will be used
    let requiredActionTables = selectBaseTables(activeFields, currentTable, tables);
    let actionTableIds = [
        ...requiredActionTables.map(t => t.id),
        ...userSelectedActionTableIds.filter(id => !requiredActionTables.map(t => t.id).includes(id))
    ];

    let deriveNewData = (overrideTableId?: string) => {

        let mode = 'formulate';
        if (actionTableIds.length == 0) {
            return;
        }

        let actionTables = actionTableIds.map(id => tables.find(t => t.id == id) as DictTable);

        let instruction = (['Auto'].includes(chart.chartType) && prompt == "") ? "let's get started" : prompt;

        if (currentTable.derive == undefined && instruction == "" && 
                (activeFields.length > 0 && activeCustomFields.length == 0) && 
                tables.some(t => t.derive == undefined && 
                activeFields.every(f => currentTable.names.includes(f.name)))) {

            // if there is no additional fields, directly generate
            let tempTable = getDataTable(chart, tables, allCharts, conceptShelfItems, true);
            dispatch(dfActions.updateTableRef({chartId: chartId, tableRef: tempTable.id}))

            //dispatch(dfActions.resetDerivedTables([])); //([{code: "", data: inputData.rows}]));
            dispatch(dfActions.changeChartRunningStatus({chartId, status: true}));
            // a fake function to give the feel that synthesizer is running
            setTimeout(function(){
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}));
                dispatch(dfActions.clearUnReferencedTables());
            }, 400);
            dispatch(dfActions.setVisPaneSize(640));
            return
        }

        dispatch(dfActions.clearUnReferencedTables());
        dispatch(dfActions.setVisPaneSize(640));
        //handleRunSynthesisStream(example);

        let fieldNamesStr = activeFields.map(f => f.name).reduce(
            (a: string, b: string, i, array) => a + (i == 0 ? "" : (i < array.length - 1 ? ', ' : ' and ')) + b, "")

        let token = String(Date.now());

        // if nothing is specified, just a formulation from the beginning
        let messageBody = JSON.stringify({
            token: token,
            mode,
            input_tables: actionTables.map(t => {
                return { name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), rows: t.rows }}),
            new_fields: activeFields.map(f => { return {name: f.name} }),
            extra_prompt: instruction,
            model: activeModel,
            max_repair_attempts: config.maxRepairAttempts,
            language: actionTables.some(t => t.virtual) ? "sql" : "python"
        })

        let engine = getUrls().DERIVE_DATA;

        if (currentTable.derive?.dialog && !currentTable.anchored) {
            let sourceTableIds = currentTable.derive?.source;

            // Compare if source and base table IDs are different
            if (!sourceTableIds.every(id => actionTableIds.includes(id)) || 
                !actionTableIds.every(id => sourceTableIds.includes(id))) {
                
                let additionalMessages = currentTable.derive.dialog;

                // in this case, because table ids has changed, we need to use the additional messages and reformulate
                messageBody = JSON.stringify({
                    token: token,
                    mode,
                    input_tables: actionTables.map(t => {return { name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), rows: t.rows }}),
                    new_fields: activeFields.map(f => { return {name: f.name} }),
                    extra_prompt: instruction,
                    model: activeModel,
                    additional_messages: additionalMessages,
                    max_repair_attempts: config.maxRepairAttempts,
                    language: actionTables.some(t => t.virtual) ? "sql" : "python"
                });
                engine = getUrls().DERIVE_DATA;
            } else {
                messageBody = JSON.stringify({
                    token: token,
                    mode,
                    input_tables: actionTables.map(t => {return { name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), rows: t.rows }}),
                    output_fields: activeFields.map(f => { return {name: f.name} }),
                    dialog: currentTable.derive?.dialog,
                    new_instruction: instruction,
                    model: activeModel,
                    max_repair_attempts: config.maxRepairAttempts,
                    language: actionTables.some(t => t.virtual) ? "sql" : "python"
                })
                engine = getUrls().REFINE_DATA;
            } 
        }

        let message = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: messageBody,
        };

        dispatch(dfActions.changeChartRunningStatus({chartId, status: true}));

        // timeout the request after 30 seconds
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.formulateTimeoutSeconds * 1000);
    
        fetch(engine, {...message, signal: controller.signal })
            .then((response) => response.json())
            .then((data) => {
                
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}))

                if (data.results.length > 0) {
                    if (data["token"] == token) {
                        let candidates = data["results"].filter((item: any) => {
                            return item["status"] == "ok"  
                        });

                        if (candidates.length == 0) {
                            let errorMessage = data.results[0].content;
                            let code = data.results[0].code;

                            dispatch(dfActions.addMessages({
                                "timestamp": Date.now(),
                                "type": "error",
                                "component": "chart builder",
                                "value": `Data formulation failed, please try again.`,
                                "code": code,
                                "detail": errorMessage
                            }));
                        } else {

                            let candidate = candidates[0];
                            let code = candidate["code"];
                            let rows = candidate["content"]["rows"];
                            let dialog = candidate["dialog"];

                            // determine the table id for the new table
                            let candidateTableId;
                            if (overrideTableId) {
                                candidateTableId = overrideTableId;
                            } else {
                                if (candidate["content"]["virtual"] != null) {
                                    candidateTableId = candidate["content"]["virtual"]["table_name"];
                                } else {
                                    let genTableId = () => {
                                        let tableSuffix = Number.parseInt((Date.now() - Math.floor(Math.random() * 10000)).toString().slice(-2));
                                        let tableId = `table-${tableSuffix}`
                                        while (tables.find(t => t.id == tableId) != undefined) {
                                            tableSuffix = tableSuffix + 1;
                                            tableId = `table-${tableSuffix}`
                                        } 
                                        return tableId;
                                    }
                                    candidateTableId = genTableId();
                                }
                            }

                            // PART 1: handle triggers
                            // add the intermediate chart that will be referred by triggers

                            let triggerChartSpec = duplicateChart(chart);
                            triggerChartSpec.source = "trigger";

                            let currentTrigger: Trigger =  { 
                                tableId: currentTable.id, 
                                sourceTableIds: actionTableIds,
                                instruction: instruction, 
                                chart: triggerChartSpec,
                                resultTableId: candidateTableId
                            }
                        
                            // PART 2: create new table (or override table)
                            let candidateTable = createDictTable(
                                candidateTableId, 
                                rows, 
                                { code: code, 
                                    codeExpl: "",
                                    source: actionTableIds, 
                                    dialog: dialog, 
                                    trigger: currentTrigger }
                            )
                            if (candidate["content"]["virtual"] != null) {
                                candidateTable.virtual = {
                                    tableId: candidate["content"]["virtual"]["table_name"],
                                    rowCount: candidate["content"]["virtual"]["row_count"]
                                };
                            }

                            if (overrideTableId) {
                                dispatch(dfActions.overrideDerivedTables(candidateTable));
                            } else {
                                dispatch(dfActions.insertDerivedTables(candidateTable));
                            }
                            let names = candidateTable.names;
                            let missingNames = names.filter(name => !conceptShelfItems.some(field => field.name == name));
                
                            let conceptsToAdd = missingNames.map((name) => {
                                return {
                                    id: `concept-${name}-${Date.now()}`, name: name, type: "auto" as Type, 
                                    description: "", source: "custom", tableRef: "custom", temporary: true, domain: [],
                                } as FieldItem
                            })
                            dispatch(dfActions.addConceptItems(conceptsToAdd));

                            dispatch(fetchFieldSemanticType(candidateTable));
                            dispatch(fetchCodeExpl(candidateTable));

                            // concepts from the current table
                            let currentConcepts = [...conceptShelfItems.filter(c => names.includes(c.name)), ...conceptsToAdd];

                            // PART 3: create new charts if necessary
                            let needToCreateNewChart = true;
                            
                            // different override strategy -- only override if there exists a chart that share the exact same encoding fields as the planned new chart.
                            if (chart.chartType != "Auto" &&  overrideTableId != undefined && allCharts.filter(c => c.source == "user").find(c => c.tableRef == overrideTableId)) {
                                let chartsFromOverrideTable = allCharts.filter(c => c.source == "user" && c.tableRef == overrideTableId);
                                let chartsWithSameEncoding = chartsFromOverrideTable.filter(c => {
                                    let getSimpliedChartEnc = (chart: Chart) => {
                                        return chart.chartType + ":" + Object.entries(chart.encodingMap).filter(([channel, enc]) => enc.fieldID != undefined).map(([channel, enc]) => {
                                            return `${channel}:${enc.fieldID}:${enc.aggregate}:${enc.stack}:${enc.sortOrder}:${enc.sortBy}:${enc.scheme}`;
                                        }).join(";");
                                    }
                                    return getSimpliedChartEnc(c) == getSimpliedChartEnc(triggerChartSpec);
                                });
                                if (chartsWithSameEncoding.length > 0) {
                                    // find the chart to set as focus
                                    dispatch(dfActions.setFocusedChart(chartsWithSameEncoding[0].id));
                                    needToCreateNewChart = false;
                                }
                            }
                            
                            if (needToCreateNewChart) {
                                let refinedGoal = candidate['refined_goal']

                                let newChart : Chart; 
                                if (chart.chartType == "Auto") {
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
                                    newChart.source = "user";
                                    newChart.id = `chart-${Date.now()- Math.floor(Math.random() * 10000)}`;
                                    newChart.saved = false;
                                    newChart.tableRef = candidateTable.id;
                                }
                                
                                // there is no need to resolve fields for table chart, just display all fields
                                if (chart.chartType != "Table") {   
                                    newChart = resolveChartFields(newChart, currentConcepts, refinedGoal, candidateTable);
                                }

                                dispatch(dfActions.addAndFocusChart(newChart));
                            }

                            // PART 4: clean up
                            if (chart.chartType == "Table" || chart.chartType == "Auto" || (existsWorkingTable == false)) {
                                dispatch(dfActions.deleteChartById(chartId));
                            }
                            dispatch(dfActions.clearUnReferencedTables());
                            dispatch(dfActions.clearUnReferencedCustomConcepts());
                            dispatch(dfActions.setFocusedTable(candidateTable.id));

                            dispatch(dfActions.addMessages({
                                "timestamp": Date.now(),
                                "component": "chart builder",
                                "type": "success",
                                "value": `Data formulation for ${fieldNamesStr} succeeded.`
                            }));
                        }
                    }
                } else {
                    // TODO: add warnings to show the user
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "component": "chart builder",
                        "type": "error",
                        "value": "No result is returned from the data formulation agent. Please try again."
                    }));
                }
            }).catch((error) => {
                dispatch(dfActions.changeChartRunningStatus({chartId, status: false}));
                // Check if the error was caused by the AbortController
                if (error.name === 'AbortError') {
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "component": "chart builder",
                        "type": "error",
                        "value": `Data formulation timed out after ${config.formulateTimeoutSeconds} seconds. Consider breaking down the task, using a different model or prompt, or increasing the timeout limit.`,
                        "detail": "Request exceeded timeout limit"
                    }));
                } else {
                    dispatch(dfActions.addMessages({
                        "timestamp": Date.now(),
                        "component": "chart builder",
                        "type": "error",
                        "value": `Data formulation failed, please try again.`,
                        "detail": error.message
                    }));
                }
            });
    }

    let createDisabled = false;

    // zip multiple components together
    const w: any = (a: any[], b: any[]) => a.length ? [a[0], ...w(b, a.slice(1))] : b;

    let formulateInputBox = <Box key='text-input-boxes' sx={{display: 'flex', flexDirection: 'row', flex: 1, padding: '0px 4px'}}>
        <TextField
            id="outlined-multiline-flexible"
            sx={{
                "& .MuiInputLabel-root": { fontSize: '12px' },
                "& .MuiInput-input": { fontSize: '12px' }
            }}
            onChange={(event: any) => {
                setPrompt(event.target.value);
            }}
            slotProps={{
                inputLabel: { shrink: true },
            }}
            value={prompt}
            label=""
            placeholder={['Auto'].includes(chart.chartType) ? "what do you want to visualize?" : "formulate data"}
            fullWidth
            multiline
            variant="standard"
            size="small"
            maxRows={4} 
            minRows={1}
        />
        {trigger ? 
            <Box sx={{display: 'flex'}}>
                <Tooltip title={<Typography sx={{fontSize: 11}}>formulate and override <TableRowsIcon sx={{fontSize: 10, marginBottom: '-1px'}}/>{trigger.resultTableId}</Typography>}>
                    <IconButton sx={{ marginLeft: "0"}} size="small"
                        disabled={createDisabled} color={"warning"} onClick={() => { 
                            deriveNewData(trigger.resultTableId); 
                        }}>
                        <ChangeCircleOutlinedIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>
         : 
             <Tooltip title={`Formulate`}>
                <IconButton sx={{ marginLeft: "0"}} 
                disabled={createDisabled} color={"primary"} onClick={() => { deriveNewData(); }}>
                    <PrecisionManufacturing />
                </IconButton>
            </Tooltip>
        }
    </Box>

    let channelComponent = (
        <Box sx={{ width: "100%", minWidth: "210px", height: '100%', display: "flex", flexDirection: "column" }}>
            {existMultiplePossibleBaseTables && <UserActionTableSelector 
                requiredActionTableIds={requiredActionTables.map(t => t.id)}
                userSelectedActionTableIds={userSelectedActionTableIds}
                tables={tables.filter(t => t.derive === undefined || t.anchored)}
                updateUserSelectedActionTableIds={handleUserSelectedActionTableChange}
                requiredTableIds={requiredActionTables.map(t => t.id)}
            />}
            <Box key='mark-selector-box' sx={{ flex: '0 0 auto' }}>
                <FormControl sx={{ m: 1, minWidth: 120, width: "100%", margin: "0px 0"}} size="small">
                    {!existMultiplePossibleBaseTables && <InputLabel 
                        id="chart-mark-select-label"
                        sx={{
                            color: "text.secondary",
                            transform: "none",
                            fontSize: "10px",
                            margin: "-2px 0px 0px 4px",
                        }}
                    >Chart Type</InputLabel>}   
                    <Select
                        variant="standard"
                        labelId="chart-mark-select-label"
                        id="chart-mark-select"
                        value={chart.chartType}
                        //title="Chart Type"
                        renderValue={(value: string) => {
                            const t = getChartTemplate(value);
                            return (
                                <div style={{display: 'flex', padding: "0px 0px 0px 4px"}}>
                                    <ListItemIcon sx={{minWidth: "24px"}}>
                                        {typeof t?.icon == 'string' ? <img height="24px" width="24px" src={t?.icon} alt="" role="presentation" /> : t?.icon}
                                        </ListItemIcon>
                                    <ListItemText sx={{marginLeft: "2px", whiteSpace: "initial"}} slotProps={{primary: {fontSize: 12}}}>{t?.chart}</ListItemText>
                                </div>
                            )
                        }}
                        onChange={(event) => { handleUpdateChartType(event.target.value) }}>
                        {Object.entries(CHART_TEMPLATES).map(([group, templates]) => {
                            return [
                                <ListSubheader sx={{ color: "text.secondary", lineHeight: 2, fontSize: 12 }} key={group}>{group}</ListSubheader>,
                                ...templates.map((t, i) => (
                                    <MenuItem sx={{ fontSize: 12, paddingLeft: 3, paddingRight: 3 }} value={t.chart} key={`${group}-${i}`}>
                                        <ListItemIcon>
                                            {typeof t?.icon == 'string' ? <img height="24px" width="24px" src={t?.icon} alt="" role="presentation" /> : t?.icon}
                                        </ListItemIcon>
                                        <ListItemText slotProps={{primary: {fontSize: 12}}}>{t.chart}</ListItemText>
                                    </MenuItem>
                                ))
                            ]
                        })}
                    </Select>
                </FormControl>
            </Box>
            <Box key='encoding-groups' sx={{ flex: '1 1 auto' }} style={{ height: "calc(100% - 100px)" }} className="encoding-list">
                {encodingBoxGroups}
            </Box>
            {formulateInputBox}
        </Box>);

    const encodingShelfCard = (
        <Card variant='outlined'  key='channel-components' 
            sx={{ padding: 1, maxWidth: "400px", display: 'flex', flexDirection: 'row', alignItems: "center", backgroundColor: trigger ? "rgba(255, 160, 122, 0.07)" : "" }}>
            {channelComponent}
        </Card>
    )

    return encodingShelfCard ;
}