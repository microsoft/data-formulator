// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FC, useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { DataFormulatorState, dfActions, dfSelectors, fetchCodeExpl, fetchFieldSemanticType, generateFreshChart } from '../app/dfSlice';

import embed from 'vega-embed';

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
    Card,
    Chip,
    Autocomplete,
    Menu,
    alpha,
    useTheme,
    SxProps,
    Theme,
    CircularProgress,
    Button,
} from '@mui/material';

import React from 'react';

import { Channel, Chart, FieldItem, Trigger, duplicateChart } from "../components/ComponentType";

import _ from 'lodash';

import '../scss/EncodingShelf.scss';
import { createDictTable, DictTable } from "../components/ComponentType";

import { getUrls, resolveChartFields, getTriggers, assembleVegaChart, resolveRecommendedChart } from '../app/utils';
import { EncodingBox } from './EncodingBox';

import { ChannelGroups, CHART_TEMPLATES, getChartChannels, getChartTemplate } from '../components/ChartTemplates';
import { checkChartAvailability, getDataTable } from './VisualizationView';
import TableRowsIcon from '@mui/icons-material/TableRowsOutlined';
import ChangeCircleOutlinedIcon from '@mui/icons-material/ChangeCircleOutlined';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import { ThinkingBanner } from './DataThread';

import { AppDispatch } from '../app/store';
import PrecisionManufacturing from '@mui/icons-material/PrecisionManufacturing';
import { Type } from '../data/types';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import TipsAndUpdatesIcon from '@mui/icons-material/TipsAndUpdates';
import BugReportIcon from '@mui/icons-material/BugReport';
import { IdeaChip } from './ChartRecBox';

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

// Add this utility function before the TriggerCard component
export const renderTextWithEmphasis = (text: string, highlightChipSx?: SxProps<Theme>) => {
    
    text = text.replace(/_/g, '_\u200B');
    // Split the prompt by ** patterns and create an array of text and highlighted segments
    const parts = text.split(/(\*\*.*?\*\*)/g);
    
    return parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            // This is a highlighted part - remove the ** and wrap with styled component
            const content = part.slice(2, -2).replaceAll('_', ' ');
            return (
                <Typography
                    key={index}
                    component="span"
                    sx={{
                        color: 'inherit',
                        padding: '0px 2px',
                        borderRadius: '4px',
                        ...highlightChipSx
                    }}
                >
                    {content}
                </Typography>
            );
        }
        return part;
    });
};

export const TriggerCard: FC<{
    className?: string, 
    trigger: Trigger, 
    hideFields?: boolean, 
    mini?: boolean,
    sx?: SxProps<Theme>}> = function ({ className, trigger, hideFields, mini = false, sx }) {

    let theme = useTheme();

    let fieldItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const dispatch = useDispatch<AppDispatch>();

    let handleClick = () => {
        if (trigger.chart) {
            dispatch(dfActions.setFocusedChart(trigger.chart.id));
            dispatch(dfActions.setFocusedTable(trigger.chart.tableRef));
        }
    }

    let encodingComp : any = '';
    let encFields = [];

    if (trigger.chart) {

        let chart = trigger.chart;
        let encodingMap = chart?.encodingMap;

        encFields = Object.entries(encodingMap)
            .filter(([channel, encoding]) => {
                return encoding.fieldID != undefined;
            })
            .map(([channel, encoding], index) => {
                let field = fieldItems.find(f => f.id == encoding.fieldID) as FieldItem;
                return field.name;
            });

        encodingComp = Object.entries(encodingMap)
            .filter(([channel, encoding]) => {
                return encoding.fieldID != undefined;
            })
            .map(([channel, encoding], index) => {
                let field = fieldItems.find(f => f.id == encoding.fieldID) as FieldItem;
                return [index > 0 ? '⨉' : '', 
                        <Chip 
                            key={`trigger-${channel}-${field?.id}`}
                            sx={{color:'inherit', maxWidth: '110px', m: 0.25,
                                   height: 18, fontSize: 12, borderRadius: '4px', 
                                   border: '1px solid rgb(250 235 215)', background: 'rgb(250 235 215 / 70%)',
                                   '& .MuiChip-label': { px: 0.5 }}} 
                              label={`${field?.name}`} />]
            })
    }

    let prompt: string = trigger.displayInstruction;
    if (trigger.instruction == '' && encFields.length > 0) {
        prompt = '';
    } else if (!trigger.displayInstruction || (trigger.instruction != '' && trigger.instruction.length <= trigger.displayInstruction.replace(/\*\*/g, '').length)) {
        prompt = trigger.instruction;
    }

    // Process the prompt to highlight content in ** **
    const processedPrompt = renderTextWithEmphasis(prompt, {
        fontSize: mini ? 10 : 12, padding: '1px 4px',
        borderRadius: '4px',
        background: alpha(theme.palette.custom.main, 0.08), 
    });

    if (mini) {
        return <Typography component="div" sx={{
            ml: '7px', borderLeft: '3px solid', 
            borderColor: alpha(theme.palette.custom.main, 0.5), 
            paddingLeft: '8px', 
            fontSize: '10px', color: theme.palette.text.secondary,
            my: '2px', textWrap: 'balance',
            '&:hover': {
                borderLeft: '3px solid',
                borderColor: theme.palette.custom.main,
                cursor: 'pointer',
                color: theme.palette.text.primary,
            },
            '& .MuiChip-label': { px: 0.5, fontSize: "10px"},
        }} onClick={handleClick}>
            {processedPrompt} 
            {hideFields ? "" : encodingComp}
        </Typography> 
    }

    return  <Card className={`${className}`} variant="outlined" 
        sx={{
            cursor: 'pointer', backgroundColor: alpha(theme.palette.custom.main, 0.05), 
            fontSize: '12px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '2px',
            '&:hover': { 
                transform: "translate(0px, -1px)",  
                boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            },
            '& .MuiChip-label': { px: 0.5, fontSize: "10px"},
            ...sx,
        }} 
        onClick={handleClick}>
        <Box sx={{mx: 1, my: 0.5}}>
            {hideFields ? "" : <Typography component="div" fontSize="inherit" sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
                            color: 'rgba(0,0,0,0.7)'}}>{encodingComp}</Typography>}
            <Typography fontSize="inherit" sx={{
                textAlign: 'center', width: 'fit-content',
                minWidth: '40px',
                color: 'rgba(0,0,0,0.7)'}}>
                    {prompt.length > 0 && <PrecisionManufacturing sx={{
                        color: 'darkgray', 
                        width: '14px', 
                        height: '14px',
                        mr: 0.5,
                        verticalAlign: 'text-bottom',
                        display: 'inline-block'
                    }} />}
                    {processedPrompt}
            </Typography>
        </Box>
    </Card>
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
                <span>
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
                </span>
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
    const theme = useTheme();

    // reference to states
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    const config = useSelector((state: DataFormulatorState) => state.config);
    const agentRules = useSelector((state: DataFormulatorState) => state.agentRules);
    let existMultiplePossibleBaseTables = tables.filter(t => t.derive == undefined || t.anchored).length > 1;

    let activeModel = useSelector(dfSelectors.getActiveModel);
    let allCharts = useSelector(dfSelectors.getAllCharts);

    let chart = allCharts.find(c => c.id == chartId) as Chart;
    let trigger = chart.source == "trigger" ? tables.find(t => t.derive?.trigger?.chart?.id == chartId)?.derive?.trigger : undefined;

    let [ideateMode, setIdeateMode] = useState<boolean>(false);
    let [prompt, setPrompt] = useState<string>(trigger?.instruction || "");

    useEffect(() => {
        setPrompt(trigger?.instruction || "");
    }, [chartId]);

    let encodingMap = chart?.encodingMap;

    const dispatch = useDispatch<AppDispatch>();

    const [chartTypeMenuOpen, setChartTypeMenuOpen] = useState<boolean>(false);
    
    // Add state for test dialog
    const [testDialogOpen, setTestDialogOpen] = useState<boolean>(false);

    let handleUpdateChartType = (newChartType: string) => {
        dispatch(dfActions.updateChartType({chartId, chartType: newChartType}));
        // Close the menu after selection
        setChartTypeMenuOpen(false);
    }

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let currentTable = getDataTable(chart, tables, allCharts, conceptShelfItems);

    // Add this state
    const [userSelectedActionTableIds, setUserSelectedActionTableIds] = useState<string[]>([]);
    
    // Add state for ideas and loading
    const [ideas, setIdeas] = useState<{text: string, goal: string, difficulty: 'easy' | 'medium' | 'hard'}[]>([]);
    const [thinkingBuffer, setThinkingBuffer] = useState<string>("");
    const [isLoadingIdeas, setIsLoadingIdeas] = useState<boolean>(false);
    
    // Update the handler to use state
    const handleUserSelectedActionTableChange = (newTableIds: string[]) => {
        setUserSelectedActionTableIds(newTableIds);
    };

    let encodingBoxGroups = Object.entries(ChannelGroups)
        .filter(([group, channelList]) => channelList.some(ch => Object.keys(encodingMap).includes(ch)))
        .map(([group, channelList]) => {

            let component = <Box key={`encoding-group-box-${group}`}>
                <Typography key={`encoding-group-${group}`} sx={{ fontSize: 10, color: "text.secondary", marginTop: "6px", marginBottom: "2px" }}>{group}</Typography>
                {channelList.filter(channel => Object.keys(encodingMap).includes(channel))
                    .map(channel => <EncodingBox key={`shelf-${channel}`} channel={channel as Channel} chartId={chartId} tableId={currentTable.id} />)}
            </Box>
            return component;
        });

    // derive active fields from encoding map so that we can keep the order of which fields will be visualized
    let activeFields = Object.values(encodingMap).map(enc => enc.fieldID).filter(fieldId => fieldId && conceptShelfItems.map(f => f.id)
                                .includes(fieldId)).map(fieldId => conceptShelfItems.find(f => f.id == fieldId) as FieldItem);
    let activeSimpleEncodings: { [key: string]: string } = {};
    for (let channel of getChartChannels(chart.chartType)) {
        if (chart.encodingMap[channel as Channel].fieldID) {
            activeSimpleEncodings[channel] = activeFields.find(f => f.id == chart.encodingMap[channel as Channel].fieldID)?.name as string;
        }
    }
    
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

    let getIdeasForVisualization = async () => {
        if (!currentTable || isLoadingIdeas) {
            return;
        }

        setIsLoadingIdeas(true);
        setThinkingBuffer("");
        setIdeas([]);

        try {
            // Build exploration thread from current table to root
            let explorationThread: any[] = [];
            
            // If current table is derived, build the exploration thread
            if (currentTable.derive && !currentTable.anchored) {
                let triggers = getTriggers(currentTable, tables);
                
                // Build exploration thread with all derived tables in the chain
                explorationThread = triggers
                    .map(trigger => ({
                        name: trigger.resultTableId,
                        rows: tables.find(t2 => t2.id === trigger.resultTableId)?.rows,
                        description: `Derive from ${trigger.sourceTableIds} with instruction: ${trigger.instruction}`,
                    }));
            }

            // Get the root table (first table in actionTableIds)
            const rootTable = tables.find(t => t.id === actionTableIds[0]);
            if (!rootTable) {
                throw new Error('No root table found');
            }

            let chartAvailable = checkChartAvailability(chart, conceptShelfItems, currentTable.rows);
            let currentChartPng = chartAvailable ? await vegaLiteSpecToPng(assembleVegaChart(chart.chartType, chart.encodingMap, activeFields, currentTable.rows, currentTable.metadata, 20)) : undefined;

            const token = String(Date.now());
            const messageBody = JSON.stringify({
                token: token,
                model: activeModel,
                input_tables: [{
                    name: rootTable.virtual?.tableId || rootTable.id.replace(/\.[^/.]+$/, ""),
                    rows: rootTable.rows,
                    attached_metadata: rootTable.attachedMetadata
                }],
                exploration_thread: explorationThread,
                current_data_sample: currentTable.rows.slice(0, 10),
                current_chart: currentChartPng,
                mode: 'interactive',
                agent_exploration_rules: agentRules.exploration
            });

            const engine = getUrls().GET_RECOMMENDATION_QUESTIONS;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

            const response = await fetch(engine, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: messageBody,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Use streaming reader instead of response.json()
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();

            let lines: string[] = [];
            let buffer = '';

            let updateState = (lines: string[]) => {

                let dataBlocks = lines
                    .map(line => {
                        try { return JSON.parse(line.trim()); } catch (e) { return null; }})
                    .filter(block => block != null);

                let questions = dataBlocks.filter(block => block.type == "question").map(block => ({
                    text: block.text,
                    goal: block.goal,
                    difficulty: block.difficulty,
                    tag: block.tag
                }));

                setIdeas(questions);
            }

            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) { break; }

                    buffer += decoder.decode(value, { stream: true });
                    let newLines = buffer.split('data: ').filter(line => line.trim() !== "");

                    buffer = newLines.pop() || '';
                    if (newLines.length > 0) {
                        lines.push(...newLines);
                        updateState(lines);
                    }
                    setThinkingBuffer(buffer.replace(/^data: /, ""));
                }
            } finally {
                reader.releaseLock();
            }

            lines.push(buffer);
            updateState(lines);

            // Process the final result
            if (lines.length == 0) {
                throw new Error('No valid results returned from agent');
            }
        } catch (error) {
            dispatch(dfActions.addMessages({
                "timestamp": Date.now(),
                "type": "error",
                "component": "encoding shelf",
                "value": "Failed to get ideas from the exploration agent. Please try again.",
                "detail": error instanceof Error ? error.message : 'Unknown error'
            }));
        } finally {
            setIsLoadingIdeas(false);
        }
    }   

    // Function to handle idea chip click
    const handleIdeaClick = (ideaText: string) => {
        setIdeateMode(true);
        setPrompt(ideaText);
        // Automatically start the data formulation process
        deriveNewData(ideaText, 'ideate');
    };


    let deriveNewData = (
        instruction: string, 
        mode: 'formulate' | 'ideate' = 'formulate', 
        overrideTableId?: string,
    ) => {

        if (actionTableIds.length == 0) {
            return;
        }

        let actionTables = actionTableIds.map(id => tables.find(t => t.id == id) as DictTable);

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
            return
        }

        dispatch(dfActions.clearUnReferencedTables());
        
        let fieldNamesStr = activeFields.map(f => f.name).reduce(
            (a: string, b: string, i, array) => a + (i == 0 ? "" : (i < array.length - 1 ? ', ' : ' and ')) + b, "")

        let chartType = chart.chartType;

        let token = String(Date.now());

        // if nothing is specified, just a formulation from the beginning
        let messageBody = JSON.stringify({
            token: token,
            mode,
            input_tables: actionTables.map(t => {
                return { 
                    name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), 
                    rows: t.rows, 
                    attached_metadata: t.attachedMetadata 
                }}),
            chart_type: chartType,
            chart_encodings: mode == 'formulate' ? activeSimpleEncodings : {},
            extra_prompt: instruction,
            model: activeModel,
            max_repair_attempts: config.maxRepairAttempts,
            agent_coding_rules: agentRules.coding,
            language: actionTables.some(t => t.virtual) ? "sql" : "python"
        })

        let engine = getUrls().DERIVE_DATA;

        if (currentTable.derive?.dialog && !currentTable.anchored) {
            let sourceTableIds = currentTable.derive?.source;

            let startNewDialog = (!sourceTableIds.every(id => actionTableIds.includes(id)) || 
                !actionTableIds.every(id => sourceTableIds.includes(id))) || mode === 'ideate';

            // Compare if source and base table IDs are different
            if (startNewDialog) {

                console.log("start new dialog", startNewDialog);
                
                let additionalMessages = currentTable.derive.dialog;

                // in this case, because table ids has changed, we need to use the additional messages and reformulate
                messageBody = JSON.stringify({
                    token: token,
                    mode,
                    input_tables: actionTables.map(t => {
                        return { 
                            name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), 
                            rows: t.rows, 
                            attached_metadata: t.attachedMetadata 
                        }}),
                    chart_type: chartType,
                    chart_encodings: mode == 'formulate' ? activeSimpleEncodings : {},
                    extra_prompt: instruction,
                    model: activeModel,
                    additional_messages: additionalMessages,
                    max_repair_attempts: config.maxRepairAttempts,
                    agent_coding_rules: agentRules.coding,
                    language: actionTables.some(t => t.virtual) ? "sql" : "python"
                });
                engine = getUrls().DERIVE_DATA;
            } else {
                messageBody = JSON.stringify({
                    token: token,
                    mode,
                    input_tables: actionTables.map(t => {
                        return { 
                            name: t.virtual?.tableId || t.id.replace(/\.[^/.]+$/ , ""), 
                            rows: t.rows, 
                            attached_metadata: t.attachedMetadata 
                        }}),
                    chart_type: chartType,
                    chart_encodings: mode == 'formulate' ? activeSimpleEncodings : {},
                    dialog: currentTable.derive?.dialog,
                    latest_data_sample: currentTable.rows.slice(0, 10),
                    new_instruction: instruction,
                    model: activeModel,
                    max_repair_attempts: config.maxRepairAttempts,
                    agent_coding_rules: agentRules.coding,
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
                            let refinedGoal = candidate['refined_goal']
                            let displayInstruction = refinedGoal["display_instruction"];

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
                                displayInstruction: displayInstruction,
                                chart: triggerChartSpec,
                                resultTableId: candidateTableId
                            }
                        
                            // PART 2: create new table (or override table)
                            let candidateTable = createDictTable(
                                candidateTableId, 
                                rows, 
                                { 
                                    code: code, 
                                    source: actionTableIds, 
                                    dialog: dialog, 
                                    trigger: currentTrigger 
                                }
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
                                    id: `concept-${name}-${Date.now()}`, 
                                    name: name, 
                                    type: "auto" as Type, 
                                    description: "", 
                                    source: "custom", 
                                    tableRef: "custom", 
                                    temporary: true, 
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
                            if (mode != "ideate" && chart.chartType != "Auto" &&  overrideTableId != undefined && allCharts.filter(c => c.source == "user").find(c => c.tableRef == overrideTableId)) {
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
                                let newChart : Chart; 
                                if (mode == "ideate" || chart.chartType == "Auto") {
                                    newChart = resolveRecommendedChart(refinedGoal, currentConcepts, candidateTable);

                                } else if (chart.chartType == "Table") {
                                    newChart = generateFreshChart(candidateTable.id, 'Table')
                                } else {
                                    newChart = structuredClone(chart) as Chart;
                                    newChart.source = "user";
                                    newChart.id = `chart-${Date.now()- Math.floor(Math.random() * 10000)}`;
                                    newChart.saved = false;
                                    newChart.tableRef = candidateTable.id;
                                    newChart = resolveChartFields(newChart, currentConcepts, refinedGoal['chart_encodings'], candidateTable);
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
                    console.error(error);
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
            onKeyDown={(event: any) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (prompt.trim().length > 0) {
                        deriveNewData(prompt, 'formulate');
                    }
                }
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
                    <span>
                        <IconButton sx={{ marginLeft: "0"}} size="small"
                            disabled={createDisabled} color={"warning"} onClick={() => { 
                                deriveNewData(trigger.instruction, 'formulate', trigger.resultTableId); 
                            }}>
                            <ChangeCircleOutlinedIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>
            : 
            <Tooltip title={`Formulate`}>
                <span>
                    <IconButton sx={{ marginLeft: "0"}} 
                        disabled={createDisabled} color={"primary"} onClick={() => { deriveNewData(prompt, 'formulate'); }}>
                        <PrecisionManufacturing />
                    </IconButton>
                </span>
            </Tooltip>
        }
        
    </Box>

    // Ideas display section
    let ideasSection = ideas.length > 0 ? (
        <Box key='ideas-section'>
            <Box sx={{
                p: 0.5,
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: 0.75,
            }}>
                {ideas.map((idea, index) => (
                    <IdeaChip
                        mini={true}
                        mode="interactive"
                        key={index}
                        idea={idea}
                        theme={theme}
                        onClick={() => handleIdeaClick(idea.text)}
                        disabled={createDisabled}
                    />
                ))}
                {isLoadingIdeas && thinkingBuffer && (
                    <Typography sx={{ padding: 0.5, fontSize: 10, color: "darkgray" }}>
                        drafting {thinkingBuffer
                            .slice(-80) // Get latest 80 characters
                            .split('')
                            .map((char, index) => {
                                if (/\s/.test(char)) return char; // Keep whitespace
                                // Use different characters based on position for variety
                                const chars = ['·'];
                                return chars[index % chars.length];
                            })
                            .join('')
                        }
                    </Typography>
                )}
            </Box>
        </Box>
    ) : null;

    // Mode toggle header component
    const ModeToggleHeader = () => (
        <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1, 
            padding: '4px 8px',
            borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
            backgroundColor: 'rgba(0, 0, 0, 0.02)'
        }}>
            <Typography 
                sx={{ 
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    fontSize: 11, 
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: 1,
                    backgroundColor: ideateMode ? 'rgba(25, 118, 210, 0.08)' : 'transparent',
                    color: ideateMode ? 'primary.main' : 'text.secondary',
                    fontWeight: ideateMode ? 500 : 400,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                        backgroundColor: ideateMode ? 'rgba(25, 118, 210, 0.12)' : 'rgba(0, 0, 0, 0.04)'
                    }
                }}
                onClick={() => {
                    if (ideas.length > 0) {
                        setIdeateMode(true);
                        setPrompt("");
                    } else {
                        setIdeateMode(true);
                        getIdeasForVisualization();
                    }
                }}
            >
                {ideas.length > 0 ? "Ideas" : "Get Ideas"}
                {ideas.length == 0 && (
                    <LightbulbOutlinedIcon 
                        sx={{
                            fontSize: 12, 
                            animation: 'pulse 3s ease-in-out infinite',
                            '@keyframes pulse': {
                                '0%': {
                                },
                                '50%': {
                                    color: theme.palette.derived.main,
                                },
                                '100%': {
                                }
                            }
                        }} 
                    />
                )}
            </Typography>
            <Typography 
                sx={{ 
                    fontSize: 11, 
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: 1,
                    backgroundColor: !ideateMode ? 'rgba(25, 118, 210, 0.08)' : 'transparent',
                    color: !ideateMode ? 'primary.main' : 'text.secondary',
                    fontWeight: !ideateMode ? 500 : 400,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                        backgroundColor: !ideateMode ? 'rgba(25, 118, 210, 0.12)' : 'rgba(0, 0, 0, 0.04)'
                    }
                }}
                onClick={() => setIdeateMode(false)}
            >
                Editor
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Test resolveChartFields function">
                <IconButton
                    size="small"
                    onClick={() => setTestDialogOpen(true)}
                    sx={{ 
                        width: 20,
                        height: 20,
                        fontSize: '10px'
                    }}
                >
                    <BugReportIcon fontSize="inherit" />
                </IconButton>
            </Tooltip>
        </Box>
    );

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
                    <Select
                        variant="standard"
                        labelId="chart-mark-select-label"
                        id="chart-mark-select"
                        value={chart.chartType}
                        // Add these props to control the open state
                        open={chartTypeMenuOpen}
                        onOpen={() => setChartTypeMenuOpen(true)}
                        onClose={() => setChartTypeMenuOpen(false)}
                        MenuProps={{
                            anchorOrigin: {
                                vertical: 'bottom',
                                horizontal: 'left',
                            },
                            transformOrigin: {
                                vertical: 'top',
                                horizontal: 'left',
                            },
                            PaperProps: {
                                sx: {
                                    '& .MuiList-root': {
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: 0,
                                        padding: '8px'
                                    }
                                }
                            }
                        }}
                        renderValue={(value: string) => {
                            const t = getChartTemplate(value);
                            return (
                                <div style={{display: 'flex', padding: "0px 0px 0px 4px"}}>
                                    <ListItemIcon sx={{minWidth: "24px"}}>
                                        {typeof t?.icon == 'string' ? <img height="24px" width="24px" src={t?.icon} alt="" role="presentation" /> : 
                                         <Box sx={{width: "24px", height: "24px"}}>{t?.icon}</Box>}
                                        </ListItemIcon>
                                    <ListItemText sx={{marginLeft: "2px", whiteSpace: "initial"}} slotProps={{primary: {fontSize: 12}}}>{t?.chart}</ListItemText>
                                </div>
                            )
                        }}
                        onChange={(event) => { }}>
                        {Object.entries(CHART_TEMPLATES).map(([group, templates]) => {
                            return [
                                <ListSubheader sx={{ 
                                    color: "text.secondary", 
                                    lineHeight: 2, 
                                    fontSize: 12,
                                    gridColumn: '1 / -1' // Make subheader span both columns
                                }} key={group}>{group}</ListSubheader>,
                                ...templates.map((t, i) => (
                                    <MenuItem 
                                        sx={{ 
                                            fontSize: 12, 
                                            paddingLeft: 2, 
                                            paddingRight: 2,
                                            minHeight: '32px',
                                            margin: '1px 0'
                                        }} 
                                        value={t.chart} 
                                        key={`${group}-${i}`}
                                        onClick={(e) => {
                                            console.log('MenuItem clicked:', t.chart);
                                            // Manually trigger the chart type update (this will also close the menu)
                                            handleUpdateChartType(t.chart);
                                        }}
                                    >
                                        <Box sx={{display: 'flex'}}>
                                            <ListItemIcon sx={{minWidth: "20px"}}>
                                                {typeof t?.icon == 'string' ? 
                                                    <img height="20px" width="20px" src={t?.icon} alt="" role="presentation" /> : 
                                                    <Box sx={{width: "20px", height: "20px"}}>{t?.icon}</Box>
                                                }
                                            </ListItemIcon>
                                            <ListItemText 
                                                slotProps={{primary: {fontSize: 11}}} 
                                                sx={{ margin: 0 }}
                                            >
                                                {t.chart}
                                            </ListItemText>
                                        </Box>
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
        <Card variant='outlined' sx={{ 
            padding: 0, 
            maxWidth: "400px", 
            display: 'flex', 
            flexDirection: 'column', 
            backgroundColor: trigger ? "rgba(255, 160, 122, 0.07)" : "" 
        }}>
            <ModeToggleHeader />
            {ideateMode ? (
                <Box sx={{ padding: 1 }}>
                    <Tooltip title={`get ideas for visualization`}>
                        <span>
                            <Button 
                                variant="text"
                                disabled={createDisabled || isLoadingIdeas} 
                                color={"primary"} 
                                size="small"
                                onClick={() => { getIdeasForVisualization(); }}
                                startIcon={isLoadingIdeas ? undefined : <LightbulbOutlinedIcon sx={{fontSize: 10}} />}
                                sx={{
                                    fontSize: 12,
                                    textTransform: 'none',
                                }}
                            >
                                {isLoadingIdeas ? ThinkingBanner('ideating...') : "Different ideas?"} 
                            </Button>
                        </span>
                    </Tooltip>
                    {ideasSection}
                </Box>
            ) : (
                <Box sx={{ padding: 1 }}>
                    {channelComponent}
                </Box>
            )}
        </Card>
    );

    return encodingShelfCard;
}

// Function to convert Vega-Lite spec to PNG data URL with improved resolution
const vegaLiteSpecToPng = async (spec: any, scale: number = 2.0, quality: number = 1.0): Promise<string | null> => {
    try {
        // Create a temporary container
        const tempId = `temp-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const tempContainer = document.createElement('div');
        tempContainer.id = tempId;
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        document.body.appendChild(tempContainer);

        // Embed the chart with higher resolution settings
        const result = await embed('#' + tempId, spec, { 
            actions: false, 
            renderer: "canvas",
            scaleFactor: scale // Apply scale factor for higher resolution
        });

        // Get the canvas and apply high-resolution rendering
        const canvas = await result.view.toCanvas(scale); // Pass scale to toCanvas
        const pngDataUrl = canvas.toDataURL('image/png', quality);

        // Clean up
        document.body.removeChild(tempContainer);

        return pngDataUrl;
    } catch (error) {
        console.error('Error converting Vega-Lite spec to PNG:', error);
        return null;
    }
};

// Alternative method using toImageURL for even better quality
const vegaLiteSpecToPngWithImageURL = async (spec: any, scale: number = 2.0): Promise<string | null> => {
    try {
        // Create a temporary container
        const tempId = `temp-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const tempContainer = document.createElement('div');
        tempContainer.id = tempId;
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        document.body.appendChild(tempContainer);

        // Embed the chart
        const result = await embed('#' + tempId, spec, { 
            actions: false, 
            renderer: "canvas",
            scaleFactor: scale
        });

        // Use toImageURL for better quality
        const pngDataUrl = await result.view.toImageURL('png', scale);

        // Clean up
        document.body.removeChild(tempContainer);

        return pngDataUrl;
    } catch (error) {
        console.error('Error converting Vega-Lite spec to PNG:', error);
        return null;
    }
};
